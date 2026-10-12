// Sticky bomb and land mine HUD buttons for laser tag.
//
// Sticky bomb: tap to place at your current position. Tap again to detonate remotely.
// The button shows "Place" when idle, "DETONATE" while a bomb is placed.
//
// Land mine: tap to drop at your current position. It triggers automatically when an
// enemy walks within range. No second press needed.
import React, { useCallback, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * StickyBombButton — two-tap flow: first tap places, second detonates.
 *   count, disabled, size, onPlace(), onDetonate(), onEmpty()
 */
export function StickyBombButton({ count, disabled, size = 54, onPlace, onDetonate, onEmpty }) {
  const [placed, setPlaced] = useState(false)
  const empty = !(count > 0)

  const handlePress = useCallback(() => {
    if (disabled) return
    if (placed) {
      setPlaced(false)
      onDetonate?.()
      return
    }
    if (empty) { onEmpty?.(); return }
    setPlaced(true)
    onPlace?.()
  }, [disabled, placed, empty, onPlace, onDetonate, onEmpty])

  const label = count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      {placed ? (
        <View style={styles.preview} pointerEvents="none">
          <Text style={styles.previewTextSB}>Tap to detonate!</Text>
        </View>
      ) : null}
      <Pressable
        onPress={handlePress}
        style={[
          styles.btn,
          { width: size, height: size, borderRadius: size / 2,
            borderColor: placed ? '#ff4444' : 'rgba(255,100,100,0.7)' },
          (disabled || empty) && !placed && { opacity: 0.45 },
          placed && styles.btnPlaced,
        ]}
        accessibilityRole="button"
        accessibilityLabel={placed ? 'Detonate sticky bomb' : `Sticky bomb, ${label} left. Tap to place at your position.`}
      >
        <Text style={{ fontSize: size * 0.38 }}>{placed ? '💥' : '🧨'}</Text>
        <View style={[styles.badge, placed && { backgroundColor: '#ff4444' }]} pointerEvents="none">
          <Text style={styles.badgeText}>{placed ? '!' : label}</Text>
        </View>
      </Pressable>
    </View>
  )
}

/**
 * LandMineButton — single tap: drop a mine at your position. It triggers on its own.
 *   count, disabled, size, onDrop(), onEmpty()
 */
export function LandMineButton({ count, disabled, size = 54, onDrop, onEmpty }) {
  const [cooldown, setCooldown] = useState(false)
  const timer = useRef(null)
  const empty = !(count > 0)

  const handlePress = useCallback(() => {
    if (disabled || cooldown) return
    if (empty) { onEmpty?.(); return }
    onDrop?.()
    setCooldown(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCooldown(false), 2000)
  }, [disabled, cooldown, empty, onDrop, onEmpty])

  const label = count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      <Pressable
        onPress={handlePress}
        style={[
          styles.btn,
          { width: size, height: size, borderRadius: size / 2,
            borderColor: 'rgba(120,255,120,0.7)' },
          (disabled || empty || cooldown) && { opacity: 0.45 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Land mine, ${label} left. Tap to drop at your position.`}
      >
        <Text style={{ fontSize: size * 0.38 }}>{'⚠️'}</Text>
        <View style={[styles.badge, { backgroundColor: '#5cb85c' }]} pointerEvents="none">
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: 'rgba(10,12,22,0.72)', borderWidth: 1.5,
  },
  btnPlaced: { borderWidth: 2.5, backgroundColor: 'rgba(60,10,10,0.82)' },
  badge: {
    position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#ff6b6b', alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#1b0f00', fontSize: 11, fontWeight: '800' },
  preview: {
    position: 'absolute', bottom: '100%', marginBottom: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.75)', minWidth: 140, alignItems: 'center',
  },
  previewTextSB: { color: '#ff6b6b', fontSize: 12, fontWeight: '800' },
})
