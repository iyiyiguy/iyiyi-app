// HIP FIRE view (studio "HipFire" board): with the phone held flat the camera only sees the
// ground, so the screen becomes a heading-up tactical radar. The top edge of the phone is
// the gun: the cyan cone is where a tap lands (compass + GPS aim), enemies are red diamonds
// (the one in your sights glows and is named), teammates cyan dots, S&D sites gold.
// Purely visual: the whole screen underneath is the trigger (LaserTagGame.js).
import React, { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'
import { angleDiff, formatDistance } from '../../lib/multiplayer'
import { FONT, ST, stShadow, stType } from '../studio'

const rad = (d) => (d * Math.PI) / 180

/**
 * Where something `d` m away at `bearing` sits on a radar of `size` px (heading-up, you at
 * the centre), relative to the radar's top-left corner. The game uses the same maths to fly
 * hip-fire bolts and rockets from the centre to the locked diamond.
 */
export function radarPoint({ size, heading, rangeM, d, bearing }) {
  const c = size / 2
  const r = c - 2
  const rel = rad(angleDiff(bearing, heading || 0))
  const f = Math.min(1, (d || 0) / Math.max(1, rangeM))
  return { x: c + Math.sin(rel) * f * (r - 8), y: c - Math.cos(rel) * f * (r - 8), out: (d || 0) > rangeM }
}

/**
 * size: px. heading: degrees. rangeM: outer ring. coneDeg: half-angle of the firing cone.
 * enemies / mates / objectives: [{ id, d, bearing, name?, label? }]. lockedId: in your sights.
 * explosives: [{ id, d, bearing, kind: 'c4'|'mine', color? }] placed ones you can see.
 */
export const HipFireRadar = memo(function HipFireRadar({ size = 300, heading, rangeM = 40, coneDeg = 20, enemies = [], mates = [], objectives = [], explosives = [], lockedId = null }) {
  const c = size / 2
  const r = c - 2
  const place = (o) => ({ ...radarPoint({ size, heading, rangeM, d: o.d, bearing: o.bearing }), inCone: Math.abs(angleDiff(o.bearing, heading || 0)) <= coneDeg })
  const cone = Math.max(4, Math.min(60, coneDeg))
  const lx = c + Math.sin(rad(-cone)) * r
  const ly = c - Math.cos(rad(-cone)) * r
  const rx = c + Math.sin(rad(cone)) * r
  const ry = c - Math.cos(rad(cone)) * r
  const wedge = `M${c} ${c} L${lx} ${ly} A${r} ${r} 0 0 1 ${rx} ${ry} Z`
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke="rgba(255,255,255,0.22)" strokeWidth={1} fill="rgba(8,10,14,0.4)" />
        <Circle cx={c} cy={c} r={r * 0.66} stroke="rgba(255,255,255,0.14)" strokeWidth={1} fill="none" />
        <Circle cx={c} cy={c} r={r * 0.33} stroke="rgba(255,255,255,0.1)" strokeWidth={1} fill="none" />
        <Path d={wedge} fill="rgba(57,213,255,0.14)" />
        <Line x1={c} y1={c} x2={c} y2={c - r} stroke="rgba(57,213,255,0.6)" strokeWidth={1} />
      </Svg>
      {objectives.map((o) => {
        const p = place(o)
        return (
          <View key={o.id} style={[st.obj, { left: p.x - 8, top: p.y - 8, opacity: p.out ? 0.6 : 1 }]}>
            <View style={st.objDiamond} />
            <Text style={st.objText}>{o.label}</Text>
          </View>
        )
      })}
      {explosives.map((x) => {
        const p = place(x)
        return <View key={x.id} style={[x.kind === 'mine' ? st.xMine : st.xC4, { left: p.x - 5, top: p.y - 5, borderColor: x.color || ST.objective, opacity: p.out ? 0.5 : 1 }]} />
      })}
      {mates.map((m) => {
        const p = place(m)
        return <View key={m.id} style={[st.mate, { left: p.x - 4.5, top: p.y - 4.5, opacity: p.out ? 0.5 : 1 }]} />
      })}
      {enemies.map((e) => {
        const p = place(e)
        const locked = e.id === lockedId
        const sz = locked ? 16 : 10
        return (
          <View key={e.id} style={{ position: 'absolute', left: p.x - 60, top: p.y - sz / 2, width: 120, alignItems: 'center' }}>
            <View style={[st.enemy, { width: sz, height: sz, opacity: locked ? 1 : p.inCone && !p.out ? 0.9 : 0.55 }, locked && st.enemyLocked]} />
            {locked ? <Text style={st.enemyName} numberOfLines={1}>{String(e.name || 'Enemy').toUpperCase()} · {formatDistance(e.d).toUpperCase()}</Text> : null}
          </View>
        )
      })}
      <View style={[st.me, { left: c - 8, top: c - 10 }]} />
      <Text style={[st.range, { top: c + r * 0.86 - 7 }]}>{formatDistance(rangeM).toUpperCase()}</Text>
    </View>
  )
})

