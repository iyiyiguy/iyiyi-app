// 3D "inspect" viewer for a Laser Tag gun.
//
// With turntable frames (lib/gunSpin.js): drag horizontally to spin through the frames (wraps
// around), with momentum after release and a slow auto-rotate when idle. Only ONE <Image> is
// mounted; its source is swapped as the angle changes.
// Without frames (null): the still gunArt image sways on a perspective rotateY (±25°) driven by
// the same drag / momentum / idle model, so it still feels 3D.
//
// Pinch with two fingers to zoom 1×–2× (springs back on release). Never throws.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Image, PanResponder, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { RARITIES } from '../lib/guns'
import { gunArt } from '../lib/gunArt'

const DEG_PER_PX = 0.6 // drag sensitivity: degrees of spin per pixel
const IDLE_SPEED = 24 // auto-rotate, degrees per second
const RESUME_MS = 2500 // auto-rotate resumes this long after the finger lifts
const FRICTION = 0.94 // momentum decay per 16ms frame
const MAX_TILT = 25 // still-image fallback: max rotateY in degrees
const MAX_VEL = 2400 // deg/s cap on fling velocity

const mod = (a, n) => ((a % n) + n) % n
const touchDist = (touches) => {
  if (!touches || touches.length < 2) return 0
  const dx = touches[0].pageX - touches[1].pageX
  const dy = touches[0].pageY - touches[1].pageY
  return Math.sqrt(dx * dx + dy * dy)
}

