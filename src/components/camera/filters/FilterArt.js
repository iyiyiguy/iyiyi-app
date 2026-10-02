import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { OVERLAY_BOX } from '../../../lib/cameraFilters'
import Logo3D, { LOGO3D_H, LOGO3D_W } from './Logo3D'

// The three AR filter graphics. Each draws inside an OVERLAY_BOX square with its visual anchor
// at the bottom-center of the box (that point sits just above the person's head; the layers
// scale and roll the box about it). `live` = over the preview; otherwise a still for baking
// into a photo.
//
// Art (art/*.png) is rendered on Higgsfield and dropped in by CI; the files in the repo are
// simple placeholders with the same names. Sizes come from the actual PNGs at runtime, so
// replacements with a different aspect ratio still fit.

export const IY_LOGO = require('./iy-logo.png')
const ART = {
  nametag: require('./art/nametag-glass.png'),
  bubble: require('./art/bubble-iloveyou.png'),
  logo: require('./art/iy-logo-render.png'),
}
function aspectOf(src, fallback) {
  try {
    const a = Image.resolveAssetSource(src)
    const r = a && a.width > 0 && a.height > 0 ? a.width / a.height : 0
    return Number.isFinite(r) && r > 0.2 && r < 8 ? r : fallback
  } catch {
    return fallback
  }
}
const NAMETAG_W = 150
const NAMETAG_H = Math.round(NAMETAG_W / aspectOf(ART.nametag, 600 / 170))
const BUBBLE_W = 150
const BUBBLE_H = Math.round(BUBBLE_W / aspectOf(ART.bubble, 560 / 340))
const LOGO_W = 112
const LOGO_H = Math.round(LOGO_W / aspectOf(ART.logo, 253 / 217))

