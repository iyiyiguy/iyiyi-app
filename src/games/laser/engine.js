// Host-side rules for Laser Tag (Free-for-all, Team Deathmatch, Search & Destroy).
// Pure functions: (state, input) → next state. Only the host runs these; the
// result is broadcast as the authoritative state.
import { distanceMeters, shuffled } from '../../lib/multiplayer'
import { getWeapon } from '../../lib/guns'
import { zoneDamage } from './vision'
import { angleDelta, bearingTo, destination, round6 } from './geo'
import {
  COMPASS_MAX_RANGE_M, HOST_AIM_SLACK_DEG, HOST_VISION_MIN_DEG, compassTolerance, gpsErr, hitChance, hostGapSlackMs, minShotGapMs, visionTolerance,
} from './aimRules'

export const MAX_HP = 100
export const RESPAWN_MS = 8000
export const SPAWN_PROTECT_MS = 2000
export const VISION_MAX_M = 55 // 30 m effective + GPS slack
export const COUNTDOWN_MS = 5000
export const ROUND_BREAK_MS = 9000
// Plant / defuse: hold the button on your phone (CoD / CS style). The phone sends *_start
// on press and *_done when the bar fills; the host only accepts a completion from the
// player who started it, still alive and inside the zone, after (about) the full hold
// time. A hit, leaving the zone or letting go cancels it.
// Reference: CS plant 3.2 s / defuse 10 s (5 s kit) / C4 40 s; CoD plant 5 s / defuse
// 7.5 s / bomb 45 s. Real-world play is a bit shorter on the hold (you're exposed).
export const PLANT_MS = 4000
export const DEFUSE_MS = 6000
export const HOLD_SLACK_MS = 600 // network jitter between the start and done messages
export const ACT_GRACE_MS = 2500 // a *_done may arrive this late before the host drops the act
export const BOMB_MS = 45000
// Site radius before GPS slack (gpsSlack adds 2-8 m from the player's reported accuracy),
// so a player standing on the marker counts as inside with 5-15 m GPS error.
export const SITE_RADIUS_M = 12
// Two sites closer than this overlap once GPS slack is added.
export const MIN_SITE_GAP_M = 30
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
// Sticky bombs: place as many as you carry ('sticky_place': the HOST records where you stood,
// never a client lat/lng), then one 'sticky_detonate' blows all of yours at once. Damage falls
// off from each bomb's centre like a grenade; a target caught by several bombs takes the sum,
// capped at STICKY_STACK_CAP per detonation (one kill credit).
export const STICKY_BOMB_RADIUS_M = 10
export const STICKY_BOMB_MAX_DAMAGE = 100
export const STICKY_BOMB_MIN_DAMAGE = 30
export const STICKY_BOMB_COOLDOWN_MS = 3000 // legacy 'sticky_bomb' (old clients) only
export const STICKY_MAX_PER_PLAYER = 20 // sanity cap on the host; the real limit is your inventory
export const STICKY_PLACE_GAP_MS = 500
export const STICKY_DETONATE_GAP_MS = 800 // double-tap guard, not a per-bomb throttle
export const STICKY_STACK_CAP = 100
export const STICKY_LEGACY_MAX_M = 100 // an old client's sticky_bomb lat/lng must be this close to them
export const STICKY_RESTORE_MAX_M = 250 // host migration: re-sent placements must be this close
// Land mines: placed at the player's current position, triggered automatically when an enemy
// walks within LAND_MINE_TRIGGER_M. Blast radius is smaller but damage is high.
export const LAND_MINE_TRIGGER_M = 3
export const LAND_MINE_RADIUS_M = 5
export const LAND_MINE_MAX_DAMAGE = 110
export const LAND_MINE_MIN_DAMAGE = 40
export const LAND_MINE_COOLDOWN_MS = 2000
export const LAND_MINE_MAX_PER_PLAYER = 20
// Rocket launcher: EVERY rocket explodes. A direct hit damages the target and splashes everyone
// near them; a miss ('rocket' action, or a 'hit' the host rejects) explodes at the impact point
// = shooter's host-side position + heading × distance, and splashes everyone near that.
// There is no depth sensor: the client sends its honest guess (locked target's distance /
// ground intersection when pitched down / ROCKET_WALL_M) and the host clamps it.
export const ROCKET_RADIUS_M = 9
export const ROCKET_SPLASH_MAX = 70
export const ROCKET_SPLASH_MIN = 20
export const ROCKET_WALL_M = 25
export const ROCKET_MIN_M = 3
export const ROCKET_MAX_M = 80
export const ROCKET_GAP_MS = 3000 // 1 rocket per 3 s (fireRate 1/3), enforced on the host
// Hits from old clients carry no heading, so the host can't re-check aim or roll them; they
// are still accepted (fire-rate + range limits apply). Flip once old builds are gone.
export const LEGACY_AIM_OK = true

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
    sites: (s.sites || [])
      .filter((x) => x && (x.id === 'A' || x.id === 'B') && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      .map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, r: x.r > 0 ? x.r : SITE_RADIUS_M })),
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

