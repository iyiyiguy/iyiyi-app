// Online chess over a multiplayer room (Supabase Realtime). The room host is the
// referee: players send moves as actions, the host checks them with chess.js and
// broadcasts the new position. Handles resign, draw offers, disconnects (win by
// abandonment after ~1 minute), clocks (10+0 by default; only the side to move runs, from
// each side's first move like Lichess; time-out loses unless the opponent can't mate) and
// rematches (colours swap).
// Around the board: an opponent card (profile, rating, follow), clocks, a move list, an
// action row (draw / resign / chat / call), a light chat sheet over the board and a
// picture-in-picture WebRTC video call. Studio look (see ./studio).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Chess } from 'chess.js'
import { FONT, ST, StButton, StHeader, stType, useStudioFonts, withAlpha } from './studio'
import {
  ActionTile, ChessBoard, ChessClock, ChessResultSheet, ChessSeat, MoveList, PromotionPicker, SeatAvatar,
  capturedBy, capturedText, describeResult, formatClock, reasonLabel,
} from './ChessGame'
import { useHostLoop, useRoomSnapshot } from '../lib/multiplayer'
import { loadArcadeStats, recordGameResult } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import { useOpenProfile } from '../lib/profileNav'
import GameFollowButton from '../components/GameFollowButton'
import OpponentCard from '../components/OpponentCard'
import MatchChat, { useUnreadChat } from '../components/MatchChat'
import { VideoCallLayer, useVideoCall } from '../components/VideoCall'

const ABANDON_MS = 40000 // on top of the room's ~20 s presence grace period
export const FIRST_MOVE_MS = 45000 // no first move in time: the game is aborted (no result recorded)
const DEFAULT_TC = { base: 10 * 60 * 1000, inc: 0 }
const recorded = new Set() // `${code}:${round}:${gameNo}` already counted on this device

const other = (c) => (c === 'w' ? 'b' : 'w')

function replay(moves) {
  const g = new Chess()
  for (const san of moves || []) {
    try { g.move(san) } catch { break }
  }
  return g
}

// ---------------------------------------------------------------------------------------
// Pure rules (exported for tests)

/** Time control from room settings ("5+3", "none"), else 10+0. */
export function timeControl(info) {
  const raw = info?.settings?.clock ?? info?.settings?.timeControl
  if (raw === 'none' || raw === 'off' || raw === false) return null
  const m = /^(\d+)\+(\d+)$/.exec(String(raw ?? ''))
  if (m && Number(m[1]) > 0) return { base: Number(m[1]) * 60000, inc: Number(m[2]) * 1000 }
  return { ...DEFAULT_TC }
}

export const turnOf = (state) => ((state?.moves?.length || 0) % 2 === 0 ? 'w' : 'b')

/** Clocks run once both sides have made their first move, until the game ends. */
export const clocksRunning = (state) => !!state?.clock && !state.result && (state.moves?.length || 0) >= 2

/** Milliseconds left on `color`'s clock at host time `now` (null when the game has no clock). */
export function clockLeft(state, color, now) {
  if (!state?.clock) return null
  const base = Number(state.clock[color]) || 0
  if (!clocksRunning(state) || turnOf(state) !== color) return base
  return Math.max(0, base - Math.max(0, now - (state.turnAt ?? now)))
}

/** Can `color` still possibly checkmate? A lone king or king + one minor piece cannot. */
export function hasMatingMaterial(fen, color) {
  const placement = String(fen || '').split(' ')[0]
  let minors = 0
  for (const ch of placement) {
    if (!/[a-z]/i.test(ch)) continue
    const mine = color === 'w' ? ch === ch.toUpperCase() : ch === ch.toLowerCase()
    if (!mine) continue
    const t = ch.toLowerCase()
    if (t === 'p' || t === 'r' || t === 'q') return true
    if (t === 'n' || t === 'b') minors += 1
  }
  return minors >= 2
}

/** Result when `flagged` runs out of time. */
export function timeoutResult(state, flagged) {
  const winner = other(flagged)
  if (!hasMatingMaterial(state.fen, winner)) return { winner: null, reason: 'timeout vs insufficient material' }
  return { winner, reason: 'timeout' }
}

