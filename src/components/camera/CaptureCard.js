import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useVideoPlayer, VideoView } from 'expo-video'

export const CARD_W = 64
export const CARD_H = 86
const BAR_W = CARD_W - 12

function VideoThumb({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    try {
      p.muted = true
      p.loop = true
      p.play()
    } catch {}
  })
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
}

// A just-captured photo / video / burst hovering at the top of the camera: it pops in, a bar
// drains over `durationMs`, then the card flies up and away and onExpire fires (that's when
// the upload starts). The X cancels just this one.
export default function CaptureCard({ item, durationMs = 5000, onExpire, onCancel }) {
  const progress = useRef(new Animated.Value(0)).current
  const enter = useRef(new Animated.Value(0)).current
  const leave = useRef(new Animated.Value(0)).current // 0 = here, 1 = flown off
  const poof = useRef(new Animated.Value(0)).current // 0 = here, 1 = cancelled away
  const done = useRef(false)
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(durationMs / 1000))

  useEffect(() => {
    let alive = true
    Animated.spring(enter, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start()
    const run = Animated.timing(progress, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true })
    run.start(({ finished }) => {
      if (!finished || !alive || done.current) return
      done.current = true
      Animated.parallel([
        Animated.timing(leave, { toValue: 1, duration: 420, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => {
        if (alive) onExpire?.(item.id)
      })
    })
    const startedAt = Date.now()
    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((durationMs - (Date.now() - startedAt)) / 1000))
      setSecondsLeft(left)
      if (left <= 0) clearInterval(tick)
    }, 250)
    return () => {
      alive = false
      clearInterval(tick)
      run.stop()
    }
    // item.id is stable for the life of the card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = () => {
    if (done.current) return
    done.current = true
    progress.stopAnimation()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    Animated.timing(poof, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      onCancel?.(item.id)
    })
  }

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] })
  const leaveY = leave.interpolate({ inputRange: [0, 1], outputRange: [0, -150] })
  const leaveScale = leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] })
  const leaveRotate = leave.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-8deg'] })
  const poofScale = poof.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] })
  const opacity = Animated.multiply(
    leave.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }),
    poof.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  )
  const barX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -BAR_W] })

  const isBurst = item.type === 'burst'
  const count = isBurst ? item.shots?.length ?? 0 : 0

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity,
          transform: [
            { translateY: Animated.add(enterY, leaveY) },
            { scale: Animated.multiply(Animated.multiply(enterScale, leaveScale), poofScale) },
            { rotate: leaveRotate },
          ],
        },
      ]}
    >
      {isBurst && (
        <>
          <View style={[styles.stackEdge, { transform: [{ translateX: 5 }, { translateY: -5 }, { rotate: '5deg' }] }]} />
          <View style={[styles.stackEdge, { transform: [{ translateX: 2.5 }, { translateY: -2.5 }, { rotate: '2.5deg' }] }]} />
        </>
      )}
      <View style={styles.card}>
        {item.type === 'video'
          ? <VideoThumb uri={item.uri} />
          : <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
        <View style={styles.shade} pointerEvents="none" />

        {item.type === 'video' && (
          <View style={styles.kindBadge} pointerEvents="none">
            <Ionicons name="videocam" size={10} color="#fff" />
          </View>
        )}
        {isBurst && (
          <View style={styles.kindBadge} pointerEvents="none">
            <Ionicons name="albums" size={10} color="#fff" />
            <Text style={styles.kindText}>{count}</Text>
          </View>
        )}

        <Text style={styles.seconds} pointerEvents="none">{secondsLeft}</Text>

        <View style={styles.track} pointerEvents="none">
          <Animated.View style={[styles.bar, { transform: [{ translateX: barX }] }]} />
        </View>
      </View>

      <Pressable
        onPress={cancel}
        hitSlop={10}
        style={styles.cancel}
        accessibilityRole="button"
        accessibilityLabel={isBurst ? 'Cancel this burst' : 'Cancel this post'}
      >
        <Ionicons name="close" size={13} color="#fff" />
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: CARD_W + 8, height: CARD_H + 10, paddingTop: 8, paddingRight: 8 },
  card: {
    width: CARD_W, height: CARD_H, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)',
  },
  stackEdge: {
    position: 'absolute', top: 8, left: 0, width: CARD_W, height: CARD_H, borderRadius: 14,
    backgroundColor: 'rgba(40,46,70,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 30, backgroundColor: 'rgba(0,0,0,0.28)' },
  kindBadge: {
    position: 'absolute', top: 5, left: 5, flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  kindText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  seconds: {
    position: 'absolute', bottom: 11, right: 7, color: '#fff', fontSize: 11, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3,
  },
  track: {
    position: 'absolute', left: 6, right: 6, bottom: 6, height: 3.5, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden',
  },
  bar: { width: BAR_W, height: '100%', borderRadius: 2, backgroundColor: '#fff' },
  cancel: {
    position: 'absolute', top: 0, right: 0, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(20,22,34,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
})
