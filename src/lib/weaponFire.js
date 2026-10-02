// Trigger handling shared by every arcade shooter.
//
//   const trigger = useTrigger(weapon, (weapon) => { ...fire one pull... }, { enabled })
//   <Pressable onPressIn={trigger.onPressIn} onPressOut={trigger.onPressOut} />
//
// Rules (see guns.js):
//   • Semi-auto / burst: onShot runs once per press — no rate cap, every tap fires.
//   • Automatic: onShot runs on press, then repeatedly while held at autoFireRate(weapon):
//     1.5× the player's tap rate (measured from their recent semi-auto taps, ~6/s if
//     unknown), clamped to 6–12 shots/s and scaled per weapon (autoRateScale). A weapon
//     with fixedAutoRate (e.g. the railgun) fires at exactly that rate instead.
// The hold timer stops on release, when `enabled` turns false, when the weapon changes
// and on unmount, so a held trigger can never keep firing behind a menu.
import { useEffect, useMemo, useRef } from 'react'

const isAuto = (w) => w?.fireMode === 'automatic'

export const TAP_BASELINE_RATE = 6 // shots/s of fast tapping when we haven't measured it
export const AUTO_TAP_MULTIPLIER = 1.5
export const AUTO_MIN_RATE = 6
export const AUTO_MAX_RATE = 12

// Recent semi-auto trigger presses (module-wide, shared by every shooter screen).
const taps = []
const TAP_WINDOW_MS = 30000
const TAP_BURST_GAP_MS = 450 // gaps longer than this aren't "fast tapping"

function noteTap(t) {
  taps.push(t)
  while (taps.length > 24 || (taps.length && t - taps[0] > TAP_WINDOW_MS)) taps.shift()
}

/** The player's measured fast-tap rate (shots/s), or null when there isn't enough data. */
export function measuredTapRate() {
  const gaps = []
  for (let i = 1; i < taps.length; i++) {
    const g = taps[i] - taps[i - 1]
    if (g > 40 && g <= TAP_BURST_GAP_MS) gaps.push(g)
  }
  if (gaps.length < 4) return null
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return 1000 / median
}

/** Shots per second while an automatic weapon is held. */
export function autoFireRate(w) {
  const fixed = Number(w?.fixedAutoRate)
  if (Number.isFinite(fixed) && fixed > 0) return Math.min(AUTO_MAX_RATE, fixed)
  const tap = measuredTapRate() || TAP_BASELINE_RATE
  const scale = Number.isFinite(Number(w?.autoRateScale)) && Number(w.autoRateScale) > 0 ? Number(w.autoRateScale) : 1
  return Math.max(AUTO_MIN_RATE, Math.min(AUTO_MAX_RATE, AUTO_TAP_MULTIPLIER * tap * scale))
}

const intervalFor = (w) => Math.max(70, Math.round(1000 / autoFireRate(w)))

export function useTrigger(weapon, onShot, { enabled = true } = {}) {
  const weaponRef = useRef(weapon)
  const shotRef = useRef(onShot)
  const enabledRef = useRef(enabled)
  const timer = useRef(null)
  const held = useRef(false)
  weaponRef.current = weapon
  shotRef.current = onShot
  enabledRef.current = enabled

  const trigger = useMemo(() => {
    const stop = () => {
      held.current = false
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }
    const fire = () => {
      if (!enabledRef.current) { stop(); return }
      try { shotRef.current?.(weaponRef.current) } catch (e) { console.warn('shot failed', e?.message ?? e) }
    }
    return {
      onPressIn: () => {
        if (!enabledRef.current) return
        stop()
        held.current = true
        fire()
        const w = weaponRef.current
        if (isAuto(w)) timer.current = setInterval(fire, intervalFor(w))
        else noteTap(Date.now())
      },
      onPressOut: stop,
      stop,
      isHeld: () => held.current,
    }
  }, [])

  // Weapon swap or trigger disabled (menu open, dead, round over): stop firing.
  useEffect(() => { trigger.stop() }, [weapon?.id, enabled, trigger])
  useEffect(() => () => trigger.stop(), [trigger])
  return trigger
}

export default useTrigger
