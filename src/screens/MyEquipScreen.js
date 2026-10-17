import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Image, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import {
  GUNS, RARITIES, setEquippedGun, ensureOwnerUnlocks, gunRatings, isArcadeOwner, FIRE_MODE_LABELS,
} from '../lib/guns'
import { useT } from '../i18n'
import G from '../i18n/strings/gunShop'
import { uavRulesText } from '../games/laser/uavText'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, useArcadeInsets, GhostButton, PlayButton, SectionHeader, arcadeText, useArcadeStatusBar,
} from '../games/arcadeUI'
import { FONT, ST, stType, withAlpha } from '../games/studio'
import { useUavInventory } from '../lib/uav'
import { GRENADES_PER_MATCH, useGrenadeInventory } from '../lib/grenades'
import { STICKY_BOMBS_PER_MATCH, useStickyBombInventory } from '../lib/stickyBombs'
import { LAND_MINES_PER_MATCH, useLandMineInventory } from '../lib/landMines'
import { gunArt } from '../lib/gunArt'

const PAD = 20
const GAP = 12
const FIRE_MODE = FIRE_MODE_LABELS

const rarityOf = (gun) => RARITIES[gun?.rarity] || RARITIES.common
const STAT_KEYS = { power: 'stat_power', fireRate: 'stat_fire_rate', accuracy: 'stat_hip_aim', range: 'stat_range' }

function Glow({ color, size, style }) {
  return (
    <View style={[styles.glowWrap, style]} pointerEvents="none">
      {[1, 0.7, 0.45].map((k, i) => (
        <View key={i} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: (size * k) / 2, backgroundColor: color, opacity: 0.08 + i * 0.05 }} />
      ))}
    </View>
  )
}

