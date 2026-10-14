// Little cartoon objects (pineapple, rubber duck, donut, cactus, satellite, cat, pizza
// slice, UFO) that pop up behind the Beside Them task terminal, plus a confetti burst for
// "Access granted". Playful, not creepy.
//
// Performance: at most MAX_TOYS on screen; each is one react-native-svg drawing inside an
// Animated.View driven on the native driver (scale / translate / opacity only). A spawn is
// one small state update every ~2 s. Reduce Motion: no spawning, two still toys.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg'

const OUT = '#1b1f3b' // soft outline

function Pineapple() {
  return (
    <G>
      <Polygon points="24,2 20,14 24,11 28,14" fill="#3ccf6e" stroke={OUT} strokeWidth={1.2} />
      <Polygon points="17,6 21,15 24,12" fill="#2fb35c" stroke={OUT} strokeWidth={1.2} />
      <Polygon points="31,6 27,15 24,12" fill="#2fb35c" stroke={OUT} strokeWidth={1.2} />
      <Ellipse cx={24} cy={30} rx={11} ry={15} fill="#ffcf3f" stroke={OUT} strokeWidth={1.5} />
      <Path d="M15 22 L33 38 M15 30 L28 43 M19 17 L33 30 M33 22 L15 38 M33 30 L20 43 M29 17 L15 30" stroke="#e59b16" strokeWidth={1.2} />
    </G>
  )
}
function Duck() {
  return (
    <G>
      <Ellipse cx={25} cy={33} rx={16} ry={10} fill="#ffd93d" stroke={OUT} strokeWidth={1.5} />
      <Circle cx={18} cy={18} r={9} fill="#ffd93d" stroke={OUT} strokeWidth={1.5} />
      <Path d="M8 18 Q3 21 9 23 Q12 22 10 19 Z" fill="#ff8c2b" stroke={OUT} strokeWidth={1.2} />
      <Circle cx={17} cy={16} r={1.8} fill={OUT} />
      <Path d="M26 31 Q33 27 38 32" stroke="#e8b923" strokeWidth={2} fill="none" strokeLinecap="round" />
    </G>
  )
}
function Donut() {
  return (
    <G>
      <Circle cx={24} cy={25} r={17} fill="#e9a66b" stroke={OUT} strokeWidth={1.5} />
      <Path d="M8 23 Q10 9 24 8 Q38 9 40 23 Q38 30 33 27 Q30 33 25 29 Q20 34 16 28 Q10 31 8 23 Z" fill="#ff7eb6" />
      <Circle cx={24} cy={24} r={5.5} fill="#2a2f5a" stroke={OUT} strokeWidth={1.5} />
      <Line x1={15} y1={16} x2={18} y2={14} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={30} y1={14} x2={33} y2={17} stroke="#7ce7ff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={22} y1={13} x2={25} y2={14} stroke="#ffe066" strokeWidth={2} strokeLinecap="round" />
      <Line x1={33} y1={23} x2={34} y2={26} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
    </G>
  )
}
function Cactus() {
  return (
    <G>
      <Rect x={19} y={6} width={10} height={30} rx={5} fill="#46c46c" stroke={OUT} strokeWidth={1.5} />
      <Path d="M19 22 H13 Q10 22 10 19 V14" stroke={OUT} strokeWidth={6.5} fill="none" strokeLinecap="round" />
      <Path d="M19 22 H13 Q10 22 10 19 V14" stroke="#46c46c" strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M29 26 H35 Q38 26 38 23 V18" stroke={OUT} strokeWidth={6.5} fill="none" strokeLinecap="round" />
      <Path d="M29 26 H35 Q38 26 38 23 V18" stroke="#46c46c" strokeWidth={4} fill="none" strokeLinecap="round" />
      <Circle cx={24} cy={5} r={2.5} fill="#ff7eb6" />
      <Path d="M14 36 H34 L31 46 H17 Z" fill="#e0794a" stroke={OUT} strokeWidth={1.5} />
    </G>
  )
}
function Satellite() {
  return (
    <G>
      <Rect x={2} y={19} width={13} height={9} fill="#5b8cff" stroke={OUT} strokeWidth={1.2} />
      <Rect x={33} y={19} width={13} height={9} fill="#5b8cff" stroke={OUT} strokeWidth={1.2} />
      <Line x1={15} y1={23.5} x2={33} y2={23.5} stroke={OUT} strokeWidth={1.5} />
      <Rect x={18} y={17} width={12} height={13} rx={2} fill="#d9e1ff" stroke={OUT} strokeWidth={1.5} />
      <Path d="M17 14 Q24 2 31 14 Z" fill="#f2f4ff" stroke={OUT} strokeWidth={1.5} />
      <Line x1={24} y1={10} x2={24} y2={4} stroke={OUT} strokeWidth={1.2} />
      <Circle cx={24} cy={3.5} r={1.8} fill="#ff6b81" />
    </G>
  )
}
function Cat() {
  return (
    <G>
      <Polygon points="9,8 12,22 20,15" fill="#ffb15e" stroke={OUT} strokeWidth={1.5} />
      <Polygon points="39,8 36,22 28,15" fill="#ffb15e" stroke={OUT} strokeWidth={1.5} />
      <Circle cx={24} cy={27} r={15} fill="#ffb15e" stroke={OUT} strokeWidth={1.5} />
      <Ellipse cx={18.5} cy={25} rx={2} ry={3} fill={OUT} />
      <Ellipse cx={29.5} cy={25} rx={2} ry={3} fill={OUT} />
      <Path d="M22 31 L24 33 L26 31" stroke={OUT} strokeWidth={1.4} fill="#ff7eb6" />
      <Path d="M8 30 H16 M8 34 L16 32 M40 30 H32 M40 34 L32 32" stroke={OUT} strokeWidth={1} />
    </G>
  )
}
function Pizza() {
  return (
    <G>
      <Path d="M6 10 Q24 2 42 10 L24 45 Z" fill="#ffd46b" stroke={OUT} strokeWidth={1.5} />
      <Path d="M6 10 Q24 2 42 10 L40 14 Q24 7 8 14 Z" fill="#d98b3a" stroke={OUT} strokeWidth={1.2} />
      <Circle cx={18} cy={19} r={3.5} fill="#ef5b5b" />
      <Circle cx={29} cy={20} r={3.2} fill="#ef5b5b" />
      <Circle cx={24} cy={30} r={3} fill="#ef5b5b" />
      <Circle cx={22} cy={14} r={1.2} fill="#46c46c" />
    </G>
  )
}
function Ufo() {
  return (
    <G>
      <Path d="M15 24 Q16 10 24 10 Q32 10 33 24 Z" fill="#9cf0ff" stroke={OUT} strokeWidth={1.5} />
      <Ellipse cx={24} cy={27} rx={21} ry={7} fill="#b8c2e0" stroke={OUT} strokeWidth={1.5} />
      <Circle cx={12} cy={27} r={1.8} fill="#ffe066" />
      <Circle cx={24} cy={29} r={1.8} fill="#7cff9e" />
      <Circle cx={36} cy={27} r={1.8} fill="#ff7eb6" />
      <Path d="M17 34 L13 44 H35 L31 34 Z" fill="rgba(156,240,255,0.25)" />
    </G>
  )
}

