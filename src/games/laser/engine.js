// Host-side rules for Laser Tag (Free-for-all, Team Deathmatch, Search & Destroy).
// Pure functions: (state, input) → next state. Only the host runs these; the
// result is broadcast as the authoritative state.
import { distanceMeters, shuffled } from '../../lib/multiplayer'

export const MAX_HP = 100
export const RESPAWN_MS = 8000
export const SPAWN_PROTECT_MS = 2000
export const VISION_MAX_M = 55 // 30 m effective + GPS slack
export const COUNTDOWN_MS = 5000
export const ROUND_BREAK_MS = 9000
// Plant / defuse are a tap mini-game on the player's phone: hit TAPS_NEEDED targets
// within the time limit. The host only accepts a completion from the player who started
// it, still alive and inside the zone, within the window.
export const PLANT_MS = 5000
export const DEFUSE_MS = 7000
export const PLANT_TAPS = 6
export const DEFUSE_TAPS = 7
export const MIN_ACT_MS = 1200 // nobody can legitimately finish faster
export const ACT_GRACE_MS = 2500 // network slack after the mini-game's time limit
export const BOMB_MS = 45000
export const SITE_RADIUS_M = 12
export const PICKUP_RANGE_M = 5
export const MAX_RANGE_M = 150
// Grenades: thrown along the compass heading up to GRENADE_MAX_THROW_M, explode after the fuse
// on the thrower's phone, and damage every enemy within GRENADE_RADIUS_M of where they land
// (full damage in the middle, less towards the edge).
export const GRENADE_MAX_THROW_M = 35
export const GRENADE_MIN_THROW_M = 5
export const GRENADE_RADIUS_M = 7
export const GRENADE_MAX_DAMAGE = 90
export const GRENADE_MIN_DAMAGE = 35
export const GRENADE_COOLDOWN_MS = 2500

// Extra room for GPS error when checking "inside a radius".
export const gpsSlack = (acc) => Math.min(8, Math.max(2, (acc ?? 10) / 2))
export const insideRadius = (pos, center, r) => !!pos && !!center && distanceMeters(pos, center) <= r + gpsSlack(pos.acc)

const other = (t) => (t === 'A' ? 'B' : 'A')

export function balanceTeams(ids, wanted = {}) {
  const teams = {}
  const count = { A: 0, B: 0 }
  for (const id of ids) {
    if (wanted[id] === 'A' || wanted[id] === 'B') { teams[id] = wanted[id]; count[wanted[id]] += 1 }
  }
  for (const id of shuffled(ids.filter((i) => !teams[i]))) {
    const t = count.A <= count.B ? 'A' : 'B'
    teams[id] = t
    count[t] += 1
  }
  return teams
}

function freshPlayer(name, team) {
  return { name, team, hp: MAX_HP, alive: true, respawnAt: null, protectedUntil: 0, kills: 0, deaths: 0, hits: 0, headshots: 0, score: 0, plants: 0, defuses: 0 }
}

export function initialState(roster, info, now) {
  const s = info.settings || {}
  const mode = s.mode || 'ffa'
  const ids = roster.map((p) => p.id)
  const teams = mode === 'ffa' ? {} : balanceTeams(ids, info.teams || {})
  const players = {}
  for (const p of roster) players[p.id] = freshPlayer(p.username, teams[p.id] || null)
  const startsAt = now + COUNTDOWN_MS
  const base = {
    game: 'lasertag',
    mode,
    endless: mode === 'ffa' && !!s.endless,
    round: info.round,
    phase: 'countdown',
    startedAt: now,
    startsAt,
    endsAt: startsAt + (s.roundMinutes || 10) * 60000,
    players,
    feed: [],
    teamScore: { A: 0, B: 0 },
    winners: [],
    winnerTeam: null,
  }
  if (mode !== 'snd') return base
  const roundMs = (s.sndRoundMinutes || 3) * 60000
  const snd = {
    roundNo: 1,
    totalRounds: s.sndRounds || 5,
    roundMs,
    sides: { A: 'attack', B: 'defend' },
    wins: { A: 0, B: 0 },
    sites: (s.sites || []).map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, r: x.r || SITE_RADIUS_M })),
    bomb: null,
    act: null,
    lastResult: null,
    history: [],
  }
  const st = { ...base, endsAt: startsAt + roundMs, snd }
  return { ...st, snd: { ...snd, bomb: newBomb(st, new Set(ids)) } }
}

