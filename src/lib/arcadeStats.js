// Real, local arcade stats for the signed-in player, persisted with AsyncStorage.
//
// Everything here is earned by actually playing: wins/losses/draws and best scores
// per game, an Elo-style chess rating from games against the built-in AI, and
// "arcade points" that are awarded for playing and can be spent to unlock Laser Tag
// guns (see src/lib/guns.js). Coins never involve money; the only purchased item kept
// here is the Laser Tag UAV balance (a consumable In-App Purchase, see src/lib/uav.js).
//
// Stats are stored per account (keyed by the Supabase user id) so a second account
// on the same device starts fresh. All writes go through one serial queue so two
// results recorded back-to-back can't overwrite each other.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const KEY_PREFIX = 'arcade_stats_v1'

// Weapons every player owns from the start (see guns.js).
export const FREE_GUN_IDS = ['pistol', 'uzi']

// Game ids used across the arcade. Multiplayer ids match navigation params for
// GameLobby ('laser-tag' | 'spider' | 'beside-them').
export const ARCADE_GAME_IDS = ['chess', 'word-race', 'laser-tag', 'spider', 'beside-them', 'battle-royale']

export const CHESS_START_RATING = 1000
// Approximate playing strength of each AI level, used as the opponent rating.
export const CHESS_AI_RATINGS = { easy: 700, medium: 1100, hard: 1450 }

// Points awarded per finished game.
const CHESS_POINTS = {
  easy: { win: 15, draw: 8, loss: 4 },
  medium: { win: 30, draw: 15, loss: 5 },
  hard: { win: 60, draw: 30, loss: 6 },
}
const CHESS_LOCAL_POINTS = 10 // pass & play, only for games of 10+ plies
const MULTIPLAYER_POINTS = { win: 40, draw: 20, loss: 10 }

const emptyGame = () => ({
  played: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  bestScore: null,
  totalScore: 0,
  lastPlayed: null,
})

const defaultState = () => ({
  version: 1,
  points: 0, // spendable balance
  lifetimePoints: 0, // never decreases
  games: Object.fromEntries(ARCADE_GAME_IDS.map((id) => [id, emptyGame()])),
  chess: {
    rating: CHESS_START_RATING,
    peakRating: CHESS_START_RATING,
    ratedGames: 0,
    vsAI: { easy: { w: 0, l: 0, d: 0 }, medium: { w: 0, l: 0, d: 0 }, hard: { w: 0, l: 0, d: 0 } },
    localGames: 0,
  },
  wordRace: { bestWords: 0, totalWords: 0, bestStreak: 0 },
  unlockedGuns: [...FREE_GUN_IDS],
  equippedGun: 'pistol',
  uavs: 0, // purchased Laser Tag UAVs (see src/lib/uav.js)
  uavTxns: [], // store transaction ids already credited (dedupe for consumable IAP)
  recent: [], // last 20 results: { gameId, result, score, points, at }
})

const withFree = (ids) => [...FREE_GUN_IDS, ...ids.filter((id) => typeof id === 'string' && !FREE_GUN_IDS.includes(id))]

// Merge a stored blob onto defaults so older/partial data never crashes readers.
function normalize(raw) {
  const base = defaultState()
  if (!raw || typeof raw !== 'object') return base
  const games = { ...base.games }
  for (const id of Object.keys(raw.games || {})) games[id] = { ...emptyGame(), ...raw.games[id] }
  return {
    ...base,
    ...raw,
    games,
    chess: {
      ...base.chess,
      ...(raw.chess || {}),
      vsAI: { ...base.chess.vsAI, ...((raw.chess && raw.chess.vsAI) || {}) },
    },
    wordRace: { ...base.wordRace, ...(raw.wordRace || {}) },
    unlockedGuns: withFree(Array.isArray(raw.unlockedGuns) ? raw.unlockedGuns : []),
    recent: Array.isArray(raw.recent) ? raw.recent : [],
    uavs: Number.isFinite(raw.uavs) && raw.uavs > 0 ? Math.floor(raw.uavs) : 0,
    uavTxns: Array.isArray(raw.uavTxns) ? raw.uavTxns.filter((x) => typeof x === 'string').slice(-100) : [],
  }
}

let cache = null
let cacheKey = null
let queue = Promise.resolve()
const listeners = new Set()

async function storageKey() {
  try {
    const { data } = await supabase.auth.getSession()
    const uid = data?.session?.user?.id
    return `${KEY_PREFIX}:${uid || 'guest'}`
  } catch {
    return `${KEY_PREFIX}:guest`
  }
}

async function readState() {
  const key = await storageKey()
  if (cache && cacheKey === key) return cache
  let parsed = null
  try {
    const raw = await AsyncStorage.getItem(key)
    parsed = raw ? JSON.parse(raw) : null
  } catch (e) {
    console.warn('arcadeStats: read failed', e)
  }
  cache = normalize(parsed)
  cacheKey = key
  return cache
}

