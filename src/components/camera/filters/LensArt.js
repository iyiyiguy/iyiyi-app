import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, {
  Circle, Defs, Ellipse, LinearGradient as SvgLinear, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg'
import SocialIcon from '../../SocialIcon'
import { FilterArt, IY_LOGO } from './FilterArt'
import { OVERLAY_BOX, isLegacyLens } from './lenses'
import { translate } from '../../../i18n'
import camStrings from '../../../i18n/strings/camera'

// Art for the AR lenses. Each one draws inside an OVERLAY_BOX square (pivot = bottom-centre,
// see lenses.js for where each lens's art sits in the box). Vector art (react-native-svg) so it
// stays sharp at any scale and snapshots cleanly into photos and the video art PNG. `live` =
// over the preview (idle loops on the native driver); otherwise a still for baking.
// The original three filters (iY Logo, Name Tag, I love you) are still drawn by FilterArt.

const B = OVERLAY_BOX

// Calls onReady once, after the first frame has been drawn.
function useReadyOnce(onReady, auto = true) {
  const fired = useRef(false)
  const fire = () => {
    if (fired.current) return
    fired.current = true
    try { onReady?.() } catch {}
  }
  useEffect(() => {
    if (!auto) return undefined
    const id = requestAnimationFrame(() => requestAnimationFrame(fire))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return fire
}

// Looping native-driver value 0..1..0 (only while live).
function useLoopValue(live, ms, delay = 0) {
  const v = useRef(new Animated.Value(live ? 0 : 1)).current
  useEffect(() => {
    if (!live) return undefined
    const anim = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    anim.start()
    return () => anim.stop()
  }, [live, ms, delay, v])
  return v
}

// Pop-in on first appearance (live only).
function usePop(live) {
  const v = useRef(new Animated.Value(live ? 0 : 1)).current
  useEffect(() => {
    if (live) Animated.spring(v, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start()
  }, [live, v])
  return v
}

// Four-point star path centred on 0,0 with radius 1.
const STAR = 'M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1 Z'
function StarGlyph({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="-1.1 -1.1 2.2 2.2">
      <Path d={STAR} fill={color} />
      <Circle r={0.16} fill="#ffffff" />
    </Svg>
  )
}

// A star that twinkles (scale + opacity) while live; a steady star in stills.
function Twinkle({ x, y, size, color = '#fff6c8', live, delay = 0, ms = 700, still = 0.9 }) {
  const t = useLoopValue(live, ms, delay)
  const scale = live ? t.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.1] }) : still
  const opacity = live ? t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) : 1
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, opacity, transform: [{ scale }] }}
    >
      <StarGlyph size={size} color={color} />
    </Animated.View>
  )
}

