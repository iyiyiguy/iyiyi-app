// Laser Tag UAV UI: the glassy HUD button, the in-game "Get more" sheet, the Shop card,
// and the minimap radar sweep. Purchase logic lives in src/lib/uav.js + src/lib/iap.js.
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { HUD, hudSheet, hudType } from './HudPro'
import Glass from '../../components/Glass'
import { AC } from '../arcadeUI'
import { UavPackCard, UavStorePanel, useUavBuyFlow } from '../UavStore'
import { buzz } from '../../lib/gamePrefs'
import { UAV_DURATION_MS } from '../../lib/uav'
import { uavRulesText } from './uavText'
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'
import LT from '../../i18n/strings/laserTag'

const tr = (k, v) => translate(H, k, v)
import { font } from '../../theme'
import { EquipTileFace } from './Consumables'
import { FONT, ST } from '../studio'

const UAV_RED = '#ff3b4f'

/**
 * Round translucent satellite button with a count badge. While a UAV is active it shows
 * the seconds left and is disabled (UAVs don't stack). During the cooldown between UAVs
 * (lib/uav UAV_COOLDOWN_MS) it is dimmed with the seconds left; a tap explains why.
 * count: number | '∞'. activeMsLeft: ms left on my UAV (0 when idle).
 * cooldownMsLeft: ms until the next UAV can be called (0 = ready).
 */
export const UavButton = React.memo(function UavButton({ count, activeMsLeft = 0, cooldownMsLeft = 0, disabled, onPress, size = 54, tile = false }) {
  const active = activeMsLeft > 0
  const cooling = !active && cooldownMsLeft > 0
  const empty = count === 0
  const secs = Math.max(0, Math.ceil(activeMsLeft / 1000))
  const cdSecs = Math.max(0, Math.ceil(cooldownMsLeft / 1000))
  const a11y = active
    ? tr('uav_online_a11y', { n: secs })
    : cooling
      ? tr('uav_recharging_a11y', { n: cdSecs })
      : empty ? tr('uav_none_a11y') : tr('uav_call_a11y', { n: count === '∞' ? tr('unlimited') : count })
  if (tile) {
    // Studio kit square (Laser Tag HUD): objective-coloured, count in the corner.
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || active}
        hitSlop={4}
        style={({ pressed }) => pressed && { transform: [{ scale: 0.94 }] }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ disabled: !!disabled || active }}
      >
        <EquipTileFace kind="uav" label={active ? `${secs}S` : cooling ? `${cdSecs}S` : 'UAV'} size={size} accent={empty || cooling ? null : active ? ST.enemy : ST.objective} dim={!!disabled || empty || cooling} />
        {!active && !cooling ? (
          <View style={[st.tileBadge, empty && { backgroundColor: 'rgba(255,255,255,0.3)' }]} pointerEvents="none">
            <Text style={st.tileBadgeText}>{empty ? '+' : count}</Text>
          </View>
        ) : null}
      </Pressable>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || active}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled || active }}
    >
      <Glass scheme="dark" radius={size / 2} shadow={false} interactive style={{ width: size, height: size }}>
        <View style={[st.btnInner, { width: size, height: size, borderRadius: size / 2 }, active && st.btnActive]}>
          {active ? (
            <Text style={st.btnSecs}>{secs}</Text>
          ) : cooling ? (
            <Text style={[st.btnSecs, { color: 'rgba(255,255,255,0.55)', fontSize: 15 }]}>{cdSecs}s</Text>
          ) : (
            <MaterialCommunityIcons name="satellite-variant" size={size * 0.46} color={empty ? 'rgba(255,255,255,0.55)' : '#fff'} />
          )}
        </View>
      </Glass>
      {!active && !cooling && (
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
      <MaterialCommunityIcons name="satellite-variant" size={14} color={ST.enemy} />
      <Text style={st.enemyPillText}>{translate(LT, 'enemy_uav', { n: Math.ceil(msLeft / 1000) })}</Text>
    </View>
  )
}

/** Rotating radar sweep drawn over the (circular) minimap while a UAV is active. */
export function RadarSweep({ size, square = false }) {
  const spin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [spin])
  const half = size / 2
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: square ? ST.radius : half, overflow: 'hidden' }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,40,60,0.08)' }]} />
      <Animated.View style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }, ...(square ? [{ scale: 1.42 }] : [])] }}>
        {/* Trailing glow: the quadrant behind the leading edge (centre → 12 o'clock). */}
        <LinearGradient
          colors={['rgba(255,59,79,0)', 'rgba(255,59,79,0.38)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0.55 }}
          style={{ position: 'absolute', left: 0, top: 0, width: half, height: half }}
        />
        <View style={{ position: 'absolute', left: half - 1, top: 0, width: 2, height: half, backgroundColor: 'rgba(255,90,100,0.9)' }} />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { borderRadius: square ? ST.radius : half, borderWidth: square ? 1 : 2, borderColor: 'rgba(255,59,79,0.8)' }]} />
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
  const { height: winH } = useWindowDimensions()
  const maxH = Math.max(200, Math.min(560, winH - (insets?.top || 0) - (insets?.bottom || 0) - 120))
  return (
    <View style={[StyleSheet.absoluteFill, st.sheetRoot]}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('close')} />
      <View style={[st.sheetWrap, { paddingBottom: (insets?.bottom || 0) + 10 }]} pointerEvents="box-none">
        <View style={[st.sheet, hudSheet, { borderTopWidth: 2, borderTopColor: HUD.accent }]}>
          <View style={st.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={hudType.kicker}>{tr('killstreak')}</Text>
              <Text style={st.sheetTitle}>{tr('uav_store')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={st.close} accessibilityRole="button" accessibilityLabel={tr('close')}>
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: maxH }} showsVerticalScrollIndicator={false}>
            <UavStorePanel variant="sheet" balance={balance} owner={owner} freeLeft={freeLeft} />
          </ScrollView>
        </View>
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
          <Text style={st.cardTitle}>{tr('uavs')}</Text>
          <Text style={st.cardMeta}>{tr('uav_reveal', { n: Math.round(UAV_DURATION_MS / 1000) })} {uavRulesText()}</Text>
          <Text style={st.cardBal}>{owner ? tr('unlimited_owner') : tr('balance', { n: balance })}</Text>
          <Pressable onPress={onOpenStore} style={({ pressed }) => [st.storeLink, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={tr('open_store_a11y')}>
            <Text style={st.storeLinkText}>{tr('all_packs')}</Text>
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
  enemyPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 6, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.8)', borderLeftWidth: 3, borderLeftColor: ST.enemy },
  enemyPillText: { fontFamily: FONT.ui, fontSize: 11.5, letterSpacing: 1.4, color: '#fff' },
  tileBadge: { position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 2, backgroundColor: ST.objective, alignItems: 'center', justifyContent: 'center' },
  tileBadgeText: { fontFamily: FONT.display, fontSize: 9.5, lineHeight: 12, color: ST.ink, includeFontPadding: false },
  pulseWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  pulseHalo: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: UAV_RED },
  pulseCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: UAV_RED, borderWidth: 2, borderColor: '#fff' },
  pingWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pingRing: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: UAV_RED },
  pingCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: UAV_RED },
  sheetRoot: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: { padding: 16, gap: 12, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,59,79,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { ...hudType.title },
  sheetSub: { fontSize: 13, color: AC.muted, marginTop: 2 },
  sheetBal: { fontSize: 14, ...font.bold, color: AC.text },
  close: { width: 40, height: 40, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
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
