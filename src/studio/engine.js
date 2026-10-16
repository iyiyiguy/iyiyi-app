// iYiYi Studio audio engine: sample-accurate drum machine playback on react-native-audio-api
// (Web Audio API for iOS/Android; the browser's own Web Audio on web), plus an offline mixer
// that renders a project to PCM in plain JS for export (deterministic, no extra native code).
//
// Timing uses the classic look-ahead scheduler: a 25 ms JS timer queues every step that falls
// in the next 120 ms on the audio clock, so playback stays tight even when the JS thread is busy.
import { AudioContext, AudioManager } from 'react-native-audio-api'
import { Platform } from 'react-native'
import { Asset } from 'expo-asset'
import { KIT_BY_ID } from './kits'

export const NUM_PADS = 16
const LOOKAHEAD_S = 0.12
const TICK_MS = 25
// Pads in the same choke group cut each other off (a closed hat stops a ringing open hat).
// hats choke each other; the long 808 is mono (a new hit cuts the last one, like real 808s)
const CHOKE = { hat: 'hats', openhat: 'hats', bass: 'bass808' }

let ctx = null
let master = null
const cache = new Map() // source key -> AudioBuffer (decoded at the context's sample rate)

export function getContext() {
  if (!ctx) {
    // 'playback' plays with the silent switch on and follows the current output route
    // (Bluetooth speakers/headphones, AirPlay, wired, phone speaker).
    if (Platform.OS === 'ios') {
      try { AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] }) } catch {}
    }
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.85
    master.connect(ctx.destination)
  }
  return ctx
}

export async function resumeAudio() {
  const c = getContext()
  try { if (c.state === 'suspended') await c.resume() } catch {}
  return c
}

function srcKey(src) {
  if (!src) return null
  if (src.kind === 'kit') return `kit:${src.kit}:${src.pad}`
  return `uri:${src.uri}`
}

async function decodeAsset(mod) {
  const asset = Asset.fromModule(mod)
  if (!asset.localUri) {
    try { await asset.downloadAsync() } catch {}
  }
  return getContext().decodeAudioData(asset.localUri || asset.uri)
}

/** Decodes (once) and returns the AudioBuffer behind a pad source. */
export async function loadSource(src) {
  const key = srcKey(src)
  if (!key) return null
  if (cache.has(key)) return cache.get(key)
  let buf = null
  if (src.kind === 'kit') {
    const pad = KIT_BY_ID[src.kit]?.pads.find((p) => p.id === src.pad)
    if (pad) buf = await decodeAsset(pad.asset)
  } else if (src.uri) {
    buf = await getContext().decodeAudioData(src.uri)
  }
  if (buf) cache.set(key, buf)
  return buf
}

export function cachedBuffer(src) {
  return cache.get(srcKey(src)) || null
}

/** Loads every pad's sound in a project; failures leave that pad silent instead of throwing. */
export async function prepareProject(project) {
  await Promise.all(project.pads.map((p) => (p.src ? loadSource(p.src).catch(() => null) : null)))
}

// Start/length (seconds) of a pad's region inside its buffer (sampler slices use part of a file).
function region(pad, buf) {
  const start = Math.max(0, Math.min(buf.duration, pad.src?.start ?? 0))
  const end = pad.src?.end != null ? Math.min(buf.duration, pad.src.end) : buf.duration
  return { start, length: Math.max(0.005, end - start) }
}

const rate = (pad) => Math.pow(2, (pad.pitch || 0) / 12)
const audible = (project, i) => {
  const pad = project.pads[i]
  if (!pad?.src || pad.mute) return false
  const anySolo = project.pads.some((p) => p.solo)
  return !anySolo || pad.solo
}

// ---- live playback ------------------------------------------------------------------------
const ringing = new Map() // choke group -> source node

