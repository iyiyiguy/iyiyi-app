import React, { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../Glass'
import { MODE_ACTIVE_COLOR } from './ModeSwitcher'

// A short friendly explainer shown the first time an option is turned on (or reopened from
// the "?" help). No button to hunt for: a tap anywhere - outside the card or on it - closes it,
// and there's a small X in the corner too.
export default function FirstUseTip({ tip, onClose }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!tip) return
    anim.setValue(0)
    Animated.spring(anim, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }).start()
  }, [tip, anim])
  if (!tip || typeof tip !== 'object') return null

  const close = () => { try { onClose?.() } catch {} }
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] })
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Dismiss tip" />
      <Animated.View style={{ opacity: anim, transform: [{ scale }], width: '84%', maxWidth: 340 }}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={`${tip.title || 'Tip'}. ${tip.body || ''} Tap to close.`}>
          <Glass scheme="dark" strong radius={24} style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name={tip.icon || 'information-circle-outline'} size={22} color={MODE_ACTIVE_COLOR} />
            </View>
            <Text style={styles.title}>{tip.title}</Text>
            <Text style={styles.body}>{tip.body}</Text>
            <Text style={styles.foot}>Tap anywhere to close</Text>
          </Glass>
        </Pressable>
        <Pressable onPress={close} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close tip">
          <Ionicons name="close" size={15} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 50,
  },
  card: { padding: 18, paddingTop: 16, alignItems: 'center' },
  close: {
    position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)',
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,214,10,0.14)', marginBottom: 10,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  body: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  foot: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600', marginTop: 12 },
})
