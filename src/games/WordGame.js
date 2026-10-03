// What's The Word (Word Race): solo, timed. Crack as many hidden 5-letter words as you can
// before the clock runs out. Six guesses per word; every guess must be a real word. Solving
// adds time to the clock, fewer guesses and streaks score more.
//
// Presentation: always-dark arcade look (see arcadeUI), chunky 3D letter tiles that pop when
// typed and flip to reveal, a draining timer bar, animated score count-ups, callouts, a
// confetti burst on every solve, synthesized sounds (gunAudio `word*` effects) and haptics.
// Everything animates with react-native Animated (native driver where possible), so it runs
// the same on iOS, Android and web.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated, AppState, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { GameTutorial } from '../components/GameTutorial'
import { AC, ArcadeBackground, GhostButton, PlayButton } from './arcadeUI'
import { font } from '../theme'
import { ANSWERS, isValidWord } from '../lib/wordRaceWords'
import { loadArcadeStats, recordWordRace } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import { playSfx } from '../lib/gunAudio'

const WORD_LEN = 5
const MAX_GUESSES = 6
const START_MS = 120 * 1000
const SOLVE_BONUS_MS = 15 * 1000
const SKIP_PENALTY_MS = 10 * 1000
const TUTORIAL_KEY = 'word_race_tutorial_seen_v2'

// Reveal timing: tiles flip one after another.
const FLIP_MS = 300
const FLIP_STAGGER = 80
const REVEAL_MS = FLIP_STAGGER * (WORD_LEN - 1) + FLIP_MS

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
const GREEN = ['#3ee596', '#0fa36a']

// Tile skins: a gradient face sitting on a darker "depth" slab.
const SKIN = {
  correct: { face: ['#4be79c', '#14a862'], depth: '#0a6a3c', text: '#ffffff' },
  present: { face: ['#ffd96b', '#f2a516'], depth: '#9c6304', text: '#ffffff' },
  absent: { face: ['#4b5274', '#353b5a'], depth: '#1d2137', text: '#c4c9e3' },
  filled: { face: ['#303a78', '#20275a'], depth: '#11153a', text: '#ffffff', border: 'rgba(150,165,255,0.85)' },
  empty: { face: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)'], depth: 'rgba(0,0,0,0.28)', text: '#ffffff', border: 'rgba(255,255,255,0.12)' },
  key: { face: ['#3d4576', '#2b3260'], depth: '#151938', text: '#eef1ff' },
}

const CONFETTI = ['#4be79c', '#ffd96b', '#7c8cff', '#ff5d8f', '#5ad7ff', '#ffffff']

const PRAISE = ['', 'GENIUS!', 'MAGNIFICENT!', 'IMPRESSIVE!', 'SPLENDID!', 'GREAT!', 'PHEW!']

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

// Points for a solve (unchanged rules): base + fewer guesses + streak bonus (capped).
export function solvePoints(tries, streak) {
  const base = 50
  const guessBonus = (MAX_GUESSES + 1 - tries) * 25
  const streakBonus = Math.min(50, (streak - 1) * 10)
  return { base, guessBonus, streakBonus, total: base + guessBonus + streakBonus }
}

const RANK = { absent: 1, present: 2, correct: 3 }
const ND = Platform.OS !== 'web' // native driver (web falls back to JS anyway)

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

