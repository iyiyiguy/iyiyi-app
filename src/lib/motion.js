import { useEffect, useRef } from 'react'
import { Animated, Easing, LayoutAnimation, Platform, Pressable, UIManager } from 'react-native'
import * as Haptics from 'expo-haptics'

// iOS-feel motion for the whole app, built on the native animation driver (no JS-thread work
// per frame). Springs are tuned like UIKit's defaults: quick to settle, a touch of overshoot.
export const SPRING = {
  // Standard UI spring (sheets rising, cards settling).
  default: { damping: 18, stiffness: 180, mass: 0.9, useNativeDriver: true },
  // Snappier, for things that respond to a finger (press, toggle).
  snappy: { damping: 20, stiffness: 320, mass: 0.7, useNativeDriver: true },
  // Softer and slower for large elements (hero content, screens).
  gentle: { damping: 22, stiffness: 120, mass: 1, useNativeDriver: true },
}

export const EASE = {
  out: Easing.bezier(0.22, 1, 0.36, 1), // UIKit ease-out
  inOut: Easing.bezier(0.45, 0, 0.55, 1),
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// Animate the next layout change (list insert/remove, expanding sections) like iOS does.
export function animateLayout(duration = 280) {
  if (Platform.OS === 'web') return
  LayoutAnimation.configureNext({
    duration,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.85 },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  })
}

// Drives a 0 -> 1 value on mount (optionally delayed). Returns the Animated.Value.
export function useEntrance({ delay = 0, spring = SPRING.gentle, enabled = true } = {}) {
  const v = useRef(new Animated.Value(enabled ? 0 : 1)).current
  useEffect(() => {
    if (!enabled) return
    const anim = Animated.spring(v, { toValue: 1, delay, ...spring })
    anim.start()
    return () => anim.stop()
  }, [v, delay, enabled, spring])
  return v
}

// Fades + rises content in on mount. `index` staggers siblings (index * 45ms).
export function FadeIn({ children, style, index = 0, delay = 0, distance = 14, enabled = true, pointerEvents }) {
  const v = useEntrance({ delay: delay + index * 45, enabled })
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        enabled && {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

// Scales in from slightly smaller, like an iOS alert / popover.
export function PopIn({ children, style, delay = 0, enabled = true }) {
  const v = useEntrance({ delay, enabled, spring: SPRING.default })
  return (
    <Animated.View style={[style, enabled && { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
      {children}
    </Animated.View>
  )
}

// A Pressable that squeezes on touch and springs back, with a light haptic tick. Use it for
// every tappable surface (cards, buttons, chips) so the whole app responds the same way.
export function Press({ onPress, onLongPress, children, style, scaleTo = 0.96, haptic = 'selection', disabled, hitSlop, accessibilityRole = 'button', accessibilityLabel, accessibilityState, pointerEvents }) {
  const scale = useRef(new Animated.Value(1)).current
  const to = (v) => Animated.spring(scale, { toValue: v, ...SPRING.snappy }).start()
  const handlePress = (e) => {
    if (haptic === 'selection') Haptics.selectionAsync().catch(() => {})
    else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    else if (haptic === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    onPress?.(e)
  }
  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={disabled ? { opacity: 0.5 } : undefined}
      pointerEvents={pointerEvents}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  )
}

// Continuous soft pulse (1 -> 1.04 -> 1) for a call-to-action; returns a scale value.
export function usePulse(active = true, amount = 0.04, period = 1600) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: period / 2, easing: EASE.inOut, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period / 2, easing: EASE.inOut, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [active, v, period])
  return v.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + amount] })
}

// Slow drifting orb for backgrounds (translate on a loop). Returns {translateX, translateY}.
export function useDrift(rangeX = 18, rangeY = 24, period = 9000) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: period, easing: EASE.inOut, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period, easing: EASE.inOut, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [v, period])
  return {
    translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, rangeX] }),
    translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, rangeY] }),
  }
}