function attackersOf(state) {
  const atk = Object.keys(state.snd.sides).find((t) => state.snd.sides[t] === 'attack')
  return Object.keys(state.players).filter((id) => state.players[id].team === atk)
}

function newBomb(state, presentIds) {
  const atk = attackersOf(state).filter((id) => presentIds.has(id) && state.players[id].alive)
  const carrier = shuffled(atk)[0] || null
  return { state: carrier ? 'carried' : 'none', carrier, lat: null, lng: null, site: null, plantedAt: null, explodesAt: null, planter: null }
}

const pushFeed = (state, text, now) => [{ id: `${now}-${Math.random().toString(36).slice(2, 6)}`, text }, ...state.feed].slice(0, 6)

// Endless (public arena) only: players join and leave at any time. Newcomers drop in
// with spawn protection; anyone gone past the presence grace period is removed.
// Returns the same object when nothing changed.
export const ARENA_MAX_TRACKED = 40

export function syncEndlessPlayers(state, roster, presentIds, now) {
  if (!state?.endless) return state
  let players = state.players
  let feed = state.feed
  const copy = () => { if (players === state.players) players = { ...players } }
  for (const p of roster || []) {
    if (!p?.id || players[p.id]) continue
    if (Object.keys(players).length >= ARENA_MAX_TRACKED) break
    copy()
    players[p.id] = { ...freshPlayer(p.username || 'Player', null), protectedUntil: now + SPAWN_PROTECT_MS }
    feed = pushFeed({ feed }, `${p.username || 'Someone'} joined the arena`, now)
  }
  for (const id of Object.keys(players)) {
    if (presentIds.has(id)) continue
    copy()
    delete players[id]
  }
  if (players === state.players) return state
  return { ...state, players, feed }
}

// ---- tick --------------------------------------------------------------------

export function tick(state, { now, presentIds, posOf }) {
  if (state.phase === 'ended') return state
  if (state.phase === 'countdown') {
    return now >= state.startsAt ? { ...state, phase: 'playing' } : state
  }
  if (state.mode !== 'snd') return tickDeathmatch(state, now, presentIds)
  if (state.phase === 'roundEnd') return now >= state.startsAt ? nextSndRound(state, now, presentIds) : state
  return tickSnd(state, now, presentIds, posOf)
}

function tickDeathmatch(state, now, presentIds) {
  let players = state.players
  for (const id of Object.keys(players)) {
    const p = players[id]
    if (p.respawnAt && now >= p.respawnAt) {
      if (players === state.players) players = { ...players }
      players[id] = { ...p, hp: MAX_HP, alive: true, respawnAt: null, protectedUntil: now + SPAWN_PROTECT_MS }
    }
  }
  let next = players === state.players ? state : { ...state, players }
  if (next.endless) return next // the public arena never ends
  const present = Object.keys(next.players).filter((id) => presentIds.has(id))
  const teamsPresent = new Set(present.map((id) => next.players[id].team))
  const tooFew = present.length < 2 || (next.mode === 'tdm' && teamsPresent.size < 2)
  if (now >= next.endsAt || tooFew) next = finishDeathmatch(next)
  return next
}

function finishDeathmatch(state) {
  if (state.mode === 'tdm') {
    const { A, B } = state.teamScore
    const winnerTeam = A === B ? null : A > B ? 'A' : 'B'
    const winners = winnerTeam ? Object.keys(state.players).filter((id) => state.players[id].team === winnerTeam) : []
    return withMvp({ ...state, phase: 'ended', winnerTeam, winners })
  }
  const ranked = Object.entries(state.players).sort((a, b) => b[1].score - a[1].score)
  const top = ranked[0]?.[1]?.score ?? 0
  return withMvp({ ...state, phase: 'ended', winners: ranked.filter(([, p]) => p.score === top && top > 0).map(([id]) => id) })
}

function withMvp(state) {
  const ranked = Object.entries(state.players).sort((a, b) => (b[1].score - a[1].score) || (b[1].kills - a[1].kills))
  return { ...state, mvp: ranked[0] && ranked[0][1].score > 0 ? ranked[0][0] : null }
}