// --- Shades: glossy wayfarers on the eye line (art centre 42 px above the box bottom) -------
function Shades({ live, onReady }) {
  useReadyOnce(onReady)
  const pop = usePop(live)
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1.25, 1] })
  return (
    <Animated.View style={[styles.box, { opacity: pop, transform: [{ scale }] }]} pointerEvents="none">
      <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`}>
        <Defs>
          <SvgLinear id="lens" x1="0" y1="0" x2="0.3" y2="1">
            <Stop offset="0" stopColor="#120a22" stopOpacity="0.96" />
            <Stop offset="0.6" stopColor="#3b1260" stopOpacity="0.93" />
            <Stop offset="1" stopColor="#b0157e" stopOpacity="0.9" />
          </SvgLinear>
          <SvgLinear id="rim" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ff5bd8" />
            <Stop offset="0.5" stopColor="#ffe08a" />
            <Stop offset="1" stopColor="#7a5bff" />
          </SvgLinear>
        </Defs>
        {/* temples */}
        <Path d="M20 104 L8 99" stroke="url(#rim)" strokeWidth={4} strokeLinecap="round" />
        <Path d="M140 104 L152 99" stroke="url(#rim)" strokeWidth={4} strokeLinecap="round" />
        {/* lenses */}
        <Rect x={18} y={98} width={58} height={40} rx={15} fill="url(#lens)" stroke="url(#rim)" strokeWidth={3.2} />
        <Rect x={84} y={98} width={58} height={40} rx={15} fill="url(#lens)" stroke="url(#rim)" strokeWidth={3.2} />
        {/* bridge */}
        <Path d="M75 109 Q80 102 85 109" stroke="url(#rim)" strokeWidth={3.6} fill="none" strokeLinecap="round" />
        {/* glare */}
        <Path d="M26 104 L44 104 L32 130 L24 130 Z" fill="#ffffff" opacity={0.28} />
        <Path d="M92 104 L110 104 L98 130 L90 130 Z" fill="#ffffff" opacity={0.28} />
        <Ellipse cx={64} cy={106} rx={6} ry={2.4} fill="#ffffff" opacity={0.5} />
        <Ellipse cx={130} cy={106} rx={6} ry={2.4} fill="#ffffff" opacity={0.5} />
      </Svg>
      <Twinkle x={132} y={102} size={18} live={live} ms={900} delay={300} />
    </Animated.View>
  )
}

// --- Crown: gold crown resting on the head (base at the box bottom) ----------------------------
function Crown({ live, onReady }) {
  useReadyOnce(onReady)
  const pop = usePop(live)
  const translateY = pop.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] })
  return (
    <Animated.View style={[styles.box, { opacity: pop, transform: [{ translateY }] }]} pointerEvents="none">
      <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`}>
        <Defs>
          <SvgLinear id="gold" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fff6c2" />
            <Stop offset="0.45" stopColor="#ffc531" />
            <Stop offset="1" stopColor="#b8730a" />
          </SvgLinear>
          <SvgLinear id="band" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffd75a" />
            <Stop offset="1" stopColor="#9a5c00" />
          </SvgLinear>
        </Defs>
        <Path d="M24 144 L16 94 L48 120 L80 72 L112 120 L144 94 L136 144 Z" fill="url(#gold)" stroke="#8a5200" strokeWidth={1.2} strokeLinejoin="round" />
        <Path d="M30 138 L26 106 L48 126 L80 84" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Rect x={22} y={138} width={116} height={17} rx={5} fill="url(#band)" stroke="#8a5200" strokeWidth={1} />
        <Circle cx={16} cy={94} r={5.5} fill="url(#gold)" stroke="#8a5200" strokeWidth={1} />
        <Circle cx={80} cy={72} r={6.5} fill="url(#gold)" stroke="#8a5200" strokeWidth={1} />
        <Circle cx={144} cy={94} r={5.5} fill="url(#gold)" stroke="#8a5200" strokeWidth={1} />
        <Path d="M80 100 L90 114 L80 128 L70 114 Z" fill="#ff3fbf" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={1.2} />
        <Circle cx={46} cy={146.5} r={4.6} fill="#38d9ff" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1} />
        <Circle cx={80} cy={146.5} r={5.2} fill="#a35bff" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1} />
        <Circle cx={114} cy={146.5} r={4.6} fill="#38d9ff" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1} />
        <Circle cx={77} cy={108} r={1.8} fill="#ffffff" />
      </Svg>
      <Twinkle x={80} y={70} size={20} live={live} ms={800} />
      <Twinkle x={144} y={92} size={14} live={live} ms={650} delay={420} />
      <Twinkle x={84} y={110} size={12} live={live} ms={560} delay={200} still={0} />
    </Animated.View>
  )
}

