// "Auto" mode: writes a beat for the current kit in a chosen style. Rule-based (no AI service):
// each style has a groove skeleton plus probability layers, so every press gives a new but
// musical variation. Sampler pads (9-16) get a chopped-sample melody line when they're loaded.

const r = (p) => Math.random() < p

export const STYLES = [
  { id: 'trap', name: 'Trap', bpm: [130, 150] },
  { id: 'boombap', name: 'Boom Bap', bpm: [86, 96] },
  { id: 'house', name: 'House', bpm: [120, 126] },
  { id: 'lofi', name: 'Lo-fi', bpm: [70, 84] },
  { id: 'drill', name: 'Drill', bpm: [138, 146] },
  { id: 'afro', name: 'Afrobeats', bpm: [100, 112] },
  // These switch to their matching kit (the sound is half the style).
  { id: 'atl', name: 'ATL Bounce', bpm: [136, 150], kit: 'atl' },
  { id: 'church', name: 'Church Keys', bpm: [132, 146], kit: 'church' },
  { id: 'jersey', name: 'Jersey Club', bpm: [138, 145], kit: 'jersey' },
]
export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s]))
/** Best style for a kit (Auto-sample uses it). */
export function styleForKit(kitId) {
  return ({ house: 'house', lofi: 'lofi', boombap: 'boombap', atl: 'atl', church: 'church', piano: 'church', jersey: 'jersey' })[kitId] || 'trap'
}

// Which pad index plays each role (kit pads 0-7 follow the kit order; roles map by pad id).
function roleIndex(project) {
  const idx = {}
  project.pads.forEach((p, i) => {
    const id = p.src?.kind === 'kit' ? p.src.pad : null
    if (!id) return
    if (id === 'kick' && idx.kick == null) idx.kick = i
    if (id === 'bass') idx.bass = i
    if ((id === 'snare' || id === 'clap') && idx.snare == null) idx.snare = i
    if (id === 'clap') idx.clap = i
    if (id === 'hat') idx.hat = i
    if (id === 'openhat') idx.open = i
    if (id === 'squeak') idx.squeak = i
    if (id === 'vox') idx.vox = i
    if (id === 'fx') idx.fx = i
    if (id === 'keys' || id === 'bell') idx.keys = idx.keys ?? i
    if (['rim', 'snap', 'conga', 'cowbell', 'perc', 'shaker', 'tom', 'ride', 'keys'].includes(id) && idx.perc == null) idx.perc = i
    if (['shaker', 'ride', 'tom', 'conga'].includes(id)) idx.perc2 = i
  })
  return idx
}

function empty(project) {
  const len = project.steps || 16
  return project.pads.map(() => new Array(len).fill(0))
}

const set = (pat, i, s, v = 1) => { if (i != null && pat[i] && s < pat[i].length) pat[i][s] = v }