const DRAW = { pineapple: Pineapple, duck: Duck, donut: Donut, cactus: Cactus, satellite: Satellite, cat: Cat, pizza: Pizza, ufo: Ufo }
export const TOY_KINDS = Object.keys(DRAW)

/** One static cartoon (also used for station icons). */
export function Toy({ kind, size = 48 }) {
  const D = DRAW[kind] || Pineapple
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <D />
    </Svg>
  )
}

const LIFE_MS = 2600
function PoppingToy({ kind, x, y, size, tilt, onEnd }) {
  const v = useRef(new Animated.Value(0)).current
  const end = useRef(onEnd)
  end.current = onEnd
  useEffect(() => {
    const a = Animated.sequence([
      Animated.spring(v, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(v, { toValue: 2, duration: LIFE_MS - 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 3, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ])
    a.start(({ finished }) => { if (finished) end.current?.() })
    return () => a.stop()
  }, [v])
  const scale = v.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0.2, 1, 1, 0.6], extrapolate: 'clamp' })
  const opacity = v.interpolate({ inputRange: [0, 0.3, 2, 3], outputRange: [0, 0.75, 0.75, 0], extrapolate: 'clamp' })
  const translateY = v.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [18, 0, -14, -24], extrapolate: 'clamp' })
  return (
    <Animated.View style={{ position: 'absolute', left: x, top: y, opacity, transform: [{ translateY }, { scale }, { rotate: `${tilt}deg` }] }}>
      <Toy kind={kind} size={size} />
    </Animated.View>
  )
}