function GunSpinViewer({ gun, frames, height = 280, autoRotate = true, style }) {
  const { width: winW } = useWindowDimensions()
  const list = Array.isArray(frames) && frames.length > 0 ? frames : null
  const n = list ? list.length : 0
  const rarity = RARITIES[gun?.rarity] || RARITIES.common
  const glow = rarity.color

  let still = null
  try { still = gunArt(gun) } catch { still = null }

  const [frame, setFrame] = useState(0)
  const frameRef = useRef(0)

  // Motion model (refs: no re-render per tick).
  const angle = useRef(0) // degrees, unbounded
  const vel = useRef(0) // deg/s
  const dragging = useRef(false)
  const lastTouchEnd = useRef(-Infinity)
  const dragStartAngle = useRef(0)
  const pinchStart = useRef(0)
  const touched = useRef(false)

  const tilt = useRef(new Animated.Value(0)).current // still fallback: rotateY degrees
  const zoom = useRef(new Animated.Value(1)).current
  const hint = useRef(new Animated.Value(1)).current
  const float = useRef(new Animated.Value(0)).current

  // Reset when the gun changes.
  useEffect(() => {
    angle.current = 0
    vel.current = 0
    frameRef.current = 0
    setFrame(0)
    try { tilt.setValue(0) } catch { /* ignore */ }
  }, [gun?.id, n, tilt])

  // Gentle idle float (purely decorative).
  useEffect(() => {
    let loop = null
    try {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]))
      loop.start()
    } catch { /* ignore */ }
    return () => { try { loop?.stop() } catch { /* ignore */ } }
  }, [float])

  // Apply the current angle to the view.
  const apply = () => {
    try {
      if (n) {
        const idx = mod(Math.round((angle.current / 360) * n), n)
        if (idx !== frameRef.current) {
          frameRef.current = idx
          setFrame(idx)
        }
      } else {
        tilt.setValue(Math.sin((angle.current * Math.PI) / 180) * MAX_TILT)
      }
    } catch { /* ignore */ }
  }

  // One rAF loop drives momentum and idle auto-rotate.
  useEffect(() => {
    let raf = null
    let last = Date.now()
    let alive = true
    const tick = () => {
      if (!alive) return
      const now = Date.now()
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      try {
        if (!dragging.current) {
          if (Math.abs(vel.current) > 4) {
            angle.current += vel.current * dt
            vel.current *= Math.pow(FRICTION, dt * 60)
            apply()
          } else {
            vel.current = 0
            if (autoRotate && now - lastTouchEnd.current > RESUME_MS) {
              // Still image: slower sway so it reads as a gentle tilt.
              angle.current += (n ? IDLE_SPEED : IDLE_SPEED * 2.2) * dt
              apply()
            }
          }
        }
      } catch { /* ignore */ }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { alive = false; if (raf != null) cancelAnimationFrame(raf) }
  }, [autoRotate, n])

  const firstTouch = () => {
    if (touched.current) return
    touched.current = true
    try { Animated.timing(hint, { toValue: 0, duration: 400, useNativeDriver: true }).start() } catch { /* ignore */ }
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      dragging.current = true
      vel.current = 0
      dragStartAngle.current = angle.current
      pinchStart.current = touchDist(e?.nativeEvent?.touches)
      firstTouch()
    },
    onPanResponderMove: (e, g) => {
      try {
        const touches = e?.nativeEvent?.touches
        if (touches && touches.length >= 2) {
          const d = touchDist(touches)
          if (!pinchStart.current) pinchStart.current = d
          else if (d > 0) zoom.setValue(Math.max(1, Math.min(2, d / pinchStart.current)))
          dragStartAngle.current = angle.current - g.dx * DEG_PER_PX // no spin jump while pinching
          return
        }
        pinchStart.current = 0
        // Dragging right turns the gun the way the finger moves.
        angle.current = dragStartAngle.current + g.dx * DEG_PER_PX
        apply()
      } catch { /* ignore */ }
    },
    onPanResponderRelease: (e, g) => end(g),
    onPanResponderTerminate: (e, g) => end(g),
  }), [n])

  function end(g) {
    dragging.current = false
    lastTouchEnd.current = Date.now()
    pinchStart.current = 0
    const v = (g?.vx || 0) * 1000 * DEG_PER_PX // px/ms -> deg/s
    vel.current = Math.max(-MAX_VEL, Math.min(MAX_VEL, v))
    try { Animated.spring(zoom, { toValue: 1, friction: 6, useNativeDriver: true }).start() } catch { /* ignore */ }
  }

  const w = Math.max(120, Math.min(winW - 32, 640))
  const imgW = Math.min(w * 0.88, height * 0.62 * 2)
  const imgH = imgW / 2
  const glowSize = Math.min(w * 0.95, height * 1.05)
  const source = (list && list[frame]) || still
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] })
  const shadowScale = float.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] })
  const rotateY = tilt.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] })

  return (
    <View style={[{ height, width: '100%' }, st.root, style]} {...responder.panHandlers} accessibilityRole="adjustable" accessibilityLabel={`${gun?.name || 'Weapon'} 3D view. Drag to rotate.`}>
      {/* Radial rarity glow (stacked translucent discs). */}
      <View style={st.center} pointerEvents="none">
        {[1, 0.78, 0.56, 0.36].map((k, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: glowSize * k,
              height: glowSize * k,
              borderRadius: (glowSize * k) / 2,
              backgroundColor: glow,
              opacity: 0.06 + i * 0.035,
            }}
          />
        ))}
      </View>

      {/* Floor shadow + reflection ellipse. */}
      <View style={[st.floor, { top: height / 2 + imgH * 0.42 }]} pointerEvents="none">
        <Animated.View style={{ transform: [{ scaleX: shadowScale }] }}>
          <View style={[st.ellipse, { width: imgW * 0.95, height: imgW * 0.95, borderRadius: imgW, backgroundColor: glow, opacity: 0.22, transform: [{ scaleY: 0.09 }] }]} />
          <View style={[st.ellipse, st.abs, { width: imgW * 0.7, height: imgW * 0.7, borderRadius: imgW, backgroundColor: '#000', opacity: 0.55, left: imgW * 0.125, top: imgW * 0.125, transform: [{ scaleY: 0.07 }] }]} />
        </Animated.View>
      </View>

      {/* The gun. */}
      <View style={st.center} pointerEvents="none">
        <Animated.View
          style={{
            width: imgW,
            height: imgH,
            transform: [
              { perspective: 800 },
              { translateY: floatY },
              { scale: zoom },
              { rotateY: n ? '0deg' : rotateY },
            ],
          }}
        >
          {source ? (
            <Image source={source} style={st.img} resizeMode="contain" fadeDuration={0} />
          ) : null}
        </Animated.View>
      </View>

      <Animated.View style={[st.hint, { opacity: hint }]} pointerEvents="none">
        <Text style={st.hintText}>↻  Drag to rotate</Text>
      </Animated.View>
    </View>
  )
}

const st = StyleSheet.create({
  root: { overflow: 'hidden', justifyContent: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  floor: { position: 'absolute', left: 0, right: 0, alignItems: 'center', height: 1, justifyContent: 'center' },
  ellipse: {},
  abs: { position: 'absolute' },
  img: { width: '100%', height: '100%' },
  hint: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  hintText: { fontSize: 12, fontWeight: Platform.OS === 'android' ? 'bold' : '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.4 },
})

export default memo(GunSpinViewer)
