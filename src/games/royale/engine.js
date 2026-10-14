// Host-side rules for Battle Royale. Pure-ish functions: (state, input) → next state.
// Only the host runs these; the result is broadcast as the authoritative state.
//
// State (kept compact — it is re-broadcast whenever it changes, to up to 100 phones):
// {
//   game: 'royale', round, phase: 'countdown' | 'playing' | 'ended',
//   startedAt, startsAt, endedAt,
//   area: { lat, lng, r, id }, z: zone schedule (see zone.js),
//   p: { [id]: { n: name, hp, a: 1|0 alive, k: kills, tr: 1|0 in transit, pri: weaponId|null,
//                sec?: weaponId|null (2nd weapon slot), pl: placement (0 while alive),
//                el: eliminatedAt, by: 'name' | 'gas' | 'left' | null,
//                tg?: seconds of transit gas pause used (absent = 0) } },
//     Everyone always has their fists (MELEE_ID) plus up to MAX_GUN_SLOTS picked-up weapons.
//   loot: [{ id, w, lat, lng, s?: 1 supply-drop item }], ls: loot id counter,
//   lp: last zone phase that got its loot drop, sp: last phase that got a supply drop,
//   drop: { id, lat, lng, ph, at } | null — the latest supply drop (for the map / callout),
//   feed: [{ id, t, v?: victim, k?: killer name, c?: 'kill'|'gas'|'left'|'signal', pl?: placement }],
//   alive, total, winner
// }
// Host-only bookkeeping that doesn't need to be broadcast (tick timing, last GPS fix per
// player, transit trackers, shot spam guards) lives in a `mem` object the caller keeps.
import {
  COUNTDOWN_MS, HIT_RANGE_SLACK_M, LOOT_PER_KM2, LOOT_PER_PLAYER, LOOT_START_MAX, LOOT_START_MIN, MAX_GUN_SLOTS, MAX_HP, MAX_LOOT,
  MELEE_ID, NO_GPS_ELIMINATE_MS, PHASE_DROPS_MAX, PHASE_DROPS_MIN, PHASE_DROPS_PER_ALIVE, PICKUP_RANGE_M, ROCKET_RADIUS_M,
  ROCKET_SLACK_CAP_M, ROCKET_SPLASH_MAX, ROCKET_SPLASH_MIN, SUPPLY_ITEMS, TRANSIT_GAS_GRACE_MS, VISION_MAX_M, resolveArea,
} from './constants'
import { generateZoneSchedule, outsideBy, zoneAt } from './zone'
import { dist, randomPointInCircle, validPos } from './geo'
import { computeDamage, getWeapon, isKnownWeapon, minShotGapMs, rarityRank, rollLootWeapon, shotsPerPull } from './weaponsAdapter'
import { meleeHostReach } from './melee'
import { TransitTracker } from './useTransit'

export const gpsSlack = (acc) => Math.min(12, Math.max(3, (Number.isFinite(acc) ? acc : 10) / 2))

