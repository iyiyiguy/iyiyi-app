import React, { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import Shutter from '../Shutter'
import { LENSES } from './lenses'
import { useT } from '../../../i18n'
import camStrings from '../../../i18n/strings/camera'
import { LensThumb } from './LensArt'

const ITEM = 64 // snap interval: one lens per 64 px
const THUMB = 50

// Snapchat / Instagram-style lens carousel with the shutter in the middle: swipe the round
// previews under the shutter ring (snaps one per lens, a haptic tick as each one passes the
// centre, its name fades in above), or tap one to jump to it. The lens under the ring is the
// one in use - tap the ring to shoot. Scaling of the previews runs on the native driver from the
// scroll position; JS only does work when the centred lens changes.
export default function LensCarousel({
  value, onChange, mode, recording, shutterBusy, onShutter, onHoldStart, onHoldEnd, disabled, hidden, note,
}) {
  const t = useT(camStrings)
  const [width, setWidth] = useState(0)
  const [label, setLabel] = useState(null)
  const scrollX = useRef(new Animated.Value(0)).current
  const labelO = useRef(new Animated.Value(0)).current
  const hide = useRef(new Animated.Value(hidden ? 0 : 1)).current
  const scrollRef = useRef(null)
  const dragging = useRef(false)
  const centered = useRef(-1)
  const idx = Math.max(0, LENSES.findIndex((l) => l.id === value))
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const flashLabel = (i) => {
    const id = LENSES[i]?.id
    if (!id) return
    setLabel(t(`lens_${id}`))
    labelO.stopAnimation()
    Animated.sequence([
      Animated.timing(labelO, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.delay(850),
      Animated.timing(labelO, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start()
  }

  const indexAt = (x) => Math.max(0, Math.min(LENSES.length - 1, Math.round((Number(x) || 0) / ITEM)))
  const commit = (i) => {
    const id = LENSES[i]?.id
    if (!id || id === valueRef.current) return
    try { onChangeRef.current?.(id) } catch {}
  }

  // Haptic tick + label each time a new lens crosses the centre (no setState per frame).
  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
    listener: (e) => {
      const i = indexAt(e?.nativeEvent?.contentOffset?.x)
      if (i === centered.current) return
      const first = centered.current < 0
      centered.current = i
      if (first || !dragging.current) return
      Haptics.selectionAsync().catch(() => {})
      flashLabel(i)
    },
  })).current

  // Follow outside changes (saved choice loaded, etc.).
  useEffect(() => {
    if (!width || dragging.current) return
    try { scrollRef.current?.scrollTo?.({ x: idx * ITEM, animated: true }) } catch {}
  }, [idx, width])

  useEffect(() => {
    Animated.timing(hide, { toValue: hidden ? 0 : 1, duration: 200, useNativeDriver: true }).start()
  }, [hidden, hide])

  const tapLens = (i) => {
    if (disabled || hidden) return
    Haptics.selectionAsync().catch(() => {})
    try { scrollRef.current?.scrollTo?.({ x: i * ITEM, animated: true }) } catch {}
    flashLabel(i)
    commit(i)
  }

  const side = width > 0 ? (width - ITEM) / 2 : 0
  const lens = LENSES[idx]?.id || 'none'
  const ringOnly = mode !== 'video' && !recording && lens !== 'none'

  return (
    <View
      style={styles.wrap}
      pointerEvents="box-none"
      onLayout={(e) => {
        const w = e?.nativeEvent?.layout?.width
        if (Number.isFinite(w) && Math.abs(w - width) > 1) setWidth(w)
      }}
    >
      {note ? <Text style={styles.note} numberOfLines={1}>{note}</Text> : null}
      <View style={styles.labelRow} pointerEvents="none">
        {label ? (
          <Animated.View style={[styles.labelPill, { opacity: labelO }]}>
            <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.row} pointerEvents="box-none">
        {width > 0 && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: hide }, disabled && !hidden && { opacity: 0.45 }]}
            pointerEvents={disabled || hidden ? 'none' : 'auto'}
          >
            <Animated.ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={ITEM}
              decelerationRate="fast"
              disableIntervalMomentum
              contentOffset={{ x: idx * ITEM, y: 0 }}
              contentContainerStyle={{ paddingHorizontal: side, alignItems: 'center' }}
              scrollEventThrottle={16}
              onScroll={onScroll}
              onScrollBeginDrag={() => { dragging.current = true }}
              onScrollEndDrag={(e) => {
                const v = Math.abs(Number(e?.nativeEvent?.velocity?.x) || 0)
                if (v < 0.05) { dragging.current = false; commit(indexAt(e?.nativeEvent?.contentOffset?.x)) }
              }}
              onMomentumScrollEnd={(e) => {
                dragging.current = false
                commit(indexAt(e?.nativeEvent?.contentOffset?.x))
              }}
            >
              {LENSES.map((l, i) => {
                const inputRange = [(i - 2) * ITEM, (i - 1) * ITEM, i * ITEM, (i + 1) * ITEM, (i + 2) * ITEM]
                const scale = scrollX.interpolate({ inputRange, outputRange: [0.72, 0.84, 1.16, 0.84, 0.72], extrapolate: 'clamp' })
                const opacity = scrollX.interpolate({ inputRange, outputRange: [0.55, 0.9, 1, 0.9, 0.55], extrapolate: 'clamp' })
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => tapLens(i)}
                    style={styles.item}
                    accessibilityRole="button"
                    accessibilityLabel={t('lensA11y', { name: t(`lens_${l.id}`) })}
                    accessibilityState={{ selected: l.id === value }}
                  >
                    <Animated.View style={[styles.thumb, { opacity, transform: [{ scale }] }]}>
                      <View style={styles.thumbClip}>
                        <LensThumb lens={l.id} size={THUMB} />
                      </View>
                    </Animated.View>
                  </Pressable>
                )
              })}
            </Animated.ScrollView>
          </Animated.View>
        )}
        <View style={styles.shutterSlot} pointerEvents="box-none">
          <Shutter mode={mode} recording={recording} busy={shutterBusy} onPress={onShutter} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} ringOnly={ringOnly} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
  labelRow: { height: 24, alignItems: 'center', justifyContent: 'center' },
  labelPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.42)' },
  labelText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  note: {
    color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3,
  },
  row: { width: '100%', height: 88, alignItems: 'center', justifyContent: 'center' },
  item: { width: ITEM, height: 88, alignItems: 'center', justifyContent: 'center' },
  thumb: {
    width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  thumbClip: { ...StyleSheet.absoluteFill, borderRadius: THUMB / 2, overflow: 'hidden' },
  shutterSlot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
})
