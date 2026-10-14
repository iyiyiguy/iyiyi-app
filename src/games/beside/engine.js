// Host-side rules for Beside Them. The imposter's id is host-only knowledge
// (`secret`) and is never put in the shared state until the round ends.
//
// Stations come in four kinds (settings.stations[i].kind, field added later, so a
// missing kind means a photo station from an older lobby):
//   'auto'  – a GPS waypoint the host's phone placed inside the play area (no photo)
//   'qr'    – a printed / on-screen QR marker; scanning its code is "arriving"
//   'photo' – a real object the host photographed (GPS gate, the original flow)
//   'place' – "walk & place": the host stood there and tapped "Place station here".
//             GPS (wider radius, indoors) + a barometric altitude `alt` so stations on
//             other floors don't count.
//
// Floors: every phone measures its own altitude relative to a reference it takes at the
// start spot during the countdown (players stand next to the host). Place stations were
// recorded relative to the host's setup reference; state.altBase is the host's reading
// (vs that setup reference) at the start spot, so a station's altitude relative to the
// start spot is st.alt - altBase. Any unknown value (no barometer, missed calibration,
// older lobby) turns the floor check off for that comparison.
//
// Eliminations are a hold (kill_start -> kill_done; 1.5 s by default, host setting
// settings.killHoldMs: 0 = instant 'kill', 1000, 1500, 2000), checked by the host the
// whole time, at arm's length (4 m + a small GPS allowance), refused on a weak GPS fix
// and refused through floors when both phones know their altitude.
// Everything about a hold lives in `secret`, so nothing in the shared state hints at it.
import { distanceMeters, shuffled } from '../../lib/multiplayer'
import { PUZZLE_KINDS } from './Puzzles'

export const COUNTDOWN_MS = 6000
export const STATION_RANGE_M = 12
export const REPORT_RANGE_M = 15
export const VOTE_MS = 30000
export const MEETING_COOLDOWN_MS = 20000
export const SABOTAGE_MS = 45000
export const SABOTAGE_COOLDOWN_MS = 90000

// Hold-to-eliminate.
export const KILL_RANGE_M = 4
export const KILL_SLACK_MAX_M = 3 // GPS allowance on top of KILL_RANGE_M
export const KILL_MAX_ACC_M = 10 // either phone's fix worse than this: refused
export const KILL_HOLD_MS = 1500 // default; see holdMsOf
export const KILL_HOLD_OPTIONS = [0, 1000, 1500, 2000]
export const KILL_HOLD_EARLY_MS = 500 // network jitter: kill_done may arrive this much early
export const KILL_HOLD_LATE_MS = 2500 // ...or this much late before the hold expires

/** The round's hold duration (ms). Missing / unknown (older lobbies) -> 1.5 s. 0 = instant. */
export const holdMsOf = (v) => (KILL_HOLD_OPTIONS.includes(v) ? v : KILL_HOLD_MS)
// Latest kill_done still accepted. Older apps always hold 1.5 s, whatever the setting.
const holdLateMs = (hold) => Math.max(hold, KILL_HOLD_MS) + KILL_HOLD_LATE_MS

// ---- floors (barometer) ----
export const FLOOR_GAP_M = 2.5 // this much higher / lower = another floor
export const FLOOR_STEP_M = 3 // typical storey height for floors beyond the first
export const SAME_FLOOR_M = 1.5 // a task needs |Δalt| below this
export const ALT_STALE_MS = 8000
export const finiteAlt = (a) => typeof a === 'number' && Number.isFinite(a)
/** Standard barometric formula: altitude (m) for a pressure in hPa. Only differences matter. */
export const pressureToAltitude = (hPa, p0 = 1013.25) => 44330 * (1 - (hPa / p0) ** (1 / 5.255))
/** Floor index relative to the start floor (0): ±2.5 m is the next floor, then every ~3 m. */
export function floorIndex(alt) {
  if (!finiteAlt(alt)) return null
  const a = Math.abs(alt)
  const n = a < FLOOR_GAP_M ? 0 : Math.max(1, Math.round(a / FLOOR_STEP_M))
  return alt < 0 ? -n : n
}
/** 'Floor 1' is the start floor; below it 'Basement', 'Basement 2'… */
export function floorLabel(alt) {
  const i = floorIndex(alt)
  if (i === null) return null
  if (i >= 0) return `Floor ${i + 1}`
  return i === -1 ? 'Basement' : `Basement ${-i}`
}
/** true unless both altitudes are known and differ by `tol` or more. */
export const sameFloor = (a, b, tol = SAME_FLOOR_M) => !finiteAlt(a) || !finiteAlt(b) || Math.abs(a - b) < tol
/** A place station's altitude relative to the start spot, or null when floors are off. */
export const stationAlt = (st, base) => (finiteAlt(st?.alt) && finiteAlt(base) ? st.alt - base : null)
/** Altitude carried on an action (the sender's own reading), if it is a sane number. */
export const actionAlt = (action) => (finiteAlt(action?.alt) && Math.abs(action.alt) < 1000 ? action.alt : null)