export function newHostMem() {
  return { lastTickAt: null, lastPosAt: {}, lastFixAt: {}, lastGood: {}, clientTransit: {}, trackers: {}, lastShot: {}, startedFor: null }
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

// ---- loot placement ----------------------------------------------------------------

/** How many weapons are scattered over the starting zone: per player + per km², clamped. */
export function startLootCount(players, r0) {
  const km2 = (Math.PI * (Number(r0) || 0) ** 2) / 1e6
  const n = Math.round((players || 0) * LOOT_PER_PLAYER + km2 * LOOT_PER_KM2)
  return Math.max(LOOT_START_MIN, Math.min(LOOT_START_MAX, n))
}

/** Weapons dropped into the next circle when a new zone is announced. */
export const phaseDropCount = (alive) => Math.max(PHASE_DROPS_MIN, Math.min(PHASE_DROPS_MAX, Math.round((alive || 0) * PHASE_DROPS_PER_ALIVE) + PHASE_DROPS_MIN))

// n random weapons uniformly inside `circle` (kept off its very edge). Mutates next.ls.
function scatter(next, circle, n, rand, roll, extra) {
  const out = []
  for (let i = 0; i < n; i++) {
    const pt = randomPointInCircle(circle, Math.max(0, circle.r * 0.9), rand)
    if (!validPos(pt)) continue
    next.ls = (next.ls || 0) + 1
    out.push({ id: `L${next.ls}`, w: roll(), lat: r6(pt.lat), lng: r6(pt.lng), ...(extra || null) })
  }
  return out
}

/**
 * Keep at most `max` items: the ones furthest out in the gas go first, then the oldest.
 * (Weapons lying deep in the gas are practically unreachable.)
 */
export function trimLoot(loot, circle, max = MAX_LOOT) {
  if (!Array.isArray(loot) || loot.length <= max) return loot
  const out = (l) => (circle && validPos(l) ? dist(l, circle) - circle.r : 0)
  const order = loot.map((l, i) => ({ l, i, o: out(l) })).sort((a, b) => (b.o - a.o) || (a.i - b.i))
  const drop = new Set(order.slice(0, loot.length - max).map((x) => x.l.id))
  return loot.filter((l) => !drop.has(l.id))
}

export function initialState({ roster, info, now, center, rand = Math.random }) {
  const s = info?.settings || {}
  // Any preset or a custom radius (clamped to 100 m - 16 km); no public cap.
  const { id: areaId, r: r0 } = resolveArea(s)
  const startsAt = now + COUNTDOWN_MS
  const z = generateZoneSchedule({ center, r0, areaId, pace: s.pace || 'normal', startsAt, rand })
  const p = {}
  for (const pl of roster || []) {
    if (!pl?.id) continue
    p[pl.id] = { n: String(pl.username || 'Player').slice(0, 24), hp: MAX_HP, a: 1, k: 0, tr: 0, pri: null, pl: 0, el: 0, by: null }
  }
  const total = Object.keys(p).length
  // Weapons scattered at random across the starting zone (everyone starts with fists only).
  const holder = { ls: 0 }
  const loot = scatter(holder, { lat: center.lat, lng: center.lng, r: r0 }, startLootCount(total, r0), rand, () => rollLootWeapon(rand))
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
    ls: holder.ls,
    lp: 1,
    sp: 0,
    drop: null,
    feed: [],
    alive: total,
    total,
    winner: null,
  }
}

// Feed entries keep the plain sentence (t) for older clients plus structured parts the HUD
// colours: victim (v), killer name (k), cause (c) and placement (pl).
function pushFeed(feed, text, now, extra) {
  return [{ id: `${now}-${Math.floor(Math.random() * 1e6)}`, t: String(text).slice(0, 80), ...(extra || {}) }, ...(feed || [])].slice(0, 6)
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
    // Drop the picked-up weapons where they fell (a little apart so both can be seen).
    const pos = posOf(d.id)
    if (validPos(pos)) {
      const guns = [pl.pri, pl.sec].filter((w) => w && w !== MELEE_ID)
      guns.forEach((w, k) => {
        if (next.loot.length >= MAX_LOOT) return
        next.ls = (next.ls || 0) + 1
        next.loot = [...next.loot, { id: `L${next.ls}`, w, lat: r6(pos.lat + k * 0.00002), lng: r6(pos.lng) }]
      })
    }
    const why = d.by === 'gas' ? 'was taken by the gas' : d.by === 'left' ? 'left the match' : d.by === 'signal' ? 'lost GPS signal' : `was eliminated by ${d.by}`
    const cause = d.by === 'gas' || d.by === 'left' || d.by === 'signal' ? d.by : 'kill'
    next.feed = pushFeed(next.feed, `${pl.n} ${why} · #${placement}`, now, { v: pl.n, c: cause, pl: placement, ...(cause === 'kill' ? { k: String(d.by).slice(0, 24) } : null) })
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
    if (next.winner) next.feed = pushFeed(next.feed, `${next.p[next.winner].n} is the last one standing!`, now, { v: next.p[next.winner].n, c: 'win', pl: 1 })
  }
}

/**
 * One host tick (about once a second).
 * @param ctx { now, presentIds: Set, posOf: id => pos|null, mem }
 * @returns the same state object when nothing changed.
 */
