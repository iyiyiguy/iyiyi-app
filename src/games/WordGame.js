// Word Race: solo, timed. Crack as many hidden 5-letter words as you can before the
// clock runs out. Six guesses per word; every guess must be a real word. Solving adds
// time to the clock, fewer guesses and streaks score more.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, Animated, AppState, Modal, useWindowDimensions,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import GlassPanel from '../components/GlassPanel'
import { GameTutorial } from '../components/GameTutorial'
import { colors, radii, type } from '../theme'
import { ANSWERS, isValidWord } from '../lib/wordRaceWords'
import { loadArcadeStats, recordWordRace } from '../lib/arcadeStats'

const WORD_LEN = 5
const MAX_GUESSES = 6
const START_MS = 120 * 1000
const SOLVE_BONUS_MS = 15 * 1000
const SKIP_PENALTY_MS = 10 * 1000
const TUTORIAL_KEY = 'word_race_tutorial_seen_v2'

const TILE = { correct: '#3a9d4f', present: '#c99a1e', absent: '#5d6170' }
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

const TUTORIAL_STEPS = [
  { icon: '⏱️', title: 'Race the clock', description: 'You start with 2 minutes. Solve as many hidden 5-letter words as you can before time runs out.' },
  { icon: '🟩', title: 'Green = right spot', description: 'The letter is in the word and in the correct position.' },
  { icon: '🟨', title: 'Yellow = wrong spot', description: 'The letter is in the word but somewhere else.' },
  { icon: '⬛', title: 'Gray = not in word', description: 'That letter is not in the word. Guesses must be real English words.' },
  { icon: '⚡', title: 'Bonuses', description: 'Each solve adds 15 seconds. Fewer guesses and solve streaks score more. Skipping costs 10 seconds.' },
]

// Two-pass scoring so repeated letters are coloured correctly.
export function scoreGuess(guess, target) {
  const res = Array(WORD_LEN).fill('absent')
  const remaining = {}
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === target[i]) res[i] = 'correct'
    else remaining[target[i]] = (remaining[target[i]] || 0) + 1
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (res[i] === 'correct') continue
    const ch = guess[i]
    if (remaining[ch] > 0) {
      res[i] = 'present'
      remaining[ch] -= 1
    }
  }
  return res
}

const RANK = { absent: 1, present: 2, correct: 3 }