// Freeze the running clock at `now` (used when the game ends mid-turn).
function settledClock(state, now) {
  if (!clocksRunning(state)) return state.clock ?? null
  const c = turnOf(state)
  return { ...state.clock, [c]: clockLeft(state, c, now) }
}

export function newChessState(roster, info, hostId, now = Date.now()) {
  const players = (roster || []).slice(0, 2)
  const host = players.find((p) => p.id === hostId) || players[0]
  const guest = players.find((p) => p.id !== host?.id) || null
  const pref = info?.settings?.hostColor
  const hostColor = pref === 'w' || pref === 'b' ? pref : Math.random() < 0.5 ? 'w' : 'b'
  const seat = (p) => (p ? { id: p.id, name: p.username || 'Player', avatar: p.avatar || null } : null)
  const seats = hostColor === 'w' ? { w: seat(host), b: seat(guest) } : { w: seat(guest), b: seat(host) }
  const tc = timeControl(info)
  return {
    game: 'chess', round: info?.round || 1, gameNo: 1, players: seats, moves: [], fen: new Chess().fen(), lastMove: null, result: null, drawOffer: null, rematch: {},
    tc, clock: tc ? { w: tc.base, b: tc.base } : null, turnAt: now,
  }
}

function colorOf(state, id) {
  if (state?.players?.w?.id === id) return 'w'
  if (state?.players?.b?.id === id) return 'b'
  return null
}

/** Host only: flag fall / first-move abort. Returns the next state (or the same one). */
export function checkClock(state, now) {
  if (!state || state.result || !state.clock) return state
  const c = turnOf(state)
  if ((state.moves?.length || 0) < 2) {
    if (typeof state.turnAt === 'number' && now - state.turnAt > FIRST_MOVE_MS) return { ...state, result: { winner: null, reason: 'aborted', by: c }, drawOffer: null }
    return state
  }
  if (clockLeft(state, c, now) <= 0) return { ...state, clock: { ...state.clock, [c]: 0 }, result: timeoutResult(state, c), drawOffer: null }
  return state
}

