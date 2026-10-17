// Vocal pitch correction for Studio takes (offline, plain JS, no native code):
//   1. YIN pitch tracking on a 16 kHz copy (20 ms hops; silent frames skipped)
//   2. key detection (pitch-class histogram vs. major/minor scales) unless a key is chosen
//   3. each voiced frame's pitch snapped to the nearest scale note: 'hard' jumps instantly
//      (the robotic effect), 'natural' glides and keeps some of the singer's expression
//   4. TD-PSOLA resynthesis: 2-period grains re-spaced at the target period (duration kept)
// Work is sliced with short yields so the UI keeps animating while it runs.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] }
const yieldUI = () => new Promise((r) => setTimeout(r, 0))

export function keyName(root, scale) {
  return `${NOTE_NAMES[((root % 12) + 12) % 12]} ${scale === 'minor' ? 'minor' : 'major'}`
}

const analysisCache = new WeakMap()

/** f0 (Hz, 0 = unvoiced) and level per hop for mono PCM. */
export async function trackPitch(x, sr, onProgress) {
  if (analysisCache.has(x)) return analysisCache.get(x)
  const dec = Math.max(1, Math.round(sr / 16000))
  const fs = sr / dec
  const n = Math.floor(x.length / dec)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let a = 0
    const b = i * dec
    for (let k = 0; k < dec; k++) a += x[b + k]
    y[i] = a / dec
  }
  const W = 512 // integration window (32 ms)
  const minLag = Math.floor(fs / 1100)
  const maxLag = Math.ceil(fs / 70)
  const hop = Math.round(fs * 0.02)
  const frames = Math.max(0, Math.floor((n - W - maxLag) / hop) + 1)
  const f0 = new Float32Array(frames)
  const level = new Float32Array(frames)
  const d = new Float32Array(maxLag + 1)
  let peak = 0
  for (let i = 0; i < n; i++) { const v = Math.abs(y[i]); if (v > peak) peak = v }
  const gate = Math.max(0.006, peak * 0.04)
  let t0 = Date.now()
  for (let f = 0; f < frames; f++) {
    const off = f * hop
    let e = 0
    for (let j = 0; j < W; j += 2) e += y[off + j] * y[off + j]
    const rms = Math.sqrt(e / (W / 2))
    level[f] = rms
    if (rms < gate) continue
    d[0] = 1
    let run = 0
    let found = -1
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0
      for (let j = 0; j < W; j++) {
        const dv = y[off + j] - y[off + j + tau]
        s += dv * dv
      }
      run += s
      d[tau] = run > 0 ? (s * tau) / run : 1
      if (found < 0 && tau > minLag + 1 && d[tau - 1] < 0.15 && d[tau - 1] <= d[tau] && d[tau - 1] <= d[tau - 2]) found = tau - 1
    }
    if (found < 0) {
      let best = minLag
      for (let tau = minLag; tau <= maxLag; tau++) if (d[tau] < d[best]) best = tau
      if (d[best] < 0.3) found = best
    }
    if (found > 0) {
      const a = d[found - 1]
      const b = d[found]
      const c = d[Math.min(maxLag, found + 1)]
      const den = a - 2 * b + c
      const shift = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0
      f0[f] = fs / (found + shift)
    }
    if (Date.now() - t0 > 30) {
      onProgress?.(0.75 * (f / frames))
      await yieldUI()
      t0 = Date.now()
    }
  }
  // median of 5 on voiced runs (removes octave blips)
  const sm = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    if (!f0[f]) continue
    const win = []
    for (let k = -2; k <= 2; k++) { const v = f0[f + k]; if (v) win.push(v) }
    win.sort((p, q) => p - q)
    sm[f] = win[win.length >> 1]
  }
  const out = { f0: sm, level, hopS: hop / fs }
  analysisCache.set(x, out)
  return out
}

const toMidi = (f) => 69 + 12 * Math.log2(f / 440)

