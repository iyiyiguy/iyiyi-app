// Surface scanner maths for Laser Tag cover (walls, buildings, parked cars, trees...).
// Pure functions, headless-tested in aimtest (test-depth.mjs).
//
// The native module (modules/body-hit estimateDepth) returns a small grid of RELATIVE inverse
// depth from a monocular depth model (Depth Anything V2 on iOS, MiDaS on Android): bigger =
// nearer, with an unknown scale and offset (1/Z = s·o + t). We pin s and t with the GROUND:
// with the phone ~1.4 m above flat ground, pitched `pitch`, every image row below the horizon
// that shows ground has a known depth (same pinhole model as arGround.js):
//   ray (x, y, 1) with y = Y/Z (up), world up component  u = y·cos p + sin p  (< 0 = downward),
//   so the ground is met at camera depth  Z = h / −u,  the same for the whole row.
// Each row's ground value is a low percentile of the row (anything standing on the ground is
// nearer = bigger), rows are fitted by least squares with the worst ones dropped, and the fit
// has to pass plausibility checks (enough rows, a real depth span, small error, positive
// slope). Then the crosshair cells give the distance to whatever is under the crosshair:
//   'ground' (consistent with where the centre ray meets the ground), 'wall' (a surface clearly
//   in front of that: a wall, building or object used as cover), or 'open' (nothing in range).
// Anything unsure returns null and the game keeps its old rules (arGround.rocketImpactDistance).
import { PHONE_HEIGHT_M, cameraTanHalf, rocketImpactDistance } from './arGround'
import { angleDelta } from './geo'

export const DEPTH_MAX_M = 60 // nothing further than this is trusted
export const GROUND_MIN_M = 0.6
export const GROUND_MAX_M = 35 // rows near the horizon are too noisy to anchor the scale
export const COVER_MIN_M = 1 // closer than this is probably a hand / the gun / a lens smudge
export const SCAN_MAX_AGE_MS = 2500
export const SCAN_MAX_TURN_DEG = 7
export const SCAN_MAX_TILT_DEG = 6
export const LASER_COVER_MARGIN_M = 3

const rad = (d) => (d * Math.PI) / 180
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The grid's camera: tan of the half field of view across its width / height. */
export function gridCamera(grid) {
  const W = Number(grid?.imageWidth) || Number(grid?.w) || 3
  const H = Number(grid?.imageHeight) || Number(grid?.h) || 4
  return cameraTanHalf({ width: W, height: H }, 1)
}

/** Y/Z (up) through the centre of grid row j of h. */
export const rowSlope = (j, h, tanV) => (1 - (2 * (j + 0.5)) / h) * tanV

/** Camera depth at which a ray with slope `yn` (Y/Z) meets flat ground, or null (no hit). */
export function groundDepth(yn, pitchDeg, eyeM = PHONE_HEIGHT_M) {
  const p = rad(Math.max(-89.5, Math.min(89.5, Number(pitchDeg) || 0)))
  const u = yn * Math.cos(p) + Math.sin(p)
  if (!(u < -1e-3)) return null
  return eyeM / -u
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))
  return sorted[i]
}

function lsq(pts) {
  const n = pts.length
  let sx = 0
  let sy = 0
  for (const p of pts) { sx += p.x; sy += p.y }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (!(sxx > 0)) return null
  const s = sxy / sxx
  const t = my - s * mx
  let sse = 0
  for (const p of pts) sse += (p.y - (s * p.x + t)) ** 2
  const r2 = syy > 0 ? 1 - sse / syy : 0
  return { s, t, r2 }
}

/**
 * Scale the relative inverse depth to metres from the visible ground.
 * Returns { ok, why?, s, t, rows, candidates, zMin, zMax, err, r2 }.
 */
