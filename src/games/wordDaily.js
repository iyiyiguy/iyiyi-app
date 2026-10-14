// What's the Word: Daily. Pure helpers (no React, no storage) so they can be tested headless.
//
// One shared word per calendar day. The word depends only on the player's LOCAL date (like
// NYT Wordle: everyone solves the same puzzle on the same date, and a new one unlocks at
// local midnight). It is picked from the answer list with a fixed, seeded permutation, so it
// is the same on every device, never repeats until the whole list has been used, and needs
// no server. Changing the ANSWERS list (order or length) changes future daily words, so
// treat that list as append-and-redeploy-at-midnight only.

export const DAILY_MAX_GUESSES = 6
export const DAILY_EPOCH = '2026-10-14' // puzzle #1
const DAY_MS = 86400000
const SEED = 0x5eed1e

const pad = (n) => String(n).padStart(2, '0')

/** Local calendar date as 'YYYY-MM-DD'. */
export function dateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole days since 1970-01-01 for a 'YYYY-MM-DD' key (time-zone independent). */
export function dayNumber(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS)
}

/** The key of the day before / after `key`. */
export function shiftKey(key, days) {
  const t = new Date(dayNumber(key) * DAY_MS + days * DAY_MS)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Puzzle number shown in the share text (#1 on DAILY_EPOCH). */
export function puzzleNumber(key) {
  return dayNumber(key) - dayNumber(DAILY_EPOCH) + 1
}

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const permCache = new Map()
function permutation(n, cycle) {
  const k = `${n}:${cycle}`
  if (permCache.has(k)) return permCache.get(k)
  const p = Array.from({ length: n }, (_, i) => i)
  const r = rng(SEED + cycle * 7919)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  if (permCache.size > 8) permCache.clear()
  permCache.set(k, p)
  return p
}

/** Index into a list of `n` answers for the day `key`. */
export function dailyIndex(key, n) {
  if (!(n > 0)) return 0
  const day = dayNumber(key) - dayNumber(DAILY_EPOCH)
  const cycle = Math.floor(day / n)
  const pos = ((day % n) + n) % n
  return permutation(n, cycle)[pos]
}

/** Today's (or `date`'s) answer, upper case. */
export function dailyAnswer(date, answers) {
  const key = typeof date === 'string' ? date : dateKey(date)
  const list = Array.isArray(answers) ? answers : []
  if (!list.length) return ''
  return String(list[dailyIndex(key, list.length)]).toUpperCase()
}

/** Milliseconds until the next local midnight. */
export function msUntilNextDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
  return Math.max(0, next.getTime() - d.getTime())
}

/** 'H:MM:SS' for the next-word countdown. */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

const SQUARE = { correct: '\u{1F7E9}', present: '\u{1F7E8}', absent: '⬛' }

/** One emoji row per guess (spoiler-free). */
export function shareGrid(scores) {
  return (scores || []).map((row) => row.map((s) => SQUARE[s] || SQUARE.absent).join('')).join('\n')
}

/**
 * Text for the Share sheet:
 *   What's the Word #12 4/6
 *   (blank line)
 *   grid rows...
 */
export function shareText({ key, scores, won, max = DAILY_MAX_GUESSES, streak }) {
  const tries = won ? String((scores || []).length) : 'X'
  const head = `What's the Word #${puzzleNumber(key)} ${tries}/${max}`
  const tail = streak > 1 ? `\nStreak ${streak}` : ''
  return `${head}\n\n${shareGrid(scores)}${tail}\n\nPlay on iYiYi`
}

// ---- Stats -----------------------------------------------------------------------------

export function emptyDailyStats() {
  return { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, lastWonKey: null, lastPlayedKey: null, dist: [0, 0, 0, 0, 0, 0] }
}

export function normalizeDailyStats(raw) {
  const base = emptyDailyStats()
  if (!raw || typeof raw !== 'object') return base
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  const dist = Array.isArray(raw.dist) ? base.dist.map((_, i) => num(raw.dist[i])) : base.dist
  return {
    played: num(raw.played),
    wins: num(raw.wins),
    currentStreak: num(raw.currentStreak),
    maxStreak: num(raw.maxStreak),
    lastWonKey: typeof raw.lastWonKey === 'string' ? raw.lastWonKey : null,
    lastPlayedKey: typeof raw.lastPlayedKey === 'string' ? raw.lastPlayedKey : null,
    dist,
  }
}

/**
 * Stats after finishing the puzzle for `key`. Recording the same day twice is a no-op, so a
 * re-render or a second device tap can't double count.
 */
export function applyDailyResult(stats, key, won, tries) {
  const s = normalizeDailyStats(stats)
  if (s.lastPlayedKey === key) return s
  s.played += 1
  s.lastPlayedKey = key
  if (won) {
    s.wins += 1
    s.currentStreak = s.lastWonKey === shiftKey(key, -1) ? s.currentStreak + 1 : 1
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak)
    s.lastWonKey = key
    const i = Math.min(DAILY_MAX_GUESSES, Math.max(1, tries)) - 1
    s.dist[i] += 1
  } else {
    s.currentStreak = 0
  }
  return s
}

/** Streak to show today: a streak whose last win is older than yesterday has lapsed. */
export function currentStreakFor(stats, todayKey) {
  const s = normalizeDailyStats(stats)
  if (!s.lastWonKey) return 0
  if (s.lastWonKey === todayKey || s.lastWonKey === shiftKey(todayKey, -1)) return s.currentStreak
  return 0
}

export function winPercent(stats) {
  const s = normalizeDailyStats(stats)
  return s.played ? Math.round((s.wins / s.played) * 100) : 0
}
