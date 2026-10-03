import React, { useEffect, useRef, useState } from 'react'
import { Animated, AppState, StyleSheet, View } from 'react-native'
import * as Location from 'expo-location'
import {
  addLiveFacesListener, detectBodies, detectFaces, isBodyHitAvailable, isFaceDetectAvailable,
  isLiveFacesAvailable, startLiveFaces, stopLiveFaces,
} from '../../../../modules/body-hit'
import {
  MAX_HEADS, OVERLAY_BOX, fallbackHead, headPose, headsFromBodies, headsFromFaces, landmarkDown, nameTagText, placeOverlay,
  selectTargets,
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

// Real-time tracking (newer binaries): the native module attaches a face-metadata output to
// the preview's own capture session, so face boxes arrive every camera frame (~30/s) with no
// photos taken. Then the overlay is placed straight from those boxes (it follows the face
// closely), and the slower Vision stills only supply head angles (yaw / pitch / roll) and are
// matched to the live faces by position.
//
export const visionAvailable = isBodyHitAvailable || isFaceDetectAvailable
// Face boxes are cheap: ~7 samples/s. Body pose (older binaries without detectFaces) ~3.7/s.
const SAMPLE_MS = isFaceDetectAvailable ? 135 : 270
const SAMPLE_MS_RECORDING = 500 // ~2/s while a video is recording
const POSE_SAMPLE_MS = 380 // with live tracking, stills are only for head angles
const LIVE_STALE_MS = 900 // no live event for this long -> live tracking counts as off
const LIVE_LOST_MS = 300 // live says no face for this long -> hold faded
const POSE_MAX_AGE_MS = 1500
const FOLLOW = 0.7 // per live frame: how far the overlay moves toward the face (0..1)
const FOLLOW_SCALE = 0.45
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
    ax: null, // last values set by the live (per-frame) path
    ay: null,
    as: null,
    lastRoll: null,
    lastYaw: null,
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
  const live = useRef({ lastEvent: 0, emptySince: 0, held: false, attached: false })
  const vision = useRef({ heads: [], at: 0 })
  // Live tracking is in charge while attached and either delivering frames or reporting
  // "no face" (it only sends that once, so there is no steady stream to time out on).
  const liveIsOn = () => {
    const L = live.current
    return L.attached && (Date.now() - L.lastEvent < LIVE_STALE_MS || !!L.emptySince)
  }
  const heading = useHeadingRef()
  const latest = useRef({})
  latest.current = { filter, facing, view, nearby, me, recording }

  const targetsFor = (heads) => {
    const { facing: fc, nearby: nb, me: m, view: v } = latest.current
    const t = selectTargets({ heads, facing: fc, nearby: nb, me: m, myPos: coordsRef?.current, headingDeg: heading.current })
    if (t.length) return t
    return [{ ...fallbackHead(v, fc), pose: null, name: nameTagText({ facing: fc, headCount: 0, nearby: nb, me: m }), key: 'fallback' }]
  }

  const apply = (targets, instant = false, fast = false) => {
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
          if (!samePerson) { slot.pose = null; slot.baseDown = null; slot.rawPose = null }
          const size = samePerson && slot.size > 0 ? slot.size * (1 - SIZE_SMOOTH) + t.size * SIZE_SMOOTH : t.size
          // No angles this frame: hold. The same Vision sample reused across live frames is
          // only folded in once (the pitch baseline must not speed up with the frame rate).
          let pose = slot.pose
          if (t.pose && t.pose !== slot.rawPose) { slot.rawPose = t.pose; pose = stablePose(slot, t.pose) }
          const placed = placeOverlay(f, { ...t, size, pose }, TOP_LIMIT)
          const s = placed.s
          const ax = placed.anchorX - OVERLAY_BOX / 2
          const ay = placed.anchorY - OVERLAY_BOX // box bottom sits on the anchor (transformOrigin bottom)
          if (t.key !== 'fallback' && pose !== slot.sentPose) { slot.sentPose = pose; sendPose(slot, pose) }
          if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(s)) return
          const roll = Number.isFinite(pose?.roll) ? pose.roll : 0
          const yaw = Number.isFinite(pose?.yaw) ? pose.yaw : 0
          if (!slot.shown || instant) {
            slot.x.setValue(ax)
            slot.y.setValue(ay)
            slot.s.setValue(s)
            slot.r.setValue(roll)
            slot.yaw.setValue(yaw)
            slot.ax = ax; slot.ay = ay; slot.as = s; slot.lastRoll = roll; slot.lastYaw = yaw
          } else if (fast && samePerson && slot.ax != null) {
            // Live frames (~30/s): move most of the way to the face every frame - follows
            // closely, with just enough smoothing to hide box jitter.
            slot.ax += (ax - slot.ax) * FOLLOW
            slot.ay += (ay - slot.ay) * FOLLOW
            slot.as += (s - slot.as) * FOLLOW_SCALE
            slot.x.stopAnimation(); slot.y.stopAnimation(); slot.s.stopAnimation()
            slot.x.setValue(slot.ax)
            slot.y.setValue(slot.ay)
            slot.s.setValue(slot.as)
            if (roll !== slot.lastRoll) { slot.lastRoll = roll; Animated.spring(slot.r, { ...SPRING_FINE, toValue: roll }).start() }
            if (yaw !== slot.lastYaw) { slot.lastYaw = yaw; Animated.spring(slot.yaw, { ...SPRING_FINE, toValue: yaw }).start() }
          } else {
            slot.ax = ax; slot.ay = ay; slot.as = s; slot.lastRoll = roll; slot.lastYaw = yaw
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
          const targetO = t.lost ? LOST_OPACITY : 1
          if (!fast || slot.targetO !== targetO || !slot.shown) {
            slot.targetO = targetO
            Animated.timing(slot.o, { toValue: targetO, duration: 260, useNativeDriver: true }).start()
          }
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
          slot.sentPose = null
          slot.rawPose = null
          slot.targetO = 0
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

  // Video branding: while recording, the primary overlay's spot is sampled ~30 times a second
  // so the same filter can be burned into the saved video along the same path.
  const namesRef = useRef(names)
  namesRef.current = names
  const track = useRef(null)
  const stopTrack = () => {
    const tr = track.current
    track.current = null
    if (!tr) return null
    clearInterval(tr.timer)
    return {
      keys: tr.keys,
      stopT: (Date.now() - tr.start) / 1000,
      filter: latest.current.filter,
      facing: tr.facing,
      name: namesRef.current?.[0] || '@iyiyi',
      view: tr.view,
    }
  }
  const startTrack = () => {
    stopTrack()
    const start = Date.now()
    const keys = []
    const sampleNow = () => {
      try {
        const sl = slots.current[0]
        const t = (Date.now() - start) / 1000
        const ok = sl.shown && Number.isFinite(sl.ax) && Number.isFinite(sl.ay) && Number.isFinite(sl.as)
        const o = ok ? (Number.isFinite(sl.targetO) ? sl.targetO : 1) : 0
        keys.push([t, ok ? sl.ax : 0, ok ? sl.ay : 0, ok ? sl.as : 1, Number.isFinite(sl.lastRoll) ? sl.lastRoll : 0, o])
        if (keys.length > 30 * 60 * 3) stopTrack() // 3 minutes is plenty
      } catch {}
    }
    sampleNow()
    track.current = { start, keys, facing: latest.current.facing, view: latest.current.view, timer: setInterval(sampleNow, 33) }
  }
  useEffect(() => () => { if (track.current) clearInterval(track.current.timer) }, [])

  useEffect(() => {
    if (!controlRef) return undefined
    controlRef.current = {
      waitIdle: () => inflight.current || Promise.resolve(),
      getHeading: () => heading.current,
      startTrack,
      stopTrack,
    }
    return () => { controlRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRef, heading])

  // Live (per-frame) tracking.
  useEffect(() => {
    // Takes no photos, so it keeps running through bursts and recordings (`paused` only
    // stops the stills).
    if (!isLiveFacesAvailable) return undefined
    let alive = true
    const posesFor = (heads) => {
      const v = vision.current
      if (!v.heads.length || Date.now() - v.at > POSE_MAX_AGE_MS) return heads
      return heads.map((h) => {
        let best = null
        let bestD = Infinity
        for (const vh of v.heads) {
          const d = Math.hypot((vh.fcx ?? vh.cx) - h.fcx, (vh.fcy ?? vh.top) - h.fcy)
          if (d < bestD) { bestD = d; best = vh }
        }
        return best && bestD < Math.max(60, h.size) ? { ...h, pose: best.pose || null } : h
      })
    }
    const sub = addLiveFacesListener((e) => {
      try {
        if (!alive) return
        const v = latest.current.view
        const lw = Number(e?.layerW)
        const lh = Number(e?.layerH)
        if (!v || !(v.width > 0) || !(lw > 0) || !(lh > 0)) return
        const now = Date.now()
        live.current.lastEvent = now
        const sx = v.width / lw
        const sy = v.height / lh
        const faces = Array.isArray(e.faces) ? e.faces : []
        if (!faces.length) {
          if (!live.current.emptySince) live.current.emptySince = now
          return
        }
        live.current.emptySince = 0
        live.current.held = false
        live.current.fellBack = false
        lostAt.current = 0
        misses.current = 0
        const heads = faces.map((f) => {
          const x = f.x * sx
          const y = f.y * sy
          const w = f.w * sx
          const h = f.h * sy
          // Android sends eye / nose points with every frame: head angles come live too.
          let pose = null
          if (f.landmarks) {
            const toScreen = (px, py) => ({ x: px * sx, y: py * sy })
            const p = headPose(f.landmarks, toScreen)
            if (p) pose = { ...p, down: landmarkDown(f.landmarks, toScreen) }
          }
          return {
            cx: x + w / 2, top: y - h * 0.35, size: w * 1.15, fcx: x + w / 2, fcy: y + h / 2,
            nx: (f.x + f.w / 2) / lw, pxPerNorm: null, pose,
          }
        }).filter((h) => Number.isFinite(h.cx) && Number.isFinite(h.top) && h.size > 6)
        if (!heads.length) return
        if (heads.some((h) => h.pose)) live.current.posed = now
        lastHeads.current = heads
        apply(targetsFor(heads.some((h) => h.pose) ? heads : posesFor(heads)), false, true)
      } catch {
        // skip this frame
      }
    })
    // Face lost: hold faded, then back to the default spot (same as the stills path).
    const lostTimer = setInterval(() => {
      const L = live.current
      if (!L.attached || !L.emptySince) return
      const gone = Date.now() - L.emptySince
      if (!L.held && gone > LIVE_LOST_MS) {
        L.held = true
        const held = slots.current.filter((sl) => sl.shown && sl.last && sl.key !== 'fallback').map((sl) => ({ ...sl.last, lost: true }))
        apply(held.length ? held : targetsFor([]))
      } else if (L.held && !L.fellBack && gone > LOST_TO_FALLBACK_MS) {
        L.fellBack = true
        lastHeads.current = []
        apply(targetsFor([]))
      }
    }, 150)
    // Attach (and re-attach if the camera rebuilt its session, e.g. after a flip or mode change).
    const attach = () => {
      if (!alive) return
      startLiveFaces()
        .then((ok) => {
          if (!alive) return
          live.current.attached = !!ok
          if (!ok) { live.current.emptySince = 0; live.current.lastEvent = 0 }
        })
        .catch(() => { live.current.attached = false })
    }
    live.current = { lastEvent: 0, emptySince: 0, held: false, attached: false }
    // Give expo-camera time to finish flipping / starting the session before attaching.
    const first = setTimeout(attach, 1500)
    const watchdog = setInterval(() => {
      if (Date.now() - live.current.lastEvent > 1500) attach()
    }, 1500)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(watchdog)
      clearInterval(lostTimer)
      try { sub.remove() } catch {}
      live.current = { lastEvent: 0, emptySince: 0, held: false, attached: false }
      stopLiveFaces().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  useEffect(() => {
    if (paused || !visionAvailable) return undefined
    let alive = true
    let failures = 0
    ;(async () => {
      await sleep(400) // let the preview settle (and a just-taken photo finish)
      while (alive) {
        const t0 = Date.now()
        const cam = cameraRef?.current
        // Live tracking already brings head angles (Android): no stills needed at all.
        const livePosed = liveIsOn() && Date.now() - (live.current.posed || 0) < 2000
        if (!livePosed && cam && cameraReadyRef?.current && !holdRef?.current && AppState.currentState === 'active') {
          const { view: v0, facing: f0 } = latest.current
          const p = sampleOnce(cam, v0, f0 === 'front')
          inflight.current = p
          // eslint-disable-next-line no-await-in-loop
          const heads = await p
          if (inflight.current === p) inflight.current = null
          if (!alive) break
          if (heads && liveIsOn()) {
            // Live tracking places the overlay; this still only refreshes head angles.
            failures = 0
            vision.current = { heads, at: Date.now() }
          } else if (heads) {
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
        const liveNow = liveIsOn()
        const period = latest.current.recording ? (liveNow ? 900 : SAMPLE_MS_RECORDING) : liveNow ? POSE_SAMPLE_MS : SAMPLE_MS
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
        // The photoreal render (art/iy-logo-render.png) is the live emblem too; the three.js
        // version (Logo3D) is kept but switched off.
        const is3D = false
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
