// Movie-style "code cracking" terminal for the Beside Them task flow (scan step, puzzle
// step, access granted / try again) and the meeting screen. Friendly, not creepy: a
// bright-ish indigo ground, mint/cyan scrolling code with silly lines in it, and cartoon
// objects (pineapples, rubber ducks, donuts, UFOs…, see ./toys.js) popping up behind the
// puzzle. Red is only used for "try again". Built on the studio tokens (square corners,
// caps labels) so it reads as the same product.
//
// Performance: every loop is an Animated loop on the native driver (transform / opacity
// only), the code columns are one pre-built Text each that slides, and the readouts tick at
// most a few times a second. Reduce Motion stops all loops and shows a still frame.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { FONT, ST, stType, withAlpha } from '../studio'
import { Confetti, PopToys } from './toys'

export const TERM = {
  ground: '#121c46',
  groundTop: '#1d2d6e',
  groundBottom: '#0f1738',
  grid: 'rgba(124,231,255,0.08)',
  gridStrong: 'rgba(124,231,255,0.16)',
  code: 'rgba(140,240,215,0.30)',
  scan: ST.friendly,
  granted: '#5cf2a0',
  denied: '#ff6b81', // soft coral, only for "try again"
  amber: ST.objective,
  edge: 'rgba(124,231,255,0.38)',
  panel: 'rgba(12,20,52,0.86)',
}

export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export const termType = {
  mono: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: ST.muted, fontVariant: ['tabular-nums'] },
  monoStrong: { fontFamily: MONO, fontSize: 12, lineHeight: 16, color: ST.text, fontVariant: ['tabular-nums'] },
  head: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: withAlpha(ST.friendly, 0.85), textTransform: 'uppercase' },
}

export const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, '0')

/** true while the OS Reduce Motion setting is on (live-updates). */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduce(!!v))
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return reduce
}

const EASE_IO = Easing.inOut(Easing.quad)

/** Native-driver loop that runs only while `run` is true; returns the Animated.Value (0..1). */
function useLoop(run, duration, { bounce = false, easing = Easing.linear, delay = 0 } = {}) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!run) { v.stopAnimation(); v.setValue(0); return undefined }
    const one = Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true, delay })
    const anim = bounce
      ? Animated.loop(Animated.sequence([one, Animated.timing(v, { toValue: 0, duration, easing, useNativeDriver: true })]))
      : Animated.loop(one)
    anim.start()
    return () => anim.stop()
  }, [run, duration, bounce, delay, v]) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

/** A value that ticks every `ms` while `run` (cheap JS: a few renders a second at most). */
export function useTicker(run, ms, fn, initial) {
  const [val, setVal] = useState(initial)
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    if (!run) return undefined
    const t = setInterval(() => setVal((p) => f.current(p)), ms)
    return () => clearInterval(t)
  }, [run, ms])
  return val
}

const HEX = '0123456789ABCDEF'
const SILLY = [
  'pineapple.exe ..OK', 'duck.calibrate()', 'if (snack) refuel()', 'load donuts[12]', 'cat.purr = true',
  'ufo.land(pad_3)', 'pizza++', 'cactus.hug() // no', 'beep boop', 'wifi.vibes = max', 'sudo make sandwich',
]
function codeLines(seed, n) {
  let x = seed * 9301 + 49297
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280 }
  const out = []
  for (let i = 0; i < n; i++) {
    const r = rnd()
    if (r < 0.12) out.push(`> ${SILLY[(rnd() * SILLY.length) | 0]}`)
    else if (r < 0.24) out.push(`>> AUTH ${HEX[(rnd() * 16) | 0]}${HEX[(rnd() * 16) | 0]}:${((rnd() * 999) | 0).toString().padStart(3, '0')}`)
    else if (r < 0.3) out.push(`0x${Array.from({ length: 4 }, () => HEX[(rnd() * 16) | 0]).join('')} ..OK`)
    else out.push(Array.from({ length: 4 }, () => HEX[(rnd() * 16) | 0] + HEX[(rnd() * 16) | 0]).join(' '))
  }
  return out.join('\n')
}

const LINE_H = 14
/** One column of scrolling hex. The text is doubled so the loop is seamless. */
function CodeColumn({ seed, lines = 40, run, duration, style, align = 'left' }) {
  const text = useMemo(() => { const t = codeLines(seed, lines); return `${t}\n${t}` }, [seed, lines])
  const t = useLoop(run, duration)
  const h = lines * LINE_H
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -h] })
  return (
    <View style={[s.codeCol, style]} pointerEvents="none">
      <Animated.Text style={[s.codeText, { textAlign: align, transform: [{ translateY }] }]}>{text}</Animated.Text>
    </View>
  )
}

