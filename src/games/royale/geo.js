// Small geo helpers for Battle Royale (pure, never throw on bad input).
import { bearingDeg, compassLabel, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { translate } from '../../i18n'
import S from '../../i18n/strings/royale'

const tr = (k, v) => translate(S, k, v)

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
  const dir = tr(DIRS[compassLabel(bearingDeg(me, circle))] || 'dir_ahead')
  return { meters: outside, dir, text: tr('dist_dir', { d: formatDistance(outside), dir }) }
}

// Direction words in the viewer's language (i18n/strings/royale.js dir_*).
const DIRS = { N: 'dir_north', NE: 'dir_northeast', E: 'dir_east', SE: 'dir_southeast', S: 'dir_south', SW: 'dir_southwest', W: 'dir_west', NW: 'dir_northwest' }
export const dirWord = (deg) => tr(DIRS[compassLabel(deg)] || 'dir_ahead')
/** "450 ft north" in the viewer's language. */
export const distDir = (d, dir) => tr('dist_dir', { d, dir })

export function formatMiles(m) {
  if (!Number.isFinite(m)) return '—'
  const mi = m / 1609.34
  if (mi < 0.1) return formatDistance(m)
  return tr('miles', { n: mi.toFixed(1) })
}

export { formatDistance, bearingDeg }
