// Online chess referee for glasses, matching the iYiYi app (src/games/OnlineChessGame.js) so a
// phone and a pair of glasses (or two pairs of glasses) can play each other in the same room.
import { Chess } from './chessjs.js'

const ABANDON_MS = 40000
export const FIRST_MOVE_MS = 45000
const DEFAULT_TC = { base: 10 * 60 * 1000, inc: 0 }
export const other = (c) => (c === 'w' ? 'b' : 'w')

function replay(moves) { const g = new Chess(); for (const san of moves || []) { try { g.move(san) } catch (e) { break } } return g }
function describeResult(game) {
  if (game.isCheckmate()) return { winner: game.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' }
  if (game.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (game.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' }
  if (game.isThreefoldRepetition()) return { winner: null, reason: 'threefold repetition' }
  if (game.isDrawByFiftyMoves()) return { winner: null, reason: '50-move rule' }
  if (game.isDraw()) return { winner: null, reason: 'draw' }
  return null
}
export function timeControl(info) {
  const raw = info && info.settings ? (info.settings.clock != null ? info.settings.clock : info.settings.timeControl) : undefined
  if (raw === 'none' || raw === 'off' || raw === false) return null
  const m = /^(\d+)\+(\d+)$/.exec(String(raw == null ? '' : raw))
  if (m && Number(m[1]) > 0) return { base: Number(m[1]) * 60000, inc: Number(m[2]) * 1000 }
  return { ...DEFAULT_TC }
}
export const turnOf = (s) => (((s && s.moves && s.moves.length) || 0) % 2 === 0 ? 'w' : 'b')
export const clocksRunning = (s) => !!(s && s.clock) && !s.result && ((s.moves && s.moves.length) || 0) >= 2
export function clockLeft(s, c, now) {
  if (!s || !s.clock) return null
  const base = Number(s.clock[c]) || 0
  if (!clocksRunning(s) || turnOf(s) !== c) return base
  return Math.max(0, base - Math.max(0, now - (s.turnAt != null ? s.turnAt : now)))
}
function hasMatingMaterial(fen, color) {
  let minors = 0
  for (const ch of String(fen || '').split(' ')[0]) {
    if (!/[a-z]/i.test(ch)) continue
    if (color === 'w' ? ch !== ch.toUpperCase() : ch !== ch.toLowerCase()) continue
    const t = ch.toLowerCase()
    if (t === 'p' || t === 'r' || t === 'q') return true
    if (t === 'n' || t === 'b') minors += 1
  }
  return minors >= 2
}
function timeoutResult(s, flagged) { const winner = other(flagged); return hasMatingMaterial(s.fen, winner) ? { winner, reason: 'timeout' } : { winner: null, reason: 'timeout vs insufficient material' } }
function settledClock(s, now) { if (!clocksRunning(s)) return s.clock == null ? null : s.clock; const c = turnOf(s); return { ...s.clock, [c]: clockLeft(s, c, now) } }

export function newChessState(roster, info, hostId, now = Date.now()) {
  const players = (roster || []).slice(0, 2)
  const host = players.find((p) => p.id === hostId) || players[0]
  const guest = players.find((p) => p.id !== (host && host.id)) || null
  const pref = info && info.settings && info.settings.hostColor
  const hostColor = pref === 'w' || pref === 'b' ? pref : Math.random() < 0.5 ? 'w' : 'b'
  const seat = (p) => (p ? { id: p.id, name: p.username || 'Player', avatar: p.avatar || null } : null)
  const seats = hostColor === 'w' ? { w: seat(host), b: seat(guest) } : { w: seat(guest), b: seat(host) }
  const tc = timeControl(info)
  return { game: 'chess', round: (info && info.round) || 1, gameNo: 1, players: seats, moves: [], fen: new Chess().fen(), lastMove: null, result: null, drawOffer: null, rematch: {}, tc, clock: tc ? { w: tc.base, b: tc.base } : null, turnAt: now }
}
export function colorOf(s, id) { if (s && s.players && s.players.w && s.players.w.id === id) return 'w'; if (s && s.players && s.players.b && s.players.b.id === id) return 'b'; return null }
export function checkClock(s, now) {
  if (!s || s.result || !s.clock) return s
  const c = turnOf(s)
  if (((s.moves && s.moves.length) || 0) < 2) {
    if (typeof s.turnAt === 'number' && now - s.turnAt > FIRST_MOVE_MS) return { ...s, result: { winner: null, reason: 'aborted', by: c }, drawOffer: null }
    return s
  }
  if (clockLeft(s, c, now) <= 0) return { ...s, clock: { ...s.clock, [c]: 0 }, result: timeoutResult(s, c), drawOffer: null }
  return s
}
export function applyAction(s, action, from, now = Date.now()) {
  const color = colorOf(s, from)
  if (!color || !action) return s
  const settle = () => (s.clock ? { clock: settledClock(s, now) } : null)
  switch (action.type) {
    case 'move': {
      if (s.result) return s
      if (typeof action.ply === 'number' && action.ply !== s.moves.length) return s
      const g = replay(s.moves)
      if (g.turn() !== color) return s
      const running = clocksRunning(s)
      const left = running ? clockLeft(s, color, now) : null
      if (running && left <= 0) return { ...s, clock: { ...s.clock, [color]: 0 }, result: timeoutResult(s, color), drawOffer: null }
      let mv
      try { mv = g.move({ from: action.from, to: action.to, promotion: action.promotion || undefined }) } catch (e) { return s }
      if (!mv) return s
      const r = describeResult(g)
      const clock = s.clock ? (running ? { ...s.clock, [color]: left + ((s.tc && s.tc.inc) || 0) } : s.clock) : s.clock
      return { ...s, moves: [...s.moves, mv.san], fen: g.fen(), lastMove: { from: mv.from, to: mv.to }, drawOffer: !r && s.drawOffer === color ? color : null, result: r || null, ...(s.clock ? { clock, turnAt: now } : null) }
    }
    case 'resign': if (s.result) return s; return { ...s, result: { winner: other(color), reason: 'resignation' }, drawOffer: null, ...settle() }
    case 'draw_offer': if (s.result || s.drawOffer) return s; return { ...s, drawOffer: color }
    case 'draw_accept': if (s.result || !s.drawOffer || s.drawOffer === color) return s; return { ...s, result: { winner: null, reason: 'agreement' }, drawOffer: null, ...settle() }
    case 'draw_decline': if (!s.drawOffer || s.drawOffer === color) return s; return { ...s, drawOffer: null }
    case 'rematch': {
      if (!s.result) return s
      const rematch = { ...s.rematch, [from]: true }
      const both = s.players.w && s.players.b && rematch[s.players.w.id] && rematch[s.players.b.id]
      if (!both) return { ...s, rematch }
      const tc = s.tc || null
      return { ...s, ratings: null, gameNo: (s.gameNo || 1) + 1, players: { w: s.players.b, b: s.players.w }, moves: [], fen: new Chess().fen(), lastMove: null, result: null, drawOffer: null, rematch: {}, ...(s.clock || tc ? { clock: tc ? { w: tc.base, b: tc.base } : null, turnAt: now } : null) }
    }
    default: return s
  }
}
/** Host loop: start the game when the round begins, flag fall, abandonment. */
export function hostTick(room, absent) {
  const s = room.getState(), roundNo = room.info.round || 0
  if (roundNo > 0 && (!s || s.game !== 'chess' || s.round !== roundNo)) { if (room.roster.length >= 2) room.publishState(newChessState(room.roster, room.info, room.hostId, Date.now())); return }
  if (!s || s.result) return
  const t = Date.now()
  const f = checkClock(s, t); if (f !== s) { room.publishState(f); return }
  const present = room.presentIds()
  for (const c of ['w', 'b']) {
    const id = s.players && s.players[c] && s.players[c].id
    if (!id) continue
    if (present.has(id)) { delete absent[id]; continue }
    if (!absent[id]) absent[id] = t
    if (t - absent[id] > ABANDON_MS) { room.publishState({ ...s, result: { winner: other(c), reason: 'abandonment' }, drawOffer: null, ...(s.clock ? { clock: settledClock(s, t) } : null) }); return }
  }
}

// ---- FEN <-> the glasses chess engine (board index = rank * 8 + file, rank 0 = White's back rank)
export function fenToState(fen) {
  const [place, side, cr, ep, half] = String(fen).split(' ')
  const b = new Array(64).fill('')
  place.split('/').forEach((row, i) => { let f = 0; const r = 7 - i; for (const ch of row) { if (/\d/.test(ch)) f += Number(ch); else { b[r * 8 + f] = ch; f++ } } })
  return { b, w: side !== 'b', cr: cr === '-' ? '' : cr, ep: ep && ep !== '-' ? sqIndex(ep) : -1, half: Number(half) || 0 }
}
export const sqName = (i) => 'abcdefgh'[i % 8] + (Math.floor(i / 8) + 1)
export const sqIndex = (n) => (Number(n[1]) - 1) * 8 + 'abcdefgh'.indexOf(n[0])
export const fmtClock = (ms) => { if (ms == null) return ''; const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
export const REASON = { checkmate: 'CHECKMATE', stalemate: 'STALEMATE', resignation: 'RESIGNED', agreement: 'DRAW AGREED', timeout: 'ON TIME', abandonment: 'OPPONENT LEFT', aborted: 'ABORTED', 'insufficient material': 'NOT ENOUGH PIECES', 'threefold repetition': 'REPETITION', '50-move rule': '50 MOVES', draw: 'DRAW', 'timeout vs insufficient material': 'TIME · NO MATE POSSIBLE' }
