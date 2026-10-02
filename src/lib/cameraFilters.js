// AR filters for the camera ("iY Logo", "Name Tag", "I love you"): the list, plus the pure
// geometry used to place them above people's heads. Everything here is defensive - bad or
// partial detection results just produce fewer (or zero) heads, never a throw.

export const FILTERS = [
  { id: 'none', label: 'None' },
  { id: 'logo', label: 'iY Logo' },
  { id: 'nametag', label: 'Name Tag' },
  { id: 'love', label: 'I love you' },
]
export const FILTER_IDS = FILTERS.map((f) => f.id)
export const normalizeFilter = (v) => (FILTER_IDS.includes(v) ? v : 'none')
export const filterLabel = (id) => FILTERS.find((f) => f.id === id)?.label ?? ''

export const MAX_HEADS = 3
// Horizontal field of view of a portrait 4:3 iPhone photo (main wide or front camera).
export const CAMERA_HFOV_DEG = 55
const HEAD_M = 0.3 // real-world size of the (padded) head box body-hit reports, metres

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function validRect(r) {
  if (!r || typeof r !== 'object') return null
  const x = num(r.x)
  const y = num(r.y)
  const w = num(r.w)
  const h = num(r.h)
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

// Normalized (0..1, top-left origin) rect of an upright image -> pixels in a view that shows
// that image aspect-fill (what both the live preview and the bake's resizeMode="cover" do).
// `mirror` flips horizontally (the front-camera preview is mirrored, its photos are not).
export function mapNormRect(r, imgW, imgH, viewW, viewH, mirror = false) {
  const iw = imgW > 0 ? imgW : 3
  const ih = imgH > 0 ? imgH : 4
  const scale = Math.max(viewW / iw, viewH / ih)
  const offX = (iw * scale - viewW) / 2
  const offY = (ih * scale - viewH) / 2
  let left = r.x * iw * scale - offX
  const top = r.y * ih * scale - offY
  const width = r.w * iw * scale
  const height = r.h * ih * scale
  if (mirror) left = viewW - left - width
  return { left, top, width, height }
}

// Detected bodies (modules/body-hit) -> up to MAX_HEADS heads in view pixels:
// [{ cx, top, size }], ordered left to right so overlays keep their slot as people move.
export function headsFromBodies(bodies, view, mirror = false) {
  if (!Array.isArray(bodies) || !view || !(view.width > 0) || !(view.height > 0)) return []
  const out = []
  for (const b of bodies) {
    try {
      if (!b || typeof b !== 'object') continue
      const conf = num(b.confidence)
      if (conf != null && conf < 0.15) continue
      const iw = num(b.imageWidth) || 3
      const ih = num(b.imageHeight) || 4
      const head = validRect(b.head)
      let h = null
      // nx: head center across the (unmirrored) photo, 0..1 - used for compass matching.
      // pxPerNorm: on-screen pixels per full photo width - converts angles to pixels.
      const pxPerNorm = iw * Math.max(view.width / iw, view.height / ih)
      if (head) {
        const p = mapNormRect(head, iw, ih, view.width, view.height, mirror)
        const size = Math.max(p.width, p.height)
        h = { cx: p.left + p.width / 2, top: p.top, size, nx: head.x + head.w / 2, pxPerNorm }
      } else {
        // No face joints (the rectangle fallback): guess the head from the top of the body box.
        const box = validRect(b.box)
        if (!box) continue
        const p = mapNormRect(box, iw, ih, view.width, view.height, mirror)
        const size = Math.min(p.width * 0.45, p.height * 0.3)
        h = { cx: p.left + p.width / 2, top: p.top + size * 0.05, size, nx: box.x + box.w / 2, pxPerNorm }
      }
      if (!h || !Number.isFinite(h.cx) || !Number.isFinite(h.top) || !(h.size >= 10)) continue
      h.pose = headPose(b.joints, (x, y) => {
        const p = mapNormRect({ x, y, w: 0, h: 0 }, iw, ih, view.width, view.height, mirror)
        return { x: p.left, y: p.top }
      })
      // Off-screen (cropped away by aspect-fill) heads aren't useful.
      if (h.cx < -h.size * 0.25 || h.cx > view.width + h.size * 0.25 || h.top > view.height) continue
      out.push(h)
    } catch {
      // skip this one
    }
  }
  out.sort((a, b) => b.size - a.size)
  return out.slice(0, MAX_HEADS).sort((a, b) => a.cx - b.cx)
}

// Where the overlay hovers when nobody is detected: top-center, sized like a selfie face.
// Front camera: where your face usually is when you hold the phone for a selfie (top of the
// head ~28% down), so the overlay sits right above you before detection kicks in.
export function fallbackHead(view, facing = 'back') {
  const w = view?.width > 0 ? view.width : 360
  const h = view?.height > 0 ? view.height : 600
  if (facing === 'front') {
    const size = Math.min(w * 0.42, h * 0.3)
    return { cx: w / 2, top: h * 0.28, size }
  }
  const size = Math.min(w * 0.34, h * 0.26)
  return { cx: w / 2, top: Math.max(h * 0.36, 150), size }
}

// Name shown on the Name Tag. Selfie (front camera) -> your own handle; one person in a
// back-camera shot with iYiYi users nearby -> the nearest one; otherwise @iyiyi.
export function nameTagText({ facing, headCount, nearby, me }) {
  try {
    const clean = (u) => {
      const s = typeof u === 'string' ? u.trim().replace(/^@+/, '') : ''
      return s ? `@${s.slice(0, 24)}` : null
    }
    if (facing === 'front') return clean(me?.username) || '@iyiyi'
    const list = Array.isArray(nearby) ? nearby.filter((u) => u && clean(u.username)) : []
    if (headCount === 1 && list.length) {
      const dist = (u) => num(u.distance_m) ?? num(u.distance) ?? num(u.distance_ft) ?? Infinity
      const nearest = [...list].sort((a, b) => dist(a) - dist(b))[0]
      return clean(nearest?.username) || '@iyiyi'
    }
  } catch {
    // fall through
  }
  return '@iyiyi'
}

// How big each overlay is relative to the head it sits on (its design size is OVERLAY_BOX).
export const OVERLAY_BOX = 160
export function overlayScale(filter, headSize) {
  const s = Number.isFinite(headSize) ? headSize : 100
  // logo: ~1.3x head width (its art is ~107 px wide at scale 1)
  const k = filter === 'logo' ? 1.3 / 107 : filter === 'nametag' ? 1.5 / 150 : 1.35 / 140
  const lo = filter === 'nametag' ? 0.45 : 0.3
  return Math.min(2.4, Math.max(lo, s * k))
}
// The overlay's bottom-center lands this far above the top of the head.
export const anchorGap = (headSize) => Math.max(4, (Number.isFinite(headSize) ? headSize : 100) * 0.08)

// How tall each overlay's visible art is at scale 1 (measured up from the box's bottom).
const VISUAL_H = { logo: 160, nametag: 50, love: 95 }

// Scale + anchor for an overlay above `head`, kept on screen: a selfie face that fills the frame
// has no room above it, so the art shrinks to fit the space (down to a floor) and, if it still
// doesn't fit, slides down over the top of the head instead of disappearing off the top edge.
// Returns { s, anchorY } - anchorY is where the art's bottom-center goes.
export function placeOverlay(filter, head, topLimit = 64) {
  const size = Number.isFinite(head?.size) ? head.size : 100
  const top = Number.isFinite(head?.top) ? head.top : 200
  let s = overlayScale(filter, size)
  const vh = VISUAL_H[filter] || 120
  let anchorY = top - anchorGap(size)
  const room = anchorY - topLimit
  const floor = filter === 'nametag' ? 0.55 : 0.5
  if (s * vh > room) s = Math.max(floor, Math.min(s, room / vh))
  if (anchorY - s * vh < topLimit) anchorY = topLimit + s * vh
  // Tilted head: swing the anchor around the face center with the roll, so the overlay stays
  // "above" the head in the head's own frame (roll: counter-clockwise radians, three.js style).
  let anchorX = Number.isFinite(head?.cx) ? head.cx : 0
  const roll = Number(head?.pose?.roll)
  if (Number.isFinite(roll) && Number.isFinite(head?.fcx) && Number.isFinite(head?.fcy) && Math.abs(roll) > 0.02) {
    const dx = anchorX - head.fcx
    const dy = anchorY - head.fcy
    const c = Math.cos(roll)
    const sn = Math.sin(roll)
    anchorX = head.fcx + dx * c + dy * sn
    anchorY = head.fcy - dx * sn + dy * c
  }
  return { s, anchorY, anchorX }
}

// Vision face boxes (modules/body-hit detectFaces) -> heads in view pixels, same shape as
// headsFromBodies plus the face center (fcx, fcy) and a pose from the nose/eye landmarks
// (yaw, roll; `down` = raw nose drop below the eye line, the caller turns that into pitch
// against a running baseline). Ordered left to right, largest MAX_HEADS.
export function headsFromFaces(faces, view, mirror = false) {
  if (!Array.isArray(faces) || !view || !(view.width > 0) || !(view.height > 0)) return []
  const out = []
  for (const f of faces) {
    try {
      if (!f || typeof f !== 'object') continue
      const box = validRect(f.box)
      if (!box) continue
      const iw = num(f.imageWidth) || 3
      const ih = num(f.imageHeight) || 4
      const p = mapNormRect(box, iw, ih, view.width, view.height, mirror)
      if (!(p.width >= 8)) continue
      const pxPerNorm = iw * Math.max(view.width / iw, view.height / ih)
      const toScreen = (x, y) => {
        const q = mapNormRect({ x, y, w: 0, h: 0 }, iw, ih, view.width, view.height, mirror)
        return { x: q.left, y: q.top }
      }
      let pose = headPose(f.landmarks, toScreen)
      if (pose) {
        pose = { ...pose, down: landmarkDown(f.landmarks, toScreen) }
      } else if (num(f.yaw) != null || num(f.roll) != null) {
        // No landmarks: Vision's own angles (unmirrored image -> flip for the mirrored preview).
        const flip = mirror ? -1 : 1
        pose = { yaw: -(num(f.yaw) ?? 0) * flip, roll: (num(f.roll) ?? 0) * flip, pitch: 0, down: null }
      }
      const h = {
        cx: p.left + p.width / 2,
        top: p.top - p.height * 0.35,
        size: p.width * 1.15,
        fcx: p.left + p.width / 2,
        fcy: p.top + p.height / 2,
        nx: box.x + box.w / 2,
        pxPerNorm,
        pose: pose || null,
      }
      if (h.cx < -p.width * 0.25 || h.cx > view.width + p.width * 0.25 || h.top > view.height) continue
      out.push(h)
    } catch {
      // skip this one
    }
  }
  out.sort((a, b) => b.size - a.size)
  return out.slice(0, MAX_HEADS).sort((a, b) => a.cx - b.cx)
}

export function landmarkDown(lm, toScreen) {
  try {
    const pt = (n) => (lm?.[n] && num(lm[n].x) != null && num(lm[n].y) != null ? toScreen(lm[n].x, lm[n].y) : null)
    const nose = pt('nose')
    let a = pt('leftEye')
    let b = pt('rightEye')
    if (!nose || !a || !b) return null
    if (a.x > b.x) { const t = a; a = b; b = t }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const span = Math.hypot(dx, dy)
    if (!(span > 2)) return null
    return ((nose.x - (a.x + b.x) / 2) * -(dy / span) + (nose.y - (a.y + b.y) / 2) * (dx / span)) / span
  } catch {
    return null
  }
}

// Head orientation from Vision face joints, in on-screen terms (so the front camera's mirror is
// already applied), as radians for three.js: yaw > 0 = face turned toward screen-right, pitch
// > 0 = looking down, roll = three.js z rotation (counter-clockwise). null if not enough joints.
export function headPose(joints, toScreen) {
  try {
    if (!joints || typeof joints !== 'object') return null
    const pt = (n) => {
      const j = joints[n]
      if (!j || num(j.x) == null || num(j.y) == null) return null
      const p = toScreen(j.x, j.y)
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
    }
    const nose = pt('nose')
    let a = pt('leftEye')
    let b = pt('rightEye')
    let spanScale = 1
    if (!a || !b) { a = pt('leftEar'); b = pt('rightEar'); spanScale = 0.5 } // ears sit ~2x wider
    if (!a || !b || !nose) return null
    if (a.x > b.x) { const t = a; a = b; b = t }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const span = Math.hypot(dx, dy)
    if (!(span > 2)) return null
    const ux = dx / span
    const uy = dy / span
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const along = ((nose.x - mx) * ux + (nose.y - my) * uy) / (span * spanScale) // sideways nose offset
    const down = ((nose.x - mx) * -uy + (nose.y - my) * ux) / (span * spanScale) // nose below the eye line
    const clampA = (v, m) => Math.max(-m, Math.min(m, v))
    return {
      yaw: clampA(along * 1.6, 1.0),
      pitch: clampA((down - 0.5) * 1.4, 0.55),
      roll: clampA(-Math.atan2(dy, dx), 0.7),
    }
  } catch {
    return null
  }
}

// --- matching people on screen to nearby iYiYi users -------------------------------------

const R = 6371000
const rad = (d) => (d * Math.PI) / 180
function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
const angleDiff = (a, b) => ((a - b + 540) % 360) - 180

// A nearby user's position, whatever shape the API sends it in (null if it doesn't).
export function userPos(u) {
  if (!u || typeof u !== 'object') return null
  const lat = num(u.lat) ?? num(u.latitude) ?? num(u.location?.lat) ?? num(u.location?.latitude) ?? num(u.coords?.lat)
  const lng = num(u.lng) ?? num(u.lon) ?? num(u.longitude) ?? num(u.location?.lng) ?? num(u.location?.longitude) ?? num(u.coords?.lng)
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, acc: num(u.accuracy) ?? num(u.acc) ?? null }
}
const handle = (u) => {
  const s = typeof u === 'string' ? u.trim().replace(/^@+/, '') : ''
  return s ? `@${s.slice(0, 24)}` : null
}