function TileFace({ skin, size, letter, radius }) {
  const c = SKIN[skin]
  const depth = skin === 'empty' ? 0 : Math.max(3, Math.round(size * 0.075))
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {depth ? <View style={[styles.tileDepth, { top: depth, borderRadius: radius, backgroundColor: c.depth }]} /> : null}
      <LinearGradient
        colors={c.face}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.tileFace,
          { bottom: depth, borderRadius: radius },
          c.border ? { borderWidth: 2, borderColor: c.border } : null,
        ]}
      >
        {skin !== 'empty' ? <View style={[styles.tileShine, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} /> : null}
        <Text
          allowFontScaling={false}
          style={[styles.tileText, { fontSize: Math.round(size * 0.5), color: c.text }, skin === 'absent' && { textShadowColor: 'transparent' }]}
        >
          {letter}
        </Text>
      </LinearGradient>
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
      pop.setValue(1.18)
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

  const radius = Math.round(size * 0.2)
  const rotateX = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '90deg', '0deg'] })
  const frontOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [1, 1, 0, 0] })
  const backOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [0, 0, 1, 1] })
  const translateY = jump.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.38] })

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ perspective: 600 }, { translateY }, { rotateX }, { scale: pop }] }}
      accessible
      accessibilityLabel={letter ? `${letter}${state ? `, ${state === 'correct' ? 'correct' : state === 'present' ? 'wrong spot' : 'not in word'}` : ''}` : 'empty'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOpacity }]}>
        <TileFace skin={letter ? 'filled' : 'empty'} size={size} letter={letter} radius={radius} />
      </Animated.View>
      {state ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backOpacity }]}>
          <TileFace skin={state} size={size} letter={letter} radius={radius} />
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
      w: 6 + Math.random() * 6,
      h: Math.random() > 0.4 ? 10 + Math.random() * 6 : 8,
      round: Math.random() > 0.65,
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
            width: p.round ? p.w : p.w,
            height: p.round ? p.w : p.h,
            borderRadius: p.round ? p.w / 2 : 2,
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

// Big centered callout ("MAGNIFICENT!", "+175"...). Re-mounted (keyed) for each callout.
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
  const color = tone === 'good' ? '#4be79c' : tone === 'bad' ? '#ff6b7a' : tone === 'gold' ? AC.gold : AC.text
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.callout, {
        opacity: Animated.multiply(inV.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), outV.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
        transform: [
          { scale: inV.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
          { translateY: outV.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) },
        ],
      }]}
    >
      <Text allowFontScaling={false} style={[styles.calloutTitle, { color, textShadowColor: color }]}>{title}</Text>
      {word ? (
        <View style={styles.calloutWord}>
          {word.split('').map((ch, i) => (
            <View key={i} style={{ width: 34, height: 34 }}>
              <TileFace skin="correct" size={34} letter={ch} radius={7} />
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
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, -26] }) }, { scale: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) }],
      }]}
    >
      {text}
    </Animated.Text>
  )
})

// ---------------------------------------------------------------------------------------
// HUD

// Draining timer bar. Reads the run's end time from a ref so the whole board doesn't
// re-render 10x a second.
function TimerBar({ endAtRef, running, paused, pausedMs, bump }) {
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
  useEffect(() => { if (!running) setLeft(START_MS) }, [running])

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
  const barColors = left <= 15000 ? ['#ff8a5b', '#ff3b5c'] : left <= 45000 ? ['#ffe07a', '#f2a516'] : ['#5ad7ff', '#3ee596']
  return (
    <View style={styles.timerRow}>
      <Animated.View style={[styles.timerClock, { transform: [{ scale: pulse }] }]}>
        <Ionicons name="time" size={16} color={low ? '#ff6b7a' : AC.text} />
        <Text allowFontScaling={false} style={[styles.timerText, low && { color: '#ff6b7a' }]}>{formatClock(left)}</Text>
      </Animated.View>
      <View style={styles.timerTrack}>
        <LinearGradient colors={barColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.timerFill, { width: `${pct * 100}%` }]} />
        <View style={styles.timerGloss} pointerEvents="none" />
      </View>
      {bump ? <View style={styles.floaterAnchor} pointerEvents="none"><Floater key={bump.id} text={bump.text} color={bump.color} /></View> : null}
    </View>
  )
}

