// Aim assist + tap-to-shoot geometry and the live body tracker (pure JS, no React / native),
// shared by Laser Tag and Battle Royale.
//
// Coordinates: every body here is in PREVIEW space, normalized 0..1 of the camera preview
// view (top-left origin), before the scope zoom. The crosshair is the preview centre
// (0.5, 0.5) at any zoom (the zoom scales around the centre).
//   body = { id?, box: {x,y,w,h}, head?: {x,y,w,h}|null, torso?: {x,y,w,h}|null, kind? }
//
// Rules
//   FIRE (crosshair): a body counts when the crosshair is inside its box, or within a margin
//     around it of ASSIST_MARGIN (12%) of the screen width, more for small (far) boxes. Boxes
//     the crosshair is really inside beat "near" boxes; among those the nearest wins.
//   Zone: inside the head rect (padded) → head; no head rect → the top HEAD_BAND (18%) of the
//     box (35% for upper-body boxes) → head; a still-frame pose with a torso: inside the torso
//     → body, elsewhere in the box → limb; everything else (and every assisted near-miss) → body.
//   Tap: a tap inside a body's box (padded so a small target is still ~44 pt wide) fires at
//     that body; the zone is where the tap landed.
// The camera only confirms a person is in the shot; the host still decides who was hit.

export const ASSIST_MARGIN = 0.12 // fraction of the screen width around a box
export const SMALL_BOX_BONUS = 0.08 // extra margin for a box narrower than SMALL_BOX_W on screen
export const SMALL_BOX_W = 0.3
export const HEAD_BAND = 0.18
export const UPPER_HEAD_BAND = 0.35
export const TAP_PAD = 0.03 // fraction of the screen width around a box for taps
export const TAP_MIN_W = 0.14 // a target narrower than this on screen gets a wider tap area

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
export const validRect = (r) => !!r && finite(r.x) && finite(r.y) && finite(r.w) && finite(r.h) && r.w > 0 && r.h > 0

const inRect = (r, x, y, px = 0, py = 0) => x >= r.x - px && x <= r.x + r.w + px && y >= r.y - py && y <= r.y + r.h + py

/** Assist margin in preview-width units for a box `boxW` wide (preview units) at `zoom`. */
export function assistMargin(boxW, zoom = 1) {
  const z = Math.max(1, finite(zoom) ? zoom : 1)
  const onScreen = Math.max(0, boxW) * z
  const extra = SMALL_BOX_BONUS * Math.max(0, 1 - onScreen / SMALL_BOX_W)
  return (ASSIST_MARGIN + extra) / z
}

/** The head zone used for a body: its head rect, else the top band of the box. */
export function headZone(body) {
  if (validRect(body?.head)) {
    const h = body.head
    const px = h.w * 0.25
    const py = h.h * 0.25
    return { x: h.x - px, y: h.y - py, w: h.w + 2 * px, h: h.h + 2 * py, real: true }
  }
  const b = body?.box
  if (!validRect(b)) return null
  const band = body.kind === 'upper' ? UPPER_HEAD_BAND : HEAD_BAND
  return { x: b.x + b.w * 0.1, y: b.y - b.h * 0.02, w: b.w * 0.8, h: b.h * (band + 0.02), real: false }
}

/** Zone of a point that is on (or was assisted onto) a body. */
export function zoneAt(body, x, y, { assisted = false } = {}) {
  const b = body?.box
  if (!validRect(b)) return 'body'
  if (assisted) return 'body'
  const head = headZone(body)
  if (head && inRect(head, x, y)) return 'head'
  if (validRect(body.torso)) {
    const t = body.torso
    if (inRect(t, x, y, t.w * 0.05, t.h * 0.05)) return 'body'
    if (inRect(b, x, y)) return 'limb'
  }
  return 'body'
}

/**
 * What a shot at the crosshair hits. opts: aimX/aimY (preview units, default centre),
 * aspect = view width / height, zoom. Returns { body, zone, assisted, gap } or null.
 */
