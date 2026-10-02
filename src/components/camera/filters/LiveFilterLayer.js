import React, { useEffect, useRef, useState } from 'react'
import { Animated, AppState, StyleSheet, View } from 'react-native'
import * as Location from 'expo-location'
import {
  detectBodies, detectFaces, isBodyHitAvailable, isFaceDetectAvailable,
} from '../../../../modules/body-hit'
import {
  MAX_HEADS, OVERLAY_BOX, fallbackHead, headsFromBodies, headsFromFaces, nameTagText, placeOverlay, selectTargets,
} from '../../../lib/cameraFilters'
import { FilterArt } from './FilterArt'

// Live AR filter over the camera preview (photo AND video mode).
//
// Tracking: a few times a second (~3.7/s, ~2/s while recording; one at a time) it grabs a
// tiny, silent, unprocessed still and runs Apple Vision body-pose on it (the local `body-hit`
// module, same as Laser Tag). Each head is mapped onto the aspect-filled (front camera:
// mirrored) preview. selectTargets() then matches heads to nearby iYiYi users using their GPS
// bearing vs. the phone's compass heading and the camera's field of view: matched people get
// the filter with their own name; otherwise the nearest (largest) face gets it. Overlays glide
// between samples on the native driver, keep their slot per person, and their size is smoothed
// so they grow / shrink as the person comes closer / moves away. Nobody found (or no Vision in
// this build) -> the overlay hovers top-center, which suits selfies.
//
// Pausing: `paused` stops sampling (burst), `holdRef` is flipped by the screen so no new
// sample starts while a real photo / recording start is happening, and
// `controlRef.current.waitIdle()` resolves once an in-flight sample has finished.

export const visionAvailable = isBodyHitAvailable
// Face boxes are cheap: ~7 samples/s. Body pose (older binaries without detectFaces) ~3.7/s.
const SAMPLE_MS = isFaceDetectAvailable ? 135 : 270
const SAMPLE_MS_RECORDING = 500 // ~2/s while a video is recording
const MISSES_BEFORE_FALLBACK = 3
const SIZE_SMOOTH = 0.6 // weight of a new head size (the springs smooth the rest)
const LOST_OPACITY = 0.6 // face lost: hold the last spot / pose, slightly faded
const LOST_TO_FALLBACK_MS = 4000 // ...then go back to the default spot
const DEADZONE = 0.045 // rad (~2.5 deg): ignore head-angle changes smaller than this
const SPRING = { stiffness: 170, damping: 26, mass: 1, useNativeDriver: true, restDisplacementThreshold: 0.2, restSpeedThreshold: 0.2 } // damping = 2*sqrt(k*m): critical
const SPRING_FINE = { ...SPRING, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.001 }
const clampA = (v, m) => Math.max(-m, Math.min(m, v))

// Turns a raw head pose into a steady one for this slot: pitch is measured against a slow
// running baseline of the nose drop (so a still head reads 0 whatever the face shape), and
// each angle only moves when it changes by more than the deadzone - so the 3D logo is still
// while the head is still, and only turns when the head turns.
function stablePose(slot, raw) {
  try {
    let pitch = Number.isFinite(raw.pitch) ? raw.pitch : 0
    if (Number.isFinite(raw.down)) {
      slot.baseDown = Number.isFinite(slot.baseDown) ? slot.baseDown + (raw.down - slot.baseDown) * 0.03 : raw.down
      pitch = clampA((raw.down - slot.baseDown) * 2.2, 0.5)
    }
    const next = { yaw: Number(raw.yaw) || 0, pitch, roll: Number(raw.roll) || 0 }
    const prev = slot.pose
    if (!prev) { slot.pose = next; return next }
    const hold = (a) => (Math.abs(next[a] - prev[a]) < DEADZONE ? prev[a] : next[a])
    slot.pose = { yaw: hold('yaw'), pitch: hold('pitch'), roll: hold('roll') }
    return slot.pose
  } catch {
    return slot.pose || null
  }
}
const MAX_FAILURES = 6 // consecutive failed samples before tracking gives up (stays in fallback)
const TOP_LIMIT = 64 // keep overlays below the close button / nearby chip
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// One tiny, silent, unprocessed still -> heads in view pixels (null = the sample failed).
async function sampleOnce(cam, view, mirror) {
  try {
    const pic = await cam.takePictureAsync({ quality: 0.05, skipProcessing: true, shutterSound: false, exif: false })
    if (!pic?.uri) return null
    if (isFaceDetectAvailable) {
      const faces = await detectFaces(pic.uri, true) // deletes the temp still
      return Array.isArray(faces) ? headsFromFaces(faces, view, mirror) : null
    }
    const bodies = await detectBodies(pic.uri, true)
    return Array.isArray(bodies) ? headsFromBodies(bodies, view, mirror) : null
  } catch {
    return null
  }
}

