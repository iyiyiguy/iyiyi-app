// Online chess over a multiplayer room (Supabase Realtime). The room host is the
// referee: players send moves as actions, the host checks them with chess.js and
// broadcasts the new position. Handles resign, draw offers, disconnects (win by
// abandonment after ~1 minute) and rematches (colours swap).
// Around the board: an opponent card (profile, rating, chat, video call), a light chat
// sheet over the board and a picture-in-picture WebRTC video call.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Chess } from 'chess.js'
import { AC, ArcadeBackground, GhostButton, PlayButton } from './arcadeUI'
import { BOARD_DARK, BOARD_LIGHT, FILES, GLYPHS, PROMOTION_CHOICES, capturedBy, describeResult } from './ChessGame'
import { useHostLoop, useRoomSnapshot } from '../lib/multiplayer'
import { loadArcadeStats, recordGameResult } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import { useOpenProfile } from '../lib/profileNav'
import OpponentCard, { PlayerAvatar } from '../components/OpponentCard'
import MatchChat, { useUnreadChat } from '../components/MatchChat'
import { VideoCallButton, VideoCallLayer, useVideoCall } from '../components/VideoCall'
import { font } from '../theme'

const ABANDON_MS = 40000 // on top of the room's ~20 s presence grace period
const recorded = new Set() // `${code}:${round}:${gameNo}` already counted on this device

const other = (c) => (c === 'w' ? 'b' : 'w')

function replay(moves) {
  const g = new Chess()
  for (const san of moves || []) {
    try { g.move(san) } catch { break }
  }
  return g
}

export function newChessState(roster, info, hostId) {
  const players = (roster || []).slice(0, 2)
  const host = players.find((p) => p.id === hostId) || players[0]
  const guest = players.find((p) => p.id !== host?.id) || null
  const pref = info?.settings?.hostColor
  const hostColor = pref === 'w' || pref === 'b' ? pref : Math.random() < 0.5 ? 'w' : 'b'
  const seat = (p) => (p ? { id: p.id, name: p.username || 'Player', avatar: p.avatar || null } : null)
  const seats = hostColor === 'w' ? { w: seat(host), b: seat(guest) } : { w: seat(guest), b: seat(host) }
  return { game: 'chess', round: info?.round || 1, gameNo: 1, players: seats, moves: [], fen: new Chess().fen(), lastMove: null, result: null, drawOffer: null, rematch: {} }
}

function colorOf(state, id) {
  if (state?.players?.w?.id === id) return 'w'
  if (state?.players?.b?.id === id) return 'b'
  return null
}

