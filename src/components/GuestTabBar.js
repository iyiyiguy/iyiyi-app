import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, useColorScheme, Animated, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, font, radii } from '../theme'
import Glass from './Glass'
import Bounce from './Bounce'

// The logged-out version of the app's floating glass tab bar (see TabBar.js): same pill, same
// round camera button beside it. Camera and Arcade are visible but carry a small lock - their
// tabs only show a "Sign up to ..." screen.
const TABS = [
  { name: 'Explore', icon: 'compass', label: 'Explore' },
  { name: 'Recommended', icon: 'sparkles', label: 'Discover' },
  { name: 'Feed', icon: 'albums', label: 'Feed' },
  { name: 'Arcade', icon: 'game-controller', label: 'Arcade', locked: true },
]

// Height of the bar (incl. its safe-area padding), so overlays can sit just above it.
const ROW_H = 60
export const guestTabBarHeight = (insets) => 6 + ROW_H + Math.max(insets.bottom - 6, 12)

function Lock({ style }) {
  return (
    <View style={[styles.lock, style]} pointerEvents="none">
      <Ionicons name="lock-closed" size={8} color="#fff" />
    </View>
  )
}

export default function GuestTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets()
  const dark = useColorScheme() === 'dark'
  const current = state.routes[state.index]?.name
  const go = (name) => {
    if (current !== name) Haptics.selectionAsync().catch(() => {})
    navigation.navigate(name)
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 6, 12) }]} pointerEvents="box-none">
      <Glass radius={32} style={styles.bar} interactive>
        <View style={styles.row}>
          {TABS.filter((t) => state.routes.some((r) => r.name === t.name)).map((t) => {
            const focused = current === t.name
            return (
              <Bounce
                key={t.name}
                scaleTo={0.86}
                accessibilityRole="tab"
                accessibilityLabel={t.locked ? `${t.label} (sign up to use)` : t.label}
                accessibilityState={{ selected: focused }}
                hitSlop={4}
                onPress={() => go(t.name)}
                style={[styles.tab, focused && (dark ? styles.tabActiveDark : styles.tabActiveLight)]}
              >
                <Ionicons name={focused ? t.icon : `${t.icon}-outline`} size={22} color={focused ? colors.text : colors.textMuted} />
                {t.locked ? <Lock /> : null}
              </Bounce>
            )
          })}
        </View>
      </Glass>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
          navigation.navigate('Camera')
        }}
        accessibilityRole="tab"
        accessibilityLabel="Camera (sign up to use)"
        accessibilityState={{ selected: current === 'Camera' }}
        style={({ pressed }) => [pressed && { transform: [{ scale: 0.92 }] }]}
      >
        <Glass radius={30} style={styles.camera} interactive>
          <View style={[styles.cameraInner, current === 'Camera' && (dark ? styles.tabActiveDark : styles.tabActiveLight)]}>
            <Ionicons name="camera" size={24} color={colors.text} />
          </View>
        </Glass>
        <Lock style={{ right: 4, top: 4 }} />
      </Pressable>
    </View>
  )
}

// The floating, gently pulsing "Sign up free" pill shown over the guest tabs.
export function GuestSignupPill({ bottom, onPress }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })
  return (
    <Animated.View style={[styles.pillWrap, { bottom, transform: [{ scale }] }]} pointerEvents="box-none">
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Sign up" style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
        <LinearGradient colors={['#ff4fa3', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
          <Ionicons name="sparkles" size={16} color="#fff" />
          <Text style={styles.pillText}>Sign up free</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 10 },
  bar: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 8 },
  tab: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tabActiveLight: { backgroundColor: 'rgba(255,255,255,0.75)' },
  tabActiveDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  camera: { width: ROW_H, height: ROW_H },
  cameraInner: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 30 },
  lock: {
    position: 'absolute', right: 5, top: 5, width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#8f5bff', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)',
  },
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 26, height: 50, borderRadius: radii.pill,
    shadowColor: '#ff4fa3', shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  pillText: { color: '#fff', fontSize: 16, ...font.bold, letterSpacing: 0.2 },
})
