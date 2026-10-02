// Host-side rules for Battle Royale. Pure-ish functions: (state, input) → next state.
// Only the host runs these; the result is broadcast as the authoritative state.
//
// State (kept compact — it is re-broadcast whenever it changes, to up to 100 phones):
// {
//   game: 'royale', round, phase: 'countdown' | 'playing' | 'ended',
//   startedAt, startsAt, endedAt,
//   area: { lat, lng, r, id }, z: zone schedule (see zone.js),
//   p: { [id]: { n: name, hp, a: 1|0 alive, k: kills, tr: 1|0 in transit, pri: weaponId|null,
//                pl: placement (0 while alive), el: eliminatedAt, by: 'name' | 'gas' | 'left' | null } },
//   loot: [{ id, w, lat, lng }], ls: loot id counter,
//   feed: [{ id, t }], alive, total, winner
// }
// Host-only bookkeeping that doesn't need to be broadcast (tick timing, last GPS fix per
// player, transit trackers, shot spam guards) lives in a `mem` object the caller keeps.
import {
  COUNTDOWN_MS, HIT_RANGE_SLACK_M, MAX_HP, MAX_LOOT, NO_GPS_ELIMINATE_MS, PICKUP_RANGE_M, VISION_MAX_M, areaRadius,
} from './constants'
import { generateZoneSchedule, outsideBy, zoneAt } from './zone'
import { dist, randomPointInCircle, validPos } from './geo'
import { START_WEAPON_IDS, computeDamage, getWeapon, isKnownWeapon, minShotGapMs, rollLootWeapon, shotsPerPull } from './weaponsAdapter'
import { TransitTracker } from './useTransit'

export const gpsSlack = (acc) => Math.min(12, Math.max(3, (Number.isFinite(acc) ? acc : 10) / 2))

export function newHostMem() {
  return { lastTickAt: null, lastPosAt: {}, lastFixAt: {}, clientTransit: {}, trackers: {}, lastShot: {}, startedFor: null }
}

const r6 = (v) => Math.round(v * 1e6) / 1e6
const round1 = (v) => Math.round(v * 10) / 10

/** The match centre: the host's chosen area, else the host's own position. */
export function pickCenter(info, hostPos) {
  const a = info?.settings?.area
  if (a && validPos(a)) return { lat: a.lat, lng: a.lng }
  if (validPos(hostPos)) return { lat: hostPos.lat, lng: hostPos.lng }
  return null
}

export function initialState({ roster, info, now, center, rand = Math.random }) {
  const s = info?.settings || {}
  const areaId = s.areaId || s.area?.preset || '1mi'
  const r0 = areaRadius(areaId)
  const startsAt = now + COUNTDOWN_MS
  const z = generateZoneSchedule({ center, r0, areaId, pace: s.pace || 'normal', startsAt, rand })
  const p = {}
  for (const pl of roster || []) {
    if (!pl?.id) continue
    p[pl.id] = { n: String(pl.username || 'Player').slice(0, 24), hp: MAX_HP, a: 1, k: 0, tr: 0, pri: null, pl: 0, el: 0, by: null }
  }
  const total = Object.keys(p).length
  // Weapon caches scattered around the starting area.
  const count = Math.max(6, Math.min(60, Math.round(total * 0.8) + 4))
  const loot = []
  for (let i = 0; i < count; i++) {
    const pt = randomPointInCircle(center, r0 * 0.9, rand)
    loot.push({ id: `L${i + 1}`, w: rollLootWeapon(rand), lat: r6(pt.lat), lng: r6(pt.lng) })
  }
  return {
    game: 'royale',
    round: info?.round || 1,
    phase: 'countdown',
    startedAt: now,
    startsAt,
    endedAt: null,
    area: { lat: r6(center.lat), lng: r6(center.lng), r: Math.round(r0), id: areaId },
    z,
    p,
    loot,
    ls: count,
    feed: [],
    alive: total,
    total,
    winner: null,
  }
}

function pushFeed(feed, text, now) {
  return [{ id: `${now}-${Math.floor(Math.random() * 1e6)}`, t: String(text).slice(0, 80) }, ...(feed || [])].slice(0, 6)
}

