import React, { useEffect, useRef } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../Glass'
import { MODE_ACTIVE_COLOR } from './ModeSwitcher'
import { FIRST_USE_TIPS, HELP_TOPICS } from '../../lib/cameraPrefs'

// Small round "?" that opens the help sheet. Lives beside the options bar.
export function HelpButton({ onPress, disabled }) {
  return (
    <Pressable
      onPress={() => { try { onPress?.() } catch {} }}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => [styles.helpBtn, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel="How the camera options work"
    >
      <Ionicons name="help" size={14} color="rgba(255,255,255,0.9)" />
    </Pressable>
  )
}

// Compact glass list explaining every camera control in a line each. Tap a row to reopen
// its full tip; tap outside (or the X) to close.
export default function CameraHelpSheet({ visible, onClose, onOpenTip }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!visible) return
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
  }, [visible, anim])
  if (!visible) return null

  const close = () => { try { onClose?.() } catch {} }
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })
  const topics = HELP_TOPICS.filter((t) => t && FIRST_USE_TIPS[t.id])
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close help" />
      <Animated.View style={[styles.sheetWrap, { opacity: anim, transform: [{ translateY }] }]}>
        <Glass scheme="dark" strong radius={22} style={styles.sheet} contentStyle={{ flexShrink: 1 }}>
          <View style={styles.header}>
            <Text style={styles.heading}>Camera help</Text>
            <Pressable onPress={close} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close help">
              <Ionicons name="close" size={15} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
            {topics.map((t) => {
              const tip = FIRST_USE_TIPS[t.id]
              return (
                <Pressable
                  key={t.id}
                  onPress={() => { try { onOpenTip?.(t.id) } catch {} }}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${tip.title}. ${t.short} Tap for more.`}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={tip.icon || 'information-circle-outline'} size={15} color={MODE_ACTIVE_COLOR} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{tip.title}</Text>
                    <Text style={styles.short} numberOfLines={2}>{t.short}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
                </Pressable>
              )
            })}
          </ScrollView>
          <Text style={styles.foot}>Tap a row for more · tap outside to close</Text>
        </Glass>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  helpBtn: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(30,30,50,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 49,
  },
  sheetWrap: { width: '88%', maxWidth: 360, maxHeight: '82%' },
  sheet: { paddingTop: 12, paddingBottom: 10, paddingHorizontal: 8, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 4 },
  heading: { color: '#fff', fontSize: 15, fontWeight: '700' },
  close: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12 },
  iconWrap: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,214,10,0.14)',
  },
  title: { color: '#fff', fontSize: 13, fontWeight: '700' },
  short: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 16 },
  foot: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 6 },
})
