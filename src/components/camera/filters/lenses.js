// The camera's AR lenses (face-anchored art) and looks (colour grades), plus the geometry that
// places each lens on a head. Pure JS, no React - shared by the live layer, the photo bake and
// the video art render, so all three put the art in exactly the same spot.
//
// Every lens draws inside an OVERLAY_BOX square whose bottom-centre is its pivot (the layers
// scale and roll the box about that point, and the native video brander does the same with the
// recorded [x, y, scale, roll] track). "above" lenses hover over the head; "face" lenses sit on
// it (shades on the eyes, crown on the hairline, sparkles around the face): their art is drawn
// at a known height inside the box and the pivot is pushed down by that height, rotated with
// the head's roll, so the art lands on the right feature.
import { OVERLAY_BOX, placeOverlay } from '../../../lib/cameraFilters'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// kind: above | face. everyone: every face in view gets one (otherwise the matched / nearest
// person). needsFace: hidden until a face is found (a crown floating in mid-air looks broken).
// legacy: drawn by FilterArt (the original three filters).
export const LENSES = [
  { id: 'none', label: 'No lens', kind: 'above' },
  { id: 'idcard', label: 'Follow me', kind: 'above' },
  { id: 'nametag', label: 'Name Tag', kind: 'above', legacy: true },
  { id: 'shades', label: 'Shades', kind: 'face', everyone: true, needsFace: true },
  { id: 'crown', label: 'Crown', kind: 'face', everyone: true, needsFace: true },
  { id: 'halo', label: 'Halo', kind: 'above', everyone: true },
  { id: 'sparkle', label: 'Sparkle', kind: 'face', everyone: true, needsFace: true },
  // Original fashion-doll makeover (lips, lashes, shadow, blush, hoops); pairs with the Glam look.
  { id: 'dollglam', label: 'Doll Glam', kind: 'face', everyone: true, needsFace: true, look: 'glam' },
  { id: 'logo', label: 'iY Logo', kind: 'above', everyone: true, legacy: true },
  { id: 'love', label: 'I love you', kind: 'above', legacy: true },
]
const LENS_BY_ID = Object.fromEntries(LENSES.map((l) => [l.id, l]))
export const normalizeLens = (v) => (LENS_BY_ID[v] ? v : 'none')
export const lensInfo = (id) => LENS_BY_ID[id] || LENS_BY_ID.none
export const lensLabel = (id) => lensInfo(id).label
export const lensEveryone = (id) => !!lensInfo(id).everyone
export const lensNeedsFace = (id) => !!lensInfo(id).needsFace
export const isLegacyLens = (id) => !!lensInfo(id).legacy
// The look a lens is designed around (e.g. Doll Glam -> Glam), or null. Callers may apply it
// when the lens is picked and no look is set.
export const lensPairedLook = (id) => lensInfo(id).look || null
// Lenses that turn a little toward the middle of the frame (flat cards / bubbles).
export const lensYaws = (id) => id === 'nametag' || id === 'love' || id === 'idcard'

// Where each "face" lens's art sits inside the box: its centre this far above the box bottom
// (box px at scale 1), and how wide the art is (box px) vs. how wide it should be on the face.
const FACE_ART = {
  shades: { lift: 42, artW: 140, faceW: 1.02, at: -0.13 }, // centre on the eye line
  crown: { lift: 4, artW: 118, faceW: 0.95, at: -0.7 }, // base on top of the head
  sparkle: { lift: 80, artW: 160, faceW: 1.75, at: 0 }, // centred on the face
  // Makeup drawn over a 100 box-px face centred in the box (eyes ~y71, lips ~y108, ears ~x30/130).
  dollglam: { lift: 80, artW: 100, faceW: 1, at: 0 },
}
// "above" lenses that aren't the legacy three: scale per head px, floor, visible art height.
const ABOVE_ART = {
  idcard: { k: 1.55 / 150, lo: 0.5, hi: 2.1, vh: 84, floor: 0.55, gap: 0.08 },
  halo: { k: 1.1 / 124, lo: 0.35, hi: 2.4, vh: 46, floor: 0.4, gap: 0.0 },
}

