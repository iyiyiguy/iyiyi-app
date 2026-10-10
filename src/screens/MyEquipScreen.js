import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Image, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import {
  GUNS, RARITIES, setEquippedGun, ensureOwnerUnlocks, gunRatings, fireRateLabel, isArcadeOwner,
} from '../lib/guns'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, useArcadeInsets, GhostButton, PlayButton, SectionHeader, arcadeText, useArcadeStatusBar,
} from '../games/arcadeUI'
import { font } from '../theme'
import { useUavInventory } from '../lib/uav'
import { useGrenadeInventory } from '../lib/grenades'
import { useStickyBombInventory } from '../lib/stickyBombs'
import { useLandMineInventory } from '../lib/landMines'
import { gunArt } from '../lib/gunArt'
import Glass from '../components/Glass'

const PAD = 20
const GAP = 12
const FIRE_MODE = { single: 'Semi-auto', burst: 'Burst', automatic: 'Full-auto' }

const rarityOf = (gun) => RARITIES[gun?.rarity] || RARITIES.common

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
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.pad, styles.header]}>
          <View>
            <Text style={styles.headerKicker}>YOUR LOADOUT</Text>
            <Text style={styles.headerTitle}>My Equip</Text>
          </View>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.7 }}>
            <Ionicons name="close" size={26} color={AC.text} />
          </Pressable>
        </View>

        {/* Equipped weapon hero */}
        <View style={[styles.pad, { marginTop: 16 }]}>
          <View style={styles.equippedCard}>
            <LinearGradient
              colors={[rarityOf(equippedGun).color + '48', '#11142a', '#090b18']}
              start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.equippedStripe, { backgroundColor: rarityOf(equippedGun).color }]} />
            <View style={styles.equippedBadge}>
              <Ionicons name="checkmark-circle" size={12} color={AC.live} />
              <Text style={styles.equippedBadgeText}>EQUIPPED</Text>
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
              {/* Stats */}
              <View style={styles.statsRow}>
                {Object.entries(gunRatings(equippedGun)).map(([k, v]) => (
                  <View key={k} style={styles.statItem}>
                    <View style={styles.statBarBg}>
                      <View style={[styles.statBarFill, { width: `${Math.round(v * 100)}%`, backgroundColor: rarityOf(equippedGun).color }]} />
                    </View>
                    <Text style={styles.statLabel}>{k.toUpperCase()}</Text>
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
              <Ionicons name="flash" size={20} color={AC.accent} />
              <Text style={styles.summaryValue}>{ownedGuns.length}<Text style={styles.summaryOf}>/{GUNS.length}</Text></Text>
              <Text style={styles.summaryLabel}>WEAPONS</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={{ fontSize: 18 }}>🛸</Text>
              <Text style={styles.summaryValue}>{uav.owner ? '∞' : uav.balance}</Text>
              <Text style={styles.summaryLabel}>UAVS</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={{ fontSize: 18 }}>💣</Text>
              <Text style={styles.summaryValue}>{grenades.owner ? '∞' : grenades.balance}</Text>
              <Text style={styles.summaryLabel}>GRENADES</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={{ fontSize: 18 }}>🧨</Text>
              <Text style={styles.summaryValue}>{stickyBombs.owner ? '∞' : stickyBombs.balance}</Text>
              <Text style={styles.summaryLabel}>STICKY</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={{ fontSize: 18 }}>💥</Text>
              <Text style={styles.summaryValue}>{landMines.owner ? '∞' : landMines.balance}</Text>
              <Text style={styles.summaryLabel}>MINES</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="diamond" size={18} color={AC.gold} />
              <Text style={styles.summaryValue}>{points.toLocaleString()}</Text>
              <Text style={styles.summaryLabel}>COINS</Text>
            </View>
          </View>
        </View>

        {/* Owned weapons grid */}
        <SectionHeader title={`Owned Weapons (${ownedGuns.length})`} style={[styles.pad, { marginTop: 20 }]} />
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
                <View style={[styles.card, { borderColor: isEquipped ? AC.live : r.color + '44', shadowColor: r.color }]}>
                  <LinearGradient
                    colors={[r.color + '48', '#11142a', '#090b18']}
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
                        <Ionicons name="checkmark-circle" size={10} color="#fff" />
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
                        <View style={[styles.pill, { backgroundColor: 'rgba(47,220,143,0.16)', borderWidth: 1, borderColor: 'rgba(47,220,143,0.55)' }]}>
                          <Ionicons name="checkmark-circle" size={12} color={AC.live} style={{ marginRight: 4 }} />
                          <Text style={[styles.pillText, { color: AC.live }]}>Equipped</Text>
                        </View>
                      ) : (
                        <View style={[styles.pill, { backgroundColor: 'rgba(124,140,255,0.16)', borderWidth: 1, borderColor: 'rgba(124,140,255,0.55)' }]}>
                          <Ionicons name="swap-horizontal" size={12} color={AC.accent} style={{ marginRight: 4 }} />
                          <Text style={[styles.pillText, { color: AC.accent }]}>Tap to Equip</Text>
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
            <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 12 }]}>No weapons owned yet.</Text>
            <View style={{ marginTop: 16 }}>
              <PlayButton title="Visit Shop" icon="bag-handle" onPress={() => navigation.navigate('GunShop')} />
            </View>
          </View>
        )}

        {/* Shop link */}
        <View style={[styles.pad, { marginTop: 20, alignItems: 'center' }]}>
          <Pressable
            onPress={() => navigation.navigate('GunShop')}
            style={({ pressed }) => [styles.shopLink, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="bag-handle" size={16} color={AC.accent} />
            <Text style={styles.shopLinkText}>Browse Shop for More Weapons</Text>
            <Ionicons name="chevron-forward" size={14} color={AC.accent} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: PAD },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  headerTitle: { fontSize: 26, ...font.heavy, color: AC.text, letterSpacing: -0.5 },
  headerKicker: { fontSize: 11, ...font.heavy, color: AC.accent, letterSpacing: 2.4 },

  equippedCard: { borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(47,220,143,0.4)', backgroundColor: '#0b0d1c' },
  equippedStripe: { height: 3, width: '100%' },
  equippedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingTop: 14 },
  equippedBadgeText: { fontSize: 11, ...font.heavy, color: AC.live, letterSpacing: 2 },
  equippedArt: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  equippedInfo: { paddingHorizontal: 16, paddingBottom: 18 },
  equippedName: { fontSize: 24, ...font.heavy, color: AC.text, letterSpacing: 0.3, marginTop: 8 },
  equippedDesc: { fontSize: 13, color: AC.muted, lineHeight: 18, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statItem: { flex: 1 },
  statBarBg: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  statBarFill: { height: 6, borderRadius: 3 },
  statLabel: { fontSize: 8, ...font.heavy, color: AC.faint, letterSpacing: 1.2, marginTop: 4, textAlign: 'center' },

  rarityTag: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  rarityDot: { width: 5, height: 5, borderRadius: 3 },
  rarityText: { fontSize: 10, ...font.heavy, letterSpacing: 1.2 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: { width: '31%', flexGrow: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 16, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border, gap: 4 },
  summaryValue: { fontSize: 18, ...font.heavy, color: AC.text },
  summaryOf: { fontSize: 13, color: AC.faint },
  summaryLabel: { fontSize: 8, ...font.heavy, color: AC.faint, letterSpacing: 1.4 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden', backgroundColor: '#0d0f20', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  cardStrip: { height: 3, width: '100%' },
  cardArt: { alignItems: 'center', justifyContent: 'center' },
  cardRarity: { position: 'absolute', top: 8, left: 10 },
  cardRarityText: { fontSize: 9, ...font.heavy, letterSpacing: 1.4 },
  equippedBadgeSmall: { position: 'absolute', top: 7, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(47,220,143,0.25)', borderWidth: 1, borderColor: 'rgba(47,220,143,0.6)', alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 },
  cardName: { fontSize: 15, ...font.heavy, color: AC.text, lineHeight: 19, minHeight: 22 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta: { fontSize: 11, ...font.semibold, color: AC.faint, letterSpacing: 0.4, flexShrink: 1 },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 26, borderRadius: 13, maxWidth: '100%' },
  pillText: { fontSize: 12, ...font.heavy, letterSpacing: 0.2 },

  glowWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  shopLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  shopLinkText: { fontSize: 14, ...font.bold, color: AC.accent },
})
