// Barometric altitude for Beside Them floors (see ./engine.js, "floors").
//
// One shared subscription for the whole app session (setup and game both use it, and the
// host's setup reference must survive the lobby -> game switch). Raw altitude:
//   iOS     – relativeAltitude (fused, metres since the subscription started)
//   Android – the barometric formula on the pressure (hPa)
// smoothed over the last 2 s. `calibrate(tag)` makes the current smoothed value zero;
// `read()` is the altitude relative to that reference.
//
// iOS restarts relativeAltitude at 0 on every new subscription: the reference is then
// re-based once from the pressure altitude, which every platform also reports.
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { Barometer } from 'expo-sensors'
import { pressureToAltitude } from './engine'

export const SETUP_TAG = 'setup' // the host's start-floor reference taken in the lobby
const WINDOW_MS = 2000
const UPDATE_MS = 200
const STOP_DELAY_MS = 90000 // keep listening a while after the last user leaves

const S = {
  users: 0,
  sub: null,
  starting: false,
  avail: null, // null = unknown, true / false
  epoch: 0,
  samples: [], // { t, rel, p }
  ref: null, // { rel, p, epoch, tag }
  stopTimer: null,
}

function onData(m) {
  const t = Date.now()
  const p = Number.isFinite(m?.pressure) && m.pressure > 300 && m.pressure < 1200 ? pressureToAltitude(m.pressure) : null
  const rel = Platform.OS === 'ios' && Number.isFinite(m?.relativeAltitude) ? m.relativeAltitude : null
  if (p === null && rel === null) return
  S.samples.push({ t, rel, p })
  while (S.samples.length && t - S.samples[0].t > WINDOW_MS) S.samples.shift()
  // First iOS sample of a new subscription: carry the reference over via pressure.
  if (S.ref && S.ref.epoch !== S.epoch && rel !== null) {
    S.ref = p !== null && S.ref.p !== null
      ? { ...S.ref, rel: rel - (p - S.ref.p), epoch: S.epoch }
      : { ...S.ref, rel: null, epoch: S.epoch }
  }
}

function mean() {
  const t = Date.now()
  let nr = 0; let sr = 0; let np = 0; let sp = 0
  for (const s of S.samples) {
    if (t - s.t > WINDOW_MS * 2) continue // sensor went quiet: don't trust old samples
    if (s.rel !== null) { nr += 1; sr += s.rel }
    if (s.p !== null) { np += 1; sp += s.p }
  }
  if (!nr && !np) return null
  return { rel: nr ? sr / nr : null, p: np ? sp / np : null }
}

async function startSub() {
  if (S.sub || S.starting) return
  S.starting = true
  try {
    if (S.avail === null) S.avail = !!(await Barometer.isAvailableAsync())
    if (!S.avail || S.users <= 0 || S.sub) return
    try { Barometer.setUpdateInterval(UPDATE_MS) } catch { /* optional */ }
    S.epoch += 1
    S.samples = []
    S.sub = Barometer.addListener(onData)
  } catch {
    S.avail = false
  } finally {
    S.starting = false
  }
}

function stopSub() {
  try { S.sub?.remove() } catch { /* ignore */ }
  S.sub = null
  S.samples = []
}

export function acquireBaro() {
  S.users += 1
  clearTimeout(S.stopTimer)
  S.stopTimer = null
  startSub()
  return () => {
    S.users = Math.max(0, S.users - 1)
    if (S.users === 0) {
      clearTimeout(S.stopTimer)
      S.stopTimer = setTimeout(() => { if (S.users === 0) stopSub() }, STOP_DELAY_MS)
    }
  }
}

/** 'checking' | 'none' (no barometer) | 'warming' (no samples yet) | 'ready' */
export function baroStatus() {
  if (S.avail === false) return 'none'
  if (S.avail === null) return 'checking'
  return mean() ? 'ready' : 'warming'
}

/** Altitude (m) vs the reference, or null (no barometer, no reference, no samples). */
export function readAlt() {
  const m = mean()
  const r = S.ref
  if (!m || !r) return null
  if (r.rel !== null && m.rel !== null && r.epoch === S.epoch) return m.rel - r.rel
  if (r.p !== null && m.p !== null) return m.p - r.p
  return null
}

export const refTag = () => S.ref?.tag ?? null
/** The reference as a pressure altitude (m), to save and restore after an app restart. */
export const refPressureAlt = () => (Number.isFinite(S.ref?.p) ? Math.round(S.ref.p * 100) / 100 : null)
/** Bring back a saved reference (see refPressureAlt). iOS re-bases it on the next sample. */
export function restoreRef(p, tag) {
  if (!Number.isFinite(p)) return false
  S.ref = { rel: null, p, epoch: -1, tag: tag ?? null }
  return true
}

/**
 * Take the reference here. Returns the altitude vs the previous reference (so callers can
 * shift values recorded against it), or null; `false` when there is nothing to sample yet.
 */
export function calibrate(tag) {
  const m = mean()
  if (!m) return false
  const prev = readAlt()
  S.ref = { rel: m.rel, p: m.p, epoch: S.epoch, tag: tag ?? null }
  return prev
}

/** Live barometer snapshot, refreshed every `everyMs` while `enabled`. */
export function useBaro(enabled = true, everyMs = 500) {
  const [snap, setSnap] = useState(() => ({ status: baroStatus(), alt: readAlt(), tag: refTag() }))
  useEffect(() => {
    if (!enabled) return undefined
    const release = acquireBaro()
    const read = () => setSnap((cur) => {
      const next = { status: baroStatus(), alt: readAlt(), tag: refTag() }
      const same = cur.status === next.status && cur.tag === next.tag && (cur.alt === next.alt || (cur.alt !== null && next.alt !== null && Math.abs(cur.alt - next.alt) < 0.05))
      return same ? cur : next
    })
    read()
    const t = setInterval(read, everyMs)
    return () => { clearInterval(t); release() }
  }, [enabled, everyMs])
  return snap
}