function shuffled(list) {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function WordGame({ onExit }) {
  const { width } = useWindowDimensions()
  const tileSize = Math.min(Math.floor((width - 72) / WORD_LEN), 58)
  const keyWidth = Math.min(Math.floor((width - 16 - 9 * 5) / 10), 40)

  const [phase, setPhase] = useState('ready') // ready | playing | over
  const [paused, setPaused] = useState(false)
  const [target, setTarget] = useState('')
  const [guesses, setGuesses] = useState([]) // [{ word, score }]
  const [current, setCurrent] = useState('')
  const [remainingMs, setRemainingMs] = useState(START_MS)
  const [score, setScore] = useState(0)
  const [solved, setSolved] = useState([]) // [{ word, tries }]
  const [missed, setMissed] = useState([])
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [toast, setToast] = useState(null)
  const [summary, setSummary] = useState(null)
  const [best, setBest] = useState(null)
  const [showTutorial, setShowTutorial] = useState(false)

  const deckRef = useRef([])
  const endAtRef = useRef(0)
  const pausedRemainingRef = useRef(null)
  const toastTimerRef = useRef(null)
  const advanceTimerRef = useRef(null)
  const shake = useRef(new Animated.Value(0)).current
  const mountedRef = useRef(true)
  const finishedRef = useRef(false)
  const stateRef = useRef({})
  stateRef.current = { score, solved, bestStreak, phase }

  useEffect(() => {
    mountedRef.current = true
    loadArcadeStats().then((s) => { if (mountedRef.current) setBest(s.games['word-race']?.bestScore ?? null) })
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((seen) => { if (!seen && mountedRef.current) setShowTutorial(true) })
      .catch(() => {})
    return () => {
      mountedRef.current = false
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    }
  }, [])

  const scheduleNext = (ms) => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null
      if (mountedRef.current && !finishedRef.current) nextWord()
    }, ms)
  }

  const showToast = useCallback((text, ms = 1400) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(text)
    toastTimerRef.current = setTimeout(() => setToast(null), ms)
  }, [])

  const nextWord = useCallback(() => {
    if (deckRef.current.length === 0) deckRef.current = shuffled(ANSWERS)
    setTarget(deckRef.current.pop().toUpperCase())
    setGuesses([])
    setCurrent('')
  }, [])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const { score: sc, solved: sv, bestStreak: bs } = stateRef.current
    setPhase('over')
    setPaused(false)
    setRemainingMs(0)
    recordWordRace({ score: sc, wordsSolved: sv.length, bestStreak: bs })
      .then((r) => {
        if (!mountedRef.current) return
        setSummary(r)
        if (r.isNewBest) setBest(sc)
      })
      .catch(() => {})
  }, [])

  const start = () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    finishedRef.current = false
    deckRef.current = shuffled(ANSWERS)
    setScore(0)
    setSolved([])
    setMissed([])
    setStreak(0)
    setBestStreak(0)
    setSummary(null)
    setPaused(false)
    pausedRemainingRef.current = null
    endAtRef.current = Date.now() + START_MS
    setRemainingMs(START_MS)
    nextWord()
    setPhase('playing')
  }

  // Clock.
  useEffect(() => {
    if (phase !== 'playing' || paused) return undefined
    const id = setInterval(() => {
      const left = endAtRef.current - Date.now()
      if (left <= 0) finish()
      else setRemainingMs(left)
    }, 200)
    return () => clearInterval(id)
  }, [phase, paused, finish])

  const pause = useCallback(() => {
    if (stateRef.current.phase !== 'playing') return
    pausedRemainingRef.current = Math.max(0, endAtRef.current - Date.now())
    setPaused(true)
  }, [])

  const resume = () => {
    endAtRef.current = Date.now() + (pausedRemainingRef.current ?? remainingMs)
    pausedRemainingRef.current = null
    setPaused(false)
  }

  // Auto-pause when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') pause()
    })
    return () => sub.remove()
  }, [pause])

  const addTime = (ms) => {
    endAtRef.current += ms
    setRemainingMs(Math.max(0, endAtRef.current - Date.now()))
  }

  const doShake = () => {
    shake.setValue(0)
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start()
  }

  const submit = () => {
    if (current.length < WORD_LEN) {
      doShake()
      showToast('Not enough letters')
      return
    }
    if (!isValidWord(current)) {
      doShake()
      showToast('Not in word list')
      return
    }
    const sc = scoreGuess(current, target)
    const nextGuesses = [...guesses, { word: current, score: sc }]
    setGuesses(nextGuesses)
    setCurrent('')
    if (current === target) {
      const tries = nextGuesses.length
      const newStreak = streak + 1
      const gained = 50 + (MAX_GUESSES + 1 - tries) * 25 + Math.min(50, (newStreak - 1) * 10)
      setScore((s) => s + gained)
      setStreak(newStreak)
      setBestStreak((b) => Math.max(b, newStreak))
      setSolved((l) => [...l, { word: target, tries }])
      addTime(SOLVE_BONUS_MS)
      showToast(`+${gained}  ·  +15s`)
      scheduleNext(650)
    } else if (nextGuesses.length >= MAX_GUESSES) {
      setStreak(0)
      setMissed((l) => [...l, target])
      showToast(`It was ${target}`, 1800)
      scheduleNext(1200)
    }
  }

  const skip = () => {
    if (phase !== 'playing' || paused || roundLocked) return
    setStreak(0)
    setMissed((l) => [...l, target])
    showToast(`Skipped – it was ${target}  ·  −10s`, 1600)
    endAtRef.current -= SKIP_PENALTY_MS
    const left = endAtRef.current - Date.now()
    if (left <= 0) { finish(); return }
    setRemainingMs(left)
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    nextWord()
  }

  // Lock input while a solved/failed word is waiting to be replaced.
  const roundLocked = guesses.length >= MAX_GUESSES || (guesses.length > 0 && guesses[guesses.length - 1].word === target)

  const onKey = (k) => {
    if (phase !== 'playing' || paused || roundLocked) return
    if (k === 'ENTER') return submit()
    if (k === 'DEL') return setCurrent((c) => c.slice(0, -1))
    setCurrent((c) => (c.length < WORD_LEN ? c + k : c))
  }

  const keyStates = useMemo(() => {
    const m = {}
    guesses.forEach(({ word, score: sc }) => {
      for (let i = 0; i < WORD_LEN; i++) {
        const ch = word[i]
        if (!m[ch] || RANK[sc[i]] > RANK[m[ch]]) m[ch] = sc[i]
      }
    })
    return m
  }, [guesses])

  const closeTutorial = () => {
    setShowTutorial(false)
    AsyncStorage.setItem(TUTORIAL_KEY, '1').catch(() => {})
  }

  const lowTime = phase === 'playing' && remainingMs <= 15000

  const renderRow = (rowIdx) => {
    const g = guesses[rowIdx]
    const isCurrent = !g && rowIdx === guesses.length
    const letters = g ? g.word : isCurrent ? current : ''
    const row = (
      <View key={rowIdx} style={styles.row}>
        {Array.from({ length: WORD_LEN }).map((_, i) => {
          const ch = letters[i] || ''
          const state = g ? g.score[i] : null
          return (
            <View
              key={i}
              style={[
                styles.tile,
                { width: tileSize, height: tileSize },
                state ? { backgroundColor: TILE[state], borderColor: TILE[state] } : ch ? styles.tileFilled : null,
              ]}
            >
              <Text style={[styles.tileText, { fontSize: tileSize * 0.5 }, state && { color: colors.onBrand }]}>{ch}</Text>
            </View>
          )
        })}
      </View>
    )
    if (!isCurrent) return row
    const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] })
    return <Animated.View key={rowIdx} style={{ transform: [{ translateX }] }}>{row}</Animated.View>
  }

  if (phase === 'ready') {
    // Plain conditional render (no hooks below this point).
    return (
      <View style={styles.container}>
        <GlassPanel style={styles.introCard} animateIn={false}>
          <Text style={styles.introTitle}>What's The Word</Text>
          <Text style={styles.introBody}>
            Crack as many hidden 5-letter words as you can in 2 minutes. Six guesses per word, real words only. Every solve adds 15 seconds.
          </Text>
          <Text style={styles.introBest}>{best != null ? `Personal best: ${best}` : 'No best score yet'}</Text>
          <Pressable onPress={start} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Start</Text>
          </Pressable>
          <Pressable onPress={() => setShowTutorial(true)} style={styles.linkBtn}>
            <Text style={styles.linkText}>How to play</Text>
          </Pressable>
        </GlassPanel>
        {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="What's The Word" />}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.hud}>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Time</Text>
          <Text style={[styles.hudValue, lowTime && { color: colors.danger }]}>{formatClock(remainingMs)}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Score</Text>
          <Text style={styles.hudValue}>{score}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Solved</Text>
          <Text style={styles.hudValue}>{solved.length}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Streak</Text>
          <Text style={styles.hudValue}>{streak}</Text>
        </View>
      </View>

      <View style={styles.boardWrap}>
        {paused ? (
          <GlassPanel style={styles.pausedCard} animateIn={false}>
            <Text style={styles.introTitle}>Paused</Text>
            <Text style={styles.introBody}>The clock is stopped.</Text>
            <Pressable onPress={resume} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryBtnText}>Resume</Text>
            </Pressable>
          </GlassPanel>
        ) : (
          <View style={styles.grid}>{Array.from({ length: MAX_GUESSES }).map((_, r) => renderRow(r))}</View>
        )}
        {toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={paused ? resume : pause} disabled={phase !== 'playing'} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <Pressable onPress={skip} disabled={phase !== 'playing' || paused} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>Skip (−10s)</Text>
        </Pressable>
        <Pressable onPress={finish} disabled={phase !== 'playing'} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>End run</Text>
        </Pressable>
      </View>

      <View style={styles.keyboard}>
        {KEY_ROWS.map((r, ri) => (
          <View key={r} style={styles.keyRow}>
            {ri === 2 && <Key label="ENTER" wide onPress={() => onKey('ENTER')} width={keyWidth * 1.5} />}
            {r.split('').map((k) => (
              <Key key={k} label={k} state={keyStates[k]} onPress={() => onKey(k)} width={keyWidth} />
            ))}
            {ri === 2 && <Key label="⌫" wide onPress={() => onKey('DEL')} width={keyWidth * 1.5} accessibilityLabel="Delete" />}
          </View>
        ))}
      </View>

      <Modal visible={phase === 'over'} transparent animationType="fade" onRequestClose={() => setPhase('ready')}>
        <View style={styles.modalOverlay}>
          <GlassPanel strong style={styles.modalCard}>
            <Text style={styles.introTitle}>Time!</Text>
            <Text style={styles.finalScore}>{score}</Text>
            <Text style={styles.introBody}>
              {solved.length} word{solved.length === 1 ? '' : 's'} solved · best streak {bestStreak}
            </Text>
            {summary?.isNewBest && score > 0 && <Text style={styles.newBest}>New personal best!</Text>}
            {summary && <Text style={styles.points}>+{summary.pointsEarned} arcade points</Text>}
            {(solved.length > 0 || missed.length > 0) && (
              <Text style={styles.wordsLine} numberOfLines={4}>
                {solved.map((s) => s.word).join(' · ')}
                {missed.length > 0 ? `${solved.length ? '\n' : ''}Missed: ${missed.join(' · ')}` : ''}
              </Text>
            )}
            <Pressable onPress={start} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryBtnText}>Play again</Text>
            </Pressable>
            {onExit && (
              <Pressable onPress={onExit} style={styles.linkBtn}>
                <Text style={styles.linkText}>Exit</Text>
              </Pressable>
            )}
          </GlassPanel>
        </View>
      </Modal>

      {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="What's The Word" />}
    </View>
  )
}

