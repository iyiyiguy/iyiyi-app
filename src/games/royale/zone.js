// Gas zone schedule (pure). The host builds it once at the start of a match and it is
// shared in the game state; every phone then derives the current safe circle, the next
// circle and the countdowns from it with the host clock.
//
// Schedule entries (z[]):
//   z[0]            the starting area { lat, lng, r, w, s, e } (w = s = e = match start)
//   z[1..N]         shrinking circles: announced at w, the gas moves from s to e
//   z[N+1]          the final collapse (r → ~0), so a match always ends
// Each entry also carries d = gas damage per second while that phase is active.
import {
  COLLAPSE_MS, FINAL_HOLD_MS, FINAL_RADIUS_M, GAS_DPS, GAS_SPEED, PACE, ZONE_PHASES,
} from './constants'
import { dist, lerpCircle, randomPointInCircle, validPos } from './geo'

const round6 = (v) => Math.round(v * 1e6) / 1e6

export function generateZoneSchedule({ center, r0, areaId, pace = 'normal', startsAt, phases = ZONE_PHASES, rand = Math.random }) {
  const R0 = Math.max(FINAL_RADIUS_M * 2, Number(r0) || 1609)
  const p = PACE[pace] || PACE.normal
  const speed = Math.max(0.5, (GAS_SPEED[areaId] || 1.2) * p.speed)
  const out = [{ lat: round6(center.lat), lng: round6(center.lng), r: Math.round(R0), w: startsAt, s: startsAt, e: startsAt, d: GAS_DPS[0] }]
  let t = startsAt
  let prev = out[0]
  for (let i = 1; i <= phases; i++) {
    const r = R0 * Math.pow(FINAL_RADIUS_M / R0, i / phases)
    const c = randomPointInCircle(prev, Math.max(0, prev.r - r) * 0.95, rand)
    const offset = dist(prev, c)
    const travel = Math.max(0, prev.r - r) + (Number.isFinite(offset) ? offset : 0)
    const shrinkMs = Math.max(30000, (travel / speed) * 1000)
    // Drop-in time before the first shrink scales with the area; later waits with the shrink.
    const waitMs = i === 1
      ? Math.min(600000, (90 + R0 / 20) * 1000) * p.wait
      : Math.max(40000, Math.min(240000, shrinkMs * 0.6)) * p.wait
    const entry = {
      lat: round6(c.lat),
      lng: round6(c.lng),
      r: Math.round(r),
      w: Math.round(t),
      s: Math.round(t + waitMs),
      e: Math.round(t + waitMs + shrinkMs),
      d: GAS_DPS[Math.min(i, GAS_DPS.length - 2)],
    }
    out.push(entry)
    t = entry.e
    prev = entry
  }
  out.push({ lat: prev.lat, lng: prev.lng, r: 1, w: Math.round(t), s: Math.round(t + FINAL_HOLD_MS), e: Math.round(t + FINAL_HOLD_MS + COLLAPSE_MS), d: GAS_DPS[GAS_DPS.length - 1] })
  return out
}

const okEntry = (z) => validPos(z) && Number.isFinite(z.r) && Number.isFinite(z.w) && Number.isFinite(z.s) && Number.isFinite(z.e)

/** Sanitised schedule from (untrusted) state, or null. */
export function readSchedule(z) {
  if (!Array.isArray(z) || z.length < 2) return null
  return z.every(okEntry) ? z : null
}

/**
 * Where the gas is at `now`.
 * @returns {{ phase, phases, stage: 'wait'|'shrink'|'final', current, next, msToShrink, msToEnd, dps, isFinal }} | null
 *   current/next are { lat, lng, r }; next is null once the final circle has closed.
 */
export function zoneAt(z, now) {
  const sched = readSchedule(z)
  if (!sched) return null
  const n = sched.length - 1
  let i = 1
  while (i < n && now >= sched[i].e) i += 1
  const prev = sched[i - 1]
  const cur = sched[i]
  if (now >= cur.e) {
    // Past the end of the collapse: zone is a point; everyone outside takes max damage.
    return { phase: n, phases: n, stage: 'final', current: { lat: cur.lat, lng: cur.lng, r: cur.r }, next: null, msToShrink: 0, msToEnd: 0, dps: cur.d, isFinal: true }
  }
  if (now < cur.s) {
    return {
      phase: i,
      phases: n,
      stage: 'wait',
      current: { lat: prev.lat, lng: prev.lng, r: prev.r },
      next: { lat: cur.lat, lng: cur.lng, r: cur.r },
      msToShrink: cur.s - now,
      msToEnd: cur.e - now,
      dps: prev.d,
      isFinal: i === n,
    }
  }
  const f = (now - cur.s) / Math.max(1, cur.e - cur.s)
  return {
    phase: i,
    phases: n,
    stage: 'shrink',
    current: lerpCircle(prev, cur, f),
    next: { lat: cur.lat, lng: cur.lng, r: cur.r },
    msToShrink: 0,
    msToEnd: cur.e - now,
    dps: cur.d,
    isFinal: i === n,
  }
}

/** Metres outside the safe circle (0 or less = safe). */
export function outsideBy(pos, circle) {
  if (!validPos(pos) || !circle) return -Infinity
  const d = dist(pos, circle)
  return Number.isFinite(d) ? d - circle.r : -Infinity
}
