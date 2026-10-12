// First-person "view model" for the Laser Tag camera view, like an FPS: your gloved hand(s)
// holding the equipped gun in the bottom corner. It breathes/sways, swings toward the enemy
// you're aiming at, kicks back on every shot (harder for big guns, a steady shake for
// automatics) and fires a muzzle flash in the gun's own colour from the barrel tip.
// Purely visual (never touchable), so it can't get in the way of the fire button.
// Hidden in sideways/trigger mode — there the phone itself is the gun.
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native'
import { gunArt } from '../../lib/gunArt'

// Art: square renders, hand enters bottom-right, barrel points up-left. muzzle = barrel tip
// as a fraction of the square; glow = the gun's accent colour for its flash.
const FPS = {
  pistol: { img: require('../../../assets/guns/fps/pistol.png'), muzzle: [0.389, 0.246], glow: '#3df5ff', kick: 1 },
  uzi: { img: require('../../../assets/guns/fps/uzi.png'), muzzle: [0.346, 0.234], glow: '#4dff9a', kick: 0.6 },
  burst: { img: require('../../../assets/guns/fps/burst.png'), muzzle: [0.381, 0.301], glow: '#ffd23f', kick: 0.8 },
  smg: { img: require('../../../assets/guns/fps/smg.png'), muzzle: [0.4, 0.324], glow: '#4d8bff', kick: 0.6 },
  sniper: { img: require('../../../assets/guns/fps/sniper.png'), muzzle: [0.361, 0.285], glow: '#9b6bff', kick: 1.8 },
  scatter: { img: require('../../../assets/guns/fps/scatter.png'), muzzle: [0.34, 0.264], glow: '#ff9a2e', kick: 1.7 },
  assault: { img: require('../../../assets/guns/fps/assault.png'), muzzle: [0.414, 0.328], glow: '#ff3b3b', kick: 0.75 },
  marksman: { img: require('../../../assets/guns/fps/marksman.png'), muzzle: [0.424, 0.324], glow: '#7b7bff', kick: 1.3 },
  minigun: { img: require('../../../assets/guns/fps/minigun.png'), muzzle: [0.367, 0.312], glow: '#ffd000', kick: 0.45 },
  railgun: { img: require('../../../assets/guns/fps/railgun.png'), muzzle: [0.322, 0.312], glow: '#ffb03a', kick: 1.6 },
  rocket: { img: require('../../../assets/guns/fps/rocket.png'), muzzle: [0.344, 0.289], glow: '#ff5a1f', kick: 2 },
}

// Size and placement of the view model (shared with the bullet effect so rounds leave the barrel).
function frameFor({ width, height, bottom, leftHanded }) {
  const size = Math.min(width * 1.0, height * 0.55, 560)
  const top = height - Math.max(0, bottom - size * 0.3) - size
  const left = leftHanded ? -size * 0.06 : width - size + size * 0.06
  return { size, top, left }
}

/** Screen position of the barrel tip for the equipped gun (null if the gun has no FPS art). */
export function muzzlePoint({ gun, width, height, bottom = 0, leftHanded = false }) {
  const art = FPS[gun?.id]
  if (!art) return null
  const f = frameFor({ width, height, bottom, leftHanded })
  const mx = leftHanded ? 1 - art.muzzle[0] : art.muzzle[0]
  return { x: f.left + mx * f.size, y: f.top + art.muzzle[1] * f.size, color: art.glow }
}

