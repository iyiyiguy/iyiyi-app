// Placed explosives (your sticky bombs / C4 and land mines, teammates' in team colour) drawn
// ON THE GROUND in the live camera view, in AIM and HIP FIRE alike. Placement comes from GPS
// + compass + the phone's pitch (arGround.js): tilt the phone down at a mine and it sits on
// the ground where you're looking; ones off screen get an arrow chip at that edge, and ones
// closer than GPS can resolve show as "near you" (a ring at your feet when off screen).
import { memo } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { FONT, ST } from '../studio'
import { bearingDeg, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { PHONE_HEIGHT_M, nearRadius, projectGround } from './arGround'
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'

const tr = (k, v) => translate(H, k, v)

const C4_IMG = require('../../../assets/games/c4.png')
const MINE_IMG = require('../../../assets/guns/landmine.png')
const MAX_M = 150 // don't draw things further than this
const VISUAL_M = 1.1 // drawn this many metres wide (bigger than life so they read at a glance)

/**
 * items: [{ id, kind: 'c4'|'mine', lat, lng, label?, color? }]
 * pitchDeg: camera elevation (negative = looking down; null → horizon).
 */
export function groundMarkers({ items, myPos, headingDeg, pitchDeg = 0, zoom = 1, view }) {
  if (!myPos || headingDeg == null || !view?.width || !view?.height || !items?.length) return []
  const near = nearRadius(myPos.acc)
  const out = []
  for (const it of items) {
    try {
      if (it?.lat == null || it?.lng == null) continue
      const d = distanceMeters(myPos, it)
      if (!Number.isFinite(d) || d > MAX_M) continue
      const isNear = d <= near
      // Inside GPS error the distance is noise: never draw it under the lens (d → 0).
      const p = projectGround({ d: Math.max(isNear ? 1.5 : 0.8, d), bearing: bearingDeg(myPos, it), headingDeg, pitchDeg: pitchDeg ?? 0, view, zoom })
      if (!p) continue
      const size = p.inView ? Math.max(30, Math.min(170, p.pxPerM * VISUAL_M)) : 0
      // How flat a disc on the ground looks from here (top-down = round, grazing = a sliver).
      // The ray meets the ground at atan(h/d); a disc looks sin() of that as tall as wide.
      const squash = Math.max(0.22, Math.min(1, Math.sin(Math.atan2(PHONE_HEIGHT_M, Math.max(0.5, d)))))
      out.push({ ...it, d, x: p.x, y: p.y, size, squash, inView: p.inView, side: p.side, near: isNear })
    } catch {}
  }
  return out.sort((a, b) => b.d - a.d) // far ones behind near ones
}

const labelFor = (m) => m.label || tr(m.kind === 'c4' ? 'your_c4' : 'your_mine')

export const GroundExplosives = memo(function GroundExplosives({ markers, view }) {
  if (!markers?.length) return null
  const W = view?.width || 0
  const H = view?.height || 0
  // Off-screen near items: one "at your feet" chip (stacked), bottom centre.
  const feet = markers.filter((m) => !m.inView && m.near)
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => {
        const color = m.color || ST.objective
        const label = labelFor(m)
        const dist = m.near ? tr('near_you') : formatDistance(m.d).toUpperCase()
        if (!m.inView) {
          if (m.near) return null
          if (m.side === 'down' || m.side === 'up') {
            const x = Math.max(70, Math.min(W - 70, m.x))
            return (
              <View key={m.id} style={[s.edge, { left: x - 70, width: 140, justifyContent: 'center', borderLeftColor: color }, m.side === 'down' ? { bottom: Math.max(150, H * 0.24) } : { top: Math.max(130, H * 0.2) }]}>
                <Ionicons name={m.side === 'down' ? 'caret-down' : 'caret-up'} size={13} color={color} />
                <Text style={s.edgeText} numberOfLines={1}>{label} · {dist}</Text>
              </View>
            )
          }
          const right = m.side === 'right' || (m.side === 'behind' && m.x > W / 2)
          return (
            <View key={m.id} style={[s.edge, right ? { right: 8 } : { left: 8 }, { top: Math.max(120, Math.min(H - 220, m.y)) - 16, borderLeftColor: color }]}>
              {!right ? <Ionicons name="caret-back" size={13} color={color} /> : null}
              <Text style={s.edgeText} numberOfLines={1}>{label} · {dist}</Text>
              {right ? <Ionicons name="caret-forward" size={13} color={color} /> : null}
            </View>
          )
        }
        const w = m.size
        const h = m.kind === 'c4' ? w * 0.8 : w * 0.56
        const ringW = w * 1.25
        const ringH = Math.max(8, ringW * m.squash)
        return (
          <View key={m.id} style={[s.item, { left: m.x - w / 2, top: m.y - h, width: w }]}>
            <View style={[s.tag, { borderLeftColor: color }]}>
              <Text style={s.tagText} numberOfLines={1}>{label} · {dist}</Text>
            </View>
            <View style={[s.ring, { width: ringW, height: ringH, top: h - ringH / 2, left: (w - ringW) / 2, borderColor: color }]} />
            <Image source={m.kind === 'c4' ? C4_IMG : MINE_IMG} style={{ width: w, height: h }} resizeMode="contain" fadeDuration={0} />
          </View>
        )
      })}
      {feet.length ? (
        <View style={[s.feet, { bottom: Math.max(160, H * 0.26) }]}>
          <View style={[s.feetRing, { borderColor: feet[0].color || ST.objective }]} />
          <Text style={s.edgeText} numberOfLines={1}>
            {feet.length === 1 ? tr('at_feet', { label: labelFor(feet[0]) }) : tr('n_explosives_feet', { n: feet.length })}
          </Text>
        </View>
      ) : null}
    </View>
  )
})

const s = StyleSheet.create({
  item: { position: 'absolute', alignItems: 'center' },
  tag: { position: 'absolute', bottom: '100%', marginBottom: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 2, backgroundColor: ST.panel, borderLeftWidth: 2, maxWidth: 200 },
  tagText: { color: '#fff', fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1 },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 2, backgroundColor: 'rgba(0,0,0,0.28)' },
  edge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: ST.panel, borderLeftWidth: 2 },
  edgeText: { color: '#fff', fontFamily: FONT.ui, fontSize: 11, letterSpacing: 0.6 },
  feet: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 4 },
  feetRing: { width: 120, height: 30, borderRadius: 60, borderWidth: 2, backgroundColor: 'rgba(0,0,0,0.25)' },
})
