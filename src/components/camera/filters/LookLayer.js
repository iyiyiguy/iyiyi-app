import React, { useEffect, useRef } from 'react'
import { Animated, Image, Platform, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, {
  Defs, FeColorMatrix, FeComposite, FeGaussianBlur, Filter, Image as SvgImage, RadialGradient, Rect, Stop,
} from 'react-native-svg'
import { IY_LOGO } from './FilterArt'
import { lookInfo } from './lenses'
import { translate } from '../../../i18n'
import camStrings from '../../../i18n/strings/camera'

// Scene filters: colour-grade "looks" and the branded post frame.
//
// Live (over the camera preview) a look is a couple of static, full-frame washes - blend modes
// on iOS, plain tints on Android - plus a vignette: no per-frame work at all. Photos get the
// real grade: the captured image is redrawn through an SVG colour matrix inside the hidden
// bake view, so react-native-view-shot stamps the graded pixels (see GradedPhoto).

function Vignette({ strength }) {
  if (!(strength > 0)) return null
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <RadialGradient id="vig" cx="50%" cy="46%" rx="72%" ry="64%" fx="50%" fy="46%">
          <Stop offset="0.5" stopColor="#000000" stopOpacity="0" />
          <Stop offset="0.82" stopColor="#000000" stopOpacity={strength * 0.45} />
          <Stop offset="1" stopColor="#000000" stopOpacity={strength} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#vig)" />
    </Svg>
  )
}

// Live stand-in for soft focus: a faint centre-weighted white glow (the preview can't be blurred).
function Bloom() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <RadialGradient id="bloom" cx="50%" cy="42%" rx="60%" ry="52%" fx="50%" fy="42%">
          <Stop offset="0" stopColor="#fff4f9" stopOpacity="0.16" />
          <Stop offset="0.7" stopColor="#ffe3f0" stopOpacity="0.06" />
          <Stop offset="1" stopColor="#ffe3f0" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloom)" />
    </Svg>
  )
}

// Live look over the preview. Fades in on change (native driver).
export function LiveLook({ look }) {
  const info = lookInfo(look)
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    fade.setValue(0)
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start()
  }, [look, fade])
  if (!info || info.id === 'none') return null
  const layers = (Platform.OS === 'ios' ? info.ios : info.android) || []
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      {layers.map((l, i) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: l.color, opacity: l.opacity },
            Platform.OS === 'ios' && l.blend ? { mixBlendMode: l.blend } : null,
          ]}
        />
      ))}
      {info.soft > 0 && <Bloom />}
      <Vignette strength={info.vignette} />
    </Animated.View>
  )
}