// Host only: apply one player action. Returns the next state (or the same one).
export function applyAction(state, action, from, now = Date.now()) {
  const color = colorOf(state, from)
  if (!color || !action) return state
  switch (action.type) {
    case 'move': {
      if (state.result) return state
      if (typeof action.ply === 'number' && action.ply !== state.moves.length) return state // stale
      const g = replay(state.moves)
      if (g.turn() !== color) return state
      const running = clocksRunning(state)
      const left = running ? clockLeft(state, color, now) : null
      if (running && left <= 0) {
        return { ...state, clock: { ...state.clock, [color]: 0 }, result: timeoutResult(state, color), drawOffer: null }
      }
      let mv
      try {
        mv = g.move({ from: action.from, to: action.to, promotion: action.promotion || undefined })
      } catch {
        return state
      }
      if (!mv) return state
      const r = describeResult(g)
      const clock = state.clock ? (running ? { ...state.clock, [color]: left + (state.tc?.inc || 0) } : state.clock) : state.clock
      return {
        ...state,
        moves: [...state.moves, mv.san],
        fen: g.fen(),
        lastMove: { from: mv.from, to: mv.to },
        // Moving declines the opponent's offer; your own offer stands until they answer or move.
        drawOffer: !r && state.drawOffer === color ? color : null,
        result: r || null,
        ...(state.clock ? { clock, turnAt: now } : null),
      }
    }
    case 'resign':
      if (state.result) return state
      return { ...state, result: { winner: other(color), reason: 'resignation' }, drawOffer: null, ...(state.clock ? { clock: settledClock(state, now) } : null) }
    case 'draw_offer':
      if (state.result || state.drawOffer) return state
      return { ...state, drawOffer: color }
    case 'draw_accept':
      if (state.result || !state.drawOffer || state.drawOffer === color) return state
      return { ...state, result: { winner: null, reason: 'agreement' }, drawOffer: null, ...(state.clock ? { clock: settledClock(state, now) } : null) }
    case 'draw_decline':
      if (!state.drawOffer || state.drawOffer === color) return state
      return { ...state, drawOffer: null }
    case 'rematch': {
      if (!state.result) return state
      const rematch = { ...state.rematch, [from]: true }
      const both = state.players.w && state.players.b && rematch[state.players.w.id] && rematch[state.players.b.id]
      if (!both) return { ...state, rematch }
      const tc = state.tc || null
      return {
        ...state,
        gameNo: (state.gameNo || 1) + 1,
        players: { w: state.players.b, b: state.players.w },
        moves: [],
        fen: new Chess().fen(),
        lastMove: null,
        result: null,
        drawOffer: null,
        rematch: {},
        ...(state.clock || tc ? { clock: tc ? { w: tc.base, b: tc.base } : null, turnAt: now } : null),
      }
    }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------------------

// Ratings are shared between the two players with a small room message.
function useRatings(room, meId, opponentId) {
  const [mine, setMine] = useState(null)
  const [theirs, setTheirs] = useState({})
  const mineRef = useRef(null)

  useEffect(() => {
    let alive = true
    loadArcadeStats()
      .then((s) => {
        const r = Number(s?.chess?.rating)
        if (alive && Number.isFinite(r)) { mineRef.current = Math.round(r); setMine(Math.round(r)) }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!room) return undefined
    const offMeta = room.onMessage('chess_meta', (data, from) => {
      const r = Number(data?.rating)
      if (from && Number.isFinite(r)) setTheirs((t) => (t[from] === r ? t : { ...t, [from]: Math.round(r) }))
      if (data?.ask && mineRef.current != null) {
        try { room.send('chess_meta', { rating: mineRef.current }, { to: from }) } catch { /* ignore */ }
      }
    })
    return () => { try { offMeta?.() } catch { /* ignore */ } }
  }, [room])

  // Announce ours (and ask for theirs) whenever the opponent (re)appears.
  useEffect(() => {
    if (!room || !opponentId || mine == null) return
    try { room.send('chess_meta', { rating: mine, ask: true }, { to: opponentId }) } catch { /* ignore */ }
  }, [room, opponentId, mine])

  return { mine, of: (id) => (id ? theirs[id] ?? null : null) }
}

export function OnlineChessGame({ room, onExit }) {
  useStudioFonts()
  const snap = useRoomSnapshot(room)
  const { width } = useWindowDimensions()
  const boardSize = Math.floor(Math.min(width - 24, 520) / 8) * 8
  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'chess' && snap.state.players && Array.isArray(snap.state.moves) ? snap.state : null
  const myColor = colorOf(state, meId)
  const [selected, setSelected] = useState(null)
  const [targets, setTargets] = useState([])
  const [pending, setPending] = useState(null) // optimistic { fen, lastMove, ply, at }
  const [promo, setPromo] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [bubble, setBubble] = useState(null)
  const [bounds, setBounds] = useState(null)
  const [now, setNow] = useState(() => (room ? room.now() : Date.now()))
  const absentSince = useRef({})
  const openProfile = useOpenProfile()

  // Opponent (from the game state, or the other person in the room before it starts).
  const opponentColor = myColor ? other(myColor) : 'b'
  const roster = snap?.roster || []
  const fromState = state?.players?.[opponentColor] || null
  const rosterOther = roster.find((p) => p.id !== meId) || null
  const opponent = fromState || (rosterOther ? { id: rosterOther.id, name: rosterOther.username, avatar: rosterOther.avatar } : null)
  const opponentHere = !!opponent && roster.some((p) => p.id === opponent.id)
  const ratings = useRatings(room, meId, opponentHere ? opponent?.id : null)
  const call = useVideoCall(room, opponent, opponentHere)

  // Chat: unread badge + a short bubble for messages that arrive while the sheet is closed.
  const chat = snap?.chat || []
  const unread = useUnreadChat(chat, meId, chatOpen)
  const lastChat = chat[chat.length - 1]
  const lastChatId = lastChat?.id
  const seenChatId = useRef(lastChatId)
  const bubbleTimer = useRef(null)
  useEffect(() => {
    if (!lastChatId || lastChatId === seenChatId.current) return
    seenChatId.current = lastChatId
    if (chatOpen || !lastChat || lastChat.from === meId) return
    setBubble(String(lastChat.text || '').slice(0, 80))
    buzz('select')
    clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(null), 4000)
  }, [lastChatId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(bubbleTimer.current), [])
  useEffect(() => { if (chatOpen) setBubble(null) }, [chatOpen])
  const names = useMemo(() => {
    const map = {}
    for (const p of roster) map[p.id] = p.username
    return map
  }, [roster])

  // ---- host: referee ----
  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'chess' || s.round !== roundNo)) {
        if (room.roster.length >= 2) room.publishState(newChessState(room.roster, room.info, room.hostId, Date.now()))
        return
      }
      if (!s || s.result) return
      const t = Date.now()
      const flagged = checkClock(s, t)
      if (flagged !== s) { room.publishState(flagged); return }
      const present = room.presentIds()
      for (const c of ['w', 'b']) {
        const id = s.players?.[c]?.id
        if (!id) continue
        if (present.has(id)) { delete absentSince.current[id]; continue }
        if (!absentSince.current[id]) absentSince.current[id] = t
        if (t - absentSince.current[id] > ABANDON_MS) {
          room.publishState({ ...s, result: { winner: other(c), reason: 'abandonment' }, drawOffer: null, ...(s.clock ? { clock: settledClock(s, t) } : null) })
          return
        }
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      if (!s || s.game !== 'chess') return
      const next = applyAction(s, action, from, Date.now())
      if (next !== s) room.publishState(next)
    },
  }, 500)

  // Optimistic move clears once the host's position arrives (or after a few seconds).
  const plies = state?.moves?.length ?? 0
  useEffect(() => {
    if (pending && plies !== pending.ply) setPending(null)
  }, [plies]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pending) return undefined
    const t = setTimeout(() => setPending(null), 5000)
    return () => clearTimeout(t)
  }, [pending])

  // Clock display: tick while a clock (or the first-move window) is counting down; tenths
  // of a second are shown under 10 s, so tick faster there.
  const ticking = !!state?.clock && !state.result
  const fastTick = ticking && clocksRunning(state) && clockLeft(state, turnOf(state), now) < 10500
  useEffect(() => {
    if (!ticking || !room) return undefined
    const id = setInterval(() => setNow(room.now()), fastTick ? 100 : 250)
    return () => clearInterval(id)
  }, [ticking, fastTick, room])

  // Stable square handler so the memoized board doesn't re-render on every clock tick.
  const onSquareRef = useRef(null)
  const onSquareStable = useCallback((sq) => onSquareRef.current?.(sq), [])

  // Feedback when the opponent moves.
  const prevPlies = useRef(plies)
  useEffect(() => {
    if (plies > prevPlies.current && state) {
      const moverColor = plies % 2 === 1 ? 'w' : 'b'
      if (moverColor !== myColor) buzz(state.result ? 'heavy' : 'light')
    }
    prevPlies.current = plies
  }, [plies]) // eslint-disable-line react-hooks/exhaustive-deps

  // Result: show the sheet and record it once (aborted games aren't recorded).
  const resultKey = state?.result ? `${snap?.code}:${state.round}:${state.gameNo}` : null
  useEffect(() => {
    if (!resultKey || !state?.result) return
    setShowResult(true)
    setSelected(null)
    setTargets([])
    setPromo(null)
    if (!myColor || recorded.has(resultKey)) return
    recorded.add(resultKey)
    const r = state.result
    if (r.reason === 'aborted') { buzz('warning'); return }
    const outcome = !r.winner ? 'draw' : r.winner === myColor ? 'win' : 'loss'
    buzz(outcome === 'win' ? 'success' : outcome === 'loss' ? 'error' : 'warning')
    Promise.resolve().then(() => recordGameResult('chess', { result: outcome })).catch(() => {})
  }, [resultKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // New game (rematch): hide the result sheet.
  useEffect(() => { setShowResult(false); setPending(null) }, [state?.gameNo])

  const fen = pending?.fen || state?.fen
  const game = useMemo(() => {
    try { return fen ? new Chess(fen) : new Chess() } catch { return new Chess() }
  }, [fen])
  const board = useMemo(() => game.board(), [game])
  const captured = useMemo(() => capturedBy(board), [board])
  const targetSet = useMemo(() => new Map(targets.map((m) => [m.to, m])), [targets])

  const viewProfile = useCallback(() => {
    if (opponent?.id) openProfile(opponent.id)
  }, [opponent?.id, openProfile])

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e?.nativeEvent?.layout || {}
    if (w && h) setBounds((b) => (b && b.width === w && b.height === h ? b : { width: w, height: h }))
  }, [])

  if (!room || !snap) return null

  const connected = snap.status === 'connected'
  const overlays = (
    <>
      <MatchChat visible={chatOpen} onClose={() => setChatOpen(false)} room={room} chat={chat} myId={meId} names={names} connected={connected} />
      <VideoCallLayer call={call} bounds={bounds} />
    </>
  )

  if (!state) {
    return (
      <View style={styles.root} onLayout={onLayout}>
        <View style={styles.center}>
          <ActivityIndicator color={ST.friendly} style={{ marginBottom: 18 }} />
          <StHeader
            kicker="Online chess"
            title="Setting up the board"
            sub={opponent ? `Waiting for ${opponent.name || 'your opponent'} to connect.` : 'Waiting for both players to connect.'}
          />
          <StButton title="Leave" tone="ghost" height={44} onPress={onExit} style={{ marginTop: 24, minWidth: 160 }} />
        </View>
        {overlays}
      </View>
    )
  }

  const turn = game.turn()
  const myTurn = !!myColor && !state.result && !pending && turn === myColor
  const flipped = myColor === 'b'
  const lastMove = pending?.lastMove || state.lastMove
  const inCheck = game.inCheck()
  const checkedKing = inCheck ? game.findPiece({ type: 'k', color: turn })[0] : null
  const r = state.result
  const hasClock = !!state.clock
  const firstMoveWindow = hasClock && !r && state.moves.length < 2
  const firstMoveLeft = firstMoveWindow ? Math.max(0, FIRST_MOVE_MS - Math.max(0, now - (state.turnAt ?? now))) : null

  // While my move is in flight, my clock stops at the moment I moved.
  const clockFor = (c) => {
    if (!hasClock) return null
    if (pending && c === myColor) return clockLeft(state, c, pending.at)
    return clockLeft(state, c, now)
  }
  const clockActive = (c) => clocksRunning(state) && !pending && turnOf(state) === c

  const send = (action) => { try { room.sendAction(action) } catch { /* ignore */ } }

  const tryMove = (from, to, promotion) => {
    setSelected(null)
    setTargets([])
    let g = null
    let mv = null
    try { g = new Chess(state.fen); mv = g.move({ from, to, promotion }) } catch { mv = null }
    if (!mv || !g) return
    setPending({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to }, ply: state.moves.length, at: room.now() })
    buzz('light')
    send({ type: 'move', from, to, promotion: promotion || null, ply: state.moves.length })
  }

  const onSquare = (square) => {
    if (!myTurn) return
    const piece = game.get(square)
    if (selected && targetSet.has(square)) {
      const opts = targets.filter((m) => m.to === square)
      if (opts.some((m) => m.promotion)) setPromo({ from: selected, to: square })
      else tryMove(selected, square)
      return
    }
    if (piece && piece.color === myColor) {
      if (selected === square) { setSelected(null); setTargets([]) } else { setSelected(square); setTargets(game.moves({ square, verbose: true })); buzz('select') }
      return
    }
    setSelected(null)
    setTargets([])
  }

  onSquareRef.current = onSquare

  const resign = () => {
    Alert.alert('Resign?', 'Your opponent wins this game.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => send({ type: 'resign' }) },
    ])
  }

  const colorName = (c) => (c === 'w' ? 'White' : 'Black')
  const aborted = r?.reason === 'aborted'
  const tone = !r ? 'draw' : aborted || !r.winner ? 'draw' : !myColor ? 'win' : r.winner === myColor ? 'win' : 'loss'
  const resultTitle = !r ? '' : aborted ? 'Aborted' : !r.winner ? 'Draw' : !myColor ? `${colorName(r.winner)} wins` : r.winner === myColor ? 'Victory' : 'Defeat'
  const resultSub = !r ? '' : aborted
    ? `${colorName(r.by || turn)} didn’t make a first move · not rated`
    : r.winner
      ? `${r.winner === myColor ? 'You' : state.players[r.winner]?.name || colorName(r.winner)} won by ${reasonLabel(r.reason).toLowerCase()} · ${Math.ceil(state.moves.length / 2)} moves`
      : `Draw by ${reasonLabel(r.reason).toLowerCase()} · ${Math.ceil(state.moves.length / 2)} moves`
  const iWantRematch = !!state.rematch?.[meId]
  const theyWantRematch = !!opponent && !!state.rematch?.[opponent.id]
  const callBusy = call?.status && call.status !== 'idle'

  // My seat status line (friendly when it's my move, enemy for check).
  let mySub = { text: '', color: ST.muted }
  if (r) mySub = { text: aborted ? 'Game aborted' : !r.winner ? `Draw · ${reasonLabel(r.reason)}` : r.winner === myColor ? `Won · ${reasonLabel(r.reason)}` : `Lost · ${reasonLabel(r.reason)}`, color: r.winner === myColor ? ST.objective : ST.muted }
  else if (pending) mySub = { text: 'Sending move…', color: ST.muted }
  else if (myTurn && firstMoveWindow) mySub = { text: `Make your first move · ${Math.ceil(firstMoveLeft / 1000)}s`, color: firstMoveLeft < 15000 ? ST.enemy : ST.friendly }
  else if (myTurn) mySub = { text: inCheck ? 'Check · your move' : 'Your move', color: inCheck ? ST.enemy : ST.friendly }
  else mySub = { text: `${opponent?.name || 'Opponent'} to move`, color: ST.muted }

  // Spectators (no seat) see both seats as plain rows.
  const spectatorSeat = (c) => {
    const p = state.players[c]
    const here = p && roster.some((x) => x.id === p.id)
    return (
      <ChessSeat
        name={p?.name || 'Waiting…'}
        sub={`${colorName(c)}${p && !here ? ' · disconnected' : ''}${turn === c && !r ? ' · to move' : ''}`}
        subColor={turn === c && !r ? ST.friendly : ST.muted}
        avatar={p?.avatar}
        accent={c === 'w' ? '#ffffff' : ST.faint}
        right={hasClock ? <ChessClock ms={clockFor(c)} active={clockActive(c)} /> : <Text style={styles.captured}>{capturedText(captured, c)}</Text>}
      />
    )
  }

  const opponentClock = hasClock && myColor ? (
    <View style={styles.clockRow}>
      {firstMoveWindow && turn === opponentColor ? <Text style={[stType.label, { flex: 1 }]}>First move · {Math.ceil(firstMoveLeft / 1000)}s</Text> : <View style={{ flex: 1 }} />}
      <ChessClock ms={clockFor(opponentColor)} active={clockActive(opponentColor)} />
    </View>
  ) : null

  return (
    <View style={styles.root} onLayout={onLayout}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {myColor && opponent ? (
          <View style={{ alignSelf: 'stretch', zIndex: 10 }}>
            <OpponentCard
              player={opponent}
              rating={ratings.of(opponent.id)}
              sideLabel={colorName(opponentColor)}
              captured={capturedText(captured, opponentColor)}
              thinking={!r && turn === opponentColor}
              connected={opponentHere}
              onViewProfile={viewProfile}
              onChat={() => setChatOpen(true)}
              bubble={bubble}
              actions={false}
            />
          </View>
        ) : spectatorSeat(flipped ? 'w' : 'b')}

        {opponentClock}

        {!r && opponent && !opponentHere && (
          <View style={[styles.banner, { borderColor: withAlpha(ST.objective, 0.5), backgroundColor: withAlpha(ST.objective, 0.08) }]}>
            <Ionicons name="cloud-offline" size={15} color={ST.objective} />
            <Text style={styles.bannerText}>{opponent.name} lost connection. Waiting for them to come back…</Text>
          </View>
        )}
        {!r && state.drawOffer && state.drawOffer !== myColor && myColor && (
          <View style={[styles.banner, { borderColor: ST.objective }]}>
            <Text style={[styles.bannerText, { color: ST.objective }]} numberOfLines={2}>{opponent?.name || 'Your opponent'} offers a draw</Text>
            <StButton title="Decline" tone="ghost" height={36} onPress={() => send({ type: 'draw_decline' })} style={{ paddingHorizontal: 12 }} />
            <StButton title="Accept" tone="objective" height={36} onPress={() => send({ type: 'draw_accept' })} style={{ paddingHorizontal: 12 }} />
          </View>
        )}

        <View style={{ marginVertical: 10 }}>
          <ChessBoard
            board={board}
            size={boardSize}
            flipped={flipped}
            selected={selected}
            targets={targetSet}
            lastMove={lastMove}
            checkedKing={checkedKing}
            onSquare={onSquareStable}
          />
        </View>

        <View style={styles.clockRow}>
          <MoveList moves={state.moves} style={{ flex: 1, marginBottom: 0 }} />
          {hasClock && myColor ? <ChessClock ms={clockFor(myColor)} active={clockActive(myColor)} mine /> : null}
        </View>

        {myColor ? (
          <ChessSeat
            name={`You · ${colorName(myColor)}`}
            sub={`${mySub.text}${ratings.mine != null ? ` · ${ratings.mine}` : ''}`}
            subColor={mySub.color}
            avatar={snap?.me?.avatar}
            accent={ST.friendly}
            style={[{ marginTop: 10 }, myTurn && { borderLeftWidth: 3, borderLeftColor: ST.friendly }]}
            right={<Text style={styles.captured} numberOfLines={1}>{capturedText(captured, myColor)}</Text>}
          />
        ) : <View style={{ alignSelf: 'stretch', marginTop: 10 }}>{spectatorSeat(flipped ? 'b' : 'w')}</View>}

        {myColor ? (
          <View style={styles.actions}>
            {!r ? (
              <ActionTile
                label={state.drawOffer === myColor ? 'Offered' : 'Draw'}
                icon="hand-left-outline"
                disabled={!!state.drawOffer || state.moves.length < 2}
                onPress={() => { buzz('select'); send({ type: 'draw_offer' }) }}
                accessibilityLabel={state.drawOffer === myColor ? 'Draw offered' : 'Offer draw'}
              />
            ) : (
              <ActionTile label="Result" icon="podium" tone="objective" onPress={() => setShowResult(true)} />
            )}
            {!r ? <ActionTile label="Resign" icon="flag" tone="danger" onPress={resign} /> : (
              <ActionTile
                label={iWantRematch ? 'Waiting' : 'Rematch'}
                icon="refresh"
                tone="friendly"
                disabled={iWantRematch || !opponentHere}
                onPress={() => { buzz('medium'); send({ type: 'rematch' }) }}
              />
            )}
            <ActionTile label="Chat" icon="chatbubble-ellipses" onPress={() => setChatOpen(true)} badge={unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null} accessibilityLabel={unread ? `Chat, ${unread} unread` : 'Chat'} />
            <ActionTile
              label={callBusy ? 'End' : 'Call'}
              icon={callBusy ? 'videocam-off' : 'videocam'}
              tone={callBusy ? 'danger' : undefined}
              disabled={!opponentHere && !callBusy}
              onPress={callBusy ? call.hangup : call.start}
              accessibilityLabel={callBusy ? 'End video call' : 'Video call'}
            />
          </View>
        ) : null}
        {hasClock && state.tc ? (
          <Text style={[stType.label, { marginTop: 10, color: ST.faint }]}>
            {Math.round(state.tc.base / 60000)}+{Math.round((state.tc.inc || 0) / 1000)} · clocks start after each side’s first move
          </Text>
        ) : null}
      </ScrollView>

      {overlays}

      <PromotionPicker
        visible={!!promo && myTurn}
        color={myColor}
        onPick={(p) => { const x = promo; setPromo(null); if (x) tryMove(x.from, x.to, p) }}
        onCancel={() => setPromo(null)}
      />

      <ChessResultSheet
        visible={showResult && !!r}
        tone={tone}
        kicker={`Online chess · ${reasonLabel(r?.reason)}`}
        title={resultTitle}
        sub={resultSub}
        onRequestClose={() => setShowResult(false)}
        stats={[
          { label: 'Moves', value: String(Math.ceil(state.moves.length / 2)) },
          ...(myColor ? [{ label: 'Colour', value: colorName(myColor) }] : []),
          ...(hasClock && myColor ? [{ label: 'Your clock', value: formatClock(clockFor(myColor)), color: ST.friendly }] : []),
          ...(myColor && ratings.mine != null ? [{ label: 'Rating', value: String(ratings.mine) }] : []),
        ]}
        actions={(
          <>
            {myColor ? (
              opponentHere ? (
                <StButton
                  title={iWantRematch ? 'Waiting for opponent…' : theyWantRematch ? 'Accept rematch' : 'Rematch'}
                  disabled={iWantRematch}
                  onPress={() => { buzz('medium'); send({ type: 'rematch' }) }}
                />
              ) : (
                <Text style={[stType.small, { textAlign: 'center' }]}>Your opponent left the game.</Text>
              )
            ) : null}
            {theyWantRematch && !iWantRematch ? <Text style={[stType.small, { textAlign: 'center', color: ST.objective }]}>{opponent?.name} wants a rematch · you’ll swap colours</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StButton title="View board" tone="ghost" height={44} onPress={() => setShowResult(false)} style={{ flex: 1 }} />
              <StButton title="Leave" tone="ghost" height={44} onPress={onExit} style={{ flex: 1 }} />
            </View>
          </>
        )}
      >
        {myColor && opponent ? (
          <View style={{ marginTop: 18 }}>
            <Text style={[stType.label, { marginBottom: 6 }]}>Played with · follow on iYiYi</Text>
            <View style={styles.playedRow}>
              <SeatAvatar uri={opponent.avatar} name={opponent.name} accent={ST.enemy} size={36} />
              <Pressable
                onPress={() => { setShowResult(false); viewProfile() }}
                style={{ flex: 1, minWidth: 0 }}
                accessibilityRole="button"
                accessibilityLabel={`View ${opponent.name}’s profile`}
              >
                <Text style={styles.playedName} numberOfLines={1}>{opponent.name}</Text>
                <Text style={styles.playedLine} numberOfLines={1}>
                  {ratings.of(opponent.id) != null ? `Rated ${ratings.of(opponent.id)} · ` : ''}{colorName(opponentColor)}{opponentHere ? '' : ' · left'}
                </Text>
              </Pressable>
              {opponent?.id ? <GameFollowButton userId={opponent.id} name={opponent.name} /> : null}
            </View>
          </View>
        ) : null}
      </ChessResultSheet>
    </View>
  )
}

export default OnlineChessGame

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: ST.ground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 48 },
  clockRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 10, marginTop: 8 },
  banner: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    borderWidth: 1, borderRadius: ST.radius, padding: 10, backgroundColor: ST.panel,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: FONT.uiSemi, color: ST.text },
  captured: { fontSize: 15, color: ST.muted, maxWidth: 140 },
  actions: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: 10 },
  playedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: ST.radius },
  playedName: { fontFamily: FONT.ui, fontSize: 15, color: ST.text },
  playedLine: { fontFamily: FONT.uiSemi, fontSize: 11, color: 'rgba(242,244,247,0.6)' },
})
