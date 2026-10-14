// What's The Word (Word Race), two modes:
//  - Daily: one shared word per local calendar day (same for everyone, see ./wordDaily), six
//    guesses, one attempt per day (persisted), a results card with a spoiler-free share grid,
//    streaks, stats, guess distribution and a countdown to the next word.
//  - Timed run: crack as many hidden 5-letter words as you can before the clock runs out.
//    Six guesses per word; every guess must be a real word. Solving adds time to the clock,
//    fewer guesses and streaks score more.
//
// Presentation: the studio HUD look (see ./studio): dark ground, flat square letter tiles
// (green right spot, amber wrong spot, slate not in word) that pop when typed and flip to
// reveal, a draining timer bar, caps labels with Chakra Petch numbers, callouts, a confetti
// burst on every solve, synthesized sounds (gunAudio `word*` effects) and haptics.
// Everything animates with react-native Animated (native driver where possible), so it runs
// the same on iOS, Android and web.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated, AppState, Easing, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { GameTutorial } from '../components/GameTutorial'
import { FONT, ST, StButton, StPanel, StStat, stType, useStudioFonts, withAlpha } from './studio'
import { ANSWERS, isValidWord } from '../lib/wordRaceWords'
import { loadArcadeStats, recordWordRace } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import { playSfx } from '../lib/gunAudio'
import {
  DAILY_MAX_GUESSES, applyDailyResult, currentStreakFor, dailyAnswer, dateKey, emptyDailyStats, formatCountdown,
  msUntilNextDay, normalizeDailyStats, puzzleNumber, shareText, winPercent,
} from './wordDaily'

const WORD_LEN = 5
const MAX_GUESSES = 6
export const START_MS = 120 * 1000
export const SOLVE_BONUS_MS = 15 * 1000
export const SKIP_PENALTY_MS = 10 * 1000
const TUTORIAL_KEY = 'word_race_tutorial_seen_v2'
const DAILY_KEY = 'word_daily_v1' // { stats, board: { key, guesses: [WORD] } }

// Reveal timing: tiles flip one after another.
const FLIP_MS = 300
const FLIP_STAGGER = 80
const REVEAL_MS = FLIP_STAGGER * (WORD_LEN - 1) + FLIP_MS

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

// Tile / key colours (approved Word mockup).
export const WORD_COLORS = { correct: '#2fbf71', present: '#e0a422', absent: '#2a3038', key: '#3a414b' }
const SUCCESS = '#2fbf71'

const SKIN = {
  correct: { bg: WORD_COLORS.correct, text: '#ffffff' },
  present: { bg: WORD_COLORS.present, text: '#ffffff' },
  absent: { bg: WORD_COLORS.absent, text: 'rgba(242,244,247,0.75)' },
  filled: { bg: ST.ground, text: ST.text, border: 'rgba(255,255,255,0.6)', borderWidth: 2 },
  empty: { bg: 'rgba(255,255,255,0.03)', text: ST.text, border: 'rgba(255,255,255,0.14)', borderWidth: 1 },
}

const CONFETTI = [SUCCESS, ST.objective, ST.friendly, '#ffffff', WORD_COLORS.present]

const PRAISE = ['', 'GENIUS', 'MAGNIFICENT', 'IMPRESSIVE', 'SPLENDID', 'GREAT', 'PHEW']

const TUTORIAL_STEPS = [
  { icon: '⏱️', title: 'Race the clock', description: 'You start with 2 minutes. Solve as many hidden 5-letter words as you can before time runs out.' },
  { icon: '🟩', title: 'Green = right spot', description: 'The letter is in the word and in the correct position.' },
  { icon: '🟨', title: 'Yellow = wrong spot', description: 'The letter is in the word but somewhere else.' },
  { icon: '⬛', title: 'Gray = not in word', description: 'That letter is not in the word. Guesses must be real English words.' },
  { icon: '⚡', title: 'Bonuses', description: 'Each solve adds 15 seconds. Fewer guesses and solve streaks score more. Skipping costs 10 seconds.' },
]

// Two-pass scoring so repeated letters are coloured correctly (greens first, then
// yellows only while unmatched copies of the letter remain in the answer).
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

// Points for a solve (unchanged rules): base + fewer guesses + streak bonus (capped).
export function solvePoints(tries, streak) {
  const base = 50
  const guessBonus = (MAX_GUESSES + 1 - tries) * 25
  const streakBonus = Math.min(50, (streak - 1) * 10)
  return { base, guessBonus, streakBonus, total: base + guessBonus + streakBonus }
}

const RANK = { absent: 1, present: 2, correct: 3 }

/** Keyboard colours: each letter keeps the best colour it has earned (green > yellow > grey). */
export function keyStatesFor(guesses) {
  const m = {}
  ;(guesses || []).forEach(({ word, score: sc }) => {
    for (let i = 0; i < WORD_LEN; i++) {
      const ch = word[i]
      if (!m[ch] || RANK[sc[i]] > RANK[m[ch]]) m[ch] = sc[i]
    }
  })
  return m
}

const ND = Platform.OS !== 'web' // native driver (web falls back to JS anyway)

function shuffled(list) {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Smoothly counts a number up to `value` (snaps straight down on a reset).
function useCountUp(value, duration = 650, initial = value) {
  const [shown, setShown] = useState(initial)
  const shownRef = useRef(initial)
  useEffect(() => {
    const from = shownRef.current
    if (value <= from) {
      shownRef.current = value
      setShown(value)
      return undefined
    }
    const t0 = Date.now()
    let raf = null
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / duration)
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)))
      shownRef.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [value, duration])
  return shown
}

// Scale "pop" whenever `trigger` changes.
function usePop(trigger, amount = 1.25) {
  const v = useRef(new Animated.Value(1)).current
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    v.setValue(amount)
    Animated.spring(v, { toValue: 1, friction: 4, tension: 200, useNativeDriver: ND }).start()
  }, [trigger]) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

// ---------------------------------------------------------------------------------------
// Tiles

function TileFace({ skin, size, letter }) {
  const c = SKIN[skin]
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill, styles.tileFace,
        { backgroundColor: c.bg },
        c.border ? { borderWidth: c.borderWidth, borderColor: c.border } : null,
      ]}
    >
      <Text allowFontScaling={false} style={[styles.tileText, { fontSize: Math.round(size * 0.46), color: c.text }]}>
        {letter}
      </Text>
    </View>
  )
}

const Tile = memo(function Tile({ letter, state, size, index, win, sound }) {
  const pop = useRef(new Animated.Value(1)).current
  const flip = useRef(new Animated.Value(state ? 1 : 0)).current
  const jump = useRef(new Animated.Value(0)).current
  const prevLetter = useRef(letter)
  const prevState = useRef(state)

  // Typed: quick squash-and-pop.
  useEffect(() => {
    if (letter && !prevLetter.current && !state) {
      pop.setValue(1.14)
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 260, useNativeDriver: ND }).start()
    }
    prevLetter.current = letter
  }, [letter, state, pop])

  // Revealed: flip over (color swaps at the halfway point).
  useEffect(() => {
    const was = prevState.current
    prevState.current = state
    if (!state) { flip.setValue(0); return undefined }
    if (was) return undefined
    flip.setValue(0)
    Animated.timing(flip, {
      toValue: 1, duration: FLIP_MS, delay: index * FLIP_STAGGER, easing: Easing.inOut(Easing.quad), useNativeDriver: ND,
    }).start()
    if (!sound) return undefined
    const t = setTimeout(() => playSfx('wordFlip', { volume: 0.7 }), index * FLIP_STAGGER + FLIP_MS / 2)
    return () => clearTimeout(t)
  }, [state, index, flip, sound])

  // Solved row: Mexican-wave hop.
  useEffect(() => {
    if (!win) return
    jump.setValue(0)
    Animated.sequence([
      Animated.delay(index * 70),
      Animated.timing(jump, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.spring(jump, { toValue: 0, friction: 3.5, tension: 160, useNativeDriver: ND }),
    ]).start()
  }, [win, index, jump])

  const rotateX = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '90deg', '0deg'] })
  const frontOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [1, 1, 0, 0] })
  const backOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [0, 0, 1, 1] })
  const translateY = jump.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.3] })

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ perspective: 600 }, { translateY }, { rotateX }, { scale: pop }] }}
      accessible
      accessibilityLabel={letter ? `${letter}${state ? `, ${state === 'correct' ? 'correct' : state === 'present' ? 'wrong spot' : 'not in word'}` : ''}` : 'empty'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOpacity }]}>
        <TileFace skin={letter ? 'filled' : 'empty'} size={size} letter={letter} />
      </Animated.View>
      {state ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backOpacity }]}>
          <TileFace skin={state} size={size} letter={letter} />
        </Animated.View>
      ) : null}
    </Animated.View>
  )
})