export default function MyEquipScreen({ navigation }) {
  const t = useT(G)
  const { width } = useWindowDimensions()
  const insets = useArcadeInsets()
  const [stats, setStats] = useState(null)
  const [owner, setOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const uav = useUavInventory()
  const grenades = useGrenadeInventory()
  const stickyBombs = useStickyBombInventory()
  const landMines = useLandMineInventory()
  useArcadeStatusBar()

  useFocusEffect(useCallback(() => {
    let alive = true
    ;(async () => {
      const o = await ensureOwnerUnlocks().catch(() => false)
      const s = await loadArcadeStats()
      if (!alive) return
      setOwner(!!o)
      setStats(s)
    })()
    return () => { alive = false }
  }, []))
  useEffect(() => subscribeArcadeStats(setStats), [])

  const unlocked = stats?.unlockedGuns ?? ['pistol', 'uzi']
  const equipped = stats?.equippedGun ?? 'pistol'
  const owns = (g) => owner || unlocked.includes(g.id)
  const equippedGun = GUNS.find((g) => g.id === equipped && unlocked.includes(g.id)) || GUNS[0]
  const ownedGuns = useMemo(() => GUNS.filter((g) => owns(g)), [unlocked, owner])
  const points = stats?.points ?? 0

  const equip = async (gun) => {
    if (busy) return
    setBusy(true)
    try {
      if (owner && !unlocked.includes(gun.id)) await ensureOwnerUnlocks()
      const ok = await setEquippedGun(gun.id)
      if (ok) buzz('success')
    } catch { /* ignore */ }
    setBusy(false)
  }

  const contentW = width - PAD * 2
  const cardW = Math.floor((contentW - GAP) / 2)

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.pad, styles.header]}>
          <View>
            <Text style={styles.headerKicker}>{t('your_loadout')}</Text>
            <Text style={styles.headerTitle}>{t('my_equip')}</Text>
          </View>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('close')} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="close" size={22} color={ST.text} />
          </Pressable>
        </View>

        {/* Equipped weapon hero */}
        <View style={[styles.pad, { marginTop: 16 }]}>
          <View style={styles.equippedCard}>
            <LinearGradient
              colors={[rarityOf(equippedGun).color + '24', ST.ground2, ST.ground2]}
              start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.equippedStripe, { backgroundColor: rarityOf(equippedGun).color }]} />
            <View style={styles.equippedBadge}>
              <Ionicons name="checkmark-circle" size={12} color={ST.health} />
              <Text style={styles.equippedBadgeText}>{t('equipped_caps')}</Text>
            </View>
            <View style={styles.equippedArt}>
              <Glow color={rarityOf(equippedGun).color} size={contentW * 0.7} />
              <Image
                source={gunArt(equippedGun)}
                style={{ width: contentW - 48, height: (contentW - 48) / 2 * 0.86 }}
                resizeMode="contain"
                fadeDuration={0}
              />
            </View>
            <View style={styles.equippedInfo}>
              <View style={[styles.rarityTag, { backgroundColor: rarityOf(equippedGun).color + '22', borderColor: rarityOf(equippedGun).color + 'aa' }]}>
                <View style={[styles.rarityDot, { backgroundColor: rarityOf(equippedGun).color }]} />
                <Text style={[styles.rarityText, { color: rarityOf(equippedGun).color }]}>{rarityOf(equippedGun).name.toUpperCase()}</Text>
              </View>
              <Text style={styles.equippedName}>{equippedGun.name}</Text>
              <Text style={styles.equippedDesc}>{equippedGun.description}</Text>
              {equippedGun.weakness ? <Text style={styles.equippedTrade}>{t('tradeoff', { text: equippedGun.weakness })}</Text> : null}
              {/* Stats */}
              <View style={styles.statsRow}>
                {Object.entries(gunRatings(equippedGun)).map(([k, v]) => (
                  <View key={k} style={styles.statItem}>
                    <View style={styles.statBarBg}>
                      <View style={[styles.statBarFill, { width: `${Math.round(v * 100)}%`, backgroundColor: rarityOf(equippedGun).color }]} />
                    </View>
                    <Text style={styles.statLabel}>{STAT_KEYS[k] ? t(STAT_KEYS[k]).toUpperCase() : k.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Inventory summary */}
        <View style={[styles.pad, { marginTop: 20 }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Ionicons name="flash" size={18} color={ST.friendly} />
              <Text style={styles.summaryValue}>{ownedGuns.length}<Text style={styles.summaryOf}>/{GUNS.length}</Text></Text>
              <Text style={styles.summaryLabel}>{t('weapons_caps')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <MaterialCommunityIcons name="satellite-variant" size={18} color={ST.enemy} />
              <Text style={styles.summaryValue}>{uav.owner ? '∞' : uav.balance}</Text>
              <Text style={styles.summaryLabel}>{t('uavs_caps')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <MaterialCommunityIcons name="bomb" size={18} color={ST.objective} />
              <Text style={styles.summaryValue}>{grenades.owner ? '∞' : grenades.balance}</Text>
              <Text style={styles.summaryLabel}>{t('grenades_caps')}</Text>
              <Text style={styles.summaryLimit}>{t('max_per_match', { n: GRENADES_PER_MATCH })}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Image source={require('../../assets/guns/stickybomb.png')} style={styles.summaryImg} resizeMode="contain" />
              <Text style={styles.summaryValue}>{stickyBombs.owner ? '∞' : stickyBombs.balance}</Text>
              <Text style={styles.summaryLabel}>{t('sticky_caps')}</Text>
              <Text style={styles.summaryLimit}>{t('max_per_match', { n: STICKY_BOMBS_PER_MATCH })}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Image source={require('../../assets/guns/landmine.png')} style={styles.summaryImg} resizeMode="contain" />
              <Text style={styles.summaryValue}>{landMines.owner ? '∞' : landMines.balance}</Text>
              <Text style={styles.summaryLabel}>{t('mines_caps')}</Text>
              <Text style={styles.summaryLimit}>{t('max_per_match', { n: LAND_MINES_PER_MATCH })}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="diamond" size={16} color={ST.objective} />
              <Text style={styles.summaryValue}>{points.toLocaleString()}</Text>
              <Text style={styles.summaryLabel}>{t('coins_caps')}</Text>
            </View>
          </View>
          <Text style={styles.limitsNote}>{`${t('fair_play')} ${uavRulesText()}`}</Text>
        </View>

        {/* Owned weapons grid */}
        <SectionHeader title={t('owned_weapons', { n: ownedGuns.length })} style={[styles.pad, { marginTop: 20 }]} />
        <View style={[styles.pad, styles.grid]}>
          {ownedGuns.map((gun) => {
            const r = rarityOf(gun)
            const isEquipped = equippedGun.id === gun.id
            return (
              <Pressable
                key={gun.id}
                onPress={() => equip(gun)}
                disabled={isEquipped || busy}
                style={({ pressed }) => [{ width: cardW, marginBottom: GAP }, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <View style={[styles.card, { borderColor: isEquipped ? ST.health : r.color + '44' }]}>
                  <LinearGradient
                    colors={[r.color + '24', ST.ground2, ST.ground2]}
                    start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={[styles.cardStrip, { backgroundColor: r.color }]} />
                  <View style={[styles.cardArt, { height: Math.round(cardW * 0.55) }]}>
                    <Glow color={r.color} size={cardW * 0.7} />
                    <Image source={gunArt(gun)} style={{ width: cardW - 16, height: (cardW - 16) / 2 }} resizeMode="contain" fadeDuration={0} />
                    <View style={styles.cardRarity}>
                      <Text style={[styles.cardRarityText, { color: r.color }]}>{r.name.toUpperCase()}</Text>
                    </View>
                    {isEquipped && (
                      <View style={styles.equippedBadgeSmall}>
                        <Ionicons name="checkmark" size={12} color={ST.ink} />
                      </View>
                    )}
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{gun.name}</Text>
                    <View style={styles.cardMetaRow}>
                      <Ionicons name={gun.fireMode === 'automatic' ? 'flash' : gun.fireMode === 'burst' ? 'layers' : 'radio-button-on'} size={11} color={AC.faint} />
                      <Text style={styles.cardMeta} numberOfLines={1}>{FIRE_MODE[gun.fireMode]}</Text>
                    </View>
                    <View style={styles.cardFoot}>
                      {isEquipped ? (
                        <View style={[styles.pill, { backgroundColor: withAlpha(ST.health, 0.12), borderWidth: 1, borderColor: withAlpha(ST.health, 0.6) }]}>
                          <Ionicons name="checkmark-circle" size={12} color={ST.health} style={{ marginRight: 4 }} />
                          <Text style={[styles.pillText, { color: ST.health }]}>{t('equipped')}</Text>
                        </View>
                      ) : (
                        <View style={[styles.pill, { backgroundColor: withAlpha(ST.friendly, 0.1), borderWidth: 1, borderColor: withAlpha(ST.friendly, 0.6) }]}>
                          <Ionicons name="swap-horizontal" size={12} color={ST.friendly} style={{ marginRight: 4 }} />
                          <Text style={[styles.pillText, { color: ST.friendly }]}>{t('equip')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </Pressable>
            )
          })}
        </View>

        {ownedGuns.length === 0 && (
          <View style={[styles.pad, { alignItems: 'center', marginTop: 20 }]}>
            <Ionicons name="bag-handle-outline" size={48} color={AC.faint} />
            <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 12 }]}>{t('no_weapons')}</Text>
            <View style={{ marginTop: 16 }}>
              <PlayButton title={t('visit_shop')} icon="bag-handle" onPress={() => navigation.navigate('GunShop')} />
            </View>
          </View>
        )}

        {/* Shop link */}
        <View style={[styles.pad, { marginTop: 20, alignItems: 'center' }]}>
          <Pressable
            onPress={() => navigation.navigate('GunShop')}
            style={({ pressed }) => [styles.shopLink, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="bag-handle" size={16} color={ST.friendly} />
            <Text style={styles.shopLinkText}>{t('browse_shop')}</Text>
            <Ionicons name="chevron-forward" size={14} color={ST.friendly} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const LABEL = { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' }
const DISPLAY = { fontFamily: FONT.display, includeFontPadding: false }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  pad: { paddingHorizontal: PAD },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  headerTitle: { ...DISPLAY, fontSize: 24, letterSpacing: 1, color: ST.text, textTransform: 'uppercase' },
  headerKicker: { ...stType.kicker },
  closeBtn: { width: 40, height: 40, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },

  equippedCard: { borderRadius: ST.radius, overflow: 'hidden', borderWidth: 1, borderColor: withAlpha(ST.health, 0.45), backgroundColor: ST.ground2 },
  equippedStripe: { height: 2, width: '100%' },
  equippedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingTop: 14 },
  equippedBadgeText: { ...LABEL, fontSize: 11, letterSpacing: 2.4, color: ST.health },
  equippedArt: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  equippedInfo: { paddingHorizontal: 16, paddingBottom: 16 },
  equippedName: { ...DISPLAY, fontSize: 24, letterSpacing: 1, color: ST.text, marginTop: 8, textTransform: 'uppercase' },
  equippedDesc: { fontFamily: FONT.uiSemi, fontSize: 13, color: ST.muted, lineHeight: 18, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statItem: { flex: 1 },
  statBarBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  statBarFill: { height: 4 },
  statLabel: { ...LABEL, fontSize: 8, letterSpacing: 1.2, color: ST.faint, marginTop: 4, textAlign: 'center' },

  rarityTag: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 6, height: 20, borderRadius: 2, borderWidth: 1 },
  rarityDot: { width: 5, height: 5 },
  rarityText: { ...LABEL, letterSpacing: 1.4 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summaryCard: { width: '31%', flexGrow: 1, alignItems: 'center', paddingVertical: 12, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, gap: 4 },
  summaryImg: { width: 26, height: 18 },
  summaryValue: { ...DISPLAY, fontSize: 18, color: ST.text, fontVariant: ['tabular-nums'] },
  summaryOf: { fontSize: 13, color: ST.faint },
  summaryLabel: { ...LABEL, fontSize: 9, letterSpacing: 1.4, color: ST.faint },
  summaryLimit: { ...LABEL, fontSize: 8, letterSpacing: 1, color: ST.muted, marginTop: 2 },
  limitsNote: { fontFamily: FONT.uiMedium, fontSize: 12, lineHeight: 17, color: ST.faint, marginTop: 10 },
  equippedTrade: { fontFamily: FONT.uiSemi, fontSize: 12, color: ST.enemy, lineHeight: 17, marginTop: 4 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { borderRadius: ST.radius, borderWidth: 1, overflow: 'hidden', backgroundColor: ST.ground2 },
  cardStrip: { height: 2, width: '100%' },
  cardArt: { alignItems: 'center', justifyContent: 'center' },
  cardRarity: { position: 'absolute', top: 8, left: 10 },
  cardRarityText: { ...LABEL, fontSize: 9, letterSpacing: 1.4 },
  equippedBadgeSmall: { position: 'absolute', top: 7, right: 8, width: 20, height: 20, borderRadius: 2, backgroundColor: ST.health, alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 2 },
  cardName: { ...DISPLAY, fontSize: 14, letterSpacing: 0.4, color: ST.text, lineHeight: 18, minHeight: 20, textTransform: 'uppercase' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta: { ...LABEL, color: ST.faint, flexShrink: 1 },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 26, borderRadius: ST.radius, maxWidth: '100%' },
  pillText: { ...DISPLAY, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },

  glowWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },

  shopLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 44, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  shopLinkText: { ...LABEL, fontSize: 12, letterSpacing: 1.6, color: ST.friendly },
})
