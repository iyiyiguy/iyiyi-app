// Visual battle effects: muzzle flashes, explosions, hit-direction indicators,
// incoming tracers, and bullet projectiles rendered on top of the camera view.
//
// All effects are purely cosmetic overlays keyed off Realtime messages the player already
// receives (lt_shot, got_hit, grenade/sticky_bomb/land_mine detonations). They use
// Animated for GPU-driven opacity/scale so the camera stays smooth.
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { bearingDeg, distanceMeters } from '../../lib/multiplayer'

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
      <Text style={st.flashEmoji}>{'💥'}</Text>
    </Animated.View>
  )
}

// ─── Explosion: larger blast that fills a portion of the screen ───
const EXPLOSION_DURATION = 600
const EXPLOSION_MAX = 4

function Explosion({ id, label, onDone }) {
  const scale = useRef(new Animated.Value(0.2)).current
  const opacity = useRef(new Animated.Value(1)).current
  const ring = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.6, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.timing(opacity, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[st.explosion, { opacity }]} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={st.explosionEmoji}>{'💥'}</Text>
      </Animated.View>
      <Animated.View
        style={[
          st.blastRing,
          {
            opacity: ring.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 3] }) }],
          },
        ]}
      />
      {label ? <Text style={st.explosionLabel}>{label}</Text> : null}
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

// ─── Bullet projectile: a bright round flying across the full screen ───
// Enters from the edge at the shooter's angle, flies past the centre and off
// the far side. Much bigger and more visible than the tracer streak.
const BULLET_DURATION = 500
const BULLET_MAX = 10

function BulletProjectile({ id, angle, screenW, screenH, onDone }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: BULLET_DURATION,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute a start and end point: the bullet enters from the edge at `angle`
  // and exits on the opposite side, passing roughly through the centre with a
  // small random lateral offset so successive shots don't stack.
  const rad = (angle - 90) * (Math.PI / 180)
  const diag = Math.hypot(screenW, screenH) * 0.55
  // Entry point: just outside the screen edge in the direction of the shooter
  const startX = screenW / 2 + Math.cos(rad) * diag
  const startY = screenH / 2 + Math.sin(rad) * diag
  // Exit point: opposite side, with slight jitter
  const jitter = (Math.random() - 0.5) * 60
  const exitRad = rad + Math.PI + jitter * (Math.PI / 180)
  const endX = screenW / 2 + Math.cos(exitRad) * diag
  const endY = screenH / 2 + Math.sin(exitRad) * diag

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startX - screenW / 2, endX - screenW / 2],
  })
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startY - screenH / 2, endY - screenH / 2],
  })
  // Bullet is brightest mid-flight, fades in/out at edges
  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 0.5, 0.85, 1],
    outputRange: [0, 1, 1, 0.6, 0],
  })
  // Trail stretches in the direction of travel
  const scaleX = progress.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0.4, 1, 1, 0.6],
  })

  return (
    <Animated.View
      style={[
        st.bullet,
        {
          left: '50%',
          top: '50%',
          opacity,
          transform: [
            { translateX },
            { translateY },
            { rotate: `${angle}deg` },
            { scaleX },
          ],
        },
      ]}
      pointerEvents="none"
    >
      {/* Glowing bullet core + trail */}
      <View style={st.bulletTrail} />
      <View style={st.bulletCore} />
    </Animated.View>
  )
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
  const [hits, setHits] = useState([])
  const [tracers, setTracers] = useState([])
  const [bullets, setBullets] = useState([])
  const { width: screenW, height: screenH } = useWindowDimensions()

  const removeFlash = useCallback((id) => setFlashes((a) => a.filter((f) => f.id !== id)), [])
  const removeExplosion = useCallback((id) => setExplosions((a) => a.filter((f) => f.id !== id)), [])
  const removeHit = useCallback((id) => setHits((a) => a.filter((f) => f.id !== id)), [])
  const removeTracer = useCallback((id) => setTracers((a) => a.filter((f) => f.id !== id)), [])
  const removeBullet = useCallback((id) => setBullets((a) => a.filter((f) => f.id !== id)), [])

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

  const addHit = useCallback((angle) => {
    setHits((a) => [...a, { id: nextId++, angle }])
  }, [])

  const addTracer = useCallback((angle) => {
    setTracers((a) => [...a, { id: nextId++, angle }])
  }, [])

  const addBullet = useCallback((angle) => {
    setBullets((a) => {
      const n = [...a, { id: nextId++, angle }]
      return n.length > BULLET_MAX ? n.slice(-BULLET_MAX) : n
    })
  }, [])

  const overlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flashes.map((f) => <MuzzleFlash key={f.id} id={f.id} angle={f.angle} onDone={removeFlash} />)}
      {explosions.map((e) => <Explosion key={e.id} id={e.id} label={e.label} onDone={removeExplosion} />)}
      {hits.map((h) => <HitIndicator key={h.id} id={h.id} angle={h.angle} onDone={removeHit} />)}
      {tracers.map((t) => <Tracer key={t.id} id={t.id} angle={t.angle} onDone={removeTracer} />)}
      {bullets.map((b) => <BulletProjectile key={b.id} id={b.id} angle={b.angle} screenW={screenW} screenH={screenH} onDone={removeBullet} />)}
    </View>
  )

  return { addFlash, addExplosion, addHit, addTracer, addBullet, overlay }
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
  flashEmoji: { fontSize: 36 },
  explosion: {
    ...StyleSheet.absoluteFillObject,
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
  explosionLabel: {
    position: 'absolute',
    bottom: '38%',
    fontSize: 14,
    fontWeight: '800',
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
    borderBottomColor: 'rgba(255,30,30,0.55)',
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
  // ─── Bullet projectile styles ───
  bullet: {
    position: 'absolute',
    width: 36, height: 12,
    marginLeft: -18, marginTop: -6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bulletCore: {
    width: 12, height: 12,
    borderRadius: 6,
    backgroundColor: '#ffe44d',
    shadowColor: '#ffaa00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  bulletTrail: {
    width: 24, height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,200,60,0.7)',
    shadowColor: '#ff6600',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
})
