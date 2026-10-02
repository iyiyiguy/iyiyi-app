// Aim direction + hold style for Laser Tag.
//
// Heading: expo-location's watchHeadingAsync (CLLocationManager on iOS),
// trueHeading with magHeading as fallback. Core Location reports heading for
// the device's portrait orientation and compensates for tilt: with the phone
// lying flat it is the direction the TOP EDGE points; when the phone is raised
// upright (screen facing you) it is the direction the BACK CAMERA faces. Those
// are exactly the two ways of aiming here, so no extra correction is needed on
// iOS. On Android the reported azimuth is for the top edge only and becomes
// unreliable when upright, so on Android auto mode always uses "top" aiming.
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
import { Accelerometer } from 'expo-sensors'

const SMOOTH = 0.25 // weight of each new sample
const STRONG = 0.75 // |axis| above this → gravity is mostly along that axis
const STABLE_SAMPLES = 2

export const AIM_MODE_LABELS = {
  trigger: 'Trigger · tap to fire, hold for auto',
  top: 'Top-edge aim · tap anywhere',
  camera: 'Camera aim · FIRE button',
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

export function useAim({ enabled = true, override = 'auto' } = {}) {
  const [heading, setHeading] = useState(null) // { deg, accuracy }
  const [hold, setHold] = useState('portrait') // portrait | landscape | flat
  const vec = useRef(null)
  const lastEmit = useRef(0)
  const lastDeg = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    let sub = null
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (perm.status !== 'granted' || cancelled) return
        sub = await Location.watchHeadingAsync((h) => {
          const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          if (!Number.isFinite(raw) || raw < 0) return
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
          if (prev && Math.abs(((deg - prev.deg + 540) % 360) - 180) < 0.8 && prev.accuracy === h.accuracy) return
          lastEmit.current = t
          lastDeg.current = { deg, accuracy: h.accuracy }
          setHeading({ deg, accuracy: h.accuracy })
        })
        if (cancelled) sub?.remove()
      } catch (e) {
        console.warn('heading watch failed', e?.message ?? e)
      }
    })()
    return () => { cancelled = true; sub?.remove() }
  }, [enabled])

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

  // Android's heading is only reliable for the top edge, so its auto mode never uses the camera.
  const auto = Platform.OS === 'ios' ? (hold === 'portrait' ? 'trigger' : 'top') : 'top'
  const mode = override === 'camera' || override === 'top' || override === 'trigger' ? override : auto
  return { heading, mode, hold, autoDetected: override === 'auto' || !override }
}
