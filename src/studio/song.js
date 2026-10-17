// Song timeline data: the looping beat underneath, pad hits recorded live onto the timeline and
// one vocal take (raw recording kept; pitch correction is applied on the fly and cached).
//
// project.song = {
//   bars: 8, countIn: true, beatMute: false, snap: true,
//   hits: [{ p: padIndex, s: stepFromStart (16ths, may be fractional), v: velocity }],
//   vocals: [{ id, owner: 'me' | userId (a friend's take from a Lab session), name, uri,
//              duration, base: seconds of the take before bar 1 (latency included), nudgeMs,
//              vol, mute, tune: { on, key: 'auto' | 0-11, scale, style, detected },
//              pan (-1..1), fx (see fx.js), shift: seconds the clip is moved later on the timeline,
//              trimIn / trimOut: seconds into the take kept (null = whole take),
//              kind: 'take' | 'import' (an imported instrumental / audio file) }],
//   beatVol: 0..1 volume of the beat bus,
// }
// (older projects had a single `vocal`; getSong turns it into vocals[0]).
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadSource, bufferFromPCM, getContext, stepDuration } from './engine'
import { encodeWav } from './wav'
import { autotune } from './autotune'
import { applyFx } from './fx'

export const SONG_BARS = [4, 8, 16, 32, 64]

export function getSong(project) {
  const s = { bars: 8, countIn: true, beatMute: false, beatVol: 1, snap: true, hits: [], ...(project?.song || {}) }
  if (!Array.isArray(s.vocals)) s.vocals = s.vocal ? [{ id: 'v-me', owner: 'me', ...s.vocal }] : []
  delete s.vocal
  return s
}

export const songSteps = (project) => getSong(project).bars * 16
export const songSeconds = (project) => songSteps(project) * stepDuration(project.bpm)
// seconds into the take that line up with bar 1 (latency compensation, Sync nudge and Move included)
export const vocalOffset = (v) => (v ? (v.base || 0) + (v.nudgeMs || 0) / 1000 - (v.shift || 0) : 0)
export const hasSongContent = (project) => { const s = getSong(project); return !!(s.vocals.length || s.hits?.length) }
export const newTrackId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

// Typical round-trip latency (output + input) we compensate by default; Sync fine-tunes it.
export const DEFAULT_LATENCY = Platform.OS === 'web' ? 0.06 : 0.03
const NUDGE_KEY = 'iyiyi_studio_sync_ms_v1'
export async function getDeviceNudge() {
  try { return Number(await AsyncStorage.getItem(NUDGE_KEY)) || 0 } catch { return 0 }
}
export function setDeviceNudge(ms) { AsyncStorage.setItem(NUDGE_KEY, String(ms)).catch(() => {}) }

/** Writes mono PCM as a WAV and returns a uri that survives app restarts (blob url on web). */
export async function saveWav(data, sampleRate, prefix = 'v') {
  const wav = encodeWav({ sampleRate, channels: [data] })
  if (Platform.OS === 'web') return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
  const { File, Directory, Paths } = require('expo-file-system')
  const dir = new Directory(Paths.document, 'studio-samples')
  if (!dir.exists) dir.create({ intermediates: true })
  const file = new File(dir, `${prefix}${Date.now().toString(36)}.wav`)
  try { file.create() } catch {}
  file.write(new Uint8Array(wav))
  return file.uri
}

const rawBufs = new Map() // uri -> AudioBuffer

export function rememberVocal(uri, buf) { rawBufs.set(uri, buf) }

export async function loadVocal(v) {
  if (!v?.uri) return null
  if (rawBufs.has(v.uri)) return rawBufs.get(v.uri)
  const buf = await loadSource({ kind: 'uri', uri: v.uri })
  if (buf) rawBufs.set(v.uri, buf)
  return buf
}

const tunedRaw = new Map()
const finalBufs = new Map()
const tuneKey = (v) => `${v.uri}|${v.tune?.key ?? 'auto'}|${v.tune?.scale || 'major'}|${v.tune?.style || 'hard'}`
const needsPost = (v) => !!(v?.fx?.on || v?.trimIn > 0 || v?.trimOut != null)
const postKey = (v, bpm) => `${v.tune?.on ? tuneKey(v) : v.uri}|${v.trimIn || 0}|${v.trimOut ?? ''}|${v.fx?.on ? JSON.stringify(v.fx) + bpm : ''}`
/** Ready-to-play buffer if it's already been made (no work). */
export function cachedTuned(v, bpm = 120) {
  if (needsPost(v)) return finalBufs.get(postKey(v, bpm)) || null
  if (v?.tune?.on) return tunedRaw.get(tuneKey(v)) || null
  return rawBufs.has(v?.uri) ? { buf: rawBufs.get(v.uri), key: null } : null
}

async function tuned(v, onProgress) {
  const raw = await loadVocal(v)
  if (!raw || !v.tune?.on) return { buf: raw, key: null }
  const k = tuneKey(v)
  if (tunedRaw.has(k)) return tunedRaw.get(k)
  const res = await autotune(raw.getChannelData(0), raw.sampleRate, v.tune, onProgress)
  const out = { buf: bufferFromPCM(res.data, raw.sampleRate), key: res.key }
  tunedRaw.set(k, out)
  return out
}

/**
 * The track as it should be heard: pitch-corrected (if on) -> trimmed -> effects (if on).
 * bpm syncs the delay. onProgress(0..1).
 */
export async function vocalForPlayback(v, onProgress, bpm = 120) {
  const t = await tuned(v, needsPost(v) && v.fx?.on ? (p) => onProgress?.(p * 0.8) : onProgress)
  if (!t.buf || !needsPost(v)) return t
  const k = postKey(v, bpm)
  if (finalBufs.has(k)) return finalBufs.get(k)
  const sr = t.buf.sampleRate
  const src = t.buf.getChannelData(0)
  const a = Math.max(0, Math.min(src.length, Math.round((v.trimIn || 0) * sr)))
  const b = v.trimOut != null ? Math.max(a, Math.min(src.length, Math.round(v.trimOut * sr))) : src.length
  let data = new Float32Array(src.length)
  data.set(src.subarray(a, b), a)
  const f = Math.min(Math.round(sr * 0.006), (b - a) >> 1)
  for (let i = 0; i < f; i++) { const g = i / f; data[a + i] *= g; data[b - 1 - i] *= g }
  if (v.fx?.on) data = await applyFx(data, sr, v.fx, bpm, (p) => onProgress?.(0.8 + p * 0.2))
  const out = { buf: bufferFromPCM(data, sr), key: t.key }
  if (finalBufs.size > 24) finalBufs.delete(finalBufs.keys().next().value)
  finalBufs.set(k, out)
  return out
}

/** Length of the take in seconds (raw), if it's loaded. */
export const takeSeconds = (v) => (rawBufs.get(v?.uri)?.duration || v?.duration || 0)

/** Peaks (0..1) of the vocal laid out on the song timeline: one value per bucket. */
export function vocalPeaks(buf, offset, songS, buckets) {
  if (!buf) return []
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate || getContext().sampleRate
  const out = new Array(buckets).fill(0)
  const per = songS / buckets
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * per + offset) * sr)
    const e = Math.floor(((b + 1) * per + offset) * sr)
    let m = 0
    for (let n = Math.max(0, a); n < Math.min(d.length, e); n += 8) { const x = Math.abs(d[n]); if (x > m) m = x }
    out[b] = m
  }
  let top = 0.05
  for (const x of out) if (x > top) top = x
  return out.map((x) => x / top)
}
