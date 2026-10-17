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

// iOS: playback only by default; switched to play-and-record while the mic is in use (the beat
// keeps playing through the speaker / headphones / Bluetooth while you record over it).
// echoCancel uses the 'voiceChat' mode (Apple's voice processing, as in FaceTime): the beat coming
// out of the phone speaker is cancelled from the mic, so you don't need headphones.
let sessionMode = 'playback'
export function setRecordSession(on, { echoCancel = false } = {}) {
  const want = !on ? 'playback' : echoCancel ? 'voiceChat' : 'record'
  if (Platform.OS !== 'ios' || sessionMode === want) return
  sessionMode = want
  try {
    AudioManager.setAudioSessionOptions(want === 'playback'
      ? { iosCategory: 'playback', iosMode: 'default', iosOptions: [] }
      : { iosCategory: 'playAndRecord', iosMode: want === 'voiceChat' ? 'voiceChat' : 'default', iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'] })
    AudioManager.setAudioSessionActivity(true).catch(() => {})
  } catch {}
}

/** true when sound is coming out of the phone itself (iOS), false for headphones/Bluetooth, null if unknown. */
export async function outputIsSpeaker() {
  if (Platform.OS !== 'ios') return null
  try {
    const info = await AudioManager.getDevicesInfo()
    const outs = info?.currentOutputs || []
    if (!outs.length) return null
    return outs.some((o) => /speaker|receiver/i.test(o.category || ''))
  } catch {
    return null
  }
}

/** Turns the whole mix down (level 0..1 of normal) with a short fade; duckBeat(1) restores it. */
export function duckBeat(level = 1) {
  const c = getContext()
  try { master.gain.setTargetAtTime(0.85 * level, c.currentTime, 0.06) } catch { master.gain.value = 0.85 * level }
}

export async function resumeAudio() {
  const c = getContext()
  // Browsers keep resume() pending until the user taps something: never block on it.
  try { if (c.state === 'suspended') await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 600))]) } catch {}
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
 * volume) apply live. onStep(step, absStep) fires roughly when each step is heard (playhead).
 * opts.startAt: audio-clock start time (so other sounds can be scheduled in sync).
 * opts.song: () => ({ hits: [{ p, s }], steps, beatMute }) adds timeline pad hits (s = 16th
 * steps from the start, may be fractional) and stops after `steps` (opts.onEnd fires then).
 * Returns stop(); stop.startAt is the start time on the audio clock.
 */
export function startSequencer(getProject, onStep, opts = {}) {
  const c = getContext()
  let step = 0
  let abs = 0
  const startAt = opts.startAt || c.currentTime + 0.06
  let next = startAt
  let ended = false
  const uiTimers = new Set()
  const later = (at, fn) => {
    const t = setTimeout(() => { uiTimers.delete(t); fn() }, Math.max(0, (at - c.currentTime) * 1000))
    uiTimers.add(t)
  }
  const tick = () => {
    const project = getProject()
    if (!project || ended) return
    const len = project.steps || 16
    const song = opts.song ? opts.song() : null
    while (next < c.currentTime + LOOKAHEAD_S) {
      if (song && abs >= song.steps) {
        ended = true
        later(next, () => opts.onEnd?.())
        break
      }
      const s = step % len
      const dur = stepDuration(project.bpm)
      const at = next + swingOffset(s, project.bpm, project.swing)
      if (!song?.beatMute) {
        for (let i = 0; i < project.pads.length; i++) {
          const cell = project.pattern?.[i]?.[s]
          if (cell && audible(project, i)) triggerPad(project, i, at, cell === 2 ? 1 : 0.8)
        }
      }
      if (song?.hits?.length) {
        for (const h of song.hits) {
          if (h.s >= abs && h.s < abs + 1 && audible(project, h.p)) triggerPad(project, h.p, next + (h.s - abs) * dur, h.v || 1)
        }
      }
      if (project.metronome && s % 4 === 0) click(at, s === 0)
      const a = abs
      later(at, () => onStep?.(s, a))
      next += dur
      step = (step + 1) % len
      abs += 1
    }
  }
  tick()
  const id = setInterval(tick, TICK_MS)
  const stop = () => {
    clearInterval(id)
    uiTimers.forEach(clearTimeout)
    uiTimers.clear()
    ringing.forEach((n) => { try { n.stop() } catch {} })
    ringing.clear()
    onStep?.(-1, -1)
  }
  stop.startAt = startAt
  return stop
}

/** Count-in clicks (one bar of quarter notes) ending at `startAt`. */
export function countIn(startAt, bpm, beats = 4) {
  const beat = 60 / bpm
  for (let k = 0; k < beats; k++) click(startAt - (beats - k) * beat, k === 0)
}

/** Plays a vocal buffer from `startAt` (audio clock); offset = seconds into the vocal. Returns stop(). */
export function playBuffer(buf, startAt, offset = 0, gain = 1) {
  if (!buf) return () => {}
  const c = getContext()
  const node = c.createBufferSource()
  node.buffer = buf
  const g = c.createGain()
  g.gain.value = gain
  node.connect(g)
  g.connect(master)
  let at = startAt
  let from = offset
  if (from < 0) { at -= from; from = 0 }
  if (from >= buf.duration) return () => {}
  try { node.start(Math.max(c.currentTime, at), from) } catch {}
  return () => { try { node.stop() } catch {} }
}

