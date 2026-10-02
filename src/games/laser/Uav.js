// Laser Tag UAV UI: the glassy HUD button, the in-game "Get more" sheet, the Shop card,
// and the minimap radar sweep. Purchase logic lives in src/lib/uav.js + src/lib/iap.js.
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Glass from '../../components/Glass'
import { AC } from '../arcadeUI'
import { UavPackCard, UavStorePanel, useUavBuyFlow } from '../UavStore'
import { buzz } from '../../lib/gamePrefs'
import { UAV_DURATION_MS } from '../../lib/uav'
import { font } from '../../theme'

const UAV_RED = '#ff3b4f'

/**
 * Round translucent satellite button with a count badge. While a UAV is active it shows
 * the seconds left and is disabled (UAVs don't stack).
 * count: number | '∞'. activeMsLeft: ms left on my UAV (0 when idle).
 */
export const UavButton = React.memo(function UavButton({ count, activeMsLeft = 0, disabled, onPress, size = 54 }) {
  const active = activeMsLeft > 0
  const empty = count === 0
  const secs = Math.max(0, Math.ceil(activeMsLeft / 1000))
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || active}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
      accessibilityRole="button"
      accessibilityLabel={active ? `UAV online, ${secs} seconds left` : empty ? 'UAV. None left — get more' : `Call in UAV. ${count === '∞' ? 'Unlimited' : count} available`}
      accessibilityState={{ disabled: !!disabled || active }}
    >
      <Glass scheme="dark" radius={size / 2} shadow={false} interactive style={{ width: size, height: size }}>
        <View style={[st.btnInner, { width: size, height: size, borderRadius: size / 2 }, active && st.btnActive]}>
          {active ? (
            <Text style={st.btnSecs}>{secs}</Text>
          ) : (
            <MaterialCommunityIcons name="satellite-variant" size={size * 0.46} color={empty ? 'rgba(255,255,255,0.55)' : '#fff'} />
          )}
        </View>
      </Glass>
      {!active && (
        <View style={[st.badge, empty && st.badgeEmpty]} pointerEvents="none">
          <Text style={st.badgeText}>{empty ? '+' : count}</Text>
        </View>
      )}
    </Pressable>
  )
})

/** Small "Enemy UAV overhead" pill shown while an enemy UAV is active. */
export function EnemyUavPill({ msLeft, top }) {
  if (!(msLeft > 0)) return null
  return (
    <View style={[st.enemyPill, { top }]} pointerEvents="none">
      <MaterialCommunityIcons name="satellite-variant" size={13} color="#fff" />
      <Text style={st.enemyPillText}>Enemy UAV overhead · {Math.ceil(msLeft / 1000)}s</Text>
    </View>
  )
}

/** Rotating radar sweep drawn over the (circular) minimap while a UAV is active. */
export function RadarSweep({ size }) {
  const spin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [spin])
  const half = size / 2
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: half, overflow: 'hidden' }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,40,60,0.08)' }]} />
      <Animated.View style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}>
        {/* Trailing glow: the quadrant behind the leading edge (centre → 12 o'clock). */}
        <LinearGradient
          colors={['rgba(255,59,79,0)', 'rgba(255,59,79,0.38)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0.55 }}
          style={{ position: 'absolute', left: 0, top: 0, width: half, height: half }}
        />
        <View style={{ position: 'absolute', left: half - 1, top: 0, width: 2, height: half, backgroundColor: 'rgba(255,90,100,0.9)' }} />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { borderRadius: half, borderWidth: 2, borderColor: 'rgba(255,59,79,0.8)' }]} />
    </View>
  )
}

/** Pulsing red enemy dot (UAV reveal) for map markers. */
export function PulseDot({ ring }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] })
  return (
    <View style={st.pulseWrap}>
      <Animated.View style={[st.pulseHalo, { opacity, transform: [{ scale }] }]} />
      <View style={[st.pulseCore, ring && { borderColor: '#ffc94d', borderWidth: 3 }]} />
    </View>
  )
}