function tickSnd(state, now, presentIds, posOf) {
  const snd = state.snd
  let next = state
  // Plant / defuse in progress (the mini-game runs on the player's phone).
  if (snd.act) {
    const a = snd.act
    const p = state.players[a.by]
    const pos = posOf(a.by)
    const center = actCenter(snd, a)
    const limit = (a.kind === 'plant' ? PLANT_MS : DEFUSE_MS) + ACT_GRACE_MS
    const ok = p?.alive && presentIds.has(a.by) && center && insideRadius(pos, center, center.r || SITE_RADIUS_M) && now - a.startedAt <= limit
    if (!ok) next = { ...next, snd: { ...snd, act: null } }
  }
  const s2 = next.snd
  if (s2.bomb?.state === 'planted' && now >= s2.bomb.explodesAt) {
    next = { ...next, snd: { ...s2, bomb: { ...s2.bomb, state: 'exploded' } }, feed: pushFeed(next, '💥 The bomb exploded', now) }
    return endSndRound(next, attackingTeam(next), 'detonated', now)
  }
  const aliveOn = (team) => Object.keys(next.players).filter((id) => next.players[id].team === team && next.players[id].alive && presentIds.has(id)).length
  const atk = attackingTeam(next)
  const def = defendingTeam(next)
  if (aliveOn(def) === 0) return endSndRound(next, atk, 'eliminated', now)
  if (aliveOn(atk) === 0 && s2.bomb?.state !== 'planted') return endSndRound(next, def, 'eliminated', now)
  if (now >= next.endsAt && s2.bomb?.state !== 'planted') return endSndRound(next, def, 'time', now)
  // Carrier left the game: drop the bomb where they were last seen, or hand it
  // to another attacker if we don't know where that was.
  if (s2.bomb?.state === 'carried' && !presentIds.has(s2.bomb.carrier)) {
    const pos = posOf(s2.bomb.carrier)
    const bomb = pos ? dropBomb(next.snd.bomb, pos) : newBomb(next, presentIds)
    next = { ...next, snd: { ...next.snd, bomb } }
  }
  return next
}

function actCenter(snd, a) {
  if (a.kind === 'plant') return snd.sites.find((x) => x.id === a.site) || null
  return snd.bomb?.lat != null ? { lat: snd.bomb.lat, lng: snd.bomb.lng, r: snd.bomb.r } : null
}

function completePlant(state, from, now, pos) {
  const snd = state.snd
  const a = snd.act
  const p = state.players[from]
  const site = snd.sites.find((x) => x.id === a.site)
  const bomb = { ...snd.bomb, state: 'planted', carrier: null, lat: pos.lat, lng: pos.lng, r: site?.r || SITE_RADIUS_M, site: a.site, plantedAt: now, explodesAt: now + BOMB_MS, planter: from }
  const players = { ...state.players, [from]: { ...p, plants: (p.plants || 0) + 1, score: p.score + 150 } }
  return { ...state, players, snd: { ...snd, act: null, bomb }, feed: pushFeed(state, `💣 Bomb planted at site ${a.site} by ${p.name}`, now) }
}

function completeDefuse(state, from, now) {
  const snd = state.snd
  const p = state.players[from]
  const players = { ...state.players, [from]: { ...p, defuses: (p.defuses || 0) + 1, score: p.score + 200 } }
  const next = { ...state, players, snd: { ...snd, act: null, bomb: { ...snd.bomb, state: 'defused' } }, feed: pushFeed(state, `✅ ${p.name} defused the bomb`, now) }
  return endSndRound(next, defendingTeam(next), 'defused', now)
}

export const attackingTeam = (state) => Object.keys(state.snd.sides).find((t) => state.snd.sides[t] === 'attack')
export const defendingTeam = (state) => other(attackingTeam(state))

function dropBomb(bomb, pos) {
  if (!pos) return { ...bomb, state: 'dropped', carrier: null }
  return { ...bomb, state: 'dropped', carrier: null, lat: pos.lat, lng: pos.lng }
}

