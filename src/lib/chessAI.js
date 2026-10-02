// Chess AI: negamax + alpha-beta with move ordering (MVV-LVA, previous best move first),
// quiescence search on captures, and piece-square-table evaluation.
//
// Rules/move generation come from chess.js. For speed the search uses chess.js's
// internal move generator (_moves/_makeMove/_undoMove, pinned to chess.js 1.4.x) and
// falls back to the public API if those ever disappear.
//
// The search is async: it yields to the event loop (setTimeout 0) between root moves
// and has a hard time budget, so the UI keeps rendering while the AI "thinks".
import { Chess } from 'chess.js'

export const DIFFICULTIES = ['easy', 'medium', 'hard']

const LEVELS = {
  // depth 1, no quiescence, heavy noise: misses recaptures and makes human-ish mistakes
  easy: { maxDepth: 1, qDepth: 0, budgetMs: 400, noise: 140 },
  medium: { maxDepth: 2, qDepth: 4, budgetMs: 1000, noise: 0 },
  hard: { maxDepth: 3, qDepth: 6, budgetMs: 2600, noise: 0 },
}

export const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const MATE = 100000
const INF = 1e9

// Piece-square tables from White's point of view; index 0 = a8, 63 = h1.
// (Tomasz Michniewski's "Simplified Evaluation Function".)
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
}

// Static evaluation of a list of { type, color, idx } pieces (idx 0 = a8).
// Returns centipawns from the side-to-move's point of view.
function evalPieces(pieces, turn) {
  let nonPawn = 0
  for (let i = 0; i < pieces.length; i++) {
    const t = pieces[i].type
    if (t !== 'p' && t !== 'k') nonPawn += VAL[t]
  }
  const endgame = nonPawn <= 1800
  let score = 0
  for (let i = 0; i < pieces.length; i++) {
    const { type, color, idx } = pieces[i]
    const tableIdx = color === 'w' ? idx : (7 - (idx >> 3)) * 8 + (idx & 7)
    const table = type === 'k' && endgame ? PST.kEnd : PST[type]
    const v = VAL[type] + table[tableIdx]
    score += color === 'w' ? v : -v
  }
  return turn === 'w' ? score : -score
}

const FILES = 'abcdefgh'
const alg0x88 = (sq) => FILES[sq & 15] + (8 - (sq >> 4))

function hasInternals(c) {
  return (
    typeof c._moves === 'function' &&
    typeof c._makeMove === 'function' &&
    typeof c._undoMove === 'function' &&
    typeof c._isKingAttacked === 'function' &&
    Array.isArray(c._board)
  )
}

// Uniform move interface over chess.js internals (fast) or public API (fallback).
function makeAdapter(chess) {
  if (hasInternals(chess)) {
    return {
      gen: () => chess._moves({ legal: true }),
      make: (m) => chess._makeMove(m),
      undo: () => chess._undoMove(),
      inCheck: () => chess._isKingAttacked(chess._turn),
      halfMoves: () => chess._halfMoves,
      evaluate: () => {
        const pieces = []
        const b = chess._board
        for (let sq = 0; sq < 120; sq++) {
          if (sq & 0x88) { sq += 7; continue }
          const p = b[sq]
          if (p) pieces.push({ type: p.type, color: p.color, idx: (sq >> 4) * 8 + (sq & 7) })
        }
        return evalPieces(pieces, chess._turn)
      },
      toPublic: (m) => ({ from: alg0x88(m.from), to: alg0x88(m.to), promotion: m.promotion }),
      same: (a, b) => a.from === b.from && a.to === b.to && a.promotion === b.promotion,
    }
  }
  return {
    gen: () => chess.moves({ verbose: true }),
    make: (m) => chess.move({ from: m.from, to: m.to, promotion: m.promotion }),
    undo: () => chess.undo(),
    inCheck: () => chess.inCheck(),
    halfMoves: () => {
      const parts = chess.fen().split(' ')
      return Number(parts[4]) || 0
    },
    evaluate: () => {
      const pieces = []
      chess.board().forEach((row, r) => row.forEach((p, c) => {
        if (p) pieces.push({ type: p.type, color: p.color, idx: r * 8 + c })
      }))
      return evalPieces(pieces, chess.turn())
    },
    toPublic: (m) => ({ from: m.from, to: m.to, promotion: m.promotion }),
    same: (a, b) => a.from === b.from && a.to === b.to && a.promotion === b.promotion,
  }
}

const ABORT = { abort: true }

function orderScore(m, pv, A) {
  if (pv && A.same(m, pv)) return 1e7
  let s = 0
  if (m.captured) s += 10000 + 10 * VAL[m.captured] - VAL[m.piece]
  if (m.promotion) s += 9000 + VAL[m.promotion]
  return s
}

