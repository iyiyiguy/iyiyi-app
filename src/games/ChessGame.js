// Full chess game: rules from chess.js (legal moves, check, mate, stalemate, draws,
// castling, en passant, promotion), vs the built-in AI or local pass & play.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, Alert, ActivityIndicator,
  InteractionManager, useWindowDimensions,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Chess } from 'chess.js'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { GameTutorial } from '../components/GameTutorial'
import { AC } from './arcadeUI'
import { font } from '../theme'
import { findBestMove, DIFFICULTY_LABELS } from '../lib/chessAI'
import { recordChessGame } from '../lib/arcadeStats'

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
// Filled glyphs for both sides, tinted per colour. ︎ keeps the pawn from
// rendering as an emoji on iOS.
export const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' }
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 }
export const PROMOTION_CHOICES = ['q', 'r', 'b', 'n']
const TUTORIAL_KEY = 'chess_tutorial_seen_v2'

export const BOARD_LIGHT = '#ecd9b9'
export const BOARD_DARK = '#b58863'

const TUTORIAL_STEPS = [
  { icon: '♟️', title: 'Tap to move', description: 'Tap one of your pieces to see its legal moves (dots), then tap a highlighted square to move there.' },
  { icon: '👑', title: 'Checkmate wins', description: "Put the enemy king in check with no way out. The king's square glows red when it is in check." },
  { icon: '🏰', title: 'Special moves', description: 'Castling, en passant and pawn promotion all work. When a pawn reaches the last rank you choose its new piece.' },
  { icon: '🤖', title: 'Play the computer', description: 'Pick Easy, Medium or Hard. Wins against the computer raise your chess rating and earn arcade points.' },
  { icon: '🤝', title: 'Pass & play', description: 'Play a friend on this device. White moves first, then hand over the phone.' },
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

/**
 * Props:
 *  mode: 'ai' | 'local'          (defaults from legacy `aiDifficulty` prop)
 *  difficulty: 'easy' | 'medium' | 'hard'
 *  playerColor: 'w' | 'b'        (vs AI only)
 *  onExit?: () => void
 *  onChangeSetup?: () => void
 */
export function ChessGame({ mode: modeProp, difficulty: difficultyProp, playerColor = 'w', onExit, onChangeSetup, aiDifficulty }) {
  const mode = modeProp || (aiDifficulty ? 'ai' : 'local')
  const difficulty = difficultyProp || aiDifficulty || 'medium'
  const { width } = useWindowDimensions()
  const boardSize = Math.min(width - 24, 520)
  const sq = boardSize / 8

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
  const moveScrollRef = useRef(null)

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
    let timer = null
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(async () => {
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
    })
    return () => {
      task.cancel?.()
      if (timer) clearTimeout(timer)
      if (searchTokenRef.current === token) searchTokenRef.current += 1
      setThinking(false)
    }
  }, [fen, mode, result, turn, playerColor, difficulty, commitMove])

  useEffect(() => {
    const t = setTimeout(() => moveScrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [fen])

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
    Alert.alert('Start a new game?', 'The current game will be abandoned.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'New game', style: 'destructive', onPress: resetGame },
    ])
  }

  const undo = () => {
    if (result) return
    searchTokenRef.current += 1
    const g = gameRef.current
    if (mode === 'ai') {
      // Take back the AI's reply and your move so it's your turn again.
      if (g.turn() !== playerColor) g.undo()
      else { g.undo(); g.undo() }
      // If you're Black and only the AI's opening move is left, keep it.
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
    const label = mode === 'ai' ? 'You' : who === 'w' ? 'White' : 'Black'
    Alert.alert('Resign?', `${label} will lose this game.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resign',
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
  const targetSet = new Map(targets.map((m) => [m.to, m]))

  const canUndo = !result && history.length > 0 && (mode === 'local' || history.length > (playerColor === 'b' ? 1 : 0))

  let status
  if (result) {
    status = result.winner ? `${result.winner === 'w' ? 'White' : 'Black'} wins by ${result.reason}` : `Draw — ${result.reason}`
  } else if (mode === 'ai') {
    status = thinking || turn !== playerColor ? `${DIFFICULTY_LABELS[difficulty]} AI is thinking…` : inCheck ? 'Check! Your move' : 'Your move'
  } else {
    status = `${turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' — check!' : ''}`
  }

  const resultTitle = (() => {
    if (!result) return ''
    if (!result.winner) return 'Draw'
    if (mode === 'ai') return result.winner === playerColor ? 'You win!' : 'You lost'
    return `${result.winner === 'w' ? 'White' : 'Black'} wins!`
  })()

  const topColor = flipped ? 'w' : 'b'
  const bottomColor = flipped ? 'b' : 'w'
  const sideLabel = (c) => {
    if (mode === 'ai') return c === playerColor ? 'You' : `Computer (${DIFFICULTY_LABELS[difficulty]})`
    return c === 'w' ? 'White' : 'Black'
  }

  const renderCaptured = (c) => {
    const list = captured[c]
    const adv = c === 'w' ? captured.diff : -captured.diff
    return (
      <View style={styles.playerRow}>
        <View style={[styles.turnDot, turn === c && !result && styles.turnDotActive]} />
        <Text style={styles.playerName} numberOfLines={1}>{sideLabel(c)}</Text>
        <Text style={styles.capturedText} numberOfLines={1}>
          {list.map((t) => GLYPHS[t]).join('')}
          {adv > 0 ? `  +${adv}` : ''}
        </Text>
      </View>
    )
  }

  const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: result ? AC.gold : isPlayersTurn && !thinking ? AC.live : AC.muted }]} />
          <Text style={[styles.status, result && { color: AC.gold }]} numberOfLines={1}>{status}</Text>
          {thinking && <ActivityIndicator size="small" color={AC.accent} />}
          <Pressable onPress={() => setShowTutorial(true)} hitSlop={10} style={styles.helpBtn} accessibilityLabel="How to play">
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        </View>

        {renderCaptured(topColor)}

        <View style={[styles.boardFrame, { width: boardSize + 8, height: boardSize + 8 }]}>
        <View style={[styles.board, { width: boardSize, height: boardSize }]}>
          {rows.map((r) => (
            <View key={r} style={styles.boardRow}>
              {cols.map((c) => {
                const square = FILES[c] + (8 - r)
                const piece = board[r][c]
                const light = (r + c) % 2 === 0
                const isSel = selected === square
                const isLast = lastMove && (lastMove.from === square || lastMove.to === square)
                const target = targetSet.get(square)
                const isCheck = checkedKing === square
                const showFile = rows[7] === r
                const showRank = cols[0] === c
                return (
                  <Pressable
                    key={square}
                    onPress={() => onSquarePress(square)}
                    style={[styles.square, { width: sq, height: sq, backgroundColor: light ? BOARD_LIGHT : BOARD_DARK }]}
                    accessibilityLabel={`${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
                  >
                    {isLast && <View style={[StyleSheet.absoluteFill, styles.lastMove]} />}
                    {isSel && <View style={[StyleSheet.absoluteFill, styles.selectedSq]} />}
                    {isCheck && <View style={[StyleSheet.absoluteFill, styles.checkSq]} />}
                    {showRank && <Text style={[styles.coord, styles.rankCoord, { color: light ? BOARD_DARK : BOARD_LIGHT }]}>{8 - r}</Text>}
                    {showFile && <Text style={[styles.coord, styles.fileCoord, { color: light ? BOARD_DARK : BOARD_LIGHT }]}>{FILES[c]}</Text>}
                    {piece && (
                      <Text
                        allowFontScaling={false}
                        style={[
                          styles.piece,
                          { fontSize: sq * 0.78, lineHeight: sq * 0.95 },
                          piece.color === 'w' ? styles.whitePiece : styles.blackPiece,
                        ]}
                      >
                        {GLYPHS[piece.type]}
                      </Text>
                    )}
                    {target && (piece || target.flags.includes('e')
                      ? <View style={[styles.captureRing, { width: sq - 4, height: sq - 4, borderRadius: sq }]} />
                      : <View style={[styles.moveDot, { width: sq * 0.3, height: sq * 0.3, borderRadius: sq }]} />)}
                  </Pressable>
                )
              })}
            </View>
          ))}
        </View>
        </View>

        {renderCaptured(bottomColor)}

        <ScrollView horizontal ref={moveScrollRef} style={styles.moveList} contentContainerStyle={styles.moveListContent} showsHorizontalScrollIndicator={false}>
          {history.length === 0 ? (
            <Text style={styles.moveTextMuted}>Moves will appear here</Text>
          ) : (
            history.reduce((acc, san, i) => {
              if (i % 2 === 0) acc.push([san])
              else acc[acc.length - 1].push(san)
              return acc
            }, []).map((pair, i) => (
              <Text key={i} style={styles.moveText}>
                <Text style={styles.moveTextMuted}>{i + 1}. </Text>
                {pair.join(' ')}
              </Text>
            ))
          )}
        </ScrollView>

        <View style={styles.controls}>
          <ControlButton label="Undo" icon="arrow-undo" onPress={undo} disabled={!canUndo} />
          <ControlButton label={result ? 'New game' : 'Restart'} icon="refresh" onPress={confirmNewGame} />
          <ControlButton label="Resign" icon="flag" onPress={resign} disabled={!!result || history.length === 0} danger />
        </View>
        {(onChangeSetup || onExit) && (
          <View style={styles.controls}>
            {onChangeSetup && <ControlButton label="Change mode" icon="options" onPress={onChangeSetup} subtle />}
            {result && !showResult && <ControlButton label="Show result" icon="trophy" onPress={() => setShowResult(true)} subtle />}
          </View>
        )}
        {mode === 'ai' && undoCount > 0 && !result && (
          <Text style={styles.footnote}>Takebacks used: {undoCount}</Text>
        )}
      </ScrollView>

      {/* Promotion picker */}
      <Modal visible={!!pendingPromotion} transparent animationType="fade" onRequestClose={() => setPendingPromotion(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Promote pawn to</Text>
            <View style={styles.promoRow}>
              {PROMOTION_CHOICES.map((p) => (
                <Pressable key={p} onPress={() => choosePromotion(p)} style={({ pressed }) => [styles.promoBtn, pressed && { opacity: 0.7 }]} accessibilityLabel={`Promote to ${p}`}>
                  <Text allowFontScaling={false} style={[styles.promoPiece, turn === 'w' ? styles.whitePiece : styles.blackPiece]}>{GLYPHS[p]}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setPendingPromotion(null)} style={styles.modalLink}>
              <Text style={styles.modalLinkText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Game over */}
      <Modal visible={showResult && !!result} transparent animationType="fade" onRequestClose={() => setShowResult(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.resultGlyph} allowFontScaling={false}>{!result?.winner ? '🤝' : mode === 'ai' && result.winner !== playerColor ? '♚' : '🏆'}</Text>
            <Text style={styles.resultTitle}>{resultTitle}</Text>
            <Text style={styles.resultReason}>
              {result?.winner ? `by ${result.reason}` : result?.reason ? `by ${result.reason}` : ''}
            </Text>
            {award && (
              <View style={styles.awardBox}>
                {typeof award.ratingAfter === 'number' && (
                  <Text style={styles.awardLine}>
                    Rating {award.ratingBefore} → {award.ratingAfter}{' '}
                    <Text style={{ color: award.ratingDelta >= 0 ? AC.live : AC.danger }}>
                      ({award.ratingDelta >= 0 ? '+' : ''}{award.ratingDelta})
                    </Text>
                  </Text>
                )}
                <Text style={styles.awardLine}>+{award.pointsEarned} arcade points</Text>
              </View>
            )}
            <Pressable onPress={resetGame} style={({ pressed }) => [pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
              <LinearGradient colors={AC.play} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtn}>
                <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>Play again</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={() => setShowResult(false)} style={styles.modalLink}>
              <Text style={styles.modalLinkText}>View board</Text>
            </Pressable>
            {onExit && (
              <Pressable onPress={onExit} style={styles.modalLink}>
                <Text style={styles.modalLinkText}>Exit</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="Chess" />}
    </View>
  )
}

function ControlButton({ label, icon, onPress, disabled, danger, subtle }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ctrlBtn,
        danger && styles.ctrlBtnDanger,
        subtle && styles.ctrlBtnSubtle,
        { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
      accessibilityRole="button"
    >
      {icon ? <Ionicons name={icon} size={15} color={danger ? AC.danger : AC.text} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.ctrlText, danger && { color: AC.danger }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

export default ChessGame

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 48 },
  statusRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { flex: 1, fontSize: 17, ...font.bold, letterSpacing: -0.2, color: AC.text },
  helpBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: AC.border, alignItems: 'center', justifyContent: 'center', backgroundColor: AC.cardStrong },
  helpText: { fontSize: 15, ...font.bold, color: AC.text },
  playerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 6, paddingVertical: 8, gap: 8 },
  turnDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: AC.border },
  turnDotActive: { backgroundColor: AC.live },
  playerName: { fontSize: 15, ...font.bold, color: AC.text, maxWidth: '55%' },
  capturedText: { fontSize: 15, color: AC.muted, flex: 1, textAlign: 'right' },
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
  moveTextMuted: { fontSize: 13, ...font.regular, color: AC.muted },
  controls: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 12 },
  ctrlBtn: {
    flex: 1, flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: AC.cardStrong, borderWidth: 1, borderColor: AC.border,
  },
  ctrlBtnDanger: { borderColor: 'rgba(255,93,108,0.45)', backgroundColor: 'rgba(255,93,108,0.10)' },
  ctrlBtnSubtle: { backgroundColor: 'transparent' },
  ctrlText: { fontSize: 14, ...font.bold, color: AC.text },
  footnote: { fontSize: 13, ...font.regular, color: AC.faint, marginTop: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(2,3,10,0.66)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 340, padding: 22, alignItems: 'stretch', borderRadius: 28, backgroundColor: '#0d1126', borderWidth: 1, borderColor: AC.border },
  modalTitle: { fontSize: 20, ...font.bold, color: AC.text, textAlign: 'center', marginBottom: 16 },
  promoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  promoBtn: { flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: BOARD_LIGHT, alignItems: 'center', justifyContent: 'center' },
  promoPiece: { fontSize: 44, lineHeight: 52, textAlign: 'center' },
  modalLink: { paddingVertical: 12, alignItems: 'center' },
  modalLinkText: { fontSize: 15, ...font.semibold, color: AC.muted },
  resultGlyph: { fontSize: 46, textAlign: 'center', color: AC.gold },
  resultTitle: { fontSize: 32, ...font.heavy, letterSpacing: -0.8, color: AC.text, textAlign: 'center', marginTop: 4 },
  resultReason: { fontSize: 15, ...font.regular, color: AC.muted, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  awardBox: { borderRadius: 16, borderWidth: 1, borderColor: AC.border, backgroundColor: AC.card, padding: 12, marginBottom: 16, gap: 4 },
  awardLine: { fontSize: 15, ...font.semibold, color: AC.text, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', borderRadius: 20, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: 16, ...font.heavy, color: '#fff' },
})