/** Static hairline grid (built once). */
function Grid({ step = 28 }) {
  const lines = useMemo(() => {
    const out = []
    for (let i = 1; i < 16; i++) out.push(<View key={`v${i}`} style={[s.gridV, { left: i * step }, i % 4 === 0 && s.gridStrong]} />)
    for (let i = 1; i < 34; i++) out.push(<View key={`h${i}`} style={[s.gridH, { top: i * step }, i % 4 === 0 && s.gridStrong]} />)
    return out
  }, [step])
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{lines}</View>
}

/**
 * Animated terminal backdrop. Put it first inside a full-screen container.
 * overCamera: transparent ground, no grid/code (just scan line + vignette + scanlines).
 * tone: colour of the scan line ('friendly' default; meetings pass objective/enemy).
 * toys: cartoon objects popping up behind the content (the task screen).
 */
export const TermBackdrop = React.memo(function TermBackdrop({ overCamera = false, tone = TERM.scan, code = true, toys = false, reduce }) {
  const run = !reduce
  const sweep = useLoop(run, 5200, { easing: EASE_IO })
  const flicker = useLoop(run, 2600, { bounce: true })
  const [h, setH] = useState(800)
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [-80, h] })
  const flickerOp = flicker.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.0, 0.05, 0.02] })
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: overCamera ? 'transparent' : TERM.ground }]} pointerEvents="none" onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {!overCamera ? <LinearGradient colors={[TERM.groundTop, TERM.ground, TERM.groundBottom]} style={StyleSheet.absoluteFill} /> : null}
      {!overCamera ? <Grid /> : null}
      {!overCamera && code ? (
        <>
          <CodeColumn seed={7} run={run} duration={46000} style={{ left: 6 }} />
          <CodeColumn seed={23} run={run} duration={61000} style={{ right: 6 }} align="right" />
        </>
      ) : null}
      {/* CRT scanlines: a few dozen faint bands (cheap stand-in for per-pixel noise) */}
      <View style={StyleSheet.absoluteFill}>
        {Array.from({ length: 30 }, (_, i) => <View key={i} style={[s.scanBand, { top: `${(i * 100) / 30}%` }]} />)}
      </View>
      <Animated.View style={[s.sweep, { transform: [{ translateY }] }]}>
        <LinearGradient colors={['transparent', withAlpha(tone, 0.10), withAlpha(tone, 0.22)]} style={{ flex: 1 }} />
        <View style={{ height: 1.5, backgroundColor: withAlpha(tone, 0.75) }} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tone, opacity: run ? flickerOp : 0 }]} />
      {!overCamera && toys ? <PopToys reduce={reduce} /> : null}
      {/* soft vignette (darker over the camera so text stays readable) */}
      <LinearGradient colors={[overCamera ? 'rgba(0,0,0,0.7)' : 'rgba(8,12,36,0.55)', 'transparent']} style={[s.vig, { top: 0 }]} />
      <LinearGradient colors={['transparent', overCamera ? 'rgba(0,0,0,0.8)' : 'rgba(8,12,36,0.6)']} style={[s.vig, { bottom: 0 }]} />
      {overCamera ? (
        <>
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.vigSide, { left: 0 }]} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.vigSide, { right: 0 }]} />
        </>
      ) : null}
    </View>
  )
})

/** Four L-shaped corner brackets around the parent (absolute). */
export function Brackets({ color = TERM.edge, size = 18, thick = 2, inset = 0 }) {
  const b = { position: 'absolute', width: size, height: size, borderColor: color }
  return (
    <View style={[StyleSheet.absoluteFill, { margin: inset }]} pointerEvents="none">
      <View style={[b, { top: 0, left: 0, borderTopWidth: thick, borderLeftWidth: thick }]} />
      <View style={[b, { top: 0, right: 0, borderTopWidth: thick, borderRightWidth: thick }]} />
      <View style={[b, { bottom: 0, left: 0, borderBottomWidth: thick, borderLeftWidth: thick }]} />
      <View style={[b, { bottom: 0, right: 0, borderBottomWidth: thick, borderRightWidth: thick }]} />
    </View>
  )
}

/** Blinking block cursor. */
export function Cursor({ reduce, color = ST.friendly, w = 7, h = 12 }) {
  const t = useLoop(!reduce, 530, { bounce: true })
  const opacity = reduce ? 1 : t.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0] })
  return <Animated.View style={{ width: w, height: h, backgroundColor: color, opacity, marginLeft: 3 }} />
}

/** "STATION 04 // FRIDGE · ACCESS LEVEL CREW · LINK SECURE" header bar. */
export function TermHeader({ left, right, segments = [], color = ST.friendly, reduce, style }) {
  return (
    <View style={[s.header, { borderColor: withAlpha(color, 0.35) }, style]}>
      <View style={[s.headTag, { backgroundColor: color }]}>
        <Text style={[stType.label, { color: ST.ink, fontSize: 10 }]} numberOfLines={1}>{left}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[termType.head, { flexShrink: 1, color: withAlpha(color, 0.9) }]} numberOfLines={1}>{segments.join('  ·  ')}</Text>
        <Cursor reduce={reduce} color={color} w={6} h={10} />
      </View>
      {right ? <Text style={[termType.head, { color: ST.muted }]} numberOfLines={1}>{right}</Text> : null}
    </View>
  )
}