function orderMoves(moves, pv, A) {
  const scored = moves.map((m) => ({ m, s: orderScore(m, pv, A) }))
  scored.sort((a, b) => b.s - a.s)
  return scored.map((x) => x.m)
}

function quiesce(ctx, alpha, beta, ply, qDepth) {
  if ((++ctx.nodes & 127) === 0 && Date.now() > ctx.hardStop) throw ABORT
  const A = ctx.A
  const stand = A.evaluate()
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  if (qDepth <= 0) return alpha
  const moves = A.gen().filter((m) => m.captured || m.promotion)
  if (moves.length === 0) return alpha
  const ordered = orderMoves(moves, null, A)
  for (let i = 0; i < ordered.length; i++) {
    A.make(ordered[i])
    const score = -quiesce(ctx, -beta, -alpha, ply + 1, qDepth - 1)
    A.undo()
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function negamax(ctx, depth, alpha, beta, ply) {
  if ((++ctx.nodes & 127) === 0 && Date.now() > ctx.hardStop) throw ABORT
  const A = ctx.A
  const moves = A.gen()
  if (moves.length === 0) return A.inCheck() ? -MATE + ply : 0
  if (A.halfMoves() >= 100) return 0
  if (depth <= 0) return ctx.qDepth > 0 ? quiesce(ctx, alpha, beta, ply, ctx.qDepth) : A.evaluate()
  const ordered = orderMoves(moves, null, A)
  let best = -INF
  for (let i = 0; i < ordered.length; i++) {
    A.make(ordered[i])
    const score = -negamax(ctx, depth - 1, -beta, -alpha, ply + 1)
    A.undo()
    if (score > best) best = score
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return best
}

const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0))

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  return arr
}

/**
 * Pick a move for the side to move in `fen`.
 * @param {string} fen
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {{ shouldAbort?: () => boolean }} [opts]  checked between chunks; return true to cancel
 * @returns {Promise<{ from: string, to: string, promotion?: string } | null>}
 */
export async function findBestMove(fen, difficulty = 'medium', { shouldAbort } = {}) {
  const cfg = LEVELS[difficulty] || LEVELS.medium
  const chess = new Chess(fen)
  const A = makeAdapter(chess)
  const rootMoves = shuffle(A.gen())
  if (rootMoves.length === 0) return null
  if (rootMoves.length === 1) return A.toPublic(rootMoves[0])

  const start = Date.now()
  const ctx = { A, nodes: 0, hardStop: Infinity, qDepth: cfg.qDepth }

  // Medium/hard rely on the shuffled root order for variety: among equal scores the
  // first one searched wins, and scores of moves that fail low are only bounds, so
  // adding noise there would be unsound.

  // Easy: exact one-ply scores for every move plus random noise.
  if (cfg.noise > 0) {
    let best = null
    let bestScore = -INF
    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i]
      A.make(m)
      const score = -negamax(ctx, 0, -INF, INF, 1) + (Math.random() * 2 - 1) * cfg.noise
      A.undo()
      if (score > bestScore) { bestScore = score; best = m }
    }
    await yieldToUI()
    if (shouldAbort && shouldAbort()) return null
    return A.toPublic(best)
  }

  let pv = null
  let pvScore = -INF
  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    // Depth 1 always completes so there's always a legal answer.
    ctx.hardStop = depth === 1 ? Infinity : start + cfg.budgetMs
    const ordered = orderMoves(rootMoves, pv, A)
    let alpha = -INF
    let bestAtDepth = null
    let bestScoreAtDepth = -INF
    let aborted = false
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i]
      A.make(m)
      let score
      try {
        score = -negamax(ctx, depth - 1, -INF, -alpha, 1)
      } catch (e) {
        A.undo()
        if (e === ABORT) { aborted = true; break }
        throw e
      }
      A.undo()
      if (score > bestScoreAtDepth) { bestScoreAtDepth = score; bestAtDepth = m }
      if (score > alpha) alpha = score
      await yieldToUI()
      if (shouldAbort && shouldAbort()) return null
    }
    if (!aborted) {
      pv = bestAtDepth
      pvScore = bestScoreAtDepth
      if (pvScore >= MATE - 100) break // found a forced mate, no need to go deeper
    } else {
      // The previous best was searched first, so a better move found before the
      // timeout is still a safe improvement.
      if (bestAtDepth && pv && !A.same(bestAtDepth, pv)) pv = bestAtDepth
      break
    }
    if (Date.now() - start > cfg.budgetMs * 0.5) break // next depth won't finish in time
  }
  if (shouldAbort && shouldAbort()) return null
  return A.toPublic(pv || rootMoves[0])
}
