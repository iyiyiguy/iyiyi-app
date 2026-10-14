// Chess ratings (pure math, no storage). Two separate ratings are kept (see arcadeStats.js):
//   - vs AI:  Elo against the engine's nominal level strength (CHESS_AI_RATINGS).
//   - Online: Elo-lite between two people, updated after every finished online game.
//
// Online determinism: when an online game ends, BOTH clients compute both players' new
// ratings from the same inputs, which the host freezes into the game state before the first
// move (state.ratings = { w: { r, n }, b: { r, n } }, r = rating, n = rated games so far) plus
// the host's final result. So the two phones always agree on the change, and each phone
// stores only its own new rating. The K factor shrinks as a player gets more rated games
// (a Glicko-like "provisional" period without tracking deviation).
//
// Online ratings live on the device (AsyncStorage via arcadeStats), so the UI labels them
// "Online (this device)". When a server-side rating exists, swap the storage, not this math.

export const ONLINE_START_RATING = 1000
export const RATING_FLOOR = 100

export function eloExpected(me, opp) {
  return 1 / (1 + Math.pow(10, (opp - me) / 400))
}

/** K factor for an online player with `games` rated games: 40 → 32 → 20. */
export function onlineK(games) {
  const n = Number(games) || 0
  return n < 10 ? 40 : n < 30 ? 32 : 20
}

const scoreOf = (result) => (result === 'win' ? 1 : result === 'draw' ? 0.5 : 0)

/**
 * One player's online rating update.
 * @param {number} me    rating before the game
 * @param {number} opp   opponent's rating before the game
 * @param {'win'|'loss'|'draw'} result  from `me`'s side
 * @param {number} games `me`'s rated online games before this one
 * @returns {{ before: number, after: number, delta: number }}
 */
export function onlineRatingUpdate(me, opp, result, games = 0) {
  const before = Number.isFinite(me) ? Math.round(me) : ONLINE_START_RATING
  const o = Number.isFinite(opp) ? Math.round(opp) : ONLINE_START_RATING
  const after = Math.max(RATING_FLOOR, Math.round(before + onlineK(games) * (scoreOf(result) - eloExpected(before, o))))
  return { before, after, delta: after - before }
}

const seat = (x) => ({
  r: Number.isFinite(Number(x?.r)) ? Math.round(Number(x.r)) : ONLINE_START_RATING,
  n: Number.isFinite(Number(x?.n)) && Number(x.n) >= 0 ? Math.floor(Number(x.n)) : 0,
})

/**
 * Both players' updates for a finished online game, from the host's final state.
 * Returns null for games that don't count (no result, aborted).
 * @param {{ result?: { winner: 'w'|'b'|null, reason: string }, ratings?: object }} state
 * @param {{ w?: {r,n}, b?: {r,n} }} [fallback] ratings to use for a seat the host didn't freeze
 * @returns {null | { w: {before,after,delta}, b: {before,after,delta} }}
 */
export function onlineGameUpdates(state, fallback = {}) {
  const r = state?.result
  if (!r || r.reason === 'aborted') return null
  const w = seat(state?.ratings?.w || fallback.w)
  const b = seat(state?.ratings?.b || fallback.b)
  const res = (c) => (!r.winner ? 'draw' : r.winner === c ? 'win' : 'loss')
  return {
    w: onlineRatingUpdate(w.r, b.r, res('w'), w.n),
    b: onlineRatingUpdate(b.r, w.r, res('b'), b.n),
  }
}
