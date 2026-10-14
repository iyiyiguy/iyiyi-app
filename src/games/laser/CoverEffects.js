// Cover effects anchored in the AR view (laser/sceneDepth.js projectDirection): they stay on
// the wall while you turn, at the size the wall distance gives them.
//   scorch: a burn mark where a rocket hit a wall (~3 s, fading)
//   spark:  a laser shot stopped by cover (sparks + a small "COVER" tag, ~0.8 s). Visual only:
//           the host still decides hits.
// marks: [{ id, kind: 'scorch' | 'spark', bearing, elev, range }] (bearing / elev: degrees,
// the crosshair direction when it happened; range: metres to the wall).
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { FONT, ST } from '../studio'
import { apparentSize, projectDirection } from './sceneDepth'

export const SCORCH_MS = 3000
export const SPARK_MS = 800
const SCORCH_M = 1.6 // drawn this many metres wide on the wall
const SPARK_M = 0.9

function Scorch({ id, size, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: SCORCH_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const opacity = t.interpolate({ inputRange: [0, 0.06, 0.7, 1], outputRange: [0, 0.95, 0.75, 0] })
  const glow = t.interpolate({ inputRange: [0, 0.08, 0.5, 1], outputRange: [0, 0.9, 0.25, 0] })
  const s = size
  return (
    <Animated.View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center', opacity }}>
      <View style={[st.round, { width: s, height: s * 0.82, borderRadius: s / 2, backgroundColor: 'rgba(28,22,18,0.38)' }]} />
      <View style={[st.round, { width: s * 0.72, height: s * 0.6, borderRadius: s / 2, backgroundColor: 'rgba(18,14,12,0.6)' }]} />
      <View style={[st.round, { width: s * 0.42, height: s * 0.36, borderRadius: s / 2, backgroundColor: 'rgba(8,6,5,0.8)' }]} />
      {/* still-glowing embers in the middle */}
      <Animated.View style={[st.round, { width: s * 0.22, height: s * 0.18, borderRadius: s / 2, backgroundColor: 'rgba(255,120,40,0.85)', opacity: glow }]} />
      {[0, 1, 2, 3, 4].map((k) => {
        const a = (k / 5) * Math.PI * 2 + 0.4
        const r = s * (0.24 + (k % 2) * 0.08)
        return <Animated.View key={k} style={[st.round, { width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffb04a', opacity: glow, transform: [{ translateX: Math.cos(a) * r }, { translateY: Math.sin(a) * r * 0.82 }] }]} />
      })}
    </Animated.View>
  )
}

function Spark({ id, size, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: SPARK_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const opacity = t.interpolate({ inputRange: [0, 0.1, 0.6, 1], outputRange: [0, 1, 0.8, 0] })
  const burst = t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.25] })
  const s = size
  return (
    <Animated.View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center', opacity }}>
      <Animated.View style={[st.round, { width: s * 0.5, height: s * 0.5, borderRadius: s / 4, backgroundColor: 'rgba(255,214,120,0.55)', transform: [{ scale: burst }] }]} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
        const a = (k / 8) * 360 + 12
        return (
          <Animated.View key={k} style={[st.round, { transform: [{ rotate: `${a}deg` }, { scale: burst }] }]}>
            <View style={{ width: s * 0.46, height: 2, borderRadius: 1, backgroundColor: '#ffd27a', transform: [{ translateX: s * 0.26 }] }} />
          </Animated.View>
        )
      })}
      <View style={[st.round, { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }]} />
      <Text style={[st.coverTag, { top: s / 2 + 6 }]} numberOfLines={1}>COVER</Text>
    </Animated.View>
  )
}

export const CoverEffects = memo(function CoverEffects({ marks, headingDeg, pitchDeg, view, zoom = 1, onDone }) {
  if (!marks?.length || !(view?.width > 0) || !Number.isFinite(headingDeg)) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {marks.map((m) => {
        let p = null
        try { p = projectDirection({ bearing: m.bearing, elev: m.elev, headingDeg, pitchDeg: Number.isFinite(pitchDeg) ? pitchDeg : 0, view, zoom }) } catch { p = null }
        const size = Math.round(apparentSize(m.kind === 'spark' ? SPARK_M : SCORCH_M, m.range, view, zoom, m.kind === 'spark' ? { min: 44, max: 140 } : { min: 30, max: 240 }))
        // Off screen it keeps running (so it still ends on time), just not drawn there.
        const hidden = !p || p.x < -size || p.x > view.width + size || p.y < -size || p.y > view.height + size
        return (
          <View key={m.id} style={[st.anchor, { left: (p?.x ?? -1000) - size / 2, top: (p?.y ?? -1000) - size / 2, width: size, height: size, opacity: hidden ? 0 : 1 }]}>
            {m.kind === 'spark' ? <Spark id={m.id} size={size} onDone={onDone} /> : <Scorch id={m.id} size={size} onDone={onDone} />}
          </View>
        )
      })}
    </View>
  )
})

const st = StyleSheet.create({
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  round: { position: 'absolute' },
  coverTag: {
    position: 'absolute', fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.6, color: ST.objective,
    textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
  },
})
