import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { Accelerometer } from 'expo-sensors'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'iyiyi_flip_to_camera'

// --- preference -----------------------------------------------------------------------------
// On by default: only an explicit 'off' turns it off. Everyone using the hook is told when it
// changes (Settings toggles it), so the gesture starts/stops right away without a relaunch.
let cachedPref = null
const listeners = new Set()

export async function loadFlipPref() {
  try {
    cachedPref = (await AsyncStorage.getItem(KEY)) !== 'off'
  } catch {
    cachedPref = true
  }
  return cachedPref
}

export async function saveFlipPref(on) {
  cachedPref = !!on
  listeners.forEach((l) => {
    try { l(cachedPref) } catch {}
  })
  try {
    await AsyncStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Preference just won't persist; not worth interrupting anyone over.
  }
}

// Subscribe to preference changes. Returns an unsubscribe function.
export function subscribeFlipPref(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The live preference (true until loaded, since it's on by default).
export function useFlipPref() {
  const [on, setOn] = useState(cachedPref ?? true)
  useEffect(() => {
    let alive = true
    loadFlipPref().then((v) => { if (alive) setOn(v) })
    const unsub = subscribeFlipPref((v) => { if (alive) setOn(v) })
    return () => { alive = false; unsub() }
  }, [])
  return on
}

// --- gesture --------------------------------------------------------------------------------
// "screenUp" is how much the screen faces the sky: +1 lying face up, 0 held upright, -1 face
// down. iOS reports z = -1 for a face-up phone and Android z = +1, so the sign is normalised here.
const SAMPLE_MS = 50
const SMOOTHING = 0.45 // low-pass factor (higher = follows the sensor faster)
const DOWN_AT = -0.6 // screen clearly facing the ground (within ~50° of straight down)
const UP_AT = -0.1 // screen no longer facing the ground: upright in the hand, tilted toward the user, or face up
const NEUTRAL_AT = -0.2 // "screen visible": anything that isn't tipped toward the ground
const CONFIRM_SAMPLES = 2 // consecutive samples needed to accept a state (debounce)
const MAX_DOWN_MS = 2200 // face-down -> back up must happen within this
const MAX_TURN_MS = 1500 // and the turn over itself must be quick (not a phone resting face down)
const COOLDOWN_MS = 3000
const WARMUP_MS = 800 // ignore the first moments after (re)starting, while the filter settles

// Turn the phone face down and back up again within a couple of seconds and onFlip fires.
// Only runs while the app is in the foreground: iOS and Android don't let a suspended app read
// motion sensors, so the gesture can't launch the app from the background.
// API kept as useFlipToCamera(onFlip, enabled).
export function useFlipToCamera(onFlip, enabled) {
  const onFlipRef = useRef(onFlip)
  onFlipRef.current = onFlip
  const pref = useFlipPref()
  const active = !!enabled && pref !== false

  useEffect(() => {
    if (!active || Platform.OS === 'web') return undefined
    let cancelled = false
    let sub = null
    let available = null // null = not checked yet

    // state machine
    let filtered = null
    let startedAt = 0
    let lastVisibleAt = 0 // last time the screen faced the user/sky
    let downAt = 0 // when the face-down state was confirmed (0 = not down)
    let downCount = 0
    let upCount = 0
    let lastTrigger = 0

    const reset = () => {
      filtered = null
      downAt = 0
      downCount = 0
      upCount = 0
      lastVisibleAt = 0
    }

    const onSample = (data) => {
      if (!data || typeof data.z !== 'number' || !Number.isFinite(data.z)) return
      const now = Date.now()
      const raw = Platform.OS === 'ios' ? -data.z : data.z
      const clamped = Math.max(-1.5, Math.min(1.5, raw))
      filtered = filtered == null ? clamped : filtered + SMOOTHING * (clamped - filtered)
      const s = filtered
      if (now - startedAt < WARMUP_MS) {
        if (s >= NEUTRAL_AT) lastVisibleAt = now
        return
      }
      if (now - lastTrigger < COOLDOWN_MS) {
        downAt = 0
        downCount = 0
        upCount = 0
        if (s >= NEUTRAL_AT) lastVisibleAt = now
        return
      }

      if (!downAt) {
        if (s >= NEUTRAL_AT) lastVisibleAt = now
        if (s <= DOWN_AT) {
          downCount += 1
          // Accept face-down only if the screen was visible a moment ago (a quick turn over),
          // so a phone that's been lying face down on a table doesn't count.
          if (downCount >= CONFIRM_SAMPLES && lastVisibleAt && now - lastVisibleAt <= MAX_TURN_MS) {
            downAt = now
            upCount = 0
          }
        } else {
          downCount = 0
        }
        return
      }

      // Currently face down: wait for it to come back up.
      if (now - downAt > MAX_DOWN_MS) {
        // Took too long - treat it as resting face down; needs a fresh turn.
        if (s > DOWN_AT) {
          downAt = 0
          downCount = 0
          upCount = 0
          lastVisibleAt = 0
        }
        return
      }
      if (s >= UP_AT) {
        upCount += 1
        if (upCount >= CONFIRM_SAMPLES) {
          downAt = 0
          downCount = 0
          upCount = 0
          lastTrigger = now
          lastVisibleAt = now
          try {
            onFlipRef.current?.()
          } catch (e) {
            console.warn('Flip-to-camera handler failed', e)
          }
        }
      } else {
        upCount = 0
      }
    }

    const ensureAvailable = async () => {
      if (available != null) return available
      try {
        const ok = await Accelerometer.isAvailableAsync()
        if (!ok) {
          available = false
          return false
        }
        try {
          const perm = await Accelerometer.getPermissionsAsync()
          if (perm && !perm.granted) {
            if (perm.canAskAgain !== false) {
              const req = await Accelerometer.requestPermissionsAsync()
              if (req && !req.granted) {
                available = false
                return false
              }
            } else if (perm.status === 'denied') {
              available = false
              return false
            }
          }
        } catch {
          // Permission API not implemented for this sensor/platform: the accelerometer
          // doesn't need one on iOS/Android, so carry on.
        }
        available = true
        return true
      } catch {
        available = false
        return false
      }
    }

    const start = async () => {
      if (sub || cancelled) return
      const ok = await ensureAvailable()
      if (!ok || cancelled || sub || AppState.currentState !== 'active') return
      try {
        reset()
        startedAt = Date.now()
        Accelerometer.setUpdateInterval(SAMPLE_MS)
        sub = Accelerometer.addListener(onSample)
      } catch {
        sub = null // no accelerometer on this device - the gesture just stays off
      }
    }
    const stop = () => {
      try { sub?.remove() } catch {}
      sub = null
      reset()
    }

    if (AppState.currentState === 'active') start()
    const appSub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()))
    return () => {
      cancelled = true
      try { appSub.remove() } catch {}
      stop()
    }
  }, [active])
}
