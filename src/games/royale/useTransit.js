// Vehicle "transit" detection — a safety rule for real-world shooters.
//
// Speed comes from GPS (coords.speed when the OS provides it, otherwise distance / time
// between fixes), smoothed with an exponential average and ignoring fixes with poor
// accuracy. Above ENTER speed for ENTER_MS the player is "in transit"; they leave transit
// only after staying below EXIT speed for EXIT_MS. While in transit a game must not let
// the player fire, and should exclude them from hit resolution.
//
//   const transit = useTransit(coords)        // coords: { lat, lng, acc?, speed?, at? }
//   transit.inTransit, transit.speedMps, transit.mph
//
// TransitTracker is the same logic without React (the host uses it as a cross-check on
// everyone's shared positions).
import { useEffect, useRef, useState } from 'react'
import { distanceMeters } from '../../lib/multiplayer'
import { TRANSIT_ENTER_MPS, TRANSIT_ENTER_MS, TRANSIT_EXIT_MPS, TRANSIT_EXIT_MS } from './constants'

const SMOOTH = 0.35 // weight of each new sample
const MAX_ACC_M = 35 // ignore fixes worse than this for speed
const MAX_PLAUSIBLE_MPS = 70 // ~155 mph: anything faster is a GPS jump
const MAX_GAP_MS = 20000

export class TransitTracker {
  constructor(opts = {}) {
    this.enterMps = opts.enterMps ?? TRANSIT_ENTER_MPS
    this.enterMs = opts.enterMs ?? TRANSIT_ENTER_MS
    this.exitMps = opts.exitMps ?? TRANSIT_EXIT_MPS
    this.exitMs = opts.exitMs ?? TRANSIT_EXIT_MS
    this.reset()
  }

  reset() {
    this.speed = 0
    this.inTransit = false
    this.fastSince = null
    this.slowSince = null
    this.last = null
  }

  /** Feed one GPS fix. Returns true if the transit state changed. */
  push(fix, now = Date.now()) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return this.evaluate(now)
    const at = Number.isFinite(fix.at) ? fix.at : now
    const acc = Number.isFinite(fix.acc) ? fix.acc : null
    let sample = null
    if (Number.isFinite(fix.speed) && fix.speed >= 0 && (acc == null || acc <= MAX_ACC_M)) {
      sample = fix.speed
    } else if (this.last && (acc == null || acc <= MAX_ACC_M)) {
      const dt = (at - this.last.at) / 1000
      if (dt >= 0.8 && dt * 1000 <= MAX_GAP_MS) {
        const d = distanceMeters(this.last, fix)
        if (Number.isFinite(d)) sample = d / dt
      }
    }
    if (acc == null || acc <= MAX_ACC_M) this.last = { lat: fix.lat, lng: fix.lng, at }
    if (sample != null && Number.isFinite(sample) && sample <= MAX_PLAUSIBLE_MPS) {
      this.speed = this.speed + SMOOTH * (sample - this.speed)
    }
    return this.evaluate(now)
  }

  /** Re-check the timers (call periodically even without new fixes). */
  evaluate(now = Date.now()) {
    const was = this.inTransit
    // No fix for a while: speed is unknown, decay it so a stopped car eventually exits.
    if (this.last && now - this.last.at > MAX_GAP_MS) this.speed *= 0.5
    if (this.speed >= this.enterMps) {
      if (this.fastSince == null) this.fastSince = now
      this.slowSince = null
      if (!this.inTransit && now - this.fastSince >= this.enterMs) this.inTransit = true
    } else {
      this.fastSince = null
      if (this.speed < this.exitMps) {
        if (this.slowSince == null) this.slowSince = now
        if (this.inTransit && now - this.slowSince >= this.exitMs) this.inTransit = false
      } else {
        this.slowSince = null
      }
    }
    return was !== this.inTransit
  }
}

const MPS_TO_MPH = 2.23694

export function useTransit(coords, { enabled = true } = {}) {
  const tracker = useRef(null)
  if (!tracker.current) tracker.current = new TransitTracker()
  const [snap, setSnap] = useState({ inTransit: false, speedMps: 0 })
  const lastKey = useRef(null)

  const publish = () => {
    const t = tracker.current
    const speedMps = Math.round(t.speed * 10) / 10
    setSnap((s) => (s.inTransit === t.inTransit && Math.abs(s.speedMps - speedMps) < 0.3 ? s : { inTransit: t.inTransit, speedMps }))
  }

  // New fix.
  const key = coords ? `${coords.lat},${coords.lng},${coords.at ?? ''}` : null
  useEffect(() => {
    if (!enabled || !coords || key === lastKey.current) return
    lastKey.current = key
    try {
      tracker.current.push(coords, Date.now())
      publish()
    } catch {
      // Never let speed tracking break the game.
    }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timers keep running between fixes.
  useEffect(() => {
    if (!enabled) {
      tracker.current.reset()
      setSnap({ inTransit: false, speedMps: 0 })
      return undefined
    }
    const t = setInterval(() => {
      try {
        tracker.current.evaluate(Date.now())
        publish()
      } catch { /* ignore */ }
    }, 1000)
    return () => clearInterval(t)
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...snap, mph: Math.round(snap.speedMps * MPS_TO_MPH) }
}

export default useTransit