function endSndRound(state, winner, reason, now) {
  const snd = state.snd
  const wins = { ...snd.wins, [winner]: snd.wins[winner] + 1 }
  const needed = Math.ceil(snd.totalRounds / 2)
  const history = [...snd.history, { roundNo: snd.roundNo, winner, reason, sides: snd.sides }]
  const done = wins[winner] >= needed || snd.roundNo >= snd.totalRounds
  const next = { ...state, snd: { ...snd, wins, act: null, lastResult: { winner, reason, roundNo: snd.roundNo }, history } }
  if (done) {
    const winnerTeam = wins.A === wins.B ? null : wins.A > wins.B ? 'A' : 'B'
    const winners = winnerTeam ? Object.keys(state.players).filter((id) => state.players[id].team === winnerTeam) : []
    return withMvp({ ...next, phase: 'ended', winnerTeam, winners })
  }
  return { ...next, phase: 'roundEnd', startsAt: now + ROUND_BREAK_MS }
}

function nextSndRound(state, now, presentIds) {
  const snd = state.snd
  const swap = snd.roundNo === Math.floor(snd.totalRounds / 2)
  const sides = swap ? { A: snd.sides.B, B: snd.sides.A } : snd.sides
  const players = {}
  for (const id of Object.keys(state.players)) players[id] = { ...state.players[id], hp: MAX_HP, alive: true, respawnAt: null }
  const startsAt = now + COUNTDOWN_MS
  const next = {
    ...state,
    phase: 'countdown',
    startsAt,
    endsAt: startsAt + snd.roundMs,
    players,
    snd: { ...snd, roundNo: snd.roundNo + 1, sides, act: null, swapped: swap },
    feed: swap ? pushFeed(state, '🔄 Half time — sides swapped', now) : state.feed,
  }
  return { ...next, snd: { ...next.snd, bomb: newBomb(next, presentIds) } }
}

// ---- actions -------------------------------------------------------------------

// Returns { state, reply? } where reply = { to, type, data } feedback for the sender.
export function applyAction(state, action, from, { now, posOf }) {
  if (state.phase !== 'playing' || !action) return { state }
  const me = state.players[from]
  if (!me) return { state }
  switch (action.type) {
    case 'hit': return applyHit(state, action, from, now, posOf)
    case 'bystander': return applyBystander(state, action, from, now)
    case 'grenade': return applyGrenade(state, action, from, now, posOf)
    case 'plant_start': {
      if (state.mode !== 'snd' || !me.alive || state.snd.act) return { state }
      const b = state.snd.bomb
      if (b?.state !== 'carried' || b.carrier !== from) return { state, reply: notice('You don’t have the bomb.') }
      const site = state.snd.sites.find((x) => x.id === action.site)
      if (!site || !insideRadius(posOf(from), site, site.r)) return { state, reply: notice('Get inside a bomb site to plant.') }
      return { state: { ...state, snd: { ...state.snd, act: { kind: 'plant', by: from, startedAt: now, site: site.id } } } }
    }
    case 'defuse_start': {
      if (state.mode !== 'snd' || !me.alive || state.snd.act) return { state }
      const b = state.snd.bomb
      if (b?.state !== 'planted' || me.team !== defendingTeam(state)) return { state }
      if (!insideRadius(posOf(from), b, b.r || SITE_RADIUS_M)) return { state, reply: notice('Get closer to the bomb to defuse.') }
      return { state: { ...state, snd: { ...state.snd, act: { kind: 'defuse', by: from, startedAt: now } } } }
    }
    case 'plant_done':
    case 'defuse_done': {
      if (state.mode !== 'snd' || !me.alive) return { state }
      const a = state.snd.act
      const kind = action.type === 'plant_done' ? 'plant' : 'defuse'
      if (!a || a.by !== from || a.kind !== kind) return { state, reply: notice('Too slow — try again.') }
      const elapsed = now - a.startedAt
      const limit = (kind === 'plant' ? PLANT_MS : DEFUSE_MS) + ACT_GRACE_MS
      if (elapsed < MIN_ACT_MS || elapsed > limit) return { state: { ...state, snd: { ...state.snd, act: null } }, reply: notice('That didn’t count — try again.') }
      const pos = posOf(from)
      const center = actCenter(state.snd, a)
      if (!center || !insideRadius(pos, center, center.r || SITE_RADIUS_M)) {
        return { state: { ...state, snd: { ...state.snd, act: null } }, reply: notice(kind === 'plant' ? 'Stay inside the site to plant.' : 'Stay at the bomb to defuse.') }
      }
      if (kind === 'plant') {
        if (state.snd.bomb?.state !== 'carried' || state.snd.bomb.carrier !== from) return { state }
        return { state: completePlant(state, from, now, pos) }
      }
      if (state.snd.bomb?.state !== 'planted' || me.team !== defendingTeam(state)) return { state }
      return { state: completeDefuse(state, from, now) }
    }
    case 'act_cancel':
      if (state.mode === 'snd' && state.snd.act?.by === from) return { state: { ...state, snd: { ...state.snd, act: null } } }
      return { state }
    case 'pickup': {
      if (state.mode !== 'snd' || !me.alive || me.team !== attackingTeam(state)) return { state }
      const b = state.snd.bomb
      if (b?.state !== 'dropped') return { state }
      const pos = posOf(from)
      if (!pos || b.lat == null || distanceMeters(pos, b) > PICKUP_RANGE_M + gpsSlack(pos.acc)) return { state, reply: notice('Get closer to the bomb to pick it up.') }
      return { state: { ...state, snd: { ...state.snd, bomb: { ...b, state: 'carried', carrier: from } }, feed: pushFeed(state, `${me.name} picked up the bomb`, now) } }
    }
    default:
      return { state }
  }
}