export const slack = (a, b) => Math.min(10, ((a?.acc ?? 10) + (b?.acc ?? 10)) / 2)
export const within = (a, b, r) => !!a && !!b && distanceMeters(a, b) <= r + slack(a, b)

export const killSlack = (a, b) => Math.min(KILL_SLACK_MAX_M, ((a?.acc ?? 6) + (b?.acc ?? 6)) / 4)
export const weakFix = (p) => !!p && Number.isFinite(p.acc) && p.acc > KILL_MAX_ACC_M
/**
 * null when an elimination is allowed between positions a and b, else 'noloc' | 'weak' |
 * 'far' | 'floor'. altA / altB: each phone's altitude vs its start reference (null =
 * unknown: no barometer, so floors are ignored). A whole floor apart (2.5 m) is refused;
 * the looser threshold keeps a phone held high vs one in a pocket from blocking a kill.
 */
export function killBlock(a, b, altA = null, altB = null) {
  if (!a || !b) return 'noloc'
  if (weakFix(a) || weakFix(b)) return 'weak'
  if (distanceMeters(a, b) > KILL_RANGE_M + killSlack(a, b)) return 'far'
  return sameFloor(altA, altB, FLOOR_GAP_M) ? null : 'floor'
}
export const KILL_BLOCK_TEXT = {
  noloc: 'Waiting for locations — try again.',
  weak: 'Signal too weak to eliminate. Try somewhere with a clearer sky.',
  far: 'Too far away — get within arm’s reach.',
  floor: 'They’re on another floor.',
}

// ---- stations ----
export const STATION_KINDS = ['auto', 'qr', 'photo', 'place']
export const stationKind = (st) => (st?.kind === 'auto' || st?.kind === 'qr' || st?.kind === 'place' ? st.kind : 'photo')
export const hasPos = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
// Walk & place stations are mostly indoors where GPS is poor: a wider radius and a bigger
// GPS allowance; the barometer separates floors.
export const PLACE_RANGE_M = 15
export const PLACE_SLACK_MAX_M = 15
export const placeSlack = (a, b) => Math.min(PLACE_SLACK_MAX_M, ((a?.acc ?? 10) + (b?.acc ?? 10)) / 2)
export const withinPlace = (pos, st) => !!pos && hasPos(st) && distanceMeters(pos, st) <= PLACE_RANGE_M + placeSlack(pos, st)
/**
 * Can a player at `pos` (who scanned `code`, if any) use station `st`? `alt`: the player's
 * altitude vs their start reference (null = unknown), `base`: state.altBase.
 */
export function atStation(pos, st, code, alt = null, base = null) {
  if (!st) return false
  const k = stationKind(st)
  if (k === 'qr') return typeof code === 'string' && !!st.code && code === st.code
  if (k === 'place') return withinPlace(pos, st) && sameFloor(alt, stationAlt(st, base))
  return hasPos(st) && within(pos, st, STATION_RANGE_M)
}
/** Why a player can't use a place station: 'far' | 'floor' | null. */
export function placeBlock(pos, st, alt = null, base = null) {
  if (!withinPlace(pos, st)) return 'far'
  return sameFloor(alt, stationAlt(st, base)) ? null : 'floor'
}

