// Shooter reticle, per the studio HUD kit:
//   idle      — four white ticks + centre dot
//   on target — red ticks + a thin red ring
//   hit       — white "X" hit marker (kit: 90 ms, then a quick fade)
//   tag-out   — big red X
// The ticks bloom outward on every shot and settle back. Purely visual.
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

const ENEMY = '#ff3d52'
const GAP = 10 // px from centre to the inner end of each tick
const LEN = 12

export default memo(function FpsCrosshair({ onTarget = false, shotTick = 0, hitTick = 0, killTick = 0, size = 64 }) {
  const bloom = useRef(new Animated.Value(0)).current
  const hit = useRef(new Animated.Value(0)).current
  const kill = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!shotTick) return
    bloom.setValue(1)
    Animated.timing(bloom, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [shotTick, bloom])

  useEffect(() => {
    if (!hitTick) return
    hit.setValue(1)
    Animated.sequence([
      Animated.delay(90),
      Animated.timing(hit, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [hitTick, hit])

  useEffect(() => {
    if (!killTick) return
    kill.setValue(1)
    Animated.sequence([
      Animated.delay(320),
      Animated.timing(kill, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [killTick, kill])

  const c = size / 2
  const color = onTarget ? ENEMY : '#ffffff'
  const thick = onTarget ? 2.4 : 2
  const push = bloom.interpolate({ inputRange: [0, 1], outputRange: [0, 8] })
  const tick = (dx, dy, key) => {
    const horizontal = dy === 0
    return (
      <Animated.View
        key={key}
        style={[
          styles.tick,
          {
            backgroundColor: color,
            width: horizontal ? LEN : thick,
            height: horizontal ? thick : LEN,
            left: horizontal ? (dx < 0 ? c - GAP - LEN : c + GAP) : c - thick / 2,
            top: horizontal ? c - thick / 2 : (dy < 0 ? c - GAP - LEN : c + GAP),
            transform: horizontal ? [{ translateX: Animated.multiply(push, dx) }] : [{ translateY: Animated.multiply(push, dy) }],
          },
        ]}
      />
    )
  }
  // A bar of length `len` centred at distance `d` from the middle along a diagonal.
  const arm = (key, ang, d, len, w, col) => {
    const rad = (ang * Math.PI) / 180
    const x = c + Math.cos(rad) * d
    const y = c + Math.sin(rad) * d
    return <View key={key} style={[styles.arm, { backgroundColor: col, width: len, height: w, left: x - len / 2, top: y - w / 2, transform: [{ rotate: `${ang}deg` }] }]} />
  }
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {tick(-1, 0, 'l')}
      {tick(1, 0, 'r')}
      {tick(0, -1, 't')}
      {tick(0, 1, 'b')}
      {onTarget ? <View style={[styles.ring, { left: c - 12, top: c - 12 }]} /> : null}
      <View style={[styles.dot, { backgroundColor: onTarget ? '#ffffff' : color, left: c - 1.75, top: c - 1.75 }]} />
      {/* hit marker: four short white diagonals around the centre */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: hit, transform: [{ scale: hit.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) }] }]}>
        {[45, 135, 225, 315].map((a) => arm(`h${a}`, a, 11.5, 11, 3, '#ffffff'))}
      </Animated.View>
      {/* tag-out: a big red X through the middle */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: kill, transform: [{ scale: kill.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) }] }]}>
        {arm('k1', 45, 0, 40, 4, ENEMY)}
        {arm('k2', -45, 0, 40, 4, ENEMY)}
      </Animated.View>
    </View>
  )
})

const styles = StyleSheet.create({
  tick: { position: 'absolute', shadowColor: '#000', shadowOpacity: 0.85, shadowRadius: 2, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  dot: { position: 'absolute', width: 3.5, height: 3.5, shadowColor: '#000', shadowOpacity: 0.85, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  ring: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 1.4, borderColor: ENEMY },
  arm: { position: 'absolute', shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
})
