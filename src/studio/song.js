// Song timeline data: the looping beat underneath, pad hits recorded live onto the timeline and
// one vocal take (raw recording kept; pitch correction is applied on the fly and cached).
//
// project.song = {
//   bars: 8, countIn: true, beatMute: false, snap: true,
//   hits: [{ p: padIndex, s: stepFromStart (16ths, may be fractional), v: velocity }],
//   vocal: { uri, duration, base: seconds of the take before bar 1 (latency included),
//            nudgeMs, vol, mute, tune: { on, key: 'auto' | 0-11, scale, style, detected } } | null,
// }
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadSource, bufferFromPCM, getContext, stepDuration } from './engine'
import { encodeWav } from './wav'
import { autotune } from './autotune'

export const SONG_BARS = [4, 8, 16, 32]

export function getSong(project) {
  return { bars: 8, countIn: true, beatMute: false, snap: true, hits: [], vocal: null, ...(project?.song || {}) }
}

export const songSteps = (project) => getSong(project).bars * 16
export const songSeconds = (project) => songSteps(project) * stepDuration(project.bpm)
export const vocalOffset = (v) => (v ? (v.base || 0) + (v.nudgeMs || 0) / 1000 : 0)
export const hasSongContent = (project) => !!(project?.song?.vocal || project?.song?.hits?.length)

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
const tunedBufs = new Map() // uri|key|scale|style -> { buf, key }

export function rememberVocal(uri, buf) { rawBufs.set(uri, buf) }

export async function loadVocal(v) {
  if (!v?.uri) return null
  if (rawBufs.has(v.uri)) return rawBufs.get(v.uri)
  const buf = await loadSource({ kind: 'uri', uri: v.uri })
  if (buf) rawBufs.set(v.uri, buf)
  return buf
}

const tuneKey = (v) => `${v.uri}|${v.tune?.key ?? 'auto'}|${v.tune?.scale || 'major'}|${v.tune?.style || 'hard'}`
export function cachedTuned(v) { return v?.tune?.on ? tunedBufs.get(tuneKey(v)) || null : null }

/** The vocal as it should be heard: pitch-corrected when that's on. onProgress(0..1). */
export async function vocalForPlayback(v, onProgress) {
  const raw = await loadVocal(v)
  if (!raw || !v.tune?.on) return { buf: raw, key: null }
  const k = tuneKey(v)
  if (tunedBufs.has(k)) return tunedBufs.get(k)
  const data = raw.getChannelData(0)
  const res = await autotune(data, raw.sampleRate, v.tune, onProgress)
  const out = { buf: bufferFromPCM(res.data, raw.sampleRate), key: res.key }
  tunedBufs.set(k, out)
  return out
}

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