export function tick(state, { now, presentIds, posOf, mem, rand = Math.random }) {
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
    const good = mem.lastGood || (mem.lastGood = {})
    if (validPos(pos)) {
      good[id] = pos
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
    let tg = pl.tg || 0
    // In a transit lock the gas is paused (nobody should feel they have to drive, or be killed
    // for being driven), up to TRANSIT_GAS_GRACE_MS per match so it can't be a hiding place.
    const gasPaused = tr === 1 && tg * 1000 < TRANSIT_GAS_GRACE_MS
    if (gasPaused && dt > 0) tg = Math.round((tg + dt) * 10) / 10
    if (zone && dt > 0 && !gasPaused) {
      // Once the final circle has fully closed the gas covers everything (sudden death), so
      // two players standing inside the GPS slack of the last point can't stall the match
      // forever: the healthiest player wins. Otherwise the gas hurts anyone outside the
      // circle; a phone that stops sharing its position keeps being judged on its last fix
      // (so going dark in the gas is no escape).
      const gpos = validPos(pos) ? pos : good[id]
      const out = zone.stage === 'final' ? 1 : validPos(gpos) ? outsideBy(gpos, zone.current) - gpsSlack(gpos.acc) : -1
      if (out > 0) hp = round1(Math.max(0, hp - zone.dps * dt))
    }
    if (hp !== pl.hp || tr !== pl.tr || tg !== (pl.tg || 0)) {
      players[id] = tg ? { ...pl, hp, tr, tg } : { ...pl, hp, tr }
      changed = true
    }
    if (hp <= 0) deaths.push({ id, by: 'gas', hpBefore: pl.hp })
  }

  const drops = zone ? zoneDrops(state, zone, now, rand) : null
  if (!changed && !deaths.length && !drops && state.alive > 1) return state
  // (alive <= 1 with no deaths: everyone else quit before the start — end the match.)
  const next = { ...state, p: players, ...(drops || null) }
  eliminate(next, deaths, now, posOf)
  return next
}

/**
 * Loot that arrives as the zone moves: a few weapons dropped into each newly announced circle
 * (better odds every phase), and a supply drop (epic / legendary) inside the next circle when
 * the gas starts moving on phases 1, 3 and 5. Returns the changed fields or null.
 */