function HudStat({ label, value, icon, iconColor, pop, accent }) {
  return (
    <View style={styles.hudStat}>
      <View style={styles.hudLabelRow}>
        {icon ? <Ionicons name={icon} size={11} color={iconColor || AC.faint} /> : null}
        <Text allowFontScaling={false} style={styles.hudLabel}>{label}</Text>
      </View>
      <Animated.Text allowFontScaling={false} style={[styles.hudValue, accent && { color: accent }, pop && { transform: [{ scale: pop }] }]} numberOfLines={1}>
        {value}
      </Animated.Text>
    </View>
  )
}

// ---------------------------------------------------------------------------------------
// Keyboard

const Key = memo(function Key({ k, label, icon, state, width, height, onKey, accent }) {
  const skin = state ? SKIN[state] : SKIN.key
  const face = accent ? GREEN : skin.face
  const depthColor = accent ? '#07633f' : skin.depth
  const depth = 4
  return (
    <Pressable
      onPress={() => onKey(k)}
      accessibilityRole="button"
      accessibilityLabel={label === '⌫' ? 'Delete' : label || k}
      style={{ width, height }}
      hitSlop={{ top: 3, bottom: 3, left: 1, right: 1 }}
    >
      {({ pressed }) => (
        <View style={{ flex: 1 }}>
          <View style={[styles.keyDepth, { top: depth, backgroundColor: depthColor }]} />
          <LinearGradient
            colors={face}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.keyFace, { bottom: pressed ? 0 : depth, top: pressed ? depth : 0 }]}
          >
            {icon ? (
              <Ionicons name={icon} size={20} color="#fff" />
            ) : (
              <Text allowFontScaling={false} style={[styles.keyText, label && label.length > 1 && { fontSize: 12, letterSpacing: 0.6 }, { color: accent ? '#fff' : skin.text }]}>
                {label || k}
              </Text>
            )}
          </LinearGradient>
        </View>
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
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
          { rotate: `${(index % 2 ? 1 : -1) * 3}deg` },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
        ],
      }}
    >
      <TileFace skin={skin} size={size} letter={letter} radius={Math.round(size * 0.2)} />
    </Animated.View>
  )
}

function MiniTile({ letter, skin }) {
  return (
    <View style={{ width: 30, height: 30 }}>
      <TileFace skin={skin} size={30} letter={letter} radius={7} />
    </View>
  )
}

function HowLine({ left, text }) {
  return (
    <View style={styles.howLine}>
      <View style={styles.howIcon}>{left}</View>
      <Text style={styles.howText}>{text}</Text>
    </View>
  )
}

