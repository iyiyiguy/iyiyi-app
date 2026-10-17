// Studio microphone (iOS/Android): records through react-native-audio-api, the same engine that
// plays the beat, so the take lines up with the beat on one audio clock. Raw PCM arrives in
// small chunks while recording (onChunk) so the waveform can draw live as you record.
import { AudioRecorder, AudioManager } from 'react-native-audio-api'
import { getContext, setRecordSession } from './engine'

export async function ensureMic() {
  try {
    const { requestRecordingPermissionsAsync } = require('expo-audio')
    const p = await requestRecordingPermissionsAsync()
    if (p?.granted) return true
  } catch {}
  try { return (await AudioManager.requestRecordingPermissions()) === 'Granted' } catch { return false }
}

export function concatChunks(chunks, frames) {
  const out = new Float32Array(frames)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

export function resample(data, from, to) {
  if (!from || from === to) return data
  const r = from / to
  const n = Math.floor(data.length / r)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * r
    const i0 = p | 0
    const f = p - i0
    out[i] = data[i0] + ((data[i0 + 1] ?? data[i0]) - data[i0]) * f
  }
  return out
}

/**
 * Starts recording. onChunk(Float32Array, sampleRate) fires as audio arrives.
 * Returns { stop(): Promise<{ data, sampleRate, startClock }> } where startClock is the audio-clock
 * time of the first recorded sample (estimated from chunk arrival, jitter-corrected).
 */
export async function startMic({ onChunk } = {}) {
  setRecordSession(true)
  const c = getContext()
  const rec = new AudioRecorder()
  const chunks = []
  let frames = 0
  let rate = c.sampleRate
  let startClock = Infinity
  rec.onAudioReady({ sampleRate: c.sampleRate, bufferLength: 1024, channelCount: 1 }, (e) => {
    const d = e.buffer.getChannelData(0)
    const copy = new Float32Array(d.length)
    copy.set(d)
    rate = e.buffer.sampleRate || rate
    chunks.push(copy)
    frames += copy.length
    // the chunk that arrives soonest after capture gives the best estimate of when we started
    const est = c.currentTime - frames / rate
    if (est < startClock) startClock = est
    onChunk?.(copy, rate)
  })
  const res = await rec.start()
  if (res?.status === 'error') {
    rec.clearOnAudioReady()
    throw new Error(res.message || 'Microphone unavailable')
  }
  return {
    async stop() {
      try { await rec.stop() } catch {}
      try { rec.clearOnAudioReady() } catch {}
      const data = resample(concatChunks(chunks, frames), rate, c.sampleRate)
      return { data, sampleRate: c.sampleRate, startClock: Number.isFinite(startClock) ? startClock : null }
    },
  }
}
