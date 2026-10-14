// Camera-based hit detection for Laser Tag (and Battle Royale).
//
// Live tracking (liveBodies.js + aimAssist.js) is the primary path when the binary has it:
// bodies in preview space, aim assist around the crosshair and tap-to-shoot. This file keeps
// the still-frame path (one photo per shot) as the fallback and converts both into the same
// preview-space body shape.
//
// The shooter's phone grabs a frame from the camera and runs Apple Vision on
// it (modules/body-hit). If a person is under the crosshair we classify the hit
// zone (head / body / limb) and work out WHICH player it is by combining the
// compass heading, the person's horizontal position in the frame and everyone's
// shared GPS position. Without the native module (Android, web, Expo Go) the
// game falls back to compass-only aiming.
import { useCallback, useRef } from 'react'
import { detectBodies, isBodyHitAvailable } from '../../../modules/body-hit'
import { angleDiff, bearingDeg, distanceMeters } from '../../lib/multiplayer'

export const visionAvailable = isBodyHitAvailable

// Horizontal field of view of the iPhone main (wide, 26 mm-equivalent) camera
// for a PORTRAIT 4:3 photo: the frame's width is the sensor's short side,
// 2·atan(13.5 / 26) ≈ 55°.
export const CAMERA_HFOV_DEG = 55
export const VISION_RANGE_M = 30 // Vision struggles to find people much further away
export const FALLOFF_START_M = 20
export const AIM_ASSIST = 0.03 // crosshair radius as a fraction of the frame
export const FALLBACK_WINDOW_DEG = 25
export const ZONE_DAMAGE = { head: 50, body: 25, limb: 15 }

const inside = (r, x, y, pad) => !!r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad

// Which detected person (if any) is under the crosshair, and where.
export function classifyHit(bodies, aimX = 0.5, aimY = 0.5) {
  let best = null
  const rank = { head: 3, body: 2, limb: 1 }
  for (const b of bodies || []) {
    let zone = null
    if (inside(b.head, aimX, aimY, AIM_ASSIST)) zone = 'head'
    else if (inside(b.torso, aimX, aimY, AIM_ASSIST)) zone = 'body'
    else if (inside(b.box, aimX, aimY, AIM_ASSIST)) zone = b.source === 'rect' || !b.torso ? 'body' : 'limb'
    if (!zone) continue
    const cx = b.box.x + b.box.w / 2
    const cy = b.box.y + b.box.h / 2
    const dist = Math.hypot(cx - aimX, cy - aimY)
    if (!best || rank[zone] > rank[best.zone] || (rank[zone] === rank[best.zone] && dist < best.dist)) best = { zone, body: b, dist }
  }
  return best
}

export function zoneDamage(zone, gun, distance) {
  const base = ZONE_DAMAGE[zone] || ZONE_DAMAGE.body
  const falloff = distance <= FALLOFF_START_M ? 1 : Math.max(0.5, 1 - (distance - FALLOFF_START_M) / 20)
  return Math.max(1, Math.round(base * (gun.damageMultiplier || 1) * falloff))
}

// opponents: [{ id, pos: {lat,lng,acc}, alive, protected }]
// Returns { target, distance } or null (a person was seen but no player matches,
// e.g. a bystander).
export function pickVisionTarget({ opponents, myPos, headingDeg, headingAcc, body, tolerance }) {
  if (!myPos || headingDeg == null) return null
  const offset = ((body.box.x + body.box.w / 2) - 0.5) * CAMERA_HFOV_DEG
  const aimBearing = (headingDeg + offset + 360) % 360
  const cands = []
  for (const o of opponents) {
    if (!o.alive || !o.pos) continue
    const d = distanceMeters(myPos, o.pos)
    // Two phones closer together than their combined GPS error are "in reach" whatever the
    // noisy distance says (indoors GPS can put two people in one room 40 m apart).
    const gpsErr = (myPos.acc ?? 10) + (o.pos.acc ?? 10)
    const reach = Math.max(VISION_RANGE_M + Math.min(15, gpsErr / 2), gpsErr)
    if (d > reach) continue
    const diff = Math.abs(angleDiff(bearingDeg(myPos, o.pos), aimBearing))
    cands.push({ o, d, diff, tol: tolerance(d, myPos.acc, o.pos.acc, headingAcc) })
  }
  const matched = cands.filter((c) => c.diff <= c.tol).sort((a, b) => a.diff / a.tol - b.diff / b.tol)[0]
  if (matched) return { target: matched.o, distance: matched.d }
  // The camera definitely sees a person: with exactly one enemy and the two of you inside GPS
  // noise (same room) it's them; otherwise they must be roughly in that direction.
  const only = cands.length === 1 ? cands[0] : null
  const fallback = only && only.d <= (myPos.acc ?? 10) + (only.o.pos.acc ?? 10)
    ? only
    : cands.filter((c) => c.diff <= Math.max(FALLBACK_WINDOW_DEG, c.tol)).sort((a, b) => a.d - b.d)[0]
  return fallback ? { target: fallback.o, distance: fallback.d } : null
}

