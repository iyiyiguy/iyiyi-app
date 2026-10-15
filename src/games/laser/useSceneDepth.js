// Surface scanner for Laser Tag: detects walls, buildings and objects used as cover in the
// camera view, so a rocket that hits a wall explodes at the wall (laser/sceneDepth.js has the
// maths; modules/body-hit runs the depth model).
//
//   const depth = useSceneDepth({ active, scanning, fast, vision, getAim })
//   depth.surface(aim)   what the crosshair is on (fresh, confident scans only) or null
//   depth.status         native model status ({ state, bundled, ... }) or null
//
// The model ships inside the app (fetched + verified at build time, see modules/body-hit), so it
// is ready at once, offline, with no UI at all. Only a binary built without it falls back to a
// silent one-time background download (Wi-Fi only for the first sessions). Until it is ready,
// or on systems without it (iOS < 17), surface() is always null and the game keeps its old rules. Scans never block a shot: a frame is taken
// every ~1 s (rocket launcher) / ~2 s (other guns) while aiming with the camera, off the main
// thread, and the newest one is used only while the phone still points about the same way.
//   Android: the on-screen preview (no photo).  iOS: a low-quality photo through
//   vision.capture() (shared with the still-frame person detection, see setFrameTap).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { depthModelStatus, estimateDepth, isDepthAvailable, prepareDepthModel } from '../../../modules/body-hit'
import { analyzeScan, surfaceNow } from './sceneDepth'
import { setFrameTap } from './vision'

export const depthAvailable = isDepthAvailable

const CELLULAR_AFTER = 3 // fallback download only: Laser Tag sessions waiting for Wi-Fi before it may use cellular
const FAST_MS = 1000
const SLOW_MS = 2200
const STUCK_MS = 6000
const POLL_MS = 1500
const RETRY_MS = 60000

export function useSceneDepth({ active = true, scanning = false, fast = false, vision = null, getAim = null } = {}) {
  const [status, setStatus] = useState(null)
  const scanRef = useRef(null)
  const getAimRef = useRef(getAim)
  getAimRef.current = getAim
  const visionRef = useRef(vision)
  visionRef.current = vision

  // Get the model ready when Laser Tag opens (bundled: loads it; otherwise starts / resumes the
  // silent fallback download and follows it until it is ready).
  useEffect(() => {
    if (!active || !isDepthAvailable) return undefined
    let cancelled = false
    let timer = null
    let lastPrepare = 0
    const apply = (s) => {
      if (cancelled || !s) return
      setStatus((prev) => (prev && prev.state === s.state && Math.round((prev.progress || 0) * 100) === Math.round((s.progress || 0) * 100) ? prev : s))
    }
    const tick = async () => {
      if (cancelled) return
      let s = null
      try {
        const now = Date.now()
        const prev = await depthModelStatus()
        // Waiting for Wi-Fi / a failed attempt: try again now and then while the game is open.
        if (!prev || ((prev.state === 'waiting-wifi' || prev.state === 'failed' || prev.state === 'idle') && now - lastPrepare >= RETRY_MS)) {
          lastPrepare = now
          s = await prepareDepthModel(CELLULAR_AFTER)
        } else {
          s = prev
        }
      } catch {
        s = null
      }
      apply(s)
      if (cancelled || s?.state === 'ready' || s?.state === 'unsupported') return
      timer = setTimeout(tick, s?.state === 'downloading' || s?.state === 'compiling' ? POLL_MS : POLL_MS * 4)
    }
    lastPrepare = Date.now()
    prepareDepthModel(CELLULAR_AFTER).then((s) => { apply(s); timer = setTimeout(tick, POLL_MS) }).catch(() => {})
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active])

  const ready = status?.state === 'ready'

  // Scanning while aiming with the camera.
  useEffect(() => {
    if (!scanning || !ready || !isDepthAvailable) return undefined
    let cancelled = false
    let inflightAt = 0
    let lastAt = 0
    const cadence = fast ? FAST_MS : SLOW_MS
    const aimNow = () => {
      try {
        const a = getAimRef.current?.()
        return { pitch: Number(a?.pitch), heading: Number(a?.heading) }
      } catch {
        return { pitch: NaN, heading: NaN }
      }
    }
    const store = (grid, aim, at) => {
      if (cancelled || !grid || !Number.isFinite(aim.pitch) || !Number.isFinite(aim.heading)) return
      scanRef.current = { grid, pitch: aim.pitch, heading: aim.heading, at, analysis: analyzeScan(grid, aim.pitch) }
    }
    const run = (promise, aim, at) => {
      inflightAt = Date.now()
      Promise.resolve(promise)
        .then((grid) => store(grid, aim, at))
        .catch(() => {})
        .finally(() => { inflightAt = 0 })
    }
    const due = () => Date.now() - lastAt >= cadence && (!inflightAt || Date.now() - inflightAt > STUCK_MS)
    // Still frames the person detection takes anyway (and the ones requested below on iOS).
    setFrameTap({
      wants: () => !cancelled && due(),
      take: (uri) => {
        if (cancelled || !due()) { estimateDepth(uri, true).catch(() => {}); return } // just deletes it
        lastAt = Date.now()
        run(estimateDepth(uri, true), aimNow(), Date.now())
      },
    })
    let photos = Platform.OS !== 'android' // Android copies the on-screen preview instead
    let requestedAt = 0
    let misses = 0
    const t = setInterval(() => {
      if (cancelled || !due()) return
      const v = visionRef.current
      if (!photos) {
        lastAt = Date.now()
        const aim = aimNow()
        const at = Date.now()
        inflightAt = at
        estimateDepth(null, false)
          .then((grid) => {
            if (grid) { misses = 0; store(grid, aim, at); return }
            // No preview to copy (e.g. the selfie camera view): photos from now on.
            misses += 1
            if (misses >= 3) photos = true
          })
          .catch(() => {})
          .finally(() => { inflightAt = 0 })
        return
      }
      // A photo through the shared capture path (the frame tap above gets it).
      if (!v || v.busy() || Date.now() - requestedAt < 800) return
      requestedAt = Date.now()
      v.capture().catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      clearInterval(t)
      setFrameTap(null)
    }
  }, [scanning, ready, fast])

  const surface = useCallback((aim) => {
    try {
      return surfaceNow(scanRef.current, { now: Date.now(), pitchDeg: aim?.pitch, headingDeg: aim?.heading })
    } catch {
      return null
    }
  }, [])

  return { status, ready, surface }
}
