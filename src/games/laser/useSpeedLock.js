// Laser Tag speed lock (safety): above ~15 km/h for a few seconds — riding a bike, a scooter,
// in a car — firing and placing explosives are disabled and the HUD says "Moving too fast —
// stop to play". Same tracker as Battle Royale's transit lock (royale/useTransit.js:
// GPS speed, smoothed, poor fixes ignored, hysteresis), with a lower threshold because Laser
// Tag is played on foot in a small area. A short sprint doesn't trip it (sustained 5 s).
import { useEffect, useRef, useState } from 'react'
import { TransitTracker } from '../royale/useTransit'

export const SPEED_LOCK_ENTER_MPS = 15 / 3.6 // 15 km/h
export const SPEED_LOCK_ENTER_MS = 5000
export const SPEED_LOCK_EXIT_MPS = 9 / 3.6 // back under a jog
export const SPEED_LOCK_EXIT_MS = 5000
export const SPEED_LOCK_TEXT = 'Moving too fast — stop to play'

export function createSpeedLockTracker() {
  return new TransitTracker({ enterMps: SPEED_LOCK_ENTER_MPS, enterMs: SPEED_LOCK_ENTER_MS, exitMps: SPEED_LOCK_EXIT_MPS, exitMs: SPEED_LOCK_EXIT_MS })
}

/** coords: { lat, lng, acc?, speed?, at? } → { locked, kmh } */
export function useSpeedLock(coords, { enabled = true } = {}) {
  const tracker = useRef(null)
  if (!tracker.current) tracker.current = createSpeedLockTracker()
  const [snap, setSnap] = useState({ locked: false, kmh: 0 })
  const lastKey = useRef(null)
  const publish = () => {
    const t = tracker.current
    const kmh = Math.round(t.speed * 3.6)
    setSnap((s) => (s.locked === t.inTransit && s.kmh === kmh ? s : { locked: t.inTransit, kmh }))
  }
  const key = coords ? `${coords.lat},${coords.lng},${coords.at ?? ''}` : null
  useEffect(() => {
    if (!enabled || !coords || key === lastKey.current) return
    lastKey.current = key
    try { tracker.current.push(coords, Date.now()); publish() } catch { /* never break the game */ }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) {
      tracker.current.reset()
      setSnap({ locked: false, kmh: 0 })
      return undefined
    }
    const t = setInterval(() => {
      try { tracker.current.evaluate(Date.now()); publish() } catch { /* ignore */ }
    }, 1000)
    return () => clearInterval(t)
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return snap
}
