// Video edits are stored as data next to the post (profile_media.edit) and applied when the
// video plays in iYiYi: trim (start/end), crop (aspect + zoom + pan), text captions, and a sound
// with its own volume. The uploaded file itself is never re-encoded, so editing is instant and
// works the same on iPhone, Android and the web.
//
// edit = {
//   trim?: { start: s, end: s },
//   crop?: { aspect: '9:16' | '1:1' | '4:5' | '16:9' | null, zoom: 1..3, x: -1..1, y: -1..1 },
//   texts?: [{ id, text, x: 0..1, y: 0..1, size: 0.04..0.16 (of width), font, color, style }],
//   originalVolume?: 0..1, soundVolume?: 0..1, soundStart?: s,
// }
import { useState } from 'react'
import { Platform, Text, View, StyleSheet } from 'react-native'
import { useFonts } from 'expo-font'
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope'
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue'
import { Pacifico_400Regular } from '@expo-google-fonts/pacifico'
import { PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker'
import { ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch'

export const CAPTION_FONTS = [
  { id: 'classic', label: 'Classic', family: 'Manrope_800ExtraBold' },
  { id: 'bold', label: 'Bold', family: 'BebasNeue_400Regular', upper: true },
  { id: 'tech', label: 'Tech', family: 'ChakraPetch_700Bold' },
  { id: 'script', label: 'Script', family: 'Pacifico_400Regular' },
  { id: 'marker', label: 'Marker', family: 'PermanentMarker_400Regular' },
  { id: 'type', label: 'Typewriter', family: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'Courier New, monospace' }), weight: '700' },
]

export const CAPTION_COLORS = ['#ffffff', '#111111', '#ff4fa3', '#ffb21e', '#39d5ff', '#5cf2a0', '#b06cff', '#ff3d52', '#ffe14d', '#7fb4ff']

export const CAPTION_STYLES = [
  { id: 'plain', label: 'Plain' },
  { id: 'box', label: 'Box' },
  { id: 'outline', label: 'Outline' },
  { id: 'neon', label: 'Neon' },
]

export const CROP_ASPECTS = [
  { key: null, label: 'Original' },
  { key: '9:16', label: '9:16' },
  { key: '4:5', label: '4:5' },
  { key: '1:1', label: '1:1' },
  { key: '16:9', label: '16:9' },
]

export function aspectRatioOf(key) {
  if (!key) return null
  const [w, h] = key.split(':').map(Number)
  return w && h ? w / h : null
}

export function useCaptionFonts() {
  const [loaded] = useFonts({ Manrope_800ExtraBold, BebasNeue_400Regular, Pacifico_400Regular, PermanentMarker_400Regular, ChakraPetch_700Bold })
  return loaded
}

export const fontById = (id) => CAPTION_FONTS.find((f) => f.id === id) || CAPTION_FONTS[0]

const isDark = (hex) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 110
}

/** Text style for one caption at a given frame width. */
export function captionTextStyle(t, frameW) {
  const f = fontById(t.font)
  const size = Math.max(10, (t.size || 0.07) * frameW)
  const color = t.color || '#ffffff'
  const base = { fontFamily: f.family, fontWeight: f.weight, fontSize: size, lineHeight: size * (f.id === 'script' ? 1.45 : 1.2), color, textAlign: 'center' }
  if (t.style === 'box') return { ...base, color: isDark(color) ? '#fff' : '#111' }
  if (t.style === 'outline') return { ...base, textShadowColor: isDark(color) ? '#fff' : '#000', textShadowRadius: Math.max(2, size * 0.12), textShadowOffset: { width: 0, height: 0 } }
  if (t.style === 'neon') return { ...base, color: '#fff', textShadowColor: color, textShadowRadius: Math.max(6, size * 0.45), textShadowOffset: { width: 0, height: 0 } }
  return { ...base, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: Math.max(2, size * 0.08), textShadowOffset: { width: 0, height: 1 } }
}

export function captionBoxStyle(t, frameW) {
  if (t.style !== 'box') return null
  const size = (t.size || 0.07) * frameW
  return { backgroundColor: t.color || '#fff', paddingHorizontal: size * 0.35, paddingVertical: size * 0.12, borderRadius: size * 0.25 }
}

/** Renders one caption (used by the overlay and the editor). */
export function Caption({ t, frameW }) {
  const f = fontById(t.font)
  return (
    <View style={captionBoxStyle(t, frameW)}>
      <Text style={captionTextStyle(t, frameW)}>{f.upper ? String(t.text).toUpperCase() : t.text}</Text>
    </View>
  )
}

/**
 * Positions a caption so its centre sits at (x*w, y*h): a full-width row moved by (x-0.5)*w,
 * lifted by half its own measured height.
 */
export function PlacedCaption({ t, w, h, children }) {
  const [ch, setCh] = useState(0)
  return (
    <View
      onLayout={(e) => setCh(e.nativeEvent.layout.height)}
      style={{ position: 'absolute', width: w, left: (t.x - 0.5) * w, top: t.y * h - ch / 2, alignItems: 'center' }}
      pointerEvents="box-none"
    >
      {children || <Caption t={t} frameW={w} />}
    </View>
  )
}

/** All captions over a frame of size w x h (read-only playback overlay). */
export function CaptionLayer({ texts, w, h }) {
  if (!texts?.length || !w) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {texts.map((t) => <PlacedCaption key={t.id} t={t} w={w} h={h} />)}
    </View>
  )
}

export function cleanEdit(edit) {
  if (!edit || typeof edit !== 'object') return null
  const out = {}
  if (edit.trim && edit.trim.end > edit.trim.start) out.trim = { start: +edit.trim.start.toFixed(2), end: +edit.trim.end.toFixed(2) }
  if (edit.crop && (edit.crop.aspect || (edit.crop.zoom || 1) > 1.01)) out.crop = { aspect: edit.crop.aspect || null, zoom: +(edit.crop.zoom || 1).toFixed(2), x: +(edit.crop.x || 0).toFixed(3), y: +(edit.crop.y || 0).toFixed(3) }
  if (edit.texts?.length) out.texts = edit.texts.filter((t) => String(t.text || '').trim()).slice(0, 12)
  if (edit.originalVolume != null && edit.originalVolume !== 1) out.originalVolume = +edit.originalVolume.toFixed(2)
  if (edit.soundVolume != null) out.soundVolume = +edit.soundVolume.toFixed(2)
  if (edit.soundStart) out.soundStart = +edit.soundStart.toFixed(2)
  return Object.keys(out).length ? out : null
}