export function fitGroundScale(grid, pitchDeg, { eyeM = PHONE_HEIGHT_M, rowQuantile = 0.25 } = {}) {
  const w = grid?.w | 0
  const h = grid?.h | 0
  const data = grid?.data
  if (!(w > 0) || !(h > 0) || !Array.isArray(data) || data.length !== w * h) return { ok: false, why: 'grid' }
  if (!finite(Number(pitchDeg))) return { ok: false, why: 'pitch' }
  const { tanV } = gridCamera(grid)
  const rows = []
  for (let j = 0; j < h; j++) {
    const z = groundDepth(rowSlope(j, h, tanV), pitchDeg, eyeM)
    if (z == null || z < GROUND_MIN_M || z > GROUND_MAX_M) continue
    const vals = []
    for (let i = 0; i < w; i++) {
      const v = data[j * w + i]
      if (finite(v)) vals.push(v)
    }
    if (vals.length < Math.max(3, w * 0.5)) continue
    vals.sort((a, b) => a - b)
    rows.push({ j, z, x: quantile(vals, rowQuantile), y: 1 / z })
  }
  const candidates = rows.length
  if (candidates < 4) return { ok: false, why: 'no-ground', candidates }
  // Which rows really show ground: the ground is visible as one band of rows (a wall or
  // building hides the far rows, a hedge / car bonnet / your own feet the nearest ones), so
  // try every contiguous band (by ground depth) and keep the one with the most rows that
  // passes the checks (ties: the smaller error).
  const byNear = rows.slice().sort((a, b) => a.z - b.z)
  let best = null
  let last = null
  for (let i = 0; i + 4 <= byNear.length; i++) {
    for (let k = byNear.length; k - i >= 4; k--) {
      if (best && k - i < best.rows) break
      const r = judge(byNear.slice(i, k), rows, 0.35)
      last = r
      if (!r.ok) continue
      if (!best || r.rows > best.rows || (r.rows === best.rows && r.err < best.err)) best = r
    }
  }
  return best || { ...(last || {}), ok: false, why: last?.why || 'fit', candidates }
}

// Physics check: nothing can look FURTHER than the ground in its own row (the ground hides
// what is behind it), so every candidate row must come out at least about as near as its
// ground depth. Rows nearer than the ground are fine (something is standing there).
function judge(pts, allRows, minShare) {
  const candidates = allRows.length
  const fit = pts.length >= 4 ? lsq(pts) : null
  if (!fit) return { ok: false, why: 'flat', candidates }
  const errs = pts.map((p) => Math.abs(fit.s * p.x + fit.t - p.y) / p.y).sort((a, b) => a - b)
  const err = quantile(errs, 0.5)
  const maxErr = errs[errs.length - 1]
  const zs = pts.map((p) => p.z)
  const zMin = Math.min(...zs)
  const zMax = Math.max(...zs)
  const out = { ok: false, s: fit.s, t: fit.t, r2: fit.r2, rows: pts.length, candidates, zMin, zMax, err }
  if (!(fit.s > 0)) return { ...out, why: 'slope' }
  if (pts.length < Math.max(4, Math.ceil(candidates * minShare))) return { ...out, why: 'outliers' }
  if (zMax / zMin < 1.8) return { ...out, why: 'span' }
  for (const r of allRows) if (fit.s * r.x + fit.t < r.y * 0.8) return { ...out, why: 'beyond-ground' }
  if (!(err <= 0.06) || !(maxErr <= 0.12) || !(fit.r2 >= 0.8)) return { ...out, why: 'noisy' }
  return { ...out, ok: true }
}

/** Metres for a raw grid value under a fit (Infinity = beyond DEPTH_MAX_M / sky). */
export function depthFromValue(v, fit) {
  if (!finite(v) || !fit) return NaN
  const inv = fit.s * v + fit.t
  if (!(inv > 1 / DEPTH_MAX_M)) return Infinity
  return 1 / inv
}

/** The grid cells around the centre (2 x 2 on even grids). */
export function centreCells(w, h) {
  const cols = w % 2 === 0 ? [w / 2 - 1, w / 2] : [(w - 1) / 2]
  const rows = h % 2 === 0 ? [h / 2 - 1, h / 2] : [(h - 1) / 2]
  const out = []
  for (const j of rows) for (const i of cols) out.push(j * w + i)
  return out
}