function BigStat({ label, value, icon, color }) {
  return (
    <View style={styles.bigStat}>
      <Ionicons name={icon} size={16} color={color} />
      <Text allowFontScaling={false} style={styles.bigStatValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text allowFontScaling={false} style={styles.bigStatLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------------------
// Game

export function WordGame({ onExit, onRecorded, bottomInset = 0, withBackground = true }) {
  const { width: winW, height: winH } = useWindowDimensions()
  const compact = winH < 700
  const contentW = Math.min(winW, 520)
  const keyGap = contentW < 360 ? 4 : 6
  const keyW = Math.floor((contentW - 16 - 9 * keyGap) / 10)
  const keyH = compact ? 44 : 54

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

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearLater()
    const { score: sc, solved: sv, bestStreak: bs } = stateRef.current
    setPhase('over')
    setPaused(false)
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
      if (left <= 0) { finish(); return }
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
    setBump({ id: Date.now(), text: ms > 0 ? `+${Math.round(ms / 1000)}s` : `−${Math.round(-ms / 1000)}s`, color: ms > 0 ? '#4be79c' : '#ff6b7a' })
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
          title: PRAISE[tries] || 'NICE!',
          sub: newStreak >= 2 ? `+${pts.total}   ·   🔥 ${newStreak} streak  +${pts.streakBonus}` : `+${pts.total}   ·   +15s`,
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
    setBump({ id: Date.now(), text: '−10s', color: '#ff6b7a' })
    if (endAtRef.current - Date.now() <= 0) { finish(); return }
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

  const keyStates = useMemo(() => {
    const m = {}
    guesses.slice(0, revealed).forEach(({ word, score: sc }) => {
      for (let i = 0; i < WORD_LEN; i++) {
        const ch = word[i]
        if (!m[ch] || RANK[sc[i]] > RANK[m[ch]]) m[ch] = sc[i]
      }
    })
    return m
  }, [guesses, revealed])

  const closeTutorial = () => {
    setShowTutorial(false)
    AsyncStorage.setItem(TUTORIAL_KEY, '1').catch(() => {})
  }

  const scoreShown = useCountUp(shownScore)
  const scorePop = usePop(shownScore, 1.3)
  const streakPop = usePop(streak, 1.45)
  const solvedPop = usePop(solved.length, 1.35)

  const bg = withBackground ? <ArcadeBackground /> : null

  // ----- Start screen -----
  if (phase === 'ready') {
    const titleSize = Math.min(64, Math.floor((contentW - 80) / 4))
    const wr = stats?.wordRace
    return (
      <View style={styles.container}>
        {bg}
        <ScrollView contentContainerStyle={[styles.startScroll, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.startInner, { maxWidth: 460 }]}>
            <View style={styles.startGlow} pointerEvents="none" />
            <Text allowFontScaling={false} style={styles.kicker}>WHAT'S THE</Text>
            <View style={styles.titleRow}>
              {['W', 'O', 'R', 'D'].map((ch, i) => (
                <TitleTile key={ch} letter={ch} index={i} size={titleSize} skin={['correct', 'present', 'correct', 'filled'][i]} />
              ))}
            </View>
            <Text style={styles.tagline}>Beat the clock. Crack the word.</Text>

            <View style={styles.howCard}>
              <HowLine left={<MiniTile letter="A" skin="correct" />} text="Green: right letter, right spot." />
              <HowLine left={<MiniTile letter="B" skin="present" />} text="Yellow: in the word, wrong spot." />
              <HowLine
                left={<View style={styles.howClock}><Ionicons name="timer" size={18} color={AC.gold} /></View>}
                text="2:00 on the clock. Every solve adds +15s."
              />
            </View>

            <View style={styles.bigStats}>
              <BigStat label="Best score" value={best != null ? best.toLocaleString() : '—'} icon="trophy" color={AC.gold} />
              <BigStat label="Best words" value={wr?.bestWords ? wr.bestWords : '—'} icon="checkmark-circle" color="#4be79c" />
              <BigStat label="Best streak" value={wr?.bestStreak ? wr.bestStreak : '—'} icon="flame" color="#ff8a5b" />
            </View>

            <PlayButton title="Play" icon="play" onPress={start} colors={GREEN} style={styles.playBtn} />
            <GhostButton title="How to play" icon="help-circle-outline" small onPress={() => setShowTutorial(true)} style={{ marginTop: 12, alignSelf: 'center' }} />
          </View>
        </ScrollView>
        {showTutorial && <GameTutorial steps={TUTORIAL_STEPS} onComplete={closeTutorial} gameTitle="What's The Word" />}
      </View>
    )
  }

  // ----- Board -----
  const gap = board && board.w > 380 ? 8 : 6
  const tileSize = board
    ? Math.max(28, Math.floor(Math.min((board.w - 4 * gap) / WORD_LEN, (board.h - 5 * gap - 8) / MAX_GUESSES, 66)))
    : 0
  const playing = phase === 'playing'
  const running = playing || phase === 'over'

  return (
    <View style={styles.container}>
      {bg}
      <View style={[styles.playInner, { maxWidth: 520, paddingBottom: bottomInset + (compact ? 6 : 12) }]}>
        {/* HUD */}
        <View style={styles.hud}>
          <HudStat label="Score" value={scoreShown.toLocaleString()} icon="star" iconColor={AC.gold} pop={scorePop} />
          <HudStat label="Solved" value={solved.length} icon="checkmark-circle" iconColor="#4be79c" pop={solvedPop} />
          <View style={styles.hudStat}>
            <View style={styles.hudLabelRow}>
              <Ionicons name="flame" size={11} color={streak ? '#ff8a5b' : AC.faint} />
              <Text allowFontScaling={false} style={styles.hudLabel}>Streak</Text>
            </View>
            <Animated.View style={[styles.streakChip, streak >= 2 && styles.streakChipHot, { transform: [{ scale: streakPop }] }]}>
              <Text allowFontScaling={false} style={[styles.hudValue, { fontSize: 18 }, streak >= 2 && { color: '#fff' }]}>×{streak}</Text>
            </Animated.View>
          </View>
          <Pressable
            onPress={paused ? resume : pause}
            disabled={!playing}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume' : 'Pause'}
            hitSlop={8}
            style={({ pressed }) => [styles.roundBtn, { opacity: playing ? 1 : 0.4, transform: [{ scale: pressed ? 0.9 : 1 }] }]}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={18} color={AC.text} />
          </Pressable>
        </View>
        <TimerBar endAtRef={endAtRef} running={running && phase !== 'over'} paused={paused} pausedMs={pausedMs} bump={bump} />

        {/* Board */}
        <View style={styles.boardArea} onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout
          if (!board || Math.abs(board.w - w) > 1 || Math.abs(board.h - h) > 1) setBoard({ w, h })
        }}
        >
          {board && !paused ? (
            <Animated.View
              key={wordId}
              style={[styles.grid, { gap, opacity: boardIn, transform: [{ scale: boardIn.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}
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
            <View style={styles.pauseCard}>
              <Ionicons name="pause-circle" size={54} color={AC.accent} />
              <Text style={styles.pauseTitle}>Paused</Text>
              <Text style={styles.pauseBody}>The clock is stopped. The board is hidden until you resume.</Text>
              <PlayButton title="Resume" icon="play" onPress={resume} colors={GREEN} style={{ alignSelf: 'stretch', marginTop: 18 }} />
              <GhostButton title="End run" icon="flag" small onPress={finish} style={{ alignSelf: 'stretch', marginTop: 10 }} />
            </View>
          ) : null}

          {toast ? (
            <View key={toast.id} style={styles.toast} pointerEvents="none">
              <Ionicons name="alert-circle" size={15} color="#ff6b7a" />
              <Text style={styles.toastText}>{toast.text}</Text>
            </View>
          ) : null}
          {callout && !paused ? <Callout key={callout.id} title={callout.title} sub={callout.sub} tone={callout.tone} word={callout.word} /> : null}
          {burst > 0 && phase !== 'over' ? <Burst key={burst} /> : null}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={skip}
            disabled={!playing || paused || roundLocked}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pill, { opacity: !playing || paused || roundLocked ? 0.4 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
          >
            <Ionicons name="play-skip-forward" size={14} color={AC.text} />
            <Text style={styles.pillText}>Skip</Text>
            <Text style={styles.pillPenalty}>−10s</Text>
          </Pressable>
          <Pressable
            onPress={finish}
            disabled={!playing}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pill, { opacity: playing ? 1 : 0.4, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
          >
            <Ionicons name="flag" size={14} color={AC.text} />
            <Text style={styles.pillText}>End run</Text>
          </Pressable>
        </View>

        {/* Keyboard */}
        <View style={[styles.keyboard, { gap: compact ? 6 : 8 }]}>
          {KEY_ROWS.map((r, ri) => (
            <View key={r} style={[styles.keyRow, { gap: keyGap }]}>
              {ri === 2 && <Key k="ENTER" label="ENTER" accent onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
              {r.split('').map((k) => (
                <Key key={k} k={k} state={keyStates[k]} onKey={handleKey} width={keyW} height={keyH} />
              ))}
              {ri === 2 && <Key k="DEL" label="⌫" icon="backspace-outline" onKey={handleKey} width={Math.floor(keyW * 1.5 + keyGap / 2)} height={keyH} />}
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
        <Text allowFontScaling={false} style={[styles.countText, go && { color: '#4be79c', textShadowColor: 'rgba(75,231,156,0.8)' }]}>
          {go ? 'GO!' : count}
        </Text>
        {!go ? <Text style={styles.countSub}>Get ready…</Text> : null}
      </Animated.View>
    </View>
  )
}

// Run summary.
function Results({ score, solved, missed, bestStreak, summary, burst, bottomInset, onPlayAgain, onExit, onMenu }) {
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
    Animated.spring(badge, { toValue: 1, delay: 500, friction: 4, tension: 120, useNativeDriver: ND }).start()
    return undefined
  }, [isNewBest, badge])
  const attempted = solved.length + missed.length
  const accuracy = attempted ? `${Math.round((solved.length / attempted) * 100)}%` : '—'
  const avg = solved.length ? (solved.reduce((a, s) => a + s.tries, 0) / solved.length).toFixed(1) : '—'
  const words = [...solved.map((s) => ({ w: s.word, ok: true, tries: s.tries })), ...missed.map((w) => ({ w, ok: false }))]

  return (
    <View style={styles.resultsOverlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.resultsDim, { opacity: enter }]} />
      {isNewBest ? <View style={styles.resultsBurst} pointerEvents="none"><Burst key={burst} count={44} spread={1.5} /></View> : null}
      <ScrollView contentContainerStyle={[styles.resultsScroll, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.resultsCardOuter, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]}>
          <LinearGradient colors={['rgba(36,44,92,0.97)', 'rgba(14,16,36,0.98)']} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.resultsCard}>
            <Text style={styles.resultsKicker}>TIME'S UP</Text>
            <Text allowFontScaling={false} style={styles.resultsScore}>{shown.toLocaleString()}</Text>
            <Text style={styles.resultsScoreLabel}>points</Text>

            {isNewBest ? (
              <Animated.View style={[styles.newBest, { opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }, { rotate: '-3deg' }] }]}>
                <LinearGradient colors={['#ffe08a', '#f2a516']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.newBestInner}>
                  <Ionicons name="trophy" size={15} color="#3a2600" />
                  <Text style={styles.newBestText}>NEW PERSONAL BEST</Text>
                </LinearGradient>
              </Animated.View>
            ) : summary?.previousBest != null ? (
              <Text style={styles.prevBest}>Personal best {summary.previousBest.toLocaleString()}</Text>
            ) : null}

            <View style={styles.resultStats}>
              <BigStat label="Words" value={solved.length} icon="checkmark-circle" color="#4be79c" />
              <BigStat label="Accuracy" value={accuracy} icon="locate" color="#5ad7ff" />
              <BigStat label="Best streak" value={bestStreak} icon="flame" color="#ff8a5b" />
            </View>
            <View style={styles.resultMeta}>
              <Text style={styles.resultMetaText}>Avg guesses <Text style={styles.resultMetaStrong}>{avg}</Text></Text>
              {summary ? (
                <View style={styles.pointsPill}>
                  <Text style={styles.pointsGlyph}>◆</Text>
                  <Text style={styles.pointsText}>+{summary.pointsEarned} arcade points</Text>
                </View>
              ) : null}
            </View>

            {words.length ? (
              <View style={styles.wordChips}>
                {words.slice(0, 24).map((x, i) => (
                  <View key={`${x.w}-${i}`} style={[styles.wordChip, x.ok ? styles.wordChipOk : styles.wordChipMiss]}>
                    <Text style={[styles.wordChipText, !x.ok && styles.wordChipTextMiss]}>{x.w}</Text>
                    {x.ok ? <Text style={styles.wordChipTries}>{x.tries}/6</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noWords}>No words this time. Try a starter like CRANE or SLATE.</Text>
            )}

            <PlayButton title="Play again" icon="refresh" onPress={onPlayAgain} colors={GREEN} style={{ alignSelf: 'stretch', marginTop: 20 }} />
            {onExit ? (
              <GhostButton title="Back to arcade" icon="grid-outline" onPress={onExit} style={{ alignSelf: 'stretch', marginTop: 10 }} />
            ) : (
              <GhostButton title="Main menu" icon="home-outline" onPress={onMenu} style={{ alignSelf: 'stretch', marginTop: 10 }} />
            )}
          </LinearGradient>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

export default WordGame

const textGlow = Platform.select({
  web: { textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  default: { textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
})

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Start
  startScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 8 },
  startInner: { width: '100%', alignSelf: 'center', alignItems: 'center' },
  startGlow: { position: 'absolute', top: -40, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(62,229,150,0.12)' },
  kicker: { fontSize: 15, ...font.heavy, color: AC.muted, letterSpacing: 6, marginBottom: 10 },
  titleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tagline: { fontSize: 16, ...font.semibold, color: AC.text, opacity: 0.85, marginBottom: 22 },
  howCard: {
    alignSelf: 'stretch', borderRadius: 22, padding: 16, gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: AC.border,
  },
  howLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  howIcon: { width: 30, alignItems: 'center' },
  howClock: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,201,77,0.14)', alignItems: 'center', justifyContent: 'center' },
  howText: { flex: 1, fontSize: 14.5, ...font.medium, color: AC.text, lineHeight: 19 },
  bigStats: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 14 },
  bigStat: {
    flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: AC.border, gap: 2,
  },
  bigStatValue: { fontSize: 20, ...font.heavy, color: AC.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  bigStatLabel: { fontSize: 10, ...font.bold, color: AC.faint, letterSpacing: 1, textTransform: 'uppercase' },
  playBtn: { alignSelf: 'stretch', marginTop: 22 },

  // Play
  playInner: { flex: 1, width: '100%', alignSelf: 'center', paddingHorizontal: 8, paddingTop: 6 },
  hud: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 },
  hudStat: { flex: 1, alignItems: 'flex-start' },
  hudLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hudLabel: { fontSize: 10, ...font.heavy, color: AC.faint, letterSpacing: 1.2, textTransform: 'uppercase' },
  hudValue: { fontSize: 24, ...font.heavy, color: AC.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  streakChip: { marginTop: 2, paddingHorizontal: 10, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: AC.border },
  streakChipHot: { backgroundColor: '#ff6a3d', borderColor: '#ffb08a' },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: AC.border,
  },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginTop: 10 },
  timerClock: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 62 },
  timerText: { fontSize: 17, ...font.heavy, color: AC.text, fontVariant: ['tabular-nums'] },
  timerTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  timerFill: { height: '100%', borderRadius: 6 },
  timerGloss: { position: 'absolute', top: 1, left: 4, right: 4, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  floaterAnchor: { position: 'absolute', left: 8, top: -18 },
  floater: { fontSize: 18, ...font.heavy, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  boardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 4, minHeight: 160 },
  grid: { alignItems: 'center' },
  row: { flexDirection: 'row' },
  tileDepth: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  tileFace: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileShine: { position: 'absolute', top: 0, left: 0, right: 0, height: '42%', backgroundColor: 'rgba(255,255,255,0.12)' },
  tileText: { ...font.heavy, letterSpacing: 0.5, ...textGlow },

  pauseCard: {
    width: '88%', maxWidth: 340, alignItems: 'center', padding: 22, borderRadius: 24,
    backgroundColor: 'rgba(20,24,52,0.92)', borderWidth: 1, borderColor: AC.border,
  },
  pauseTitle: { fontSize: 26, ...font.heavy, color: AC.text, marginTop: 6 },
  pauseBody: { fontSize: 14, ...font.regular, color: AC.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  toast: {
    position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(30,14,26,0.95)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,107,122,0.5)',
  },
  toastText: { fontSize: 14, ...font.bold, color: AC.text },

  callout: {
    position: 'absolute', alignSelf: 'center', alignItems: 'center',
    paddingHorizontal: 22, paddingVertical: 14, borderRadius: 22,
    backgroundColor: 'rgba(8,10,24,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  calloutTitle: { fontSize: 30, ...font.heavy, letterSpacing: 1, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 },
  calloutSub: { fontSize: 15, ...font.bold, color: AC.text, marginTop: 4 },
  calloutWord: { flexDirection: 'row', gap: 5, marginTop: 10 },

  burst: { position: 'absolute', top: '45%', left: '50%', width: 0, height: 0 },

  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: AC.border,
  },
  pillText: { fontSize: 13, ...font.bold, color: AC.text },
  pillPenalty: { fontSize: 12, ...font.heavy, color: '#ff6b7a' },

  keyboard: { alignItems: 'center' },
  keyRow: { flexDirection: 'row' },
  keyDepth: { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 9 },
  keyFace: { position: 'absolute', left: 0, right: 0, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 18, ...font.heavy, ...textGlow },

  countdown: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,5,13,0.55)' },
  countText: { fontSize: 120, ...font.heavy, color: AC.text, textShadowColor: 'rgba(124,140,255,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 30 },
  countSub: { fontSize: 16, ...font.bold, color: AC.muted, letterSpacing: 2, marginTop: -6 },

  // Results
  resultsOverlay: { ...StyleSheet.absoluteFillObject },
  resultsDim: { backgroundColor: 'rgba(4,5,13,0.78)' },
  resultsBurst: { position: 'absolute', top: '22%', left: 0, right: 0, height: 0 },
  resultsScroll: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  resultsCardOuter: {
    width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 28,
    shadowColor: 'rgba(62,229,150,0.5)', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
  },
  resultsCard: { borderRadius: 28, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  resultsKicker: { fontSize: 13, ...font.heavy, color: AC.accent, letterSpacing: 4 },
  resultsScore: { fontSize: 64, ...font.heavy, color: AC.text, fontVariant: ['tabular-nums'], letterSpacing: -2, marginTop: 4 },
  resultsScoreLabel: { fontSize: 12, ...font.bold, color: AC.faint, letterSpacing: 2, textTransform: 'uppercase', marginTop: -6 },
  newBest: { marginTop: 12 },
  newBestInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  newBestText: { fontSize: 13, ...font.heavy, color: '#3a2600', letterSpacing: 1 },
  prevBest: { fontSize: 13, ...font.semibold, color: AC.muted, marginTop: 10 },
  resultStats: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 18 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 12, flexWrap: 'wrap', gap: 8 },
  resultMetaText: { fontSize: 13, ...font.medium, color: AC.muted },
  resultMetaStrong: { ...font.heavy, color: AC.text },
  pointsPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,201,77,0.14)' },
  pointsGlyph: { fontSize: 11, color: AC.gold, ...font.heavy },
  pointsText: { fontSize: 13, ...font.bold, color: AC.gold },
  wordChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 16 },
  wordChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  wordChipOk: { backgroundColor: 'rgba(62,229,150,0.16)', borderWidth: 1, borderColor: 'rgba(62,229,150,0.4)' },
  wordChipMiss: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: AC.border },
  wordChipText: { fontSize: 13, ...font.heavy, color: AC.text, letterSpacing: 1 },
  wordChipTextMiss: { color: AC.faint, textDecorationLine: 'line-through' },
  wordChipTries: { fontSize: 11, ...font.bold, color: '#4be79c' },
  noWords: { fontSize: 14, ...font.medium, color: AC.muted, textAlign: 'center', marginTop: 16 },
})