// Who to put a filter on. Detected heads (headsFromBodies) are matched to nearby iYiYi users:
// each user's compass bearing relative to where the camera points (phone heading, +180 for the
// selfie camera) gives the x where they should appear across the photo; the head whose x fits
// best (within a tolerance that widens for close / inaccurate GPS) is theirs and gets their
// name. Matched people get the filter; with no match, the nearest face (largest head box) does.
// Size blends the head box with the size the GPS distance predicts.
// Returns [{ cx, top, size, name, key }] in the heads' screen pixels.
export function selectTargets({ heads, facing, nearby, me, myPos, headingDeg }) {
  try {
    const list = Array.isArray(heads) ? heads.filter(Boolean) : []
    if (!list.length) return []
    const camDir = num(headingDeg) == null ? null : (headingDeg + (facing === 'front' ? 180 : 0)) % 360
    const users = Array.isArray(nearby) ? nearby.filter((u) => u && handle(u.username)) : []
    const out = []
    const taken = new Set()
    if (camDir != null && myPos && num(myPos.lat) != null && num(myPos.lng) != null && users.length) {
      const pairs = []
      for (const u of users) {
        const pos = userPos(u)
        if (!pos) continue
        const d = distanceM(myPos, pos)
        if (!Number.isFinite(d) || d > 120) continue
        const rel = angleDiff(bearing(myPos, pos), camDir)
        const acc = (num(myPos.acc) ?? 10) + (pos.acc ?? 10)
        const tol = Math.min(35, 10 + (Math.atan2(acc, Math.max(d, 1)) * 180) / Math.PI * 0.6)
        if (Math.abs(rel) > CAMERA_HFOV_DEG / 2 + tol) continue
        list.forEach((h, i) => {
          if (num(h.nx) == null) return
          const seenDeg = (h.nx - 0.5) * CAMERA_HFOV_DEG
          const err = Math.abs(seenDeg - rel)
          if (err <= tol) pairs.push({ u, i, d, cost: err / tol })
        })
      }
      pairs.sort((a, b) => a.cost - b.cost)
      const usedUsers = new Set()
      for (const p of pairs) {
        if (taken.has(p.i) || usedUsers.has(p.u.id ?? p.u.username)) continue
        taken.add(p.i)
        usedUsers.add(p.u.id ?? p.u.username)
        const h = list[p.i]
        let size = h.size
        if (num(h.pxPerNorm) && p.d > 0.5) {
          const pxPerRad = h.pxPerNorm / rad(CAMERA_HFOV_DEG)
          const gpsSize = (HEAD_M / p.d) * pxPerRad
          const w = Math.min(0.25, Math.max(0, (p.d - 3) / 30)) // GPS is too coarse up close
          if (Number.isFinite(gpsSize)) size = size * (1 - w) + gpsSize * w
        }
        out.push({ cx: h.cx, top: h.top, size, fcx: h.fcx, fcy: h.fcy, pose: h.pose || null, name: handle(p.u.username) || '@iyiyi', key: `u:${p.u.id ?? p.u.username}` })
      }
    }
    if (out.length) return out.slice(0, MAX_HEADS)
    // Nobody matched: the nearest face (largest head box).
    const h = [...list].sort((a, b) => b.size - a.size)[0]
    return [{ cx: h.cx, top: h.top, size: h.size, fcx: h.fcx, fcy: h.fcy, pose: h.pose || null, name: nameTagText({ facing, headCount: list.length, nearby, me }), key: 'face' }]
  } catch {
    return []
  }
}
