// Full chess game: rules from chess.js (legal moves, check, mate, stalemate, draws,
// castling, en passant, promotion), vs the built-in AI or local pass & play.
//
// Studio look (see ./studio): dark ground, black glass seat panels, caps labels, Chakra Petch
// names and numbers, square corners. The board, seat panel, clock, action tiles, promotion
// picker and result sheet are exported and shared with OnlineChessGame.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, Alert, ActivityIndicator, Image,
  useWindowDimensions,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Chess } from 'chess.js'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { GameTutorial } from '../components/GameTutorial'
import { FONT, ST, StButton, stType, useStudioFonts, withAlpha } from './studio'
import { findBestMove, DIFFICULTY_LABELS } from '../lib/chessAI'
import { recordChessGame } from '../lib/arcadeStats'
import { translate, useT } from '../i18n'
import C from '../i18n/strings/chess'

const tc = (k, v) => translate(C, k, v)

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
// Filled glyphs for both sides, tinted per colour. ︎ keeps the pawn from
// rendering as an emoji on iOS.
export const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' }
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 }
export const PROMOTION_CHOICES = ['q', 'r', 'b', 'n']
const PIECE_KEY = { q: 'pc_queen', r: 'pc_rook', b: 'pc_bishop', n: 'pc_knight', k: 'pc_king', p: 'pc_pawn' }
const TUTORIAL_KEY = 'chess_tutorial_seen_v2'

// Studio board: cool slate squares so the role colours (friendly last move, enemy check)
// read clearly on top.
export const BOARD_LIGHT = '#9aa6b4'
export const BOARD_DARK = '#4a5563'
const MARK = 'rgba(7,9,12,0.42)' // legal-move dots and capture rings

const TUTORIAL_STEPS = [
  { icon: '♟︎', get title() { return tc('tut1_t') }, get description() { return tc('tut1_d') } },
  { icon: '♚', get title() { return tc('tut2_t') }, get description() { return tc('tut2_d') } },
  { icon: '♜', get title() { return tc('tut3_t') }, get description() { return tc('tut3_d') } },
  { icon: '♞', get title() { return tc('tut4_t') }, get description() { return tc('tut4_d') } },
  { icon: '♝', get title() { return tc('tut5_t') }, get description() { return tc('tut5_d') } },
]