// --- Halo: a glowing ring floating just above the head ---------------------------------------
function Halo({ live, onReady }) {
  useReadyOnce(onReady)
  const pulse = useLoopValue(live, 1400)
  const glow = live ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) : 0.9
  const translateY = live ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) : 0
  return (
    <Animated.View style={[styles.box, { transform: [{ translateY }] }]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`}>
          <Defs>
            <RadialGradient id="haloGlow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0.55" stopColor="#ffe27a" stopOpacity="0" />
              <Stop offset="0.8" stopColor="#ffe27a" stopOpacity="0.45" />
              <Stop offset="1" stopColor="#ffe27a" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={80} cy={138} rx={74} ry={20} fill="url(#haloGlow)" />
          <Ellipse cx={80} cy={138} rx={60} ry={14} stroke="#ffd84d" strokeOpacity={0.35} strokeWidth={9} fill="none" />
        </Svg>
      </Animated.View>
      <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinear id="ring" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffeaa0" />
            <Stop offset="0.5" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#ffd060" />
          </SvgLinear>
        </Defs>
        <Ellipse cx={80} cy={138} rx={60} ry={14} stroke="#ffcf3a" strokeWidth={4.5} fill="none" />
        <Ellipse cx={80} cy={138} rx={60} ry={14} stroke="url(#ring)" strokeWidth={2} fill="none" />
      </Svg>
      <Twinkle x={26} y={132} size={14} live={live} ms={700} delay={150} />
      <Twinkle x={134} y={142} size={16} live={live} ms={760} delay={500} />
      <Twinkle x={92} y={122} size={11} live={live} ms={620} still={0} />
    </Animated.View>
  )
}

// --- Sparkle: stars twinkling around the face (art centred in the box) -------------------------
const SPARKS = [
  [22, 54, 22, '#fff6c8', 0], [138, 40, 18, '#ffd1f2', 220], [148, 102, 14, '#ffffff', 480],
  [12, 112, 16, '#ffe48a', 640], [58, 18, 12, '#ffffff', 120], [108, 150, 15, '#ffd1f2', 380],
  [40, 146, 11, '#fff6c8', 820], [124, 76, 10, '#ffffff', 300], [96, 8, 13, '#ffe48a', 560],
]
function Sparkle({ live, onReady }) {
  useReadyOnce(onReady)
  return (
    <View style={styles.box} pointerEvents="none">
      {SPARKS.map(([x, y, size, color, delay]) => (
        <Twinkle key={`${x}-${y}`} x={x} y={y} size={size} color={color} delay={delay} ms={640 + (delay % 300)} live={live} />
      ))}
    </View>
  )
}

// --- Doll Glam: an original fashion-doll makeover painted over the face ------------------------
// The face (as tracked: brow line to chin, cheek to cheek) is 100 box px wide, centred in the
// box: eyes ~y71 (x61 / x99), lips ~y108, cheeks ~y92, ear lobes ~x28 / x132. Everything is
// soft-edged and semi-transparent so the real face reads through it.
const EYES = [{ cx: 61, side: -1 }, { cx: 99, side: 1 }] // side: which way the outer corner points
const EYE_Y = 71
// Upper lash line for one eye (outer corner toward `side`), plus a flicked liner wing.
function eyeParts(cx, side) {
  const o = cx + side * 11 // outer corner
  const i = cx - side * 10 // inner corner
  const lid = `M${i} ${EYE_Y + 1} Q${cx} ${EYE_Y - 6.5} ${o} ${EYE_Y}`
  const wing = `M${cx + side * 4} ${EYE_Y - 3.6} Q${o} ${EYE_Y - 2.4} ${o + side * 7.5} ${EYE_Y - 6.5} L${o - side * 0.5} ${EYE_Y + 0.6} Z`
  const lashes = [0.2, 0.36, 0.52, 0.68, 0.84, 0.98].map((t) => {
    // a point on the lid curve, then a curled lash out and up (longer toward the outer corner)
    const x0 = (1 - t) * (1 - t) * i + 2 * (1 - t) * t * cx + t * t * o
    const y0 = (1 - t) * (1 - t) * (EYE_Y + 1) + 2 * (1 - t) * t * (EYE_Y - 6.5) + t * t * EYE_Y
    const len = 3.2 + t * 4.2
    const dx = side * (0.6 + t * 2.6)
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} q${(dx * 0.3).toFixed(1)} ${(-len * 0.7).toFixed(1)} ${dx.toFixed(1)} ${(-len).toFixed(1)}`
  })
  const lower = `M${i + side * 3} ${EYE_Y + 3.4} Q${cx} ${EYE_Y + 6} ${o - side * 1} ${EYE_Y + 2.2}`
  return { lid, wing, lashes, lower }
}
const LIPS = 'M58 108 C63 102.5 71 99.2 76.6 101.2 Q80 103.4 83.4 101.2 C89 99.2 97 102.5 102 108 C96.5 119.5 63.5 119.5 58 108 Z'
const LIP_LINE = 'M59.5 108.2 C67 110.6 93 110.6 100.5 108.2'

function Hoop({ cx, live, delay }) {
  const sway = useLoopValue(live, 1300, delay)
  const rotate = live ? sway.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '7deg'] }) : '0deg'
  // swings about the lobe (top of the hoop)
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: cx - 13, top: 93, width: 26, height: 30, transformOrigin: '50% 0%', transform: [{ rotate }] }}
    >
      <Svg width={26} height={30} viewBox="0 0 26 30">
        <Defs>
          <SvgLinear id="hoopG" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fff3c4" />
            <Stop offset="0.5" stopColor="#ffc93d" />
            <Stop offset="1" stopColor="#c47d0c" />
          </SvgLinear>
        </Defs>
        <Circle cx={13} cy={2.2} r={1.9} fill="#ffd75a" />
        <Circle cx={13} cy={15.5} r={11} stroke="url(#hoopG)" strokeWidth={2.6} fill="none" />
        <Path d="M5.5 9.5 A11 11 0 0 1 11 4.7" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.1} fill="none" strokeLinecap="round" />
      </Svg>
    </Animated.View>
  )
}