export function zoneDrops(state, zone, now, rand = Math.random) {
  if (!zone?.next || zone.isFinal || !(zone.next.r >= 20)) return null
  const lp = Number.isFinite(state.lp) ? state.lp : 1
  const sp = Number.isFinite(state.sp) ? state.sp : 0
  const phaseDrop = zone.phase > lp
  const supply = zone.stage === 'shrink' && zone.phase > sp && zone.phase % 2 === 1
  if (!phaseDrop && !supply) return null
  const next = { ls: state.ls || 0 }
  let loot = [...(state.loot || [])]
  const out = {}
  if (phaseDrop) {
    const tier = zone.phase - 1
    loot = loot.concat(scatter(next, zone.next, phaseDropCount(state.alive), rand, () => rollLootWeapon(rand, { tier })))
    out.lp = zone.phase
  }
  if (supply) {
    // One crate somewhere inside the next circle (its items sit together).
    const at = randomPointInCircle(zone.next, zone.next.r * 0.7, rand)
    if (validPos(at)) {
      const crate = { lat: at.lat, lng: at.lng, r: 4 }
      const items = scatter(next, crate, SUPPLY_ITEMS, rand, () => rollLootWeapon(rand, { tier: zone.phase + 2, minRarity: 'epic' }), { s: 1 })
      loot = loot.concat(items)
      out.drop = { id: `S${zone.phase}`, lat: r6(at.lat), lng: r6(at.lng), ph: zone.phase, at: now }
    }
    out.sp = zone.phase
  }
  return { ...out, loot: trimLoot(loot, zone.current), ls: next.ls }
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
    if (!isKnownWeapon(wid) || !(wid === MELEE_ID || me.pri === wid || me.sec === wid)) return { state }
    const weapon = getWeapon(wid)
    const last = mem.lastShot[from] || 0
    if (now - last < minShotGapMs(weapon)) return { state }
    mem.lastShot[from] = now
    const a = posOf(from)
    const b = posOf(action.t)
    const d = dist(a, b)
    if (!Number.isFinite(d)) return { state }
    const maxRange = weapon.melee
      ? meleeHostReach(action.m, a?.acc, b?.acc)
      : action.m === 'vision' ? Math.min(VISION_MAX_M, weapon.range + HIT_RANGE_SLACK_M) : weapon.range + HIT_RANGE_SLACK_M
    if (d > maxRange) return { state, ...(weapon.melee ? { reply: { type: 'notice', data: { text: 'Too far to punch — get closer' } } } : null) }
    const zone = action.z === 'head' || action.z === 'limb' ? action.z : 'body'
    const beams = Math.max(1, Math.min(shotsPerPull(weapon), Math.round(Number(action.n) || 1)))
    const dmg = Math.max(1, computeDamage(zone, wid, d) * beams)
    const hp = round1(Math.max(0, target.hp - dmg))
    const next = { ...state, p: { ...state.p, [action.t]: { ...target, hp } } }
    const killed = hp <= 0
    const deaths = killed ? [{ id: action.t, by: me.n, hpBefore: target.hp }] : []
    // Rockets (Laser Tag rules): the blast at the target splashes everyone else near them.
    let splash = 0
    if (weapon.blastRadius > 0 && validPos(b)) {
      const radius = Math.min(ROCKET_RADIUS_M, weapon.blastRadius)
      for (const [id, pl] of Object.entries(next.p)) {
        if (id === from || id === action.t || !pl.a || pl.tr) continue
        const pos = posOf(id)
        const dd = validPos(pos) ? dist(pos, b) : Infinity
        const reach = radius + Math.min(ROCKET_SLACK_CAP_M, gpsSlack(pos?.acc))
        if (!(dd <= reach)) continue
        const sd = Math.round(ROCKET_SPLASH_MAX - (ROCKET_SPLASH_MAX - ROCKET_SPLASH_MIN) * Math.min(1, dd / reach))
        const shp = round1(Math.max(0, pl.hp - sd))
        next.p[id] = { ...pl, hp: shp }
        splash += 1
        if (shp <= 0) deaths.push({ id, by: me.n, hpBefore: pl.hp })
      }
    }
    if (deaths.length) {
      next.p[from] = { ...me, k: (me.k || 0) + deaths.length }
      eliminate(next, deaths, now, posOf)
    }
    return { state: next, reply: { type: 'hit_ok', data: { dmg: Math.round(dmg), killed, name: target.n, zone, ...(splash ? { splash } : null) } } }
  }

  if (action.type === 'pick') {
    if (me.tr) return { state, reply: { type: 'notice', data: { text: 'Can’t pick up loot in transit' } } }
    const item = (state.loot || []).find((l) => l.id === action.id)
    if (!item) return { state, reply: { type: 'notice', data: { text: 'Someone already took that' } } }
    const pos = posOf(from)
    const d = dist(pos, item)
    if (!Number.isFinite(d) || d > PICKUP_RANGE_M + gpsSlack(pos?.acc)) return { state, reply: { type: 'notice', data: { text: 'Get closer to pick it up' } } }
    if (!isKnownWeapon(item.w) || item.w === MELEE_ID) return { state }
    const slots = pickSlots(me, item.w, action.h)
    if (!slots) return { state, reply: { type: 'notice', data: { text: `You already carry the ${getWeapon(item.w).name}` } } }
    let loot = state.loot.filter((l) => l.id !== item.id)
    let ls = state.ls || 0
    if (slots.dropped) {
      ls += 1
      loot = [...loot, { id: `L${ls}`, w: slots.dropped, lat: item.lat, lng: item.lng }]
    }
    return {
      state: { ...state, loot, ls, p: { ...state.p, [from]: { ...me, pri: slots.pri, sec: slots.sec } } },
      reply: { type: 'picked', data: { w: item.w, ...(slots.dropped ? { dropped: slots.dropped } : null) } },
    }
  }

  return { state }
}

/**
 * Slot rules for picking up weapon `w` (fists are always there; MAX_GUN_SLOTS more):
 *   - already carried → null (nothing to do)
 *   - a free slot → it goes there
 *   - both full → it replaces the weapon you're holding (`held`, sent by the phone), or, when
 *     you're holding your fists / an old phone sent nothing, the lower-rarity weapon (2nd on a tie).
 *     The replaced weapon is dropped where the new one lay.
 * @returns {{ pri, sec, dropped }} | null
 */
export function pickSlots(me, w, held) {
  const pri = me?.pri && me.pri !== MELEE_ID ? me.pri : null
  const sec = me?.sec && me.sec !== MELEE_ID && MAX_GUN_SLOTS > 1 ? me.sec : null
  if (w === pri || w === sec) return null
  if (!pri) return { pri: w, sec, dropped: null }
  if (!sec && MAX_GUN_SLOTS > 1) return { pri, sec: w, dropped: null }
  if (MAX_GUN_SLOTS < 2) return { pri: w, sec: null, dropped: pri }
  if (held === pri) return { pri: w, sec, dropped: pri }
  if (held === sec) return { pri, sec: w, dropped: sec }
  const rp = rarityRank(getWeapon(pri).rarity)
  const rs = rarityRank(getWeapon(sec).rarity)
  return rp < rs ? { pri: w, sec, dropped: pri } : { pri, sec: w, dropped: sec }
}

export { COUNTDOWN_MS }
