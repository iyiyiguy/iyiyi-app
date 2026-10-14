// AR ground projection for Laser Tag: where a point on the GROUND (an explosive lying where
// it was placed) appears in the live camera view, from GPS distance + bearing, the compass
// heading and the phone's pitch. Pure maths (headless-tested in aimtest).
//
// Model: pinhole camera at PHONE_HEIGHT_M above flat ground, looking along the heading,
// pitched `pitchDeg` (0 = horizon, negative = looking down, -90 = straight at your feet).
// A ground point d metres away at a bearing offset a: world (right, up, forward) =
// (d·sin a, −h, d·cos a). Rotating into the camera frame by the pitch p:
//   X = right,  Y = up·cos p − fwd·sin p,  Z = up·sin p + fwd·cos p   (Z = depth)
// Screen: x = W/2 + (X/Z)/tanH · W/2,  y = H/2 − (Y/Z)/tanV · H/2.
// So with the phone upright a far mine sits just under the horizon (centre line) and a near
// one lower, at atan(h/d) below it; tilting the phone down moves them up the screen, and with
// the phone flat (hip fire) the ground ahead is up the screen and your feet at the centre.
import { angleDelta } from './geo'

export const PHONE_HEIGHT_M = 1.4
// Wide (1×) camera: the 4:3 frame's SHORT side spans ~55° (see vision.CAMERA_HFOV_DEG).
export const SENSOR_SHORT_FOV_DEG = 55
const rad = (d) => (d * Math.PI) / 180

/**
 * tan of the half field of view across the view's width (tanH) and height (tanV). The
 * preview is aspect-fill from a 4:3 frame (portrait 3:4 when the view is taller than wide),
 * so the side that fits shows the full frame and the other is cropped.
 */
export function cameraTanHalf(view, zoom = 1) {
  const W = view?.width || 390
  const H = view?.height || 844
  const short = Math.tan(rad(SENSOR_SHORT_FOV_DEG) / 2)
  const long = short * (4 / 3)
  const portrait = H >= W
  const frameW = portrait ? short : long
  const frameH = portrait ? long : short
  const frameAspect = frameW / frameH
  const viewAspect = W / H
  // Aspect-fill: if the view is narrower than the frame, the height fits (width cropped).
  const tanH = viewAspect < frameAspect ? frameH * viewAspect : frameW
  const z = Math.max(1, Number(zoom) || 1)
  return { tanH: tanH / z, tanV: (tanH * (H / W)) / z }
}

/**
 * Project a ground point. Returns { x, y, depth, pxPerM, inView, side, below } where side is
 * null (on screen) | 'left' | 'right' | 'down' | 'up' | 'behind'.
 *   d (m), bearing (deg), headingDeg (camera azimuth), pitchDeg (camera elevation),
 *   view { width, height }, zoom, eyeM.
 */
export function projectGround({ d, bearing, headingDeg, pitchDeg = 0, view, zoom = 1, eyeM = PHONE_HEIGHT_M }) {
  const W = view?.width || 0
  const H = view?.height || 0
  if (!(W > 0) || !(H > 0) || !Number.isFinite(d) || !Number.isFinite(bearing) || !Number.isFinite(headingDeg)) return null
  const { tanH, tanV } = cameraTanHalf(view, zoom)
  const off = angleDelta(bearing, headingDeg) // + = right
  const a = rad(off)
  const p = rad(Math.max(-90, Math.min(90, Number(pitchDeg) || 0)))
  const right = d * Math.sin(a)
  const fwd = d * Math.cos(a)
  const up = -eyeM
  const X = right
  const Y = up * Math.cos(p) - fwd * Math.sin(p)
  const Z = up * Math.sin(p) + fwd * Math.cos(p)
  const focalX = W / 2 / tanH // px per unit of X/Z
  if (Z <= 0.05) {
    // Behind the camera plane: an arrow toward it.
    const side = Math.abs(off) > 150 ? 'behind' : off > 0 ? 'right' : 'left'
    return { x: off > 0 ? W : 0, y: H / 2, depth: Z, pxPerM: 0, inView: false, side, offDeg: off }
  }
  const x = W / 2 + (X / Z) * focalX
  const y = H / 2 - (Y / Z) / tanV * (H / 2)
  const inView = x >= 0 && x <= W && y >= 0 && y <= H
  let side = null
  if (!inView) {
    if (x >= 0 && x <= W) side = y > H ? 'down' : 'up'
    else side = x > W ? 'right' : 'left'
  }
  return { x, y, depth: Z, pxPerM: focalX / Z, inView, side, offDeg: off }
}

/** Distance to the point on the ground the camera's centre ray hits, or null (not pitched down). */
export function groundHitDistance(pitchDeg, eyeM = PHONE_HEIGHT_M) {
  const p = Number(pitchDeg)
  if (!Number.isFinite(p) || p > -3) return null
  return eyeM / Math.tan(rad(Math.min(89.5, -p)))
}

/**
 * Honest rocket impact distance (there is no depth sensor):
 *   1. the locked / tracked target's distance,
 *   2. AIM with the phone pitched down: where the centre ray meets the ground,
 *   3. else the weapon's reach, capped at a 25 m "wall".
 * Hip fire aims with the TOP EDGE (horizontal), so the ground rule doesn't apply there.
 */
export function rocketImpactDistance({ targetDist, pitchDeg, hipFire = false, range = 80, wallM = 25, minM = 3 }) {
  const maxM = Math.max(minM, Number(range) || 80)
  const clamp = (v) => Math.max(minM, Math.min(maxM, v))
  if (Number.isFinite(targetDist) && targetDist > 0) return { dist: clamp(targetDist), why: 'target' }
  if (!hipFire) {
    const g = groundHitDistance(pitchDeg)
    if (g != null) return { dist: clamp(Math.min(g, wallM)), why: 'ground' }
  }
  return { dist: clamp(Math.min(maxM, wallM)), why: 'wall' }
}

// Below this distance (or the GPS accuracy, up to 10 m) GPS can't say where around you a
// placed item is; it's drawn as "near you" and, if off screen, as a ring at your feet.
export const nearRadius = (acc) => Math.max(4, Math.min(10, Number.isFinite(acc) ? acc : 8))