function DollGlam({ live, onReady }) {
  useReadyOnce(onReady)
  const pop = usePop(live)
  const gloss = useLoopValue(live, 1600)
  const glossO = live ? gloss.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) : 0.75
  const eyes = EYES.map((e) => ({ ...e, ...eyeParts(e.cx, e.side) }))
  return (
    <Animated.View style={[styles.box, { opacity: pop }]} pointerEvents="none">
      <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="dgSkin" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#fff2f6" stopOpacity="0.2" />
            <Stop offset="0.65" stopColor="#ffd9e6" stopOpacity="0.1" />
            <Stop offset="1" stopColor="#ffd9e6" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="dgBlush" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#ff5f9e" stopOpacity="0.42" />
            <Stop offset="1" stopColor="#ff5f9e" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="dgShadow" cx="50%" cy="70%" rx="55%" ry="70%">
            <Stop offset="0" stopColor="#d24bd8" stopOpacity="0.62" />
            <Stop offset="0.6" stopColor="#ff7ac8" stopOpacity="0.32" />
            <Stop offset="1" stopColor="#ff7ac8" stopOpacity="0" />
          </RadialGradient>
          <SvgLinear id="dgLips" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ff4fa0" stopOpacity="0.9" />
            <Stop offset="0.55" stopColor="#e8197a" stopOpacity="0.88" />
            <Stop offset="1" stopColor="#b80d5e" stopOpacity="0.86" />
          </SvgLinear>
          <SvgLinear id="dgHair" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </SvgLinear>
        </Defs>
        {/* soft skin glow */}
        <Ellipse cx={80} cy={84} rx={50} ry={58} fill="url(#dgSkin)" />
        {/* glossy hair-shine highlight just above the hairline */}
        <Path d="M44 30 Q66 12 98 18" stroke="url(#dgHair)" strokeWidth={5} fill="none" strokeLinecap="round" />
        <Path d="M54 24 Q70 15 88 17" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        {/* blush */}
        <Ellipse cx={51} cy={93} rx={13} ry={8} fill="url(#dgBlush)" />
        <Ellipse cx={109} cy={93} rx={13} ry={8} fill="url(#dgBlush)" />
        {eyes.map((e) => (
          <React.Fragment key={e.cx}>
            {/* shimmer shadow on the lid, swept up toward the outer corner */}
            <Ellipse cx={e.cx + e.side * 2.5} cy={EYE_Y - 6} rx={15} ry={8.5} fill="url(#dgShadow)" />
            <Path d={e.lower} stroke="#5a1846" strokeOpacity={0.55} strokeWidth={0.9} fill="none" strokeLinecap="round" />
            <Path d={e.wing} fill="#140616" fillOpacity={0.92} />
            <Path d={e.lid} stroke="#140616" strokeOpacity={0.95} strokeWidth={1.9} fill="none" strokeLinecap="round" />
            {e.lashes.map((d) => (
              <Path key={d} d={d} stroke="#140616" strokeOpacity={0.9} strokeWidth={1.05} fill="none" strokeLinecap="round" />
            ))}
            {/* glitter flecks */}
            <Circle cx={e.cx - e.side * 3} cy={EYE_Y - 9} r={0.9} fill="#ffffff" opacity={0.85} />
            <Circle cx={e.cx + e.side * 4} cy={EYE_Y - 10.5} r={0.7} fill="#fff2a8" opacity={0.85} />
            <Circle cx={e.cx + e.side * 8} cy={EYE_Y - 7.5} r={0.8} fill="#ffffff" opacity={0.8} />
          </React.Fragment>
        ))}
        {/* glossy oversized lips */}
        <Path d={LIPS} fill="url(#dgLips)" stroke="#9c0a50" strokeOpacity={0.45} strokeWidth={0.8} strokeLinejoin="round" />
        <Path d={LIP_LINE} stroke="#7a0640" strokeOpacity={0.6} strokeWidth={1} fill="none" strokeLinecap="round" />
        {/* beauty mark */}
        <Circle cx={105} cy={100} r={1.5} fill="#3a1a1a" opacity={0.85} />
      </Svg>
      {/* lip gloss highlights (shimmer while live) */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glossO }]} pointerEvents="none">
        <Svg width={B} height={B} viewBox={`0 0 ${B} ${B}`}>
          <Ellipse cx={80} cy={113.2} rx={9} ry={2.2} fill="#ffffff" opacity={0.7} />
          <Ellipse cx={70} cy={104} rx={3.4} ry={1.2} fill="#ffffff" opacity={0.55} />
          <Ellipse cx={90} cy={104} rx={3.4} ry={1.2} fill="#ffffff" opacity={0.55} />
        </Svg>
      </Animated.View>
      <Hoop cx={28} live={live} delay={0} />
      <Hoop cx={132} live={live} delay={350} />
      <Twinkle x={73} y={60} size={7} live={live} ms={620} delay={120} />
      <Twinkle x={110} y={62} size={8} live={live} ms={700} delay={460} />
      <Twinkle x={93} y={104} size={7} live={live} ms={760} delay={260} still={0} />
    </Animated.View>
  )
}