export function detectKey(f0, level) {
  const hist = new Array(12).fill(0)
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue
    const pc = ((Math.round(toMidi(f0[i])) % 12) + 12) % 12
    hist[pc] += 1 + level[i] * 10
  }
  let best = { root: 0, scale: 'major', score: -1 }
  for (const scale of ['major', 'minor']) {
    for (let root = 0; root < 12; root++) {
      // tonic and fifth weigh a little more so relative major/minor don't tie
      const score = SCALES[scale].reduce((acc, iv, k) => acc + hist[(root + iv) % 12] * (k === 0 ? 1.25 : k === 4 ? 1.1 : 1), 0)
      if (score > best.score + 1e-6) best = { root, scale, score }
    }
  }
  return { root: best.root, scale: best.scale }
}

function snap(m, root, scale) {
  const sc = SCALES[scale] || SCALES.major
  let best = Math.round(m)
  let dist = Infinity
  const base = Math.floor(m) - 2
  for (let k = base; k <= base + 4; k++) {
    if (!sc.includes((((k - root) % 12) + 12) % 12)) continue
    const dd = Math.abs(m - k)
    if (dd < dist) { dist = dd; best = k }
  }
  return best
}

/**
 * Pitch-corrects mono PCM. opts: { key: 'auto' | 0-11, scale: 'major'|'minor', style: 'hard'|'natural' }.
 * Returns { data: Float32Array, key: { root, scale } }.
 */
export async function autotune(x, sr, opts = {}, onProgress) {
  const { f0, level, hopS } = await trackPitch(x, sr, onProgress)
  const key = opts.key === 'auto' || opts.key == null ? detectKey(f0, level) : { root: opts.key, scale: opts.scale || 'major' }
  const hard = opts.style !== 'natural'
  // per-frame shift ratio
  const ratio = new Float32Array(f0.length).fill(1)
  let cur = null
  const alpha = hard ? 1 : 1 - Math.exp(-hopS / 0.06)
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) { cur = null; continue }
    const m = toMidi(f0[i])
    const target = snap(m, key.root, key.scale)
    cur = cur == null ? target : cur + (target - cur) * alpha
    const outM = hard ? target : cur + 0.3 * (m - target)
    ratio[i] = Math.max(0.6, Math.min(1.7, Math.pow(2, (outM - m) / 12)))
  }
  const hopN = hopS * sr
  const frameAt = (t) => Math.max(0, Math.min(f0.length - 1, Math.round(t / hopN)))
  const periodAt = (t) => { const f = f0[frameAt(t)]; return f ? sr / f : 0 }
  // analysis marks: one per period on voiced audio. The first mark of each voiced run sits on
  // the waveform peak; the rest follow at exact (fractional) period steps so grains stay in phase.
  const marks = []
  let t = 0
  let inRun = false
  const uStep = Math.round(sr * 0.005)
  while (t < x.length) {
    const P = periodAt(t)
    if (P) {
      if (!inRun) {
        const hi = Math.min(x.length - 1, Math.ceil(t + P))
        let pk = t | 0
        for (let k = t | 0; k <= hi; k++) if (Math.abs(x[k]) > Math.abs(x[pk])) pk = k
        t = pk
        inRun = true
      }
      marks.push(Math.round(t))
      t += Math.max(2, P)
    } else {
      inRun = false
      marks.push(t | 0)
      t += uStep
    }
  }
  const y = new Float32Array(x.length)
  const wsum = new Float32Array(x.length)
  let to = 0
  let mi = 0
  let t1 = Date.now()
  const uHalf = Math.round(sr * 0.01)
  while (to < x.length) {
    const P = periodAt(to)
    const voiced = P > 0
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - to) <= Math.abs(marks[mi] - to)) mi++
    const half = voiced ? Math.round(P) : uHalf
    const center = voiced ? marks[mi] : Math.round(to)
    const dst0 = Math.round(to)
    for (let k = -half; k < half; k++) {
      const s = center + k
      const o = dst0 + k
      if (s < 0 || o < 0 || s >= x.length || o >= x.length) continue
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (k + half)) / half)
      y[o] += x[s] * w
      wsum[o] += w
    }
    to += voiced ? P / ratio[frameAt(to)] : uStep
    if (Date.now() - t1 > 30) {
      onProgress?.(0.75 + 0.25 * (to / x.length))
      await yieldUI()
      t1 = Date.now()
    }
  }
  for (let i = 0; i < y.length; i++) y[i] = y[i] / Math.max(wsum[i], 0.35)
  onProgress?.(1)
  return { data: y, key }
}
