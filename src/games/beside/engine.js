// Host-side rules for Beside Them. The imposter's id is host-only knowledge
// (`secret`) and is never put in the shared state until the round ends.
import { distanceMeters, shuffled } from '../../lib/multiplayer'
import { PUZZLE_KINDS } from './Puzzles'

export const COUNTDOWN_MS = 6000
export const KILL_RANGE_M = 10
export const STATION_RANGE_M = 12
export const REPORT_RANGE_M = 15
export const VOTE_MS = 30000
export const MEETING_COOLDOWN_MS = 20000
export const SABOTAGE_MS = 45000
export const SABOTAGE_COOLDOWN_MS = 90000

export const slack = (a, b) => Math.min(10, ((a?.acc ?? 10) + (b?.acc ?? 10)) / 2)
export const within = (a, b, r) => !!a && !!b && distanceMeters(a, b) <= r + slack(a, b)

export function initialState(roster, info, now) {
  const s = info.settings || {}
  const stations = s.stations || []
  const perPlayer = Math.min(s.tasksPerPlayer || 4, Math.max(1, stations.length))
  const players = {}
  const tasks = {}
  for (const p of roster) {
    players[p.id] = { name: p.username, alive: true, ejected: false, emergencies: 1, tasksDone: 0 }
    tasks[p.id] = shuffled(stations).slice(0, perPlayer).map((st) => ({
      stationId: st.id,
      puzzle: PUZZLE_KINDS[Math.floor(Math.random() * PUZZLE_KINDS.length)],
      done: false,
    }))
  }
  return {
    game: 'beside',
    round: info.round,
    phase: 'countdown',
    startedAt: now,
    startsAt: now + COUNTDOWN_MS,
    killCooldownMs: (s.killCooldown || 30) * 1000,
    discussMs: (s.discussSeconds || 60) * 1000,
    players,
    tasks,
    bodies: {},
    progress: 0,
    meeting: null,
    meetingNo: 0,
    lastMeeting: null,
    meetingReadyAt: now + COUNTDOWN_MS + MEETING_COOLDOWN_MS,
    sabotage: null,
    feed: [],
    winner: null,
    reason: null,
    imposterId: null,
    stats: null,
  }
}

export function newSecret(state) {
  return {
    round: state.round,
    imposterId: shuffled(Object.keys(state.players))[0],
    lastKillAt: state.startsAt,
    sabotageReadyAt: state.startsAt + 30000,
    voteLog: [],
  }
}

const feed = (state, text, now) => [{ id: `${now}-${Math.random().toString(36).slice(2, 6)}`, text }, ...state.feed].slice(0, 6)

export function crewProgress(state, imposterId) {
  let done = 0
  let total = 0
  for (const id of Object.keys(state.tasks)) {
    if (id === imposterId) continue
    for (const t of state.tasks[id]) { total += 1; if (t.done) done += 1 }
  }
  return total ? done / total : 0
}

function finalize(state, winner, reason, secret) {
  const correct = {}
  for (const m of secret?.voteLog || []) {
    for (const voter of Object.keys(m.votes)) if (m.votes[voter] === secret.imposterId) correct[voter] = (correct[voter] || 0) + 1
  }
  let mvp = null
  if (winner === 'imposter') mvp = secret?.imposterId || null
  else {
    const crew = Object.keys(state.players).filter((id) => id !== secret?.imposterId)
    crew.sort((a, b) => ((state.players[b].tasksDone + 2 * (correct[b] || 0)) - (state.players[a].tasksDone + 2 * (correct[a] || 0))))
    mvp = crew[0] || null
  }
  return { ...state, phase: 'ended', meeting: null, sabotage: null, winner, reason, imposterId: secret?.imposterId || null, stats: { correctVotes: correct }, mvp }
}

export function checkWin(state, secret, presentIds) {
  if (state.phase === 'ended' || state.phase === 'countdown' || !secret) return state
  const imp = secret.imposterId
  if (!presentIds.has(imp)) return finalize(state, 'crew', 'imposter-left', secret)
  if (!state.players[imp]?.alive) return finalize(state, 'crew', 'ejected', secret)
  if (state.progress >= 1) return finalize(state, 'crew', 'tasks', secret)
  const aliveCrew = Object.keys(state.players).filter((id) => id !== imp && state.players[id].alive && presentIds.has(id)).length
  if (aliveCrew <= 1) return finalize(state, 'imposter', 'outnumbered', secret)
  return state
}

function startMeeting(state, kind, calledBy, body, now) {
  const discussUntil = now + state.discussMs
  return {
    ...state,
    phase: 'meeting',
    sabotage: null,
    bodies: Object.fromEntries(Object.entries(state.bodies).map(([k, v]) => [k, { ...v, reported: true }])),
    meeting: { kind, calledBy, body: body || null, discussUntil, endsAt: discussUntil + VOTE_MS, votes: {} },
    meetingNo: state.meetingNo + 1,
    feed: feed(state, kind === 'body' ? `${state.players[calledBy].name} reported ${state.players[body]?.name}’s body` : `${state.players[calledBy].name} called an emergency meeting`, now),
  }
}