// Serialised read-modify-write. `fn` receives a deep copy and returns
// { state, result } (or just the new state).
function mutate(fn) {
  const run = async () => {
    const current = await readState()
    const draft = JSON.parse(JSON.stringify(current))
    const out = fn(draft) || {}
    const next = out.state || draft
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(next))
    } catch (e) {
      console.warn('arcadeStats: write failed', e)
    }
    cache = next
    listeners.forEach((l) => {
      try { l(next) } catch {}
    })
    return out.result
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

/** Load the current player's arcade stats (never rejects). */
export async function loadArcadeStats() {
  try {
    await queue
    return await readState()
  } catch {
    return defaultState()
  }
}

/** Subscribe to stat changes; returns an unsubscribe function. */
export function subscribeArcadeStats(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function addPoints(s, n) {
  const pts = Math.max(0, Math.round(n || 0))
  s.points += pts
  s.lifetimePoints += pts
  return pts
}

function applyResult(s, gameId, result, score) {
  const g = s.games[gameId] || (s.games[gameId] = emptyGame())
  g.played += 1
  if (result === 'win') g.wins += 1
  else if (result === 'loss') g.losses += 1
  else if (result === 'draw') g.draws += 1
  if (typeof score === 'number' && Number.isFinite(score)) {
    g.totalScore += score
    if (g.bestScore == null || score > g.bestScore) g.bestScore = score
  }
  g.lastPlayed = new Date().toISOString()
}

function pushRecent(s, entry) {
  s.recent = [{ ...entry, at: new Date().toISOString() }, ...s.recent].slice(0, 20)
}

function eloExpected(me, opp) {
  return 1 / (1 + Math.pow(10, (opp - me) / 400))
}

/**
 * Record a finished chess game.
 * @param {{ mode: 'ai'|'local', difficulty?: 'easy'|'medium'|'hard', result: 'win'|'loss'|'draw', plies?: number }} p
 *   For mode 'local' (pass & play) `result` is ignored for W/L (both players share
 *   the device) and the game only counts toward games played.
 * @returns {Promise<{ pointsEarned: number, ratingBefore?: number, ratingAfter?: number, ratingDelta?: number }>}
 */
export function recordChessGame({ mode, difficulty = 'medium', result, plies = 0 }) {
  return mutate((s) => {
    if (mode === 'ai') {
      const level = CHESS_POINTS[difficulty] ? difficulty : 'medium'
      applyResult(s, 'chess', result)
      const rec = s.chess.vsAI[level]
      if (result === 'win') rec.w += 1
      else if (result === 'loss') rec.l += 1
      else rec.d += 1
      const before = s.chess.rating
      const k = s.chess.ratedGames < 20 ? 40 : 24
      const actual = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
      const after = Math.max(100, Math.round(before + k * (actual - eloExpected(before, CHESS_AI_RATINGS[level]))))
      s.chess.rating = after
      s.chess.ratedGames += 1
      s.chess.peakRating = Math.max(s.chess.peakRating, after)
      const pointsEarned = addPoints(s, CHESS_POINTS[level][result] || 0)
      pushRecent(s, { gameId: 'chess', result, label: `vs ${level} AI`, points: pointsEarned })
      return { result: { pointsEarned, ratingBefore: before, ratingAfter: after, ratingDelta: after - before } }
    }
    // Pass & play
    const g = s.games.chess
    g.played += 1
    g.lastPlayed = new Date().toISOString()
    s.chess.localGames += 1
    const pointsEarned = plies >= 10 ? addPoints(s, CHESS_LOCAL_POINTS) : 0
    pushRecent(s, { gameId: 'chess', result: 'local', label: 'Pass & play', points: pointsEarned })
    return { result: { pointsEarned } }
  })
}

/**
 * Record a finished Word Race run.
 * @param {{ score: number, wordsSolved: number, bestStreak: number }} p
 * @returns {Promise<{ pointsEarned: number, isNewBest: boolean, previousBest: number|null }>}
 */
export function recordWordRace({ score, wordsSolved, bestStreak }) {
  return mutate((s) => {
    const previousBest = s.games['word-race'].bestScore
    applyResult(s, 'word-race', null, score)
    s.wordRace.totalWords += wordsSolved
    s.wordRace.bestWords = Math.max(s.wordRace.bestWords, wordsSolved)
    s.wordRace.bestStreak = Math.max(s.wordRace.bestStreak, bestStreak)
    const pointsEarned = addPoints(s, Math.floor(score / 25) + (wordsSolved > 0 ? 5 : 1))
    pushRecent(s, { gameId: 'word-race', result: 'score', score, points: pointsEarned })
    return { result: { pointsEarned, isNewBest: previousBest == null || score > previousBest, previousBest } }
  })
}

/**
 * Generic hook for the multiplayer games (Laser Tag, Spider Tag, Beside Them).
 * @param {'laser-tag'|'spider'|'beside-them'|string} gameId
 * @param {{ result?: 'win'|'loss'|'draw', score?: number, points?: number }} p
 *   `points` overrides the default award for the result.
 * @returns {Promise<{ pointsEarned: number }>}
 */
export function recordGameResult(gameId, { result, score, points } = {}) {
  return mutate((s) => {
    applyResult(s, gameId, result, score)
    const award = typeof points === 'number' ? points : MULTIPLAYER_POINTS[result] ?? 5
    const pointsEarned = addPoints(s, award)
    pushRecent(s, { gameId, result: result || 'played', score, points: pointsEarned })
    return { result: { pointsEarned } }
  })
}

/** Spend points. Resolves to true if the balance covered it. */
export function spendPoints(amount) {
  return mutate((s) => {
    if (amount < 0 || s.points < amount) return { result: false }
    s.points -= amount
    return { result: true }
  })
}

// Internal helpers for guns.js (kept here so the unlock + spend is one atomic write).
export function _unlockItem(id, cost) {
  return mutate((s) => {
    if (s.unlockedGuns.includes(id)) return { result: { ok: true, already: true } }
    if (s.points < cost) return { result: { ok: false, reason: 'insufficient', needed: cost - s.points } }
    s.points -= cost
    s.unlockedGuns.push(id)
    return { result: { ok: true } }
  })
}

// Adds items without spending points (owner/admin grant). Resolves true if anything changed.
export function _grantItems(ids) {
  return mutate((s) => {
    const missing = (ids || []).filter((id) => !s.unlockedGuns.includes(id))
    if (!missing.length) return { result: false }
    s.unlockedGuns = [...s.unlockedGuns, ...missing]
    return { result: true }
  })
}

export function _equipItem(id) {
  return mutate((s) => {
    if (!s.unlockedGuns.includes(id)) return { result: false }
    s.equippedGun = id
    return { result: true }
  })
}

// Laser Tag UAVs (internal helpers for uav.js / iap.js) --------------------

/** Spend one purchased UAV. Resolves true if the balance covered it. */
export function _spendUav() {
  return mutate((s) => {
    if (!(s.uavs > 0)) return { result: false }
    s.uavs -= 1
    return { result: true }
  })
}

/**
 * Credit purchased UAVs once per store transaction. Resolves
 * { credited: boolean, balance: number } — credited is false for a transaction id
 * that was already credited (the store can redeliver an unfinished transaction).
 */
export function _creditUavs(count, txnId) {
  return mutate((s) => {
    const n = Math.max(0, Math.floor(Number(count) || 0))
    const id = txnId ? String(txnId) : null
    if (id && s.uavTxns.includes(id)) return { result: { credited: false, balance: s.uavs } }
    s.uavs = (s.uavs || 0) + n
    if (id) s.uavTxns = [...s.uavTxns, id].slice(-100)
    return { result: { credited: true, balance: s.uavs } }
  })
}

// Derived summaries ---------------------------------------------------------

export function totalsFor(stats) {
  const games = Object.values(stats?.games || {})
  const sum = (k) => games.reduce((n, g) => n + (g[k] || 0), 0)
  const wins = sum('wins')
  const losses = sum('losses')
  const draws = sum('draws')
  const decided = wins + losses + draws
  return {
    played: sum('played'),
    wins,
    losses,
    draws,
    winRate: decided > 0 ? Math.round((wins / decided) * 100) : null,
  }
}

// Rank tiers by lifetime points (XP). Shown on the arcade hub and profile.
export const RANKS = [
  { id: 'rookie', name: 'Rookie', min: 0, color: '#9aa3c0' },
  { id: 'bronze', name: 'Bronze', min: 100, color: '#c98a55' },
  { id: 'silver', name: 'Silver', min: 300, color: '#c7d0e0' },
  { id: 'gold', name: 'Gold', min: 700, color: '#f2c14e' },
  { id: 'platinum', name: 'Platinum', min: 1500, color: '#7fe3d4' },
  { id: 'diamond', name: 'Diamond', min: 3000, color: '#8fb8ff' },
  { id: 'legend', name: 'Legend', min: 6000, color: '#ff7ad9' },
]

const XP_STEP = 50 // level n starts at XP_STEP * (n-1)^2

/** Rank + level for a lifetime-points total. Never throws. */
export function rankFor(lifetimePoints) {
  const xp = Math.max(0, Math.floor(Number(lifetimePoints) || 0))
  let idx = 0
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].min) idx = i
  const level = Math.floor(Math.sqrt(xp / XP_STEP)) + 1
  const from = XP_STEP * (level - 1) ** 2
  const to = XP_STEP * level ** 2
  return {
    ...RANKS[idx],
    index: idx,
    next: RANKS[idx + 1] || null,
    level,
    xp,
    levelProgress: to > from ? Math.min(1, (xp - from) / (to - from)) : 1,
    xpToNextLevel: Math.max(0, to - xp),
  }
}

export function winRateFor(g) {
  const decided = (g?.wins || 0) + (g?.losses || 0) + (g?.draws || 0)
  return decided > 0 ? Math.round((g.wins / decided) * 100) : null
}
