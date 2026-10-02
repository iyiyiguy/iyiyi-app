import { useCallback, useRef, useState } from 'react'
import { View, ScrollView, Pressable, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, usePageInk } from '../theme'
import Glass from './Glass'

// Horizontal ScrollView that shows a soft edge fade + a tappable chevron on whichever side
// still has content offscreen, so a chip row visibly "continues" (e.g. Nationwide ->
// International). Tapping a chevron pages the row by ~70% of its width.
//
// Props:
//   children                 the row content
//   contentContainerStyle    passed to the ScrollView (put paddingHorizontal / gap here)
//   style                    outer wrapper style
//   scrollRef                optional ref object; receives the inner ScrollView
//   onContentLayout          optional (contentWidth) => void
export default function ScrollArrows({ children, contentContainerStyle, style, scrollRef, onContentLayout }) {
  const { ink } = usePageInk()
  const innerRef = useRef(null)
  const x = useRef(0)
  const viewW = useRef(0)
  const contentW = useRef(0)
  const [edges, setEdges] = useState({ left: false, right: false })

  const setRefs = useCallback((node) => {
    innerRef.current = node
    if (scrollRef && typeof scrollRef === 'object') scrollRef.current = node
  }, [scrollRef])

  const recompute = useCallback(() => {
    const left = x.current > 4
    const right = contentW.current - viewW.current - x.current > 4
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  const page = (dir) => {
    Haptics.selectionAsync().catch(() => {})
    const max = Math.max(0, contentW.current - viewW.current)
    const next = Math.min(max, Math.max(0, x.current + dir * viewW.current * 0.7))
    innerRef.current?.scrollTo?.({ x: next, animated: true })
  }

  const fadeSolid = hexToRgba(ink, 0.92)
  const fadeClear = hexToRgba(ink, 0)

  return (
    <View style={[styles.wrap, style]}>
      <ScrollView
        ref={setRefs}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        scrollEventThrottle={32}
        onScroll={(e) => { x.current = e.nativeEvent?.contentOffset?.x ?? 0; recompute() }}
        onLayout={(e) => { viewW.current = e.nativeEvent?.layout?.width ?? 0; recompute() }}
        onContentSizeChange={(w) => { contentW.current = w ?? 0; onContentLayout?.(w); recompute() }}
      >
        {children}
      </ScrollView>
      {edges.left ? (
        <View style={[styles.edge, styles.edgeLeft]} pointerEvents="box-none">
          <LinearGradient colors={[fadeSolid, fadeClear]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Arrow icon="chevron-back" onPress={() => page(-1)} label="Scroll left" />
        </View>
      ) : null}
      {edges.right ? (
        <View style={[styles.edge, styles.edgeRight]} pointerEvents="box-none">
          <LinearGradient colors={[fadeClear, fadeSolid]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Arrow icon="chevron-forward" onPress={() => page(1)} label="Scroll right" />
        </View>
      ) : null}
    </View>
  )
}

function Arrow({ icon, onPress, label }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.9 }] }]}
    >
      <Glass radius={14} style={styles.arrow} interactive shadow={false}>
        <View style={styles.arrowInner}>
          <Ionicons name={icon} size={16} color={colors.text} />
        </View>
      </Glass>
    </Pressable>
  )
}

function hexToRgba(hex, a) {
  if (typeof hex !== 'string' || hex.length < 7) return `rgba(12,15,26,${a})`
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  edge: { position: 'absolute', top: 0, bottom: 0, width: 52, justifyContent: 'center' },
  edgeLeft: { left: 0, alignItems: 'flex-start', paddingLeft: 6 },
  edgeRight: { right: 0, alignItems: 'flex-end', paddingRight: 6 },
  arrow: { width: 28, height: 28 },
  arrowInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