export function pickAimTarget(bodies, { aimX = 0.5, aimY = 0.5, aspect = 0.5, zoom = 1 } = {}) {
  const a = finite(aspect) && aspect > 0 ? aspect : 0.5
  let best = null
  for (const body of bodies || []) {
    const b = body?.box
    if (!validRect(b)) continue
    const head = validRect(body.head) ? body.head : null
    // The person's extent: box plus a head that may stick out of it.
    const ext = head ? unionRect(b, head) : b
    const mx = assistMargin(b.w, zoom) // preview-width units
    const my = mx * a // the same on-screen distance in preview-height units
    const dx = Math.max(ext.x - aimX, 0, aimX - (ext.x + ext.w))
    const dy = Math.max(ext.y - aimY, 0, aimY - (ext.y + ext.h))
    if (dx > mx || dy > my) continue
    const inside = dx === 0 && dy === 0
    const gap = inside ? 0 : Math.hypot(dx, dy / a) / mx // 0 inside, ≤ √2 at the margin corner
    // Among boxes the crosshair is inside: the one whose centre is nearest (relative to its size).
    const cx = ext.x + ext.w / 2
    const cy = ext.y + ext.h / 2
    const centre = Math.hypot((cx - aimX) / Math.max(ext.w, 1e-3), (cy - aimY) / Math.max(ext.h, 1e-3))
    const key = inside ? centre : 10 + gap
    if (!best || key < best.key) best = { body, key, inside, gap }
  }
  if (!best) return null
  return {
    body: best.body,
    zone: zoneAt(best.body, aimX, aimY, { assisted: !best.inside }),
    assisted: !best.inside,
    gap: best.gap,
  }
}

/**
 * Tap-to-shoot: the body under a tap at (x, y) (preview units). Returns
 * { body, zone, rx, ry } (rx/ry = the tap inside the box, 0..1, to follow the body) or null.
 */
export function pickTapTarget(bodies, x, y, { aspect = 0.5, zoom = 1 } = {}) {
  if (!finite(x) || !finite(y)) return null
  const a = finite(aspect) && aspect > 0 ? aspect : 0.5
  const z = Math.max(1, finite(zoom) ? zoom : 1)
  let best = null
  for (const body of bodies || []) {
    const b = body?.box
    if (!validRect(b)) continue
    const ext = validRect(body.head) ? unionRect(b, body.head) : b
    const onScreenW = ext.w * z
    const px = Math.max(TAP_PAD, (TAP_MIN_W - onScreenW) / 2) / z
    const py = px * a
    if (!inRect(ext, x, y, px, py)) continue
    const cx = ext.x + ext.w / 2
    const cy = ext.y + ext.h / 2
    const d = Math.hypot((cx - x) / Math.max(ext.w, 1e-3), (cy - y) / Math.max(ext.h, 1e-3))
    if (!best || d < best.d) best = { body, d }
  }
  if (!best) return null
  const b = best.body.box
  const cxp = Math.min(b.x + b.w, Math.max(b.x, x))
  const cyp = Math.min(b.y + b.h, Math.max(b.y, y))
  return {
    body: best.body,
    zone: zoneAt(best.body, x, y),
    rx: (cxp - b.x) / b.w,
    ry: (cyp - b.y) / b.h,
  }
}

/** A held tap follows its body: the zone at the same spot inside the body's current box. */
export function zoneAtRelative(body, rx, ry) {
  const b = body?.box
  if (!validRect(b)) return 'body'
  return zoneAt(body, b.x + b.w * rx, b.y + b.h * ry)
}

