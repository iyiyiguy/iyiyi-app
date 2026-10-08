import { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native'
import { avatarSource } from '../lib/avatarSource'

// An original little penguin drawn with plain Views (no SVG dependency): navy body, white
// belly, orange beak + feet and a silver-blue scarf in the app's accent. It waddles (a gentle
// rock) and bobs on the native driver, with a random phase so a crowd doesn't move in sync.
// A small avatar/initial badge sits on its shoulder and the username floats underneath.
//
// Performance: on iOS (Apple Maps) custom marker children are live views, so the animation is
// cheap and doesn't need tracksViewChanges. Google-backed markers (Android) snapshot the view,
// so there we draw a still penguin and stop tracking view changes once the avatar has loaded.
// Callers pass animate={false} when many penguins are on screen.

const NAVY = '#1d2540'
const NAVY_HI = '#2b3660'
const BELLY = '#f6f8ff'
const BEAK = '#ffa53a'
const SCARF = '#5b6cf0'

function PenguinBody({ selected }) {
  return (
    <View style={styles.penguin}>
      {/* flippers */}
      <View style={[styles.flipper, styles.flipperLeft]} />
      <View style={[styles.flipper, styles.flipperRight]} />
      {/* body */}
      <View style={[styles.body, selected && styles.bodySelected]}>
        <View style={styles.bodySheen} />
        <View style={styles.belly} />
        {/* eyes */}
        <View style={[styles.eye, { left: 8 }]}><View style={styles.pupil} /></View>
        <View style={[styles.eye, { right: 8 }]}><View style={styles.pupil} /></View>
        {/* cheeks */}
        <View style={[styles.cheek, { left: 5 }]} />
        <View style={[styles.cheek, { right: 5 }]} />
        {/* beak */}
        <View style={styles.beak} />
        {/* scarf */}
        <View style={styles.scarf} />
        <View style={styles.scarfTail} />
      </View>
      {/* feet */}
      <View style={styles.feet}>
        <View style={styles.foot} />
        <View style={styles.foot} />
      </View>
    </View>
  )
}

function PenguinMarker({ username, avatarUrl, animate = true, selected = false, onReady }) {
  const anim = useRef(new Animated.Value(0)).current
  const [imgFailed, setImgFailed] = useState(false)
  const live = animate && Platform.OS === 'ios'

  useEffect(() => {
    if (!live) return undefined
    let loop
    // Random start offset so neighbouring penguins don't waddle in lockstep.
    const t = setTimeout(() => {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(anim, { toValue: -1, duration: 1040, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay(500 + Math.floor(Math.random() * 900)),
        ])
      )
      loop.start()
    }, Math.floor(Math.random() * 1200))
    return () => {
      clearTimeout(t)
      loop?.stop()
    }
  }, [live, anim])

  const rotate = anim.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] })
  const translateY = anim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1.5, -3, -1.5] })

  const initial = (String(username || '?').trim()[0] || '?').toUpperCase()
  const showImg = !imgFailed

  // No avatar to load -> the view is final right away.
  useEffect(() => {
    if (!showImg) onReady?.()
  }, [showImg, onReady])

  return (
    <View style={styles.wrap} collapsable={false}>
      <View style={styles.shadow} />
      <Animated.View style={live ? { transform: [{ translateY }, { rotate }] } : null}>
        <PenguinBody selected={selected} />
      </Animated.View>
      <View style={[styles.badge, selected && styles.badgeSelected]}>
        {showImg ? (
          <Image
            source={avatarSource(avatarUrl)}
            style={styles.badgeImg}
            onLoadEnd={() => onReady?.()}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Text style={styles.badgeInitial}>{initial}</Text>
        )}
      </View>
      {username ? (
        <View style={[styles.label, selected && styles.labelSelected]}>
          <Text style={[styles.labelText, selected && styles.labelTextSelected]} numberOfLines={1}>{username}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default memo(PenguinMarker)

const styles = StyleSheet.create({
  wrap: { width: 92, alignItems: 'center', paddingTop: 6 },
  shadow: { position: 'absolute', top: 50, width: 30, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.22)' },
  penguin: { width: 44, height: 50, alignItems: 'center' },
  body: {
    width: 36, height: 44, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    backgroundColor: NAVY, overflow: 'hidden', borderWidth: 1.5, borderColor: '#ffffff',
  },
  bodySelected: { borderColor: SCARF, borderWidth: 2 },
  bodySheen: { position: 'absolute', top: 2, left: 4, width: 12, height: 18, borderRadius: 8, backgroundColor: NAVY_HI },
  belly: { position: 'absolute', bottom: -2, left: 5, right: 5, height: 30, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: BELLY },
  eye: { position: 'absolute', top: 9, width: 7, height: 8, borderRadius: 4, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  pupil: { width: 4, height: 5, borderRadius: 2.5, backgroundColor: '#10131f', marginTop: 1 },
  cheek: { position: 'absolute', top: 18, width: 5, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,140,170,0.55)' },
  beak: {
    position: 'absolute', top: 16, left: 13, width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: BEAK,
  },
  scarf: { position: 'absolute', top: 23, left: 0, right: 0, height: 4, backgroundColor: SCARF },
  scarfTail: { position: 'absolute', top: 25, right: 6, width: 4, height: 7, borderRadius: 1, backgroundColor: SCARF },
  flipper: { position: 'absolute', top: 16, width: 9, height: 20, borderRadius: 6, backgroundColor: NAVY, borderWidth: 1, borderColor: '#ffffff' },
  flipperLeft: { left: 1, transform: [{ rotate: '22deg' }] },
  flipperRight: { right: 1, transform: [{ rotate: '-22deg' }] },
  feet: { flexDirection: 'row', gap: 6, marginTop: -3 },
  foot: { width: 10, height: 5, borderRadius: 3, backgroundColor: BEAK },
  badge: {
    position: 'absolute', top: 0, left: 54, width: 22, height: 22, borderRadius: 11, overflow: 'hidden',
    backgroundColor: '#8fa2ff', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
  },
  badgeSelected: { borderColor: SCARF },
  badgeImg: { width: '100%', height: '100%' },
  badgeInitial: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  label: {
    marginTop: 2, maxWidth: 92, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(30,40,80,0.18)',
  },
  labelSelected: { backgroundColor: SCARF, borderColor: SCARF },
  labelText: { fontSize: 10, fontWeight: '700', color: '#151a2b' },
  labelTextSelected: { color: '#ffffff' },
})