// --- Follow me: an iYiYi social card with the person's @handle and the platforms they're on ----
function IdCard({ name, platforms, live, onReady }) {
  const fire = useReadyOnce(onReady, false)
  useEffect(() => {
    const t = setTimeout(fire, 700) // in case the logo never reports
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pop = usePop(live)
  const float = useLoopValue(live, 1500)
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] })
  const translateY = live ? float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) : 0
  const label = typeof name === 'string' && name ? name : '@iyiyi'
  const list = Array.isArray(platforms) ? platforms.slice(0, 6) : []
  return (
    <Animated.View style={[styles.box, { opacity: pop, transform: [{ translateY }, { scale }] }]} pointerEvents="none">
      <View style={styles.cardShadow}>
        <View style={styles.card}>
          <LinearGradient
            colors={['rgba(255,43,214,0.92)', 'rgba(116,52,255,0.92)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.55 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.cardRow}>
            <View style={styles.cardAvatar}>
              <Image source={IY_LOGO} style={styles.cardLogo} resizeMode="contain" fadeDuration={0} onLoad={fire} onError={fire} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.cardName, { fontSize: label.length > 15 ? 11 : label.length > 11 ? 12.5 : 14 }]} numberOfLines={1}>{label}</Text>
              {list.length ? (
                <View style={styles.cardIcons}>
                  {list.map((p) => <SocialIcon key={p} platform={p} size={9.5} color="#ffffff" />)}
                </View>
              ) : (
                <Text style={styles.cardSub} numberOfLines={1}>{translate(camStrings, 'onIyiyi')}</Text>
              )}
            </View>
          </View>
          <View style={styles.cardCta}>
            <Ionicons name="person-add" size={10} color="#7a2cff" />
            <Text style={styles.cardCtaText}>{translate(camStrings, 'followMe')}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

// One entry point for every lens. `platforms`: linked platforms to show on the Follow me card.
export function LensArt({ lens, name, platforms, live = true, onReady, pose, use3D, registerPose, yawAnim }) {
  if (isLegacyLens(lens)) {
    return <FilterArt filter={lens} name={name} live={live} onReady={onReady} pose={pose} use3D={use3D} registerPose={registerPose} yawAnim={yawAnim} />
  }
  if (lens === 'shades') return <Shades live={live} onReady={onReady} />
  if (lens === 'crown') return <Crown live={live} onReady={onReady} />
  if (lens === 'halo') return <Halo live={live} onReady={onReady} />
  if (lens === 'sparkle') return <Sparkle live={live} onReady={onReady} />
  if (lens === 'dollglam') return <DollGlam live={live} onReady={onReady} />
  if (lens === 'idcard') return <IdCard name={name} platforms={platforms} live={live} onReady={onReady} />
  return null
}

// Small round preview for the lens carousel.
export function LensThumb({ lens, size }) {
  const icon = Math.round(size * 0.46)
  const wrap = (colors, child) => (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
      <View style={styles.thumbCenter}>{child}</View>
    </LinearGradient>
  )
  switch (lens) {
    case 'logo':
      return wrap(['#3a1050', '#140a24'], <Image source={IY_LOGO} style={{ width: size * 0.6, height: size * 0.5 }} resizeMode="contain" fadeDuration={0} />)
    case 'nametag':
      return wrap(['#8c9bff', '#272c52'], <Text style={[styles.thumbAt, { fontSize: Math.round(size * 0.42) }]}>@</Text>)
    case 'love':
      return wrap(['#ff8cc6', '#e3166a'], <Ionicons name="heart" size={icon} color="#fff" />)
    case 'idcard':
      return wrap(['#ff2bd6', '#7434ff'], <Ionicons name="person-add" size={Math.round(icon * 0.9)} color="#fff" />)
    case 'shades':
      return wrap(['#2b1648', '#0c0716'], (
        <Svg width={size * 0.72} height={size * 0.4} viewBox="14 94 132 48">
          <Rect x={18} y={98} width={58} height={40} rx={15} fill="#3b1260" stroke="#ff9be8" strokeWidth={5} />
          <Rect x={84} y={98} width={58} height={40} rx={15} fill="#3b1260" stroke="#ff9be8" strokeWidth={5} />
          <Path d="M75 109 Q80 102 85 109" stroke="#ff9be8" strokeWidth={5} fill="none" />
        </Svg>
      ))
    case 'crown':
      return wrap(['#ffe28a', '#c77a00'], (
        <Svg width={size * 0.66} height={size * 0.5} viewBox="10 66 140 94">
          <Path d="M24 144 L16 94 L48 120 L80 72 L112 120 L144 94 L136 144 Z" fill="#ffffff" />
          <Rect x={22} y={138} width={116} height={17} rx={5} fill="#ffffff" />
        </Svg>
      ))
    case 'halo':
      return wrap(['#5a4a1a', '#14100a'], (
        <Svg width={size * 0.7} height={size * 0.4} viewBox="0 0 70 30">
          <Ellipse cx={35} cy={15} rx={28} ry={8} stroke="#ffd84d" strokeWidth={4} fill="none" />
          <Ellipse cx={35} cy={15} rx={28} ry={8} stroke="#ffffff" strokeWidth={1.4} fill="none" />
        </Svg>
      ))
    case 'sparkle':
      return wrap(['#ff8ad8', '#6b3cff'], <StarGlyph size={size * 0.5} color="#fff6c8" />)
    case 'dollglam':
      return wrap(['#ffb3d6', '#c2187a'], (
        <Svg width={size * 0.72} height={size * 0.6} viewBox="40 56 80 66">
          <Path d="M50 70 Q61 63.5 72 71" stroke="#2a0a22" strokeWidth={3} fill="none" strokeLinecap="round" />
          <Path d="M50 70 L43 62.5 L52 68 Z" fill="#2a0a22" />
          {[54, 58, 62, 66].map((x, k) => (
            <Path key={x} d={`M${x} ${68 - (k % 2)} l${-1.6 - k * 0.2} -5`} stroke="#2a0a22" strokeWidth={1.8} strokeLinecap="round" />
          ))}
          <Path d="M88 70 Q99 63.5 110 71" stroke="#2a0a22" strokeWidth={3} fill="none" strokeLinecap="round" />
          <Path d="M110 70 L117 62.5 L108 68 Z" fill="#2a0a22" />
          {[94, 98, 102, 106].map((x, k) => (
            <Path key={x} d={`M${x} ${67 + (k % 2)} l${1.6 + k * 0.2} -5`} stroke="#2a0a22" strokeWidth={1.8} strokeLinecap="round" />
          ))}
          <Path d={LIPS} fill="#ffffff" />
          <Path d={LIP_LINE} stroke="#e0498f" strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Ellipse cx={80} cy={113.2} rx={8} ry={2} fill="#ffd1e6" />
        </Svg>
      ))
    default:
      return (
        <View style={[StyleSheet.absoluteFill, styles.thumbCenter, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <Ionicons name="close" size={Math.round(icon * 0.8)} color="rgba(255,255,255,0.9)" />
        </View>
      )
  }
}

const styles = StyleSheet.create({
  box: { width: B, height: B, alignItems: 'center', justifyContent: 'flex-end' },
  cardShadow: {
    marginBottom: 4, borderRadius: 16,
    shadowColor: '#ff2bd6', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
  },
  card: {
    width: 150, borderRadius: 16, overflow: 'hidden', paddingHorizontal: 9, paddingTop: 8, paddingBottom: 8,
    borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.75)', gap: 7,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
  },
  cardLogo: { width: 22, height: 18 },
  cardName: {
    color: '#ffffff', fontWeight: '900', letterSpacing: 0.2,
    textShadowColor: 'rgba(40,0,60,0.45)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },
  cardSub: { color: 'rgba(255,255,255,0.88)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  cardIcons: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  cardCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, alignSelf: 'stretch',
    backgroundColor: '#ffffff', borderRadius: 999, paddingVertical: 4,
  },
  cardCtaText: { color: '#7a2cff', fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },
  thumbCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbAt: { color: '#ffffff', fontWeight: '800', marginTop: -2 },
})
