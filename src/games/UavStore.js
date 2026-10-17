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
import { FONT, ST, stType, withAlpha } from './studio'
import { translate, useT } from '../i18n'
import G from '../i18n/strings/gunShop'
import { uavRulesText } from './laser/uavText'

const finePrint = () => translate(G, Platform.OS === 'android' ? 'fine_android' : 'fine_ios')
// Pack ribbons come from lib/iap in English.
const RIBBON_KEYS = { 'Most popular': 'ribbon_popular', 'Best value': 'ribbon_value' }
const ribbonText = (r) => (RIBBON_KEYS[r] ? translate(G, RIBBON_KEYS[r]) : r)

// Per-tier studio role colour (accent) + a soft glow for the satellite art.
const TIERS = {
  uav5: { glow: withAlpha(ST.friendly, 0.28), accent: ST.friendly },
  uav20: { glow: withAlpha(ST.enemy, 0.3), accent: ST.enemy },
  uav50: { glow: withAlpha(ST.objective, 0.3), accent: ST.objective },
  uav120: { glow: withAlpha(ST.health, 0.28), accent: ST.health },
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
  const t = useT(G)
  const tier = tierOf(pack.id)
  const [w, setW] = useState(0)
  const ready = pack.status === 'ready'
  const priceText = pack.status === 'loading' ? '…' : ready ? pack.displayPrice : t('coming_soon')
  const highlight = !!pack.ribbon
  return (
    <Pressable
      onPress={() => ready && !busy && !disabled && onBuy?.(pack)}
      disabled={!ready || busy || disabled}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={({ pressed }) => [st.cardOuter, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${t('n_uavs', { n: pack.count })}, ${ready ? pack.displayPrice : t('coming_soon_lc')}${pack.ribbon ? `, ${ribbonText(pack.ribbon)}` : ''}`}
      accessibilityState={{ disabled: !ready || !!disabled, busy: !!busy }}
    >
      <View style={[st.card, { borderColor: highlight ? tier.accent : ST.line, borderTopColor: tier.accent }, compact && st.cardCompact]}>
        <Shine width={w} delay={index * 450} />
        {!!pack.ribbon && (
          <View style={[st.ribbon, { backgroundColor: tier.accent }]}>
            <Text style={[st.ribbonText, { color: tier.accent === ST.enemy ? '#ffffff' : ST.ink }]} numberOfLines={1}>{ribbonText(pack.ribbon).toUpperCase()}</Text>
          </View>
        )}
        <View style={st.artWrap}>
          <SatelliteArt size={compact ? 64 : 84} accent={tier.accent} glow={tier.glow} />
        </View>
        <Text style={[st.count, compact && { fontSize: 24 }]}>{pack.count}</Text>
        <Text style={[st.unit, { color: tier.accent }]}>{t('uavs')}</Text>
        <View style={st.metaRow}>
          {pack.savePct > 0 ? <View style={[st.save, { borderColor: tier.accent }]}><Text style={[st.saveText, { color: tier.accent }]}>{t('save_pct', { n: pack.savePct })}</Text></View> : <View style={st.savePlaceholder} />}
        </View>
        <Text style={st.per} numberOfLines={1}>{pack.perUav ? t('per_uav', { price: pack.perUav }) : ' '}</Text>
        <View style={[st.priceBtn, ready ? { backgroundColor: tier.accent } : st.priceBtnOff]}>
          {busy ? <ActivityIndicator size="small" color={ST.ink} /> : <Text style={[st.priceText, { color: tier.accent === ST.enemy ? '#ffffff' : ST.ink }, !ready && { color: AC.muted }]} numberOfLines={1}>{priceText}</Text>}
        </View>
      </View>
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
      setNote({ good: true, text: translate(G, 'uavs_added', { n: res.count || pack.count }) })
    } else if (res.pending) {
      setNote({ text: translate(G, 'uav_pending') })
    } else if (res.unknown) {
      setNote({ text: translate(G, 'uav_unknown') })
    } else if (res.error) {
      buzz('error')
      Alert.alert(translate(G, 'purchase_failed'), res.error)
    }
  }
  return { ...store, note, run }
}

/** Balance header used on the store page and the sheet. */
export function UavBalanceHeader({ balance, owner, freeLeft, compact }) {
  const t = useT(G)
  return (
    <View style={[st.balance, compact && { paddingVertical: 10 }]}>
      <View style={st.balanceIcon}><MaterialCommunityIcons name="satellite-variant" size={compact ? 20 : 24} color={ST.enemy} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.balanceLabel}>{t('your_uavs')}</Text>
        <Text style={[st.balanceValue, compact && { fontSize: 22 }]}>{owner ? t('unlimited') : Number(balance || 0).toLocaleString()}</Text>
      </View>
      {!owner && freeLeft > 0 && <View style={st.freeTag}><Text style={st.freeText}>{t('free_this_match', { n: freeLeft })}</Text></View>}
    </View>
  )
}

/**
 * The UAV store body. variant 'screen' (full page grid) | 'sheet' (in-match, compact).
 */
export function UavStorePanel({ variant = 'screen', balance, owner, freeLeft = 0 }) {
  const t = useT(G)
  const flow = useUavBuyFlow()
  const compact = variant === 'sheet'
  return (
    <View style={{ gap: compact ? 10 : 14 }}>
      <UavBalanceHeader balance={balance} owner={owner} freeLeft={freeLeft} compact={compact} />
      {!compact && (
        <Text style={st.blurb}>
          {t('uav_blurb', { n: Math.round(UAV_DURATION_MS / 1000) })} {uavRulesText()} {t('uav_packs_note')}
        </Text>
      )}
      {compact && <Text style={st.fine}>{uavRulesText()}</Text>}
      {owner ? (
        <Text style={st.ownerNote}>{t('uav_owner')}</Text>
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
      {!owner && flow.packs.every((p) => p.status === 'unavailable') && <Text style={st.note}>{t('uav_soon')}</Text>}
      {!owner && <Text style={st.fine}>{finePrint()}</Text>}
    </View>
  )
}

/** Compact satellite + count pill for top bars (Arcade hub, Laser Tag lobby). */
export const UavBalancePill = memo(function UavBalancePill({ balance, owner, onPress }) {
  const t = useT(G)
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [st.pill, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('uav_pill_a11y', { n: owner ? t('unlimited_lc') : balance })}>
      <MaterialCommunityIcons name="satellite-variant" size={15} color={ST.enemy} />
      {owner ? <MaterialCommunityIcons name="infinity" size={16} color={ST.text} /> : <Text style={st.pillText}>{Number(balance || 0).toLocaleString()}</Text>}
      <View style={st.pillPlus}><MaterialCommunityIcons name="plus" size={14} color="#ffffff" /></View>
    </Pressable>
  )
})

const LABEL = { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' }

const st = StyleSheet.create({
  glow: { position: 'absolute', opacity: 0.55 },
  signal: { position: 'absolute', borderWidth: 2 },
  cardOuter: { borderRadius: ST.radius },
  card: { borderRadius: ST.radius, borderWidth: 1, borderTopWidth: 2, backgroundColor: ST.panelStrong, paddingHorizontal: 12, paddingTop: 20, paddingBottom: 12, alignItems: 'center', overflow: 'hidden' },
  cardCompact: { paddingTop: 16, paddingBottom: 10 },
  ribbon: { position: 'absolute', top: 0, left: 0, paddingHorizontal: 6, height: 16, justifyContent: 'center', borderBottomRightRadius: 2 },
  ribbonText: { ...LABEL, fontSize: 8.5, letterSpacing: 1.2 },
  artWrap: { marginBottom: 2 },
  count: { fontFamily: FONT.display, fontSize: 30, color: ST.text, marginTop: 2, fontVariant: ['tabular-nums'], includeFontPadding: false },
  unit: { ...LABEL, fontSize: 11, letterSpacing: 2.4, marginTop: 2 },
  metaRow: { height: 22, justifyContent: 'center', marginTop: 6 },
  save: { paddingHorizontal: 6, height: 18, justifyContent: 'center', borderRadius: 2, borderWidth: 1 },
  saveText: { ...LABEL, fontSize: 10, letterSpacing: 1.2 },
  savePlaceholder: { height: 18 },
  per: { fontFamily: FONT.uiMedium, fontSize: 11, color: ST.muted, marginTop: 2 },
  priceBtn: { marginTop: 10, alignSelf: 'stretch', height: 38, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center' },
  priceBtnOff: { backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line },
  priceText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 0.6, color: ST.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  gridItem: { width: '48.5%' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderLeftWidth: 3, borderLeftColor: ST.enemy },
  balanceIcon: { width: 44, height: 44, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: withAlpha(ST.enemy, 0.5), alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { ...stType.label },
  balanceValue: { fontFamily: FONT.display, fontSize: 26, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  freeTag: { paddingHorizontal: 6, height: 22, justifyContent: 'center', borderRadius: 2, borderWidth: 1, borderColor: withAlpha(ST.health, 0.5) },
  freeText: { ...LABEL, color: ST.health },
  blurb: { ...stType.small, fontSize: 13, lineHeight: 19 },
  ownerNote: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: ST.objective, textAlign: 'center', paddingVertical: 8 },
  note: { fontFamily: FONT.uiSemi, fontSize: 12, color: ST.muted, textAlign: 'center' },
  fine: { fontFamily: FONT.uiMedium, fontSize: 10.5, color: ST.faint, textAlign: 'center', marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 4, height: 34, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: withAlpha(ST.enemy, 0.55) },
  pillText: { fontFamily: FONT.display, fontSize: 14, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  pillPlus: { width: 22, height: 22, borderRadius: 2, backgroundColor: ST.enemy, alignItems: 'center', justifyContent: 'center' },
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
