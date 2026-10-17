// Horizontal scroll row that shows it can scroll: the edge with more content fades out and gets a
// small chevron (tap it to scroll on). Drop-in for <ScrollView horizontal>.
import { useRef, useState } from 'react'
import { View, ScrollView, Pressable, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'

function rgba(hex, a) {
  const h = String(hex || '#000').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16) || 0
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export default function HScroll({ children, style, contentContainerStyle, fadeColor = '#000000', iconColor = 'rgba(255,255,255,0.85)', ...rest }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  const [cw, setCw] = useState(0)
  const [x, setX] = useState(0)
  const more = cw - w - x > 6
  const less = x > 6
  return (
    <View style={[st.wrap, style]}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onContentSizeChange={(cW) => setCw(cW)}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
        contentContainerStyle={contentContainerStyle}
        {...rest}
      >
        {children}
      </ScrollView>
      {less ? (
        <LinearGradient pointerEvents="none" colors={[rgba(fadeColor, 0.95), rgba(fadeColor, 0)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.edge, { left: 0 }]} />
      ) : null}
      {more ? (
        <Pressable onPress={() => ref.current?.scrollTo({ x: Math.min(cw - w, x + w * 0.7), animated: true })} style={[st.edge, st.right]} accessibilityLabel="Scroll for more" hitSlop={6}>
          <LinearGradient pointerEvents="none" colors={[rgba(fadeColor, 0), rgba(fadeColor, 0.95)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <Ionicons name="chevron-forward" size={16} color={iconColor} />
        </Pressable>
      ) : null}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { position: 'relative' },
  edge: { position: 'absolute', top: 0, bottom: 0, width: 36 },
  right: { right: 0, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 2 },
})
