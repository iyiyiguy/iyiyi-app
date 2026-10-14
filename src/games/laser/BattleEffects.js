// Visual battle effects: muzzle flashes, explosions, hit-direction indicators,
// incoming tracers, and bullet projectiles rendered on top of the camera view.
//
// All effects are purely cosmetic overlays keyed off Realtime messages the player already
// receives (lt_shot, got_hit, grenade/sticky_bomb/land_mine detonations). They use
// Animated for GPU-driven opacity/scale so the camera stays smooth.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { bearingDeg } from '../../lib/multiplayer'
import { ENEMY_BOLT, glowFor } from './gunGlow'
import { FONT, ST, stShadow } from '../studio'

// ─── Perspective helpers for the laser bolts ───
// A bolt moving at constant speed away from the camera covers less and less of the screen
// per frame and shrinks as 1/depth. `persp(t)` is the screen-space fraction of the way from
// the muzzle to the vanishing point at time t (0..1); `shrink(t)` the 1/depth scale.
const PERSP_K = 7 // how far "into" the scene the bolt flies (bigger = deeper)
const PERSP_STEPS = 12
const perspInput = Array.from({ length: PERSP_STEPS + 1 }, (_, i) => i / PERSP_STEPS)
const perspAt = (t) => (1 - 1 / (1 + PERSP_K * t)) / (1 - 1 / (1 + PERSP_K))
const shrinkAt = (t) => 1 / (1 + PERSP_K * t)
// Growing toward the camera is the reverse: the same curve mirrored in time.
const approachAt = (t) => 1 - perspAt(1 - t)
const growAt = (t) => shrinkAt(1 - t)

// ─── Muzzle flash: brief yellow/white starburst at the edge of the screen ───
const FLASH_DURATION = 280
const FLASH_MAX = 8

function MuzzleFlash({ id, angle, onDone }) {
  const scale = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: FLASH_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: FLASH_DURATION, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Position the flash at the screen edge in the direction of the shooter.
  const rad = (angle - 90) * (Math.PI / 180) // CSS 0° = top
  const x = Math.cos(rad) * 42 // percentage from center
  const y = Math.sin(rad) * 42
  return (
    <Animated.View
      style={[
        st.flash,
        {
          left: `${50 + x}%`, top: `${50 + y}%`,
          opacity,
          transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.4] }) }],
        },
      ]}
      pointerEvents="none"
    >
      <View style={st.flashCore} />
      {[0, 45, 90, 135].map((r) => <View key={r} style={[st.flashRay, { transform: [{ rotate: `${r}deg` }] }]} />)}
    </Animated.View>
  )
}

// ─── Explosion colors: every explosive has its own multi-colour palette ───
// [core, inner ring, mid ring, outer ring, screen tint]
const PALETTES = {
  'Land mine':   ['#fff6d5', '#ffd400', '#ff6a00', '#ff1744', '#ff5a1f'],
  'Sticky bomb': ['#eaffd9', '#76ff03', '#00e5ff', '#2979ff', '#33ff99'],
  'Grenade':     ['#fffde7', '#ffea00', '#ff9100', '#d50000', '#ffb300'],
  'Rocket':      ['#fde7ff', '#ea80fc', '#7c4dff', '#ff4081', '#b04dff'],
}
const DEFAULT_PALETTE = PALETTES.Grenade
export const paletteFor = (label) => PALETTES[label] || DEFAULT_PALETTE

// Layered fireball: a colour flash over the whole screen, a bright core and three
// rings in different colours racing outwards. `size` is the fireball diameter in px.
function Fireball({ palette, size, duration, children }) {
  const t = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(t, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration, delay: 0, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ring = (i, color, from, to, width) => (
    <Animated.View
      key={i}
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: width, borderColor: color,
        opacity: t.interpolate({ inputRange: [0, 0.15 + i * 0.1, 1], outputRange: [0, 0.95, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }],
      }}
    />
  )
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      {/* glowing core */}
      <Animated.View
        style={{
          position: 'absolute', width: size * 0.7, height: size * 0.7, borderRadius: size * 0.35,
          backgroundColor: palette[1],
          shadowColor: palette[2], shadowOpacity: 1, shadowRadius: size * 0.25, shadowOffset: { width: 0, height: 0 },
          opacity: fade,
          transform: [{ scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.1, 1.4] }) }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute', width: size * 0.4, height: size * 0.4, borderRadius: size * 0.2,
          backgroundColor: palette[0], opacity: fade,
          transform: [{ scale: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.3, 1.2, 0.6] }) }],
        }}
      />
      {ring(0, palette[1], 0.3, 1.8, 10)}
      {ring(1, palette[2], 0.3, 2.6, 8)}
      {ring(2, palette[3], 0.3, 3.4, 6)}
      {children}
    </View>
  )
}