// Host only: apply one player action. Returns the next state (or the same one).
function applyAction(state, action, from) {
  const color = colorOf(state, from)
  if (!color || !action) return state
  switch (action.type) {
    case 'move': {
      if (state.result) return state
      if (typeof action.ply === 'number' && action.ply !== state.moves.length) return state // stale
      const g = replay(state.moves)
      if (g.turn() !== color) return state
      let mv
      try {
        mv = g.move({ from: action.from, to: action.to, promotion: action.promotion || undefined })
      } catch {
        return state
      }
      if (!mv) return state
      const r = describeResult(g)
      return { ...state, moves: [...state.moves, mv.san], fen: g.fen(), lastMove: { from: mv.from, to: mv.to }, drawOffer: null, result: r || null }
    }
    case 'resign':
      if (state.result) return state
      return { ...state, result: { winner: other(color), reason: 'resignation' }, drawOffer: null }
    case 'draw_offer':
      if (state.result || state.drawOffer) return state
      return { ...state, drawOffer: color }
    case 'draw_accept':
      if (state.result || !state.drawOffer || state.drawOffer === color) return state
      return { ...state, result: { winner: null, reason: 'agreement' }, drawOffer: null }
    case 'draw_decline':
      if (!state.drawOffer || state.drawOffer === color) return state
      return { ...state, drawOffer: null }
    case 'rematch': {
      if (!state.result) return state
      const rematch = { ...state.rematch, [from]: true }
      const both = state.players.w && state.players.b && rematch[state.players.w.id] && rematch[state.players.b.id]
      if (!both) return { ...state, rematch }
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
      }
    }
    default:
      return state
  }
}

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
  const snap = useRoomSnapshot(room)
  const { width } = useWindowDimensions()
  const boardSize = Math.min(width - 24, 520)
  const sq = boardSize / 8
  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'chess' && snap.state.players && Array.isArray(snap.state.moves) ? snap.state : null
  const myColor = colorOf(state, meId)
  const [selected, setSelected] = useState(null)
  const [targets, setTargets] = useState([])
  const [pending, setPending] = useState(null) // optimistic { fen, lastMove, ply }
  const [promo, setPromo] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [bubble, setBubble] = useState(null)
  const [bounds, setBounds] = useState(null)
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
        if (room.roster.length >= 2) room.publishState(newChessState(room.roster, room.info, room.hostId))
        return
      }
      if (!s || s.result) return
      const present = room.presentIds()
      const now = Date.now()
      for (const c of ['w', 'b']) {
        const id = s.players?.[c]?.id
        if (!id) continue
        if (present.has(id)) { delete absentSince.current[id]; continue }
        if (!absentSince.current[id]) absentSince.current[id] = now
        if (now - absentSince.current[id] > ABANDON_MS) {
          room.publishState({ ...s, result: { winner: other(c), reason: 'abandonment' }, drawOffer: null })
          return
        }
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      if (!s || s.game !== 'chess') return
      const next = applyAction(s, action, from)
      if (next !== s) room.publishState(next)
    },
  }, 1000)

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

  // Feedback when the opponent moves.
  const prevPlies = useRef(plies)
  useEffect(() => {
    if (plies > prevPlies.current && state) {
      const moverColor = plies % 2 === 1 ? 'w' : 'b'
      if (moverColor !== myColor) buzz(state.result ? 'heavy' : 'light')
    }
    prevPlies.current = plies
  }, [plies]) // eslint-disable-line react-hooks/exhaustive-deps

  // Result: show the sheet and record it once.
  const resultKey = state?.result ? `${snap?.code}:${state.round}:${state.gameNo}` : null
  useEffect(() => {
    if (!resultKey || !state?.result) return
    setShowResult(true)
    setSelected(null)
    setTargets([])
    if (!myColor || recorded.has(resultKey)) return
    recorded.add(resultKey)
    const r = state.result
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
        <ArcadeBackground />
        <View style={styles.center}>
          <Text style={styles.waitGlyph} allowFontScaling={false}>♞</Text>
          <Text style={styles.waitTitle}>Setting up the board…</Text>
          <Text style={styles.caption}>{opponent ? `Waiting for ${opponent.name || 'your opponent'} to connect.` : 'Waiting for both players to connect.'}</Text>
          <GhostButton title="Leave" icon="exit-outline" small onPress={onExit} style={{ marginTop: 20 }} />
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
  const targetSet = new Map(targets.map((m) => [m.to, m]))

  const send = (action) => { try { room.sendAction(action) } catch { /* ignore */ } }

  const tryMove = (from, to, promotion) => {
    setSelected(null)
    setTargets([])
    let g = null
    let mv = null
    try { g = new Chess(state.fen); mv = g.move({ from, to, promotion }) } catch { mv = null }
    if (!mv || !g) return
    setPending({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to }, ply: state.moves.length })
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

  const resign = () => {
    Alert.alert('Resign?', 'Your opponent wins this game.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => send({ type: 'resign' }) },
    ])
  }

  const r = state.result
  const resultTitle = !r ? '' : !r.winner ? 'Draw' : r.winner === myColor ? 'You win!' : myColor ? 'You lost' : `${state.players[r.winner]?.name} wins`
  const iWantRematch = !!state.rematch?.[meId]
  const theyWantRematch = !!opponent && !!state.rematch?.[opponent.id]

  let status
  if (r) status = r.winner ? `${state.players[r.winner]?.name || (r.winner === 'w' ? 'White' : 'Black')} wins by ${r.reason}` : `Draw by ${r.reason}`
  else if (!myColor) status = `${turn === 'w' ? 'White' : 'Black'} to move`
  else if (pending) status = 'Sending move…'
  else if (myTurn) status = inCheck ? 'Check! Your move' : 'Your move'
  else status = `${opponent?.name || 'Opponent'} is thinking…`

  const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  const topColor = flipped ? 'w' : 'b'
  const bottomColor = flipped ? 'b' : 'w'
  const capText = (c) => {
    const list = captured[c] || []
    const adv = c === 'w' ? captured.diff : -captured.diff
    return `${list.map((t) => GLYPHS[t]).join('')}${adv > 0 ? `  +${adv}` : ''}`
  }

  // Spectators (no seat) see both seats as plain rows.
  const seatRow = (c) => {
    const p = state.players[c]
    const here = p && roster.some((x) => x.id === p.id)
    const isMe = p?.id === meId
    return (
      <View style={styles.seat}>
        <PlayerAvatar uri={p?.avatar} name={p?.name} size={32} ring={turn === c && !r ? AC.live : AC.border} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.seatName} numberOfLines={1}>{isMe ? 'You' : p?.name || 'Waiting…'}</Text>
          <Text style={styles.seatMeta} numberOfLines={1}>
            {c === 'w' ? 'White' : 'Black'}
            {isMe && ratings.mine != null ? ` · ${ratings.mine}` : ''}
            {p && !here ? ' · disconnected' : ''}
          </Text>
        </View>
        <Text style={styles.captured} numberOfLines={1}>{capText(c)}</Text>
      </View>
    )
  }

  const statusTone = r ? AC.gold : myTurn ? AC.live : AC.muted

  return (
    <View style={styles.root} onLayout={onLayout}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {myColor && opponent ? (
          <View style={{ alignSelf: 'stretch', zIndex: 10 }}>
            <OpponentCard
              player={opponent}
              rating={ratings.of(opponent.id)}
              sideLabel={opponentColor === 'w' ? 'White' : 'Black'}
              captured={capText(opponentColor)}
              thinking={!r && turn === opponentColor}
              connected={opponentHere}
              onViewProfile={viewProfile}
              onChat={() => setChatOpen(true)}
              unread={unread}
              bubble={bubble}
              videoButton={<VideoCallButton call={call} disabled={!opponentHere && call.status === 'idle'} />}
            />
          </View>
        ) : seatRow(topColor)}

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusTone }]} />
          <Text style={[styles.status, { color: r ? AC.gold : AC.text }]} numberOfLines={1}>{status}</Text>
          {state.moves.length > 0 ? <Text style={styles.moveNo}>Move {Math.ceil(state.moves.length / 2)}</Text> : null}
        </View>

        {!r && opponent && !opponentHere && (
          <View style={styles.banner}>
            <Ionicons name="cloud-offline" size={15} color={AC.gold} />
            <Text style={styles.bannerText}>{opponent.name} lost connection — waiting for them to come back…</Text>
          </View>
        )}
        {!r && state.drawOffer && state.drawOffer !== myColor && myColor && (
          <View style={styles.offer}>
            <Text style={[styles.body, { flex: 1 }]}>{opponent?.name || 'Your opponent'} offers a draw</Text>
            <GhostButton title="Decline" small onPress={() => send({ type: 'draw_decline' })} />
            <PlayButton title="Accept" icon={null} small onPress={() => send({ type: 'draw_accept' })} />
          </View>
        )}

        <View style={[styles.boardFrame, { width: boardSize + 8, height: boardSize + 8 }]}>
          <View style={[styles.board, { width: boardSize, height: boardSize }]}>
            {rows.map((row) => (
              <View key={row} style={styles.boardRow}>
                {cols.map((col) => {
                  const square = FILES[col] + (8 - row)
                  const piece = board[row]?.[col]
                  const light = (row + col) % 2 === 0
                  const target = targetSet.get(square)
                  return (
                    <Pressable
                      key={square}
                      onPress={() => onSquare(square)}
                      style={[styles.square, { width: sq, height: sq, backgroundColor: light ? BOARD_LIGHT : BOARD_DARK }]}
                      accessibilityLabel={`${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
                    >
                      {lastMove && (lastMove.from === square || lastMove.to === square) && <View style={[StyleSheet.absoluteFill, styles.lastMove]} />}
                      {selected === square && <View style={[StyleSheet.absoluteFill, styles.selectedSq]} />}
                      {checkedKing === square && <View style={[StyleSheet.absoluteFill, styles.checkSq]} />}
                      {cols[0] === col && <Text style={[styles.coord, styles.rankCoord, { color: light ? BOARD_DARK : BOARD_LIGHT }]}>{8 - row}</Text>}
                      {rows[7] === row && <Text style={[styles.coord, styles.fileCoord, { color: light ? BOARD_DARK : BOARD_LIGHT }]}>{FILES[col]}</Text>}
                      {piece && (
                        <Text allowFontScaling={false} style={[styles.piece, { fontSize: sq * 0.78, lineHeight: sq * 0.95 }, piece.color === 'w' ? styles.whitePiece : styles.blackPiece]}>
                          {GLYPHS[piece.type]}
                        </Text>
                      )}
                      {target && (piece || String(target.flags || '').includes('e')
                        ? <View style={[styles.captureRing, { width: sq - 4, height: sq - 4, borderRadius: sq }]} />
                        : <View style={[styles.moveDot, { width: sq * 0.3, height: sq * 0.3, borderRadius: sq }]} />)}
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </View>
        </View>

        {seatRow(bottomColor)}

        <ScrollView horizontal style={styles.moveList} contentContainerStyle={styles.moveListContent} showsHorizontalScrollIndicator={false}>
          {state.moves.length === 0 ? (
            <Text style={styles.caption}>White moves first</Text>
          ) : (
            state.moves.reduce((acc, san, i) => {
              if (i % 2 === 0) acc.push([san])
              else acc[acc.length - 1].push(san)
              return acc
            }, []).map((pair, i) => (
              <Text key={i} style={styles.moveText}><Text style={styles.caption}>{i + 1}. </Text>{pair.join(' ')}</Text>
            ))
          )}
        </ScrollView>

        {myColor && !r && (
          <View style={styles.controls}>
            <GhostButton
              title={state.drawOffer === myColor ? 'Draw offered' : 'Offer draw'}
              icon="hand-left-outline"
              small
              disabled={!!state.drawOffer || state.moves.length < 2}
              onPress={() => { buzz('select'); send({ type: 'draw_offer' }) }}
              style={{ flex: 1 }}
            />
            <PlayButton title="Resign" icon="flag" small colors={[AC.danger, '#c23a4a']} onPress={resign} style={{ flex: 1 }} />
          </View>
        )}
        {r && !showResult && <PlayButton title="Show result" icon="trophy" small onPress={() => setShowResult(true)} style={{ alignSelf: 'stretch', marginTop: 12 }} />}
      </ScrollView>

      {overlays}

      {/* Promotion */}
      <Modal visible={!!promo} transparent animationType="fade" onRequestClose={() => setPromo(null)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={[styles.modalTitle, { marginBottom: 16 }]}>Promote pawn to</Text>
            <View style={styles.promoRow}>
              {PROMOTION_CHOICES.map((p) => (
                <Pressable key={p} onPress={() => { const x = promo; setPromo(null); if (x) tryMove(x.from, x.to, p) }} style={({ pressed }) => [styles.promoBtn, pressed && { opacity: 0.7 }]} accessibilityLabel={`Promote to ${p}`}>
                  <Text allowFontScaling={false} style={[styles.promoPiece, myColor === 'w' ? styles.whitePiece : styles.blackPiece]}>{GLYPHS[p]}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setPromo(null)} style={styles.link}><Text style={styles.linkText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      {/* Result */}
      <Modal visible={showResult && !!r} transparent animationType="fade" onRequestClose={() => setShowResult(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.resultGlyph} allowFontScaling={false}>{!r?.winner ? '🤝' : r.winner === myColor ? '🏆' : '♚'}</Text>
            <Text style={styles.resultTitle}>{resultTitle}</Text>
            <Text style={styles.resultReason}>by {r?.reason}</Text>
            {myColor && opponent ? (
              <Pressable onPress={() => { setShowResult(false); viewProfile() }} style={styles.resultOpp} accessibilityRole="button" accessibilityLabel={`View ${opponent.name}’s profile`}>
                <PlayerAvatar uri={opponent.avatar} name={opponent.name} size={30} />
                <Text style={styles.resultOppName} numberOfLines={1}>vs {opponent.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={AC.muted} />
              </Pressable>
            ) : null}
            {myColor && (
              opponentHere ? (
                <PlayButton
                  title={iWantRematch ? 'Waiting for opponent…' : theyWantRematch ? 'Accept rematch' : 'Rematch'}
                  icon="refresh"
                  disabled={iWantRematch}
                  onPress={() => { buzz('medium'); send({ type: 'rematch' }) }}
                />
              ) : (
                <Text style={[styles.caption, { textAlign: 'center' }]}>Your opponent left the game.</Text>
              )
            )}
            {theyWantRematch && !iWantRematch && <Text style={[styles.caption, { textAlign: 'center', marginTop: 6 }]}>{opponent?.name} wants a rematch</Text>}
            <Pressable onPress={() => setShowResult(false)} style={styles.link}><Text style={styles.linkText}>View board</Text></Pressable>
            <Pressable onPress={onExit} style={styles.link}><Text style={styles.linkText}>Leave</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

export default OnlineChessGame

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  waitGlyph: { fontSize: 64, color: 'rgba(255,255,255,0.85)', marginBottom: 8 },
  waitTitle: { fontSize: 20, ...font.bold, color: AC.text, letterSpacing: -0.3 },
  caption: { fontSize: 13, ...font.regular, color: AC.muted, marginTop: 4 },
  body: { fontSize: 15, ...font.regular, color: AC.text },
  scroll: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 48 },
  statusRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, paddingHorizontal: 4, marginTop: 12, marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { flex: 1, fontSize: 17, ...font.bold, letterSpacing: -0.2 },
  moveNo: { fontSize: 12, ...font.bold, color: AC.faint, letterSpacing: 0.6, textTransform: 'uppercase' },
  banner: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,201,77,0.12)', borderWidth: 1, borderColor: 'rgba(255,201,77,0.3)', borderRadius: 14, padding: 10, marginBottom: 8 },
  bannerText: { flex: 1, fontSize: 13, ...font.medium, color: AC.text },
  offer: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: AC.border, backgroundColor: AC.cardStrong, marginBottom: 8 },
  seat: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 10, paddingHorizontal: 6, paddingVertical: 10 },
  seatName: { fontSize: 15, ...font.bold, color: AC.text },
  seatMeta: { fontSize: 12, ...font.medium, color: AC.muted, marginTop: 1 },
  captured: { fontSize: 15, color: AC.muted, maxWidth: '40%' },
  boardFrame: { padding: 4, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: AC.border, shadowColor: '#7c8cff', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  board: { borderRadius: 8, overflow: 'hidden' },
  boardRow: { flexDirection: 'row', flex: 1 },
  square: { alignItems: 'center', justifyContent: 'center' },
  lastMove: { backgroundColor: 'rgba(240, 220, 60, 0.38)' },
  selectedSq: { backgroundColor: 'rgba(80, 160, 255, 0.45)' },
  checkSq: { backgroundColor: 'rgba(224, 40, 40, 0.65)' },
  coord: { position: 'absolute', fontSize: 9, ...font.bold },
  rankCoord: { top: 2, left: 3 },
  fileCoord: { bottom: 1, right: 3 },
  piece: { textAlign: 'center', includeFontPadding: false },
  whitePiece: { color: '#fbfaf7', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } },
  blackPiece: { color: '#1d1a22', textShadowColor: 'rgba(255,255,255,0.35)', textShadowRadius: 1, textShadowOffset: { width: 0, height: 0 } },
  moveDot: { position: 'absolute', backgroundColor: 'rgba(20, 20, 30, 0.32)' },
  captureRing: { position: 'absolute', borderWidth: 4, borderColor: 'rgba(20, 20, 30, 0.35)' },
  moveList: { alignSelf: 'stretch', marginTop: 4, maxHeight: 36 },
  moveListContent: { alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  moveText: { fontSize: 14, ...font.semibold, color: AC.text },
  controls: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(2,3,10,0.66)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modal: { width: '100%', maxWidth: 340, padding: 22, borderRadius: 28, backgroundColor: '#0d1126', borderWidth: 1, borderColor: AC.border },
  modalTitle: { fontSize: 20, ...font.bold, color: AC.text, textAlign: 'center' },
  promoRow: { flexDirection: 'row', gap: 8 },
  promoBtn: { flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: BOARD_LIGHT, alignItems: 'center', justifyContent: 'center' },
  promoPiece: { fontSize: 44, lineHeight: 52, textAlign: 'center' },
  resultGlyph: { fontSize: 46, textAlign: 'center', color: AC.gold },
  resultTitle: { fontSize: 32, ...font.heavy, letterSpacing: -0.8, color: AC.text, textAlign: 'center', marginTop: 4 },
  resultReason: { fontSize: 15, ...font.regular, color: AC.muted, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  resultOpp: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 10, borderRadius: 16, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border, marginBottom: 14 },
  resultOppName: { flex: 1, fontSize: 15, ...font.semibold, color: AC.text },
  link: { paddingVertical: 12, alignItems: 'center' },
  linkText: { fontSize: 15, ...font.semibold, color: AC.muted },
})
