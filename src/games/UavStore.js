// The Arcade Store's UAV section — one component used full-page (ArcadeStoreScreen) and as
// an in-match bottom sheet (laser/Uav.js UavSheet). Pack cards are drawn entirely in code:
// a glowing satellite, ribbons for "Most popular" / "Best value", per-UAV price, savings
// and an animated shine. Purchases go through lib/uav.js useUavStore (consumable IAPs).
import React, { memo, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { AC } from './arcadeUI'
import { buzz } from '../lib/gamePrefs'
import { UAV_DURATION_MS, useUavStore } from '../lib/uav'
import { font } from '../theme'

export const FINE_PRINT = Platform.OS === 'android'
  ? 'Payment charged to your Google Play account. Consumable — not restorable.'
  : 'Payment charged to your Apple ID. Consumable — not restorable.'

// Per-tier palette: [card top, card bottom], glow, accent.
const TIERS = {
  uav5: { grad: ['#1b2447', '#11152c'], glow: 'rgba(124,140,255,0.45)', accent: '#8f9bff' },
  uav20: { grad: ['#3b1030', '#1a0b22'], glow: 'rgba(255,46,99,0.55)', accent: '#ff5d8a' },
  uav50: { grad: ['#3a2a06', '#1d1405'], glow: 'rgba(255,201,77,0.55)', accent: '#ffc94d' },
  uav120: { grad: ['#06303a', '#071a22'], glow: 'rgba(47,220,200,0.5)', accent: '#3fe0d0' },
}
const tierOf = (id) => TIERS[id] || TIERS.uav5

// ---------------------------------------------------------------------------
// Satellite art (pure Views)
// ---------------------------------------------------------------------------

export const SatelliteArt = memo(function SatelliteArt({ size = 84, accent = '#8f9bff', glow = 'rgba(124,140,255,0.45)', animated = true }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!animated) return undefined
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [animated, pulse])
  const u = size / 100
  const ring = (k) => ({
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55 - k * 0.15, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6 + k * 0.15, 1.15 + k * 0.15] }) }],
  })
  const panel = (left) => (
    <LinearGradient
      colors={['#5fb4ff', '#2a56c9']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ position: 'absolute', top: 40 * u, left, width: 30 * u, height: 20 * u, borderRadius: 2 * u, borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', overflow: 'hidden' }}
    >
      <View style={{ position: 'absolute', left: 10 * u, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      <View style={{ position: 'absolute', left: 20 * u, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      <View style={{ position: 'absolute', top: 10 * u, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.4)' }} />
    </LinearGradient>
  )
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={[st.glow, { width: size * 0.9, height: size * 0.9, borderRadius: size, left: size * 0.05, top: size * 0.05, backgroundColor: glow }]} />
      {[0, 1].map((k) => (
        <Animated.View key={k} style={[st.signal, { width: size * 0.7, height: size * 0.7, borderRadius: size, left: size * 0.15, top: size * 0.15, borderColor: accent }, ring(k)]} />
      ))}
      {/* arms */}
      <View style={{ position: 'absolute', top: 49 * u, left: 30 * u, width: 40 * u, height: 2 * u, backgroundColor: '#cfd6ee' }} />
      {panel(4 * u)}
      {panel(66 * u)}
      {/* body */}
      <LinearGradient colors={['#f4f6ff', '#9aa3c0']} style={{ position: 'absolute', top: 36 * u, left: 38 * u, width: 24 * u, height: 28 * u, borderRadius: 5 * u, borderWidth: 1, borderColor: '#fff' }} />
      <View style={{ position: 'absolute', top: 44 * u, left: 43 * u, width: 14 * u, height: 5 * u, borderRadius: 2 * u, backgroundColor: accent }} />
      {/* dish + antenna */}
      <View style={{ position: 'absolute', top: 20 * u, left: 39 * u, width: 22 * u, height: 11 * u, borderTopLeftRadius: 11 * u, borderTopRightRadius: 11 * u, backgroundColor: '#e7ebff', borderWidth: 1, borderColor: '#fff' }} />
      <View style={{ position: 'absolute', top: 30 * u, left: 49 * u, width: 2 * u, height: 7 * u, backgroundColor: '#cfd6ee' }} />
      <View style={{ position: 'absolute', top: 12 * u, left: 49 * u, width: 2 * u, height: 9 * u, backgroundColor: accent }} />
      <View style={{ position: 'absolute', top: 9 * u, left: 47 * u, width: 6 * u, height: 6 * u, borderRadius: 3 * u, backgroundColor: accent }} />
    </View>
  )
})

// Diagonal light sweep across a card (native-driver translateX loop).
function Shine({ width, delay = 0 }) {
  const x = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1800 + delay),
        Animated.timing(x, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [x, delay])
  const w = Math.max(60, width || 160)
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-w, w * 1.4] })
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { skewX: '-20deg' }] }]}>
      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: w * 0.45, height: '100%' }} />
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Pack card
// ---------------------------------------------------------------------------