function resolveMeeting(state, secret, now) {
  const m = state.meeting
  const aliveIds = Object.keys(state.players).filter((id) => state.players[id].alive)
  const tally = {}
  let skip = 0
  for (const voter of Object.keys(m.votes)) {
    if (!state.players[voter]?.alive) continue
    const v = m.votes[voter]
    if (v === 'skip') skip += 1
    else tally[v] = (tally[v] || 0) + 1
  }
  secret.voteLog.push({ meetingNo: state.meetingNo, votes: { ...m.votes } })
  secret.lastKillAt = now // kill cooldown restarts after every meeting
  let ejected = null
  for (const id of Object.keys(tally)) if (tally[id] > aliveIds.length / 2) ejected = id
  const players = { ...state.players }
  if (ejected) players[ejected] = { ...players[ejected], alive: false, ejected: true }
  return {
    ...state,
    phase: 'playing',
    players,
    meeting: null,
    meetingReadyAt: now + MEETING_COOLDOWN_MS,
    lastMeeting: { at: now, ejected, wasImposter: ejected ? ejected === secret.imposterId : null, tally, skip, voters: Object.keys(m.votes).length },
    feed: feed(state, ejected ? `${players[ejected].name} was voted out` : 'No one was voted out', now),
  }
}

export function tick(state, secret, { now, presentIds }) {
  if (state.phase === 'ended') return state
  if (state.phase === 'countdown') return now >= state.startsAt ? { ...state, phase: 'playing' } : state
  let next = state
  if (next.sabotage && now >= next.sabotage.until) next = { ...next, sabotage: null, feed: feed(next, 'Comms came back online', now) }
  if (next.phase === 'meeting' && next.meeting) {
    const aliveIds = Object.keys(next.players).filter((id) => next.players[id].alive && presentIds.has(id))
    const allVoted = now >= next.meeting.discussUntil && aliveIds.every((id) => next.meeting.votes[id] !== undefined)
    if (allVoted || now >= next.meeting.endsAt) next = resolveMeeting(next, secret, now)
  }
  return checkWin(next, secret, presentIds)
}

// Returns { state, reply? }.
export function applyAction(state, secret, action, from, { now, posOf, stations, presentIds }) {
  const me = state.players[from]
  if (!me || !action || state.phase === 'ended' || state.phase === 'countdown') return { state }
  const notice = (text) => ({ state, reply: { type: 'notice', data: { text } } })
  let next = state
  switch (action.type) {
    case 'task': {
      const list = state.tasks[from]
      const i = Number(action.index)
      if (state.phase !== 'playing' || !list?.[i] || list[i].done) return { state }
      const st = stations.find((x) => x.id === list[i].stationId)
      if (!st || !within(posOf(from), st, STATION_RANGE_M)) return notice('You need to be at the station to finish this task.')
      next = {
        ...state,
        tasks: { ...state.tasks, [from]: list.map((t, j) => (j === i ? { ...t, done: true } : t)) },
        players: { ...state.players, [from]: { ...me, tasksDone: me.tasksDone + 1 } },
      }
      next.progress = crewProgress(next, secret.imposterId)
      break
    }
    case 'kill': {
      if (state.phase !== 'playing' || from !== secret.imposterId || !me.alive) return { state }
      const victim = state.players[action.target]
      if (!victim?.alive || action.target === from) return { state }
      const readyAt = secret.lastKillAt + state.killCooldownMs
      if (now < readyAt) return notice(`Cooldown — ${Math.ceil((readyAt - now) / 1000)}s left.`)
      const a = posOf(from)
      const b = posOf(action.target)
      if (!a || !b) return notice('Waiting for locations — try again.')
      if (!within(a, b, KILL_RANGE_M)) return notice('Too far away.')
      secret.lastKillAt = now
      next = {
        ...state,
        players: { ...state.players, [action.target]: { ...victim, alive: false } },
        bodies: { ...state.bodies, [action.target]: { lat: b.lat, lng: b.lng, at: now, reported: false } },
      }
      return { state: checkWin(next, secret, presentIds), reply: { type: 'kill_ok', data: { readyAt: now + state.killCooldownMs } } }
    }
    case 'report': {
      const body = state.bodies[action.body]
      if (state.phase !== 'playing' || !me.alive || !body || body.reported) return { state }
      if (!within(posOf(from), body, REPORT_RANGE_M)) return notice('Get closer to report.')
      next = startMeeting(state, 'body', from, action.body, now)
      break
    }
    case 'meeting': {
      if (state.phase !== 'playing' || !me.alive) return { state }
      if (me.emergencies <= 0) return notice('You’ve used your emergency meeting.')
      if (state.sabotage) return notice('Comms are down — fix them first.')
      if (now < state.meetingReadyAt) return notice('You can call a meeting again shortly.')
      next = startMeeting({ ...state, players: { ...state.players, [from]: { ...me, emergencies: me.emergencies - 1 } } }, 'emergency', from, null, now)
      break
    }
    case 'vote': {
      const m = state.meeting
      if (state.phase !== 'meeting' || !m || !me.alive || now < m.discussUntil || m.votes[from] !== undefined) return { state }
      if (action.target !== 'skip' && !state.players[action.target]?.alive) return { state }
      next = { ...state, meeting: { ...m, votes: { ...m.votes, [from]: action.target } } }
      break
    }
    case 'sabotage': {
      if (state.phase !== 'playing' || from !== secret.imposterId || !me.alive || state.sabotage) return { state }
      if (now < secret.sabotageReadyAt) return notice(`Sabotage ready in ${Math.ceil((secret.sabotageReadyAt - now) / 1000)}s.`)
      secret.sabotageReadyAt = now + SABOTAGE_COOLDOWN_MS
      next = { ...state, sabotage: { until: now + SABOTAGE_MS }, feed: feed(state, '📡 Comms sabotaged!', now) }
      break
    }
    case 'fix': {
      if (state.phase !== 'playing' || !state.sabotage || !me.alive) return { state }
      const pos = posOf(from)
      if (!stations.some((st) => within(pos, st, STATION_RANGE_M))) return notice('Go to any station to fix comms.')
      next = { ...state, sabotage: null, feed: feed(state, `Comms fixed by ${me.name}`, now) }
      break
    }
    default:
      return { state }
  }
  return { state: tick(next, secret, { now, presentIds }) }
}