// Detonations every client should see (big explosion in its direction, kill banner for the owner).
const BLAST_KEEP_MS = 10000
const BLAST_MAX = 8
// A private match only ends for lack of players once they've been gone this long (a locked
// phone or a dropped connection comes back; presence alone flickers).
const TOO_FEW_GRACE_MS = 30000

// ---- tick --------------------------------------------------------------------

export function tick(state, { now, presentIds, posOf }) {
  if (state.phase === 'ended') return state
  if (state.phase === 'countdown') {
    return now >= state.startsAt ? { ...state, phase: 'playing' } : state
  }
  if (state.mode !== 'snd') return tickDeathmatch(state, now, presentIds, posOf)
  if (state.phase === 'roundEnd') return now >= state.startsAt ? nextSndRound(state, now, presentIds) : state
  return tickSnd(state, now, presentIds, posOf)
}

function tickDeathmatch(state, now, presentIds, posOf) {
  let players = state.players
  for (const id of Object.keys(players)) {
    const p = players[id]
    if (p.respawnAt && now >= p.respawnAt) {
      if (players === state.players) players = { ...players }
      players[id] = { ...p, hp: MAX_HP, alive: true, respawnAt: null, protectedUntil: now + SPAWN_PROTECT_MS }
    }
  }
  let next = players === state.players ? state : { ...state, players }
  next = dropOrphanStickies(next)
  // Trigger land mines
  if (next.landMines?.length && posOf) next = tickLandMines(next, now, posOf)
  // Forget blasts older than BLAST_KEEP_MS (clients only react to ids they haven't seen).
  if (next.blasts?.length && next.blasts.some((b) => now - b.at > BLAST_KEEP_MS)) {
    next = { ...next, blasts: next.blasts.filter((b) => now - b.at <= BLAST_KEEP_MS) }
  }
  if (next.endless) return next // the public arena never ends
  if (now >= next.endsAt) return finishDeathmatch(next)
  const present = Object.keys(next.players).filter((id) => presentIds.has(id))
  const teamsPresent = new Set(present.map((id) => next.players[id].team))
  const tooFew = present.length < 2 || (next.mode === 'tdm' && teamsPresent.size < 2)
  if (!tooFew) return next.tooFewSince ? { ...next, tooFewSince: null } : next
  if (!next.tooFewSince) return { ...next, tooFewSince: now }
  return now - next.tooFewSince >= TOO_FEW_GRACE_MS ? finishDeathmatch(next) : next
}