/** Plays one pad now (or at `when` on the audio clock). */
export function triggerPad(project, i, when = 0, velocity = 1) {
  const pad = project.pads[i]
  if (!pad?.src) return
  const buf = cachedBuffer(pad.src)
  if (!buf) return
  const c = getContext()
  const at = when || c.currentTime
  const node = c.createBufferSource()
  node.buffer = buf
  node.playbackRate.value = rate(pad)
  const g = c.createGain()
  g.gain.value = (pad.vol ?? 0.85) * velocity
  node.connect(g)
  g.connect(master)
  const group = CHOKE[pad.src.pad] && pad.src.kind === 'kit' ? CHOKE[pad.src.pad] : pad.choke
  if (group) {
    const prev = ringing.get(group)
    if (prev) { try { prev.stop(at) } catch {} }
    ringing.set(group, node)
  }
  const { start, length } = region(pad, buf)
  try { node.start(at, start, length / 1) } catch { try { node.start(at) } catch {} }
}

export function stepDuration(bpm) {
  return 60 / bpm / 4 // 16th notes
}

// Swing delays every second 16th by up to half a step.
function swingOffset(step, bpm, swing) {
  return step % 2 === 1 ? (swing || 0) * 0.5 * stepDuration(bpm) : 0
}

/**
 * Starts looping the project's pattern. getProject() is read every tick so edits (steps, tempo,
 * volume) apply live. onStep(step) fires roughly when each step is heard (for the playhead).
 * Returns stop().
 */
export function startSequencer(getProject, onStep) {
  const c = getContext()
  let step = 0
  let next = c.currentTime + 0.06
  const uiTimers = new Set()
  const tick = () => {
    const project = getProject()
    if (!project) return
    const len = project.steps || 16
    while (next < c.currentTime + LOOKAHEAD_S) {
      const s = step % len
      const at = next + swingOffset(s, project.bpm, project.swing)
      for (let i = 0; i < project.pads.length; i++) {
        const cell = project.pattern?.[i]?.[s]
        if (cell && audible(project, i)) triggerPad(project, i, at, cell === 2 ? 1 : 0.8)
      }
      if (project.metronome && s % 4 === 0) click(at, s === 0)
      const delayMs = Math.max(0, (at - c.currentTime) * 1000)
      const t = setTimeout(() => { uiTimers.delete(t); onStep?.(s) }, delayMs)
      uiTimers.add(t)
      next += stepDuration(project.bpm)
      step = (step + 1) % len
    }
  }
  tick()
  const id = setInterval(tick, TICK_MS)
  return () => {
    clearInterval(id)
    uiTimers.forEach(clearTimeout)
    uiTimers.clear()
    ringing.forEach((n) => { try { n.stop() } catch {} })
    ringing.clear()
    onStep?.(-1)
  }
}

function click(at, accent) {
  const c = getContext()
  const o = c.createOscillator()
  const g = c.createGain()
  o.frequency.value = accent ? 1600 : 1100
  g.gain.setValueAtTime(0.25, at)
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
  o.connect(g)
  g.connect(master)
  o.start(at)
  o.stop(at + 0.06)
}

/** Plays part of a buffer (sampler audition). Returns stop(). */
export function playRegion(buf, start = 0, end) {
  const c = getContext()
  const node = c.createBufferSource()
  node.buffer = buf
  node.connect(master)
  const len = Math.max(0.01, (end ?? buf.duration) - start)
  node.start(c.currentTime, start, len)
  return () => { try { node.stop() } catch {} }
}

// ---- offline render (export) -------------------------------------------------------------
/**
 * Mixes `loops` passes of the pattern into stereo Float32 PCM at the context's sample rate.
 * Pitch uses linear-interpolated resampling; choke groups truncate the earlier hit. A short
 * tail lets the last hits ring out. Soft-clips the bus so loud patterns don't hard-clip.
 */