function Key({ label, state, onPress, width, wide, accessibilityLabel }) {
  const bg = state ? TILE[state] : colors.inkSurfaceRaised
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [styles.key, { width, backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.keyText, wide && { fontSize: 12 }, state && { color: colors.onBrand }]}>{label}</Text>
    </Pressable>
  )
}

export default WordGame

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 24 },
  introCard: { margin: 8, padding: 24, alignItems: 'center' },
  introTitle: { ...type.display, textAlign: 'center' },
  introBody: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  introBest: { ...type.label, marginTop: 16 },
  primaryBtn: { marginTop: 18, alignSelf: 'stretch', backgroundColor: colors.magenta, borderRadius: radii.pill, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { ...type.body, color: colors.onBrand, fontWeight: '800', fontSize: 16 },
  linkBtn: { paddingVertical: 12, alignItems: 'center', alignSelf: 'stretch' },
  linkText: { ...type.body, color: colors.textMuted, fontWeight: '600' },
  hud: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  hudItem: { alignItems: 'center', minWidth: 64 },
  hudLabel: { ...type.label, fontSize: 10, marginBottom: 2 },
  hudValue: { ...type.title, fontVariant: ['tabular-nums'] },
  boardWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { gap: 6 },
  row: { flexDirection: 'row', gap: 6 },
  tile: { borderWidth: 2, borderColor: colors.hairline, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tileFilled: { borderColor: colors.textFaint },
  tileText: { ...type.title, fontWeight: '800' },
  pausedCard: { padding: 24, width: '90%', alignItems: 'center' },
  toast: { position: 'absolute', top: 8, backgroundColor: colors.inkSurfaceRaised, borderRadius: radii.pill, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: colors.hairline },
  toastText: { ...type.body, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 10 },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline },
  smallBtnText: { ...type.caption, color: colors.text, fontWeight: '700' },
  keyboard: { gap: 7, alignItems: 'center' },
  keyRow: { flexDirection: 'row', gap: 5 },
  key: { height: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  keyText: { ...type.body, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 360, padding: 24, alignItems: 'center' },
  finalScore: { ...type.display, fontSize: 52, marginTop: 4 },
  newBest: { ...type.body, color: colors.gold, fontWeight: '800', marginTop: 8 },
  points: { ...type.body, color: colors.success, fontWeight: '700', marginTop: 6 },
  wordsLine: { ...type.caption, textAlign: 'center', marginTop: 12 },
})
