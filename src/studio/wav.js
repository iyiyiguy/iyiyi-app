// 16-bit PCM WAV encoder for Studio exports (render from engine.renderProject).
export function encodeWav({ sampleRate, channels }) {
  const numCh = channels.length
  const frames = channels[0].length
  const bytesPerSample = 2
  const dataSize = frames * numCh * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, numCh, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true)
  v.setUint16(32, numCh * bytesPerSample, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataSize, true)
  let o = 44
  for (let n = 0; n < frames; n++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][n]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return buf
}