const notice = (text) => ({ type: 'notice', data: { text } })

// Bystander tags: an opted-in iYiYi user who is NOT in this match was hit on camera.
// Fewer points than a tag-out, at most one per bystander per shooter per minute.
export const BYSTANDER_POINTS = 25
export const BYSTANDER_COOLDOWN_MS = 60000
function applyBystander(state, action, from, now) {
  const me = state.players[from]
  const userId = typeof action.userId === 'string' ? action.userId.slice(0, 64) : ''
  if (!me?.alive || !userId || state.players[userId] || userId === from) return { state }
  const prevAt = Object.fromEntries(Object.entries(me.btAt || {}).filter(([, at]) => now - at < BYSTANDER_COOLDOWN_MS))
  if (prevAt[userId]) return { state }
  const username = String(action.username || 'iyiyi').replace(/^@+/, '').slice(0, 24)
  const players = {
    ...state.players,
    [from]: { ...me, score: (me.score || 0) + BYSTANDER_POINTS, bystanderTags: (me.bystanderTags || 0) + 1, btAt: { ...prevAt, [userId]: now } },
  }
  return {
    state: { ...state, players, feed: pushFeed(state, `${me.name} tagged iYiYi user @${username}`, now) },
    reply: { type: 'bystander_ok', data: { userId, username, points: BYSTANDER_POINTS } },
  }
}

function applyGrenade(state, action, from, now, posOf) {
  const thrower = state.players[from]
  if (!thrower?.alive) return { state }
  if (now - (thrower.lastGrenadeAt || 0) < GRENADE_COOLDOWN_MS) return { state }
  const land = { lat: Number(action.lat), lng: Number(action.lng) }
  if (!Number.isFinite(land.lat) || !Number.isFinite(land.lng)) return { state }
  const from0 = posOf(from)
  if (!from0) return { state, reply: notice('Grenade lost — waiting for GPS.') }
  if (distanceMeters(from0, land) > GRENADE_MAX_THROW_M + gpsSlack(from0.acc) + 5) return { state, reply: notice('Nobody can throw that far.') }
  const players = { ...state.players, [from]: { ...thrower, lastGrenadeAt: now, grenades: (thrower.grenades || 0) + 1 } }
  const snd = state.mode === 'snd'
  const hits = []
  let feed = state.feed
  let teamScore = state.teamScore
  let sndState = state.snd
  for (const [id, target] of Object.entries(state.players)) {
    if (id === from || !target.alive) continue
    if (state.mode !== 'ffa' && target.team === thrower.team) continue
    if ((target.protectedUntil || 0) > now) continue
    const pos = posOf(id)
    if (!pos) continue
    const d = distanceMeters(pos, land)
    const reach = GRENADE_RADIUS_M + Math.min(4, gpsSlack(pos.acc))
    if (d > reach) continue
    const damage = Math.round(GRENADE_MAX_DAMAGE - (GRENADE_MAX_DAMAGE - GRENADE_MIN_DAMAGE) * Math.min(1, d / reach))
    const hp = Math.max(0, target.hp - damage)
    const killed = hp <= 0
    players[id] = { ...target, hp, alive: !killed, deaths: target.deaths + (killed ? 1 : 0), respawnAt: killed && !snd ? now + RESPAWN_MS : null }
    const me = players[from]
    players[from] = { ...me, hits: me.hits + 1, score: me.score + 10 + (killed ? 100 : 0), kills: me.kills + (killed ? 1 : 0) }
    hits.push({ id, name: target.name, damage: Math.min(damage, target.hp), killed })
    if (killed) {
      feed = pushFeed({ feed }, `${thrower.name} 💥 ${target.name}`, now)
      if (state.mode === 'tdm') teamScore = { ...teamScore, [thrower.team]: teamScore[thrower.team] + 1 }
    }
    if (snd) {
      if (sndState.act?.by === id) sndState = { ...sndState, act: null }
      if (killed && sndState.bomb?.state === 'carried' && sndState.bomb.carrier === id) {
        sndState = { ...sndState, bomb: dropBomb(sndState.bomb, pos) }
        feed = pushFeed({ feed }, `${target.name} dropped the bomb`, now)
      }
    }
  }
  const next = { ...state, players, feed, teamScore, ...(snd ? { snd: sndState } : {}) }
  return { state: next, reply: { type: 'grenade_ok', data: { hits, by: thrower.name } } }
}

