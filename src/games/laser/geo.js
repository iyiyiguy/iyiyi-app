// Small, dependency-free geo helpers for Laser Tag (host engine + AR projection). Kept here
// (not in lib/multiplayer) so the host rules and the AR maths can run headless in tests.
const EARTH_R = 6371000
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

/** Great-circle bearing a → b in degrees (0 = north, clockwise). */
export function bearingTo(a, b) {
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Signed difference a − b in degrees, -180..180 (+ = a is clockwise / to the right of b). */
export const angleDelta = (a, b) => ((((a - b) % 360) + 540) % 360) - 180

/** The point `meters` from `pos` along `bearingDeg`. */
export function destination(pos, bearingDeg, meters) {
  const d = meters / EARTH_R
  const b = toRad(bearingDeg)
  const la1 = toRad(pos.lat)
  const lo1 = toRad(pos.lng)
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return { lat: toDeg(la2), lng: ((toDeg(lo2) + 540) % 360) - 180 }
}

export const round6 = (v) => Math.round(v * 1e6) / 1e6
