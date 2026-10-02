// Small geo helpers for Battle Royale (pure, never throw on bad input).
import { bearingDeg, compassLabel, distanceMeters, formatDistance } from '../../lib/multiplayer'

export const isValidCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

export const validPos = (p) => !!p && isValidCoord(p.lat, p.lng)

export function dist(a, b) {
  if (!validPos(a) || !validPos(b)) return Infinity
  const d = distanceMeters(a, b)
  return Number.isFinite(d) ? d : Infinity
}

const M_PER_DEG_LAT = 111320

// Point `m` metres from `c` at compass bearing `deg`.
export function offsetPoint(c, m, deg) {
  const r = (deg * Math.PI) / 180
  const dLat = (Math.cos(r) * m) / M_PER_DEG_LAT
  const cosLat = Math.max(0.01, Math.cos((c.lat * Math.PI) / 180))
  const dLng = (Math.sin(r) * m) / (M_PER_DEG_LAT * cosLat)
  return { lat: c.lat + dLat, lng: c.lng + dLng }
}

// Uniform random point inside a circle of radius `r` around `c`.
export function randomPointInCircle(c, r, rand = Math.random) {
  const m = Math.sqrt(rand()) * Math.max(0, r)
  return offsetPoint(c, m, rand() * 360)
}

// Linear interpolation between two circles (small distances: lat/lng lerp is fine).
export function lerpCircle(a, b, f) {
  const t = Math.max(0, Math.min(1, f))
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, r: a.r + (b.r - a.r) * t }
}

// "0.8 mi north" from `me` to the edge of `circle` (or null when inside).
export function directionToCircle(me, circle) {
  if (!validPos(me) || !validPos(circle)) return null
  const d = dist(me, circle)
  if (!Number.isFinite(d)) return null
  const outside = d - circle.r
  if (outside <= 0) return null
  const dir = DIRS[compassLabel(bearingDeg(me, circle))] || 'ahead'
  return { meters: outside, dir, text: `${formatDistance(outside)} ${dir}` }
}

const DIRS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' }
export const dirWord = (deg) => DIRS[compassLabel(deg)] || 'ahead'

export function formatMiles(m) {
  if (!Number.isFinite(m)) return '—'
  const mi = m / 1609.34
  if (mi < 0.1) return formatDistance(m)
  return `${mi.toFixed(1)} miles`
}

export { formatDistance, bearingDeg }