export const QR_PREFIX = 'BT1'
export const qrPayload = (st) => `${QR_PREFIX}:${st.id}:${st.code}`
export function parseQrPayload(text) {
  const m = /^BT1:([A-Za-z0-9_-]{1,40}):([A-Za-z0-9]{4,16})$/.exec(String(text || '').trim())
  return m ? { id: m[1], code: m[2] } : null
}

// Fun objects for auto / QR stations (icon = Ionicons name, toy = terminal cartoon).
export const STATION_OBJECTS = [
  { name: 'Pineapple crate', icon: 'nutrition-outline', toy: 'pineapple' },
  { name: 'Satellite dish', icon: 'radio-outline', toy: 'satellite' },
  { name: 'Vending machine', icon: 'fast-food-outline', toy: 'donut' },
  { name: 'Rubber duck pond', icon: 'water-outline', toy: 'duck' },
  { name: 'Cactus greenhouse', icon: 'leaf-outline', toy: 'cactus' },
  { name: 'Cat tower', icon: 'paw-outline', toy: 'cat' },
  { name: 'Pizza oven', icon: 'pizza-outline', toy: 'pizza' },
  { name: 'UFO landing pad', icon: 'planet-outline', toy: 'ufo' },
  { name: 'Donut reactor', icon: 'ellipse-outline', toy: 'donut' },
  { name: 'Robot charger', icon: 'hardware-chip-outline', toy: 'satellite' },
  { name: 'Rocket fuel pump', icon: 'rocket-outline', toy: 'ufo' },
  { name: 'Treasure chest', icon: 'cube-outline', toy: 'pineapple' },
  { name: 'Jukebox', icon: 'musical-notes-outline', toy: 'duck' },
  { name: 'Arcade cabinet', icon: 'game-controller-outline', toy: 'cat' },
  { name: 'Lava lamp', icon: 'bulb-outline', toy: 'cactus' },
  { name: 'Taco truck', icon: 'bus-outline', toy: 'pizza' },
]
export const AUTO_MIN_GAP_M = 25
export const MAX_AUTO_STATIONS = 10

const M_PER_DEG = 111195
const rid = (rnd) => Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0')
function shuffleWith(arr, rnd) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function pointInDisk(c, r, rnd) {
  const d = r * Math.sqrt(rnd())
  const t = rnd() * 2 * Math.PI
  const dy = d * Math.cos(t)
  const dx = d * Math.sin(t)
  return { lat: c.lat + dy / M_PER_DEG, lng: c.lng + dx / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)) }
}

/**
 * Place `count` auto GPS stations inside area {lat, lng, r}: spread out (min gap ~25 m,
 * relaxed step by step when the area is too small), inside the circle, away from the
 * start (area centre and `start`). `candidates`: optional walkable points (paths, streets)
 * to prefer; otherwise uniform random points in the circle.
 */
export function generateAutoStations(area, count, { start, candidates, rnd = Math.random, minGap = AUTO_MIN_GAP_M } = {}) {
  if (!hasPos(area)) return []
  const r = Math.max(10, Number(area.r) || 100)
  const n = Math.max(1, Math.min(MAX_AUTO_STATIONS, Math.round(count) || 6))
  const inner = r - Math.min(6, r * 0.1)
  const avoid = [area, start].filter(hasPos)
  const startGap = Math.min(20, r * 0.35)
  const pool = (candidates || []).filter((p) => hasPos(p) && distanceMeters(area, p) <= inner)
  const usePool = pool.length >= n * 3
  const pts = []
  const ok = (p, gap) => avoid.every((a) => distanceMeters(a, p) >= startGap) && pts.every((q) => distanceMeters(q, p) >= gap)
  for (const fromPool of usePool ? [true, false] : [false]) {
    let gap = minGap
    let tries = 0
    while (pts.length < n && gap >= 5) {
      const p = fromPool ? pool[Math.floor(rnd() * pool.length)] : pointInDisk(area, inner, rnd)
      if (ok(p, gap)) pts.push({ lat: p.lat, lng: p.lng })
      if (++tries > 300) { tries = 0; gap *= 0.85; if (fromPool && gap < minGap * 0.6) break }
    }
  }
  const objs = shuffleWith(STATION_OBJECTS, rnd)
  return pts.map((p, i) => {
    const o = objs[i % objs.length]
    return {
      id: `auto-${i + 1}-${rid(rnd)}`, kind: 'auto', name: o.name, icon: o.icon, toy: o.toy, no: i + 1,
      lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6,
    }
  })
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** QR marker stations (no location needed). */
export function makeQrStations(count, { rnd = Math.random } = {}) {
  const n = Math.max(1, Math.min(MAX_AUTO_STATIONS, Math.round(count) || 6))
  const objs = shuffleWith(STATION_OBJECTS, rnd)
  return Array.from({ length: n }, (_, i) => {
    const o = objs[i % objs.length]
    const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)]).join('')
    return { id: `qr-${i + 1}-${rid(rnd)}`, kind: 'qr', name: o.name, icon: o.icon, toy: o.toy, no: i + 1, code }
  })
}