/**
 * What the crosshair (screen centre = photo centre) is on. Each centre cell is compared with
 * the ground depth of its own row: about as far as the ground there = ground, clearly nearer
 * (or above the horizon) = a surface standing up: a wall, building or object used as cover.
 * Returns { kind: 'wall' | 'ground' | 'open', range (m along the ray), dist (m horizontal),
 * cells (centre cells on the surface), full (all of them) } or null when unsure (one stray
 * cell, cells that disagree, something on the lens, too far beyond the ground that scaled it).
 */
export function crosshairSurface(grid, fit, pitchDeg, { eyeM = PHONE_HEIGHT_M } = {}) {
  if (!fit?.ok || !grid) return null
  const p = rad(Number(pitchDeg) || 0)
  const { tanV } = gridCamera(grid)
  const idx = centreCells(grid.w, grid.h)
  const wall = []
  let groundCells = 0
  for (const k of idx) {
    const z = depthFromValue(grid.data[k], fit)
    if (Number.isNaN(z)) return null
    const gz = groundDepth(rowSlope(Math.floor(k / grid.w), grid.h, tanV), pitchDeg, eyeM)
    if (!Number.isFinite(z) || z > DEPTH_MAX_M) continue // sky / beyond range
    if (gz != null && z >= gz * 0.8) groundCells++
    else wall.push(z)
  }
  const centreGround = groundDepth(0, pitchDeg, eyeM)
  if (wall.length === 0) {
    if (groundCells > 0 && centreGround != null) return { kind: 'ground', range: centreGround, dist: centreGround * Math.cos(p), cells: 0, full: false }
    return { kind: 'open', range: Infinity, dist: Infinity, cells: 0, full: false }
  }
  if (wall.length < 2) return null // a stray cell / an edge
  wall.sort((a, b) => a - b)
  if (wall[wall.length - 1] / wall[0] > 1.6) return null // cells disagree
  const range = quantile(wall, 0.5)
  if (range < COVER_MIN_M) return null
  // Far beyond the ground rows that anchor the scale: extrapolated, don't trust it.
  if (range > 25 && range > fit.zMax * 2.5) return null
  return { kind: 'wall', range, dist: range * Math.cos(p), cells: wall.length, full: wall.length === idx.length }
}

/**
 * One scan's verdict: { ok, why?, fit, surface }. `pitchDeg` is the camera pitch when the
 * frame was taken.
 */
export function analyzeScan(grid, pitchDeg, opts = {}) {
  try {
    const fit = fitGroundScale(grid, pitchDeg, opts)
    if (!fit.ok) return { ok: false, why: fit.why || 'fit', fit, surface: null }
    const surface = crosshairSurface(grid, fit, pitchDeg, opts)
    if (!surface) return { ok: false, why: 'unsure', fit, surface: null }
    return { ok: true, fit, surface }
  } catch {
    return { ok: false, why: 'error', fit: null, surface: null }
  }
}

/**
 * Is a stored scan still about where the phone points now? scan: { at, pitch, heading }.
 */
export function scanUsable(scan, { now = Date.now(), pitchDeg, headingDeg, maxAgeMs = SCAN_MAX_AGE_MS, maxTurnDeg = SCAN_MAX_TURN_DEG, maxTiltDeg = SCAN_MAX_TILT_DEG } = {}) {
  if (!scan || !finite(scan.at) || !finite(scan.pitch) || !finite(scan.heading)) return false
  if (!finite(Number(pitchDeg)) || !finite(Number(headingDeg))) return false
  const age = now - scan.at
  if (age < -500 || age > maxAgeMs) return false
  if (Math.abs(angleDelta(Number(headingDeg), scan.heading)) > maxTurnDeg) return false
  if (Math.abs(Number(pitchDeg) - scan.pitch) > maxTiltDeg) return false
  return true
}

