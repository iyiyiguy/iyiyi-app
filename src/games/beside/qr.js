// Tiny pure-JS QR Code encoder (byte mode, versions 1-10, error correction M) for the
// Beside Them station markers. No dependencies, no native code. Follows ISO/IEC 18004
// (structure after Project Nayuki's reference implementation, MIT).
//
//   const { size, modules } = encodeQr('BT1:qr-ab12:K7P2QX')   // modules[y][x] = dark?
//   qrSvgPath(qr, 4)  -> SVG path "d" for the dark modules (quiet zone of 4 modules)
//   qrSvgString(qr)   -> standalone <svg> markup (for printing)

// Index 0 unused; version 1..10, ECC level M.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const MAX_VERSION = 10
const FORMAT_BITS_M = 0

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function rsDivisor(degree) {
  const res = new Array(degree).fill(0)
  res[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < res.length; j++) {
      res[j] = gfMul(res[j], root)
      if (j + 1 < res.length) res[j] ^= res[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return res
}
function rsRemainder(data, div) {
  const res = new Array(div.length).fill(0)
  for (const b of data) {
    const f = b ^ res.shift()
    res.push(0)
    div.forEach((c, i) => { res[i] ^= gfMul(c, f) })
  }
  return res
}

function utf8(text) {
  const s = String(text)
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s))
  return Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)) // eslint-disable-line no-restricted-globals
}

function alignmentPositions(ver, size) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** Encode text. Throws if it doesn't fit version 10-M (~213 bytes). */
export function encodeQr(text) {
  const bytes = utf8(text)
  let ver = 1
  // byte mode: 4 mode bits + 8 count bits (v1-9) / 16 (v10+) + data
  while (ver <= MAX_VERSION && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++
  if (ver > MAX_VERSION) throw new Error('QR payload too long')
  const cap = dataCodewords(ver) * 8
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    data.push(b)
  }

  // Error correction + interleave.
  const nb = NUM_BLOCKS[ver]
  const eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const shortCount = nb - (raw % nb)
  const shortLen = Math.floor(raw / nb)
  const div = rsDivisor(eccLen)
  const blocks = []
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < shortCount) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= shortCount) codewords.push(blk[i]) })
  }

  // Function patterns.
  const size = ver * 4 + 17
  const mods = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false))
  const setFn = (x, y, dark) => { mods[y][x] = dark; isFn[y][x] = true }
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        setFn(x, y, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const al = alignmentPositions(ver, size)
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  const drawFormat = (mask) => {
    const d = (FORMAT_BITS_M << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    const bit = (i) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i))
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i))
    setFn(8, size - 8, true)
  }
  drawFormat(0) // reserve
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      setFn(a, c, dark); setFn(c, a, dark)
    }
  }

  // Data, zig-zag.
  let bi = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - v : v
        if (!isFn[y][x] && bi < codewords.length * 8) {
          mods[y][x] = ((codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0
          bi++
        }
      }
    }
  }

  const applyMask = (m) => {
    const f = MASKS[m]
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && f(x, y)) mods[y][x] = !mods[y][x]
  }
  let best = 0
  let bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m)
    const sc = penalty(mods, size)
    if (sc < bestScore) { bestScore = sc; best = m }
    applyMask(m) // undo (XOR)
  }
  applyMask(best); drawFormat(best)
  return { version: ver, size, modules: mods, mask: best }
}

// Simplified penalty (runs, 2x2 blocks, dark balance). Any mask decodes; this just picks a
// cleaner-looking one.
function penalty(m, size) {
  let p = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1
      for (let b = 1; b < size; b++) {
        const cur = pass ? m[b][a] : m[a][b]
        const prev = pass ? m[b - 1][a] : m[a][b - 1]
        if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1 } else run = 1
      }
    }
  }
  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
    }
  }
  const total = size * size
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return p
}

/** SVG path data (one unit per module) for the dark modules, offset by `quiet` modules. */
export function qrSvgPath(qr, quiet = 4) {
  let d = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue
      let w = 1
      while (x + w < qr.size && qr.modules[y][x + w]) w++
      d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`
      x += w - 1
    }
  }
  return d
}

/** Standalone SVG markup (black on white) for print/HTML. */
export function qrSvgString(qr, px = 240, quiet = 4) {
  const n = qr.size + quiet * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrSvgPath(qr, quiet)}" fill="#000"/></svg>`
}