function makeSlot() {
  const slot = {
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    s: new Animated.Value(1),
    o: new Animated.Value(0),
    r: new Animated.Value(0), // roll, radians (counter-clockwise)
    yaw: new Animated.Value(0), // radians, for the 2D logo's perspective turn
    pose: null,
    baseDown: null,
    last: null,
    shown: false,
    key: null,
    size: 0,
    cx: 0,
    poseFn: null, // set by the 3D logo: receives { yaw, pitch, roll } or null
  }
  slot.register = (fn) => { slot.poseFn = typeof fn === 'function' ? fn : null }
  return slot
}
const sendPose = (slot, pose) => { try { slot.poseFn?.(pose || null) } catch {} }

// Smoothed compass heading (degrees) in a ref - no re-renders. null until known.
function useHeadingRef() {
  const heading = useRef(null)
  useEffect(() => {
    let sub = null
    let cancelled = false
    let vec = null
    ;(async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (perm?.status !== 'granted' || cancelled) return
        sub = await Location.watchHeadingAsync((h) => {
          try {
            const raw = h?.trueHeading >= 0 ? h.trueHeading : h?.magHeading
            if (!Number.isFinite(raw) || raw < 0) return
            const r = (raw * Math.PI) / 180
            vec = vec
              ? { x: vec.x + 0.3 * (Math.sin(r) - vec.x), y: vec.y + 0.3 * (Math.cos(r) - vec.y) }
              : { x: Math.sin(r), y: Math.cos(r) }
            heading.current = ((Math.atan2(vec.x, vec.y) * 180) / Math.PI + 360) % 360
          } catch {}
        })
        if (cancelled) { try { sub?.remove() } catch {} }
      } catch {
        // no compass: matching falls back to the nearest face
      }
    })()
    return () => {
      cancelled = true
      try { sub?.remove() } catch {}
    }
  }, [])
  return heading
}