// One camera frame at a time: target-lock frames are skipped while a capture
// is in flight, and a shot reuses an in-flight frame instead of queueing.
export function useVisionCapture(cameraRef) {
  const inflight = useRef(null)
  const last = useRef(null)

  const capture = useCallback(() => {
    if (inflight.current) return inflight.current
    const cam = cameraRef.current
    if (!cam || !visionAvailable) return Promise.resolve(null)
    const startedAt = Date.now()
    const p = (async () => {
      try {
        const pic = await cam.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false, exif: false })
        if (!pic?.uri) return null
        const bodies = await detectBodies(pic.uri, true)
        if (!bodies) return null
        const res = { bodies, at: startedAt }
        last.current = res
        return res
      } catch {
        return null
      } finally {
        inflight.current = null
      }
    })()
    inflight.current = p
    return p
  }, [cameraRef])

  const busy = () => !!inflight.current
  return { capture, busy, last }
}

// Maps a normalized photo rect onto the on-screen camera preview, which fills
// the view with aspect-fill (cropping the photo's longer dimension). Bodies already in
// preview space (space: 'view', from viewBodiesFromStill / the live tracker) map 1:1.
export function photoRectToScreen(r, body, view) {
  if (body?.space === 'view') return viewRectToScreen(r, view)
  const iw = Math.min(body.imageWidth || 3, body.imageHeight || 4)
  const ih = Math.max(body.imageWidth || 3, body.imageHeight || 4)
  const scale = Math.max(view.width / iw, view.height / ih)
  const offX = (iw * scale - view.width) / 2
  const offY = (ih * scale - view.height) / 2
  return { left: r.x * iw * scale - offX, top: r.y * ih * scale - offY, width: r.w * iw * scale, height: r.h * ih * scale }
}

// Preview-space rect (0..1 of the preview view) -> screen points (before the scope zoom).
export function viewRectToScreen(r, view) {
  const W = view?.width || 0
  const H = view?.height || 0
  return { left: r.x * W, top: r.y * H, width: r.w * W, height: r.h * H }
}

const toViewRect = (r, body, view) => {
  if (!r) return null
  const s = photoRectToScreen(r, body, view)
  const W = view.width
  const H = view.height
  const out = { x: s.left / W, y: s.top / H, w: s.width / W, h: s.height / H }
  return Number.isFinite(out.x + out.y + out.w + out.h) && out.w > 0 && out.h > 0 ? out : null
}

// Still-frame detections (photo space) -> preview-space bodies for aimAssist.js. `src` keeps
// the photo-space body for pickVisionTarget / pickBystander.
export function viewBodiesFromStill(bodies, view) {
  if (!Array.isArray(bodies) || !(view?.width > 0) || !(view?.height > 0)) return []
  const out = []
  bodies.forEach((b, i) => {
    try {
      const box = toViewRect(b?.box, b, view)
      if (!box) return
      out.push({ id: `s${i}`, box, head: toViewRect(b.head, b, view), torso: toViewRect(b.torso, b, view), kind: b.source || 'still', conf: b.confidence, space: 'view', src: b })
    } catch {}
  })
  return out
}

// Live tracks (liveBodies.js) -> the same body shape.
export function viewBodiesFromLive(tracks) {
  return (tracks || []).map((t) => ({ id: t.id, box: t.box, head: t.head || null, torso: null, kind: t.kind || 'live', conf: t.conf, space: 'view', live: true }))
}

// Horizontal field of view the preview actually shows (aspect-fill crops the 4:3 photo).
export function visibleHfovDeg(view) {
  const W = view?.width || 0
  const H = view?.height || 0
  if (!(W > 0) || !(H > 0)) return CAMERA_HFOV_DEG
  const portrait = W <= H
  const halfTan = Math.tan((CAMERA_HFOV_DEG * Math.PI) / 360) * (portrait ? 1 : 4 / 3) // tan(half HFOV) of the photo width
  const photoAspect = portrait ? 3 / 4 : 4 / 3
  const frac = Math.min(1, (W / H) / photoAspect) // share of the photo width that is on screen
  return (2 * Math.atan(halfTan * frac) * 180) / Math.PI
}

// A preview-space body as pickVisionTarget / pickBystander expect it (horizontal position
// in a CAMERA_HFOV_DEG-wide photo frame).
export function angularBody(body, view) {
  if (!body) return body
  if (body.src) return body.src
  if (body.space !== 'view' || !body.box) return body
  const k = visibleHfovDeg(view) / CAMERA_HFOV_DEG
  const b = body.box
  return { ...body, box: { x: 0.5 + (b.x - 0.5) * k, y: b.y, w: b.w * k, h: b.h }, source: 'live' }
}