// Check every placed land mine: if an enemy is within LAND_MINE_TRIGGER_M, detonate it.
function tickLandMines(state, now, posOf) {
  if (!state.landMines?.length) return state
  let blasts = state.blasts || []
  let players = { ...state.players }
  let feed = state.feed
  let teamScore = state.teamScore
  const remaining = []
  const snd = state.mode === 'snd'
  let sndState = state.snd
  let changed = false
  for (const mine of state.landMines) {
    const placer = players[mine.by]
    if (!placer) { changed = true; continue } // owner left the match: the mine goes with them
    let triggered = false
    for (const [id, target] of Object.entries(players)) {
      if (id === mine.by || !target.alive) continue
      if (state.mode !== 'ffa' && target.team === placer.team) continue
      if ((target.protectedUntil || 0) > now) continue
      const pos = posOf(id)
      if (!pos) continue
      const d = distanceMeters(pos, mine)
      if (d > LAND_MINE_TRIGGER_M + Math.min(3, gpsSlack(pos.acc))) continue
      // Triggered! Damage everyone in blast radius.
      triggered = true
      break
    }
    if (!triggered) { remaining.push(mine); continue }
    changed = true
    const blastHits = []
    // Detonate — damage all enemies in LAND_MINE_RADIUS_M
    for (const [id, target] of Object.entries(players)) {
      if (id === mine.by || !target.alive) continue
      if (state.mode !== 'ffa' && target.team === placer.team) continue
      if ((target.protectedUntil || 0) > now) continue
      const pos = posOf(id)
      if (!pos) continue
      const d = distanceMeters(pos, mine)
      const reach = LAND_MINE_RADIUS_M + Math.min(3, gpsSlack(pos.acc))
      if (d > reach) continue
      const damage = Math.round(LAND_MINE_MAX_DAMAGE - (LAND_MINE_MAX_DAMAGE - LAND_MINE_MIN_DAMAGE) * Math.min(1, d / reach))
      const hp = Math.max(0, target.hp - damage)
      const killed = hp <= 0
      players[id] = { ...target, hp, alive: !killed, deaths: target.deaths + (killed ? 1 : 0), respawnAt: killed && !snd ? now + RESPAWN_MS : null }
      const me = players[mine.by]
      players[mine.by] = { ...me, hits: (me.hits || 0) + 1, score: (me.score || 0) + 10 + (killed ? 100 : 0), kills: (me.kills || 0) + (killed ? 1 : 0) }
      blastHits.push({ id, name: target.name, damage: Math.min(damage, target.hp), killed })
      if (killed) {
        feed = pushFeed({ feed }, `${placer.name} 💥 ${target.name} (land mine)`, now)
        if (state.mode === 'tdm') teamScore = { ...teamScore, [placer.team]: teamScore[placer.team] + 1 }
      }
      if (snd) {
        if (sndState?.act?.by === id) sndState = { ...sndState, act: null }
        if (killed && sndState?.bomb?.state === 'carried' && sndState.bomb.carrier === id) {
          sndState = { ...sndState, bomb: dropBomb(sndState.bomb, pos) }
          feed = pushFeed({ feed }, `${target.name} dropped the bomb`, now)
        }
      }
    }
    blasts = [...blasts, { id: `${now}-${Math.random().toString(36).slice(2, 6)}`, kind: 'land_mine', lat: mine.lat, lng: mine.lng, by: mine.by, byName: placer.name, at: now, hits: blastHits }].slice(-BLAST_MAX)
  }
  if (!changed) return state
  return { ...state, players, feed, teamScore, blasts, landMines: remaining, ...(snd && sndState !== state.snd ? { snd: sndState } : {}) }
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
  let next = dropOrphanStickies(state)
  if (next.landMines?.length && posOf) next = tickLandMines(next, now, posOf)
  if (next.blasts?.length && next.blasts.some((b) => now - b.at > BLAST_KEEP_MS)) {
    next = { ...next, blasts: next.blasts.filter((b) => now - b.at <= BLAST_KEEP_MS) }
  }
  const snd = next.snd
  // Plant / defuse in progress (the mini-game runs on the player's phone). A missing GPS fix
  // (stale for a moment) is "unknown", not "outside".
  if (snd.act) {
    const a = snd.act
    const p = next.players[a.by]
    const pos = posOf(a.by)
    const limit = (a.kind === 'plant' ? PLANT_MS : DEFUSE_MS) + ACT_GRACE_MS
    const zoneOk = a.kind === 'plant' ? !!actCenter(snd, a) : snd.bomb?.state === 'planted'
    const ok = p?.alive && presentIds.has(a.by) && zoneOk && (pos ? inActZone(snd, a, pos) : true) && now - a.startedAt <= limit
    if (!ok) next = { ...next, snd: { ...snd, act: null } }
  }
  // Nobody has the bomb (no attacker was around at round start, or it was dropped where
  // nobody knows): give it to an attacker who is here now.
  const b0 = next.snd.bomb
  if (!b0 || b0.state === 'none' || (b0.state === 'dropped' && b0.lat == null)) {
    const bomb = newBomb(next, presentIds)
    if (bomb.carrier) next = { ...next, snd: { ...next.snd, bomb } }
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

// Close enough to the planted bomb to defuse it: within the site radius of where the
// planter stood, or anywhere inside the site it was planted at (both positions carry GPS
// error, so either one counts).
export function atBomb(snd, pos) {
  const b = snd?.bomb
  if (!pos || !b || b.state !== 'planted' || b.lat == null) return false
  if (insideRadius(pos, b, b.r || SITE_RADIUS_M)) return true
  const site = (snd.sites || []).find((x) => x.id === b.site)
  return !!site && insideRadius(pos, site, site.r || SITE_RADIUS_M)
}

function inActZone(snd, a, pos) {
  if (a.kind === 'defuse') return atBomb(snd, pos)
  const site = actCenter(snd, a)
  return !!site && insideRadius(pos, site, site.r || SITE_RADIUS_M)
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
  const needed = Math.floor(snd.totalRounds / 2) + 1 // a strict majority (best of N)
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
  const swap = snd.roundNo === Math.ceil(snd.totalRounds / 2)
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
    landMines: [],
    stickies: [],
    blasts: [],
    snd: { ...snd, roundNo: snd.roundNo + 1, sides, act: null, swapped: swap },
    feed: swap ? pushFeed(state, '🔄 Half time — sides swapped', now) : state.feed,
  }
  return { ...next, snd: { ...next.snd, bomb: newBomb(next, presentIds) } }
}

// ---- actions -------------------------------------------------------------------

// Returns { state, reply?, notify? }: reply = { type, data } feedback for the sender; notify =
// [{ to, data }] 'got_hit' messages for the players an action damaged.
// rand: the host's dice (tests pass a seeded one).
export function applyAction(state, action, from, { now, posOf, rand = Math.random }) {
  if (state.phase !== 'playing' || !action) return { state }
  const me = state.players[from]
  if (!me) return { state }
  const ctx = { now, posOf, rand }
  switch (action.type) {
    case 'hit': return applyHit(state, action, from, ctx, false)
    // A compass pull the shooter's own dice called a miss (sent so the host rolls; old hosts
    // ignore the type, so they never see it as a hit).
    case 'shot': return applyHit(state, action, from, ctx, true)
    case 'rocket': return applyRocket(state, action, from, ctx)
    case 'bystander': return applyBystander(state, action, from, now)
    case 'grenade': return applyGrenade(state, action, from, now, posOf)
    case 'sticky_bomb': return applyStickyBomb(state, action, from, ctx)
    case 'sticky_place': return applyStickyPlace(state, action, from, ctx)
    case 'sticky_detonate': return applyStickyDetonate(state, from, ctx)
    case 'sticky_restore': return applyStickyRestore(state, action, from, ctx)
    case 'land_mine': return applyLandMine(state, action, from, now, posOf)
    // A new press by the same player restarts their hold (a lost act_cancel must not let
    // the next press finish early).
    case 'plant_start': {
      if (state.mode !== 'snd' || !me.alive) return { state }
      if (state.snd.act && state.snd.act.by !== from) return { state, reply: notice('Someone else is already at the bomb.') }
      const b = state.snd.bomb
      if (b?.state !== 'carried' || b.carrier !== from) return { state, reply: notice('You don’t have the bomb.') }
      const pos = posOf(from)
      if (!pos) return { state, reply: notice('Waiting for your GPS — hold still a moment.') }
      // The site the player asked for, else whichever site they are actually in.
      const site = [state.snd.sites.find((x) => x.id === action.site), ...state.snd.sites].find((x) => x && insideRadius(pos, x, x.r || SITE_RADIUS_M))
      if (!site) return { state, reply: notice('Get inside a bomb site to plant.') }
      return { state: { ...state, snd: { ...state.snd, act: { kind: 'plant', by: from, startedAt: now, site: site.id } } } }
    }
    case 'defuse_start': {
      if (state.mode !== 'snd' || !me.alive) return { state }
      if (state.snd.act && state.snd.act.by !== from) return { state, reply: notice('A teammate is already defusing.') }
      const b = state.snd.bomb
      if (b?.state !== 'planted' || me.team !== defendingTeam(state)) return { state }
      const pos = posOf(from)
      if (!pos) return { state, reply: notice('Waiting for your GPS — hold still a moment.') }
      if (!atBomb(state.snd, pos)) return { state, reply: notice('Get closer to the bomb to defuse.') }
      return { state: { ...state, snd: { ...state.snd, act: { kind: 'defuse', by: from, startedAt: now } } } }
    }
    case 'plant_done':
    case 'defuse_done': {
      if (state.mode !== 'snd' || !me.alive) return { state }
      const a = state.snd.act
      const kind = action.type === 'plant_done' ? 'plant' : 'defuse'
      if (!a || a.by !== from || a.kind !== kind) return { state, reply: notice(kind === 'plant' ? 'Plant interrupted — hold again.' : 'Defuse interrupted — hold again.') }
      const elapsed = now - a.startedAt
      const holdMs = kind === 'plant' ? PLANT_MS : DEFUSE_MS
      const drop = (text) => ({ state: { ...state, snd: { ...state.snd, act: null } }, reply: notice(text) })
      if (elapsed < holdMs - HOLD_SLACK_MS || elapsed > holdMs + ACT_GRACE_MS) return drop('That didn’t count — hold until the bar fills.')
      const pos = posOf(from)
      if (!pos || !inActZone(state.snd, a, pos)) return drop(kind === 'plant' ? 'Stay inside the site to plant.' : 'Stay at the bomb to defuse.')
      if (kind === 'plant') {
        if (state.snd.bomb?.state !== 'carried' || state.snd.bomb.carrier !== from) return { state }
        return { state: completePlant(state, from, now, pos) }
      }
      if (state.snd.bomb?.state !== 'planted' || me.team !== defendingTeam(state)) return { state }
      if (now >= state.snd.bomb.explodesAt) return { state } // too late: the tick detonates it
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

// Host migration: every timestamp in the state is on the previous host's clock. Shift
// them onto the new host's clock (deltaMs = newClock - oldClock) so the round timer, a
// planted bomb's fuse and a plant/defuse in progress carry on where they were.
export function rebaseClock(state, deltaMs) {
  if (!state || !Number.isFinite(deltaMs) || !deltaMs) return state
  const sh = (t) => (Number.isFinite(t) && t > 0 ? t + deltaMs : t)
  const players = {}
  for (const [id, p] of Object.entries(state.players || {})) {
    players[id] = { ...p, respawnAt: sh(p.respawnAt), protectedUntil: sh(p.protectedUntil) }
    if (p.shotAt) players[id].shotAt = Object.fromEntries(Object.entries(p.shotAt).map(([k, v]) => [k, { ...v, h: sh(v?.h) }]))
  }
  const next = {
    ...state,
    startedAt: sh(state.startedAt),
    startsAt: sh(state.startsAt),
    endsAt: sh(state.endsAt),
    tooFewSince: sh(state.tooFewSince),
    players,
  }
  if (state.blasts) next.blasts = state.blasts.map((b) => ({ ...b, at: sh(b.at) }))
  if (state.stickies) next.stickies = state.stickies.map((b) => ({ ...b, placedAt: sh(b.placedAt) }))
  if (state.snd) {
    const { bomb, act } = state.snd
    next.snd = {
      ...state.snd,
      bomb: bomb ? { ...bomb, plantedAt: sh(bomb.plantedAt), explodesAt: sh(bomb.explodesAt) } : bomb,
      act: act ? { ...act, startedAt: sh(act.startedAt) } : act,
    }
  }
  return next
}

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
  return { state: next, reply: { type: 'grenade_ok', data: { hits, by: thrower.name } }, notify: notifyFor(hits, thrower.name, from, 'grenade') }
}

// ---- shared blast + fire-rate helpers -------------------------------------------------------

/** got_hit messages for everyone in `hits`. */
function notifyFor(hits, byName, byId, zone, weapon) {
  return (hits || []).map((h) => ({ to: h.id, data: { by: byName || 'Someone', byId, zone, damage: h.damage, killed: h.killed, ...(weapon ? { weapon } : {}) } }))
}

const withPlayer = (state, id, patch) => ({ ...state, players: { ...state.players, [id]: { ...state.players[id], ...patch } } })

/**
 * Per-weapon fire-rate gate. A pull counts only when it is at least gapMs after the previous
 * one on the SENDER's trigger clock (firedAt, monotonic per phone) AND on the host's clock
 * (minus a little slack for bursty arrival), so a faked firedAt can't beat it.
 * Returns { ok, shotAt? } (shotAt: the player's updated record, when there is a gap rule).
 */
export function fireGate(player, key, gapMs, now, firedAt) {
  if (!(gapMs > 0)) return { ok: true }
  const sent = Number.isFinite(firedAt) ? firedAt : now
  const prev = player?.shotAt?.[key]
  if (prev && (sent - prev.s < gapMs || now - prev.h < gapMs - hostGapSlackMs(gapMs))) return { ok: false }
  return { ok: true, shotAt: { ...(player?.shotAt || {}), [key]: { s: sent, h: now } } }
}

/**
 * Area damage from one or more blast centres. Every enemy (not the owner, not `exclude`, not
 * spawn-protected) within radius + GPS slack of a centre takes max→min falloff damage per
 * centre, summed and capped at `cap`. Scores, kills, team score, the kill feed and S&D side
 * effects (act interrupted, carrier drops the bomb) are applied.
 */
function blast(state, from, centers, opts, { now, posOf }) {
  const { radius, max, min, slackCap = 4, cap = Infinity, exclude = null, symbol = '💥', tag = null } = opts
  const owner = state.players[from]
  const snd = state.mode === 'snd'
  const players = { ...state.players }
  let feed = state.feed
  let teamScore = state.teamScore
  let sndState = state.snd
  const hits = []
  for (const [id, target] of Object.entries(state.players)) {
    if (id === from || id === exclude || !target.alive) continue
    if (state.mode !== 'ffa' && target.team === owner?.team) continue
    if ((target.protectedUntil || 0) > now) continue
    const pos = posOf(id)
    if (!pos) continue
    const reach = radius + Math.min(slackCap, gpsSlack(pos.acc))
    let damage = 0
    for (const c of centers) {
      const d = distanceMeters(pos, c)
      if (d <= reach) damage += Math.round(max - (max - min) * Math.min(1, d / reach))
    }
    if (!(damage > 0)) continue
    damage = Math.min(cap, damage)
    const hp = Math.max(0, target.hp - damage)
    const killed = hp <= 0
    players[id] = { ...target, hp, alive: !killed, deaths: target.deaths + (killed ? 1 : 0), respawnAt: killed && !snd ? now + RESPAWN_MS : null }
    const me = players[from]
    players[from] = { ...me, hits: (me.hits || 0) + 1, score: (me.score || 0) + 10 + (killed ? 100 : 0), kills: (me.kills || 0) + (killed ? 1 : 0) }
    hits.push({ id, name: target.name, damage: Math.min(damage, target.hp), killed })
    if (killed) {
      feed = pushFeed({ feed }, `${owner?.name || 'Someone'} ${symbol} ${target.name}${tag ? ` (${tag})` : ''}`, now)
      if (state.mode === 'tdm' && owner?.team) teamScore = { ...teamScore, [owner.team]: (teamScore?.[owner.team] || 0) + 1 }
    }
    if (snd && sndState) {
      if (sndState.act?.by === id) sndState = { ...sndState, act: null }
      if (killed && sndState.bomb?.state === 'carried' && sndState.bomb.carrier === id) {
        sndState = { ...sndState, bomb: dropBomb(sndState.bomb, pos) }
        feed = pushFeed({ feed }, `${target.name} dropped the bomb`, now)
      }
    }
  }
  if (!hits.length) return { state, hits }
  return { state: { ...state, players, feed, teamScore, ...(snd ? { snd: sndState } : {}) }, hits }
}

const ROCKET_BLAST = { radius: ROCKET_RADIUS_M, max: ROCKET_SPLASH_MAX, min: ROCKET_SPLASH_MIN, slackCap: 3, symbol: '🚀💥' }
const STICKY_BLAST = { radius: STICKY_BOMB_RADIUS_M, max: STICKY_BOMB_MAX_DAMAGE, min: STICKY_BOMB_MIN_DAMAGE, slackCap: 4, cap: STICKY_STACK_CAP, tag: 'sticky bomb' }

/** Where a rocket fired from `a` along `heading` lands, `distClaim` metres out (clamped). */
export function rocketImpactPoint(a, heading, distClaim, gun) {
  const maxM = Math.min(ROCKET_MAX_M, gun?.range || ROCKET_MAX_M)
  const raw = Number(distClaim)
  const dist = Math.max(ROCKET_MIN_M, Math.min(maxM, Number.isFinite(raw) && raw > 0 ? raw : ROCKET_WALL_M))
  return { ...destination(a, heading, dist), dist }
}

// The rocket explodes at its impact point: splash everyone (enemy) near it.
function rocketImpact(state, from, a, heading, distClaim, gun, ctx, extra = {}) {
  const p = rocketImpactPoint(a, heading, distClaim, gun)
  const r = blast(state, from, [p], ROCKET_BLAST, ctx)
  const name = state.players[from]?.name
  return {
    state: r.state,
    reply: { type: 'rocket_ok', data: { hits: r.hits, lat: round6(p.lat), lng: round6(p.lng), dist: Math.round(p.dist * 10) / 10, ...extra } },
    notify: notifyFor(r.hits, name, from, 'rocket', 'rocket'),
  }
}

// A rocket that hit nothing (no target in the sights): it still explodes where it lands.
function applyRocket(state, action, from, ctx) {
  const shooter = state.players[from]
  if (!shooter?.alive) return { state }
  const heading = Number(action.heading)
  if (!Number.isFinite(heading)) return { state }
  const gun = getWeapon('rocket')
  const gate = fireGate(shooter, 'rocket', minShotGapMs(gun) || ROCKET_GAP_MS, ctx.now, action.firedAt)
  if (!gate.ok) return { state, reply: notice('Rocket reloading…') }
  const base = withPlayer(state, from, { shotAt: gate.shotAt })
  const a = ctx.posOf(from)
  if (!a) return { state: base, reply: notice('Rocket lost — waiting for your GPS.') }
  return rocketImpact(base, from, a, heading, action.dist, gun, ctx)
}

// ---- sticky bombs -----------------------------------------------------------------------------

const myStickies = (state, from) => (state.stickies || []).filter((b) => b.by === from)

/** Remove sticky bombs whose owner has left the match. */
function dropOrphanStickies(state) {
  if (!state.stickies?.length || state.stickies.every((b) => state.players[b.by])) return state
  return { ...state, stickies: state.stickies.filter((b) => state.players[b.by]) }
}

const cleanId = (v, fallback) => (typeof v === 'string' && v ? v.slice(0, 40) : fallback)

// Place one: the host stamps the position IT sees for the placer (never a client lat/lng).
function applyStickyPlace(state, action, from, { now, posOf }) {
  const placer = state.players[from]
  if (!placer?.alive) return { state }
  const id = cleanId(action.id, `${now}`)
  const mine = myStickies(state, from)
  if (mine.some((b) => b.id === id)) return { state } // a resend
  if (now - (placer.lastStickyPlaceAt || 0) < STICKY_PLACE_GAP_MS) return { state, reply: notice('Slow down — one sticky bomb at a time.') }
  if (mine.length >= STICKY_MAX_PER_PLAYER) return { state, reply: notice(`That’s ${STICKY_MAX_PER_PLAYER} sticky bombs — detonate some first.`) }
  const pos = posOf(from)
  if (!pos) return { state, reply: notice('Waiting for your GPS to place the sticky bomb.') }
  const bomb = { id, by: from, lat: round6(pos.lat), lng: round6(pos.lng), placedAt: now }
  const next = { ...withPlayer(state, from, { lastStickyPlaceAt: now }), stickies: [...(state.stickies || []), bomb] }
  return { state: next, reply: { type: 'sticky_place_ok', data: { id, lat: bomb.lat, lng: bomb.lng, count: mine.length + 1 } } }
}

// Detonate ALL of the sender's sticky bombs in one host pass.
function applyStickyDetonate(state, from, ctx) {
  const placer = state.players[from]
  if (!placer?.alive) return { state }
  const mine = myStickies(state, from)
  if (!mine.length) return { state, reply: notice('No sticky bombs placed.') }
  if (ctx.now - (placer.lastStickyBombAt || 0) < STICKY_DETONATE_GAP_MS) return { state }
  const base = { ...withPlayer(state, from, { lastStickyBombAt: ctx.now }), stickies: (state.stickies || []).filter((b) => b.by !== from) }
  const r = blast(base, from, mine, STICKY_BLAST, ctx)
  return {
    state: r.state,
    reply: { type: 'sticky_bomb_ok', data: { hits: r.hits, by: placer.name, count: mine.length, bombs: mine.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng })) } },
    notify: notifyFor(r.hits, placer.name, from, 'sticky_bomb'),
  }
}