const BoardRow = memo(function BoardRow({ letters, states, size, gap, shake, win }) {
  const translateX = shake ? shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) : 0
  return (
    <Animated.View style={[styles.row, { gap }, shake && { transform: [{ translateX }] }]}>
      {Array.from({ length: WORD_LEN }).map((_, i) => (
        <Tile key={i} index={i} letter={letters[i] || ''} state={states ? states[i] : null} size={size} win={win} sound={!!states} />
      ))}
    </Animated.View>
  )
})

// ---------------------------------------------------------------------------------------
// Effects

// Confetti burst from the middle of its parent.
const Burst = memo(function Burst({ count = 30, spread = 1 }) {
  const progress = useRef(new Animated.Value(0)).current
  const parts = useMemo(() => Array.from({ length: count }).map((_, i) => {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const v = (90 + Math.random() * 120) * spread
    return {
      dx: Math.cos(a) * v,
      up: -Math.abs(Math.sin(a) * v) - 40 - Math.random() * 60,
      fall: Math.sin(a) * v * 0.5 + 140 + Math.random() * 120,
      rot: (Math.random() > 0.5 ? 1 : -1) * (240 + Math.random() * 480),
      color: CONFETTI[i % CONFETTI.length],
      w: 5 + Math.random() * 5,
      h: Math.random() > 0.4 ? 9 + Math.random() * 6 : 7,
    }
  }), [count, spread])
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: ND }).start()
  }, [progress])
  return (
    <View pointerEvents="none" style={styles.burst}>
      {parts.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.h,
            backgroundColor: p.color,
            opacity: progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
              { translateY: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, p.up, p.fall] }) },
              { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  )
})

// Big centered callout ("MAGNIFICENT", "+175"...). Re-mounted (keyed) for each callout.
const Callout = memo(function Callout({ title, sub, tone = 'good', word }) {
  const inV = useRef(new Animated.Value(0)).current
  const outV = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.sequence([
      Animated.spring(inV, { toValue: 1, friction: 5, tension: 140, useNativeDriver: ND }),
      Animated.delay(word ? 1100 : 650),
      Animated.timing(outV, { toValue: 1, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ]).start()
  }, [inV, outV, word])
  const color = tone === 'good' ? SUCCESS : tone === 'bad' ? ST.enemy : tone === 'gold' ? ST.objective : ST.text
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.callout, { borderTopColor: color }, {
        opacity: Animated.multiply(inV.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), outV.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
        transform: [
          { scale: inV.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
          { translateY: outV.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) },
        ],
      }]}
    >
      <Text allowFontScaling={false} style={[styles.calloutTitle, { color }]}>{title}</Text>
      {word ? (
        <View style={styles.calloutWord}>
          {word.split('').map((ch, i) => (
            <View key={i} style={{ width: 34, height: 34 }}>
              <TileFace skin="correct" size={34} letter={ch} />
            </View>
          ))}
        </View>
      ) : null}
      {sub ? <Text allowFontScaling={false} style={styles.calloutSub}>{sub}</Text> : null}
    </Animated.View>
  )
})

// Small floating label that rises and fades (used for "+15s" / "−10s" by the timer).
const Floater = memo(function Floater({ text, color }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start()
  }, [v])
  return (
    <Animated.Text
      pointerEvents="none"
      allowFontScaling={false}
      style={[styles.floater, {
        color,
        opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, -22] }) }, { scale: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) }],
      }]}
    >
      {text}
    </Animated.Text>
  )
})

// ---------------------------------------------------------------------------------------
// HUD

// Draining timer bar. Reads the run's end time from a ref so the whole board doesn't
// re-render 10x a second. Not running: shows `frozenMs` (time left when the run ended) or
// the full start time before a run.
function TimerBar({ endAtRef, running, paused, pausedMs, frozenMs, bump, onPause, canPause }) {
  const [left, setLeft] = useState(START_MS)
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!running) return undefined
    if (paused) { setLeft(pausedMs ?? 0); return undefined }
    const tick = () => setLeft(Math.max(0, endAtRef.current - Date.now()))
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [running, paused, pausedMs, endAtRef])
  useEffect(() => { if (!running) setLeft(frozenMs ?? START_MS) }, [running, frozenMs])

  const low = running && left <= 15000
  useEffect(() => {
    if (!low || paused) { pulse.setValue(1); return undefined }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 260, useNativeDriver: ND }),
      Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: ND }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [low, paused, pulse])

  const pct = Math.max(0, Math.min(1, left / START_MS))
  const color = left <= 15000 ? ST.enemy : left <= 45000 ? ST.objective : ST.friendly
  return (
    <View style={styles.timerWrap}>
      <View style={styles.timerTrack}>
        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: color }} />
      </View>
      <View style={styles.timerRow}>
        <Pressable
          onPress={onPause}
          disabled={!canPause}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume' : 'Pause'}
          hitSlop={8}
          style={({ pressed }) => [styles.pauseBtn, { opacity: canPause ? (pressed ? 0.7 : 1) : 0.35 }]}
        >
          <Ionicons name={paused ? 'play' : 'pause'} size={14} color={ST.text} />
          <Text allowFontScaling={false} style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {bump ? <View style={styles.floaterAnchor} pointerEvents="none"><Floater key={bump.id} text={bump.text} color={bump.color} /></View> : null}
        <Animated.Text
          allowFontScaling={false}
          accessibilityRole="timer"
          accessibilityLabel={`${formatClock(left)} left`}
          style={[styles.timerText, low && { color: ST.enemy }, { transform: [{ scale: pulse }] }]}
        >
          {formatClock(left)}
        </Animated.Text>
      </View>
    </View>
  )
}

function HudStat({ label, value, pop, color, align = 'flex-start' }) {
  return (
    <View style={[styles.hudStat, { alignItems: align }]}>
      <Text allowFontScaling={false} style={[stType.label, color && { color }]}>{label}</Text>
      <Animated.Text allowFontScaling={false} style={[styles.hudValue, color && { color }, pop && { transform: [{ scale: pop }] }]} numberOfLines={1}>
        {value}
      </Animated.Text>
    </View>
  )
}

// ---------------------------------------------------------------------------------------
// Keyboard

const Key = memo(function Key({ k, label, icon, state, width, height, onKey, accent }) {
  const bg = accent ? ST.friendly : state ? WORD_COLORS[state] : WORD_COLORS.key
  const fg = accent ? ST.ink : state === 'absent' ? 'rgba(242,244,247,0.55)' : ST.text
  return (
    <Pressable
      onPress={() => onKey(k)}
      accessibilityRole="button"
      accessibilityLabel={k === 'DEL' ? 'Delete' : k === 'ENTER' ? 'Enter' : `${k}${state ? `, ${state === 'correct' ? 'correct' : state === 'present' ? 'in word' : 'not in word'}` : ''}`}
      style={({ pressed }) => [styles.key, { width, height, backgroundColor: bg, opacity: pressed ? 0.7 : 1 }, pressed && { transform: [{ scale: 0.95 }] }]}
      hitSlop={{ top: 3, bottom: 3, left: 1, right: 1 }}
    >
      {icon ? (
        <Ionicons name={icon} size={20} color={fg} />
      ) : (
        <Text allowFontScaling={false} style={[styles.keyText, label && label.length > 1 && { fontSize: 12, letterSpacing: 1.2 }, { color: fg }]}>
          {label || k}
        </Text>
      )}
    </Pressable>
  )
})

// ---------------------------------------------------------------------------------------
// Start screen pieces

function TitleTile({ letter, skin, size, index }) {
  const bob = useRef(new Animated.Value(0)).current
  const enter = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: 120 + index * 90, friction: 5, tension: 120, useNativeDriver: ND }).start()
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(index * 160),
      Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [bob, enter, index])
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        opacity: enter,
        transform: [
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
        ],
      }}
    >
      <TileFace skin={skin} size={size} letter={letter} />
    </Animated.View>
  )
}

