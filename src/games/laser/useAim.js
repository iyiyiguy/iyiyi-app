// Aim direction + hold style for Laser Tag.
//
// Heading: expo-location's watchHeadingAsync (CLLocationManager on iOS),
// trueHeading with magHeading as fallback. Core Location reports heading for
// the device's portrait orientation and compensates for tilt: with the phone
// lying flat it is the direction the TOP EDGE points; when the phone is raised
// upright (screen facing you) it is the direction the BACK CAMERA faces. Those
// are exactly the two ways of aiming here, so no extra correction is needed on
// iOS. On Android the reported azimuth is for the top edge only and becomes
// unreliable when upright, so Android computes the heading of the aiming axis itself
// from the raw magnetometer + accelerometer (TRIAD: east = m × g, north = g × east),
// which works at any tilt: the back camera's axis when upright, the top edge otherwise.
// True north = magnetic + the declination expo-location reports.
//
// The raw heading jitters by a few degrees, so it's smoothed with a circular
// low-pass filter (exponential average of the unit vector, so 359°→1° doesn't
// swing through 180°).
//
// Hold style from the accelerometer (gravity ≈ 1g along one axis):
//   flat (|z| high)               → 'top'     point the top edge, tap anywhere
//   landscape upright (|x| high)  → 'top'     the top edge points sideways at the
//                                             target; iOS heading follows the y axis,
//                                             which is horizontal here, so it's correct
//   portrait upright (|y| high)   → 'trigger' camera aim, the whole screen is the
//                                             trigger (tap = one shot, hold = auto fire)
// 'camera' (classic crosshair + FIRE button) is available as a manual override.
// A new hold must be seen on 2 consecutive samples before switching, so it doesn't flap.
import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import * as Location from 'expo-location'
import { Accelerometer, Magnetometer } from 'expo-sensors'

const SMOOTH = 0.25 // weight of each new sample
const STRONG = 0.75 // |axis| above this → gravity is mostly along that axis
const STABLE_SAMPLES = 2

export const AIM_MODE_LABELS = {
  trigger: 'AIM · tap screen to fire, hold for auto',
  top: 'HIP FIRE · point the top edge, tap anywhere',
  camera: 'AIM · FIRE button',
}
// One-line coaching shown at the start of a match.
export const AIM_MODE_TIPS = {
  trigger: 'Hold upright to AIM with the camera · tap the screen to fire, hold for auto · hold the phone flat for HIP FIRE',
  top: 'HIP FIRE: point the TOP EDGE of the phone at a player and tap · hold the phone upright to aim with the camera',
  camera: 'Put the crosshair on a player and press FIRE · hold the phone flat for HIP FIRE',
}

function holdFrom({ x, y, z }) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (az > STRONG) return 'flat'
  if (ax > STRONG && ax > ay) return 'landscape'
  if (ay > STRONG && ay > ax) return 'portrait'
  return null // in between: keep the current hold
}

const ANDROID_TRIAD = Platform.OS === 'android'