/** The surface under the crosshair from a fresh, confident scan, or null. */
export function surfaceNow(scan, aim) {
  if (!scanUsable(scan, aim)) return null
  const a = scan.analysis
  return a?.ok && a.surface ? a.surface : null
}

/**
 * Rocket impact distance with cover: min(target distance, wall distance).
 *   surface: from surfaceNow() (null = unsure: the old rules).
 *   lineOfSight: the target is a person the camera sees (nothing in between).
 * Returns { dist, why: 'target' | 'ground' | 'wall' | 'cover' }; 'cover' = it hits the wall.
 */
export function rocketImpactWithCover({ targetDist, pitchDeg, hipFire = false, range = 80, surface = null, lineOfSight = false, minM = 3, gapM = 1.5 } = {}) {
  const base = rocketImpactDistance({ targetDist, pitchDeg, hipFire, range, minM })
  if (hipFire || lineOfSight || !surface || surface.kind !== 'wall' || !finite(surface.dist)) return base
  const maxM = Math.max(minM, Number(range) || 80)
  if (surface.dist > maxM) return base
  const dist = Math.max(minM, Math.min(maxM, surface.dist))
  if (base.why === 'target') return surface.dist < base.dist - gapM ? { dist, why: 'cover' } : base
  // No target: it flies until it meets the wall (instead of the ground / 25 m guess).
  return { dist, why: 'cover' }
}

/**
 * Laser shot: a client-side "COVER" spark when a surface clearly (> marginM) nearer than the
 * target's GPS distance covers the crosshair. Visual only; the host still decides hits.
 */
export function laserCover({ targetDist, surface, lineOfSight = false, marginM = LASER_COVER_MARGIN_M } = {}) {
  if (lineOfSight || !surface || surface.kind !== 'wall' || !surface.full) return null
  if (!finite(surface.dist) || !(Number(targetDist) > 0)) return null
  if (surface.dist + marginM >= Number(targetDist)) return null
  return { dist: surface.dist, range: surface.range }
}

/**
 * Where a world direction (bearing + elevation, degrees) shows on screen for a camera at
 * headingDeg / pitchDeg: { x, y, inView, pxPerRad } or null when behind the camera.
 * Used to keep a scorch mark / spark on the wall while you turn.
 */
export function projectDirection({ bearing, elev = 0, headingDeg, pitchDeg = 0, view, zoom = 1 }) {
  const W = view?.width || 0
  const H = view?.height || 0
  if (!(W > 0) || !(H > 0) || !finite(Number(bearing)) || !finite(Number(headingDeg))) return null
  const { tanH, tanV } = cameraTanHalf(view, zoom)
  const a = rad(angleDelta(Number(bearing), Number(headingDeg)))
  const e = rad(Number(elev) || 0)
  const p = rad(Math.max(-90, Math.min(90, Number(pitchDeg) || 0)))
  const right = Math.cos(e) * Math.sin(a)
  const up = Math.sin(e)
  const fwd = Math.cos(e) * Math.cos(a)
  const X = right
  const Y = up * Math.cos(p) - fwd * Math.sin(p)
  const Z = up * Math.sin(p) + fwd * Math.cos(p)
  if (!(Z > 0.05)) return null
  const x = W / 2 + (X / Z / tanH) * (W / 2)
  const y = H / 2 - (Y / Z / tanV) * (H / 2)
  return { x, y, inView: x >= 0 && x <= W && y >= 0 && y <= H, pxPerRad: W / 2 / tanH }
}

/** On-screen size (px) of something `sizeM` wide `rangeM` away. */
export function apparentSize(sizeM, rangeM, view, zoom = 1, { min = 18, max = 260 } = {}) {
  const { tanH } = cameraTanHalf(view, zoom)
  const W = view?.width || 390
  const r = Math.max(0.5, Number(rangeM) || 10)
  return Math.max(min, Math.min(max, (sizeM * (W / 2 / tanH)) / r))
}
