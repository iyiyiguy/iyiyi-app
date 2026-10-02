import { Platform, StyleSheet, View, useColorScheme } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'

// One glass primitive for the whole app.
//
// iOS 26+: Apple's own Liquid Glass (UIGlassEffect via expo-glass-effect) - real refraction,
// specular edge and the system's light/dark adaptation, so it looks exactly like the OS.
// Older iOS / Android / web: a frosted fallback tuned to read the same way - a thin system
// material blur, a pale fill, a bright top-left sheen, a soft glow along the bottom edge and a
// hairline rim, with a wide diffuse shadow for lift.
let liquid = false
try {
  liquid = Platform.OS === 'ios' && isLiquidGlassAvailable()
} catch {
  liquid = false
}
export const hasLiquidGlass = liquid

export default function Glass({
  children,
  style,
  contentStyle,
  radius: radiusProp = 28,
  // 'auto' follows the app's light/dark setting; 'dark' forces dark glass (e.g. over the camera).
  scheme = 'auto',
  strong = false,
  interactive = false,
  tintColor,
  shadow = true,
  pointerEvents,
}) {
  const system = useColorScheme()
  const isDark = scheme === 'dark' || (scheme === 'auto' && system === 'dark')
  // Layout props (margins, flex, position, size) stay on the outer view so the shadow and
  // the glass line up; padding and child layout (flexDirection, alignItems, gap...) move to
  // the inner content view so callers can style a Glass like a normal View.
  const { outerStyle, innerStyle } = splitStyle(style)
  const radius = outerStyle.borderRadius ?? radiusProp
  const outer = [styles.outer, shadow && (isDark ? styles.shadowDark : styles.shadowLight), { borderRadius: radius }, outerStyle]

  if (liquid) {
    return (
      <View style={outer} pointerEvents={pointerEvents}>
        <GlassView
          glassEffectStyle="regular"
          colorScheme={scheme === 'auto' ? 'auto' : scheme}
          isInteractive={interactive}
          tintColor={tintColor ?? (strong ? (isDark ? 'rgba(20,24,40,0.35)' : 'rgba(255,255,255,0.35)') : undefined)}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        <View style={[styles.content, { borderRadius: radius }, innerStyle, contentStyle]}>{children}</View>
      </View>
    )
  }

  return (
    <View style={outer} pointerEvents={pointerEvents}>
      <View style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]} pointerEvents="none">
        <BlurView
          intensity={Platform.OS === 'ios' ? 70 : 40}
          tint={isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: tintColor ?? (isDark
                ? (strong ? 'rgba(28,33,54,0.62)' : 'rgba(28,33,54,0.42)')
                : (strong ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.40)')),
            },
          ]}
        />
        {/* sheen: light catching the top-left of the glass */}
        <LinearGradient
          colors={isDark ? ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
        {/* soft glow pooling along the bottom edge, like thick frosted glass */}
        <LinearGradient
          colors={isDark ? ['rgba(140,160,255,0)', 'rgba(140,160,255,0.10)'] : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)']}
          start={{ x: 0.5, y: 0.55 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderTopColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.95)',
              borderLeftColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)',
              borderRightColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)',
              borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)',
            },
          ]}
        />
      </View>
      <View style={[styles.content, { borderRadius: radius }, innerStyle, contentStyle]}>{children}</View>
    </View>
  )
}

const INNER_KEYS = new Set([
  'padding', 'paddingHorizontal', 'paddingVertical', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingStart', 'paddingEnd', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap', 'rowGap',
  'columnGap', 'alignContent',
])

function splitStyle(style) {
  const flat = StyleSheet.flatten(style) || {}
  const outerStyle = {}
  const innerStyle = {}
  for (const k of Object.keys(flat)) {
    if (INNER_KEYS.has(k)) innerStyle[k] = flat[k]
    else if (k === 'backgroundColor' || k.startsWith('border') && k !== 'borderRadius') innerStyle[k] = flat[k]
    else if (k === 'overflow') continue
    else outerStyle[k] = flat[k]
  }
  // A Glass with a fixed height/flex should stretch its content to fill it.
  if (outerStyle.height != null || outerStyle.flex != null || outerStyle.minHeight != null || outerStyle.aspectRatio != null) innerStyle.flex = 1
  return { outerStyle, innerStyle }
}

const styles = StyleSheet.create({
  outer: { backgroundColor: 'transparent' },
  clip: { overflow: 'hidden' },
  content: { overflow: 'hidden' },
  shadowLight: {
    shadowColor: '#3b4a7a',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  shadowDark: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
})