export function useAim({ enabled = true, override = 'auto' } = {}) {
  const [heading, setHeading] = useState(null) // { deg, accuracy }
  const [hold, setHold] = useState('portrait') // portrait | landscape | flat
  const holdRef = useRef('portrait')
  holdRef.current = hold
  const vec = useRef(null)
  const lastEmit = useRef(0)
  const lastDeg = useRef(null)
  const declination = useRef(0) // true − magnetic, from expo-location (Android TRIAD path)
  const locAccuracy = useRef(null)

  // Feed one raw heading sample (degrees, true north) through the smoothing + throttle.
  const push = (raw, accuracy) => {
    if (!Number.isFinite(raw)) return
    const r = (raw * Math.PI) / 180
    const v = vec.current
    vec.current = v
      ? { x: v.x + SMOOTH * (Math.sin(r) - v.x), y: v.y + SMOOTH * (Math.cos(r) - v.y) }
      : { x: Math.sin(r), y: Math.cos(r) }
    const t = Date.now()
    if (t - lastEmit.current < 90) return // ~11 fps is plenty for UI
    const deg = ((Math.atan2(vec.current.x, vec.current.y) * 180) / Math.PI + 360) % 360
    // Skip sub-degree jitter: every heading update re-renders the HUD.
    const prev = lastDeg.current
    if (prev && Math.abs(((deg - prev.deg + 540) % 360) - 180) < 0.8 && prev.accuracy === accuracy) return
    lastEmit.current = t
    lastDeg.current = { deg, accuracy }
    setHeading({ deg, accuracy })
  }

  useEffect(() => {
    if (!enabled) return undefined
    let sub = null
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (perm.status !== 'granted' || cancelled) return
        sub = await Location.watchHeadingAsync((h) => {
          locAccuracy.current = h.accuracy
          if (ANDROID_TRIAD) {
            // Only the declination is used from here; the heading itself comes from TRIAD.
            if (h.trueHeading >= 0 && h.magHeading >= 0) declination.current = ((h.trueHeading - h.magHeading + 540) % 360) - 180
            return
          }
          const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          if (!Number.isFinite(raw) || raw < 0) return
          push(raw, h.accuracy)
        })
        if (cancelled) sub?.remove()
      } catch (e) {
        console.warn('heading watch failed', e?.message ?? e)
      }
    })()
    return () => { cancelled = true; sub?.remove() }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Android: heading of the aiming axis from the magnetometer + accelerometer.
  useEffect(() => {
    if (!enabled || !ANDROID_TRIAD) return undefined
    let g = null
    let m = null
    let magSub = null
    let accSub = null
    const compute = () => {
      if (!g || !m) return
      // East = m × g, North = g × East (device frame, right-handed).
      const ex = m.y * g.z - m.z * g.y
      const ey = m.z * g.x - m.x * g.z
      const ez = m.x * g.y - m.y * g.x
      const en = Math.hypot(ex, ey, ez)
      if (!(en > 1e-6)) return
      const e = { x: ex / en, y: ey / en, z: ez / en }
      const nx = g.y * e.z - g.z * e.y
      const ny = g.z * e.x - g.x * e.z
      const nz = g.x * e.y - g.y * e.x
      const nn = Math.hypot(nx, ny, nz)
      if (!(nn > 1e-6)) return
      const n = { x: nx / nn, y: ny / nn, z: nz / nn }
      // Aiming axis: the back camera (−Z) when upright in portrait, the top edge (+Y) otherwise.
      const c = holdRef.current === 'portrait' ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 }
      const east = c.x * e.x + c.y * e.y + c.z * e.z
      const north = c.x * n.x + c.y * n.y + c.z * n.z
      if (Math.hypot(east, north) < 0.25) return // axis nearly vertical: no meaningful heading
      const mag = (Math.atan2(east, north) * 180) / Math.PI
      push(((mag + declination.current) % 360 + 360) % 360, locAccuracy.current ?? 2)
    }
    try {
      Magnetometer.setUpdateInterval(60)
      magSub = Magnetometer.addListener((v) => { if (v && Number.isFinite(v.x)) { m = v; compute() } })
      accSub = Accelerometer.addListener((v) => { if (v && Number.isFinite(v.x)) g = v })
    } catch (e) {
      console.warn('magnetometer unavailable', e?.message ?? e)
    }
    return () => { magSub?.remove(); accSub?.remove() }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return undefined
    let sub = null
    let candidate = null
    let seen = 0
    try {
      Accelerometer.setUpdateInterval(200)
      sub = Accelerometer.addListener((a) => {
        const h = holdFrom(a || {})
        if (!h) return
        if (h !== candidate) { candidate = h; seen = 1 } else seen += 1
        if (seen >= STABLE_SAMPLES) setHold((cur) => (cur === h ? cur : h))
      })
    } catch {
      // No accelerometer: stay in portrait.
    }
    return () => sub?.remove()
  }, [enabled])

  // Upright in portrait = camera aim with the screen as the trigger; otherwise point the top edge.
  const auto = hold === 'portrait' ? 'trigger' : 'top'
  const mode = override === 'camera' || override === 'top' || override === 'trigger' ? override : auto
  return { heading, mode, hold, autoDetected: override === 'auto' || !override }
}
