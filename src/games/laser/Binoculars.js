import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { angleDiff, formatDistance } from '../../lib/multiplayer'
import { CAMERA_HFOV_DEG } from './vision'

// Binocular mode for Laser Tag: look far without shooting. The camera preview is magnified
// (useScopeZoom) and every enemy with a recent GPS fix gets a name + distance marker placed
// from GPS and the compass, so you can find players well beyond the camera's ~30 m person
// detection, and even behind cover. Players outside the view get an arrow at the edge.

// Horizontal field of view actually visible on screen. The preview fills the screen
// (aspect-fill) from a 3:4 portrait frame, so a tall screen crops the frame's width.
export function visibleHfov(view) {
  if (!view?.width || !view?.height) return CAMERA_HFOV_DEG
  const frameAspect = 3 / 4
  const viewAspect = view.width / view.height
  const half = (CAMERA_HFOV_DEG / 2) * Math.PI / 180
  const visibleHalf = Math.atan(Math.tan(half) * Math.min(1, viewAspect / frameAspect))
  return (visibleHalf * 2 * 180) / Math.PI
}

// players: [{ id, name, color, d, bearing }]  ->  positioned markers
export function binocularMarkers({ players, headingDeg, zoom, view, topInset = 0 }) {
  if (headingDeg == null || !view?.width) return []
  const fov = visibleHfov(view) / Math.max(1, zoom)
  const half = fov / 2
  const cx = view.width / 2
  const out = []
  for (const p of players) {
    const diff = angleDiff(p.bearing, headingDeg) // + = to the right
    if (!Number.isFinite(diff)) continue
    const inView = Math.abs(diff) <= half
    const x = inView ? cx + (diff / half) * cx : diff > 0 ? view.width - 34 : 34
    // Closer players sit a little lower, like they would on the horizon.
    const y = view.height * 0.42 + Math.max(-60, Math.min(60, 40 - p.d / 3)) + topInset * 0
    out.push({ ...p, x, y, inView, side: inView ? null : diff > 0 ? 'right' : 'left' })
  }
  return out
}

export const BinocularMarkers = memo(function BinocularMarkers({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => (m.inView ? (
        <View key={m.id} style={[s.tag, { left: m.x - 60, top: m.y - 52 }]}>
          <View style={[s.pill, { borderColor: m.color }]}>
            <Text style={s.name} numberOfLines={1}>{m.name}</Text>
            <Text style={s.dist}>{formatDistance(m.d)}</Text>
          </View>
          <View style={[s.stem, { backgroundColor: m.color }]} />
          <View style={[s.dot, { backgroundColor: m.color }]} />
        </View>
      ) : (
        <View key={m.id} style={[s.edge, { top: m.y - 18 }, m.side === 'right' ? { right: 8 } : { left: 8 }]}>
          <Text style={[s.arrow, { color: m.color }]}>{m.side === 'right' ? '▶' : '◀'}</Text>
          <Text style={s.edgeText} numberOfLines={1}>{m.name} · {formatDistance(m.d)}</Text>
        </View>
      )))}
    </View>
  )
})

// The round binocular frame drawn over the magnified preview.
export function BinocularFrame({ zoom, view }) {
  if (!view?.width) return null
  const d = Math.min(view.width, view.height) * 1.02
  const ring = Math.max(view.width, view.height)
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[s.mask, { width: d + ring * 2, height: d + ring * 2, borderRadius: (d + ring * 2) / 2, borderWidth: ring, left: (view.width - d) / 2 - ring, top: (view.height - d) / 2 - ring }]} />
      <View style={[s.badge, { top: (view.height - d) / 2 + 14 }]}>
        <Text style={s.badgeText}>🔭 BINOCULARS · {Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}× · lower to shoot</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  tag: { position: 'absolute', width: 120, alignItems: 'center' },
  pill: { backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center', maxWidth: 120 },
  name: { color: '#fff', fontWeight: '800', fontSize: 13 },
  dist: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 11 },
  stem: { width: 2, height: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  edge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5, maxWidth: 170 },
  arrow: { fontSize: 14, fontWeight: '900' },
  edgeText: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  mask: { position: 'absolute', borderColor: 'rgba(0,0,0,0.82)' },
  badge: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.3 },
})
