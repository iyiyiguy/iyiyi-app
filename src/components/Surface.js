import { StyleSheet, View, useColorScheme } from 'react-native'

// The light-weight sibling of Glass: a translucent card with a sheen rim and soft shadow but no
// blur view behind it. Visually a close match to Glass on the aura (the aura is already soft),
// at a fraction of the cost - a BlurView / UIGlassEffect per cell in a long list is what makes
// Nearby, Discover and the feed feel heavy. Use Surface inside lists and grids; keep real Glass
// for bars, hero panels and sheets where one or two of them sit on top of busy content.
export default function Surface({ children, style, radius = 24, strong = false, scheme = 'auto', shadow = true, pointerEvents }) {
  const system = useColorScheme()
  const isDark = scheme === 'dark' || (scheme === 'auto' && system === 'dark')
  const flat = StyleSheet.flatten(style) || {}
  const r = flat.borderRadius ?? radius
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.base,
        isDark ? (strong ? styles.darkStrong : styles.dark) : (strong ? styles.lightStrong : styles.light),
        shadow && (isDark ? styles.shadowDark : styles.shadowLight),
        { borderRadius: r },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  light: { backgroundColor: 'rgba(255,255,255,0.58)', borderColor: 'rgba(255,255,255,0.9)' },
  lightStrong: { backgroundColor: 'rgba(255,255,255,0.78)', borderColor: 'rgba(255,255,255,0.95)' },
  dark: { backgroundColor: 'rgba(30,36,58,0.55)', borderColor: 'rgba(255,255,255,0.11)' },
  darkStrong: { backgroundColor: 'rgba(30,36,58,0.78)', borderColor: 'rgba(255,255,255,0.14)' },
  shadowLight: { shadowColor: '#3b4a7a', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  shadowDark: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
})