export default function GunViewModel({ gun, shotTick = 0, bottom = 0, hidden = false, leftHanded = false, aim = null }) {
  const { width, height } = useWindowDimensions()
  const sway = useRef(new Animated.Value(0)).current
  const kick = useRef(new Animated.Value(0)).current
  const swap = useRef(new Animated.Value(1)).current
  const flash = useRef(new Animated.Value(0)).current
  const aimX = useRef(new Animated.Value(0)).current
  const aimY = useRef(new Animated.Value(0)).current
  const art = FPS[gun?.id]
  const auto = gun?.fireMode === 'automatic'

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(sway, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [sway])

  // Shot: kick back + muzzle flash.
  useEffect(() => {
    if (!shotTick) return
    const k = art?.kick ?? 1
    kick.setValue(auto ? 0.55 + Math.random() * 0.3 : 1)
    Animated.spring(kick, { toValue: 0, speed: auto ? 40 : 22 / Math.sqrt(k), bounciness: auto ? 2 : 7, useNativeDriver: true }).start()
    flash.setValue(1)
    Animated.timing(flash, { toValue: 0, duration: auto ? 70 : 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [shotTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Weapon swap: drop out and raise the new gun.
  useEffect(() => {
    swap.setValue(0)
    Animated.spring(swap, { toValue: 1, speed: 14, bounciness: 5, useNativeDriver: true }).start()
  }, [gun?.id, swap])

  // Swing toward what you're aiming at (a tagged enemy off-centre), back to rest otherwise.
  const ax = Number.isFinite(aim?.x) ? (aim.x - width / 2) : 0
  const ay = Number.isFinite(aim?.y) ? (aim.y - height / 2) : 0
  useEffect(() => {
    Animated.parallel([
      Animated.spring(aimX, { toValue: Math.max(-1, Math.min(1, ax / (width / 2))), speed: 9, bounciness: 3, useNativeDriver: true }),
      Animated.spring(aimY, { toValue: Math.max(-1, Math.min(1, ay / (height / 2))), speed: 9, bounciness: 3, useNativeDriver: true }),
    ]).start()
  }, [Math.round(ax / 12), Math.round(ay / 12)]) // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden || !gun) return null

  // Fallback for any gun without first-person art: the old side-view sprite.
  if (!art) return <LegacyGun gun={gun} kick={kick} sway={sway} swap={swap} width={width} height={height} bottom={bottom} leftHanded={leftHanded} />

  const { size, top, left } = frameFor({ width, height, bottom, leftHanded })
  const dir = leftHanded ? -1 : 1
  const k = art.kick
  const mx = (leftHanded ? 1 - art.muzzle[0] : art.muzzle[0]) * size
  const my = art.muzzle[1] * size
  const flashSize = size * (0.22 + 0.06 * Math.min(2, k))

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          width: size, height: size, top, left,
          opacity: height < 500 ? 0.85 : 1,
          transform: [
            // pivot roughly around the grip (bottom-right of the square)
            { translateX: Animated.add(
              Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [0, 3 * dir] }), aimX.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.16, size * 0.16] })),
              kick.interpolate({ inputRange: [0, 1], outputRange: [0, 10 * k * dir] }),
            ) },
            { translateY: Animated.add(
              Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }), aimY.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.1, size * 0.08] })),
              Animated.add(kick.interpolate({ inputRange: [0, 1], outputRange: [0, 16 * k] }), swap.interpolate({ inputRange: [0, 1], outputRange: [size * 0.8, 0] })),
            ) },
            { rotate: Animated.add(
              aimX.interpolate({ inputRange: [-1, 1], outputRange: [-0.12, 0.12] }),
              kick.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07 * k * dir] }),
            ).interpolate({ inputRange: [-1, 1], outputRange: ['-57.3deg', '57.3deg'] }) },
          ],
        },
      ]}
    >
      {/* light from the flash spilling over the hand + gun */}
      <Animated.View style={[styles.spill, { left: mx - size * 0.45, top: my - size * 0.3, width: size * 0.9, height: size * 0.9, borderRadius: size * 0.45, backgroundColor: art.glow, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) }]} />
      <Image source={art.img} style={[styles.img, leftHanded && { transform: [{ scaleX: -1 }] }]} resizeMode="contain" fadeDuration={0} />
      {/* muzzle flash at the barrel tip */}
      <Animated.View
        style={[styles.flashWrap, {
          left: mx - flashSize / 2, top: my - flashSize / 2, width: flashSize, height: flashSize,
          opacity: flash,
          transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] }) }, { rotate: `${(shotTick * 37) % 90}deg` }],
        }]}
      >
        <View style={[styles.flashGlow, { backgroundColor: art.glow, borderRadius: flashSize / 2 }]} />
        {[0, 45, 90, 135].map((r) => (
          <View key={r} style={[styles.ray, { backgroundColor: art.glow, transform: [{ rotate: `${r}deg` }], width: flashSize, left: 0, top: flashSize / 2 - flashSize * 0.04, height: flashSize * 0.08 }]} />
        ))}
        <View style={[styles.flashCore, { width: flashSize * 0.42, height: flashSize * 0.42, borderRadius: flashSize * 0.21, left: flashSize * 0.29, top: flashSize * 0.29 }]} />
      </Animated.View>
    </Animated.View>
  )
}

// Old side-view sprite, kept for weapons without first-person art.
function LegacyGun({ gun, kick, sway, swap, width, height, bottom, leftHanded }) {
  const w = Math.min(width * 0.78, 520)
  const h = w * 0.5
  const dir = leftHanded ? -1 : 1
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, {
        width: w, height: h,
        bottom: Math.max(0, bottom - h * 0.18),
        [leftHanded ? 'left' : 'right']: -w * 0.16,
        transform: [
          { translateY: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }), Animated.add(kick.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }), swap.interpolate({ inputRange: [0, 1], outputRange: [h, 0] }))) },
          { rotate: kick.interpolate({ inputRange: [0, 1], outputRange: [`${12 * dir}deg`, `${19 * dir}deg`] }) },
        ],
        opacity: height < 500 ? 0.85 : 1,
      }]}
    >
      <Image source={gunArt(gun)} style={[styles.img, { transform: [{ scaleX: -dir }] }]} resizeMode="contain" fadeDuration={0} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  img: { width: '100%', height: '100%' },
  spill: { position: 'absolute' },
  flashWrap: { position: 'absolute' },
  flashGlow: { ...StyleSheet.absoluteFill, opacity: 0.55, shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  ray: { position: 'absolute', borderRadius: 999, opacity: 0.9 },
  flashCore: { position: 'absolute', backgroundColor: '#fffbe6', shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
})