/** Fading red "shot fired" ping marker. */
export function ShotPing() {
  return (
    <View style={st.pingWrap}>
      <View style={st.pingRing} />
      <View style={st.pingCore} />
    </View>
  )
}

/** In-game store sheet (plain overlay, not a Modal — the match keeps running). */
export function UavSheet(props) {
  if (!props.visible) return null
  return <UavSheetBody {...props} />
}

function UavSheetBody({ onClose, balance, owner, freeLeft, insets }) {
  return (
    <View style={[StyleSheet.absoluteFill, st.sheetRoot]}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheetWrap, { paddingBottom: (insets?.bottom || 0) + 10 }]} pointerEvents="box-none">
        <LinearGradient colors={['#141a36', '#0b0d1c']} style={st.sheet}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>UAV Store</Text>
            <Pressable onPress={onClose} hitSlop={10} style={st.close} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
            <UavStorePanel variant="sheet" balance={balance} owner={owner} freeLeft={freeLeft} />
          </ScrollView>
        </LinearGradient>
      </View>
    </View>
  )
}

/** Shop card: the 20-pack plus a link to the full Arcade Store. */
export function UavShopCard({ balance, owner, onOpenStore }) {
  const flow = useUavBuyFlow()
  const pack = flow.packs.find((p) => p.id === 'uav20') || flow.packs[0]
  return (
    <Glass scheme="dark" radius={24} shadow={false} style={st.card}>
      <View style={st.cardHead}>
        <View style={{ width: 150 }}>
          {pack && (
            <UavPackCard pack={pack} compact busy={flow.busySku === pack.sku} disabled={owner} onBuy={flow.run} />
          )}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={st.cardTitle}>UAVs</Text>
          <Text style={st.cardMeta}>Reveal every enemy on your map for {Math.round(UAV_DURATION_MS / 1000)}s in Laser Tag and Battle Royale. 1 free every match.</Text>
          <Text style={st.cardBal}>{owner ? 'Unlimited (owner)' : `Balance: ${balance}`}</Text>
          <Pressable onPress={onOpenStore} style={({ pressed }) => [st.storeLink, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Open the Arcade Store">
            <Text style={st.storeLinkText}>All packs</Text>
            <Ionicons name="chevron-forward" size={14} color="#fff" />
          </Pressable>
        </View>
      </View>
      {!!flow.note && <Text style={[st.note, { textAlign: 'left' }]}>{flow.note.text}</Text>}
    </Glass>
  )
}

const st = StyleSheet.create({
  btnInner: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  btnActive: { backgroundColor: 'rgba(255,59,79,0.35)', borderColor: UAV_RED },
  btnSecs: { fontSize: 18, ...font.heavy, color: '#fff' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: UAV_RED, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  badgeEmpty: { backgroundColor: '#4a4f6a' },
  badgeText: { fontSize: 11, ...font.heavy, color: '#fff' },
  enemyPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(212,32,47,0.85)' },
  enemyPillText: { fontSize: 12, ...font.heavy, color: '#fff' },
  pulseWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  pulseHalo: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: UAV_RED },
  pulseCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: UAV_RED, borderWidth: 2, borderColor: '#fff' },
  pingWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pingRing: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: UAV_RED },
  pingCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: UAV_RED },
  sheetRoot: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: { padding: 16, gap: 12, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,59,79,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { flex: 1, fontSize: 20, ...font.heavy, color: AC.text },
  sheetSub: { fontSize: 13, color: AC.muted, marginTop: 2 },
  sheetBal: { fontSize: 14, ...font.bold, color: AC.text },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, color: AC.muted, textAlign: 'center' },
  card: { padding: 16, gap: 14, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, ...font.bold, color: AC.text },
  cardMeta: { fontSize: 12, color: AC.muted, marginTop: 3 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBal: { fontSize: 14, ...font.heavy, color: AC.gold },
  storeLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  storeLinkText: { fontSize: 13, ...font.bold, color: '#fff' },
})
