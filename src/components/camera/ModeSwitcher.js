import React, { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'

const ITEM_W = 74
export const MODE_ACTIVE_COLOR = '#ffd60a'
const MODES = [
  { key: 'video', label: 'VIDEO' },
  { key: 'picture', label: 'PHOTO' },
]

// "VIDEO · PHOTO" strip like the iPhone Camera app: the selected mode slides to the centre in
// yellow. Tap a label (or swipe across the preview - handled by the screen) to switch.
export default function ModeSwitcher({ mode, onChange, disabled }) {
  const idx = Math.max(0, MODES.findIndex((m) => m.key === mode))
  const shift = useRef(new Animated.Value(idx)).current

  useEffect(() => {
    Animated.spring(shift, { toValue: idx, useNativeDriver: true, friction: 9, tension: 80 }).start()
  }, [idx, shift])

  // Centre of the strip sits under item `idx`.
  const translateX = shift.interpolate({
    inputRange: [0, MODES.length - 1],
    outputRange: [((MODES.length - 1) * ITEM_W) / 2, -((MODES.length - 1) * ITEM_W) / 2],
  })

  return (
    <View style={[styles.wrap, disabled && { opacity: 0.35 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Animated.View style={[styles.strip, { transform: [{ translateX }] }]}>
        {MODES.map((m) => {
          const active = m.key === mode
          return (
            <Pressable
              key={m.key}
              onPress={() => !active && onChange?.(m.key)}
              style={styles.item}
              hitSlop={{ top: 10, bottom: 10 }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${m.label.toLowerCase()} mode`}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{m.label}</Text>
            </Pressable>
          )
        })}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { height: 26, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  strip: { flexDirection: 'row' },
  item: { width: ITEM_W, alignItems: 'center', justifyContent: 'center' },
  label: {
    color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', letterSpacing: 1.2,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3,
  },
  labelActive: { color: MODE_ACTIVE_COLOR },
})