export function generateBeat(project, styleId = 'trap', { keepTempo = false } = {}) {
  const style = STYLES.find((s) => s.id === styleId) || STYLES[0]
  const len = project.steps || 16
  const pat = empty(project)
  const R = roleIndex(project)
  const bars = len / 16
  for (let b = 0; b < bars; b++) {
    const o = b * 16
    const last = b === bars - 1
    switch (style.id) {
      case 'trap':
      case 'drill': {
        const kicks = style.id === 'drill' ? [0, 6, 10] : [0, 7, 10]
        kicks.forEach((s) => set(pat, R.bass ?? R.kick, o + s, 2))
        if (r(0.6)) set(pat, R.kick, o + 14)
        if (r(0.4)) set(pat, R.kick, o + 3)
        set(pat, R.snare, o + (style.id === 'drill' ? 6 : 4), 2)
        set(pat, R.snare, o + 12, 2)
        if (style.id === 'drill') { pat[R.snare] && (pat[R.snare][o + 4] = 0); set(pat, R.snare, o + 12, 2) }
        for (let s = 0; s < 16; s += 2) set(pat, R.hat, o + s, s % 4 === 0 ? 2 : 1)
        // rolls
        const roll = r(0.5) ? 14 : 6
        if (r(0.8)) { set(pat, R.hat, o + roll); set(pat, R.hat, o + roll + 1) }
        if (r(0.5)) set(pat, R.hat, o + 11)
        if (r(0.5)) set(pat, R.open, o + (last ? 15 : 7))
        if (r(0.4)) set(pat, R.perc, o + 9)
        break
      }
      case 'atl': {
        // bouncy 808 line with pickups, tight hats with 1/32 and triplet-feel rolls
        const bass = R.bass ?? R.kick
        ;[0, 3, 10].forEach((s) => set(pat, bass, o + s, 2))
        if (r(0.6)) set(pat, bass, o + 7)
        if (r(0.5)) set(pat, bass, o + 13)
        set(pat, R.kick, o + 0, 2)
        if (r(0.5)) set(pat, R.kick, o + 10)
        set(pat, R.snare, o + 4, 2)
        set(pat, R.snare, o + 12, 2)
        if (r(0.6)) set(pat, R.clap, o + 12)
        for (let s = 0; s < 16; s++) if (s % 2 === 0 || r(0.25)) set(pat, R.hat, o + s, s % 4 === 0 ? 2 : 1)
        const roll = r(0.5) ? 12 : 6
        for (let s = roll; s < roll + 4; s++) set(pat, R.hat, o + s)
        if (r(0.5)) set(pat, R.open, o + 15)
        if (r(0.6)) [2, 9].forEach((s) => set(pat, R.perc, o + s))
        if (last && bars > 1) set(pat, R.fx, o)
        break
      }
      case 'church': {
        // organ / piano chord on the one, bouncy kick + 808, clap backbeat, tambourine shuffle
        set(pat, R.keys, o + 0, 2)
        if (r(0.7)) set(pat, R.keys, o + 6)
        if (r(0.5)) set(pat, R.keys, o + 10)
        ;[0, 7, 10].forEach((s) => set(pat, R.kick, o + s, 2))
        ;[0, 7, 10].forEach((s) => set(pat, R.bass, o + s, 2))
        if (r(0.5)) set(pat, R.bass, o + 14)
        set(pat, R.clap ?? R.snare, o + 4, 2)
        set(pat, R.clap ?? R.snare, o + 12, 2)
        if (r(0.4)) set(pat, R.snare, o + 15)
        for (let s = 0; s < 16; s += 2) set(pat, R.hat, o + s, s % 4 === 0 ? 2 : 1)
        if (r(0.7)) { set(pat, R.hat, o + 13); set(pat, R.hat, o + 15) }
        ;[2, 6, 10, 14].forEach((s) => r(0.7) && set(pat, R.perc, o + s))
        break
      }
      case 'jersey': {
        // the Jersey Club kick bounce, clap on 2 & 4 with pickups, squeaks and a "hey"
        const kicks = [[0, 3, 6, 8, 10], [0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14]][Math.floor(Math.random() * 3)]
        kicks.forEach((s, k) => set(pat, R.kick, o + s, k === 0 ? 2 : 1))
        set(pat, R.clap ?? R.snare, o + 4, 2)
        set(pat, R.clap ?? R.snare, o + 12, 2)
        if (r(0.6)) set(pat, R.clap ?? R.snare, o + 15)
        if (last) [13, 14, 15].forEach((s) => set(pat, R.snare, o + s))
        ;[2, 10].forEach((s) => r(0.75) && set(pat, R.squeak, o + s))
        if (r(0.4)) set(pat, R.squeak, o + 7)
        for (let s = 2; s < 16; s += 4) set(pat, R.hat, o + s)
        if (r(0.5)) set(pat, R.open, o + 14)
        if (last || r(0.3)) set(pat, R.vox, o + (r(0.5) ? 14 : 12))
        if (r(0.4)) set(pat, R.bass, o)
        break
      }
      case 'boombap': {
        set(pat, R.kick, o + 0, 2)
        if (r(0.7)) set(pat, R.kick, o + 7)
        set(pat, R.kick, o + 10, 2)
        if (r(0.5)) set(pat, R.kick, o + 13)
        set(pat, R.snare, o + 4, 2)
        set(pat, R.snare, o + 12, 2)
        if (r(0.35)) set(pat, R.snare, o + 15)
        for (let s = 0; s < 16; s += 2) set(pat, R.hat, o + s, s % 4 === 0 ? 2 : 1)
        if (r(0.6)) set(pat, R.open, o + 14)
        if (r(0.5)) { set(pat, R.perc, o + 3); set(pat, R.perc, o + 11) }
        break
      }
      case 'house': {
        for (let s = 0; s < 16; s += 4) set(pat, R.kick, o + s, 2)
        set(pat, R.clap ?? R.snare, o + 4, 2)
        set(pat, R.clap ?? R.snare, o + 12, 2)
        for (let s = 2; s < 16; s += 4) set(pat, R.open ?? R.hat, o + s)
        if (r(0.7)) for (let s = 0; s < 16; s++) if (s % 4 !== 2 && r(0.45)) set(pat, R.hat, o + s)
        if (r(0.6)) [3, 6, 10, 13].forEach((s) => r(0.6) && set(pat, R.perc, o + s))
        if (r(0.5)) [1, 9].forEach((s) => set(pat, R.perc2, o + s))
        break
      }
      case 'lofi': {
        set(pat, R.kick, o + 0, 2)
        if (r(0.6)) set(pat, R.kick, o + 3)
        set(pat, R.kick, o + 10)
        set(pat, R.snare, o + 4, 2)
        set(pat, R.snare, o + 12, 2)
        for (let s = 0; s < 16; s += 2) if (r(0.85)) set(pat, R.hat, o + s, s % 4 === 0 ? 2 : 1)
        if (r(0.5)) set(pat, R.perc2, o + 7)
        if (r(0.5)) set(pat, R.perc, o + 14)
        break
      }
      case 'afro': {
        ;[0, 7, 10].forEach((s) => set(pat, R.kick, o + s, 2))
        if (r(0.5)) set(pat, R.kick, o + 13)
        set(pat, R.snare, o + 12, 2)
        if (r(0.6)) set(pat, R.snare, o + 4)
        ;[0, 3, 6, 8, 11, 14].forEach((s) => set(pat, R.perc, o + s))
        for (let s = 0; s < 16; s += 2) set(pat, R.hat, o + s)
        if (r(0.6)) [5, 13].forEach((s) => set(pat, R.perc2, o + s))
        break
      }
      default:
        break
    }
  }
  // Sampler pads (8-15) that have a sound: a simple phrase over the bar.
  const samplePads = project.pads.map((p, i) => (i >= 8 && p.src ? i : null)).filter((i) => i != null)
  if (samplePads.length && style.id === 'jersey') {
    // Jersey Club flip: chop on the one, then rapid-fire stutters of the same chop
    for (let b = 0; b < bars; b++) {
      const o = b * 16
      const a = samplePads[(b * 2) % samplePads.length]
      const c = samplePads[(b * 2 + 1) % samplePads.length]
      set(pat, a, o + 0, 2)
      if (r(0.6)) set(pat, a, o + 3)
      set(pat, c, o + 6)
      const stutter = r(0.5) ? [8, 9, 10, 11] : [8, 10, 11]
      stutter.forEach((s) => set(pat, a, o + s))
      if (b === bars - 1 || r(0.5)) [12, 13, 14, 15].forEach((s) => set(pat, c, o + s))
      else set(pat, c, o + 12, 2)
    }
  } else if (samplePads.length) {
    const hitsPerBar = style.id === 'house' ? 4 : style.id === 'lofi' ? 2 : 3
    for (let b = 0; b < bars; b++) {
      const choices = [0, 3, 6, 8, 10, 12, 14]
      const used = new Set()
      for (let k = 0; k < hitsPerBar; k++) {
        let s = choices[Math.floor(Math.random() * choices.length)]
        if (k === 0) s = 0
        if (used.has(s)) continue
        used.add(s)
        set(pat, samplePads[(k + b) % samplePads.length], b * 16 + s, k === 0 ? 2 : 1)
      }
    }
  }
  const [lo, hi] = style.bpm
  const bpm = keepTempo ? project.bpm : Math.round(lo + Math.random() * (hi - lo))
  const swing = style.id === 'boombap' || style.id === 'lofi' ? 0.25 + Math.random() * 0.2 : style.id === 'house' ? 0.1 : 0
  return { ...project, pattern: pat, bpm, swing: keepTempo ? project.swing : Math.round(swing * 100) / 100 }
}
