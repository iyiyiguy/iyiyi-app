// Your placed sticky bomb (C4) and land mines drawn in the camera view, sitting on the ground
// where you left them. Placed from GPS + compass (like binocular name tags): closer ones are
// bigger and lower on screen; ones outside the view get an arrow chip at the screen edge.
import { memo } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { FONT, ST } from '../studio'
import { angleDiff, bearingDeg, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { visibleHfov } from './Binoculars'

const C4_IMG = require('../../../assets/games/c4.png')
const MINE_IMG = require('../../../assets/guns/landmine.png')
const MAX_M = 150 // don't draw things further than this
const EYE_M = 1.4 // phone height above the ground

// items: [{ id, kind: 'c4'|'mine', lat, lng }]
export function groundMarkers({ items, myPos, headingDeg, zoom = 1, view }) {
  if (!myPos || headingDeg == null || !view?.width || !items?.length) return []
  const hfov = visibleHfov(view) / Math.max(1, zoom)
  const vfov = hfov * (view.height / view.width)
  const out = []
  for (const it of items) {
    try {
      if (it?.lat == null || it?.lng == null) continue
      const d = distanceMeters(myPos, it)
      if (!Number.isFinite(d) || d > MAX_M) continue
      const diff = angleDiff(bearingDeg(myPos, it), headingDeg) // + = right
      if (!Number.isFinite(diff)) continue
      const inView = Math.abs(diff) <= hfov / 2
      const down = (Math.atan2(EYE_M, Math.max(0.5, d)) * 180) / Math.PI // degrees below the horizon
      const y = Math.min(view.height - 70, view.height / 2 + (down / (vfov / 2)) * (view.height / 2))
      const x = view.width / 2 + (diff / (hfov / 2)) * (view.width / 2)
      const size = Math.max(34, Math.min(150, (160 / Math.max(1, d)) * 2.2)) * Math.min(zoom, 3)
      out.push({ ...it, d, x, y, size, inView, side: inView ? null : diff > 0 ? 'right' : 'left' })
    } catch {}
  }
  return out.sort((a, b) => b.d - a.d) // far ones behind near ones
}

export const GroundExplosives = memo(function GroundExplosives({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => {
        const label = m.kind === 'c4' ? 'YOUR C4' : 'YOUR MINE'
        if (!m.inView) {
          return (
            <View key={m.id} style={[s.edge, m.side === 'right' ? { right: 8 } : { left: 8 }, { top: Math.max(120, m.y) - 16 }]}>
              {m.side !== 'right' ? <Ionicons name="caret-back" size={13} color={ST.objective} /> : null}
              <Text style={s.edgeText} numberOfLines={1}>{label} · {formatDistance(m.d).toUpperCase()}</Text>
              {m.side === 'right' ? <Ionicons name="caret-forward" size={13} color={ST.objective} /> : null}
            </View>
          )
        }
        const w = m.size
        const h = m.kind === 'c4' ? w : w * 0.56
        return (
          <View key={m.id} style={[s.item, { left: m.x - w / 2, top: m.y - h }]}>
            <View style={[s.tag, m.kind === 'c4' ? s.tagC4 : s.tagMine]}>
              <Text style={s.tagText}>{label} · {formatDistance(m.d).toUpperCase()}</Text>
            </View>
            <View style={[s.shadow, { width: w * 0.8, top: h - w * 0.06 }]} />
            <Image source={m.kind === 'c4' ? C4_IMG : MINE_IMG} style={{ width: w, height: h }} resizeMode="contain" fadeDuration={0} />
          </View>
        )
      })}
    </View>
  )
})

const s = StyleSheet.create({
  item: { position: 'absolute', alignItems: 'center' },
  tag: { position: 'absolute', bottom: '100%', marginBottom: 2, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 2, backgroundColor: ST.panel, borderLeftWidth: 2 },
  tagC4: { borderLeftColor: ST.objective },
  tagMine: { borderLeftColor: ST.objective },
  tagText: { color: '#fff', fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1 },
  shadow: { position: 'absolute', height: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', transform: [{ scaleY: 0.6 }] },
  edge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: ST.panel },
  edgeText: { color: '#fff', fontFamily: FONT.ui, fontSize: 11, letterSpacing: 0.6 },
})