// Rotates an offset (box/screen px, y down) by the head roll - same convention as
// placeOverlay (roll: counter-clockwise radians).
function rot(ox, oy, roll) {
  if (!Number.isFinite(roll) || Math.abs(roll) < 0.01) return { x: ox, y: oy }
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  return { x: ox * c + oy * s, y: -ox * s + oy * c }
}

// Face centre / width from a head (face boxes give fcx/fcy; body-pose heads only cx/top/size).
export function faceOf(head) {
  const size = num(head?.size) ?? 100
  const fw = size / 1.15
  const cx = num(head?.cx) ?? 0
  const top = num(head?.top) ?? 200
  return {
    fw,
    fcx: num(head?.fcx) ?? cx,
    fcy: num(head?.fcy) ?? top + size * 0.62,
  }
}

// Scale + where the box's bottom-centre goes ({ s, anchorX, anchorY }) for `lens` on `head`.
export function placeLens(lens, head, topLimit = 64) {
  if (isLegacyLens(lens) || lens === 'none') return placeOverlay(lens, head, topLimit)
  const roll = num(head?.pose?.roll) ?? 0
  const face = FACE_ART[lens]
  if (face) {
    const { fw, fcx, fcy } = faceOf(head)
    const s = clamp((fw * face.faceW) / face.artW, 0.18, 3.2)
    const feat = rot(0, face.at * fw, roll) // the feature (eyes / hairline / centre) on the face
    const down = rot(0, face.lift * s, roll) // from the art's centre down to the box pivot
    return { s, anchorX: fcx + feat.x + down.x, anchorY: fcy + feat.y + down.y }
  }
  const a = ABOVE_ART[lens] || ABOVE_ART.idcard
  const size = num(head?.size) ?? 100
  const top = num(head?.top) ?? 200
  let s = clamp(size * a.k, a.lo, a.hi)
  let anchorY = top - (a.gap ? Math.max(4, size * a.gap) : size * 0.02)
  const room = anchorY - topLimit
  if (s * a.vh > room) s = Math.max(a.floor, Math.min(s, room / a.vh))
  if (anchorY - s * a.vh < topLimit) anchorY = topLimit + s * a.vh
  let anchorX = num(head?.cx) ?? 0
  if (Math.abs(roll) > 0.02 && num(head?.fcx) != null && num(head?.fcy) != null) {
    const r = rot(anchorX - head.fcx, anchorY - head.fcy, roll)
    anchorX = head.fcx + r.x
    anchorY = head.fcy + r.y
  }
  return { s, anchorX, anchorY }
}

export { OVERLAY_BOX }

// --- looks (colour grades) -------------------------------------------------------------------
// Each look is a 4x5 colour matrix (SVG feColorMatrix) - the real grade, baked into photos -
// plus cheap live layers for the preview: blend-mode washes on iOS (CALayer compositing
// filters blend straight over the camera layer) and plain translucent tints on Android (the
// preview is a SurfaceView there, which blend modes can't reach). `vignette` is 0..1.

// 5x5 helpers (row-major, last row 0 0 0 0 1).
const I5 = () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
function mul(a, b) { // a after b
  const o = new Array(25).fill(0)
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    let v = 0
    for (let k = 0; k < 5; k++) v += a[r * 5 + k] * b[k * 5 + c]
    o[r * 5 + c] = v
  }
  return o
}
const LR = 0.2126
const LG = 0.7152
const LB = 0.0722
function saturate(s) {
  const m = I5()
  m[0] = LR + (1 - LR) * s; m[1] = LG * (1 - s); m[2] = LB * (1 - s)
  m[5] = LR * (1 - s); m[6] = LG + (1 - LG) * s; m[7] = LB * (1 - s)
  m[10] = LR * (1 - s); m[11] = LG * (1 - s); m[12] = LB + (1 - LB) * s
  return m
}
function contrast(c) {
  const m = I5()
  const t = 0.5 * (1 - c)
  m[0] = c; m[6] = c; m[12] = c
  m[4] = t; m[9] = t; m[14] = t
  return m
}
function gain(r, g, b, lift = 0) {
  const m = I5()
  m[0] = r; m[6] = g; m[12] = b
  m[4] = lift; m[9] = lift; m[14] = lift
  return m
}
const toValues = (m) => m.slice(0, 20).map((v) => Math.round(v * 10000) / 10000).join(' ')
const chain = (...ms) => toValues(ms.reduce((acc, m) => mul(m, acc), I5()))

