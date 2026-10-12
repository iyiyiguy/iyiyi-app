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
      <Animated.Text style={{ fontSize: size * 0.45, opacity: fade, transform: [{ scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.3, 1.5] }) }] }}>{'💥'}</Animated.Text>
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
  const arrow = inView ? '' : rel < 0 ? '◀ ' : ''
  const arrowR = inView ? '' : rel > 0 ? ' ▶' : ''
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ScreenFlash color={palette[4]} peak={inView ? 0.4 : 0.22} duration={MEGA_DURATION * 0.6} />
      <View style={{ position: 'absolute', left: x - size / 2, top: height * 0.42 - size / 2 }}>
        <Fireball palette={palette} size={size} duration={MEGA_DURATION} />
      </View>
      <View style={st.megaLabelWrap}>
        <Text style={[st.megaLabel, { color: palette[1] }]}>{`${arrow}💥 ${String(label || 'Explosion').toUpperCase()}${distText ? ` · ${distText}` : ''}${arrowR}`}</Text>
        {by ? <Text style={st.megaBy}>{by}</Text> : null}
      </View>
    </View>
  )
}

// ─── Your own shot: a glowing round flying from the gun into the crosshair ───
const OUT_MS = 230
const OUT_MAX = 8

function OutgoingBullet({ id, fromX, fromY, toX, toY, onDone }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: OUT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.outBullet, {
        left: fromX - 9, top: fromY - 9,
        opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, toX - fromX] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, toY - fromY] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.3, 0.2] }) },
        ],
      }]}
    />
  )
}

// ─── Kill notification, Call of Duty style: who you killed and with what ───
const KILL_MS = 2600
const KILL_MAX = 3

function KillBanner({ id, victim, weapon, points, index, onDone }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.sequence([
      Animated.spring(a, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
      Animated.delay(KILL_MS - 600),
      Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={[st.kill, {
        marginTop: index * 64,
        opacity: a,
        transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) }],
      }]}
    >
      <Text style={st.killTop}>
        <Text style={st.killWord}>{'KILLED  '}</Text>
        <Text style={st.killName}>{String(victim || 'Enemy').toUpperCase()}</Text>
      </Text>
      <Text style={st.killWeapon}>{`${String(weapon || '').toUpperCase()}${points ? `   +${points}` : ''}`}</Text>
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
  const [megas, setMegas] = useState([])
  const [kills, setKills] = useState([])
  const [outs, setOuts] = useState([])
  const [hits, setHits] = useState([])
  const [tracers, setTracers] = useState([])
  const [bullets, setBullets] = useState([])
  const { width: screenW, height: screenH } = useWindowDimensions()

  const removeFlash = useCallback((id) => setFlashes((a) => a.filter((f) => f.id !== id)), [])
  const removeExplosion = useCallback((id) => setExplosions((a) => a.filter((f) => f.id !== id)), [])
  const removeMega = useCallback((id) => setMegas((a) => a.filter((f) => f.id !== id)), [])
  const removeKill = useCallback((id) => setKills((a) => a.filter((f) => f.id !== id)), [])
  const removeOut = useCallback((id) => setOuts((a) => a.filter((f) => f.id !== id)), [])
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

  // A blast somewhere in the arena: { label, angle (screen-relative deg), dist (m), by }
  const addMegaExplosion = useCallback((m) => {
    setMegas((a) => {
      const n = [...a, { id: nextId++, ...m }]
      return n.length > MEGA_MAX ? n.slice(-MEGA_MAX) : n
    })
  }, [])

  // Your own shot. leftHanded puts the gun (and the bullet's start) on the left.
  const addOutgoing = useCallback((leftHanded = false) => {
    setOuts((a) => {
      const n = [...a, { id: nextId++, fromX: screenW * (leftHanded ? 0.3 : 0.7), fromY: screenH * 0.8, toX: screenW / 2, toY: screenH / 2 }]
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
      {megas.map((m) => <MegaExplosion key={m.id} id={m.id} label={m.label} angle={m.angle} dist={m.dist} by={m.by} onDone={removeMega} />)}
      {explosions.map((e) => <Explosion key={e.id} id={e.id} label={e.label} onDone={removeExplosion} />)}
      {hits.map((h) => <HitIndicator key={h.id} id={h.id} angle={h.angle} onDone={removeHit} />)}
      {tracers.map((t) => <Tracer key={t.id} id={t.id} angle={t.angle} onDone={removeTracer} />)}
      {outs.map((o) => <OutgoingBullet key={o.id} id={o.id} fromX={o.fromX} fromY={o.fromY} toX={o.toX} toY={o.toY} onDone={removeOut} />)}
      {bullets.map((b) => <BulletProjectile key={b.id} id={b.id} angle={b.angle} screenW={screenW} screenH={screenH} onDone={removeBullet} />)}
      <View style={st.killWrap} pointerEvents="none">
        {kills.map((k, i) => <KillBanner key={k.id} id={k.id} index={i} victim={k.victim} weapon={k.weapon} points={k.points} onDone={removeKill} />)}
      </View>
    </View>
  )

  return { addFlash, addExplosion, addMegaExplosion, addKill, addOutgoing, addHit, addTracer, addBullet, overlay }
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
  outBullet: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff6c2', borderWidth: 3, borderColor: '#ffb300', shadowColor: '#ff8a00', shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  megaLabelWrap: { position: 'absolute', top: '18%', left: 0, right: 0, alignItems: 'center' },
  megaLabel: { fontSize: 22, fontWeight: '900', letterSpacing: 1.5, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  megaBy: { marginTop: 2, fontSize: 13, fontWeight: '800', color: '#fff', textShadowColor: '#000', textShadowRadius: 6 },
  killWrap: { position: 'absolute', top: '58%', left: 0, right: 0, alignItems: 'center' },
  kill: { position: 'absolute', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderLeftWidth: 4, borderLeftColor: '#ff2d2d' },
  killTop: { fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  killWord: { color: '#ff3b3b' },
  killName: { color: '#fff' },
  killWeapon: { marginTop: 1, fontSize: 12, fontWeight: '800', letterSpacing: 2, color: '#ffd23f' },
  explosionLabel: {
    position: 'absolute',
    bottom: '30%',
    fontSize: 22,
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
