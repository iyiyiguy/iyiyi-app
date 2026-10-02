import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { FILTERS, filterLabel } from '../../../lib/cameraFilters'
import { IY_LOGO } from './FilterArt'

const GAP = 8
const MIN_SIZE = 30
const MAX_SIZE = 46

function Thumb({ id, size }) {
  const icon = Math.round(size * 0.46)
  if (id === 'logo') {
    return (
      <LinearGradient colors={['#2a0c3a', '#140a24']} style={StyleSheet.absoluteFill}>
        <View style={styles.thumbCenter}>
          <Image source={IY_LOGO} style={{ width: size * 0.62, height: size * 0.51 }} resizeMode="contain" fadeDuration={0} />
        </View>
      </LinearGradient>
    )
  }
  if (id === 'nametag') {
    return (
      <LinearGradient colors={['rgba(120,140,255,0.55)', 'rgba(30,34,58,0.7)']} style={StyleSheet.absoluteFill}>
        <View style={styles.thumbCenter}>
          <Text style={[styles.thumbAt, { fontSize: Math.round(size * 0.42) }]}>@</Text>
        </View>
      </LinearGradient>
    )
  }
  if (id === 'love') {
    return (
      <LinearGradient colors={['#ff8cc6', '#e3166a']} style={StyleSheet.absoluteFill}>
        <View style={styles.thumbCenter}>
          <Ionicons name="chatbubble" size={icon} color="#fff" />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={styles.thumbCenter}>
              <Ionicons name="heart" size={Math.round(icon * 0.5)} color="#e3166a" style={{ marginTop: -2 }} />
            </View>
          </View>
        </View>
      </LinearGradient>
    )
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.thumbCenter, { backgroundColor: 'rgba(30,30,50,0.45)' }]}>
      <Ionicons name="ban-outline" size={icon} color="rgba(255,255,255,0.9)" />
    </View>
  )
}

// Snapchat-style filter strip down the right edge of the camera: round thumbnails for
// None / iY Logo / Name Tag / I love you. Tap one, or swipe up/down on the strip to step through.
// Sizes itself to the room between `top` and `bottom` (px from the card's top / bottom edges).
export default function FilterPicker({ value, onChange, disabled, top, bottom, note }) {
  const [avail, setAvail] = useState(0)
  const n = FILTERS.length
  const room = avail - (note ? 32 : 0)
  const size = avail > 0 ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor((room - GAP * (n - 1) - 12) / n))) : 40
  const idx = Math.max(0, FILTERS.findIndex((f) => f.id === value))
  const label = useRef(new Animated.Value(0)).current
  const [shownLabel, setShownLabel] = useState(null)
  const first = useRef(true)

  // Flash the filter's name beside the strip when it changes.
  useEffect(() => {
    if (first.current) { first.current = false; return undefined }
    setShownLabel(filterLabel(value))
    label.setValue(0)
    const anim = Animated.sequence([
      Animated.timing(label, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(label, { toValue: 0, duration: 300, useNativeDriver: true }),
    ])
    anim.start()
    return () => anim.stop()
  }, [value, label])

  const select = (id) => {
    if (disabled || id === value) return
    Haptics.selectionAsync().catch(() => {})
    try { onChange?.(id) } catch {}
  }
  const selectRef = useRef(select)
  selectRef.current = select
  const idxRef = useRef(idx)
  idxRef.current = idx

  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.3,
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dy) < 24) return
      const next = Math.max(0, Math.min(FILTERS.length - 1, idxRef.current + (g.dy > 0 ? 1 : -1)))
      selectRef.current(FILTERS[next].id)
    },
  }), [])

  if (!(bottom >= 0) || !(top >= 0)) return null

  return (
    <View
      style={[styles.region, { top, bottom }]}
      pointerEvents="box-none"
      onLayout={(e) => {
        const h = e?.nativeEvent?.layout?.height
        if (Number.isFinite(h) && Math.abs(h - avail) > 1) setAvail(h)
      }}
    >
      <View style={[styles.strip, disabled && { opacity: 0.4 }]} pointerEvents={disabled ? 'none' : 'auto'} {...swipe.panHandlers}>
        {FILTERS.map((f) => {
          const active = f.id === value
          return (
            <Pressable
              key={f.id}
              onPress={() => select(f.id)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`${f.label} filter`}
              accessibilityState={{ selected: active }}
              style={[
                styles.thumb,
                { width: size, height: size, borderRadius: size / 2 },
                active ? styles.thumbActive : null,
              ]}
            >
              <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, overflow: 'hidden' }]}>
                <Thumb id={f.id} size={size} />
              </View>
            </Pressable>
          )
        })}
        {note ? <Text style={styles.note} numberOfLines={2}>{note}</Text> : null}
      </View>
      {shownLabel ? (
        <Animated.View style={[styles.labelWrap, { opacity: label }]} pointerEvents="none">
          <Text style={styles.labelText} numberOfLines={1}>{shownLabel}</Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  region: { position: 'absolute', right: 8, justifyContent: 'center', alignItems: 'flex-end' },
  strip: { alignItems: 'center', gap: GAP, paddingVertical: 4 },
  thumb: {
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.2)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  thumbActive: { borderWidth: 3, borderColor: '#ffffff', transform: [{ scale: 1.12 }] },
  thumbCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbAt: { color: '#ffffff', fontWeight: '800', marginTop: -2 },
  note: {
    width: 58, textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontSize: 9, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3,
  },
  labelWrap: {
    position: 'absolute', right: MAX_SIZE + 14, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.38)',
  },
  labelText: { color: '#fff', fontSize: 13, fontWeight: '700' },
})
