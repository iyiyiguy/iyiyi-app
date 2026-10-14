import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native'

const OUTER = 80
const INNER = 64

// iOS-style shutter: white disc for photos, red disc for video, which shrinks to a rounded
// red square while recording. ringOnly (photo mode with a lens on): just the ring, so the lens
// preview in the carousel shows through the middle, Snapchat-style.
export default function Shutter({ mode, recording, busy, onPress, disabled, ringOnly = false }) {
  const rec = useRef(new Animated.Value(recording ? 1 : 0)).current
  const press = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.timing(rec, {
      toValue: recording ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start()
  }, [recording, rec])

  const size = rec.interpolate({ inputRange: [0, 1], outputRange: [INNER, 30] })
  const radius = rec.interpolate({ inputRange: [0, 1], outputRange: [INNER / 2, 8] })
  const isVideo = mode === 'video'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => Animated.spring(press, { toValue: 0.92, useNativeDriver: true, speed: 40 }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 30 }).start()}
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop recording' : isVideo ? 'Record video' : 'Take photo'}
      hitSlop={8}
    >
      <Animated.View style={[styles.outer, ringOnly && styles.outerRing, { transform: [{ scale: press }] }, busy && { opacity: 0.6 }]}>
        <View style={styles.innerSlot}>
          <Animated.View
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: isVideo ? '#ff3b30' : ringOnly ? 'transparent' : '#fff',
            }}
          />
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  outer: {
    width: OUTER, height: OUTER, borderRadius: OUTER / 2, borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
  },
  outerRing: { borderWidth: 5, backgroundColor: 'rgba(255,255,255,0.06)' },
  innerSlot: { width: INNER, height: INNER, alignItems: 'center', justifyContent: 'center' },
})
