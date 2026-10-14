// Small, dependency-free QR code encoder (ISO/IEC 18004), drawn on the device so nothing is
// sent to a third-party image service.
//
// Scope: byte mode (UTF-8), error correction level M, versions 1-10 (up to 213 bytes, plenty
// for a profile URL). The mask is chosen with the standard penalty rules (N1-N4).
//
//   const qr = encodeQR('https://app.iyiyi.xyz/u/cafe.luna?src=qr')
//   qr.size        // modules per side, e.g. 29 (no quiet zone)
//   qr.get(r, c)   // true = dark
//   qr.modules     // Array<Uint8Array> rows, 1 = dark
//
// Tested headlessly against the npm `qrcode` reference implementation (scratchpad/qrtest).

// ---- error correction level M, versions 1..10 ----
// [ec codewords per block, [[block count, data codewords per block], ...]]
const M_BLOCKS = [
  null,
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
]
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]
const MAX_VERSION = 10
const EC_M_FORMAT_BITS = 0 // M = 00

export const MAX_BYTES = 213 // version 10-M, byte mode

// ---- UTF-8 (Hermes may not ship TextEncoder) ----
export function utf8Bytes(str) {
  const out = []
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

// ---- GF(256) Reed-Solomon, primitive polynomial 0x11D ----
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generatorPoly(degree) {
  // Coefficients, highest power first, leading 1 omitted is NOT done: poly[0] = 1.
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function rsRemainder(data, degree) {
  const gen = generatorPoly(degree)
  const rem = new Array(degree).fill(0)
  for (const b of data) {
    const factor = b ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor)
  }
  return rem
}

const dataCapacity = (v) => M_BLOCKS[v][1].reduce((n, [count, size]) => n + count * size, 0)
const countBits = (v) => (v < 10 ? 8 : 16)

function pickVersion(len, minVersion) {
  for (let v = Math.max(1, minVersion || 1); v <= MAX_VERSION; v++) {
    if (4 + countBits(v) + 8 * len <= dataCapacity(v) * 8) return v
  }
  return 0
}

function buildCodewords(bytes, version) {
  const cap = dataCapacity(version) * 8
  const bits = []
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, countBits(version))
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    data.push(b)
  }
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad)

  // Split into blocks, add error correction, interleave.
  const [ecLen, groups] = M_BLOCKS[version]
  const blocks = []
  let k = 0
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(k, k + size)
      k += size
      blocks.push({ d, ec: rsRemainder(d, ecLen) })
    }
  }
  const out = []
  const maxData = Math.max(...blocks.map((b) => b.d.length))
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i])
  return out
}

// ---- matrix ----
function makeGrid(size) {
  const rows = []
  for (let i = 0; i < size; i++) rows.push(new Uint8Array(size))
  return rows
}

function drawFunctionPatterns(m, fn, version) {
  const size = m.length
  const set = (r, c, dark) => { m[r][c] = dark ? 1 : 0; fn[r][c] = 1 }
  // Timing
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  // Finders (with separators)
  const finder = (r0, c0) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= size || c >= size) continue
        const d = Math.max(Math.abs(dr), Math.abs(dc))
        set(r, c, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3)
  finder(3, size - 4)
  finder(size - 4, 3)
  // Alignment
  const pos = ALIGNMENT[version]
  const last = pos.length - 1
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(pos[i] + dr, pos[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
      }
    }
  }
  // Reserve format areas (filled per mask) and the dark module.
  drawFormat(m, fn, 0)
  // Version information (v7+)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(b, a, dark)
      set(a, b, dark)
    }
  }
}

function formatBits(mask) {
  const data = (EC_M_FORMAT_BITS << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

function drawFormat(m, fn, mask) {
  const size = m.length
  const bits = formatBits(mask)
  const bit = (i) => ((bits >>> i) & 1) === 1
  const set = (r, c, dark) => { m[r][c] = dark ? 1 : 0; fn[r][c] = 1 }
  // Around the top-left finder
  for (let i = 0; i <= 5; i++) set(i, 8, bit(i))
  set(7, 8, bit(6))
  set(8, 8, bit(7))
  set(8, 7, bit(8))
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i))
  // Split copy: top-right and bottom-left
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i))
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i))
  set(size - 8, 8, true) // dark module
}