/**
 * A walk & place station from the host's position + altitude. `taken`: names already
 * used. `alt` null when the host's phone has no barometer (floors off for it).
 */
export function makePlaceStation({ lat, lng, acc = null, alt = null, name, no = 1, photo = false, url = null }, { taken = [], rnd = Math.random } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const clean = String(name || '').trim().slice(0, 40)
  const pickFrom = (list) => list[Math.floor(rnd() * list.length)]
  // A typed name gets a matching cartoon if it is one of ours, else a random one.
  const obj = clean
    ? STATION_OBJECTS.find((o) => o.name.toLowerCase() === clean.toLowerCase()) || pickFrom(STATION_OBJECTS)
    : pickFrom(STATION_OBJECTS.filter((o) => !taken.includes(o.name))) || pickFrom(STATION_OBJECTS)
  return {
    id: `pl-${no}-${rid(rnd)}`, kind: 'place', name: clean || obj.name, icon: obj.icon, toy: obj.toy, no,
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
    acc: Number.isFinite(acc) ? Math.round(acc) : null,
    alt: finiteAlt(alt) ? Math.round(alt * 10) / 10 : null,
    floor: finiteAlt(alt) ? floorIndex(alt) + 1 : null,
    photo: !!photo, url: typeof url === 'string' ? url : null,
  }
}

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
    killHoldMs: holdMsOf(s.killHoldMs),
    altBase: null, // the host sets it during the countdown (see the top of this file)
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

