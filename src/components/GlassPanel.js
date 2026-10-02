import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import Glass from './Glass'
import { radii } from '../theme'

// Props that size/position the panel itself go on the animated wrapper; the rest (padding,
// child layout, tint) go to the glass.
const LAYOUT_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'marginHorizontal', 'marginVertical', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginStart', 'marginEnd', 'alignSelf', 'position', 'top', 'left', 'right', 'bottom', 'zIndex', 'aspectRatio',
])

// The app-wide glass surface (cards, bars, pills). Liquid Glass on iOS 26+, a matched
// frosted fallback elsewhere (see Glass.js). Rises in gently on mount - animated with
// transform only, since fading a Liquid Glass view's opacity breaks the effect.
export default function GlassPanel({ children, style, radius = radii.lg, strong = false, intensity, animateIn = true, scheme = 'auto', interactive = false, contentStyle }) {
  const rise = useRef(new Animated.Value(animateIn ? 1 : 0)).current

  useEffect(() => {
    if (!animateIn) return
    Animated.spring(rise, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 160, mass: 0.8 }).start()
  }, [animateIn, rise])

  const flat = StyleSheet.flatten(style) || {}
  const layout = {}
  const rest = {}
  for (const k of Object.keys(flat)) (LAYOUT_KEYS.has(k) ? layout : rest)[k] = flat[k]
  const sized = layout.flex != null || layout.height != null || layout.width != null || layout.minHeight != null || layout.aspectRatio != null || layout.flexGrow != null

  const transform = [
    { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }) },
    { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) },
  ]

  return (
    <Animated.View style={[layout, { transform }]}>
      <Glass style={[rest, sized && { flex: 1 }]} radius={flat.borderRadius ?? radius} strong={strong} scheme={scheme} interactive={interactive} contentStyle={contentStyle}>
        {children}
      </Glass>
    </Animated.View>
  )
}