export const LOOKS = [
  { id: 'none', label: 'Original', swatch: ['#3a3a48', '#15151c'] },
  {
    id: 'film',
    label: 'Film',
    swatch: ['#e9b98a', '#5b4a63'],
    matrix: chain(saturate(0.8), contrast(0.9), gain(1.06, 1.0, 0.9, 0.045)),
    ios: [{ color: '#ffb070', blend: 'soft-light', opacity: 0.38 }, { color: '#808080', blend: 'saturation', opacity: 0.2 }, { color: '#2a1d3a', blend: 'lighten', opacity: 0.22 }],
    android: [{ color: '#ffb070', opacity: 0.1 }, { color: '#ffffff', opacity: 0.05 }],
    vignette: 0.38,
  },
  {
    id: 'noir',
    label: 'Noir',
    swatch: ['#d8d8d8', '#111111'],
    matrix: chain(saturate(0), contrast(1.3), gain(1.02, 1.02, 1.02, -0.01)),
    ios: [{ color: '#808080', blend: 'saturation', opacity: 1 }, { color: '#000000', blend: 'soft-light', opacity: 0.3 }],
    android: [{ color: '#10101a', opacity: 0.16 }],
    vignette: 0.55,
  },
  {
    id: 'warm',
    label: 'Golden',
    swatch: ['#ffcf6b', '#d2552a'],
    matrix: chain(saturate(1.1), gain(1.1, 1.02, 0.84, 0.01)),
    ios: [{ color: '#ff9a3c', blend: 'soft-light', opacity: 0.5 }],
    android: [{ color: '#ff9a3c', opacity: 0.12 }],
    vignette: 0.25,
  },
  {
    id: 'vivid',
    label: 'Vivid',
    swatch: ['#ff2bd6', '#2b7bff'],
    matrix: chain(saturate(1.4), contrast(1.1)),
    ios: [{ color: '#ff0000', blend: 'saturation', opacity: 0.32 }],
    android: [{ color: '#ff2bd6', opacity: 0.035 }],
    vignette: 0.18,
  },
  {
    id: 'dream',
    label: 'Dream',
    swatch: ['#ffc2ec', '#8a7bff'],
    matrix: chain(saturate(0.88), contrast(0.88), gain(1.06, 0.96, 1.08, 0.05)),
    ios: [{ color: '#ff8ad8', blend: 'soft-light', opacity: 0.42 }, { color: '#ffffff', blend: 'soft-light', opacity: 0.18 }],
    android: [{ color: '#ff8ad8', opacity: 0.1 }, { color: '#ffffff', opacity: 0.06 }],
    vignette: 0.22,
  },
  {
    // Soft-focus, warm-pink beauty grade (pairs with the Doll Glam lens). `soft` = how much of
    // a blurred copy is mixed into the baked photo (0..1); live it's a gentle bloom wash.
    id: 'glam',
    label: 'Glam',
    swatch: ['#ffd3e8', '#d9468f'],
    matrix: chain(saturate(1.04), contrast(0.86), gain(1.08, 0.97, 1.0, 0.055)),
    soft: 0.38,
    ios: [{ color: '#ff9ccb', blend: 'soft-light', opacity: 0.46 }, { color: '#fff0f6', blend: 'screen', opacity: 0.1 }],
    android: [{ color: '#ff9ccb', opacity: 0.1 }, { color: '#ffffff', opacity: 0.07 }],
    vignette: 0.16,
  },
]
const LOOK_BY_ID = Object.fromEntries(LOOKS.map((l) => [l.id, l]))
export const normalizeLook = (v) => (LOOK_BY_ID[v] ? v : 'none')
export const lookInfo = (id) => LOOK_BY_ID[id] || LOOK_BY_ID.none