const MAX_TOYS = 3
/** Absolute layer of toys popping up at random spots every couple of seconds. */
export const PopToys = React.memo(function PopToys({ reduce, every = 2100, kinds }) {
  const [box, setBox] = useState(null)
  const [items, setItems] = useState([])
  const n = useRef(0)
  const pool = kinds && kinds.length ? kinds : TOY_KINDS
  useEffect(() => {
    if (reduce || !box) { setItems([]); return undefined }
    const spawn = () => {
      const size = 38 + Math.round(Math.random() * 22)
      const x = Math.random() * Math.max(1, box.w - size)
      const y = 40 + Math.random() * Math.max(1, box.h - size - 80)
      const id = ++n.current
      const kind = pool[Math.floor(Math.random() * pool.length)]
      setItems((list) => (list.length >= MAX_TOYS ? list : [...list, { id, kind, x, y, size, tilt: Math.round(Math.random() * 30 - 15) }]))
    }
    spawn()
    const t = setInterval(spawn, every + Math.random() * 500)
    return () => clearInterval(t)
  }, [reduce, box, every]) // eslint-disable-line react-hooks/exhaustive-deps
  const still = useMemo(() => (reduce && box ? [
    { id: 's1', kind: pool[0], x: box.w * 0.08, y: box.h * 0.72, size: 44, tilt: -8 },
    { id: 's2', kind: pool[Math.min(1, pool.length - 1)], x: box.w * 0.78, y: box.h * 0.16, size: 40, tilt: 10 },
  ] : []), [reduce, box]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {still.map((t) => (
        <View key={t.id} style={{ position: 'absolute', left: t.x, top: t.y, opacity: 0.45, transform: [{ rotate: `${t.tilt}deg` }] }}>
          <Toy kind={t.kind} size={t.size} />
        </View>
      ))}
      {items.map((t) => (
        <PoppingToy key={t.id} {...t} onEnd={() => setItems((list) => list.filter((x) => x.id !== t.id))} />
      ))}
    </View>
  )
})

const CONFETTI_COLORS = ['#5cf2a0', '#39d5ff', '#ffd93d', '#ff7eb6', '#b9a6ff', '#ffb21e']
/** One-shot confetti burst from the centre of the parent (native driver, ~20 pieces). */
export function Confetti({ reduce, count = 20 }) {
  const v = useRef(new Animated.Value(0)).current
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const dist = 90 + Math.random() * 90
    return {
      dx: Math.cos(ang) * dist,
      dy: Math.sin(ang) * dist * 0.7 - 30,
      fall: 120 + Math.random() * 80,
      spin: `${Math.round(Math.random() * 720 - 360)}deg`,
      c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w: 6 + Math.random() * 5,
      round: i % 3 === 0,
    }
  }), [count])
  useEffect(() => {
    if (reduce) return undefined
    v.setValue(0)
    const a = Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [reduce, v])
  if (reduce) return null
  return (
    <View style={s.burst} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.round ? p.w : p.w * 0.45,
            borderRadius: p.round ? p.w : 1,
            backgroundColor: p.c,
            opacity: v.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
              { translateY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.dy, p.dy + p.fall] }) },
              { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.spin] }) },
            ],
          }}
        />
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  burst: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
})