function MiniTile({ letter, skin }) {
  return (
    <View style={{ width: 30, height: 30 }}>
      <TileFace skin={skin} size={30} letter={letter} />
    </View>
  )
}

function HowLine({ left, text }) {
  return (
    <View style={styles.howLine}>
      <View style={styles.howIcon}>{left}</View>
      <Text style={[stType.body, { flex: 1 }]}>{text}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------------------
// Game

export function WordGame({ onExit, onRecorded, bottomInset = 0, initialMode }) {
  useStudioFonts()
  const [dailyOpen, setDailyOpen] = useState(initialMode === 'daily')
  const daily = useDailySummary(dailyOpen)
  const { width: winW, height: winH } = useWindowDimensions()
  const compact = winH < 700
  const contentW = Math.min(winW, 520)
  const keyGap = contentW < 360 ? 4 : 5
  const keyW = Math.floor((contentW - 12 - 9 * keyGap) / 10)
  const keyH = compact ? 44 : 50

  const [phase, setPhase] = useState('ready') // ready | countdown | playing | over
  const [count, setCount] = useState(3)
  const [paused, setPaused] = useState(false)
  const [pausedMs, setPausedMs] = useState(null)
  const [wordId, setWordId] = useState(0)
  const [target, setTarget] = useState('')
  const [guesses, setGuesses] = useState([]) // [{ word, score }]
  const [revealed, setRevealed] = useState(0) // guesses whose flip has finished (keyboard colors)
  const [current, setCurrent] = useState('')
  const [score, setScore] = useState(0)
  const [shownScore, setShownScore] = useState(0)
  const [solved, setSolved] = useState([]) // [{ word, tries }]
  const [missed, setMissed] = useState([])
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [toast, setToast] = useState(null)
  const [callout, setCallout] = useState(null)
  const [burst, setBurst] = useState(0)
  const [winRow, setWinRow] = useState(-1)
  const [bump, setBump] = useState(null)
  const [summary, setSummary] = useState(null)
  const [stats, setStats] = useState(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const [board, setBoard] = useState(null) // measured board area { w, h }
  const [endInfo, setEndInfo] = useState(null) // { reason: 'time' | 'ended', leftMs }

  const deckRef = useRef([])
  const endAtRef = useRef(0)
  const pausedRemainingRef = useRef(null)
  const timersRef = useRef(new Set())
  const toastTimerRef = useRef(null)
  const lastTickRef = useRef(null)
  const shake = useRef(new Animated.Value(0)).current
  const boardIn = useRef(new Animated.Value(0)).current
  const mountedRef = useRef(true)
  const finishedRef = useRef(false)
  const stateRef = useRef({})
  stateRef.current = { score, solved, bestStreak, phase }
  const onRecordedRef = useRef(onRecorded)
  onRecordedRef.current = onRecorded

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      if (mountedRef.current) fn()
    }, ms)
    timersRef.current.add(id)
    return id
  }, [])
  const clearLater = () => {
    timersRef.current.forEach((id) => clearTimeout(id))
    timersRef.current.clear()
  }

  const refreshStats = useCallback(() => {
    loadArcadeStats().then((s) => { if (mountedRef.current) setStats(s) }).catch(() => {})
  }, [])

  useEffect(() => {
    mountedRef.current = true
    refreshStats()
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((seen) => { if (!seen && mountedRef.current) setShowTutorial(true) })
      .catch(() => {})
    return () => {
      mountedRef.current = false
      timersRef.current.forEach((id) => clearTimeout(id))
      timersRef.current.clear()
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [refreshStats])

  const best = stats?.games?.['word-race']?.bestScore ?? null

  const showToast = useCallback((text, ms = 1300) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ text, id: Date.now() })
    toastTimerRef.current = setTimeout(() => { if (mountedRef.current) setToast(null) }, ms)
  }, [])

  const nextWord = useCallback(() => {
    if (finishedRef.current) return
    if (deckRef.current.length === 0) deckRef.current = shuffled(ANSWERS)
    setTarget(deckRef.current.pop().toUpperCase())
    setGuesses([])
    setRevealed(0)
    setCurrent('')
    setWinRow(-1)
    setWordId((n) => n + 1)
    boardIn.setValue(0)
    Animated.spring(boardIn, { toValue: 1, friction: 6, tension: 90, useNativeDriver: ND }).start()
  }, [boardIn])

  const finish = useCallback((reason = 'time') => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearLater()
    const { score: sc, solved: sv, bestStreak: bs } = stateRef.current
    const leftMs = pausedRemainingRef.current ?? Math.max(0, endAtRef.current - Date.now())
    pausedRemainingRef.current = null
    setEndInfo({ reason: reason === 'ended' ? 'ended' : 'time', leftMs: reason === 'ended' ? leftMs : 0 })
    setPhase('over')
    setPaused(false)
    setPausedMs(null)
    setShownScore(sc)
    setCallout(null)
    buzz('heavy')
    recordWordRace({ score: sc, wordsSolved: sv.length, bestStreak: bs })
      .then((r) => {
        if (!mountedRef.current) return
        setSummary(r)
        onRecordedRef.current?.({ ...r, score: sc })
        if (r.isNewBest && sc > 0) {
          playSfx('wordWin')
          buzz('success')
          setBurst((b) => b + 1)
        } else {
          playSfx(sc > 0 ? 'wordWin' : 'wordFail', { volume: 0.8 })
        }
        refreshStats()
      })
      .catch(() => {})
  }, [refreshStats])
  const endRun = useCallback(() => finish('ended'), [finish])

  const beginPlay = useCallback(() => {
    endAtRef.current = Date.now() + START_MS
    lastTickRef.current = null
    setPhase('playing')
  }, [])

  const start = () => {
    clearLater()
    finishedRef.current = false
    deckRef.current = shuffled(ANSWERS)
    setScore(0)
    setShownScore(0)
    setSolved([])
    setMissed([])
    setStreak(0)
    setBestStreak(0)
    setSummary(null)
    setCallout(null)
    setBump(null)
    setToast(null)
    setPaused(false)
    setPausedMs(null)
    setEndInfo(null)
    pausedRemainingRef.current = null
    nextWord()
    // 3-2-1-GO
    setPhase('countdown')
    setCount(3)
    buzz('light')
    playSfx('wordCount')
    later(() => { setCount(2); buzz('light'); playSfx('wordCount') }, 650)
    later(() => { setCount(1); buzz('light'); playSfx('wordCount') }, 1300)
    later(() => { setCount(0); buzz('heavy'); playSfx('wordGo') }, 1950)
    later(beginPlay, 2400)
  }

  // Clock: end the run at zero, tick through the last 10 seconds.
  useEffect(() => {
    if (phase !== 'playing' || paused) return undefined
    const id = setInterval(() => {
      const left = endAtRef.current - Date.now()
      if (left <= 0) { finish('time'); return }
      const sec = Math.ceil(left / 1000)
      if (sec <= 10 && lastTickRef.current !== sec) {
        lastTickRef.current = sec
        playSfx('wordTick', { volume: sec <= 5 ? 1 : 0.6 })
        if (sec <= 5) buzz('light')
      }
    }, 100)
    return () => clearInterval(id)
  }, [phase, paused, finish])

  const pause = useCallback(() => {
    if (stateRef.current.phase !== 'playing') return
    // Already paused (e.g. the app went to the background while the pause card was up):
    // keep the stored time. Recomputing from the stale end time would eat the paused time.
    if (pausedRemainingRef.current != null) return
    const left = Math.max(0, endAtRef.current - Date.now())
    pausedRemainingRef.current = left
    setPausedMs(left)
    setPaused(true)
  }, [])

  const resume = () => {
    endAtRef.current = Date.now() + (pausedRemainingRef.current ?? 0)
    pausedRemainingRef.current = null
    setPausedMs(null)
    setPaused(false)
    buzz('light')
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
    setBump({ id: Date.now(), text: ms > 0 ? `+${Math.round(ms / 1000)}s` : `−${Math.round(-ms / 1000)}s`, color: ms > 0 ? SUCCESS : ST.enemy })
  }

  const doShake = () => {
    shake.setValue(0)
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 45, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: -1, duration: 45, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: 0.7, duration: 45, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: -0.7, duration: 45, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: ND }),
    ]).start()
  }

  const invalid = (msg) => {
    doShake()
    buzz('error')
    playSfx('wordWrong', { volume: 0.7 })
    showToast(msg)
  }

  const submit = () => {
    if (current.length < WORD_LEN) return invalid('Not enough letters')
    if (!isValidWord(current)) return invalid('Not in word list')
    const sc = scoreGuess(current, target)
    const nextGuesses = [...guesses, { word: current, score: sc }]
    const rowIdx = nextGuesses.length - 1
    setGuesses(nextGuesses)
    setCurrent('')
    buzz('medium')
    later(() => setRevealed((r) => Math.max(r, nextGuesses.length)), REVEAL_MS)
    if (current === target) {
      const tries = nextGuesses.length
      const newStreak = streak + 1
      const pts = solvePoints(tries, newStreak)
      const total = score + pts.total
      setScore(total)
      setStreak(newStreak)
      setBestStreak((b) => Math.max(b, newStreak))
      setSolved((l) => [...l, { word: target, tries }])
      addTime(SOLVE_BONUS_MS)
      // Celebrate once the tiles have flipped.
      later(() => {
        setWinRow(rowIdx)
        setShownScore(total)
        setBurst((b) => b + 1)
        setCallout({
          id: Date.now(),
          title: PRAISE[tries] || 'NICE',
          sub: newStreak >= 2 ? `+${pts.total}  ·  STREAK ×${newStreak}  +${pts.streakBonus}` : `+${pts.total}  ·  +${SOLVE_BONUS_MS / 1000}S`,
          tone: tries <= 2 ? 'gold' : 'good',
        })
        buzz('success')
        playSfx('wordCorrect')
        if (newStreak >= 2) later(() => playSfx('wordCombo', { volume: 0.7 }), 180)
      }, REVEAL_MS + 60)
      later(nextWord, REVEAL_MS + 1250)
    } else if (nextGuesses.length >= MAX_GUESSES) {
      setStreak(0)
      setMissed((l) => [...l, target])
      later(() => {
        setCallout({ id: Date.now(), title: 'THE WORD WAS', word: target, tone: 'bad' })
        buzz('warning')
        playSfx('wordFail', { volume: 0.8 })
      }, REVEAL_MS + 60)
      later(nextWord, REVEAL_MS + 1900)
    }
    return undefined
  }

  // Lock input while a solved/failed word is waiting to be replaced.
  const roundLocked = guesses.length >= MAX_GUESSES || (guesses.length > 0 && guesses[guesses.length - 1].word === target)

  const skip = () => {
    if (phase !== 'playing' || paused || roundLocked) return
    setStreak(0)
    setMissed((l) => [...l, target])
    buzz('warning')
    playSfx('wordWrong', { volume: 0.5 })
    setCallout({ id: Date.now(), title: 'SKIPPED', word: target, tone: 'neutral' })
    endAtRef.current -= SKIP_PENALTY_MS
    setBump({ id: Date.now(), text: `−${SKIP_PENALTY_MS / 1000}s`, color: ST.enemy })
    if (endAtRef.current - Date.now() <= 0) { finish('time'); return }
    nextWord()
  }

  const onKey = (k) => {
    if (phase !== 'playing' || paused || roundLocked) return
    if (k === 'ENTER') { submit(); return }
    if (k === 'DEL') {
      if (current.length) { buzz('select'); playSfx('wordKey', { volume: 0.5 }) }
      setCurrent((c) => c.slice(0, -1))
      return
    }
    if (current.length >= WORD_LEN) return
    buzz('select')
    playSfx('wordKey', { volume: 0.6 })
    setCurrent((c) => (c.length < WORD_LEN ? c + k : c))
  }
  // Stable handler for the memoized keys.
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  const handleKey = useCallback((k) => onKeyRef.current(k), [])

  // Physical keyboard on web.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined
    const onDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key
      if (key === 'Enter') handleKey('ENTER')
      else if (key === 'Backspace') handleKey('DEL')
      else if (/^[a-zA-Z]$/.test(key)) handleKey(key.toUpperCase())
      else return
      e.preventDefault?.()
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [handleKey])

  const keyStates = useMemo(() => keyStatesFor(guesses.slice(0, revealed)), [guesses, revealed])

  const closeTutorial = () => {
    setShowTutorial(false)
    AsyncStorage.setItem(TUTORIAL_KEY, '1').catch(() => {})
  }

  const scoreShown = useCountUp(shownScore)
  const scorePop = usePop(shownScore, 1.2)
  const streakPop = usePop(streak, 1.35)
  const solvedPop = usePop(solved.length, 1.3)

  // ----- Daily word -----
  if (dailyOpen) {
    return (
      <DailyWord
        bottomInset={bottomInset}
        onClose={() => { setDailyOpen(false); daily.reload() }}
        onTimed={() => { setDailyOpen(false); daily.reload(); start() }}
      />
    )
  }

  // ----- Start screen -----
  if (phase === 'ready') {
    const titleSize = Math.min(64, Math.floor((contentW - 80) / 4))
    const wr = stats?.wordRace
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={[styles.startScroll, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.startInner, { maxWidth: 460 }]}>
            <Text allowFontScaling={false} style={[stType.kicker, { color: SUCCESS, marginBottom: 12 }]}>What's the</Text>
            <View style={styles.titleRow}>
              {['W', 'O', 'R', 'D'].map((ch, i) => (
                <TitleTile key={ch} letter={ch} index={i} size={titleSize} skin={['correct', 'present', 'correct', 'filled'][i]} />
              ))}
            </View>
            <Text style={[stType.body, { marginBottom: 20, textAlign: 'center' }]}>One shared word a day, or race the clock.</Text>

            <DailyPanel summary={daily} onOpen={() => { buzz('medium'); setDailyOpen(true) }} />

            <Text style={[stType.label, { alignSelf: 'stretch', marginTop: 22, marginBottom: 8 }]}>Timed run</Text>
            <StPanel style={styles.howCard}>
              <Text style={stType.label}>How it works</Text>
              <HowLine left={<MiniTile letter="A" skin="correct" />} text="Green: right letter, right spot." />
              <HowLine left={<MiniTile letter="B" skin="present" />} text="Amber: in the word, wrong spot." />
              <HowLine left={<MiniTile letter="C" skin="absent" />} text="Slate: not in the word." />
              <HowLine
                left={<View style={styles.howClock}><Ionicons name="timer-outline" size={18} color={ST.objective} /></View>}
                text={`${formatClock(START_MS)} on the clock. Every solve adds +${SOLVE_BONUS_MS / 1000}s, skipping costs ${SKIP_PENALTY_MS / 1000}s.`}
              />
            </StPanel>

            <View style={styles.bigStats}>
              <StStat label="Best score" value={best != null ? best.toLocaleString() : '—'} color={ST.objective} />
              <StStat label="Best words" value={wr?.bestWords ? wr.bestWords : '—'} color={SUCCESS} />
              <StStat label="Best streak" value={wr?.bestStreak ? `×${wr.bestStreak}` : '—'} />
            </View>

            <StButton title="Play timed run" tone="outline" color={SUCCESS} onPress={start} style={styles.playBtn} height={50} />
            <StButton title="How to play" tone="ghost" height={44} onPress={() => setShowTutorial(true)} style={{ marginTop: 10, alignSelf: 'stretch' }} />
          </View>
        </ScrollView>
        {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="What's The Word" />}
      </View>
    )
  }

  // ----- Board -----
  const gap = 6
  const tileSize = board
    ? Math.max(28, Math.floor(Math.min((board.w - 4 * gap) / WORD_LEN, (board.h - 5 * gap - 8) / MAX_GUESSES, 60)))
    : 0
  const playing = phase === 'playing'
  const nextTries = Math.min(MAX_GUESSES, guesses.length + 1)
  const hintPts = solvePoints(nextTries, streak + 1).total
  const showHint = playing && !paused && !roundLocked

  return (
    <View style={styles.container}>
      <View style={[styles.playInner, { maxWidth: 520, paddingBottom: bottomInset + (compact ? 6 : 10) }]}>
        {/* HUD */}
        <View style={styles.hud}>
          <HudStat label="Score" value={scoreShown.toLocaleString()} pop={scorePop} />
          <HudStat label="Streak" value={`×${streak}`} pop={streakPop} color={streak > 0 ? ST.objective : ST.muted} align="center" />
          <HudStat label="Solved" value={solved.length} pop={solvedPop} align="flex-end" />
        </View>
        <TimerBar
          endAtRef={endAtRef}
          running={playing}
          paused={paused}
          pausedMs={pausedMs}
          frozenMs={phase === 'over' ? endInfo?.leftMs ?? 0 : null}
          bump={bump}
          onPause={paused ? resume : pause}
          canPause={playing}
        />

        {/* Board */}
        <View style={styles.boardArea} onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout
          if (!board || Math.abs(board.w - w) > 1 || Math.abs(board.h - h) > 1) setBoard({ w, h })
        }}
        >
          {board && !paused ? (
            <Animated.View
              key={wordId}
              style={[styles.grid, { gap, opacity: boardIn, transform: [{ scale: boardIn.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}
            >
              {Array.from({ length: MAX_GUESSES }).map((_, r) => {
                const g = guesses[r]
                const isCurrent = !g && r === guesses.length
                return (
                  <BoardRow
                    key={r}
                    letters={g ? g.word : isCurrent ? current : ''}
                    states={g ? g.score : null}
                    size={tileSize}
                    gap={gap}
                    shake={isCurrent ? shake : null}
                    win={winRow === r}
                  />
                )
              })}
            </Animated.View>
          ) : null}

          {paused ? (
            <StPanel strong accent={ST.friendly} style={styles.pauseCard}>
              <Text style={stType.kicker}>Clock stopped</Text>
              <Text style={[stType.display, { fontSize: 40, lineHeight: 46 }]}>Paused</Text>
              <Text style={[stType.small, { textAlign: 'center', marginTop: 4 }]}>The board is hidden until you resume.</Text>
              <StButton title="Resume" onPress={resume} style={{ alignSelf: 'stretch', marginTop: 18 }} />
              <StButton title="End run" tone="ghost" height={44} onPress={endRun} style={{ alignSelf: 'stretch', marginTop: 8 }} />
            </StPanel>
          ) : null}

          {toast ? (
            <View key={toast.id} style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={15} color={ST.enemy} />
              <Text style={styles.toastText}>{toast.text}</Text>
            </View>
          ) : null}
          {callout && !paused ? <Callout key={callout.id} title={callout.title} sub={callout.sub} tone={callout.tone} word={callout.word} /> : null}
          {burst > 0 && phase !== 'over' ? <Burst key={burst} /> : null}
        </View>

        {/* Next-solve value + actions */}
        <View style={styles.hintRow}>
          {showHint ? (
            <View style={styles.hint}>
              <Text allowFontScaling={false} style={styles.hintText}>+{SOLVE_BONUS_MS / 1000} S · SOLVE IN {nextTries} FOR +{hintPts}</Text>
            </View>
          ) : <View style={[styles.hint, { opacity: 0 }]}><Text style={styles.hintText}> </Text></View>}
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={skip}
            disabled={!playing || paused || roundLocked}
            accessibilityRole="button"
            accessibilityLabel={`Skip word, minus ${SKIP_PENALTY_MS / 1000} seconds`}
            style={({ pressed }) => [styles.actionBtn, { opacity: !playing || paused || roundLocked ? 0.38 : pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="play-skip-forward" size={13} color={ST.text} />
            <Text style={styles.actionText}>Skip</Text>
            <Text style={[styles.actionText, { color: ST.enemy }]}>−{SKIP_PENALTY_MS / 1000}s</Text>
          </Pressable>
          <Pressable
            onPress={endRun}
            disabled={!playing}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionBtn, { opacity: playing ? (pressed ? 0.7 : 1) : 0.38 }]}
          >
            <Ionicons name="flag" size={13} color={ST.text} />
            <Text style={styles.actionText}>End run</Text>
          </Pressable>
        </View>

        {/* Keyboard */}
        <View style={[styles.keyboard, { gap: compact ? 6 : 7 }]}>
          {KEY_ROWS.map((r, ri) => (
            <View key={r} style={[styles.keyRow, { gap: keyGap }]}>
              {ri === 2 && <Key k="ENTER" label="ENTER" accent onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
              {r.split('').map((k) => (
                <Key key={k} k={k} state={keyStates[k]} onKey={handleKey} width={keyW} height={keyH} />
              ))}
              {ri === 2 && <Key k="DEL" icon="backspace-outline" onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
            </View>
          ))}
        </View>
      </View>

      {phase === 'countdown' ? <Countdown count={count} /> : null}

      {phase === 'over' ? (
        <Results
          score={score}
          solved={solved}
          missed={missed}
          bestStreak={bestStreak}
          summary={summary}
          burst={burst}
          endReason={endInfo?.reason}
          bottomInset={bottomInset}
          onPlayAgain={start}
          onExit={onExit}
          onMenu={() => { setPhase('ready'); refreshStats() }}
        />
      ) : null}

      {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="What's The Word" />}
    </View>
  )
}

// ---------------------------------------------------------------------------------------
// Daily word

async function loadDaily() {
  try {
    const raw = await AsyncStorage.getItem(DAILY_KEY)
    const p = raw ? JSON.parse(raw) : null
    const b = p?.board
    const board = b && typeof b.key === 'string' && Array.isArray(b.guesses)
      ? { key: b.key, guesses: b.guesses.filter((w) => typeof w === 'string' && w.length === WORD_LEN).map((w) => w.toUpperCase()).slice(0, DAILY_MAX_GUESSES) }
      : null
    return { stats: normalizeDailyStats(p?.stats), board }
  } catch {
    return { stats: emptyDailyStats(), board: null }
  }
}

function saveDaily(data) {
  AsyncStorage.setItem(DAILY_KEY, JSON.stringify(data)).catch(() => {})
}

/** Where today's board stands: 'new' | 'playing' | 'won' | 'lost'. */
function boardStatus(board, key, answer) {
  if (!board || board.key !== key || !board.guesses.length) return 'new'
  if (board.guesses.includes(answer)) return 'won'
  return board.guesses.length >= DAILY_MAX_GUESSES ? 'lost' : 'playing'
}

// Today's daily state for the start screen (reloaded when the daily view closes).
function useDailySummary(paused) {
  const [data, setData] = useState(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    if (paused) return undefined
    let alive = true
    loadDaily().then((d) => { if (alive) setData(d) })
    return () => { alive = false }
  }, [tick, paused])
  const key = dateKey()
  const answer = dailyAnswer(key, ANSWERS)
  return { key, answer, data, status: data ? boardStatus(data.board, key, answer) : null, reload }
}

// Ticks once a second; calls onRollover when the local day changes.
function NextWordIn({ onRollover, style }) {
  const [ms, setMs] = useState(() => msUntilNextDay())
  const rollRef = useRef(onRollover)
  rollRef.current = onRollover
  useEffect(() => {
    let day = dateKey()
    const id = setInterval(() => {
      setMs(msUntilNextDay())
      const now = dateKey()
      if (now !== day) { day = now; rollRef.current?.() }
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <View style={[styles.nextWord, style]} accessibilityLabel={`Next word in ${formatCountdown(ms)}`}>
      <Text style={stType.label}>Next word in</Text>
      <Text allowFontScaling={false} style={styles.nextWordClock}>{formatCountdown(ms)}</Text>
    </View>
  )
}

function DailyPanel({ summary, onOpen }) {
  const { key, data, status, reload } = summary
  const stats = data?.stats
  const streak = stats ? currentStreakFor(stats, key) : 0
  const tries = data?.board?.guesses?.length || 0
  const done = status === 'won' || status === 'lost'
  const line = !data ? ' '
    : status === 'won' ? `Solved in ${tries}/${DAILY_MAX_GUESSES}`
      : status === 'lost' ? 'Missed today’s word'
        : status === 'playing' ? `In progress · ${tries}/${DAILY_MAX_GUESSES} guesses`
          : 'Same word for everyone today. One try.'
  return (
    <StPanel strong accent={SUCCESS} style={styles.dailyCard}>
      <View style={styles.dailyTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[stType.kicker, { color: SUCCESS }]}>Daily word · #{puzzleNumber(key)}</Text>
          <Text style={[stType.body, { marginTop: 4 }]} numberOfLines={2}>{line}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={stType.label}>Streak</Text>
          <Text allowFontScaling={false} style={[stType.num, { fontSize: 24, color: streak > 0 ? ST.objective : ST.muted }]}>{streak}</Text>
        </View>
      </View>
      {done ? <NextWordIn onRollover={reload} style={{ marginTop: 10 }} /> : null}
      <StButton
        title={done ? 'See results' : status === 'playing' ? 'Continue' : 'Play today’s word'}
        tone={done ? 'ghost' : 'primary'}
        color={SUCCESS}
        height={done ? 44 : 52}
        onPress={onOpen}
        style={{ marginTop: 12, alignSelf: 'stretch' }}
      />
    </StPanel>
  )
}

function DailyWord({ onClose, onTimed, bottomInset = 0 }) {
  const { width: winW, height: winH } = useWindowDimensions()
  const compact = winH < 700
  const contentW = Math.min(winW, 520)
  const keyGap = contentW < 360 ? 4 : 5
  const keyW = Math.floor((contentW - 12 - 9 * keyGap) / 10)
  const keyH = compact ? 44 : 50

  const [dayKey, setDayKey] = useState(() => dateKey())
  const answer = useMemo(() => dailyAnswer(dayKey, ANSWERS), [dayKey])
  const [loaded, setLoaded] = useState(false)
  const [guesses, setGuesses] = useState([]) // [WORD]
  const [revealed, setRevealed] = useState(0)
  const [current, setCurrent] = useState('')
  const [stats, setStats] = useState(emptyDailyStats())
  const [showResults, setShowResults] = useState(false)
  const [toast, setToast] = useState(null)
  const [callout, setCallout] = useState(null)
  const [winRow, setWinRow] = useState(-1)
  const [burst, setBurst] = useState(0)
  const [board, setBoard] = useState(null)
  const shake = useRef(new Animated.Value(0)).current
  const dataRef = useRef({ stats: emptyDailyStats(), board: null })
  const timers = useRef(new Set())
  const mounted = useRef(true)

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => { timers.current.delete(id); if (mounted.current) fn() }, ms)
    timers.current.add(id)
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; timers.current.forEach(clearTimeout); timers.current.clear() }
  }, [])

  // Load (or reload on a new day). An unfinished board from an earlier day is dropped.
  useEffect(() => {
    let alive = true
    setLoaded(false)
    loadDaily().then((d) => {
      if (!alive) return
      const mine = d.board && d.board.key === dayKey ? d.board.guesses : []
      dataRef.current = { stats: d.stats, board: d.board && d.board.key === dayKey ? d.board : null }
      setStats(d.stats)
      setGuesses(mine)
      setRevealed(mine.length)
      setCurrent('')
      setWinRow(mine.includes(answer) ? mine.indexOf(answer) : -1)
      setShowResults(mine.includes(answer) || mine.length >= DAILY_MAX_GUESSES)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [dayKey, answer])

  const scored = useMemo(() => guesses.map((w) => ({ word: w, score: scoreGuess(w, answer) })), [guesses, answer])
  const won = guesses.includes(answer)
  const done = won || guesses.length >= DAILY_MAX_GUESSES
  const keyStates = useMemo(() => keyStatesFor(scored.slice(0, revealed)), [scored, revealed])

  const showToast = (text) => {
    setToast({ text, id: Date.now() })
    later(() => setToast(null), 1300)
  }
  const invalid = (msg) => {
    shake.setValue(0)
    Animated.sequence([1, -1, 0.7, -0.7, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 45, useNativeDriver: ND }))).start()
    buzz('error')
    playSfx('wordWrong', { volume: 0.7 })
    showToast(msg)
  }

  const submit = () => {
    if (current.length < WORD_LEN) return invalid('Not enough letters')
    if (!isValidWord(current)) return invalid('Not in word list')
    if (guesses.includes(current)) return invalid('Already guessed')
    const next = [...guesses, current]
    const solvedNow = current === answer
    const finished = solvedNow || next.length >= DAILY_MAX_GUESSES
    // Save every guess straight away: leaving mid-puzzle keeps the board (one attempt a day).
    const nextStats = finished ? applyDailyResult(dataRef.current.stats, dayKey, solvedNow, next.length) : dataRef.current.stats
    dataRef.current = { stats: nextStats, board: { key: dayKey, guesses: next } }
    saveDaily(dataRef.current)
    setGuesses(next)
    setCurrent('')
    buzz('medium')
    later(() => setRevealed((r) => Math.max(r, next.length)), REVEAL_MS)
    if (!finished) return undefined
    setStats(nextStats)
    if (solvedNow) {
      later(() => {
        setWinRow(next.length - 1)
        setBurst((b) => b + 1)
        setCallout({ id: Date.now(), title: PRAISE[next.length] || 'NICE', tone: next.length <= 2 ? 'gold' : 'good' })
        buzz('success')
        playSfx('wordCorrect')
      }, REVEAL_MS + 60)
      later(() => setShowResults(true), REVEAL_MS + 1500)
    } else {
      later(() => {
        setCallout({ id: Date.now(), title: 'THE WORD WAS', word: answer, tone: 'bad' })
        buzz('warning')
        playSfx('wordFail', { volume: 0.8 })
      }, REVEAL_MS + 60)
      later(() => setShowResults(true), REVEAL_MS + 2000)
    }
    return undefined
  }

  const onKey = (k) => {
    if (!loaded || done) return
    if (k === 'ENTER') { submit(); return }
    if (k === 'DEL') {
      if (current.length) { buzz('select'); playSfx('wordKey', { volume: 0.5 }) }
      setCurrent((c) => c.slice(0, -1))
      return
    }
    if (current.length >= WORD_LEN) return
    buzz('select')
    playSfx('wordKey', { volume: 0.6 })
    setCurrent((c) => (c.length < WORD_LEN ? c + k : c))
  }
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  const handleKey = useCallback((k) => onKeyRef.current(k), [])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined
    const onDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key
      if (key === 'Enter') handleKey('ENTER')
      else if (key === 'Backspace') handleKey('DEL')
      else if (/^[a-zA-Z]$/.test(key)) handleKey(key.toUpperCase())
      else return
      e.preventDefault?.()
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [handleKey])

  const share = async () => {
    buzz('select')
    try {
      await Share.share({ message: shareText({ key: dayKey, scores: scored.map((g) => g.score), won, streak: currentStreakFor(stats, dayKey) }) })
    } catch { /* dismissed */ }
  }

  const gap = 6
  const tileSize = board
    ? Math.max(28, Math.floor(Math.min((board.w - 4 * gap) / WORD_LEN, (board.h - 5 * gap - 8) / DAILY_MAX_GUESSES, 60)))
    : 0

  return (
    <View style={styles.container}>
      <View style={[styles.playInner, { maxWidth: 520, paddingBottom: bottomInset + (compact ? 6 : 10) }]}>
        <View style={styles.hud}>
          <View style={styles.hudStat}>
            <Text allowFontScaling={false} style={[stType.label, { color: SUCCESS }]}>Daily word</Text>
            <Text allowFontScaling={false} style={styles.hudValue}>#{puzzleNumber(dayKey)}</Text>
          </View>
          <HudStat label="Streak" value={currentStreakFor(stats, dayKey)} color={currentStreakFor(stats, dayKey) > 0 ? ST.objective : ST.muted} align="center" />
          <HudStat label="Guess" value={`${Math.min(DAILY_MAX_GUESSES, guesses.length + (done ? 0 : 1))}/${DAILY_MAX_GUESSES}`} align="flex-end" />
        </View>

        <View style={styles.boardArea} onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout
          if (!board || Math.abs(board.w - w) > 1 || Math.abs(board.h - h) > 1) setBoard({ w, h })
        }}
        >
          {board && loaded ? (
            <View style={[styles.grid, { gap }]}>
              {Array.from({ length: DAILY_MAX_GUESSES }).map((_, r) => {
                const g = scored[r]
                const isCurrent = !g && r === guesses.length && !done
                return (
                  <BoardRow
                    key={r}
                    letters={g ? g.word : isCurrent ? current : ''}
                    states={g ? g.score : null}
                    size={tileSize}
                    gap={gap}
                    shake={isCurrent ? shake : null}
                    win={winRow === r}
                  />
                )
              })}
            </View>
          ) : null}
          {toast ? (
            <View key={toast.id} style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={15} color={ST.enemy} />
              <Text style={styles.toastText}>{toast.text}</Text>
            </View>
          ) : null}
          {callout ? <Callout key={callout.id} title={callout.title} sub={callout.sub} tone={callout.tone} word={callout.word} /> : null}
          {burst > 0 && !showResults ? <Burst key={burst} /> : null}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to menu" style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="chevron-back" size={13} color={ST.text} />
            <Text style={styles.actionText}>Menu</Text>
          </Pressable>
          {done ? (
            <Pressable onPress={() => setShowResults(true)} accessibilityRole="button" style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="podium-outline" size={13} color={ST.text} />
              <Text style={styles.actionText}>Results</Text>
            </Pressable>
          ) : (
            <View style={styles.actionBtn}>
              <Text style={[styles.actionText, { color: ST.muted }]}>No timer · one try today</Text>
            </View>
          )}
        </View>

        <View style={[styles.keyboard, { gap: compact ? 6 : 7, opacity: done ? 0.5 : 1 }]}>
          {KEY_ROWS.map((r, ri) => (
            <View key={r} style={[styles.keyRow, { gap: keyGap }]}>
              {ri === 2 && <Key k="ENTER" label="ENTER" accent onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
              {r.split('').map((k) => (
                <Key key={k} k={k} state={keyStates[k]} onKey={handleKey} width={keyW} height={keyH} />
              ))}
              {ri === 2 && <Key k="DEL" icon="backspace-outline" onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
            </View>
          ))}
        </View>
      </View>

      {showResults && done ? (
        <DailyResults
          dayKey={dayKey}
          answer={answer}
          scored={scored}
          won={won}
          stats={stats}
          burst={burst}
          bottomInset={bottomInset}
          onShare={share}
          onClose={() => setShowResults(false)}
          onMenu={onClose}
          onTimed={onTimed}
          onRollover={() => setDayKey(dateKey())}
        />
      ) : null}
    </View>
  )
}

function DailyResults({ dayKey, answer, scored, won, stats, burst, bottomInset, onShare, onClose, onMenu, onTimed, onRollover }) {
  const enter = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 70, useNativeDriver: ND }).start()
  }, [enter])
  const tries = scored.length
  const wash = won ? SUCCESS : ST.enemy
  const dist = stats?.dist || [0, 0, 0, 0, 0, 0]
  const maxDist = Math.max(1, ...dist)
  const streak = currentStreakFor(stats, dayKey)
  return (
    <View style={styles.resultsOverlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.resultsDim, { opacity: enter }]} />
      <Animated.View pointerEvents="none" style={[styles.resultsWash, { opacity: enter }]}>
        <LinearGradient colors={[withAlpha(wash, 0.2), withAlpha(wash, 0)]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {won ? <View style={styles.resultsBurst} pointerEvents="none"><Burst key={burst} count={36} spread={1.4} /></View> : null}
      <ScrollView contentContainerStyle={[styles.resultsScroll, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.resultsInner, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={[stType.label, { color: wash }]}>Daily word · #{puzzleNumber(dayKey)}</Text>
            <Text allowFontScaling={false} style={[stType.display, { fontSize: 44, lineHeight: 50 }]} numberOfLines={1} adjustsFontSizeToFit>
              {won ? PRAISE[tries] || 'Solved' : 'Not today'}
            </Text>
            <Text style={[stType.body, { fontSize: 13 }]}>{won ? `Solved in ${tries}/${DAILY_MAX_GUESSES}` : 'The word was'}</Text>
            {!won ? (
              <View style={[styles.calloutWord, { marginTop: 6 }]}>
                {answer.split('').map((ch, i) => (
                  <View key={i} style={{ width: 34, height: 34 }}><TileFace skin="correct" size={34} letter={ch} /></View>
                ))}
              </View>
            ) : null}
          </View>

          {/* Spoiler-free grid: what the share sheet sends, drawn as tiles. */}
          <View style={styles.shareGrid} accessibilityLabel={`Your grid, ${tries} rows`}>
            {scored.map((g, r) => (
              <View key={r} style={styles.shareRow}>
                {g.score.map((st, i) => <View key={i} style={[styles.shareSq, { backgroundColor: WORD_COLORS[st] }, st === 'absent' && styles.shareSqAbsent]} />)}
              </View>
            ))}
          </View>

          <StButton title="Share result" color={SUCCESS} onPress={onShare} style={{ marginTop: 16 }} left={<Ionicons name="share-outline" size={18} color={ST.ink} />} />

          <View style={styles.resultStats}>
            <ResultStat label="Played" value={String(stats?.played || 0)} />
            <ResultStat label="Win %" value={String(winPercent(stats))} />
            <ResultStat label="Streak" value={String(streak)} color={streak > 0 ? ST.objective : undefined} />
            <ResultStat label="Max" value={String(stats?.maxStreak || 0)} />
          </View>

          <Text style={[stType.label, { marginTop: 18, marginBottom: 8 }]}>Guess distribution</Text>
          <View style={{ gap: 4 }}>
            {dist.map((n, i) => {
              const today = won && tries === i + 1
              return (
                <View key={i} style={styles.distRow} accessibilityLabel={`${i + 1} guesses: ${n}`}>
                  <Text allowFontScaling={false} style={styles.distLabel}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={[styles.distBar, { width: `${Math.max(8, (n / maxDist) * 100)}%`, backgroundColor: today ? SUCCESS : WORD_COLORS.key }]}>
                      <Text allowFontScaling={false} style={[styles.distCount, today && { color: ST.ink }]}>{n}</Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>

          <NextWordIn onRollover={onRollover} style={{ marginTop: 18 }} />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
            <StButton title="Timed run" tone="ghost" height={44} onPress={onTimed} style={{ flex: 1 }} />
            <StButton title="Board" tone="ghost" height={44} onPress={onClose} style={{ flex: 1 }} />
            <StButton title="Menu" tone="ghost" height={44} onPress={onMenu} style={{ flex: 1 }} />
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

// 3-2-1-GO overlay.
function Countdown({ count }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    v.setValue(0)
    Animated.spring(v, { toValue: 1, friction: 4, tension: 160, useNativeDriver: ND }).start()
  }, [count, v])
  const go = count === 0
  return (
    <View style={styles.countdown} pointerEvents="auto">
      <Animated.View style={{ alignItems: 'center', opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }] }}>
        <Text allowFontScaling={false} style={[styles.countText, go && { color: SUCCESS }]}>
          {go ? 'GO' : count}
        </Text>
        {!go ? <Text style={[stType.kicker, { color: ST.muted }]}>Get ready</Text> : null}
      </Animated.View>
    </View>
  )
}

// Run summary (studio Summary style).
function Results({ score, solved, missed, bestStreak, summary, burst, endReason, bottomInset, onPlayAgain, onExit, onMenu }) {
  const enter = useRef(new Animated.Value(0)).current
  const badge = useRef(new Animated.Value(0)).current
  const shown = useCountUp(score, 1200, 0)
  const isNewBest = !!summary?.isNewBest && score > 0
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 70, useNativeDriver: ND }).start()
  }, [enter])
  useEffect(() => {
    if (!isNewBest) return undefined
    badge.setValue(0)
    Animated.spring(badge, { toValue: 1, delay: 500, friction: 5, tension: 120, useNativeDriver: ND }).start()
    return undefined
  }, [isNewBest, badge])
  const attempted = solved.length + missed.length
  const accuracy = attempted ? `${Math.round((solved.length / attempted) * 100)}%` : '—'
  const avg = solved.length ? (solved.reduce((a, s) => a + s.tries, 0) / solved.length).toFixed(1) : '—'
  const words = [...solved.map((s) => ({ w: s.word, ok: true, tries: s.tries })), ...missed.map((w) => ({ w, ok: false }))]
  const wash = isNewBest ? ST.objective : ST.friendly

  return (
    <View style={styles.resultsOverlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.resultsDim, { opacity: enter }]} />
      <Animated.View pointerEvents="none" style={[styles.resultsWash, { opacity: enter }]}>
        <LinearGradient colors={[withAlpha(wash, 0.22), withAlpha(wash, 0)]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {isNewBest ? <View style={styles.resultsBurst} pointerEvents="none"><Burst key={burst} count={44} spread={1.5} /></View> : null}
      <ScrollView contentContainerStyle={[styles.resultsScroll, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.resultsInner, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={[stType.label, { color: wash }]}>{endReason === 'ended' ? 'Run ended' : 'Time’s up'} · Word race</Text>
            <Text allowFontScaling={false} style={[stType.display, { fontSize: 64, lineHeight: 70 }]} numberOfLines={1} adjustsFontSizeToFit>{shown.toLocaleString()}</Text>
            <Text style={[stType.body, { fontSize: 13 }]}>
              {solved.length} {solved.length === 1 ? 'word' : 'words'} cracked{summary?.previousBest != null && !isNewBest ? ` · best ${summary.previousBest.toLocaleString()}` : ''}
            </Text>
          </View>

          <View style={styles.resultStats}>
            <ResultStat label="Words" value={String(solved.length)} color={SUCCESS} />
            <ResultStat label="Accuracy" value={accuracy} />
            <ResultStat label="Streak" value={`×${bestStreak}`} color={bestStreak > 0 ? ST.objective : undefined} />
            <ResultStat label="Avg tries" value={avg} />
          </View>

          {isNewBest ? (
            <Animated.View style={[styles.newBest, { opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
              <Ionicons name="star-outline" size={30} color={ST.objective} />
              <View style={{ flex: 1 }}>
                <Text style={[stType.label, { color: ST.objective }]}>New personal best</Text>
                <Text style={styles.newBestText}>{score.toLocaleString()} points{summary ? ` · +${summary.pointsEarned} arcade` : ''}</Text>
              </View>
            </Animated.View>
          ) : summary ? (
            <View style={[styles.newBest, { borderColor: ST.line, backgroundColor: ST.panel }]}>
              <View style={{ flex: 1 }}>
                <Text style={stType.label}>Arcade points</Text>
                <Text style={[styles.newBestText, { color: ST.objective }]}>+{summary.pointsEarned}</Text>
              </View>
            </View>
          ) : null}

          {words.length ? (
            <View style={{ marginTop: 16 }}>
              <Text style={[stType.label, { marginBottom: 6 }]}>This run</Text>
              <View style={styles.wordChips}>
                {words.slice(0, 24).map((x, i) => (
                  <View key={`${x.w}-${i}`} style={[styles.wordChip, x.ok ? styles.wordChipOk : styles.wordChipMiss]}>
                    <Text style={[styles.wordChipText, !x.ok && styles.wordChipTextMiss]}>{x.w}</Text>
                    {x.ok ? <Text style={styles.wordChipTries}>{x.tries}/6</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={[stType.small, { textAlign: 'center', marginTop: 16 }]}>No words this time. Try a starter like CRANE or SLATE.</Text>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
            <StButton title="Play again" onPress={onPlayAgain} style={{ flex: 1 }} />
            {onExit ? (
              <StButton title="Arcade" tone="ghost" onPress={onExit} style={{ width: 130 }} />
            ) : (
              <StButton title="Menu" tone="ghost" onPress={onMenu} style={{ width: 130 }} />
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

function ResultStat({ label, value, color }) {
  return (
    <View style={styles.resultStat}>
      <Text style={stType.label} numberOfLines={1}>{label}</Text>
      <Text style={[stType.num, { fontSize: 22, color: color || ST.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}

export default WordGame

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ST.ground },

  // Start
  startScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 8 },
  startInner: { width: '100%', alignSelf: 'center', alignItems: 'center' },
  titleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  howCard: { alignSelf: 'stretch', gap: 12, padding: 14 },
  howLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  howIcon: { width: 30, alignItems: 'center' },
  howClock: { width: 30, height: 30, borderRadius: ST.radius, backgroundColor: withAlpha(ST.objective, 0.14), alignItems: 'center', justifyContent: 'center' },
  bigStats: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: 10 },
  playBtn: { alignSelf: 'stretch', marginTop: 20 },

  // Play
  playInner: { flex: 1, width: '100%', alignSelf: 'center', paddingHorizontal: 6, paddingTop: 6 },
  hud: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6 },
  hudStat: { flex: 1 },
  hudValue: { fontFamily: FONT.display, fontSize: 30, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },

  timerWrap: { paddingHorizontal: 6, marginTop: 8 },
  timerTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  timerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  timerText: { fontFamily: FONT.display, fontSize: 16, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 8, borderWidth: 1, borderColor: ST.lineStrong, borderRadius: ST.radius },
  pauseText: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4, color: ST.text, textTransform: 'uppercase' },
  floaterAnchor: { marginRight: 10 },
  floater: { fontFamily: FONT.display, fontSize: 16, ...{ textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 } },

  boardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 2, minHeight: 160 },
  grid: { alignItems: 'center' },
  row: { flexDirection: 'row' },
  tileFace: { alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  tileText: { fontFamily: FONT.display, includeFontPadding: false, textTransform: 'uppercase' },

  pauseCard: { width: '88%', maxWidth: 340, alignItems: 'center', padding: 20 },

  toast: {
    position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: ST.panelStrong, borderRadius: ST.radius, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: withAlpha(ST.enemy, 0.6),
  },
  toastText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1, color: ST.text, textTransform: 'uppercase' },

  callout: {
    position: 'absolute', alignSelf: 'center', alignItems: 'center',
    paddingHorizontal: 22, paddingVertical: 14, borderRadius: ST.radius,
    backgroundColor: ST.panelStrong, borderTopWidth: 2,
  },
  calloutTitle: { fontFamily: FONT.display, fontSize: 30, letterSpacing: 3, includeFontPadding: false },
  calloutSub: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 1.4, color: ST.text, marginTop: 4 },
  calloutWord: { flexDirection: 'row', gap: 5, marginTop: 10 },

  burst: { position: 'absolute', top: '45%', left: '50%', width: 0, height: 0 },

  hintRow: { alignItems: 'center', marginTop: 4 },
  hint: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(92,242,160,0.14)' },
  hintText: { fontFamily: FONT.display, fontSize: 13, letterSpacing: 1.4, color: ST.health, includeFontPadding: false },

  actions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: ST.radius,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  actionText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.2, color: ST.text, textTransform: 'uppercase' },

  keyboard: { alignItems: 'center' },
  keyRow: { flexDirection: 'row' },
  key: { alignItems: 'center', justifyContent: 'center', borderRadius: ST.radius },
  keyText: { fontFamily: FONT.ui, fontSize: 16 },

  countdown: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,13,17,0.7)' },
  countText: { fontFamily: FONT.display, fontSize: 120, color: ST.text, includeFontPadding: false },

  // Results
  resultsOverlay: { ...StyleSheet.absoluteFill },
  resultsDim: { backgroundColor: 'rgba(11,13,17,0.96)' },
  resultsWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 300 },
  resultsBurst: { position: 'absolute', top: '22%', left: 0, right: 0, height: 0 },
  resultsScroll: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  resultsInner: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  resultStats: { flexDirection: 'row', gap: 6, marginTop: 24 },
  resultStat: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: ST.panel, borderRadius: ST.radius, gap: 2 },
  newBest: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: ST.objective, backgroundColor: withAlpha(ST.objective, 0.08), borderRadius: ST.radius,
  },
  newBestText: { fontFamily: FONT.display, fontSize: 18, color: ST.text, includeFontPadding: false },
  wordChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  wordChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: ST.radius },
  wordChipOk: { backgroundColor: withAlpha(SUCCESS, 0.16), borderWidth: 1, borderColor: withAlpha(SUCCESS, 0.45) },
  wordChipMiss: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: ST.line },
  wordChipText: { fontFamily: FONT.display, fontSize: 13, color: ST.text, letterSpacing: 1.5 },
  wordChipTextMiss: { color: ST.faint, textDecorationLine: 'line-through' },
  wordChipTries: { fontFamily: FONT.ui, fontSize: 11, color: SUCCESS },

  // Daily
  dailyCard: { alignSelf: 'stretch', padding: 14 },
  dailyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  nextWord: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: ST.cell, borderRadius: ST.radius },
  nextWordClock: { fontFamily: FONT.display, fontSize: 20, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  shareGrid: { alignSelf: 'center', gap: 4, marginTop: 18 },
  shareRow: { flexDirection: 'row', gap: 4 },
  shareSq: { width: 22, height: 22, borderRadius: 2 },
  shareSqAbsent: { borderWidth: 1, borderColor: ST.line },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distLabel: { width: 12, fontFamily: FONT.display, fontSize: 13, color: ST.muted, textAlign: 'right' },
  distBar: { height: 22, minWidth: 26, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 7, borderRadius: 2 },
  distCount: { fontFamily: FONT.display, fontSize: 12, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
})