/** "TARGET IN SIGHTS" + hit chance, or how to find one. */
export function HipFireStatus({ target, waiting }) {
  if (!target) {
    return (
      <View style={st.statusWrap} pointerEvents="none">
        <View style={[st.lock, st.lockIdle]}>
          <Text style={st.lockText}>{waiting ? 'WAITING FOR PLAYERS’ GPS' : 'NO TARGET'}</Text>
        </View>
      </View>
    )
  }
  const pct = Math.round(Math.max(0, Math.min(1, target.chance || 0)) * 100)
  return (
    <View style={st.statusWrap} pointerEvents="none">
      <View style={st.lock}>
        <View style={st.lockDiamond} />
        <Text style={st.lockText}>TARGET IN SIGHTS</Text>
      </View>
      <View style={st.chanceRow}>
        <Text style={stType.label}>HIT CHANCE</Text>
        <View style={st.chanceTrack}><View style={[st.chanceFill, { width: `${pct}%` }]} /></View>
        <Text style={st.chanceNum}>{pct}%</Text>
      </View>
    </View>
  )
}

/** The dashed "TAP ANYWHERE" zone (visual only; the screen behind it fires). */
export function HipFireZone({ auto, height = 96 }) {
  return (
    <View style={[st.zone, { height }]} pointerEvents="none">
      <Text style={st.zoneTitle}>TAP ANYWHERE</Text>
      <Text style={st.zoneSub} numberOfLines={2}>{auto ? 'HOLD FOR AUTO' : 'EVERY TAP FIRES'} · RAISE THE PHONE TO AIM WITH THE CAMERA</Text>
    </View>
  )
}

const st = StyleSheet.create({
  me: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 20, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ST.friendly },
  mate: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: ST.friendly },
  xC4: { position: 'absolute', width: 10, height: 10, borderRadius: 1, borderWidth: 2, backgroundColor: 'rgba(8,10,14,0.6)' },
  xMine: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, backgroundColor: 'rgba(8,10,14,0.6)' },
  enemy: { backgroundColor: ST.enemy, transform: [{ rotate: '45deg' }] },
  enemyLocked: { boxShadow: '0 0 12px rgba(255,61,82,0.9)' },
  enemyName: { marginTop: 6, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: ST.panel, borderRadius: 2, fontFamily: FONT.ui, fontSize: 11, color: '#ffffff', overflow: 'hidden' },
  obj: { position: 'absolute', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  objDiamond: { position: 'absolute', width: 12, height: 12, backgroundColor: ST.objective, transform: [{ rotate: '45deg' }] },
  objText: { fontFamily: FONT.display, fontSize: 9, color: ST.ink, includeFontPadding: false },
  range: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: FONT.display, fontSize: 11, color: 'rgba(242,244,247,0.6)' },
  statusWrap: { alignItems: 'center', gap: 8 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: ST.radius, backgroundColor: 'rgba(255,61,82,0.16)', borderWidth: 1, borderColor: ST.enemy },
  lockIdle: { backgroundColor: ST.panel, borderColor: 'rgba(255,255,255,0.18)' },
  lockDiamond: { width: 8, height: 8, backgroundColor: ST.enemy, transform: [{ rotate: '45deg' }] },
  lockText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 1, color: '#ffffff' },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chanceTrack: { width: 120, height: 5, backgroundColor: 'rgba(255,255,255,0.16)' },
  chanceFill: { height: 5, backgroundColor: ST.friendly },
  chanceNum: { fontFamily: FONT.display, fontSize: 13, color: '#ffffff', ...stShadow },
  zone: { alignSelf: 'stretch', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)', borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 12 },
  zoneTitle: { fontFamily: FONT.display, fontSize: 18, letterSpacing: 3, color: '#ffffff' },
  zoneSub: { fontFamily: FONT.uiSemi, fontSize: 11, letterSpacing: 1.2, color: 'rgba(242,244,247,0.6)', textAlign: 'center' },
})