export function describeResult(game, resignedColor) {
  if (resignedColor) return { winner: resignedColor === 'w' ? 'b' : 'w', reason: 'resignation' }
  if (game.isCheckmate()) return { winner: game.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' }
  if (game.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (game.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' }
  if (game.isThreefoldRepetition()) return { winner: null, reason: 'threefold repetition' }
  if (game.isDrawByFiftyMoves()) return { winner: null, reason: '50-move rule' }
  if (game.isDraw()) return { winner: null, reason: 'draw' }
  return null
}

export function capturedBy(board) {
  // Count what's left of each side, compare to the starting set.
  const left = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }
  board.forEach((row) => row.forEach((p) => { if (p && p.type !== 'k') left[p.color][p.type] += 1 }))
  const lost = (c) => {
    const out = []
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      for (let i = 0; i < Math.max(0, START_COUNT[t] - left[c][t]); i++) out.push(t)
    }
    return out
  }
  const material = (c) => Object.entries(left[c]).reduce((n, [t, k]) => n + PIECE_VALUE[t] * k, 0)
  // Pieces taken BY white are black's losses, and vice versa.
  return { w: lost('b'), b: lost('w'), diff: material('w') - material('b') }
}

/** "♛♜♟  +3" for the pieces colour `c` has taken. */
export function capturedText(captured, c) {
  const list = captured?.[c] || []
  const adv = c === 'w' ? captured?.diff || 0 : -(captured?.diff || 0)
  return `${list.map((t) => GLYPHS[t]).join('')}${adv > 0 ? `  +${adv}` : ''}`
}

/** Human label for a result reason ("checkmate" -> "Checkmate"), in the viewer's language. */
const REASON_KEYS = {
  checkmate: 'r_checkmate', resignation: 'r_resignation', stalemate: 'r_stalemate', 'insufficient material': 'r_insufficient',
  'threefold repetition': 'r_threefold', '50-move rule': 'r_fifty', agreement: 'r_agreement', abandonment: 'r_abandonment',
  timeout: 'r_timeout', 'timeout vs insufficient material': 'r_timeout_insufficient', aborted: 'r_aborted', draw: 'r_draw',
}
export function reasonLabel(reason) {
  return REASON_KEYS[reason] ? tc(REASON_KEYS[reason]) : String(reason || '')
}
/** 'White' / 'Black' in the viewer's language. */
export const colorLabel = (c) => tc(c === 'w' ? 'white' : 'black')

/** m:ss, and 0:09.4 style tenths under 10 seconds (like Lichess). */
export function formatClock(ms) {
  const v = Math.max(0, ms || 0)
  if (v < 10000) {
    const tenths = Math.floor(v / 100)
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`
  }
  const s = Math.ceil(v / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------------------
// Shared studio pieces (used by OnlineChessGame too)

/** The 8x8 board. targets: Map<square, verbose move>. Memoized: pass a stable onSquare. */
export const ChessBoard = memo(function ChessBoard({ board, size, flipped, selected, targets, lastMove, checkedKing, onSquare }) {
  const t = useT(C)
  const sq = size / 8
  const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  return (
    <View style={[styles.boardFrame, { width: size + 2, height: size + 2 }]}>
      <View style={{ width: size, height: size }}>
        {rows.map((r) => (
          <View key={r} style={styles.boardRow}>
            {cols.map((c) => {
              const square = FILES[c] + (8 - r)
              const piece = board[r]?.[c]
              const light = (r + c) % 2 === 0
              const target = targets?.get(square)
              const isFrom = lastMove?.from === square
              const isTo = lastMove?.to === square
              const coordColor = light ? BOARD_DARK : BOARD_LIGHT
              return (
                <Pressable
                  key={square}
                  onPress={() => onSquare?.(square)}
                  style={[styles.square, { width: sq, height: sq, backgroundColor: light ? BOARD_LIGHT : BOARD_DARK }]}
                  accessibilityLabel={`${square}${piece ? ` ${t(piece.color === 'w' ? 'piece_white' : 'piece_black', { piece: t(PIECE_KEY[piece.type]) })}` : ''}${target ? `, ${t('legal_move')}` : ''}`}
                >
                  {isFrom || isTo ? <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(ST.friendly, isTo ? 0.45 : 0.28) }]} /> : null}
                  {selected === square ? <View style={[StyleSheet.absoluteFill, styles.selectedSq]} /> : null}
                  {checkedKing === square ? <View style={[StyleSheet.absoluteFill, styles.checkSq]} /> : null}
                  {cols[0] === c ? <Text allowFontScaling={false} style={[styles.coord, styles.rankCoord, { color: coordColor }]}>{8 - r}</Text> : null}
                  {rows[7] === r ? <Text allowFontScaling={false} style={[styles.coord, styles.fileCoord, { color: coordColor }]}>{FILES[c]}</Text> : null}
                  {piece ? (
                    <Text allowFontScaling={false} style={[styles.piece, { fontSize: sq * 0.78, lineHeight: sq * 0.95 }, piece.color === 'w' ? styles.whitePiece : styles.blackPiece]}>
                      {GLYPHS[piece.type]}
                    </Text>
                  ) : null}
                  {target ? (piece || String(target.flags || '').includes('e')
                    ? <View pointerEvents="none" style={[styles.captureRing, { width: sq - 4, height: sq - 4, borderRadius: sq }]} />
                    : <View pointerEvents="none" style={[styles.moveDot, { width: sq * 0.28, height: sq * 0.28, borderRadius: sq }]} />) : null}
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>
    </View>
  )
})

/** Square avatar with a role-colour bottom edge. */
export function SeatAvatar({ uri, name, accent = ST.friendly, size = 40 }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderBottomColor: accent }]}>
      {uri
        ? <Image source={{ uri }} style={{ width: size, height: size - 3 }} />
        : <Text allowFontScaling={false} style={[styles.avatarText, { fontSize: Math.round(size * 0.42) }]}>{String(name || '?').slice(0, 1).toUpperCase()}</Text>}
    </View>
  )
}

/** Seat panel: avatar, caps name, a status line, and something on the right (captured pieces). */
export function ChessSeat({ name, sub, subColor, avatar, accent = ST.friendly, right, style }) {
  return (
    <View style={[styles.seat, style]}>
      <SeatAvatar uri={avatar} name={name} accent={accent} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.seatName} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={[styles.seatSub, subColor && { color: subColor }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  )
}

/** Chess clock. mine + active fills friendly; low time while running turns enemy. */
export function ChessClock({ ms, active, mine, style }) {
  const t = useT(C)
  const low = ms != null && ms < 20000
  let bg = 'rgba(255,255,255,0.06)'
  let fg = 'rgba(242,244,247,0.7)'
  if (active && low) { bg = ST.enemy; fg = '#ffffff' } else if (active && mine) { bg = ST.friendly; fg = ST.ink } else if (active) { bg = 'rgba(255,255,255,0.14)'; fg = ST.text }
  return (
    <View
      style={[styles.clock, { backgroundColor: bg }, active && !mine && !low && { borderBottomWidth: 2, borderBottomColor: ST.enemy }, style]}
      accessibilityRole="timer"
      accessibilityLabel={t(mine ? 'your_clock' : 'opp_clock', { time: formatClock(ms) })}
    >
      <Text allowFontScaling={false} style={[stType.clock, { fontSize: 22, color: fg }]}>{formatClock(ms)}</Text>
    </View>
  )
}

/** Bordered action tile (DRAW / RESIGN / CHAT / CALL). */
export function ActionTile({ label, icon, onPress, disabled, tone, badge, accessibilityLabel }) {
  const color = tone === 'danger' ? ST.enemy : tone === 'friendly' ? ST.friendly : tone === 'objective' ? ST.objective : ST.text
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.action,
        tone && tone !== 'friendly' ? { borderColor: withAlpha(color, 0.55) } : null,
        tone === 'friendly' ? { borderColor: ST.friendly, backgroundColor: withAlpha(ST.friendly, 0.12) } : null,
        { opacity: disabled ? 0.38 : pressed ? 0.75 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text allowFontScaling={false} style={[styles.actionText, { color }]} numberOfLines={1}>{label}</Text>
      {badge ? <View style={styles.badge}><Text allowFontScaling={false} style={styles.badgeText}>{badge}</Text></View> : null}
    </Pressable>
  )
}

/** Compact move list: "14. Nxe5 dxe5  15. Qh5+". Scrolls to the latest move. */
export function MoveList({ moves, emptyText, style }) {
  const t = useT(C)
  const ref = useRef(null)
  useEffect(() => {
    const tm = setTimeout(() => ref.current?.scrollToEnd?.({ animated: true }), 50)
    return () => clearTimeout(tm)
  }, [moves?.length])
  const pairs = []
  ;(moves || []).forEach((san, i) => { if (i % 2 === 0) pairs.push([san]); else pairs[pairs.length - 1].push(san) })
  return (
    <ScrollView ref={ref} horizontal style={[styles.moveList, style]} contentContainerStyle={styles.moveListContent} showsHorizontalScrollIndicator={false}>
      {pairs.length === 0 ? (
        <Text style={styles.moveMuted}>{emptyText ?? t('white_first')}</Text>
      ) : pairs.map((pair, i) => {
        const latest = i === pairs.length - 1
        return (
          <Text key={i} style={[styles.moveText, latest && { color: ST.text }]} allowFontScaling={false}>
            <Text style={styles.moveMuted}>{i + 1}. </Text>{pair.join('  ')}
          </Text>
        )
      })}
    </ScrollView>
  )
}

/** Promotion picker: four board-coloured squares. */
export function PromotionPicker({ visible, color, onPick, onCancel }) {
  const t = useT(C)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={[stType.kicker, { textAlign: 'center' }]}>{t('promote_pawn')}</Text>
          <Text style={[stType.title, { textAlign: 'center', marginTop: 4, marginBottom: 16 }]}>{t('choose_piece')}</Text>
          <View style={styles.promoRow}>
            {PROMOTION_CHOICES.map((p, i) => (
              <Pressable
                key={p}
                onPress={() => onPick(p)}
                style={({ pressed }) => [styles.promoBtn, { backgroundColor: i % 2 ? BOARD_DARK : BOARD_LIGHT }, pressed && { borderColor: ST.friendly }]}
                accessibilityRole="button"
                accessibilityLabel={t('promote_to', { piece: t(PIECE_KEY[p]) })}
              >
                <Text allowFontScaling={false} style={[styles.promoPiece, color === 'b' ? styles.blackPiece : styles.whitePiece]}>{GLYPHS[p]}</Text>
                <Text allowFontScaling={false} style={styles.promoLabel}>{t(PIECE_KEY[p])}</Text>
              </Pressable>
            ))}
          </View>
          <StButton title={t('cancel')} tone="ghost" height={44} onPress={onCancel} style={{ marginTop: 16 }} />
        </View>
      </View>
    </Modal>
  )
}

/**
 * Full-screen result in the studio Summary style.
 * tone: 'win' | 'loss' | 'draw'. stats: [{ label, value, color }].
 */
export function ChessResultSheet({ visible, tone, kicker, title, sub, stats, children, actions, onRequestClose }) {
  const color = tone === 'win' ? ST.friendly : tone === 'loss' ? ST.enemy : ST.objective
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.resultRoot}>
        <LinearGradient colors={[withAlpha(color, 0.22), withAlpha(color, 0)]} style={styles.resultWash} pointerEvents="none" />
        <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.resultInner}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={[stType.kicker, { color, fontSize: 10, letterSpacing: 1.8 }]} numberOfLines={1}>{kicker}</Text>
              <Text style={[stType.display, { textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
              {sub ? <Text style={[stType.body, { textAlign: 'center', fontSize: 13 }]} numberOfLines={2}>{sub}</Text> : null}
            </View>
            {stats?.length ? (
              <View style={styles.resultStats}>
                {stats.map((s) => (
                  <View key={s.label} style={styles.resultStat}>
                    <Text style={stType.label} numberOfLines={1}>{s.label}</Text>
                    <Text style={[stType.num, { fontSize: 20, color: s.color || ST.text }]} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {children}
            <View style={{ gap: 8, marginTop: 18 }}>{actions}</View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------
// Local game (vs AI / pass & play)

/**
 * Props:
 *  mode: 'ai' | 'local'          (defaults from legacy `aiDifficulty` prop)
 *  difficulty: 'easy' | 'medium' | 'hard'
 *  playerColor: 'w' | 'b'        (vs AI only)
 *  onExit?: () => void
 *  onChangeSetup?: () => void
 */
export function ChessGame({ mode: modeProp, difficulty: difficultyProp, playerColor = 'w', onExit, onChangeSetup, aiDifficulty }) {
  useStudioFonts()
  const t = useT(C)
  const mode = modeProp === 'ai' || modeProp === 'local' ? modeProp : (aiDifficulty ? 'ai' : 'local')
  const difficulty = difficultyProp || aiDifficulty || 'medium'
  const { width } = useWindowDimensions()
  const boardSize = Math.floor(Math.min(width - 24, 520) / 8) * 8

  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(gameRef.current.fen())
  const [selected, setSelected] = useState(null)
  const [targets, setTargets] = useState([])
  const [lastMove, setLastMove] = useState(null)
  const [pendingPromotion, setPendingPromotion] = useState(null)
  const [thinking, setThinking] = useState(false)
  const [result, setResult] = useState(null)
  const [award, setAward] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [undoCount, setUndoCount] = useState(0)
  const mountedRef = useRef(true)
  const searchTokenRef = useRef(0)
  const recordedRef = useRef(false)

  const game = gameRef.current
  const turn = game.turn()
  const flipped = mode === 'ai' && playerColor === 'b'
  const isPlayersTurn = mode === 'local' || turn === playerColor

  useEffect(() => {
    mountedRef.current = true
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((seen) => { if (!seen && mountedRef.current) setShowTutorial(true) })
      .catch(() => {})
    return () => {
      mountedRef.current = false
      searchTokenRef.current += 1
    }
  }, [])

  const closeTutorial = useCallback(() => {
    setShowTutorial(false)
    AsyncStorage.setItem(TUTORIAL_KEY, '1').catch(() => {})
  }, [])

  const syncFromGame = useCallback(() => {
    const g = gameRef.current
    const hist = g.history({ verbose: true })
    const last = hist[hist.length - 1]
    setLastMove(last ? { from: last.from, to: last.to } : null)
    setFen(g.fen())
    setSelected(null)
    setTargets([])
    const r = describeResult(g)
    if (r) {
      setResult(r)
      setShowResult(true)
    }
  }, [])

  const commitMove = useCallback((move) => {
    try {
      gameRef.current.move(move)
    } catch {
      return false
    }
    syncFromGame()
    return true
  }, [syncFromGame])

  // Record the finished game once.
  useEffect(() => {
    if (!result || recordedRef.current) return
    recordedRef.current = true
    const plies = gameRef.current.history().length
    let outcome = 'draw'
    if (result.winner) outcome = mode === 'ai' ? (result.winner === playerColor ? 'win' : 'loss') : 'win'
    recordChessGame({ mode, difficulty, result: outcome, plies })
      .then((a) => { if (mountedRef.current) setAward(a) })
      .catch(() => {})
  }, [result, mode, difficulty, playerColor])

  // AI move.
  useEffect(() => {
    if (mode !== 'ai' || result || turn === playerColor) return undefined
    const token = ++searchTokenRef.current
    setThinking(true)
    // A plain timer, not InteractionManager.runAfterInteractions: any looping animation
    // elsewhere in the app keeps an "interaction" open forever, so the AI never got to
    // move and the board looked frozen on "AI is thinking…".
    const timer = setTimeout(async () => {
      const shouldAbort = () => !mountedRef.current || token !== searchTokenRef.current
      try {
        const move = await findBestMove(fen, difficulty, { shouldAbort })
        if (shouldAbort()) return
        if (move) commitMove(move)
      } catch (e) {
        console.warn('Chess AI failed', e)
      } finally {
        if (!shouldAbort()) setThinking(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      if (searchTokenRef.current === token) searchTokenRef.current += 1
      setThinking(false)
    }
  }, [fen, mode, result, turn, playerColor, difficulty, commitMove])

  const onSquarePress = (square) => {
    if (result || thinking || !isPlayersTurn) return
    const piece = game.get(square)
    if (selected && targets.some((m) => m.to === square)) {
      const options = targets.filter((m) => m.to === square)
      if (options.some((m) => m.promotion)) setPendingPromotion({ from: selected, to: square })
      else commitMove({ from: selected, to: square })
      return
    }
    if (piece && piece.color === turn) {
      if (selected === square) {
        setSelected(null)
        setTargets([])
      } else {
        setSelected(square)
        setTargets(game.moves({ square, verbose: true }))
      }
      return
    }
    setSelected(null)
    setTargets([])
  }

  const choosePromotion = (p) => {
    const pending = pendingPromotion
    setPendingPromotion(null)
    if (pending) commitMove({ ...pending, promotion: p })
  }

  const resetGame = () => {
    searchTokenRef.current += 1
    gameRef.current = new Chess()
    recordedRef.current = false
    setResult(null)
    setAward(null)
    setShowResult(false)
    setPendingPromotion(null)
    setThinking(false)
    setUndoCount(0)
    setLastMove(null)
    setSelected(null)
    setTargets([])
    setFen(gameRef.current.fen())
  }

  const confirmNewGame = () => {
    if (result || game.history().length === 0) return resetGame()
    Alert.alert(t('new_game_q'), t('new_game_msg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('new_game'), style: 'destructive', onPress: resetGame },
    ])
    return undefined
  }

  const undo = () => {
    if (result) return
    searchTokenRef.current += 1
    const g = gameRef.current
    if (mode === 'ai') {
      // Take back the AI's reply and your move so it's your turn again.
      if (g.turn() !== playerColor) g.undo()
      else { g.undo(); g.undo() }
    } else {
      g.undo()
    }
    setThinking(false)
    setPendingPromotion(null)
    setUndoCount((n) => n + 1)
    syncFromGame()
  }

  const resign = () => {
    if (result) return
    const who = mode === 'ai' ? playerColor : turn
    Alert.alert(t('resign_q'), mode === 'ai' ? t('you_will_lose') : t('x_will_lose', { name: colorLabel(who) }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('resign'),
        style: 'destructive',
        onPress: () => {
          searchTokenRef.current += 1
          setThinking(false)
          setResult(describeResult(gameRef.current, who))
          setShowResult(true)
        },
      },
    ])
  }

  const board = useMemo(() => game.board(), [fen]) // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => game.history(), [fen]) // eslint-disable-line react-hooks/exhaustive-deps
  const captured = useMemo(() => capturedBy(board), [board])
  const inCheck = game.inCheck()
  const checkedKing = inCheck ? game.findPiece({ type: 'k', color: turn })[0] : null
  const targetSet = useMemo(() => new Map(targets.map((m) => [m.to, m])), [targets])

  const canUndo = !result && history.length > 0 && (mode === 'local' || history.length > (playerColor === 'b' ? 1 : 0))

  const resultTitle = (() => {
    if (!result) return ''
    if (!result.winner) return t('draw')
    if (mode === 'ai') return result.winner === playerColor ? t('victory') : t('defeat')
    return t('x_wins', { name: colorLabel(result.winner) })
  })()
  const resultTone = !result?.winner ? 'draw' : mode === 'ai' && result.winner !== playerColor ? 'loss' : 'win'

  const topColor = flipped ? 'w' : 'b'
  const bottomColor = flipped ? 'b' : 'w'
  const colorName = colorLabel
  const seatName = (c) => {
    if (mode === 'ai') return c === playerColor ? `${t('you')} · ${colorName(c)}` : `${t('computer')} · ${DIFFICULTY_LABELS[difficulty] || difficulty}`
    return colorName(c)
  }
  const seatAccent = (c) => (mode === 'ai' ? (c === playerColor ? ST.friendly : ST.enemy) : c === 'w' ? '#ffffff' : ST.faint)
  const seatSub = (c) => {
    if (result) {
      if (!result.winner) return { text: `${t('draw')} · ${reasonLabel(result.reason)}`, color: ST.objective }
      return result.winner === c ? { text: `${t('wins')} · ${reasonLabel(result.reason)}`, color: ST.objective } : { text: reasonLabel(result.reason), color: ST.muted }
    }
    if (turn !== c) return { text: t('waiting'), color: ST.muted }
    if (mode === 'ai' && c !== playerColor) return { text: t('thinking'), color: ST.enemy }
    const you = mode === 'ai' ? t('your_move') : t('x_to_move', { name: colorName(c) })
    return { text: inCheck ? `${t('check')} · ${you}` : you, color: inCheck ? ST.enemy : ST.friendly }
  }
  const seat = (c) => {
    const sub = seatSub(c)
    const cap = capturedText(captured, c)
    return (
      <ChessSeat
        name={seatName(c)}
        sub={sub.text}
        subColor={sub.color}
        accent={seatAccent(c)}
        style={turn === c && !result ? { borderLeftWidth: 3, borderLeftColor: mode === 'ai' && c !== playerColor ? ST.enemy : ST.friendly } : null}
        right={
          <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
            {mode === 'ai' && c !== playerColor && thinking && !result ? <ActivityIndicator size="small" color={ST.enemy} /> : null}
            {cap ? <Text style={styles.captured} numberOfLines={1}>{cap}</Text> : null}
          </View>
        }
      />
    )
  }

  const kicker = mode === 'ai' ? `${t('vs_computer')} · ${DIFFICULTY_LABELS[difficulty] || difficulty}` : t('pass_play')

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={[stType.kicker, { flex: 1 }]} numberOfLines={1}>{kicker}{history.length ? ` · ${t('move_n', { n: Math.ceil(history.length / 2) })}` : ''}</Text>
          <Pressable onPress={() => setShowTutorial(true)} hitSlop={10} style={styles.helpBtn} accessibilityRole="button" accessibilityLabel={t('how_to_play')}>
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        </View>

        {seat(topColor)}

        <View style={{ marginVertical: 10 }}>
          <ChessBoard
            board={board}
            size={boardSize}
            flipped={flipped}
            selected={selected}
            targets={targetSet}
            lastMove={lastMove}
            checkedKing={checkedKing}
            onSquare={onSquarePress}
          />
        </View>

        <MoveList moves={history} emptyText={t('moves_appear')} />

        {seat(bottomColor)}

        <View style={styles.actions}>
          <ActionTile label={t('undo')} icon="arrow-undo" onPress={undo} disabled={!canUndo} />
          <ActionTile label={result ? t('new_game') : t('restart')} icon="refresh" onPress={confirmNewGame} tone={result ? 'friendly' : undefined} />
          <ActionTile label={t('resign')} icon="flag" onPress={resign} disabled={!!result || history.length === 0} tone="danger" />
        </View>
        {(onChangeSetup || (result && !showResult)) && (
          <View style={[styles.actions, { marginTop: 6 }]}>
            {onChangeSetup ? <ActionTile label={t('change_mode')} icon="options" onPress={onChangeSetup} /> : null}
            {result && !showResult ? <ActionTile label={t('result')} icon="podium" onPress={() => setShowResult(true)} tone="objective" /> : null}
          </View>
        )}
        {mode === 'ai' && undoCount > 0 && !result && (
          <Text style={[stType.label, { marginTop: 10, color: ST.faint }]}>{t('takebacks', { n: undoCount })}</Text>
        )}
      </ScrollView>

      <PromotionPicker
        visible={!!pendingPromotion}
        color={turn}
        onPick={choosePromotion}
        onCancel={() => setPendingPromotion(null)}
      />

      <ChessResultSheet
        visible={showResult && !!result}
        tone={resultTone}
        kicker={`${mode === 'ai' ? t('vs_computer') : t('pass_play')} · ${reasonLabel(result?.reason)}`}
        title={resultTitle}
        sub={`${result?.winner ? t('x_wins', { name: colorName(result.winner) }) : t('draw')} · ${reasonLabel(result?.reason)} · ${t('n_moves', { n: Math.ceil(history.length / 2) })}`}
        stats={[
          { label: t('moves'), value: String(Math.ceil(history.length / 2)) },
          ...(award && typeof award.ratingAfter === 'number'
            ? [{ label: t('rating_vs_ai'), value: String(award.ratingAfter) }, { label: t('change'), value: `${award.ratingDelta >= 0 ? '+' : ''}${award.ratingDelta}`, color: award.ratingDelta >= 0 ? ST.health : ST.enemy }]
            : []),
          ...(award ? [{ label: t('points'), value: `+${award.pointsEarned}`, color: ST.objective }] : []),
        ]}
        onRequestClose={() => setShowResult(false)}
        actions={(
          <>
            <StButton title={t('play_again')} onPress={resetGame} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StButton title={t('view_board')} tone="ghost" height={44} onPress={() => setShowResult(false)} style={{ flex: 1 }} />
              {onExit ? <StButton title={t('exit')} tone="ghost" height={44} onPress={onExit} style={{ flex: 1 }} /> : null}
            </View>
          </>
        )}
      />

      {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle={t('chess')} />}
    </View>
  )
}

export default ChessGame

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ST.ground },
  scroll: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 48 },
  topRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, marginBottom: 8 },
  helpBtn: { width: 30, height: 30, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, alignItems: 'center', justifyContent: 'center' },
  helpText: { fontSize: 15, fontFamily: FONT.display, color: ST.text },

  boardFrame: { borderWidth: 1, borderColor: ST.line, backgroundColor: ST.ground2 },
  boardRow: { flexDirection: 'row', flex: 1 },
  square: { alignItems: 'center', justifyContent: 'center' },
  selectedSq: { backgroundColor: withAlpha(ST.friendly, 0.3), borderWidth: 3, borderColor: ST.friendly },
  checkSq: { backgroundColor: withAlpha(ST.enemy, 0.6) },
  coord: { position: 'absolute', fontSize: 9, fontFamily: FONT.ui },
  rankCoord: { top: 1, left: 3 },
  fileCoord: { bottom: 0, right: 3 },
  piece: { textAlign: 'center', includeFontPadding: false },
  whitePiece: { color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 0 } },
  blackPiece: { color: '#111418', textShadowColor: 'rgba(255,255,255,0.35)', textShadowRadius: 1, textShadowOffset: { width: 0, height: 0 } },
  moveDot: { position: 'absolute', backgroundColor: MARK },
  captureRing: { position: 'absolute', borderWidth: 4, borderColor: MARK },

  avatar: { backgroundColor: '#2a3038', borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontFamily: FONT.display, color: ST.text, includeFontPadding: false },
  seat: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, backgroundColor: ST.panel, borderRadius: ST.radius,
  },
  seatName: { fontFamily: FONT.display, fontSize: 16, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  seatSub: { fontFamily: FONT.uiSemi, fontSize: 11, color: ST.muted, marginTop: 1 },
  captured: { fontSize: 15, color: ST.muted },

  clock: { paddingHorizontal: 12, paddingVertical: 4, minWidth: 84, alignItems: 'center', borderRadius: ST.radius },

  actions: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: 10 },
  action: {
    flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: ST.radius, paddingHorizontal: 4,
  },
  actionText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  badge: { position: 'absolute', top: -6, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: ST.radius, backgroundColor: ST.enemy, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: FONT.display, fontSize: 10, color: '#ffffff', includeFontPadding: false },

  moveList: { alignSelf: 'stretch', maxHeight: 30, marginBottom: 8 },
  moveListContent: { alignItems: 'center', gap: 12, paddingHorizontal: 2 },
  moveText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1, color: 'rgba(242,244,247,0.7)' },
  moveMuted: { fontFamily: FONT.uiSemi, fontSize: 12, color: ST.faint },

  overlay: { flex: 1, backgroundColor: 'rgba(4,5,8,0.72)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 360, padding: 18, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderTopWidth: 2, borderTopColor: ST.friendly },
  promoRow: { flexDirection: 'row', gap: 6 },
  promoBtn: { flex: 1, aspectRatio: 0.85, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', borderRadius: ST.radius },
  promoPiece: { fontSize: 44, lineHeight: 52, textAlign: 'center' },
  promoLabel: { fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1.2, color: ST.ink, textTransform: 'uppercase', marginTop: -2 },

  resultRoot: { flex: 1, backgroundColor: 'rgba(11,13,17,0.97)' },
  resultWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 300 },
  resultScroll: { flexGrow: 1, justifyContent: 'center', padding: 16, paddingTop: 60, paddingBottom: 32 },
  resultInner: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  resultStats: { flexDirection: 'row', gap: 6, marginTop: 26 },
  resultStat: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: ST.panel, borderRadius: ST.radius, gap: 2 },
})
