// Shooter-style crosshair: four ticks + centre dot. The ticks bloom outward on every shot
// and settle back, everything turns red with a target in your sights, and a white "X" hit
// marker flashes when a shot connects (red X on a kill).
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

const GAP = 9 // px from centre to the inner end of each tick
const LEN = 13
const THICK = 2.5

export default memo(function FpsCrosshair({ onTarget = false, shotTick = 0, hitTick = 0, killTick = 0, size = 72 }) {
  const bloom = useRef(new Animated.Value(0)).current
  const hit = useRef(new Animated.Value(0)).current
  const kill = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!shotTick) return
    bloom.setValue(1)
    Animated.timing(bloom, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [shotTick, bloom])

  useEffect(() => {
    if (!hitTick) return
    hit.setValue(1)
    Animated.timing(hit, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }).start()
  }, [hitTick, hit])

  useEffect(() => {
    if (!killTick) return
    kill.setValue(1)
    Animated.timing(kill, { toValue: 0, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }).start()
  }, [killTick, kill])

  const color = onTarget ? '#ff3346' : '#ffffff'
  const push = bloom.interpolate({ inputRange: [0, 1], outputRange: [0, 9] })
  const tick = (dx, dy, horizontal, key) => (
    <Animated.View
      key={key}
      style={[
        styles.tick,
        {
          backgroundColor: color,
          width: horizontal ? LEN : THICK,
          height: horizontal ? THICK : LEN,
          left: size / 2 + dx * (GAP + (horizontal ? LEN / 2 : 0)) - (horizontal ? LEN / 2 : THICK / 2),
          top: size / 2 + dy * (GAP + (horizontal ? 0 : LEN / 2)) - (horizontal ? THICK / 2 : LEN / 2),
          transform: horizontal ? [{ translateX: Animated.multiply(push, dx) }] : [{ translateY: Animated.multiply(push, dy) }],
        },
      ]}
    />
  )
  const marker = (anim, c, key) => (
    <Animated.View
      key={key}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1.15, 0.85] }) }] }]}
    >
      {[45, -45, 135, -135].map((r) => (
        <View key={r} style={[styles.hitArm, { backgroundColor: c, left: size / 2 - 1.5, top: size / 2 - 22, transform: [{ rotate: `${r}deg` }, { translateY: -6 }] }]} />
      ))}
    </Animated.View>
  )
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {tick(-1, 0, true, 'l')}
      {tick(1, 0, true, 'r')}
      {tick(0, -1, false, 't')}
      {tick(0, 1, false, 'b')}
      <View style={[styles.dot, { backgroundColor: color, left: size / 2 - 2, top: size / 2 - 2 }]} />
      {marker(hit, '#ffffff', 'hit')}
      {marker(kill, '#ff3346', 'kill')}
    </View>
  )
})

const styles = StyleSheet.create({
  tick: { position: 'absolute', borderRadius: 2, shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 2, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  dot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  hitArm: { position: 'absolute', width: 3, height: 12, borderRadius: 2, shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
})