/** Small key/value readout: "SIGNAL  087%". */
export function Readout({ label, value, color = ST.text, style }) {
  return (
    <View style={[s.readout, style]}>
      <Text style={[termType.head, { color: ST.faint, fontSize: 9 }]} numberOfLines={1}>{label}</Text>
      <Text style={[termType.monoStrong, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

/** Segmented decrypt bar. */
export function SegBar({ value = 0, segments = 20, color = ST.friendly, style }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * segments)
  return (
    <View style={[{ flexDirection: 'row', gap: 2, height: 8 }, style]}>
      {Array.from({ length: segments }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: i < on ? color : withAlpha(color, 0.12) }} />
      ))}
    </View>
  )
}

/** Bordered terminal module with a title strip, used to house each puzzle. */
export function TermModule({ title, code, color = ST.friendly, children, style, flash }) {
  const edge = flash ? TERM.denied : withAlpha(color, 0.45)
  return (
    <View style={[s.module, { borderColor: edge }, style]}>
      <View style={[s.moduleHead, { borderBottomColor: withAlpha(color, 0.25) }]}>
        <View style={[s.moduleDot, { backgroundColor: flash ? TERM.denied : color }]} />
        <Text style={[termType.head, { flex: 1, color: flash ? TERM.denied : color }]} numberOfLines={1}>{title}</Text>
        {code ? <Text style={[termType.mono, { fontSize: 10, color: ST.faint }]}>{code}</Text> : null}
      </View>
      <View style={{ padding: 14 }}>{children}</View>
      <Brackets color={flash ? TERM.denied : color} size={10} thick={2} inset={-1} />
    </View>
  )
}

/** "ACCESS GRANTED" (with confetti) / "TRY AGAIN" stamp; pops in on mount. */
export function AccessStamp({ granted = true, sub, reduce, style }) {
  const c = granted ? TERM.granted : TERM.denied
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.setValue(1); return undefined }
    const a = Animated.spring(v, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [reduce, v])
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] })
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[s.stamp, { borderColor: c, backgroundColor: withAlpha(c, granted ? 0.16 : 0.12), opacity: v, transform: [{ scale }, { rotate: granted ? '-4deg' : '3deg' }] }, style]} accessibilityRole="alert" accessibilityLabel={granted ? 'Access granted' : 'Not quite, try again'}>
        <Text style={[stType.label, { color: c, textAlign: 'center' }]}>{granted ? 'Nice one! Clearance verified' : 'Not quite'}</Text>
        <Text style={[stType.display, { color: c, fontSize: 38, lineHeight: 42, letterSpacing: 3, textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {granted ? 'Access granted' : 'Try again'}
        </Text>
        {sub ? <Text style={[termType.mono, { color: withAlpha(c, 0.9), textAlign: 'center', marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : null}
      </Animated.View>
      {granted ? <Confetti reduce={reduce} /> : null}
    </View>
  )
}

/** Full-screen terminal ground for a scrolling screen (meeting). */
export function TermScreen({ children, tone = ST.friendly }) {
  const reduce = useReduceMotion()
  return (
    <View style={{ flex: 1, backgroundColor: TERM.ground }}>
      <TermBackdrop tone={tone} reduce={reduce} />
      {typeof children === 'function' ? children(reduce) : children}
    </View>
  )
}

const s = StyleSheet.create({
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: TERM.grid },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: TERM.grid },
  gridStrong: { backgroundColor: TERM.gridStrong },
  codeCol: { position: 'absolute', top: 0, bottom: 0, width: 110, overflow: 'hidden', opacity: 0.9 },
  codeText: { fontFamily: MONO, fontSize: 10, lineHeight: LINE_H, color: TERM.code },
  scanBand: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.03)' },
  sweep: { position: 'absolute', left: 0, right: 0, top: 0, height: 80 },
  vig: { position: 'absolute', left: 0, right: 0, height: 160 },
  vigSide: { position: 'absolute', top: 0, bottom: 0, width: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 26, paddingRight: 8, borderWidth: 1, backgroundColor: 'rgba(12,20,52,0.8)', borderRadius: ST.radius },
  headTag: { height: '100%', paddingHorizontal: 8, justifyContent: 'center' },
  readout: { flex: 1, paddingVertical: 5, paddingHorizontal: 8, borderLeftWidth: 2, borderLeftColor: TERM.edge, backgroundColor: 'rgba(12,20,52,0.7)' },
  module: { borderWidth: 1, backgroundColor: TERM.panel, borderRadius: ST.radius },
  moduleHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 28, borderBottomWidth: 1 },
  moduleDot: { width: 6, height: 6 },
  stamp: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 18, borderWidth: 3, borderRadius: ST.radius, maxWidth: '92%' },
})