// The captured photo, aspect-filled into the bake view, drawn through the look's colour matrix
// (plus its vignette). Sits on top of the plain photo, so if the SVG path ever fails the
// ungraded original still shows. onReady fires once it has loaded (or after a short wait).
export function GradedPhoto({ uri, look, width, height, onReady }) {
  const info = lookInfo(look)
  const fired = useRef(false)
  const fire = () => {
    if (fired.current) return
    fired.current = true
    try { onReady?.() } catch {}
  }
  useEffect(() => {
    const t = setTimeout(fire, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!info?.matrix || !uri || !(width > 0) || !(height > 0)) return null
  // Soft focus (Glam): a blurred copy of the graded photo mixed back in (bloom without losing
  // the detail underneath).
  const soft = Number.isFinite(info.soft) ? Math.max(0, Math.min(0.8, info.soft)) : 0
  const blur = Math.max(2, Math.round(Math.min(width, height) * 0.008))
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          {soft > 0 ? (
            <Filter id="grade" x="0" y="0" width="100%" height="100%">
              <FeColorMatrix in="SourceGraphic" type="matrix" values={info.matrix} result="graded" />
              <FeGaussianBlur in="graded" stdDeviation={blur} edgeMode="duplicate" result="soft" />
              <FeComposite in="graded" in2="soft" operator="arithmetic" k1={0} k2={1 - soft} k3={soft} k4={0} />
            </Filter>
          ) : (
            <Filter id="grade">
              <FeColorMatrix type="matrix" values={info.matrix} />
            </Filter>
          )}
        </Defs>
        <SvgImage
          x={0}
          y={0}
          width={width}
          height={height}
          href={{ uri }}
          preserveAspectRatio="xMidYMid slice"
          filter="url(#grade)"
          onLoad={fire}
        />
      </Svg>
      <Vignette strength={info.vignette} />
    </View>
  )
}

function fmtDate(d) {
  try {
    const m = translate(camStrings, 'months').split(',')[d.getMonth()]
    return `${m} ${d.getDate()} ${d.getFullYear()}`
  } catch {
    return ''
  }
}

// The iYiYi post frame: a fine inset keyline with soft top / bottom fades and, on the photo,
// the @handle, date and (if allowed) city in the bottom-left. The iY watermark stays in the
// bottom-right corner. Live it shows only the keyline so it doesn't fight the controls.
export function FrameOverlay({ live = true, handle, place, date }) {
  const label = typeof handle === 'string' && handle ? handle : '@iyiyi'
  const sub = [fmtDate(date instanceof Date ? date : new Date()), typeof place === 'string' && place ? place.toUpperCase() : null]
    .filter(Boolean)
    .join('  ·  ')
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {!live && (
        <>
          <LinearGradient colors={['rgba(0,0,0,0.32)', 'rgba(0,0,0,0)']} style={styles.fadeTop} />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)']} style={styles.fadeBottom} />
        </>
      )}
      <View style={[styles.keyline, live && styles.keylineLive]} />
      <View style={[styles.corner, styles.cTL]} />
      <View style={[styles.corner, styles.cTR]} />
      <View style={[styles.corner, styles.cBL]} />
      <View style={[styles.corner, styles.cBR]} />
      {!live && (
        <>
          <View style={styles.brandTop}>
            <Image source={IY_LOGO} style={styles.brandLogo} resizeMode="contain" fadeDuration={0} />
            <Text style={styles.brandText}>iYiYi</Text>
          </View>
          <View style={styles.caption}>
            <Text style={styles.captionName} numberOfLines={1}>{label}</Text>
            {sub ? <Text style={styles.captionSub} numberOfLines={1}>{sub}</Text> : null}
          </View>
        </>
      )}
    </View>
  )
}

const INSET = 10
const C = 16
const styles = StyleSheet.create({
  fadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 90 },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  keyline: {
    position: 'absolute', left: INSET, right: INSET, top: INSET, bottom: INSET, borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
  },
  keylineLive: { borderColor: 'rgba(255,255,255,0.4)' },
  corner: { position: 'absolute', width: C, height: C, borderColor: '#ffffff' },
  cTL: { left: INSET - 2, top: INSET - 2, borderLeftWidth: 2.5, borderTopWidth: 2.5, borderTopLeftRadius: 18 },
  cTR: { right: INSET - 2, top: INSET - 2, borderRightWidth: 2.5, borderTopWidth: 2.5, borderTopRightRadius: 18 },
  cBL: { left: INSET - 2, bottom: INSET - 2, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderBottomLeftRadius: 18 },
  cBR: { right: INSET - 2, bottom: INSET - 2, borderRightWidth: 2.5, borderBottomWidth: 2.5, borderBottomRightRadius: 18 },
  brandTop: { position: 'absolute', top: INSET + 12, left: INSET + 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandLogo: { width: 20, height: 16 },
  brandText: {
    color: '#ffffff', fontSize: 12, fontWeight: '900', letterSpacing: 1.6,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3,
  },
  caption: { position: 'absolute', left: INSET + 14, bottom: INSET + 14, right: 96 },
  captionName: {
    color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
  },
  captionSub: {
    color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
  },
})
