// Weapons on the ground drawn in the live camera view (within LOOT_AR_M), placed with the
// Laser Tag AR ground projection (laser/arGround.js: GPS distance + bearing, compass heading
// and the phone's pitch). Tilt the phone toward a weapon and its tag sits on the ground where
// it lies; ones off screen get an arrow chip at that edge, ones inside GPS error read "near you".
import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { FONT, ST } from '../studio'
import { nearRadius, projectGround } from '../laser/arGround'
import { bearingDeg, dist, formatDistance, validPos } from './geo'
import { LOOT_AR_M } from './constants'

const MAX_SHOWN = 8
const MAX_EDGE = 3

/**
 * items: [{ id, lat, lng, label, color, s? }]. Returns the nearest MAX_SHOWN within LOOT_AR_M,
 * projected: [{ ...item, d, x, y, inView, side, near }] (far first, so near ones draw on top).
 */
export function lootMarkers({ items, myPos, headingDeg, pitchDeg = 0, view, maxM = LOOT_AR_M }) {
  if (!validPos(myPos) || headingDeg == null || !(view?.width > 0) || !(view?.height > 0) || !items?.length) return []
  const near = nearRadius(myPos.acc)
  const close = []
  for (const it of items) {
    if (!validPos(it)) continue
    const d = dist(myPos, it)
    if (Number.isFinite(d) && d <= maxM) close.push({ it, d })
  }
  close.sort((a, b) => a.d - b.d)
  const out = []
  for (const { it, d } of close.slice(0, MAX_SHOWN)) {
    try {
      const isNear = d <= near
      const p = projectGround({ d: Math.max(isNear ? 1.5 : 0.8, d), bearing: bearingDeg(myPos, it), headingDeg, pitchDeg: pitchDeg ?? 0, view })
      if (!p) continue
      out.push({ ...it, d, x: p.x, y: p.y, inView: p.inView, side: p.side, near: isNear })
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.d - a.d)
}

export const LootAR = memo(function LootAR({ markers, view }) {
  if (!markers?.length) return null
  const W = view?.width || 0
  const H = view?.height || 0
  let edges = 0
  const nearOnes = markers.filter((m) => !m.inView && m.near)
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => {
        const color = m.color || ST.objective
        const dText = m.near ? 'NEAR YOU' : formatDistance(m.d).toUpperCase()
        if (!m.inView) {
          if (m.near || edges >= MAX_EDGE) return null
          edges += 1
          const right = m.side === 'right' || (m.side === 'behind' && m.x > W / 2)
          const vertical = m.side === 'down' || m.side === 'up'
          const pos = vertical
            ? { left: Math.max(8, Math.min(W - 158, m.x - 75)), ...(m.side === 'down' ? { bottom: Math.max(170, H * 0.27) + edges * 30 } : { top: Math.max(140, H * 0.22) + edges * 30 }) }
            : { ...(right ? { right: 8 } : { left: 8 }), top: Math.max(130, Math.min(H - 240, m.y)) - 14 + edges * 30 }
          const icon = vertical ? (m.side === 'down' ? 'caret-down' : 'caret-up') : right ? 'caret-forward' : 'caret-back'
          return (
            <View key={m.id} style={[s.edge, pos, { borderLeftColor: color }]}>
              <Ionicons name={icon} size={12} color={color} />
              <Text style={s.edgeText} numberOfLines={1}>{m.label} · {dText}</Text>
            </View>
          )
        }
        // A tag on a stalk standing on the ground point (bigger when closer).
        const stalk = Math.max(14, Math.min(60, 600 / Math.max(4, m.d)))
        return (
          <View key={m.id} style={[s.item, { left: m.x - 80, top: m.y - stalk - 24 }]}>
            <View style={[s.tag, { borderLeftColor: color }]}>
              <Text style={[s.tagText, { color }]} numberOfLines={1}>{m.s ? '★ ' : ''}{m.label}</Text>
              <Text style={s.tagDist} numberOfLines={1}>{dText}</Text>
            </View>
            <View style={[s.stalk, { height: stalk, backgroundColor: color }]} />
            <View style={[s.base, { borderColor: color }]} />
          </View>
        )
      })}
      {nearOnes.length ? (
        <View style={[s.feet, { bottom: Math.max(170, H * 0.27) }]}>
          <Text style={s.edgeText} numberOfLines={1}>
            {nearOnes.length === 1 ? `${nearOnes[0].label} · AT YOUR FEET` : `${nearOnes.length} WEAPONS · AT YOUR FEET`}
          </Text>
        </View>
      ) : null}
    </View>
  )
})

const s = StyleSheet.create({
  item: { position: 'absolute', width: 160, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2, backgroundColor: ST.panel, borderLeftWidth: 3, maxWidth: 160 },
  tagText: { fontFamily: FONT.display, fontSize: 11, letterSpacing: 0.8, includeFontPadding: false },
  tagDist: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 0.6, color: '#fff' },
  stalk: { width: 2, opacity: 0.85 },
  base: { width: 22, height: 8, borderRadius: 11, borderWidth: 2, backgroundColor: 'rgba(0,0,0,0.3)' },
  edge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: ST.panel, borderLeftWidth: 2, maxWidth: 150 },
  edgeText: { color: '#fff', fontFamily: FONT.ui, fontSize: 11, letterSpacing: 0.6 },
  feet: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
})