// Eliminate several players at once (sorted so the one with the least health goes first).
// Mutates `next` (a fresh copy made by the caller).
function eliminate(next, deaths, now, posOf) {
  deaths.sort((a, b) => (a.hpBefore - b.hpBefore) || ((next.p[a.id]?.k || 0) - (next.p[b.id]?.k || 0)))
  for (const d of deaths) {
    const pl = next.p[d.id]
    if (!pl || !pl.a) continue
    const placement = next.alive
    next.p[d.id] = { ...pl, a: 0, hp: 0, el: now, pl: placement, by: d.by, tr: 0 }
    next.alive = Math.max(0, next.alive - 1)
    // Drop the picked-up weapon where they fell.
    const pos = posOf(d.id)
    if (pl.pri && validPos(pos) && next.loot.length < MAX_LOOT) {
      next.ls = (next.ls || 0) + 1
      next.loot = [...next.loot, { id: `L${next.ls}`, w: pl.pri, lat: r6(pos.lat), lng: r6(pos.lng) }]
    }
    const why = d.by === 'gas' ? 'was taken by the gas' : d.by === 'left' ? 'left the match' : d.by === 'signal' ? 'lost GPS signal' : `was eliminated by ${d.by}`
    next.feed = pushFeed(next.feed, `${pl.n} ${why} · #${placement}`, now)
  }
  if (next.alive <= 1 && next.phase === 'playing') {
    const last = Object.keys(next.p).find((id) => next.p[id].a)
    if (last) {
      next.p[last] = { ...next.p[last], pl: 1 }
      next.winner = last
    } else {
      next.winner = Object.keys(next.p).find((id) => next.p[id].pl === 1) || null
    }
    next.phase = 'ended'
    next.endedAt = now
    if (next.winner) next.feed = pushFeed(next.feed, `${next.p[next.winner].n} is the last one standing!`, now)
  }
}

/**
 * One host tick (about once a second).
 * @param ctx { now, presentIds: Set, posOf: id => pos|null, mem }
 * @returns the same state object when nothing changed.
 */
export function tick(state, { now, presentIds, posOf, mem }) {
  if (!state || state.game !== 'royale') return state
  if (state.phase === 'countdown') {
    if (now < state.startsAt) return state
    mem.lastTickAt = now
    return { ...state, phase: 'playing' }
  }
  if (state.phase !== 'playing') return state

  const dt = mem.lastTickAt ? Math.max(0, Math.min(3, (now - mem.lastTickAt) / 1000)) : 0
  mem.lastTickAt = now
  const zone = zoneAt(state.z, now)
  let changed = false
  const players = { ...state.p }
  const deaths = []

  for (const id of Object.keys(players)) {
    const pl = players[id]
    if (!pl.a) continue
    // Left the room for good.
    if (presentIds && !presentIds.has(id)) {
      deaths.push({ id, by: 'left', hpBefore: pl.hp })
      continue
    }
    const pos = posOf(id)
    if (validPos(pos)) {
      if (mem.lastFixAt[id] !== pos.at) {
        mem.lastFixAt[id] = pos.at
        const tr = mem.trackers[id] || (mem.trackers[id] = new TransitTracker())
        tr.push({ lat: pos.lat, lng: pos.lng, acc: pos.acc, at: pos.at }, now)
      }
      mem.lastPosAt[id] = now
    } else {
      if (mem.lastPosAt[id] == null) mem.lastPosAt[id] = now
      if (now - mem.lastPosAt[id] > NO_GPS_ELIMINATE_MS) {
        deaths.push({ id, by: 'signal', hpBefore: pl.hp })
        continue
      }
    }
    mem.trackers[id]?.evaluate(now)
    const tr = mem.clientTransit[id] || mem.trackers[id]?.inTransit ? 1 : 0
    let hp = pl.hp
    if (zone && validPos(pos) && dt > 0) {
      const out = outsideBy(pos, zone.current) - gpsSlack(pos.acc)
      if (out > 0) hp = round1(Math.max(0, hp - zone.dps * dt))
    }
    if (hp !== pl.hp || tr !== pl.tr) {
      players[id] = { ...pl, hp, tr }
      changed = true
    }
    if (hp <= 0) deaths.push({ id, by: 'gas', hpBefore: pl.hp })
  }

  if (!changed && !deaths.length && state.alive > 1) return state
  // (alive <= 1 with no deaths: everyone else quit before the start — end the match.)
  const next = { ...state, p: players }
  eliminate(next, deaths, now, posOf)
  return next
}

