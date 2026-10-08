// First-person view of the equipped gun at the bottom of the Laser Tag camera view, like a
// shooter's "view model": it sways gently, kicks back on every shot and swaps when you change
// weapons. Purely visual (never touchable), so it can't get in the way of the fire button.
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, useWindowDimensions } from 'react-native'
import { gunArt } from '../../lib/gunArt'

export default function GunViewModel({ gun, shotTick = 0, bottom = 0, hidden = false, leftHanded = false }) {
  const { width, height } = useWindowDimensions()
  const sway = useRef(new Animated.Value(0)).current
  const kick = useRef(new Animated.Value(0)).current
  const swap = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [sway])

  useEffect(() => {
    if (!shotTick) return
    kick.setValue(1)
    Animated.spring(kick, { toValue: 0, speed: 28, bounciness: 6, useNativeDriver: true }).start()
  }, [shotTick, kick])

  useEffect(() => {
    swap.setValue(0)
    Animated.spring(swap, { toValue: 1, speed: 14, bounciness: 5, useNativeDriver: true }).start()
  }, [gun?.id, swap])

  if (hidden || !gun) return null
  const w = Math.min(width * 0.78, 520)
  const h = w * 0.5
  // The artwork faces right. Right-handed: flip it so the muzzle points in towards the middle of
  // the screen from the bottom-right corner, tilted up; left-handed: the mirror image.
  const dir = leftHanded ? -1 : 1
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          width: w,
          height: h,
          bottom: Math.max(0, bottom - h * 0.18),
          [leftHanded ? 'left' : 'right']: -w * 0.16,
          transform: [
            { translateY: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }), Animated.add(kick.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }), swap.interpolate({ inputRange: [0, 1], outputRange: [h, 0] }))) },
            { translateX: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [0, 3 * dir] }), kick.interpolate({ inputRange: [0, 1], outputRange: [0, 12 * dir] })) },
            { rotate: kick.interpolate({ inputRange: [0, 1], outputRange: [`${12 * dir}deg`, `${19 * dir}deg`] }) },
          ],
          opacity: height < 500 ? 0.85 : 1,
        },
      ]}
    >
      <Image source={gunArt(gun)} style={[styles.img, { transform: [{ scaleX: -dir }] }]} resizeMode="contain" fadeDuration={0} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  img: { width: '100%', height: '100%' },
})