export default function LiveFilterLayer({
  filter, cameraRef, cameraReadyRef, facing, paused, recording, holdRef, controlRef, view, nearby, me, coordsRef,
}) {
  const slots = useRef(null)
  if (!slots.current) slots.current = Array.from({ length: MAX_HEADS }, makeSlot)
  const [used, setUsed] = useState(1) // slots ever needed (they stay mounted)
  const [names, setNames] = useState(() => Array(MAX_HEADS).fill('@iyiyi'))
  const inflight = useRef(null)
  const misses = useRef(0)
  const lostAt = useRef(0)
  const lastHeads = useRef([])
  const heading = useHeadingRef()
  const latest = useRef({})
  latest.current = { filter, facing, view, nearby, me, recording }

  const targetsFor = (heads) => {
    const { facing: fc, nearby: nb, me: m, view: v } = latest.current
    const t = selectTargets({ heads, facing: fc, nearby: nb, me: m, myPos: coordsRef?.current, headingDeg: heading.current })
    if (t.length) return t
    return [{ ...fallbackHead(v, fc), pose: null, name: nameTagText({ facing: fc, headCount: 0, nearby: nb, me: m }), key: 'fallback' }]
  }

  const apply = (targets, instant = false) => {
    try {
      const f = latest.current.filter
      const list = (targets || []).slice(0, MAX_HEADS)
      const all = slots.current
      const assigned = Array(MAX_HEADS).fill(null)
      const pending = []
      // Same person keeps the same slot; otherwise the closest visible one; otherwise a free one.
      list.forEach((t) => {
        const i = all.findIndex((s, k) => s.shown && s.key === t.key && !assigned[k])
        if (i >= 0) assigned[i] = t
        else pending.push(t)
      })
      pending.forEach((t) => {
        let best = -1
        all.forEach((s, k) => {
          if (assigned[k] || !s.shown) return
          if (best < 0 || Math.abs(s.cx - t.cx) < Math.abs(all[best].cx - t.cx)) best = k
        })
        if (best < 0) best = assigned.findIndex((a, k) => !a && !all[k].shown)
        if (best < 0) best = assigned.findIndex((a) => !a)
        if (best >= 0) assigned[best] = t
      })
      const highest = assigned.reduce((m, a, k) => (a ? k + 1 : m), 1)
      if (highest > 1) setUsed((u) => Math.max(u, highest))
      const nextNames = all.map((s, k) => assigned[k]?.name || null)
      setNames((prev) => {
        const merged = prev.map((p, k) => nextNames[k] || p)
        return merged.every((n, k) => n === prev[k]) ? prev : merged
      })
      all.forEach((slot, k) => {
        const t = assigned[k]
        if (t) {
          const samePerson = slot.shown && slot.key === t.key
          if (!samePerson) { slot.pose = null; slot.baseDown = null }
          const size = samePerson && slot.size > 0 ? slot.size * (1 - SIZE_SMOOTH) + t.size * SIZE_SMOOTH : t.size
          const pose = t.pose ? stablePose(slot, t.pose) : slot.pose // no angles this frame: hold
          const placed = placeOverlay(f, { ...t, size, pose }, TOP_LIMIT)
          const s = placed.s
          const ax = placed.anchorX - OVERLAY_BOX / 2
          const ay = placed.anchorY - OVERLAY_BOX // box bottom sits on the anchor (transformOrigin bottom)
          if (t.key !== 'fallback') sendPose(slot, pose)
          if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(s)) return
          const roll = Number.isFinite(pose?.roll) ? pose.roll : 0
          const yaw = Number.isFinite(pose?.yaw) ? pose.yaw : 0
          if (!slot.shown || instant) {
            slot.x.setValue(ax)
            slot.y.setValue(ay)
            slot.s.setValue(s)
            slot.r.setValue(roll)
            slot.yaw.setValue(yaw)
          } else {
            // Critically damped springs: they glide to each new sample without jitter or
            // overshoot, and retarget smoothly when the next sample lands mid-flight.
            Animated.parallel([
              Animated.spring(slot.x, { ...SPRING, toValue: ax }),
              Animated.spring(slot.y, { ...SPRING, toValue: ay }),
              Animated.spring(slot.s, { ...SPRING_FINE, toValue: s }),
              Animated.spring(slot.r, { ...SPRING_FINE, toValue: roll }),
              Animated.spring(slot.yaw, { ...SPRING_FINE, toValue: yaw }),
            ]).start()
          }
          Animated.timing(slot.o, { toValue: t.lost ? LOST_OPACITY : 1, duration: 260, useNativeDriver: true }).start()
          slot.shown = true
          slot.key = t.key
          slot.size = size
          slot.cx = t.cx
          slot.last = { ...t, size, pose }
        } else if (slot.shown) {
          slot.shown = false
          slot.key = null
          slot.size = 0
          slot.pose = null
          slot.baseDown = null
          sendPose(slot, null)
          Animated.timing(slot.o, { toValue: 0, duration: 220, useNativeDriver: true }).start()
        }
      })
    } catch {
      // a bad frame is just skipped
    }
  }

  // Start at the fallback spot; re-place when the size or camera changes.
  useEffect(() => {
    misses.current = 0
    lastHeads.current = []
    apply(targetsFor([]), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.width, view?.height, facing, filter])

  // Names can change without a new sample (nearby list refreshed).
  useEffect(() => {
    if (lastHeads.current.length) apply(targetsFor(lastHeads.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby, me])

  useEffect(() => {
    if (!controlRef) return undefined
    controlRef.current = {
      waitIdle: () => inflight.current || Promise.resolve(),
      getHeading: () => heading.current,
    }
    return () => { controlRef.current = null }
  }, [controlRef, heading])

  useEffect(() => {
    if (paused || !visionAvailable) return undefined
    let alive = true
    let failures = 0
    ;(async () => {
      await sleep(400) // let the preview settle (and a just-taken photo finish)
      while (alive) {
        const t0 = Date.now()
        const cam = cameraRef?.current
        if (cam && cameraReadyRef?.current && !holdRef?.current && AppState.currentState === 'active') {
          const { view: v0, facing: f0 } = latest.current
          const p = sampleOnce(cam, v0, f0 === 'front')
          inflight.current = p
          // eslint-disable-next-line no-await-in-loop
          const heads = await p
          if (inflight.current === p) inflight.current = null
          if (!alive) break
          if (heads) {
            failures = 0
            if (heads.length) {
              misses.current = 0
              lostAt.current = 0
              lastHeads.current = heads
              apply(targetsFor(heads))
            } else {
              misses.current += 1
              if (misses.current === MISSES_BEFORE_FALLBACK) {
                // Face lost: hold the last spot and pose, a little faded...
                lostAt.current = Date.now()
                const held = slots.current.filter((sl) => sl.shown && sl.last && sl.key !== 'fallback').map((sl) => ({ ...sl.last, lost: true }))
                if (held.length) apply(held)
                else apply(targetsFor([]))
              } else if (lostAt.current && Date.now() - lostAt.current > LOST_TO_FALLBACK_MS) {
                // ...then return to the default spot.
                lostAt.current = 0
                lastHeads.current = []
                apply(targetsFor([]))
              }
            }
          } else {
            failures += 1
            if (failures >= MAX_FAILURES) {
              // The camera keeps refusing stills (or Vision keeps failing): stop trying, keep
              // the overlay in its fallback spot instead of hammering the session.
              console.warn('Filter tracking stopped after repeated failures')
              lastHeads.current = []
              apply(targetsFor([]))
              break
            }
          }
        }
        const period = latest.current.recording ? SAMPLE_MS_RECORDING : SAMPLE_MS
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.max(80, period - (Date.now() - t0)) + (failures > 2 ? 1000 : 0))
      }
    })().catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, cameraRef, cameraReadyRef, holdRef])

  const vw = view?.width > 0 ? view.width : 360
  const yawing = filter === 'nametag' || filter === 'love'
  const rollDeg = (v) => v.interpolate({ inputRange: [-Math.PI, Math.PI], outputRange: ['180deg', '-180deg'] })

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {slots.current.slice(0, used).map((slot, i) => {
        // Slight perspective: tags left of center turn a little toward the middle, and vice versa.
        const is3D = i === 0 && filter === 'logo'
        const rotateY = yawing
          ? slot.x.interpolate({
            inputRange: [-OVERLAY_BOX / 2, vw - OVERLAY_BOX / 2],
            outputRange: ['16deg', '-16deg'],
            extrapolate: 'clamp',
          })
          : '0deg'
        // The 3D logo rolls itself in three.js; everything else is rolled here, about the
        // anchor (bottom-center), so it tilts with the head.
        const rotate = is3D ? '0deg' : rollDeg(slot.r)
        return (
          <Animated.View
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            style={[
              styles.slot,
              {
                opacity: slot.o,
                transform: [
                  { perspective: 600 },
                  { translateX: slot.x },
                  { translateY: slot.y },
                  { rotate },
                  { rotateY },
                  { scale: slot.s },
                ],
              },
            ]}
          >
            <FilterArt
              filter={filter}
              name={names[i] || '@iyiyi'}
              live
              use3D={is3D}
              registerPose={is3D ? slot.register : undefined}
              yawAnim={slot.yaw}
            />
          </Animated.View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  // Scale and roll pivot on the bottom-center, which is the point that sits above the head.
  slot: { position: 'absolute', left: 0, top: 0, width: OVERLAY_BOX, height: OVERLAY_BOX, transformOrigin: '50% 100%' },
})