export function renderProject(project, loops = 2) {
  const sr = getContext().sampleRate || 44100
  const len = project.steps || 16
  const stepS = stepDuration(project.bpm)
  const total = Math.ceil((len * loops * stepS + 1.5) * sr)
  const L = new Float32Array(total)
  const R = new Float32Array(total)
  const hits = []
  for (let loop = 0; loop < loops; loop++) {
    for (let s = 0; s < len; s++) {
      const t0 = (loop * len + s) * stepS + swingOffset(s, project.bpm, project.swing)
      for (let i = 0; i < project.pads.length; i++) {
        const cell = project.pattern?.[i]?.[s]
        if (cell && audible(project, i)) hits.push({ i, t0, vel: cell === 2 ? 1 : 0.8 })
      }
    }
  }
  hits.sort((a, b) => a.t0 - b.t0)
  // choke: end time per hit = next hit in the same group
  const groupOf = (i) => {
    const p = project.pads[i]
    return (p.src?.kind === 'kit' && CHOKE[p.src.pad]) || p.choke || null
  }
  const endAt = new Array(hits.length).fill(Infinity)
  const lastInGroup = {}
  hits.forEach((h, k) => {
    const g = groupOf(h.i)
    if (!g) return
    if (lastInGroup[g] != null) endAt[lastInGroup[g]] = h.t0
    lastInGroup[g] = k
  })
  hits.forEach((h, k) => {
    const pad = project.pads[h.i]
    const buf = cachedBuffer(pad.src)
    if (!buf) return
    const ch0 = buf.getChannelData(0)
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0
    const bsr = buf.sampleRate || sr
    const { start, length } = region(pad, buf)
    const r = rate(pad) * (bsr / sr)
    const gain = (pad.vol ?? 0.85) * h.vel * 0.85
    const outStart = Math.floor(h.t0 * sr)
    const maxOut = Math.min(Math.floor((length / rate(pad)) * sr), endAt[k] === Infinity ? Infinity : Math.floor((endAt[k] - h.t0) * sr))
    const srcStart = start * bsr
    const srcEnd = Math.min(ch0.length - 1, (start + length) * bsr)
    for (let n = 0; n < maxOut; n++) {
      const pos = srcStart + n * r
      if (pos >= srcEnd) break
      const o = outStart + n
      if (o >= total) break
      const i0 = pos | 0
      const f = pos - i0
      // 2 ms fade-out when choked so the cut doesn't click
      const fade = maxOut - n < 96 ? (maxOut - n) / 96 : 1
      L[o] += (ch0[i0] + (ch0[i0 + 1] - ch0[i0]) * f) * gain * fade
      R[o] += (ch1[i0] + (ch1[i0 + 1] - ch1[i0]) * f) * gain * fade
    }
  })
  for (let n = 0; n < total; n++) {
    L[n] = Math.tanh(L[n])
    R[n] = Math.tanh(R[n])
  }
  return { sampleRate: sr, channels: [L, R], duration: total / sr }
}

/** Peak envelope (0..1) of a buffer for waveform drawing. */
export function peaks(buf, buckets = 200) {
  const d = buf.getChannelData(0)
  const size = Math.max(1, Math.floor(d.length / buckets))
  const out = new Array(buckets).fill(0)
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const end = Math.min(d.length, (b + 1) * size)
    for (let n = b * size; n < end; n += 4) {
      const v = Math.abs(d[n])
      if (v > m) m = v
    }
    out[b] = m
  }
  const top = Math.max(...out, 0.0001)
  return out.map((v) => v / top)
}

/**
 * Finds up to `count` slice points: equal divisions, or onsets (energy rises) for 'transients'.
 * Returns [{start, end}] in seconds.
 */
export function chop(buf, count = 8, mode = 'even', from = 0, to) {
  const end = to ?? buf.duration
  const span = end - from
  if (mode !== 'transients') {
    return Array.from({ length: count }, (_, k) => ({ start: from + (span * k) / count, end: from + (span * (k + 1)) / count }))
  }
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate
  const hop = Math.floor(sr * 0.01)
  const energies = []
  for (let n = Math.floor(from * sr); n < Math.floor(end * sr) - hop; n += hop) {
    let e = 0
    for (let k = 0; k < hop; k += 2) e += d[n + k] * d[n + k]
    energies.push({ t: n / sr, e })
  }
  const flux = energies.map((x, k) => ({ t: x.t, v: k ? Math.max(0, x.e - energies[k - 1].e) : 0 }))
  const minGap = Math.max(0.08, span / (count * 3))
  const picks = []
  ;[...flux].sort((a, b) => b.v - a.v).forEach((p) => {
    if (picks.length >= count) return
    if (picks.every((q) => Math.abs(q - p.t) >= minGap)) picks.push(p.t)
  })
  if (!picks.length) return chop(buf, count, 'even', from, to)
  picks.sort((a, b) => a - b)
  if (picks[0] - from > minGap) picks.unshift(from)
  const starts = picks.slice(0, count)
  return starts.map((s, k) => ({ start: s, end: k + 1 < starts.length ? starts[k + 1] : end }))
}