function applyHit(state, action, from, now, posOf) {
  const shooter = state.players[from]
  const target = state.players[action.target]
  if (!shooter || !target || action.target === from || !shooter.alive || !target.alive) return { state }
  if (state.mode !== 'ffa' && shooter.team === target.team) return { state }
  if ((target.protectedUntil || 0) > now) return { state, reply: notice(`${target.name} just respawned — protected for a moment.`) }
  const a = posOf(from)
  const b = posOf(action.target)
  if (!a || !b) return { state, reply: notice('Shot not counted — waiting for GPS.') }
  const maxRange = action.method === 'vision' ? VISION_MAX_M : MAX_RANGE_M + 30
  if (distanceMeters(a, b) > maxRange) return { state, reply: notice('Out of range.') }
  const zone = action.zone === 'head' || action.zone === 'limb' ? action.zone : 'body'
  const hits = Math.max(1, Math.min(5, Math.floor(Number(action.hits) || 1)))
  const damage = Math.max(1, Math.min(MAX_HP, Math.floor(Number(action.damage) || 0)))
  const hp = Math.max(0, target.hp - damage)
  const killed = hp <= 0
  const snd = state.mode === 'snd'
  const head = zone === 'head'
  const players = {
    ...state.players,
    [from]: {
      ...shooter,
      hits: shooter.hits + hits,
      headshots: (shooter.headshots || 0) + (head ? 1 : 0),
      score: shooter.score + hits * 10 + (head ? 10 : 0) + (killed ? 100 : 0),
      kills: shooter.kills + (killed ? 1 : 0),
    },
    [action.target]: {
      ...target,
      hp,
      alive: !killed,
      deaths: target.deaths + (killed ? 1 : 0),
      respawnAt: killed && !snd ? now + RESPAWN_MS : null,
    },
  }
  let next = { ...state, players }
  if (killed) {
    next.feed = pushFeed(state, `${shooter.name} ${head ? '🎯' : '⟶'} ${target.name}${head ? ' (headshot)' : ''}`, now)
    if (state.mode === 'tdm') next.teamScore = { ...state.teamScore, [shooter.team]: state.teamScore[shooter.team] + 1 }
  }
  if (snd) {
    let sndState = state.snd
    if (sndState.act?.by === action.target) sndState = { ...sndState, act: null } // hits interrupt plant/defuse
    if (killed && sndState.bomb?.state === 'carried' && sndState.bomb.carrier === action.target) {
      sndState = { ...sndState, bomb: dropBomb(sndState.bomb, b) }
      next.feed = pushFeed(next, `${target.name} dropped the bomb`, now)
    }
    next.snd = sndState
  }
  return { state: next, reply: { type: 'hit_ok', data: { name: target.name, killed, zone, damage: Math.min(damage, target.hp) } } }
}