export function UavPackCard({ pack, busy, disabled, onBuy, compact, index = 0, style }) {
  const tier = tierOf(pack.id)
  const [w, setW] = useState(0)
  const ready = pack.status === 'ready'
  const priceText = pack.status === 'loading' ? '…' : ready ? pack.displayPrice : 'Coming soon'
  const highlight = !!pack.ribbon
  return (
    <Pressable
      onPress={() => ready && !busy && !disabled && onBuy?.(pack)}
      disabled={!ready || busy || disabled}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={({ pressed }) => [st.cardOuter, { shadowColor: tier.accent }, highlight && st.cardOuterHi, pressed && { transform: [{ scale: 0.97 }] }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${pack.count} UAVs, ${ready ? pack.displayPrice : 'coming soon'}${pack.ribbon ? `, ${pack.ribbon}` : ''}`}
      accessibilityState={{ disabled: !ready || !!disabled, busy: !!busy }}
    >
      <LinearGradient colors={tier.grad} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={[st.card, { borderColor: highlight ? tier.accent : 'rgba(255,255,255,0.12)' }, compact && st.cardCompact]}>
        <Shine width={w} delay={index * 450} />
        {!!pack.ribbon && (
          <LinearGradient colors={pack.id === 'uav50' ? ['#ffd76a', '#ff9a3c'] : ['#ff5d8a', '#c2185b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.ribbon}>
            <Text style={[st.ribbonText, pack.id === 'uav50' && { color: '#3a2200' }]}>{pack.ribbon.toUpperCase()}</Text>
          </LinearGradient>
        )}
        <View style={st.artWrap}>
          <SatelliteArt size={compact ? 64 : 84} accent={tier.accent} glow={tier.glow} />
        </View>
        <Text style={[st.count, compact && { fontSize: 24 }]}>{pack.count}</Text>
        <Text style={[st.unit, { color: tier.accent }]}>UAVs</Text>
        <View style={st.metaRow}>
          {pack.savePct > 0 ? <View style={[st.save, { borderColor: tier.accent }]}><Text style={[st.saveText, { color: tier.accent }]}>SAVE {pack.savePct}%</Text></View> : <View style={st.savePlaceholder} />}
        </View>
        <Text style={st.per} numberOfLines={1}>{pack.perUav ? `${pack.perUav} per UAV` : ' '}</Text>
        <View style={[st.priceBtn, ready ? { backgroundColor: tier.accent } : st.priceBtnOff]}>
          {busy ? <ActivityIndicator size="small" color="#10121f" /> : <Text style={[st.priceText, !ready && { color: AC.muted }]} numberOfLines={1}>{priceText}</Text>}
        </View>
      </LinearGradient>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Buy flow + panel
// ---------------------------------------------------------------------------

/** Store state + run(pack) with the right feedback for every outcome. */
export function useUavBuyFlow() {
  const store = useUavStore()
  const [note, setNote] = useState(null)
  const run = async (pack) => {
    buzz('medium')
    setNote(null)
    const res = await store.buy(pack.sku)
    if (res.ok) {
      buzz('success')
      setNote({ good: true, text: `+${res.count || pack.count} UAVs added` })
    } else if (res.pending) {
      setNote({ text: 'Purchase pending approval — your UAVs arrive as soon as it’s approved.' })
    } else if (res.unknown) {
      setNote({ text: 'Still waiting on the store. If it goes through, your UAVs are added automatically.' })
    } else if (res.error) {
      buzz('error')
      Alert.alert('Purchase failed', res.error)
    }
  }
  return { ...store, note, run }
}

/** Balance header used on the store page and the sheet. */
export function UavBalanceHeader({ balance, owner, freeLeft, compact }) {
  return (
    <LinearGradient colors={['rgba(124,140,255,0.22)', 'rgba(255,46,99,0.14)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.balance, compact && { paddingVertical: 10 }]}>
      <View style={st.balanceIcon}><MaterialCommunityIcons name="satellite-variant" size={compact ? 20 : 24} color="#fff" /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.balanceLabel}>YOUR UAVS</Text>
        <Text style={[st.balanceValue, compact && { fontSize: 22 }]}>{owner ? '∞ Unlimited' : Number(balance || 0).toLocaleString()}</Text>
      </View>
      {!owner && freeLeft > 0 && <View style={st.freeTag}><Text style={st.freeText}>+{freeLeft} free this match</Text></View>}
    </LinearGradient>
  )
}

/**
 * The UAV store body. variant 'screen' (full page grid) | 'sheet' (in-match, compact).
 */
export function UavStorePanel({ variant = 'screen', balance, owner, freeLeft = 0 }) {
  const flow = useUavBuyFlow()
  const compact = variant === 'sheet'
  return (
    <View style={{ gap: compact ? 10 : 14 }}>
      <UavBalanceHeader balance={balance} owner={owner} freeLeft={freeLeft} compact={compact} />
      {!compact && (
        <Text style={st.blurb}>
          Call in a UAV in any Laser Tag mode or Battle Royale to reveal enemies on your map for {Math.round(UAV_DURATION_MS / 1000)} seconds. Everyone gets 1 free UAV every match.
        </Text>
      )}
      {owner ? (
        <Text style={st.ownerNote}>Owner account — UAVs are unlimited and never charged.</Text>
      ) : (
        <View style={st.grid}>
          {flow.packs.map((p, i) => (
            <UavPackCard
              key={p.sku}
              pack={p}
              index={i}
              compact={compact}
              busy={flow.busySku === p.sku}
              disabled={!!flow.busySku && flow.busySku !== p.sku}
              onBuy={flow.run}
              style={st.gridItem}
            />
          ))}
        </View>
      )}
      {!!flow.note && <Text style={[st.note, flow.note.good && { color: AC.live }]}>{flow.note.text}</Text>}
      {!owner && flow.packs.every((p) => p.status === 'unavailable') && <Text style={st.note}>UAV packs are coming soon to the store.</Text>}
      {!owner && <Text style={st.fine}>{FINE_PRINT}</Text>}
    </View>
  )
}

/** Compact "🛰 12" pill for top bars (Arcade hub, Laser Tag lobby). */
export const UavBalancePill = memo(function UavBalancePill({ balance, owner, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [st.pill, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`UAVs: ${owner ? 'unlimited' : balance}. Open the store`}>
      <MaterialCommunityIcons name="satellite-variant" size={15} color="#fff" />
      <Text style={st.pillText}>{owner ? '∞' : Number(balance || 0).toLocaleString()}</Text>
      <View style={st.pillPlus}><Text style={st.pillPlusText}>+</Text></View>
    </Pressable>
  )
})

const st = StyleSheet.create({
  glow: { position: 'absolute', opacity: 0.55 },
  signal: { position: 'absolute', borderWidth: 2 },
  cardOuter: { borderRadius: 24, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  cardOuterHi: { shadowOpacity: 0.6, shadowRadius: 20 },
  card: { borderRadius: 24, borderWidth: 1.5, paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12, alignItems: 'center', overflow: 'hidden' },
  cardCompact: { paddingTop: 12, paddingBottom: 10, borderRadius: 20 },
  ribbon: { position: 'absolute', top: 12, right: -30, width: 120, paddingVertical: 3, alignItems: 'center', transform: [{ rotate: '35deg' }] },
  ribbonText: { fontSize: 8.5, ...font.heavy, color: '#fff', letterSpacing: 0.8 },
  artWrap: { marginBottom: 2 },
  count: { fontSize: 30, ...font.heavy, color: '#fff', letterSpacing: -0.5, marginTop: 2 },
  unit: { fontSize: 11, ...font.heavy, letterSpacing: 2, marginTop: -2 },
  metaRow: { height: 22, justifyContent: 'center', marginTop: 6 },
  save: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  saveText: { fontSize: 10, ...font.heavy, letterSpacing: 0.5 },
  savePlaceholder: { height: 18 },
  per: { fontSize: 11, color: AC.muted, marginTop: 2 },
  priceBtn: { marginTop: 10, alignSelf: 'stretch', height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  priceBtnOff: { backgroundColor: 'rgba(255,255,255,0.08)' },
  priceText: { fontSize: 15, ...font.heavy, color: '#10121f' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  gridItem: { width: '48%' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  balanceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,46,99,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { fontSize: 10, ...font.heavy, color: AC.muted, letterSpacing: 1.5 },
  balanceValue: { fontSize: 26, ...font.heavy, color: '#fff' },
  freeTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(47,220,143,0.18)' },
  freeText: { fontSize: 11, ...font.bold, color: AC.live },
  blurb: { fontSize: 13, color: AC.muted, lineHeight: 19 },
  ownerNote: { fontSize: 14, ...font.bold, color: AC.gold, textAlign: 'center', paddingVertical: 8 },
  note: { fontSize: 12, color: AC.muted, textAlign: 'center' },
  fine: { fontSize: 10.5, color: AC.faint, textAlign: 'center', marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 10, paddingRight: 4, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,46,99,0.18)', borderWidth: 1, borderColor: 'rgba(255,93,138,0.55)' },
  pillText: { fontSize: 14, ...font.heavy, color: '#fff' },
  pillPlus: { width: 22, height: 22, borderRadius: 11, backgroundColor: AC.hot, alignItems: 'center', justifyContent: 'center' },
  pillPlusText: { fontSize: 15, ...font.heavy, color: '#fff', marginTop: -1 },
})

/**
 * Opens the Arcade Store screen ('ArcadeStore'). Falls back to the Shop if the route isn't
 * registered yet, so a tap never errors. Resolves true when the store opened.
 */
export function openArcadeStore(navigation) {
  try {
    let nav = navigation
    while (nav) {
      const names = nav.getState?.()?.routeNames
      if (Array.isArray(names) && names.includes('ArcadeStore')) {
        nav.navigate('ArcadeStore')
        return true
      }
      nav = nav.getParent?.()
    }
  } catch {
    // fall through
  }
  try { navigation?.navigate?.('GunShop') } catch {}
  return false
}