// Host migration: the new host's copy of the state may predate a placement, so the owner
// re-sends theirs. Only positions near where the host sees the owner now are taken (the game
// gates this to just after a host change).
function applyStickyRestore(state, action, from, { now, posOf }) {
  const placer = state.players[from]
  const pos = posOf(from)
  if (!placer || !pos || !Array.isArray(action.items)) return { state }
  const have = new Set(myStickies(state, from).map((b) => b.id))
  const add = []
  for (const it of action.items.slice(0, STICKY_MAX_PER_PLAYER)) {
    const id = cleanId(it?.id, null)
    const lat = Number(it?.lat)
    const lng = Number(it?.lng)
    if (!id || have.has(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (distanceMeters(pos, { lat, lng }) > STICKY_RESTORE_MAX_M) continue
    if (have.size + add.length >= STICKY_MAX_PER_PLAYER) break
    have.add(id)
    add.push({ id, by: from, lat: round6(lat), lng: round6(lng), placedAt: now })
  }
  if (!add.length) return { state }
  return { state: { ...state, stickies: [...(state.stickies || []), ...add] } }
}

// Old clients: 'sticky_bomb' detonates one bomb at a client-sent lat/lng. If the host has
// placements for this player it detonates those instead (the lat/lng is ignored); otherwise
// the position must be near the player and the old 3 s cooldown applies.
function applyStickyBomb(state, action, from, ctx) {
  const placer = state.players[from]
  if (!placer?.alive) return { state }
  if (myStickies(state, from).length) return applyStickyDetonate(state, from, ctx)
  if (ctx.now - (placer.lastStickyBombAt || 0) < STICKY_BOMB_COOLDOWN_MS) return { state }
  const land = { lat: Number(action.lat), lng: Number(action.lng) }
  if (!Number.isFinite(land.lat) || !Number.isFinite(land.lng)) return { state }
  const me = ctx.posOf(from)
  if (!me) return { state, reply: notice('Sticky bomb lost — waiting for your GPS.') }
  if (distanceMeters(me, land) > STICKY_LEGACY_MAX_M + gpsSlack(me.acc)) return { state, reply: notice('That sticky bomb is too far away to detonate.') }
  const base = withPlayer(state, from, { lastStickyBombAt: ctx.now })
  const r = blast(base, from, [land], STICKY_BLAST, ctx)
  return { state: r.state, reply: { type: 'sticky_bomb_ok', data: { hits: r.hits, by: placer.name } }, notify: notifyFor(r.hits, placer.name, from, 'sticky_bomb') }
}

// Land mine: placed at the player's location (host-side position). The host stores it and checks
// every tick whether an enemy has wandered within LAND_MINE_TRIGGER_M; when one does, it detonates.
function applyLandMine(state, action, from, now, posOf) {
  const placer = state.players[from]
  if (!placer?.alive) return { state }
  if (now - (placer.lastLandMineAt || 0) < LAND_MINE_COOLDOWN_MS) return { state }
  if ((state.landMines || []).filter((m) => m.by === from).length >= LAND_MINE_MAX_PER_PLAYER) return { state, reply: notice(`You already have ${LAND_MINE_MAX_PER_PLAYER} mines out.`) }
  const pos = posOf(from)
  if (!pos) return { state, reply: notice('Waiting for GPS to place mine.') }
  const mine = { lat: pos.lat, lng: pos.lng, by: from, placedAt: now }
  const mines = [...(state.landMines || []), mine]
  const players = { ...state.players, [from]: { ...placer, lastLandMineAt: now } }
  return { state: { ...state, players, landMines: mines }, reply: { type: 'land_mine_ok', data: { placed: true } } }
}

// ---- hits ---------------------------------------------------------------------------------------

const clampHits = (v, cap) => Math.max(1, Math.min(cap, Math.floor(Number(v) || 1)))

// A trigger pull at a player. New clients send `heading` (+ headingAcc, shots, snap) so the
// host re-checks the bearing and, for compass aim, rolls the hit itself; camera ('vision')
// hits are bearing-checked with a wide window. Old clients (no heading) are taken as sent.
// Rockets never just vanish: anything that isn't a direct hit explodes at the impact point.
function applyHit(state, action, from, ctx, typeShot) {
  const { now, posOf, rand } = ctx
  const shooter = state.players[from]
  const target = state.players[action.target]
  if (!shooter) return { state }
  const gun = getWeapon(action.weapon) || getWeapon('pistol')
  const rocket = gun.id === 'rocket'
  const heading = Number(action.heading)
  const aimV = Number.isFinite(heading)
  if (!target || action.target === from) {
    if (rocket && aimV && shooter.alive) return applyRocket(state, { ...action, type: 'rocket' }, from, ctx)
    return { state, reply: notice('That player isn’t in this match.') }
  }
  if (!shooter.alive) return { state }
  const gate = fireGate(shooter, gun.id, rocket ? Math.max(ROCKET_GAP_MS, minShotGapMs(gun)) : minShotGapMs(gun), now, action.firedAt)
  if (!gate.ok) return { state, reply: rocket ? notice('Rocket reloading…') : undefined }
  const base = gate.shotAt ? withPlayer(state, from, { shotAt: gate.shotAt }) : state
  const a = posOf(from)
  const b = posOf(action.target)
  // A rocket that doesn't hit its target still flies on and explodes.
  const miss = (text, distClaim) => {
    if (rocket && aimV && a) return rocketImpact(base, from, a, heading, distClaim ?? action.dist, gun, ctx, { miss: text })
    return { state: base, reply: text ? notice(text) : undefined }
  }
  if (!target.alive) return miss(`${target.name} is already tagged out.`)
  if (state.mode !== 'ffa' && shooter.team === target.team) return miss('Friendly fire is off.')
  if ((target.protectedUntil || 0) > now) return miss(`${target.name} just respawned — protected for a moment.`)
  if (!a || !b) return miss(!a ? 'Shot not counted — waiting for your GPS.' : `Shot not counted — ${target.name} has no GPS fix.`)
  const dist = distanceMeters(a, b)
  const legacyErr = (a.acc ?? 10) + (b.acc ?? 10)
  const maxRange = action.method === 'vision' ? VISION_MAX_M : MAX_RANGE_M + 30
  if (dist > maxRange && dist > legacyErr) return miss('Out of range.')
  const zone = action.zone === 'head' || action.zone === 'limb' ? action.zone : 'body'
  // Automatics batch a few rounds per action (client HIT_BATCH_MS); others send one pull.
  const cap = gun.fireMode === 'automatic' ? 5 : Math.max(1, Math.min(5, gun.shotsPerClick || 1))
  let hits
  if (aimV) {
    const err = gpsErr(a.acc, b.acc)
    const headingAcc = Number(action.headingAcc)
    const off = Math.abs(angleDelta(bearingTo(a, b), heading))
    if (action.method === 'vision') {
      // The camera saw a person; GPS + compass said who. Reject only shots fired well away from them.
      const tol = Math.max(HOST_VISION_MIN_DEG, visionTolerance(dist, a.acc, b.acc, headingAcc) + HOST_AIM_SLACK_DEG)
      if (off > tol && dist > err) return miss('Shot not counted — you weren’t facing them.', dist)
      hits = clampHits(action.hits, cap)
    } else {
      // Compass: the host checks the cone and rolls the dice (the client's own roll is ignored).
      const reach = Math.min(gun.range || 60, COMPASS_MAX_RANGE_M)
      if (dist > reach + Math.min(15, err)) return miss('Out of range.', dist)
      const tol = compassTolerance(dist, a.acc, b.acc, headingAcc)
      if (off > tol + HOST_AIM_SLACK_DEG) return miss('Miss', dist)
      const shots = clampHits(action.shots ?? action.hits, cap)
      const chance = hitChance(dist, gun.accuracy || 0, Math.min(1, off / tol), err) * (action.snap ? 0.6 : 1)
      hits = 0
      for (let i = 0; i < shots; i++) if (rand() < chance) hits += 1
      if (!hits) return miss('Miss', dist)
    }
  } else {
    if (typeShot || !LEGACY_AIM_OK) return { state: base }
    hits = clampHits(action.hits, cap)
  }
  // Damage is the host's call: weapon + zone + distance (never the client's number).
  const per = zoneDamage(zone, { damageMultiplier: Math.max(0.3, Math.min(3, gun.damageMultiplier || 1)) }, dist)
  const damage = Math.max(1, Math.min(MAX_HP, per * hits))
  const hp = Math.max(0, target.hp - damage)
  const killed = hp <= 0
  const snd = state.mode === 'snd'
  const head = zone === 'head'
  const sh = base.players[from]
  const players = {
    ...base.players,
    [from]: {
      ...sh,
      hits: sh.hits + hits,
      headshots: (sh.headshots || 0) + (head ? 1 : 0),
      score: sh.score + hits * 10 + (head ? 10 : 0) + (killed ? 100 : 0),
      kills: sh.kills + (killed ? 1 : 0),
    },
    [action.target]: {
      ...target,
      hp,
      alive: !killed,
      deaths: target.deaths + (killed ? 1 : 0),
      respawnAt: killed && !snd ? now + RESPAWN_MS : null,
    },
  }
  let next = { ...base, players }
  if (killed) {
    next.feed = pushFeed(state, `${shooter.name} ${rocket ? '🚀💥' : head ? '🎯' : '⟶'} ${target.name}${head && !rocket ? ' (headshot)' : ''}`, now)
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
  const dealt = Math.min(damage, target.hp)
  const weapon = typeof action.weapon === 'string' ? action.weapon.slice(0, 24) : undefined
  const notify = [{ to: action.target, data: { by: shooter.name || 'Someone', byId: from, zone: rocket ? 'rocket' : zone, damage: dealt, killed, ...(weapon ? { weapon } : {}) } }]
  // Rocket: the blast at the target splashes everyone near them.
  let splashHits = []
  if (rocket) {
    const r = blast(next, from, [b], { ...ROCKET_BLAST, exclude: action.target }, ctx)
    next = r.state
    splashHits = r.hits
    notify.push(...notifyFor(splashHits, shooter.name, from, 'rocket', 'rocket'))
  }
  const data = { name: target.name, killed, zone, hits, damage: dealt, splash: splashHits.length ? splashHits : undefined }
  if (rocket) Object.assign(data, { rocket: true, lat: round6(b.lat), lng: round6(b.lng), dist: Math.round(dist * 10) / 10 })
  return { state: next, reply: { type: 'hit_ok', data }, notify }
}
