import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Modal, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../components/Glass'
import {
  GUNS, GUN_CATEGORIES, RARITIES, FEATURED_GUN_IDS, unlockGun, setEquippedGun, ensureOwnerUnlocks, gunRatings, fireRateLabel,
} from '../lib/guns'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, Chip, useArcadeInsets, CoinPill, GhostButton, IconCircle, PlayButton, SectionHeader, arcadeText, useArcadeStatusBar,
} from '../games/arcadeUI'
import { font } from '../theme'
import { useUavInventory } from '../lib/uav'
import { UavShopCard } from '../games/laser/Uav'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'

// Kept for existing importers (e.g. the Laser Tag lobby).
export { GUNS }

const FIRE_MODE = { single: 'Semi-auto', burst: 'Burst', automatic: 'Full-auto' }

// The Arcade Shop (Armory): buy Laser Tag weapons with arcade coins earned by playing,
// then equip one. Weapons are coins-only; the one real-money item is the Laser Tag UAV
// pack (consumable In-App Purchase, see lib/uav.js). Optional route params (legacy):
// { onGunSelected(gunId), selectedGunId }.
export default function GunShopScreen({ navigation, route }) {
  const { onGunSelected } = route?.params || {}
  const insets = useArcadeInsets()
  const { width } = useWindowDimensions()
  const [stats, setStats] = useState(null)
  const [owner, setOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState('all')
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)
  const uav = useUavInventory()
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
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const points = stats?.points ?? 0
  const unlocked = stats?.unlockedGuns ?? ['pistol']
  const equipped = stats?.equippedGun ?? 'pistol'
  // The owner owns everything (shown as "Owned", never priced).
  const owns = (g) => owner || unlocked.includes(g.id)
  const equippedGun = GUNS.find((g) => g.id === equipped && unlocked.includes(g.id)) || GUNS[0]

  const list = useMemo(() => GUNS.filter((g) => category === 'all' || (category === 'owned' ? owner || unlocked.includes(g.id) : g.category === category)), [category, unlocked, owner])
  const featured = GUNS.filter((g) => FEATURED_GUN_IDS.includes(g.id))

  const equip = async (gun) => {
    if (busy) return
    setBusy(true)
    try {
      if (owner && !unlocked.includes(gun.id)) await ensureOwnerUnlocks()
      const ok = await setEquippedGun(gun.id)
      if (ok) {
        buzz('success')
        setToast(`${gun.name} equipped`)
        setDetail(null)
        if (onGunSelected) {
          onGunSelected(gun.id)
          navigation.goBack()
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const buy = (gun) => {
    if (busy) return
    if (owns(gun)) { equip(gun); return }
    if (points < gun.unlockPoints) {
      buzz('error')
      Alert.alert(
        'Not enough coins',
        `${gun.name} costs ${gun.unlockPoints.toLocaleString()} coins. You have ${points.toLocaleString()} — ${(gun.unlockPoints - points).toLocaleString()} to go. Earn coins by playing any arcade game.`,
      )
      return
    }
    buzz('medium')
    Alert.alert('Confirm purchase', `Buy ${gun.name} for ${gun.unlockPoints.toLocaleString()} coins?\n\nBalance after: ${(points - gun.unlockPoints).toLocaleString()} coins.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Buy & equip',
        onPress: async () => {
          setBusy(true)
          try {
            const res = await unlockGun(gun.id)
            if (res.ok) {
              buzz('success')
              await setEquippedGun(gun.id)
              setToast(`${gun.name} unlocked & equipped`)
              setDetail(null)
              if (onGunSelected) {
                onGunSelected(gun.id)
                navigation.goBack()
              }
            } else {
              buzz('error')
              Alert.alert('Not enough coins', `You need ${(res.needed ?? gun.unlockPoints).toLocaleString()} more coins.`)
            }
          } catch {
            buzz('error')
            Alert.alert('Purchase failed', 'Something went wrong. Your coins weren’t spent — please try again.')
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const act = (gun) => (owns(gun) ? equip(gun) : buy(gun))
  const featW = Math.min(320, width - 80)

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.pad}>
          <View style={styles.header}>
            <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.headerKicker}>ARCADE</Text>
              <Text style={styles.headerTitle}>Shop</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <UavBalancePill balance={uav.balance} owner={uav.owner || owner} onPress={() => { buzz('select'); openArcadeStore(navigation) }} />
              <CoinPill value={stats ? points : null} compact />
            </View>
          </View>

          {owner && (
            <LinearGradient colors={['#ffcf5c', '#ff9a3c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ownerBanner}>
              <Ionicons name="key" size={18} color="#3a2200" />
              <Text style={styles.ownerText}>Owner access — every weapon is unlocked on this account.</Text>
            </LinearGradient>
          )}

          {/* Loadout */}
          <Glass scheme="dark" radius={24} shadow={false} style={styles.loadout}>
            <LinearGradient colors={rarityGradient(equippedGun)} style={styles.loadoutIcon}>
              <Text style={styles.loadoutGlyph}>{equippedGun.icon}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={arcadeText.label}>Equipped for Laser Tag</Text>
              <Text style={styles.loadoutName} numberOfLines={1}>{equippedGun.name}</Text>
              <Text style={arcadeText.caption}>{owner ? GUNS.length : unlocked.filter((id) => GUNS.some((g) => g.id === id)).length} of {GUNS.length} weapons owned</Text>
            </View>
          </Glass>
        </View>

        <SectionHeader title="UAVs" action="Arcade Store ›" onAction={() => { buzz("select"); openArcadeStore(navigation) }} style={styles.pad} />
        <View style={styles.pad}>
          <UavShopCard balance={uav.balance} owner={uav.owner || owner} onOpenStore={() => { buzz('select'); openArcadeStore(navigation) }} />
        </View>

        <SectionHeader title="Featured" style={styles.pad} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={featW + 12} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
          {featured.map((g) => (
            <Pressable key={g.id} onPress={() => { buzz('select'); setDetail(g) }} style={({ pressed }) => pressed && { transform: [{ scale: 0.98 }] }} accessibilityRole="button" accessibilityLabel={g.name}>
              <LinearGradient colors={rarityGradient(g)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.feat, { width: featW }]}>
                <View style={styles.featGlow} />
                <RarityTag gun={g} light />
                <Text style={styles.featGlyph} allowFontScaling={false}>{g.icon}</Text>
                <Text style={styles.featName}>{g.name}</Text>
                <Text style={styles.featDesc} numberOfLines={1}>{g.description}</Text>
                <View style={styles.featFoot}>
                  <PriceTag gun={g} owned={owns(g)} equipped={equippedGun.id === g.id} light />
                  <Ionicons name="arrow-forward-circle" size={28} color="#fff" />
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[...GUN_CATEGORIES, { id: 'owned', name: 'Owned' }].map((c) => (
            <Chip key={c.id} label={c.name} active={category === c.id} onPress={() => { buzz('select'); setCategory(c.id) }} />
          ))}
        </ScrollView>

        <View style={styles.pad}>
          {list.map((g) => (
            <ItemCard key={g.id} gun={g} owned={owns(g)} equipped={equippedGun.id === g.id} affordable={points >= g.unlockPoints} busy={busy} onOpen={() => { buzz('select'); setDetail(g) }} onAct={() => act(g)} />
          ))}
          {list.length === 0 && <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 20 }]}>Nothing here yet.</Text>}
          <Text style={styles.footer}>Coins are earned by playing — wins and higher difficulties pay more. Weapons are never sold for real money.</Text>
        </View>
      </ScrollView>

      <ItemSheet
        gun={detail}
        owned={detail ? owns(detail) : false}
        equipped={detail ? equippedGun.id === detail.id : false}
        points={points}
        busy={busy}
        onClose={() => setDetail(null)}
        onAct={() => detail && act(detail)}
        bottom={insets.bottom}
      />

      {toast && (
        <View style={[styles.toastWrap, { top: insets.top + 8 }]} pointerEvents="none">
          <Glass scheme="dark" radius={20} style={styles.toast}>
            <Ionicons name="checkmark-circle" size={20} color={AC.live} />
            <Text style={styles.toastText}>{toast}</Text>
          </Glass>
        </View>
      )}
    </View>
  )
}

function rarityGradient(gun) {
  switch (gun?.rarity) {
    case 'legendary': return ['#ffb547', '#ff5e3a']
    case 'epic': return ['#b46cff', '#5b3bd9']
    case 'rare': return ['#4fa3ff', '#2f5bd9']
    default: return ['#59607d', '#2c3150']
  }
}

function RarityTag({ gun, light }) {
  const r = RARITIES[gun.rarity] || RARITIES.common
  return (
    <View style={[styles.rarity, light ? { backgroundColor: 'rgba(0,0,0,0.28)' } : { borderColor: r.color, borderWidth: 1 }]}>
      <Text style={[styles.rarityText, { color: light ? '#fff' : r.color }]}>{r.name.toUpperCase()}</Text>
    </View>
  )
}

function PriceTag({ gun, owned, equipped, light }) {
  if (equipped) return <Text style={[styles.price, { color: light ? '#fff' : AC.live }]}>✓ Equipped</Text>
  if (owned) return <Text style={[styles.price, { color: light ? '#fff' : AC.text }]}>Owned</Text>
  if (!gun.unlockPoints) return <Text style={[styles.price, { color: light ? '#fff' : AC.text }]}>Free</Text>
  return (
    <View style={styles.priceRow}>
      <View style={styles.coinDot}><Text style={styles.coinGlyph}>◆</Text></View>
      <Text style={[styles.price, { color: light ? '#fff' : AC.gold }]}>{gun.unlockPoints.toLocaleString()}</Text>
    </View>
  )
}

function StatBar({ label, value, color }) {
  return (
    <View style={styles.bar}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(value * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  )
}

function Bars({ gun }) {
  const r = gunRatings(gun)
  const c = RARITIES[gun.rarity]?.color || AC.accent
  return (
    <View style={{ gap: 6 }}>
      <StatBar label="Power" value={r.power} color={c} />
      <StatBar label="Fire rate" value={r.fireRate} color={c} />
      <StatBar label="Accuracy" value={r.accuracy} color={c} />
      <StatBar label="Range" value={r.range} color={c} />
    </View>
  )
}

function ItemCard({ gun, owned, equipped, affordable, busy, onOpen, onAct }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [{ marginBottom: 12 }, pressed && { transform: [{ scale: 0.985 }] }]} accessibilityRole="button" accessibilityLabel={`${gun.name} details`}>
      <Glass scheme="dark" radius={24} shadow={false} style={[styles.item, equipped && styles.itemEquipped]}>
        <View style={styles.itemHead}>
          <LinearGradient colors={rarityGradient(gun)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.itemIcon}>
            <Text style={[styles.itemGlyph, !owned && { opacity: 0.8 }]} allowFontScaling={false}>{gun.icon}</Text>
            {!owned && <View style={styles.lock}><Ionicons name="lock-closed" size={11} color="#fff" /></View>}
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.itemName} numberOfLines={1}>{gun.name}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <RarityTag gun={gun} />
              <Text style={styles.itemMeta} numberOfLines={1}>{FIRE_MODE[gun.fireMode]} · {fireRateLabel(gun)}{gun.free ? ' · Free' : ''}</Text>
            </View>
          </View>
        </View>
        <Bars gun={gun} />
        <View style={styles.itemFoot}>
          <PriceTag gun={gun} owned={owned} equipped={equipped} />
          {equipped ? (
            <View style={styles.equippedPill}><Text style={styles.equippedText}>In use</Text></View>
          ) : owned ? (
            <PlayButton title="Equip" icon="flash" small onPress={onAct} disabled={busy} />
          ) : (
            <PlayButton title="Buy" icon="cart" small onPress={onAct} disabled={busy} colors={affordable ? ['#ffc94d', '#ff8a3c'] : ['#4a4f6a', '#363a52']} />
          )}
        </View>
      </Glass>
    </Pressable>
  )
}

function ItemSheet({ gun, owned, equipped, points, busy, onClose, onAct, bottom }) {
  return (
    <Modal visible={!!gun} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {gun && (
        <View style={[styles.sheetWrap, { paddingBottom: bottom + 12 }]} pointerEvents="box-none">
          <Glass scheme="dark" radius={30} strong style={styles.sheet}>
            <LinearGradient colors={rarityGradient(gun)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sheetArt}>
              <View style={styles.featGlow} />
              <Text style={styles.sheetGlyph} allowFontScaling={false}>{gun.icon}</Text>
              <View style={{ position: 'absolute', top: 14, left: 14 }}><RarityTag gun={gun} light /></View>
              <Pressable onPress={onClose} hitSlop={10} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
            </LinearGradient>
            <View style={{ padding: 20 }}>
              <Text style={arcadeText.title}>{gun.name}</Text>
              <Text style={[arcadeText.caption, { marginTop: 2, marginBottom: 14 }]}>{gun.description}</Text>
              <Bars gun={gun} />
              <View style={styles.specs}>
                <Spec label="Mode" value={FIRE_MODE[gun.fireMode]} />
                <Spec label="Ammo" value="∞" />
                <Spec label={gun.fireMode === 'automatic' ? 'Rate' : 'Per tap'} value={gun.fireMode === 'automatic' ? fireRateLabel(gun).replace(' held', '') : `${gun.shotsPerClick || 1}×`} />
                <Spec label="Range" value={`${gun.range} m`} />
              </View>
              {equipped ? (
                <GhostButton title="Equipped" icon="checkmark-circle" disabled />
              ) : owned ? (
                <PlayButton title="Equip" icon="flash" onPress={onAct} busy={busy} />
              ) : (
                <>
                  <PlayButton
                    title={`Buy for ${gun.unlockPoints.toLocaleString()} coins`}
                    icon="cart"
                    onPress={onAct}
                    busy={busy}
                    colors={points >= gun.unlockPoints ? ['#ffc94d', '#ff8a3c'] : ['#4a4f6a', '#363a52']}
                  />
                  {points < gun.unlockPoints && (
                    <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 8 }]}>{(gun.unlockPoints - points).toLocaleString()} more coins needed</Text>
                  )}
                </>
              )}
            </View>
          </Glass>
        </View>
      )}
    </Modal>
  )
}

function Spec({ label, value }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.specValue}>{value}</Text>
      <Text style={styles.specLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 24, ...font.heavy, color: AC.text, letterSpacing: -0.5 },
  headerKicker: { fontSize: 11, ...font.heavy, color: AC.accent, letterSpacing: 1.6 },
  ownerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, marginTop: 16 },
  ownerText: { flex: 1, fontSize: 13, ...font.bold, color: '#3a2200' },
  loadout: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginTop: 16 },
  loadoutIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  loadoutGlyph: { fontSize: 32 },
  loadoutName: { fontSize: 18, ...font.heavy, color: AC.text, marginVertical: 2 },
  feat: { height: 250, borderRadius: 28, padding: 18, overflow: 'hidden' },
  featGlow: { position: 'absolute', width: 240, height: 240, borderRadius: 120, right: -60, top: -60, backgroundColor: 'rgba(255,255,255,0.16)' },
  featGlyph: { fontSize: 76, alignSelf: 'center', marginTop: 4 },
  featName: { fontSize: 22, ...font.heavy, color: '#fff', marginTop: 6 },
  featDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  featFoot: { position: 'absolute', left: 18, right: 18, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { paddingHorizontal: 20, gap: 8, paddingTop: 22, paddingBottom: 16 },
  rarity: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  rarityText: { fontSize: 10, ...font.heavy, letterSpacing: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: AC.gold, alignItems: 'center', justifyContent: 'center' },
  coinGlyph: { fontSize: 9, color: '#3a2600', ...font.heavy },
  price: { fontSize: 16, ...font.heavy },
  item: { padding: 16, gap: 14 },
  itemEquipped: { borderWidth: 1.5, borderColor: AC.live },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  itemGlyph: { fontSize: 30 },
  lock: { position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 17, ...font.bold, color: AC.text, flexShrink: 1 },
  itemMeta: { fontSize: 12, color: AC.muted },
  itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  equippedPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(47,220,143,0.16)' },
  equippedText: { fontSize: 13, ...font.bold, color: AC.live },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 70, fontSize: 11, ...font.semibold, color: AC.muted },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  footer: { fontSize: 12, color: AC.faint, textAlign: 'center', marginTop: 8 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: {},
  sheetArt: { height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  sheetGlyph: { fontSize: 96 },
  sheetClose: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  specs: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 18 },
  spec: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: AC.card },
  specValue: { fontSize: 14, ...font.heavy, color: AC.text },
  specLabel: { fontSize: 10, ...font.semibold, color: AC.faint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { fontSize: 14, ...font.bold, color: AC.text },
})