// Crew task progress 0..1. Players who left the game (not in presentIds, when given) drop
// out of the count entirely, as in Among Us: otherwise one disconnect would make the task
// win impossible.
export function crewProgress(state, imposterId, presentIds) {
  let done = 0
  let total = 0
  for (const id of Object.keys(state.tasks)) {
    if (id === imposterId) continue
    if (presentIds && !presentIds.has(id)) continue
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

// Among Us rules: the most-voted player is ejected unless that's a tie or Skip has at
// least as many votes. Not voting counts as nothing.
export function voteOutcome(state, votes) {
  const tally = {}
  let skip = 0
  for (const voter of Object.keys(votes)) {
    if (!state.players[voter]?.alive) continue
    const v = votes[voter]
    if (v === 'skip') skip += 1
    else if (state.players[v]?.alive) tally[v] = (tally[v] || 0) + 1
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  const tie = !!top && ranked.length > 1 && ranked[1][1] === top[1]
  const ejected = top && !tie && top[1] > skip ? top[0] : null
  return { ejected, tally, skip, tie }
}

function resolveMeeting(state, secret, now) {
  const m = state.meeting
  secret.voteLog.push({ meetingNo: state.meetingNo, votes: { ...m.votes } })
  secret.lastKillAt = now // kill cooldown restarts after every meeting
  const { ejected, tally, skip, tie } = voteOutcome(state, m.votes)
  const players = { ...state.players }
  if (ejected) players[ejected] = { ...players[ejected], alive: false, ejected: true }
  return {
    ...state,
    phase: 'playing',
    players,
    meeting: null,
    meetingReadyAt: now + MEETING_COOLDOWN_MS,
    lastMeeting: { at: now, ejected, wasImposter: ejected ? ejected === secret.imposterId : null, tally, skip, voters: Object.keys(m.votes).length },
    feed: feed(state, ejected ? `${players[ejected].name} was voted out` : `No one was voted out${tie ? ' (tie)' : ''}`, now),
  }
}

// Host keeps watching an elimination hold: the target has to stay within reach (and both
// fixes good) the whole time, or the hold is spoiled and kill_done is refused.
function watchKill(state, secret, now, posOf, altOf) {
  const act = secret?.killAct
  if (!act) return
  if (state.phase !== 'playing' || now - act.startedAt > holdLateMs(holdMsOf(state.killHoldMs)) || !state.players[act.target]?.alive) {
    secret.killAct = null
    return
  }
  if (posOf && !act.broken) {
    const why = killBlock(posOf(secret.imposterId), posOf(act.target), altOf?.(secret.imposterId) ?? null, altOf?.(act.target) ?? null)
    if (why) act.broken = why
  }
}

export function tick(state, secret, { now, presentIds, posOf, altOf }) {
  if (state.phase === 'ended') return state
  watchKill(state, secret, now, posOf, altOf)
  if (state.phase === 'countdown') return now >= state.startsAt ? { ...state, phase: 'playing' } : state
  let next = state
  if (next.sabotage && now >= next.sabotage.until) next = { ...next, sabotage: null, feed: feed(next, 'Comms came back online', now) }
  if (next.phase === 'playing') {
    const progress = crewProgress(next, secret?.imposterId, presentIds)
    if (progress !== next.progress) next = { ...next, progress }
  }
  if (next.phase === 'meeting' && next.meeting) {
    const aliveIds = Object.keys(next.players).filter((id) => next.players[id].alive && presentIds.has(id))
    const allVoted = now >= next.meeting.discussUntil && aliveIds.every((id) => next.meeting.votes[id] !== undefined)
    if (allVoted || now >= next.meeting.endsAt) next = resolveMeeting(next, secret, now)
  }
  return checkWin(next, secret, presentIds)
}

// The elimination itself, after the hold (or straight away in instant mode).
function eliminate(state, secret, from, target, now, posOf, myAlt, altOf, presentIds, farText = 'They moved out of reach.') {
  const victim = state.players[target]
  if (!victim?.alive) return { state }
  if (now < secret.lastKillAt + state.killCooldownMs) return { state, reply: { type: 'covert', data: { text: 'Not yet.' } } }
  const b = posOf(target)
  const why = killBlock(posOf(from), b, myAlt, altOf(target))
  if (why) return { state, reply: { type: 'covert', data: { text: why === 'far' ? farText : KILL_BLOCK_TEXT[why] } } }
  secret.lastKillAt = now
  const next = {
    ...state,
    players: { ...state.players, [target]: { ...victim, alive: false } },
    bodies: { ...state.bodies, [target]: { lat: b.lat, lng: b.lng, at: now, reported: false } },
  }
  return { state: checkWin(next, secret, presentIds), reply: { type: 'kill_ok', data: { readyAt: now + state.killCooldownMs, target } } }
}

// Returns { state, reply? }. ctx.altOf(id): a player's last reported altitude (vs their
// start reference) or null; an action's own `alt` field wins for its sender.
export function applyAction(state, secret, action, from, { now, posOf, stations, presentIds, altOf: altOfCtx }) {
  const me = state.players[from]
  if (!me || !action || state.phase === 'ended' || state.phase === 'countdown') return { state }
  const notice = (text) => ({ state, reply: { type: 'notice', data: { text } } })
  // Imposter-only feedback goes out as 'covert' so the phone shows it inside the covert
  // sheet, never as a banner someone could read over their shoulder.
  const covert = (text) => ({ state, reply: { type: 'covert', data: { text } } })
  const myAlt = actionAlt(action) ?? altOfCtx?.(from) ?? null
  const altOf = (id) => (id === from ? myAlt : altOfCtx?.(id) ?? null)
  const holdMs = holdMsOf(state.killHoldMs)
  let next = state
  switch (action.type) {
    case 'task': {
      const list = state.tasks[from]
      const i = Number(action.index)
      if (state.phase !== 'playing' || !list?.[i] || list[i].done) return { state }
      const st = stations.find((x) => x.id === list[i].stationId)
      if (!st) return { state }
      if (!atStation(posOf(from), st, action.code, myAlt, state.altBase)) {
        const k = stationKind(st)
        if (k === 'qr') return notice('Scan this station’s code to finish the task.')
        if (k === 'place' && placeBlock(posOf(from), st, myAlt, state.altBase) === 'floor') {
          return notice(`${st.name} is on ${floorLabel(stationAlt(st, state.altBase))}. Go there to finish the task.`)
        }
        return notice('You need to be at the station to finish this task.')
      }
      next = {
        ...state,
        tasks: { ...state.tasks, [from]: list.map((t, j) => (j === i ? { ...t, done: true } : t)) },
        players: { ...state.players, [from]: { ...me, tasksDone: me.tasksDone + 1 } },
      }
      next.progress = crewProgress(next, secret.imposterId, presentIds)
      break
    }
    // Instant mode (killHoldMs 0) sends 'kill'. Otherwise it's a hold; older app versions
    // that still send an instant 'kill' are told to update.
    case 'kill': {
      if (from !== secret.imposterId) return { state }
      if (holdMs !== 0) return notice(`Update the app to eliminate (hold on the player for ${holdMs / 1000} s).`)
      if (state.phase !== 'playing' || !me.alive) return { state }
      const victim = state.players[action.target]
      if (!victim?.alive || action.target === from || (presentIds && !presentIds.has(action.target))) return covert('They can’t be eliminated.')
      const readyAt = secret.lastKillAt + state.killCooldownMs
      if (now < readyAt) return covert(`Not yet — ${Math.ceil((readyAt - now) / 1000)} s.`)
      secret.killAct = null
      return eliminate(state, secret, from, action.target, now, posOf, myAlt, altOf, presentIds, KILL_BLOCK_TEXT.far)
    }
    case 'kill_start': {
      if (state.phase !== 'playing' || from !== secret.imposterId || !me.alive) return { state }
      const target = action.target
      const victim = state.players[target]
      if (!victim?.alive || target === from || (presentIds && !presentIds.has(target))) return covert('They can’t be eliminated.')
      const readyAt = secret.lastKillAt + state.killCooldownMs
      if (now < readyAt) return covert(`Not yet — ${Math.ceil((readyAt - now) / 1000)} s.`)
      const why = killBlock(posOf(from), posOf(target), myAlt, altOf(target))
      if (why) { secret.killAct = null; return covert(KILL_BLOCK_TEXT[why]) }
      // A new press restarts the hold (a lost kill_cancel must not let an old start count).
      secret.killAct = { target, startedAt: now, broken: null }
      return { state }
    }
    case 'kill_cancel': {
      if (from === secret.imposterId && (!action.target || secret.killAct?.target === action.target)) secret.killAct = null
      return { state }
    }
    case 'kill_done': {
      if (state.phase !== 'playing' || from !== secret.imposterId || !me.alive) return { state }
      const act = secret.killAct
      secret.killAct = null
      if (!act || act.target !== action.target) return covert('Hold interrupted — hold again.')
      const elapsed = now - act.startedAt
      if (elapsed < holdMs - KILL_HOLD_EARLY_MS || elapsed > holdLateMs(holdMs)) return covert('That didn’t count — hold until the ring fills.')
      if (act.broken) return covert(act.broken === 'far' ? 'They moved out of reach.' : KILL_BLOCK_TEXT[act.broken])
      return eliminate(state, secret, from, act.target, now, posOf, myAlt, altOf, presentIds)
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
      if (now < secret.sabotageReadyAt) return covert(`Sabotage ready in ${Math.ceil((secret.sabotageReadyAt - now) / 1000)}s.`)
      secret.sabotageReadyAt = now + SABOTAGE_COOLDOWN_MS
      next = { ...state, sabotage: { until: now + SABOTAGE_MS }, feed: feed(state, 'Comms sabotaged!', now) }
      break
    }
    case 'fix': {
      if (state.phase !== 'playing' || !state.sabotage || !me.alive) return { state }
      const pos = posOf(from)
      if (!stations.some((st) => atStation(pos, st, action.code, myAlt, state.altBase))) return notice('Go to any station to fix comms.')
      next = { ...state, sabotage: null, feed: feed(state, `Comms fixed by ${me.name}`, now) }
      break
    }
    default:
      return { state }
  }
  return { state: tick(next, secret, { now, presentIds, posOf, altOf: altOfCtx }) }
}