// Starts a looping animation only while `live`; always stops it on unmount.
function useLoop(make, live) {
  useEffect(() => {
    if (!live) return undefined
    let anim = null
    try {
      anim = make()
      anim.start()
    } catch {
      anim = null
    }
    return () => { try { anim?.stop() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])
}
const useFloat = (live, px, ms) => {
  const v = useRef(new Animated.Value(0)).current
  useLoop(() => Animated.loop(Animated.sequence([
    Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
  ])), live)
  return v.interpolate({ inputRange: [0, 1], outputRange: [0, -px] })
}

// --- iY emblem ------------------------------------------------------------------------------
// Primary person, live: Logo3D (three.js in a WebView) turning exactly with the head.
// Everyone else / until WebGL is up / baked photos: the photoreal render (art/iy-logo-render.png)
// given a perspective hint - live it turns with the smoothed head yaw (rotateY), in a photo it
// is squashed by cos(yaw). Roll comes from the layer, which rotates the whole overlay.
// Under it, a small glossy "iYiYi" wordmark so people seeing the photo elsewhere know it.
function LogoRender({ live = true, onReady, pose, yawAnim }) {
  const lift = useFloat(live, 4, 1300)
  const ready = useRef(false)
  const fire = () => {
    if (ready.current) return
    ready.current = true
    try { onReady?.() } catch {}
  }
  let transform
  if (live && yawAnim) {
    transform = [
      { translateY: lift },
      { perspective: 600 },
      { rotateY: yawAnim.interpolate({ inputRange: [-Math.PI, Math.PI], outputRange: ['-180deg', '180deg'] }) },
    ]
  } else {
    const yaw = Number(pose?.yaw)
    const squash = Number.isFinite(yaw) ? Math.max(0.35, Math.cos(Math.max(-1.2, Math.min(1.2, yaw)))) : 1
    transform = [{ scaleX: squash }]
  }
  return (
    <View style={styles.logoArea} pointerEvents="none">
      <Animated.Image
        source={ART.logo}
        style={[styles.logoImg, { transform }]}
        resizeMode="contain"
        fadeDuration={0}
        onLoad={fire}
        onError={fire}
      />
    </View>
  )
}

function IYWordmark() {
  return (
    <View style={styles.wordShadow}>
      <View style={styles.wordPill}>
        <LinearGradient
          colors={['rgba(255,80,220,0.55)', 'rgba(90,40,200,0.55)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.wordText}>iYiYi</Text>
      </View>
    </View>
  )
}

export function IYLogo3D({ live = true, onReady, pose, use3D = false, registerPose, yawAnim }) {
  return (
    <View style={styles.box} pointerEvents="none">
      {live && use3D ? (
        <Logo3D registerPose={registerPose} fallback={<LogoRender live onReady={onReady} />} />
      ) : (
        <LogoRender live={live} onReady={onReady} pose={pose} yawAnim={yawAnim} />
      )}
      <IYWordmark />
    </View>
  )
}

// --- Name tag ---------------------------------------------------------------------------------
// The glass pill render with the person's @name centred on it, shrunk to fit.
export function NameTag({ name, live = true, onReady }) {
  const enter = useRef(new Animated.Value(live ? 0 : 1)).current
  const lift = useFloat(live, 3, 1600)
  const fired = useRef(false)
  const fire = () => {
    if (fired.current) return
    fired.current = true
    try { onReady?.() } catch {}
  }
  useEffect(() => {
    if (live) Animated.spring(enter, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] })
  const label = typeof name === 'string' && name ? name : '@iyiyi'
  return (
    <Animated.View style={[styles.box, { transform: [{ translateY: lift }, { scale }] }]} pointerEvents="none">
      <View style={styles.tagWrap}>
        <Image source={ART.nametag} style={styles.tagImg} resizeMode="stretch" fadeDuration={0} onLoad={fire} onError={fire} />
        <View style={styles.tagTextWrap}>
          <Text style={styles.tagName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{label}</Text>
        </View>
      </View>
    </Animated.View>
  )
}

// --- "I love you" ------------------------------------------------------------------------------
export function LoveBubble({ live = true, onReady }) {
  const pop = useRef(new Animated.Value(live ? 0 : 1)).current
  const lift = useFloat(live, 4, 1400)
  const fired = useRef(false)
  const fire = () => {
    if (fired.current) return
    fired.current = true
    try { onReady?.() } catch {}
  }
  useEffect(() => {
    if (live) Animated.spring(pop, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }).start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] })
  return (
    <Animated.View style={[styles.box, { opacity: pop, transform: [{ translateY: lift }, { scale }] }]} pointerEvents="none">
      <Image source={ART.bubble} style={styles.bubbleImg} resizeMode="contain" fadeDuration={0} onLoad={fire} onError={fire} />
    </Animated.View>
  )
}

export function FilterArt({ filter, name, live = true, onReady, pose, use3D, registerPose, yawAnim }) {
  if (filter === 'logo') {
    return <IYLogo3D live={live} onReady={onReady} pose={pose} use3D={use3D} registerPose={registerPose} yawAnim={yawAnim} />
  }
  if (filter === 'nametag') return <NameTag name={name} live={live} onReady={onReady} />
  if (filter === 'love') return <LoveBubble live={live} onReady={onReady} />
  return null
}

const styles = StyleSheet.create({
  box: { width: OVERLAY_BOX, height: OVERLAY_BOX, alignItems: 'center', justifyContent: 'flex-end' },

  logoArea: { width: LOGO3D_W, height: LOGO3D_H, alignItems: 'center', justifyContent: 'center' },
  logoImg: { width: LOGO_W, height: LOGO_H },
  wordShadow: {
    marginTop: -6, marginBottom: 2, borderRadius: 9,
    shadowColor: '#ff2bd6', shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  wordPill: {
    borderRadius: 9, paddingHorizontal: 9, paddingVertical: 2, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(30,10,50,0.35)',
  },
  wordText: {
    color: '#ffffff', fontSize: 11, fontWeight: '900', letterSpacing: 0.8,
    textShadowColor: 'rgba(60,0,60,0.5)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },

  tagWrap: { width: NAMETAG_W, height: NAMETAG_H, marginBottom: 4 },
  tagImg: { position: 'absolute', left: 0, top: 0, width: NAMETAG_W, height: NAMETAG_H },
  tagTextWrap: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: NAMETAG_H * 0.45,
  },
  tagName: {
    color: '#ffffff', fontSize: 17, fontWeight: '800', textAlign: 'center', alignSelf: 'stretch',
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 },
  },

  bubbleImg: { width: BUBBLE_W, height: BUBBLE_H, marginBottom: 2 },
})