/**
 * A player's action.
 * @returns {{ state, reply? }} reply: { type, data } for the sender.
 */
export function applyAction(state, action, from, { now, posOf, mem }) {
  if (!state || state.game !== 'royale' || !action || typeof action !== 'object') return { state }
  const me = state.p?.[from]
  if (!me) return { state }

  if (action.type === 'tr') {
    mem.clientTransit[from] = !!action.on
    const tr = action.on || mem.trackers[from]?.inTransit ? 1 : 0
    if (tr === me.tr || !me.a) return { state }
    return { state: { ...state, p: { ...state.p, [from]: { ...me, tr } } } }
  }

  if (state.phase !== 'playing' || !me.a) return { state }

  if (action.type === 'hit') {
    const target = state.p[action.t]
    if (!target || action.t === from || !target.a) return { state }
    if (me.tr || mem.clientTransit[from]) return { state, reply: { type: 'notice', data: { text: 'Firing is disabled in transit' } } }
    if (target.tr) return { state, reply: { type: 'notice', data: { text: `${target.n} is in transit and can’t be hit` } } }
    const wid = String(action.w || '')
    if (!isKnownWeapon(wid) || !(START_WEAPON_IDS.includes(wid) || me.pri === wid)) return { state }
    const weapon = getWeapon(wid)
    const last = mem.lastShot[from] || 0
    if (now - last < minShotGapMs(weapon)) return { state }
    mem.lastShot[from] = now
    const a = posOf(from)
    const b = posOf(action.t)
    const d = dist(a, b)
    if (!Number.isFinite(d)) return { state }
    const maxRange = action.m === 'vision' ? Math.min(VISION_MAX_M, weapon.range + HIT_RANGE_SLACK_M) : weapon.range + HIT_RANGE_SLACK_M
    if (d > maxRange) return { state }
    const zone = action.z === 'head' || action.z === 'limb' ? action.z : 'body'
    const beams = Math.max(1, Math.min(shotsPerPull(weapon), Math.round(Number(action.n) || 1)))
    const dmg = Math.max(1, computeDamage(zone, wid, d) * beams)
    const hp = round1(Math.max(0, target.hp - dmg))
    const next = { ...state, p: { ...state.p, [action.t]: { ...target, hp } } }
    const killed = hp <= 0
    if (killed) {
      next.p[from] = { ...me, k: (me.k || 0) + 1 }
      eliminate(next, [{ id: action.t, by: me.n, hpBefore: target.hp }], now, posOf)
    }
    return { state: next, reply: { type: 'hit_ok', data: { dmg: Math.round(dmg), killed, name: target.n, zone } } }
  }

  if (action.type === 'pick') {
    if (me.tr) return { state, reply: { type: 'notice', data: { text: 'Can’t pick up loot in transit' } } }
    const item = (state.loot || []).find((l) => l.id === action.id)
    if (!item) return { state, reply: { type: 'notice', data: { text: 'Someone already took that' } } }
    const pos = posOf(from)
    const d = dist(pos, item)
    if (!Number.isFinite(d) || d > PICKUP_RANGE_M + gpsSlack(pos?.acc)) return { state, reply: { type: 'notice', data: { text: 'Get closer to pick it up' } } }
    let loot = state.loot.filter((l) => l.id !== item.id)
    let ls = state.ls || 0
    if (me.pri && me.pri !== item.w) {
      ls += 1
      loot = [...loot, { id: `L${ls}`, w: me.pri, lat: item.lat, lng: item.lng }]
    }
    return {
      state: { ...state, loot, ls, p: { ...state.p, [from]: { ...me, pri: item.w } } },
      reply: { type: 'picked', data: { w: item.w } },
    }
  }

  return { state }
}

export { COUNTDOWN_MS }
