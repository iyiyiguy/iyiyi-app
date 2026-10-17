// Vocal / track effects for The Lab (per track, offline, plain JS, rendered into the track's playback
// buffer like pitch correction, so what you hear is exactly what exports):
//   low cut (12 dB/oct high-pass) -> presence (peaking EQ ~3.5 kHz) -> compressor ->
//   delay (tempo-synced, darkened feedback) -> reverb (Freeverb: 8 combs + 4 allpasses) -> soft limit
// fx = { on, preset, lowCut (Hz, 0 = off), presence (dB), comp (0..1), delay (0..1 mix),
//        delayBeats (0.25 | 0.5 | 0.75 | 1), reverb (0..1 mix), room (0..1) }
export const DEFAULT_FX = { on: false, preset: 'clean', lowCut: 100, presence: 2, comp: 0.4, delay: 0, delayBeats: 0.5, reverb: 0.15, room: 0.5 }

export const FX_PRESETS = {
  clean: { lowCut: 100, presence: 2, comp: 0.4, delay: 0, delayBeats: 0.5, reverb: 0.12, room: 0.4 },
  radio: { lowCut: 160, presence: 5, comp: 0.75, delay: 0, delayBeats: 0.5, reverb: 0.06, room: 0.3 },
  trap: { lowCut: 120, presence: 4, comp: 0.65, delay: 0.22, delayBeats: 0.5, reverb: 0.18, room: 0.55 },
  hall: { lowCut: 90, presence: 2, comp: 0.35, delay: 0.1, delayBeats: 0.75, reverb: 0.42, room: 0.85 },
  dream: { lowCut: 140, presence: 1, comp: 0.3, delay: 0.32, delayBeats: 0.75, reverb: 0.5, room: 0.9 },
}
export const PRESET_IDS = Object.keys(FX_PRESETS)

const yieldUI = () => new Promise((r) => setTimeout(r, 0))

// RBJ cookbook biquad coefficients
function biquad(type, f0, sr, q = 0.7071, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(f0, sr * 0.45)) / sr
  const cs = Math.cos(w)
  const sn = Math.sin(w)
  const alpha = sn / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  if (type === 'hp') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
  } else { // peaking
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}
function runBiquad(x, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const y = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = y
    x[i] = y
  }
}

function compress(x, sr, amount) {
  if (amount <= 0.01) return
  const thrDb = -10 - 22 * amount
  const ratio = 2 + 6 * amount
  const att = Math.exp(-1 / (0.005 * sr))
  const rel = Math.exp(-1 / (0.12 * sr))
  const makeup = Math.pow(10, (-thrDb * (1 - 1 / ratio)) / 2 / 20)
  let env = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a
    const lvl = env > 1e-6 ? 20 * Math.log10(env) : -120
    const over = lvl - thrDb
    const gDb = over > 0 ? -over * (1 - 1 / ratio) : 0
    x[i] *= Math.pow(10, gDb / 20) * makeup
  }
}

function delayFx(x, sr, mix, seconds) {
  if (mix <= 0.01) return
  const d = Math.max(1, Math.round(seconds * sr))
  const buf = new Float32Array(d)
  let w = 0
  let lp = 0
  const fb = 0.38
  for (let i = 0; i < x.length; i++) {
    const out = buf[w]
    lp += 0.35 * (out - lp) // darker repeats
    buf[w] = x[i] + lp * fb
    w = (w + 1) % d
    x[i] += out * mix
  }
}

// Freeverb (Jezar), mono
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS = [556, 441, 341, 225]
function reverb(x, sr, mix, room) {
  if (mix <= 0.01) return
  const scale = sr / 44100
  const feedback = 0.7 + 0.28 * room
  const damp = 0.3
  const combs = COMBS.map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0, f: 0 }))
  const aps = ALLPASS.map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0 }))
  for (let s = 0; s < x.length; s++) {
    const input = x[s] * 0.015
    let out = 0
    for (const c of combs) {
      const y = c.b[c.i]
      c.f = y * (1 - damp) + c.f * damp
      c.b[c.i] = input + c.f * feedback
      if (++c.i >= c.b.length) c.i = 0
      out += y
    }
    for (const a of aps) {
      const bo = a.b[a.i]
      const y = -out + bo
      a.b[a.i] = out + bo * 0.5
      if (++a.i >= a.b.length) a.i = 0
      out = y
    }
    x[s] = x[s] * (1 - mix * 0.35) + out * mix * 3
  }
}

/** Applies fx to mono PCM. Returns a new Float32Array (with room for the reverb/delay tail). */
export async function applyFx(data, sr, fxIn, bpm = 120, onProgress) {
  const fx = { ...DEFAULT_FX, ...(fxIn || {}) }
  const tail = fx.reverb > 0.01 || fx.delay > 0.01 ? Math.round(sr * (1 + fx.room * 2)) : 0
  const x = new Float32Array(data.length + tail)
  x.set(data)
  if (fx.lowCut > 0) { runBiquad(x, biquad('hp', fx.lowCut, sr)); runBiquad(x, biquad('hp', fx.lowCut, sr)) }
  onProgress?.(0.2); await yieldUI()
  if (Math.abs(fx.presence) > 0.1) runBiquad(x, biquad('peak', 3500, sr, 0.9, fx.presence))
  compress(x, sr, fx.comp)
  onProgress?.(0.45); await yieldUI()
  delayFx(x, sr, fx.delay, (60 / Math.max(40, bpm)) * fx.delayBeats)
  onProgress?.(0.6); await yieldUI()
  reverb(x, sr, fx.reverb, fx.room)
  onProgress?.(0.95)
  for (let i = 0; i < x.length; i++) { const v = x[i]; x[i] = v > 0.95 || v < -0.95 ? Math.tanh(v) : v }
  onProgress?.(1)
  return x
}
