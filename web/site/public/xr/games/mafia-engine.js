// Mafia rules, copied from the iYiYi app (src/games/MafiaGame.js) so glasses and phones referee identically.
const ROLE_EN = { town: 'Townsperson', mafia: 'Mafia', doctor: 'Doctor', detective: 'Detective' }
const ROLES = ROLE_EN
const translate = (_m, k) => ROLE_EN[String(k).replace('role_', '')] || 'Townsperson'
const M = null
// ─── Timing ───────────────────────────────────────────────────────────────────
const COUNTDOWN_MS = 5000
const NIGHT_MS = 30000
const DISCUSS_MS = 60000
const VOTE_MS = 30000
const NIGHT_GRACE_MS = 3000 // once every night role has acted
const RECOVER_MS = 8000 // host migration: how long to wait for role claims

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ─── Engine (pure; `sec` is the host-only secret, mutated in place) ───────────
function assignRoles(roster, shuffle = shuffled) {
  const ids = shuffle(roster.map((p) => p.id))
  const n = ids.length
  const mafiaCount = n >= 10 ? 3 : n >= 7 ? 2 : 1
  const roles = {}
  let i = 0
  for (let m = 0; m < mafiaCount && i < n; m++) roles[ids[i++]] = 'mafia'
  if (n >= 5) roles[ids[i++]] = 'doctor'
  if (n >= 6) roles[ids[i++]] = 'detective'
  while (i < n) roles[ids[i++]] = 'town'
  return roles
}

function initialState(roster, info, now) {
  const players = {}
  for (const p of roster) players[p.id] = { name: p.username, alive: true, eliminated: false }
  return {
    game: 'mafia',
    round: info.round,
    phase: 'countdown',
    startsAt: now + COUNTDOWN_MS,
    dayNumber: 0,
    players,
    // Night actions live in the host's secret, never in the shared state.
    nightResult: null, // { killed: id | null, saved: bool }
    investigateResult: null, // unused: results go privately to the detective
    votes: {},
    voteResult: null, // { eliminated: id | null }
    discussUntil: 0,
    voteUntil: 0,
    nightUntil: 0,
    feed: [],
    winner: null,
  }
}

function newSecret(round, roles) {
  return { round, roles, mafiaTarget: null, doctorTarget: null, detectiveTarget: null, mafiaVotes: {}, lastDoctorTarget: null }
}

const mafiaTeam = (roles) => Object.keys(roles).filter((id) => roles[id] === 'mafia')
const roleMessage = (sec, id) => {
  const role = sec.roles[id] || 'town'
  return role === 'mafia' ? { round: sec.round, role, team: mafiaTeam(sec.roles) } : { round: sec.round, role }
}

function checkWin(players, roles) {
  const mafia = Object.keys(players).filter((id) => players[id].alive && roles[id] === 'mafia').length
  const town = Object.keys(players).filter((id) => players[id].alive && roles[id] !== 'mafia').length
  if (mafia === 0) return 'town'
  if (mafia >= town) return 'mafia'
  return null
}

const endState = (s, players, sec, extra) => ({ ...s, ...extra, phase: 'ended', players, winner: checkWin(players, sec.roles), roles: { ...sec.roles } })

function startNight(s, sec, t, extra = {}) {
  sec.mafiaTarget = null
  sec.doctorTarget = null
  sec.detectiveTarget = null
  sec.mafiaVotes = {}
  return { ...s, ...extra, phase: 'night', nightUntil: t + NIGHT_MS, nightResult: null, investigateResult: null, votes: {} }
}

// Mafia's choice: most-voted target among the living Mafia; a split is settled at random.
function mafiaChoice(s, sec, shuffle = shuffled) {
  const tally = {}
  for (const m of Object.keys(sec.mafiaVotes)) {
    const v = sec.mafiaVotes[m]
    if (!s.players[m]?.alive || !s.players[v]?.alive) continue
    tally[v] = (tally[v] || 0) + 1
  }
  const best = Math.max(0, ...Object.values(tally))
  const top = Object.keys(tally).filter((id) => tally[id] === best)
  return top.length ? shuffle(top)[0] : null
}

// Night action from `from`. Returns a list of private replies [{ to, type, data }].
function nightAction(s, sec, action, from) {
  const replies = []
  const say = (to, text, k, v) => replies.push({ to, type: 'notice', data: { text, k, v } })
  const role = sec.roles[from]
  const target = action?.target
  if (s.phase !== 'night' || !s.players[from]?.alive) return replies
  const victim = s.players[target]
  if (!victim?.alive) return replies
  if (action.type === 'mafia_target' && role === 'mafia') {
    if (sec.roles[target] === 'mafia') { say(from, 'That’s one of your own.', 'n_own'); return replies }
    sec.mafiaVotes[from] = target
    sec.mafiaTarget = mafiaChoice(s, sec, (a) => a) // provisional (deterministic) until dawn
    say(from, `Target locked: ${victim.name}`, 'n_target_locked', { name: victim.name })
    for (const m of mafiaTeam(sec.roles)) {
      if (m !== from && s.players[m]?.alive) say(m, `${s.players[from].name} wants ${victim.name}.`, 'n_wants', { who: s.players[from].name, name: victim.name })
    }
  } else if (action.type === 'doctor_save' && role === 'doctor') {
    if (target === sec.lastDoctorTarget) { say(from, `You protected ${victim.name} last night — choose someone else.`, 'n_protected_last', { name: victim.name }); return replies }
    sec.doctorTarget = target
    say(from, `Protecting ${victim.name} tonight.`, 'n_protecting', { name: victim.name })
  } else if (action.type === 'detective_investigate' && role === 'detective') {
    if (target === from) return replies
    if (sec.detectiveTarget) { say(from, 'You’ve already investigated someone tonight.', 'n_already_investigated'); return replies }
    sec.detectiveTarget = target
    replies.push({ to: from, type: 'investigate', data: { target, name: victim.name, isMafia: sec.roles[target] === 'mafia', day: s.dayNumber } })
  }
  return replies
}