// Full-screen colour flash that tints the camera for a moment.
function ScreenFlash({ color, peak = 0.45, duration = 700 }) {
  const o = useRef(new Animated.Value(peak)).current
  useEffect(() => {
    Animated.timing(o, { toValue: 0, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: o }]} />
}

// ─── Explosion right on top of you (you threw it, or it hit you) ───
const EXPLOSION_DURATION = 1100
const EXPLOSION_MAX = 4

function Explosion({ id, label, onDone }) {
  const { width } = useWindowDimensions()
  const palette = paletteFor(label)
  useEffect(() => {
    const t = setTimeout(() => onDone(id), EXPLOSION_DURATION + 100)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={st.explosion} pointerEvents="none">
      <ScreenFlash color={palette[4]} peak={0.5} duration={EXPLOSION_DURATION * 0.7} />
      <Fireball palette={palette} size={width * 0.7} duration={EXPLOSION_DURATION} />
      {label ? <Text style={[st.explosionLabel, { color: palette[1] }]}>{label.toUpperCase()}</Text> : null}
    </View>
  )
}

// ─── Mega explosion: a detonation somewhere in the arena (e.g. a land mine). Huge and
// placed in the direction it happened, so it can be spotted from a long way off. ───
const MEGA_DURATION = 1800
const MEGA_MAX = 4
const CAMERA_HALF_FOV = 35 // degrees either side of straight ahead that map onto the screen

function MegaExplosion({ id, label, angle, dist, by, onDone }) {
  const { width, height } = useWindowDimensions()
  const palette = paletteFor(label)
  useEffect(() => {
    const t = setTimeout(() => onDone(id), MEGA_DURATION + 100)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Relative angle: -180..180, 0 = straight ahead.
  const rel = angle == null ? 0 : ((angle + 540) % 360) - 180
  const inView = Math.abs(rel) <= CAMERA_HALF_FOV
  const x = inView ? width / 2 + (rel / CAMERA_HALF_FOV) * (width / 2) : rel < 0 ? 0 : width
  // Oversized on purpose: always at least ~screen width, a bit smaller when far away.
  const far = Number.isFinite(dist) ? Math.min(1, Math.max(0, dist / 500)) : 0.3
  const size = Math.max(width, height * 0.6) * (1.25 - far * 0.45)
  const distText = Number.isFinite(dist) ? (dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`) : ''
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ScreenFlash color={palette[4]} peak={inView ? 0.4 : 0.22} duration={MEGA_DURATION * 0.6} />
      <View style={{ position: 'absolute', left: x - size / 2, top: height * 0.42 - size / 2 }}>
        <Fireball palette={palette} size={size} duration={MEGA_DURATION} />
      </View>
      <View style={st.megaLabelWrap}>
        <View style={st.megaRow}>
          {!inView && rel < 0 ? <Ionicons name="caret-back" size={20} color={palette[1]} /> : null}
          <Text style={[st.megaLabel, { color: palette[1] }]}>{`${String(label || 'Explosion').toUpperCase()}${distText ? ` · ${distText.toUpperCase()}` : ''}`}</Text>
          {!inView && rel > 0 ? <Ionicons name="caret-forward" size={20} color={palette[1]} /> : null}
        </View>
        {by ? <Text style={st.megaBy}>{String(by).toUpperCase()}</Text> : null}
      </View>
    </View>
  )
}

// ─── Your own shot: a laser bolt (blaster style) flying from the muzzle into the scene ───
// An elongated glowing capsule oriented along its line of travel. It starts big at the
// barrel and shrinks with 1/depth as it races toward the target (or straight down the
// crosshair into the distance), so it reads as a projectile in 3D, not a sprite sliding
// across the glass. A small impact flare blooms where it lands.
const OUT_MS = 300
const OUT_MAX = 10
const BOLT_LEN = 120
const BOLT_W = 13

// flat: hip fire (the radar is a top-down map): straight, constant size, no "into the scene".
function LaserBolt({ id, fromX, fromY, toX, toY, color, flat = false, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: OUT_MS + 140, easing: Easing.linear, useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const flightEnd = OUT_MS / (OUT_MS + 140)
  const dx = toX - fromX
  const dy = toY - fromY
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  // Keyframes along the perspective curve (position + scale), then hold at the target.
  const inputRange = [...perspInput.map((u) => u * flightEnd), 1]
  const px = [...perspInput.map((u) => dx * (flat ? u : perspAt(u))), dx]
  const py = [...perspInput.map((u) => dy * (flat ? u : perspAt(u))), dy]
  const sc = [...perspInput.map((u) => (flat ? 0.55 : Math.max(0.06, shrinkAt(u)))), flat ? 0.55 : 0.06]
  const translateX = t.interpolate({ inputRange, outputRange: px })
  const translateY = t.interpolate({ inputRange, outputRange: py })
  const scale = t.interpolate({ inputRange, outputRange: sc })
  const opacity = t.interpolate({ inputRange: [0, 0.05, flightEnd, flightEnd + 0.02, 1], outputRange: [0.4, 1, 1, 0, 0] })
  const flare = t.interpolate({ inputRange: [0, flightEnd, flightEnd + 0.08, 1], outputRange: [0, 0, 1, 0] })
  const flareScale = t.interpolate({ inputRange: [0, flightEnd, 1], outputRange: flat ? [0.15, 0.15, 1.1] : [0.2, 0.2, 1.8] })
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[st.boltWrap, {
          left: fromX - BOLT_LEN / 2, top: fromY - BOLT_W / 2,
          opacity,
          transform: [{ translateX }, { translateY }, { rotate: `${angle}deg` }, { scale }],
        }]}
      >
        {/* outer glow, coloured body, white-hot core */}
        <View style={[st.boltGlow, { backgroundColor: color, boxShadow: `0 0 18px 6px ${color}` }]} />
        <View style={[st.boltBody, { backgroundColor: color }]} />
        <View style={st.boltCore} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[st.boltFlare, {
          left: toX - 24, top: toY - 24, borderColor: color,
          opacity: flare,
          transform: [{ scale: flareScale }],
        }]}
      >
        <View style={[st.boltFlareCore, { backgroundColor: color }]} />
      </Animated.View>
    </>
  )
}

// ─── Rocket: a real projectile (body + nose + fins + glowing exhaust trail) ───
// 3D (camera aim): flies from the muzzle into the scene along the perspective curve and
// shrinks with 1/depth; the further the impact, the deeper the curve and the longer the
// flight. Flat (hip-fire radar): a small top-down rocket sliding across the map at constant
// size. Either way it explodes where it lands (PointExplosion).
const ROCKET_MAX = 4
export const rocketFlightMs = (distM, flat = false) => (flat ? 420 : Math.round(Math.max(320, Math.min(1100, 260 + 15 * (Number(distM) || 25)))))
const ROCKET_LEN = 92
const ROCKET_W = 22

function RocketShot({ id, fromX, fromY, toX, toY, dist, flat, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  const ms = rocketFlightMs(dist, flat)
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: ms, easing: flat ? Easing.in(Easing.quad) : Easing.linear, useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const dx = toX - fromX
  const dy = toY - fromY
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  // Depth of the curve from the impact distance: a wall 3 m away barely shrinks it.
  const k = Math.max(1.2, Math.min(14, (Number(dist) || 25) / 2.5))
  const pAt = (u) => (1 - 1 / (1 + k * u)) / (1 - 1 / (1 + k))
  const sAt = (u) => Math.max(0.05, 1 / (1 + k * u))
  const inputRange = perspInput
  const px = perspInput.map((u) => dx * (flat ? u : pAt(u)))
  const py = perspInput.map((u) => dy * (flat ? u : pAt(u)))
  const sc = perspInput.map((u) => (flat ? 0.42 : sAt(u)))
  const translateX = t.interpolate({ inputRange, outputRange: px })
  const translateY = t.interpolate({ inputRange, outputRange: py })
  const scale = t.interpolate({ inputRange, outputRange: sc })
  const opacity = t.interpolate({ inputRange: [0, 0.04, 0.96, 1], outputRange: [0.5, 1, 1, 0] })
  const flicker = t.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], outputRange: [0.7, 1.15, 0.85, 1.2, 0.9, 1.15, 0.85, 1.2, 0.9, 1.1, 0.8] })
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.rocketWrap, { left: fromX - ROCKET_LEN / 2, top: fromY - ROCKET_W / 2, opacity, transform: [{ translateX }, { translateY }, { rotate: `${angle}deg` }, { scale }] }]}
    >
      {/* exhaust trail (behind = left, the rocket points along +x) */}
      <Animated.View style={[st.rocketTrail, { transform: [{ scaleX: flicker }] }]} />
      <Animated.View style={[st.rocketFlame, { transform: [{ scale: flicker }] }]} />
      <View style={st.rocketFlameCore} />
      {/* fins, body, warhead */}
      <View style={[st.rocketFin, { top: 0 }]} />
      <View style={[st.rocketFin, { bottom: 0 }]} />
      <View style={st.rocketBody} />
      <View style={st.rocketBand} />
      <View style={st.rocketNose} />
    </Animated.View>
  )
}

// ─── Explosion at a point on screen (rocket impact): flash, fireball, smoke ring ───
// size: fireball diameter in px (bigger when the impact is close).
const POINT_EXPLOSION_MS = 1300

function SmokeRing({ size, duration }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: Math.max(6, size * 0.09), borderColor: 'rgba(70,64,60,0.85)',
        opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.3] }) }, { scaleY: 0.82 }],
      }}
    />
  )
}

function PointExplosion({ id, x, y, size, label, flat, onDone }) {
  const palette = paletteFor(label)
  useEffect(() => {
    const t = setTimeout(() => onDone(id), POINT_EXPLOSION_MS + 120)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ScreenFlash color={palette[4]} peak={flat ? 0.28 : 0.42} duration={POINT_EXPLOSION_MS * 0.55} />
      <View style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <SmokeRing size={size * 0.8} duration={POINT_EXPLOSION_MS} />
        <Fireball palette={palette} size={size} duration={POINT_EXPLOSION_MS * 0.85} />
      </View>
    </View>
  )
}

// ─── Elimination banner (studio "Kill" board): ELIMINATED / NAME / weapon · how · points ───
const KILL_MS = 2600
const KILL_MAX = 3

function KillBanner({ id, victim, weapon, points, onDone }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(KILL_MS - 480),
      Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.kill, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
      accessibilityLiveRegion="polite"
    >
      <View style={st.killHead}>
        <View style={st.killRule} />
        <Text style={st.killWord}>ELIMINATED</Text>
        <View style={st.killRule} />
      </View>
      <Text style={st.killName} numberOfLines={1}>{String(victim || 'Enemy').toUpperCase()}</Text>
      <View style={st.killPill}>
        {weapon ? <Text style={st.killWeapon} numberOfLines={1}>{String(weapon).toUpperCase()}</Text> : null}
        {points ? <Text style={st.killPts}>+{points}</Text> : null}
      </View>
    </Animated.View>
  )
}

// ─── Medal (multi-tags, streaks): objective-coloured card under the banner ───
const MEDAL_MS = 2400

function MedalCard({ id, title, sub, onDone }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.sequence([
      Animated.delay(120),
      Animated.spring(a, { toValue: 1, friction: 7, tension: 140, useNativeDriver: true }),
      Animated.delay(MEDAL_MS - 600),
      Animated.timing(a, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View pointerEvents="none" style={[st.medal, { opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
      <Ionicons name="star-outline" size={26} color={ST.objective} />
      <View style={{ flexShrink: 1 }}>
        <Text style={st.medalTitle} numberOfLines={1}>{String(title || '').toUpperCase()}</Text>
        {sub ? <Text style={st.medalSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </Animated.View>
  )
}

// ─── Hit direction indicator: red wedge on the screen edge ───
const HIT_INDICATOR_MS = 900

function HitIndicator({ id, angle, onDone }) {
  const opacity = useRef(new Animated.Value(0.9)).current
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: HIT_INDICATOR_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View
      style={[st.hitIndicator, { opacity, transform: [{ rotate: `${angle}deg` }] }]}
      pointerEvents="none"
    >
      <View style={st.hitWedge} />
    </Animated.View>
  )
}

// ─── Tracer line: bright streak from edge toward center ───
const TRACER_DURATION = 350

function Tracer({ id, angle, onDone }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: TRACER_DURATION, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rad = (angle - 90) * (Math.PI / 180)
  const startX = 50 + Math.cos(rad) * 48
  const startY = 50 + Math.sin(rad) * 48

  return (
    <Animated.View
      style={[
        st.tracer,
        {
          left: `${startX}%`,
          top: `${startY}%`,
          opacity: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
          transform: [
            { rotate: `${angle}deg` },
            { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.2] }) },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <View style={st.tracerLine} />
    </Animated.View>
  )
}

// ─── Incoming bolt: an enemy's shot coming out of the scene toward you ───
// Appears as a speck near the horizon in the shooter's direction, grows with 1/depth as
// it closes and streaks past one side of the crosshair. Shots from behind (angle > 100°
// off your heading) cross the bottom of the screen instead.
const IN_MS = 420
const IN_MAX = 10

function IncomingBolt({ id, angle, screenW, screenH, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: IN_MS, easing: Easing.linear, useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Geometry is rolled once per bolt (the parent re-renders ~11×/s; the bolt must not jump).
  const geo = useRef(null)
  if (!geo.current) geo.current = incomingGeometry(angle, screenW, screenH)
  const { sx, sy, dx, dy, rot, fromBehind } = geo.current
  const inputRange = perspInput
  const px = perspInput.map((u) => dx * (fromBehind ? u : approachAt(u)))
  const py = perspInput.map((u) => dy * (fromBehind ? u : approachAt(u)))
  const sc = perspInput.map((u) => (fromBehind ? 0.9 : Math.max(0.08, growAt(u) * 1.1)))
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.boltWrap, {
        left: sx - BOLT_LEN / 2, top: sy - BOLT_W / 2,
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0.3, 1, 1, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange, outputRange: px }) },
          { translateY: t.interpolate({ inputRange, outputRange: py }) },
          { rotate: `${rot}deg` },
          { scale: t.interpolate({ inputRange, outputRange: sc }) },
        ],
      }]}
    >
      <View style={[st.boltGlow, { backgroundColor: ENEMY_BOLT, boxShadow: `0 0 18px 6px ${ENEMY_BOLT}` }]} />
      <View style={[st.boltBody, { backgroundColor: ENEMY_BOLT }]} />
      <View style={st.boltCore} />
    </Animated.View>
  )
}

function incomingGeometry(angle, screenW, screenH) {
  const a = ((angle % 360) + 360) % 360
  const signed = a > 180 ? a - 360 : a // -180..180, + = right of straight ahead
  const fromBehind = Math.abs(signed) > 100
  const cx = screenW / 2
  const horizonY = screenH * 0.42
  let sx, sy, ex, ey
  if (!fromBehind) {
    // Start on the horizon, offset by the bearing; end low on the opposite side so it passes you.
    const spread = Math.max(-1, Math.min(1, signed / 70))
    sx = cx + spread * screenW * 0.45
    sy = horizonY + (Math.random() - 0.5) * 30
    ex = cx + (spread >= 0 ? 1 : -1) * screenW * (0.55 + Math.random() * 0.25) * (Math.abs(spread) < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 1)
    ey = screenH * (0.95 + Math.random() * 0.2)
  } else {
    // From behind: streak across the bottom third from one edge to the other.
    const ltr = signed < 0
    sx = ltr ? -60 : screenW + 60
    sy = screenH * (0.6 + Math.random() * 0.25)
    ex = ltr ? screenW + 60 : -60
    ey = sy - 40 + Math.random() * 80
  }
  const dx = ex - sx
  const dy = ey - sy
  const rot = (Math.atan2(dy, dx) * 180) / Math.PI
  return { sx, sy, dx, dy, rot, fromBehind }
}

// ─── Main battle effects overlay ───

let nextId = 1

/**
 * Hook: returns { addFlash, addExplosion, addHit, addTracer, addBullet, overlay }.
 *
 * Call `addFlash(angle)` when an enemy fires from that compass direction relative to the player.
 * Call `addExplosion(label)` for grenade / sticky bomb / land mine / rocket blasts.
 * Call `addHit(angle)` when the player takes damage from that direction.
 * Call `addTracer(angle)` for incoming shot visual (small streak).
 * Call `addBullet(angle)` for a dramatic bullet projectile flying across the screen.
 */
export function useBattleEffects() {
  const [flashes, setFlashes] = useState([])
  const [explosions, setExplosions] = useState([])
  const [megas, setMegas] = useState([])
  const [kills, setKills] = useState([])
  const [medals, setMedals] = useState([])
  const [outs, setOuts] = useState([])
  const [hits, setHits] = useState([])
  const [tracers, setTracers] = useState([])
  const [bullets, setBullets] = useState([])
  const [rockets, setRockets] = useState([])
  const [booms, setBooms] = useState([])
  const { width: screenW, height: screenH } = useWindowDimensions()
  // Screen shake (big explosions): the game wraps its root view in `shakeStyle`.
  const shakeT = useRef(new Animated.Value(0)).current
  const [shakeAmp, setShakeAmp] = useState(0)
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const removeFlash = useCallback((id) => setFlashes((a) => a.filter((f) => f.id !== id)), [])
  const removeExplosion = useCallback((id) => setExplosions((a) => a.filter((f) => f.id !== id)), [])
  const removeMega = useCallback((id) => setMegas((a) => a.filter((f) => f.id !== id)), [])
  const removeKill = useCallback((id) => setKills((a) => a.filter((f) => f.id !== id)), [])
  const removeMedal = useCallback((id) => setMedals((a) => a.filter((f) => f.id !== id)), [])
  const removeOut = useCallback((id) => setOuts((a) => a.filter((f) => f.id !== id)), [])
  const removeHit = useCallback((id) => setHits((a) => a.filter((f) => f.id !== id)), [])
  const removeTracer = useCallback((id) => setTracers((a) => a.filter((f) => f.id !== id)), [])
  const removeBullet = useCallback((id) => setBullets((a) => a.filter((f) => f.id !== id)), [])
  const removeRocket = useCallback((id) => setRockets((a) => a.filter((f) => f.id !== id)), [])
  const removeBoom = useCallback((id) => setBooms((a) => a.filter((f) => f.id !== id)), [])

  const shake = useCallback((amp = 12, ms = 520) => {
    setShakeAmp(Math.max(2, Math.min(24, amp)))
    shakeT.stopAnimation()
    shakeT.setValue(0)
    Animated.timing(shakeT, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }).start()
  }, [shakeT])

  // An explosion at a screen point: { x, y, size, label, flat }.
  const addPointExplosion = useCallback((e) => {
    if (!Number.isFinite(e?.x) || !Number.isFinite(e?.y)) return
    setBooms((a) => [...a, { id: nextId++, label: 'Rocket', size: screenW * 0.6, ...e }].slice(-EXPLOSION_MAX))
  }, [screenW])

  // A rocket from `from` to `to` (screen points), `dist` metres away (sets the perspective and
  // the flight time). It explodes on arrival; onImpact() runs then (sound, haptics).
  // flat: hip-fire radar. Returns the flight time in ms.
  const addRocket = useCallback(({ from, to, dist = 25, flat = false, boomSize, onImpact } = {}) => {
    const fromX = Number.isFinite(from?.x) ? from.x : screenW * 0.7
    const fromY = Number.isFinite(from?.y) ? from.y : screenH * 0.8
    const toX = Number.isFinite(to?.x) ? to.x : screenW / 2
    const toY = Number.isFinite(to?.y) ? to.y : screenH / 2
    const ms = rocketFlightMs(dist, flat)
    setRockets((a) => [...a, { id: nextId++, fromX, fromY, toX, toY, dist, flat }].slice(-ROCKET_MAX))
    const size = Number.isFinite(boomSize) ? boomSize : flat ? Math.min(screenW * 0.5, 220) : Math.max(screenW * 0.38, Math.min(screenW * 1.15, (screenW * 2.4) / Math.sqrt(Math.max(3, dist))))
    const t = setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t)
      addPointExplosion({ x: toX, y: toY, size, label: 'Rocket', flat })
      shake(flat ? 10 : Math.max(8, Math.min(22, 60 / Math.sqrt(Math.max(3, dist)))))
      try { onImpact?.() } catch {}
    }, ms)
    timers.current.push(t)
    return ms
  }, [screenW, screenH, addPointExplosion, shake])

  const addFlash = useCallback((angle) => {
    setFlashes((a) => {
      const n = [...a, { id: nextId++, angle }]
      return n.length > FLASH_MAX ? n.slice(-FLASH_MAX) : n
    })
  }, [])

  const addExplosion = useCallback((label) => {
    setExplosions((a) => {
      const n = [...a, { id: nextId++, label }]
      return n.length > EXPLOSION_MAX ? n.slice(-EXPLOSION_MAX) : n
    })
  }, [])

  // A blast somewhere in the arena: { label, angle (screen-relative deg), dist (m), by }
  const addMegaExplosion = useCallback((m) => {
    setMegas((a) => {
      const n = [...a, { id: nextId++, ...m }]
      return n.length > MEGA_MAX ? n.slice(-MEGA_MAX) : n
    })
  }, [])

  // Your own shot. leftHanded puts the gun (and the bullet's start) on the left.
  // target: optional { x, y } on screen (an enemy you're aiming at); default the crosshair.
  // from: optional { x, y } where the round leaves (the gun's muzzle).
  // opts.flat: hip fire (radar): straight and constant size, from the radar centre.
  const addOutgoing = useCallback((leftHanded = false, target = null, from = null, gunId = null, opts = null) => {
    // No target: the bolt flies down the crosshair into the distance (a little scatter so a
    // burst doesn't stack into one line).
    const toX = Number.isFinite(target?.x) ? target.x : screenW / 2 + (Math.random() - 0.5) * 14
    const toY = Number.isFinite(target?.y) ? target.y : screenH / 2 + (Math.random() - 0.5) * 10
    const fromX = Number.isFinite(from?.x) ? from.x : screenW * (leftHanded ? 0.3 : 0.7)
    const fromY = Number.isFinite(from?.y) ? from.y : screenH * 0.8
    setOuts((a) => {
      const n = [...a, { id: nextId++, fromX, fromY, toX, toY, color: glowFor(gunId), flat: !!opts?.flat }]
      return n.length > OUT_MAX ? n.slice(-OUT_MAX) : n
    })
  }, [screenW, screenH])

  // Kill notification: { victim, weapon, points }
  const addKill = useCallback((k) => {
    setKills((a) => {
      const n = [...a, { id: nextId++, ...k }]
      return n.length > KILL_MAX ? n.slice(-KILL_MAX) : n
    })
  }, [])

  // Medal: { title, sub } (only the newest shows).
  const addMedal = useCallback((m) => {
    setMedals((a) => [...a, { id: nextId++, ...m }].slice(-2))
  }, [])

  const addHit = useCallback((angle) => {
    setHits((a) => [...a, { id: nextId++, angle }])
  }, [])

  const addTracer = useCallback((angle) => {
    setTracers((a) => [...a, { id: nextId++, angle }])
  }, [])

  const addBullet = useCallback((angle) => {
    setBullets((a) => {
      const n = [...a, { id: nextId++, angle }]
      return n.length > IN_MAX ? n.slice(-IN_MAX) : n
    })
  }, [])

  const overlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flashes.map((f) => <MuzzleFlash key={f.id} id={f.id} angle={f.angle} onDone={removeFlash} />)}
      {megas.map((m) => <MegaExplosion key={m.id} id={m.id} label={m.label} angle={m.angle} dist={m.dist} by={m.by} onDone={removeMega} />)}
      {explosions.map((e) => <Explosion key={e.id} id={e.id} label={e.label} onDone={removeExplosion} />)}
      {hits.map((h) => <HitIndicator key={h.id} id={h.id} angle={h.angle} onDone={removeHit} />)}
      {tracers.map((t) => <Tracer key={t.id} id={t.id} angle={t.angle} onDone={removeTracer} />)}
      {outs.map((o) => <LaserBolt key={o.id} id={o.id} fromX={o.fromX} fromY={o.fromY} toX={o.toX} toY={o.toY} color={o.color} flat={o.flat} onDone={removeOut} />)}
      {rockets.map((r) => <RocketShot key={r.id} id={r.id} fromX={r.fromX} fromY={r.fromY} toX={r.toX} toY={r.toY} dist={r.dist} flat={r.flat} onDone={removeRocket} />)}
      {booms.map((b) => <PointExplosion key={b.id} id={b.id} x={b.x} y={b.y} size={b.size} label={b.label} flat={b.flat} onDone={removeBoom} />)}
      {bullets.map((b) => <IncomingBolt key={b.id} id={b.id} angle={b.angle} screenW={screenW} screenH={screenH} onDone={removeBullet} />)}
      {/* Newest elimination only (a quick double tag replaces the banner, CoD style). */}
      <View style={st.killWrap} pointerEvents="none">
        {kills.slice(-1).map((k) => <KillBanner key={k.id} id={k.id} victim={k.victim} weapon={k.weapon} points={k.points} onDone={removeKill} />)}
        {medals.slice(-1).map((m) => <MedalCard key={m.id} id={m.id} title={m.title} sub={m.sub} onDone={removeMedal} />)}
      </View>
    </View>
  )

  const k = shakeAmp
  const shakeStyle = k > 0 ? {
    transform: [
      { translateX: shakeT.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1], outputRange: [0, -k, k * 0.9, -k * 0.75, k * 0.6, -k * 0.45, k * 0.3, -k * 0.2, k * 0.1, 0] }) },
      { translateY: shakeT.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], outputRange: [0, k * 0.7, -k * 0.6, k * 0.45, -k * 0.3, k * 0.15, 0] }) },
    ],
  } : null

  return { addFlash, addExplosion, addMegaExplosion, addKill, addMedal, addOutgoing, addHit, addTracer, addBullet, addRocket, addPointExplosion, shake, shakeStyle, overlay }
}

/**
 * Compute the bearing angle from the player to a shooter, relative to the player's heading.
 * Returns a screen angle: 0° = top of screen (straight ahead), 90° = right, etc.
 */
export function directionToAngle(myPos, myHeading, shooterPos) {
  if (!myPos || !shooterPos) return Math.random() * 360
  const bearing = bearingDeg(myPos, shooterPos)
  // Screen angle: shooter's bearing minus my heading. 0° = ahead on screen.
  return ((bearing - (myHeading || 0)) % 360 + 360) % 360
}

const st = StyleSheet.create({
  flash: {
    position: 'absolute',
    width: 48, height: 48,
    marginLeft: -24, marginTop: -24,
    alignItems: 'center', justifyContent: 'center',
  },
  flashCore: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff4e0', boxShadow: `0 0 16px 6px ${ST.enemy}` },
  flashRay: { position: 'absolute', width: 44, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,200,160,0.9)' },
  explosion: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center', justifyContent: 'center',
  },
  explosionEmoji: { fontSize: 72 },
  blastRing: {
    position: 'absolute',
    width: 120, height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#ff6600',
  },
  boltWrap: { position: 'absolute', width: BOLT_LEN, height: BOLT_W, alignItems: 'center', justifyContent: 'center' },
  boltGlow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: BOLT_W / 2, opacity: 0.55 },
  boltBody: { position: 'absolute', left: 6, right: 6, top: 2, bottom: 2, borderRadius: BOLT_W / 2 },
  boltCore: { position: 'absolute', left: 14, right: 14, top: BOLT_W / 2 - 2, height: 4, borderRadius: 2, backgroundColor: '#ffffff' },
  rocketWrap: { position: 'absolute', width: ROCKET_LEN, height: ROCKET_W, justifyContent: 'center' },
  rocketTrail: { position: 'absolute', left: -70, width: 96, top: ROCKET_W / 2 - 5, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,170,90,0.55)', boxShadow: '0 0 16px 6px rgba(255,120,40,0.6)' },
  rocketFlame: { position: 'absolute', left: 2, top: ROCKET_W / 2 - 8, width: 26, height: 16, borderRadius: 8, backgroundColor: '#ffb347', boxShadow: '0 0 14px 6px rgba(255,140,40,0.9)' },
  rocketFlameCore: { position: 'absolute', left: 10, top: ROCKET_W / 2 - 4, width: 14, height: 8, borderRadius: 4, backgroundColor: '#fff6d5' },
  rocketFin: { position: 'absolute', left: 22, width: 16, height: 6, borderRadius: 2, backgroundColor: '#5b6470' },
  rocketBody: { position: 'absolute', left: 24, width: 50, top: ROCKET_W / 2 - 5, height: 10, borderRadius: 3, backgroundColor: '#d9dee5', borderWidth: 1, borderColor: '#7d8792' },
  rocketBand: { position: 'absolute', left: 58, width: 5, top: ROCKET_W / 2 - 5, height: 10, backgroundColor: ST.enemy },
  rocketNose: { position: 'absolute', left: 74, top: ROCKET_W / 2 - 5, width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 16, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#ff6a3d' },
  boltFlare: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  boltFlareCore: { width: 16, height: 16, borderRadius: 8, opacity: 0.9 },
  megaLabelWrap: { position: 'absolute', top: '18%', left: 0, right: 0, alignItems: 'center' },
  megaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  megaLabel: { fontFamily: FONT.display, fontSize: 22, letterSpacing: 1.5, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  megaBy: { marginTop: 2, fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.6, color: '#fff', ...stShadow },
  killWrap: { position: 'absolute', top: '53%', left: 16, right: 16, alignItems: 'center', gap: 12 },
  kill: { alignItems: 'center', gap: 6, maxWidth: '100%' },
  killHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  killRule: { width: 40, height: 2, backgroundColor: ST.enemy },
  killWord: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 2.6, color: ST.enemy, ...stShadow },
  killName: { fontFamily: FONT.display, fontSize: 34, lineHeight: 38, letterSpacing: 1.5, color: '#ffffff', includeFontPadding: false, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } },
  killPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: ST.panel, maxWidth: '100%' },
  killWeapon: { flexShrink: 1, fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.2, color: 'rgba(242,244,247,0.8)' },
  killPts: { fontFamily: FONT.display, fontSize: 16, color: ST.objective },
  medal: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.objective, backgroundColor: ST.panel, maxWidth: '100%' },
  medalTitle: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 1, color: ST.objective },
  medalSub: { fontFamily: FONT.uiSemi, fontSize: 11, color: 'rgba(242,244,247,0.75)' },
  explosionLabel: {
    position: 'absolute',
    bottom: '30%',
    fontFamily: FONT.display,
    fontSize: 22,
    color: '#ff9944',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    letterSpacing: 1,
  },
  hitIndicator: {
    position: 'absolute',
    width: '100%', height: '100%',
    alignItems: 'center',
  },
  hitWedge: {
    width: 40, height: 80,
    borderLeftWidth: 20, borderRightWidth: 20,
    borderBottomWidth: 40,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: 'rgba(255,61,82,0.8)',
    marginTop: -4,
  },
  tracer: {
    position: 'absolute',
    width: 60, height: 4,
    marginLeft: -30, marginTop: -2,
  },
  tracerLine: {
    width: '100%', height: '100%',
    borderRadius: 2,
    backgroundColor: '#ffe066',
    shadowColor: '#ff6600',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
})