export function unionRect(a, b) {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function iou(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const u = a.w * a.h + b.w * b.h - inter
  return u > 0 ? inter / u : 0
}

// ---------------------------------------------------------------------------
// Live body tracker: sticky ids + EMA smoothing over the native detections.
// ---------------------------------------------------------------------------

/**
 * tracker.update(dets, now) with dets = [{ id (native, -1 = none), x, y, w, h, head?, conf, kind }]
 * tracker.get(now) → [{ id, box, head, kind, conf, seenAt }]  (the smoothed, live tracks)
 * A track survives `coastMs` without a detection (detector flicker), then disappears.
 */
export function createBodyTracker({ alpha = 0.5, coastMs = 350, headHoldMs = 600, maxTracks = 8 } = {}) {
  let tracks = []
  let nextId = 1

  const ema = (prev, next, k) => prev + (next - prev) * k
  const smoothRect = (p, n, k) => ({ x: ema(p.x, n.x, k), y: ema(p.y, n.y, k), w: ema(p.w, n.w, k), h: ema(p.h, n.h, k) })

  function matchScore(t, d) {
    if (d.nid >= 0 && t.nid === d.nid) return 3
    const o = iou(t.box, d.box)
    if (o > 0.15) return 1 + o
    const dist = Math.hypot(t.box.x + t.box.w / 2 - (d.box.x + d.box.w / 2), t.box.y + t.box.h / 2 - (d.box.y + d.box.h / 2))
    const size = Math.max(t.box.w, t.box.h * 0.5, 0.02)
    return dist < size * 0.6 ? 0.5 + (0.5 - dist / size / 1.2) : 0
  }

  function update(raw, now = Date.now()) {
    const dets = []
    for (const r of raw || []) {
      const box = { x: Number(r?.x), y: Number(r?.y), w: Number(r?.w), h: Number(r?.h) }
      if (!validRect(box)) continue
      const head = validRect(r.head) ? { x: r.head.x, y: r.head.y, w: r.head.w, h: r.head.h } : null
      dets.push({ nid: finite(r.id) ? r.id : -1, box, head, kind: r.kind || null, conf: finite(r.conf) ? r.conf : 0.8 })
    }
    // Greedy best-first matching.
    const pairs = []
    tracks.forEach((t, ti) => dets.forEach((d, di) => {
      const s = matchScore(t, d)
      if (s > 0) pairs.push({ ti, di, s })
    }))
    pairs.sort((p, q) => q.s - p.s)
    const tUsed = new Set()
    const dUsed = new Set()
    for (const p of pairs) {
      if (tUsed.has(p.ti) || dUsed.has(p.di)) continue
      tUsed.add(p.ti)
      dUsed.add(p.di)
      const t = tracks[p.ti]
      const d = dets[p.di]
      // Big jumps (fast motion, re-detection) snap faster so the bracket doesn't lag behind.
      const jump = Math.hypot(t.box.x - d.box.x, t.box.y - d.box.y) / Math.max(t.box.w, 0.02)
      const k = jump > 0.6 ? Math.min(0.9, alpha + 0.35) : alpha
      t.box = smoothRect(t.box, d.box, k)
      if (d.head) {
        const rel = { x: (d.head.x - d.box.x) / d.box.w, y: (d.head.y - d.box.y) / d.box.h, w: d.head.w / d.box.w, h: d.head.h / d.box.h }
        t.headRel = t.headRel && now - t.headAt < headHoldMs ? smoothRect(t.headRel, rel, k) : rel
        t.headAt = now
      }
      if (d.nid >= 0) t.nid = d.nid
      t.kind = d.kind || t.kind
      t.conf = d.conf
      t.seenAt = now
      t.hits += 1
    }
    dets.forEach((d, di) => {
      if (dUsed.has(di)) return
      tracks.push({
        id: nextId++, nid: d.nid, box: d.box, kind: d.kind, conf: d.conf, seenAt: now, firstAt: now, hits: 1,
        headRel: d.head ? { x: (d.head.x - d.box.x) / d.box.w, y: (d.head.y - d.box.y) / d.box.h, w: d.head.w / d.box.w, h: d.head.h / d.box.h } : null,
        headAt: d.head ? now : 0,
      })
    })
    expire(now)
    if (tracks.length > maxTracks) tracks = tracks.sort((p, q) => q.seenAt - p.seenAt || q.hits - p.hits).slice(0, maxTracks)
  }

  function expire(now = Date.now()) {
    tracks = tracks.filter((t) => now - t.seenAt <= coastMs)
  }

  function get(now = Date.now()) {
    const out = []
    for (const t of tracks) {
      if (now - t.seenAt > coastMs) continue
      const b = t.box
      const hr = t.headRel && now - t.headAt <= headHoldMs ? t.headRel : null
      out.push({
        id: t.id,
        box: { ...b },
        head: hr ? { x: b.x + hr.x * b.w, y: b.y + hr.y * b.h, w: hr.w * b.w, h: hr.h * b.h } : null,
        torso: null,
        kind: t.kind,
        conf: t.conf,
        seenAt: t.seenAt,
      })
    }
    return out
  }

  function reset() {
    tracks = []
  }

  return { update, get, expire, reset, size: () => tracks.length }
}
