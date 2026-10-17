// Studio microphone (web): getUserMedia into the engine's own AudioContext, so the take shares
// the beat's clock. Raw PCM chunks are delivered live (onChunk) for the live waveform.
import { getContext } from './engine'

export async function ensureMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

export function concatChunks(chunks, frames) {
  const out = new Float32Array(frames)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

export function resample(data) { return data }

export async function startMic({ onChunk } = {}) {
  const c = getContext()
  const ac = c.context
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const src = ac.createMediaStreamSource(stream)
  const proc = ac.createScriptProcessor(1024, 1, 1)
  const silent = ac.createGain()
  silent.gain.value = 0
  src.connect(proc)
  proc.connect(silent)
  silent.connect(ac.destination)
  const chunks = []
  let frames = 0
  let startClock = Infinity
  proc.onaudioprocess = (e) => {
    const copy = new Float32Array(e.inputBuffer.getChannelData(0))
    chunks.push(copy)
    frames += copy.length
    const est = ac.currentTime - frames / ac.sampleRate
    if (est < startClock) startClock = est
    onChunk?.(copy, ac.sampleRate)
  }
  return {
    async stop() {
      try { proc.disconnect(); src.disconnect(); silent.disconnect() } catch {}
      proc.onaudioprocess = null
      stream.getTracks().forEach((t) => t.stop())
      return { data: concatChunks(chunks, frames), sampleRate: ac.sampleRate, startClock: Number.isFinite(startClock) ? startClock : null }
    },
  }
}
