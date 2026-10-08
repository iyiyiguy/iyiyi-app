// Laser Tag grenades: the throw button and the maths for where a grenade lands.
//
// Throwing: press and hold the grenade button. A power ring fills (about 1.4 s for a full
// throw). Let go to throw at that power, OR make a throwing motion with the phone while holding
// the button (keep hold of the phone!): the swing is measured with the accelerometer and a
// harder swing throws further. The grenade flies along the compass heading you're facing.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { Accelerometer } from 'expo-sensors'
import { GRENADE_MAX_THROW_M, GRENADE_MIN_THROW_M } from './engine'

export const GRENADE_FUSE_MS = 2500
const FULL_POWER_MS = 1400
const SWING_G = 1.9 // total acceleration (in g) that counts as a throwing motion
const MAX_SWING_G = 4.2 // a swing this hard (or more) throws the maximum distance

const EARTH_R = 6371000
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

/** The point `meters` away from `pos` along compass `bearingDeg`. */
export function destinationPoint(pos, bearingDeg, meters) {
  const d = meters / EARTH_R
  const b = toRad(bearingDeg)
  const la1 = toRad(pos.lat)
  const lo1 = toRad(pos.lng)
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return { lat: toDeg(la2), lng: ((toDeg(lo2) + 540) % 360) - 180 }
}

const distanceFor = (power) => Math.round(GRENADE_MIN_THROW_M + (GRENADE_MAX_THROW_M - GRENADE_MIN_THROW_M) * Math.max(0, Math.min(1, power)))

/**
 * Hold-to-throw grenade button.
 *   count: grenades left (owner: Infinity), disabled, size,
 *   onThrow(distanceMeters, how: 'swing' | 'hold'), onEmpty() when tapped with none left.
 */
export function GrenadeButton({ count, disabled, size = 54, onThrow, onEmpty }) {
  const [holding, setHolding] = useState(false)
  const [preview, setPreview] = useState(null) // metres while holding
  const power = useRef(new Animated.Value(0)).current
  const startAt = useRef(0)
  const swingPeak = useRef(0)
  const sub = useRef(null)
  const thrown = useRef(false)
  const raf = useRef(null)
  const cbs = useRef({ onThrow, onEmpty })
  cbs.current = { onThrow, onEmpty }
  const empty = !(count > 0)

  const stopSensors = () => {
    try { sub.current?.remove() } catch {}
    sub.current = null
    if (raf.current) clearInterval(raf.current)
    raf.current = null
  }
  useEffect(() => stopSensors, [])

  const release = useCallback((how) => {
    if (thrown.current) return
    thrown.current = true
    stopSensors()
    const held = Math.min(1, (Date.now() - startAt.current) / FULL_POWER_MS)
    const swing = swingPeak.current >= SWING_G ? Math.min(1, (swingPeak.current - 1) / (MAX_SWING_G - 1)) : 0
    const p = how === 'swing' ? Math.max(swing, 0.35) : Math.max(held, swing)
    power.stopAnimation()
    power.setValue(0)
    setHolding(false)
    setPreview(null)
    cbs.current.onThrow?.(distanceFor(p), how)
  }, [power])

  const begin = () => {
    if (disabled) return
    if (empty) { cbs.current.onEmpty?.(); return }
    thrown.current = false
    swingPeak.current = 0
    startAt.current = Date.now()
    setHolding(true)
    power.setValue(0)
    Animated.timing(power, { toValue: 1, duration: FULL_POWER_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start()
    raf.current = setInterval(() => {
      const held = Math.min(1, (Date.now() - startAt.current) / FULL_POWER_MS)
      setPreview(distanceFor(held))
    }, 100)
    try {
      Accelerometer.setUpdateInterval(30)
      let armedAt = Date.now() + 150 // ignore the press itself
      sub.current = Accelerometer.addListener(({ x, y, z }) => {
        const g = Math.sqrt(x * x + y * y + z * z)
        if (Date.now() < armedAt) return
        if (g > swingPeak.current) swingPeak.current = g
        // The swing has peaked and is easing off: that's the moment of release.
        if (swingPeak.current >= SWING_G && g < swingPeak.current * 0.6) release('swing')
      })
    } catch {
      // No accelerometer: hold-to-throw still works.
    }
  }

  const end = () => { if (raf.current && !thrown.current) release('hold') }

  const ring = power.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
  const label = count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      {holding && preview != null ? (
        <View style={styles.preview} pointerEvents="none">
          <Text style={styles.previewText}>{preview} m · swing or let go</Text>
        </View>
      ) : null}
      <Pressable
        onPressIn={begin}
        onPressOut={end}
        delayLongPress={100000}
        style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }, (disabled || empty) && { opacity: 0.45 }, holding && styles.btnOn]}
        accessibilityRole="button"
        accessibilityLabel={`Grenade, ${label} left. Hold to aim, then let go or make a throwing motion to throw.`}
      >
        <Animated.View style={[styles.fill, { height: ring }]} pointerEvents="none" />
        <Text style={{ fontSize: size * 0.42 }}>💣</Text>
        <View style={styles.badge} pointerEvents="none"><Text style={styles.badgeText}>{label}</Text></View>
      </Pressable>
    </View>
  )
}

/** A short expanding flash where the grenade goes off (purely visual). */
export function GrenadeBlast({ visible }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!visible) return
    v.setValue(0)
    Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [visible, v])
  if (!visible) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#ffb347', opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }) }]}
    />
  )
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: 'rgba(10,12,22,0.72)', borderWidth: 1.5, borderColor: 'rgba(255,190,90,0.7)',
  },
  btnOn: { borderColor: '#ffb347', borderWidth: 2.5 },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,150,40,0.45)' },
  badge: {
    position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#ff9a3c', alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#1b0f00', fontSize: 11, fontWeight: '800' },
  preview: {
    position: 'absolute', bottom: '100%', marginBottom: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.75)', minWidth: 150, alignItems: 'center',
  },
  previewText: { color: '#ffd29a', fontSize: 12, fontWeight: '800' },
})