/** Mono Float32 PCM -> AudioBuffer on the engine's context. */
export function bufferFromPCM(data, sampleRate) {
  const c = getContext()
  const buf = c.createBuffer(1, Math.max(1, data.length), sampleRate)
  buf.copyToChannel(data, 0)
  return buf
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
function groupOf(project, i) {
  const p = project.pads[i]
  return (p.src?.kind === 'kit' && CHOKE[p.src.pad]) || p.choke || null
}

// Mixes a list of pad hits ({ i, t0, vel }) into L/R. Pitch uses linear-interpolated
// resampling; choke groups truncate the earlier hit (with a 2 ms fade so the cut doesn't click).
function mixHits(project, hits, L, R, sr) {
  const total = L.length
  hits.sort((a, b) => a.t0 - b.t0)
  const endAt = new Array(hits.length).fill(Infinity)
  const lastInGroup = {}
  hits.forEach((h, k) => {
    const g = groupOf(project, h.i)
    if (!g) return
    if (lastInGroup[g] != null) endAt[lastInGroup[g]] = h.t0
    lastInGroup[g] = k
  })
  hits.forEach((h, k) => {
    const pad = project.pads[h.i]
    const buf = pad?.src ? cachedBuffer(pad.src) : null
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
      if (o < 0) continue
      const i0 = pos | 0
      const f = pos - i0
      const fade = maxOut - n < 96 ? (maxOut - n) / 96 : 1
      L[o] += (ch0[i0] + (ch0[i0 + 1] - ch0[i0]) * f) * gain * fade
      R[o] += (ch1[i0] + (ch1[i0 + 1] - ch1[i0]) * f) * gain * fade
    }
  })
}

function patternHits(project, fromStep, toStep, out = []) {
  const len = project.steps || 16
  const stepS = stepDuration(project.bpm)
  for (let a = fromStep; a < toStep; a++) {
    const s = a % len
    const t0 = a * stepS + swingOffset(s, project.bpm, project.swing)
    for (let i = 0; i < project.pads.length; i++) {
      const cell = project.pattern?.[i]?.[s]
      if (cell && audible(project, i)) out.push({ i, t0, vel: cell === 2 ? 1 : 0.8 })
    }
  }
  return out
}

function softClip(L, R) {
  for (let n = 0; n < L.length; n++) {
    L[n] = Math.tanh(L[n])
    R[n] = Math.tanh(R[n])
  }
}

/**
 * Mixes `loops` passes of the pattern into stereo Float32 PCM at the context's sample rate.
 * A short tail lets the last hits ring out. Soft-clips the bus so loud patterns don't hard-clip.
 */
export function renderProject(project, loops = 2) {
  const sr = getContext().sampleRate || 44100
  const len = project.steps || 16
  const stepS = stepDuration(project.bpm)
  const total = Math.ceil((len * loops * stepS + 1.5) * sr)
  const L = new Float32Array(total)
  const R = new Float32Array(total)
  mixHits(project, patternHits(project, 0, len * loops), L, R, sr)
  softClip(L, R)
  return { sampleRate: sr, channels: [L, R], duration: total / sr }
}

/**
 * Renders the Song timeline: the looping beat (unless muted), the recorded pad hits and the
 * vocal (an AudioBuffer, already auto-tuned if that's on) for song.bars bars.
 */
export function renderSong(project, vocalBuf) {
  const sr = getContext().sampleRate || 44100
  const song = project.song || {}
  const steps = (song.bars || 8) * 16
  const stepS = stepDuration(project.bpm)
  const total = Math.ceil((steps * stepS + 1.5) * sr)
  const L = new Float32Array(total)
  const R = new Float32Array(total)
  const hits = song.beatMute ? [] : patternHits(project, 0, steps)
  for (const h of song.hits || []) {
    if (h.s < steps && audible(project, h.p)) hits.push({ i: h.p, t0: h.s * stepS, vel: h.v || 1 })
  }
  mixHits(project, hits, L, R, sr)
  const v = song.vocal
  if (vocalBuf && v && !v.mute) {
    const d = vocalBuf.getChannelData(0)
    const gain = v.vol ?? 0.9
    const off = v.offset || 0 // seconds of the recording before bar 1
    for (let o = 0; o < total; o++) {
      const pos = (o / sr + off) * (vocalBuf.sampleRate || sr)
      if (pos < 0) continue
      const i0 = pos | 0
      if (i0 >= d.length - 1) break
      const f = pos - i0
      const x = (d[i0] + (d[i0 + 1] - d[i0]) * f) * gain
      L[o] += x
      R[o] += x
    }
  }
  softClip(L, R)
  return { sampleRate: sr, channels: [L, R], duration: total / sr }
}

/** Peak envelope (0..1) of a buffer (or raw Float32Array) for waveform drawing. */
export function peaks(buf, buckets = 200, normalize = true) {
  const d = buf.getChannelData ? buf.getChannelData(0) : buf
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
  if (!normalize) return out
  let top = 0.0001
  for (const v of out) if (v > top) top = v
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
