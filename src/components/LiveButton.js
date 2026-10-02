import { useEffect, useRef } from 'react'
import { Animated, Easing, View, Text, Pressable, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, font, radii } from '../theme'
import Glass from './Glass'

// Pulsing red dot - the "on air" signal used by the Live button and the Stream screen.
export function LiveDot({ size = 8, color = '#ff3b4f' }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  const ring = size * 2.6
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', width: ring, height: ring, borderRadius: ring / 2, backgroundColor: color,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  )
}

// Glass "● Live" pill for headers; opens the Stream screen.
export default function LiveButton({ onPress, label = 'Live' }) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.() }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Open live stream"
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Glass radius={21} style={styles.pill} interactive shadow={false}>
        <View style={styles.inner}>
          <LiveDot />
          <Text style={styles.text}>{label}</Text>
        </View>
      </Glass>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: { height: 42, borderRadius: radii.pill },
  inner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15 },
  text: { fontSize: 15, ...font.bold, color: colors.text, letterSpacing: 0.2 },
})