// True once every living, present night role has acted.
function nightComplete(s, sec, presentIds) {
  const live = Object.keys(s.players).filter((id) => s.players[id].alive && presentIds.has(id))
  return live.every((id) => {
    const r = sec.roles[id]
    if (r === 'mafia') return !!sec.mafiaVotes[id]
    if (r === 'doctor') return !!sec.doctorTarget
    if (r === 'detective') return !!sec.detectiveTarget
    return true
  })
}

function resolveNight(s, sec, t, shuffle = shuffled) {
  const target = mafiaChoice(s, sec, shuffle)
  const saved = !!target && sec.doctorTarget === target
  const killed = target && !saved ? target : null
  sec.lastDoctorTarget = sec.doctorTarget
  const players = { ...s.players }
  const feed = [...s.feed]
  if (killed) {
    players[killed] = { ...players[killed], alive: false, eliminated: true }
    feed.unshift({ id: `kill-${s.dayNumber}`, text: `Day ${s.dayNumber}: ${players[killed].name} was found eliminated.`, k: 'f_killed', v: { day: s.dayNumber, name: players[killed].name } })
  } else {
    feed.unshift({ id: `safe-${s.dayNumber}`, text: `Day ${s.dayNumber}: No one was eliminated last night.`, k: 'f_safe', v: { day: s.dayNumber } })
  }
  const nightResult = { killed, saved }
  if (checkWin(players, sec.roles)) return endState(s, players, sec, { feed: feed.slice(0, 20), nightResult })
  return {
    ...s, phase: 'discuss', players, dayNumber: s.dayNumber,
    nightResult, discussUntil: t + DISCUSS_MS, votes: {}, voteResult: null,
    feed: feed.slice(0, 20),
  }
}

// Validate and record a day vote. Returns the new state or null.
function castVote(s, action, from) {
  if (s.phase !== 'vote' || !s.players[from]?.alive || s.votes[from] !== undefined) return null
  const target = action?.target
  if (target !== 'skip' && !s.players[target]?.alive) return null
  return { ...s, votes: { ...s.votes, [from]: target } }
}

const allVoted = (s, presentIds) => Object.keys(s.players)
  .filter((id) => s.players[id].alive && presentIds.has(id))
  .every((id) => s.votes[id] !== undefined)

// Plurality: the most-voted player is out unless that's tied or Skip has as many votes.
function resolveVote(s, sec, t) {
  const tally = {}
  let skip = 0
  for (const voter of Object.keys(s.votes)) {
    if (!s.players[voter]?.alive) continue
    const v = s.votes[voter]
    if (v === 'skip') skip += 1
    else if (s.players[v]?.alive) tally[v] = (tally[v] || 0) + 1
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const tie = !!top && sorted.length > 1 && sorted[1][1] === top[1]
  const eliminated = top && !tie && top[1] > skip ? top[0] : null
  const players = { ...s.players }
  const feed = [...s.feed]
  if (eliminated) {
    players[eliminated] = { ...players[eliminated], alive: false, eliminated: true }
    feed.unshift({ id: `vote-${s.dayNumber}`, text: `${players[eliminated].name} was voted out. They were ${translate(M, `role_${ROLES[sec.roles[eliminated]] ? sec.roles[eliminated] : 'town'}`, null, 'en')}.`, k: 'f_voted', v: { name: players[eliminated].name, role: ROLES[sec.roles[eliminated]] ? sec.roles[eliminated] : 'town' } })
  } else {
    feed.unshift({ id: `novote-${s.dayNumber}`, text: `No one was voted out${tie ? ' (tie)' : top && skip >= top[1] ? ' (skipped)' : ''}.`, k: tie ? 'f_novote_tie' : top && skip >= top[1] ? 'f_novote_skip' : 'f_novote' })
  }
  const voteResult = { eliminated, tally, skip }
  if (checkWin(players, sec.roles)) return endState(s, players, sec, { voteResult, feed: feed.slice(0, 20) })
  return startNight({ ...s, players, voteResult, feed: feed.slice(0, 20) }, sec, t, { dayNumber: s.dayNumber + 1 })
}

// Host migration: rebuild the secret from role claims ({ id: { role, team } }).
// Returns { sec } when every living present player has claimed, else null.
function recoverSecret(s, claims, presentIds) {
  const living = Object.keys(s.players).filter((id) => s.players[id].alive && presentIds.has(id))
  if (!living.every((id) => claims[id])) return null
  const roles = {}
  for (const id of Object.keys(s.players)) roles[id] = claims[id]?.role || 'town'
  // Mafia know their team, so an absent Mafia player is still known.
  for (const c of Object.values(claims)) if (c.role === 'mafia') for (const m of c.team || []) if (s.players[m]) roles[m] = 'mafia'
  return newSecret(s.round, roles)
}

// Pure rules, exported for headless tests.
export const E = {
  assignRoles, initialState, newSecret, roleMessage, checkWin, startNight, nightAction, nightComplete,
  resolveNight, castVote, allVoted, resolveVote, recoverSecret, mafiaChoice,
}

export const T = { COUNTDOWN_MS, NIGHT_MS, DISCUSS_MS, VOTE_MS, NIGHT_GRACE_MS, RECOVER_MS }