function placeData(m, fn, codewords, version) {
  const size = m.length
  const totalBits = codewords.length * 8 + REMAINDER_BITS[version]
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const c = right - j
        if (fn[r][c]) continue
        if (i < totalBits) {
          const byte = codewords[i >>> 3]
          m[r][c] = byte === undefined ? 0 : (byte >>> (7 - (i & 7))) & 1
          i++
        }
      }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
]

function applyMask(m, fn, mask) {
  const f = MASKS[mask]
  const size = m.length
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && f(r, c)) m[r][c] ^= 1
}

// Penalty score (N1 = 3, N2 = 3, N3 = 40, N4 = 10).
export function penalty(m) {
  const size = m.length
  let p = 0
  // N1: runs of 5+ same-colour modules in a row / column
  for (let r = 0; r < size; r++) {
    let runRow = 0
    let runCol = 0
    let lastRow = -1
    let lastCol = -1
    for (let c = 0; c < size; c++) {
      const a = m[r][c]
      if (a === lastRow) runRow++
      else { if (runRow >= 5) p += 3 + (runRow - 5); lastRow = a; runRow = 1 }
      const b = m[c][r]
      if (b === lastCol) runCol++
      else { if (runCol >= 5) p += 3 + (runCol - 5); lastCol = b; runCol = 1 }
    }
    if (runRow >= 5) p += 3 + (runRow - 5)
    if (runCol >= 5) p += 3 + (runCol - 5)
  }
  // N2: 2x2 blocks of one colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1]
      if (s === 0 || s === 4) p += 3
    }
  }
  // N3: finder-like 1:1:3:1:1 with 4 light modules on either side
  let n3 = 0
  for (let r = 0; r < size; r++) {
    let bitsRow = 0
    let bitsCol = 0
    for (let c = 0; c < size; c++) {
      bitsRow = ((bitsRow << 1) & 0x7ff) | m[r][c]
      if (c >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) n3++
      bitsCol = ((bitsCol << 1) & 0x7ff) | m[c][r]
      if (c >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) n3++
    }
  }
  p += n3 * 40
  // N4: dark/light balance
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c]
  const k = Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10)
  p += k * 10
  return p
}

/**
 * Encodes `text` as a QR code (byte mode, ECC M).
 * options: { minVersion?: 1..10, mask?: 0..7 (forces the mask; default = lowest penalty) }
 * Throws if the text needs more than version 10.
 */
export function encodeQR(text, options = {}) {
  const bytes = utf8Bytes(text)
  const version = pickVersion(bytes.length, options.minVersion)
  if (!version) throw new Error(`QR: text too long (${bytes.length} bytes, max ${MAX_BYTES})`)
  const size = 17 + 4 * version
  const m = makeGrid(size)
  const fn = makeGrid(size)
  drawFunctionPatterns(m, fn, version)
  placeData(m, fn, buildCodewords(bytes, version), version)

  let mask = options.mask
  if (!(mask >= 0 && mask <= 7)) {
    let best = Infinity
    for (let k = 0; k < 8; k++) {
      applyMask(m, fn, k)
      drawFormat(m, fn, k)
      const score = penalty(m)
      if (score < best) { best = score; mask = k }
      applyMask(m, fn, k) // undo (XOR)
    }
  }
  applyMask(m, fn, mask)
  drawFormat(m, fn, mask)
  return { version, size, mask, modules: m, get: (r, c) => m[r]?.[c] === 1 }
}

/** SVG path data ("M x y h1 v1 h-1 z" per dark module, merged per row run), with a quiet zone. */
export function qrPath(qr, quiet = 4) {
  let d = ''
  for (let r = 0; r < qr.size; r++) {
    let c = 0
    while (c < qr.size) {
      if (!qr.modules[r][c]) { c++; continue }
      const start = c
      while (c < qr.size && qr.modules[r][c]) c++
      d += `M${start + quiet} ${r + quiet}h${c - start}v1h-${c - start}z`
    }
  }
  return d
}
