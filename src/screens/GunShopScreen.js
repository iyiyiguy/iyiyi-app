import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Modal, Image, useWindowDimensions } from 'react-native'
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
import { fetchGunProducts, purchaseGun, restoreGunPurchases, isUserCancelled } from '../lib/iap'
import { gunArt } from '../lib/gunArt'
import { isReviewAccount } from '../lib/reviewAccount'

// Kept for existing importers (e.g. the Laser Tag lobby).
export { GUNS }

const FIRE_MODE = { single: 'Semi-auto', burst: 'Burst', automatic: 'Full-auto' }

// The Arcade Shop (Armory): buy Laser Tag weapons with real money (one Non-Consumable In-App
// Purchase per gun, lib/iap.js), then equip one. UAV packs are consumable In-App Purchases
// (lib/uav.js). Optional route params (legacy): { onGunSelected(gunId), selectedGunId }.
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
  const [prices, setPrices] = useState({}) // gunId -> localized store price
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
      const p = await fetchGunProducts()
      if (alive) setPrices(p)
      // Re-grant any gun bought with money on this account (new phone, reinstall, interrupted buy).
      // Not for the App Review demo account, which is wiped on every sign-out.
      if (await isReviewAccount()) return
      restoreGunPurchases().then((ids) => { if (ids.length) loadArcadeStats().then((x) => alive && setStats(x)) })
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

  const afterUnlock = async (gun, msg) => {
    buzz('success')
    await setEquippedGun(gun.id)
    setStats(await loadArcadeStats())
    setToast(msg)
    setDetail(null)
    if (onGunSelected) {
      onGunSelected(gun.id)
      navigation.goBack()
    }
  }

  const buyWithMoney = async (gun) => {
    setBusy(true)
    try {
      const res = await purchaseGun(gun.id)
      if (res.status === 'purchased') await afterUnlock(gun, `${gun.name} unlocked & equipped`)
      else Alert.alert('Purchase pending', 'Your purchase is waiting for approval. The gun unlocks as soon as it goes through.')
    } catch (e) {
      if (!isUserCancelled(e)) {
        buzz('error')
        Alert.alert('Purchase didn’t go through', 'You weren’t charged. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setBusy(true)
    try {
      const ids = await restoreGunPurchases()
      setStats(await loadArcadeStats())
      Alert.alert(ids.length ? 'Purchases restored' : 'Nothing to restore', ids.length ? `Restored ${ids.length} gun${ids.length === 1 ? '' : 's'}.` : 'No guns were bought with this Apple ID or Google account.')
    } finally {
      setBusy(false)
    }
  }

  const buy = (gun) => {
    if (busy) return
    if (owns(gun)) { equip(gun); return }
    const price = prices[gun.id]
    if (!price) {
      Alert.alert('Not available yet', `${gun.name} isn’t available in the store right now. Please try again later.`)
      return
    }
    buzz('medium')
    buyWithMoney(gun)
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
              <Image source={gunArt(equippedGun)} style={styles.loadoutImg} resizeMode="contain" />
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
                <Image source={gunArt(g)} style={styles.featImg} resizeMode="contain" />
                <Text style={styles.featName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{g.name}</Text>
                <Text style={styles.featDesc} numberOfLines={2}>{g.description}</Text>
                <View style={styles.featFoot}>
                  <PriceTag gun={g} price={prices[g.id]} owned={owns(g)} equipped={equippedGun.id === g.id} light />
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
            <ItemCard key={g.id} gun={g} price={prices[g.id]} owned={owns(g)} equipped={equippedGun.id === g.id} affordable={!!prices[g.id]} busy={busy} onOpen={() => { buzz('select'); setDetail(g) }} onAct={() => act(g)} />
          ))}
          {list.length === 0 && <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 20 }]}>Nothing here yet.</Text>}
          <Text style={styles.footer}>Each gun is a one-time purchase and stays unlocked on your Apple ID or Google account.</Text>
          <Pressable onPress={restore} disabled={busy} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 10 }}>
            <Text style={[arcadeText.caption, { color: AC.text, fontWeight: '700' }]}>Restore Purchases</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ItemSheet
        gun={detail}
        owned={detail ? owns(detail) : false}
        equipped={detail ? equippedGun.id === detail.id : false}
        price={detail ? prices[detail.id] : null}
        onMoney={() => detail && buyWithMoney(detail)}
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

function PriceTag({ gun, price, owned, equipped, light }) {
  if (equipped) return <Text style={[styles.price, { color: light ? '#fff' : AC.live }]}>✓ Equipped</Text>
  if (owned) return <Text style={[styles.price, { color: light ? '#fff' : AC.text }]}>Owned</Text>
  if (!gun.unlockPoints) return <Text style={[styles.price, { color: light ? '#fff' : AC.text }]}>Free</Text>
  if (price) return <Text style={[styles.price, { color: light ? '#fff' : AC.gold }]}>{price}</Text>
  return <Text style={[styles.price, { color: light ? 'rgba(255,255,255,0.75)' : AC.muted, fontSize: 13 }]}>Coming soon</Text>
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

function ItemCard({ gun, price, owned, equipped, affordable, busy, onOpen, onAct }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [{ marginBottom: 12 }, pressed && { transform: [{ scale: 0.985 }] }]} accessibilityRole="button" accessibilityLabel={`${gun.name} details`}>
      <Glass scheme="dark" radius={24} shadow={false} style={[styles.item, equipped && styles.itemEquipped]}>
        <View style={styles.itemHead}>
          <LinearGradient colors={rarityGradient(gun)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.itemIcon}>
            <Image source={gunArt(gun)} style={styles.itemImg} resizeMode="contain" />
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
            <Text style={styles.itemDesc}>{gun.description}</Text>
          </View>
        </View>
        <Bars gun={gun} />
        <View style={styles.itemFoot}>
          <PriceTag gun={gun} price={price} owned={owned} equipped={equipped} />
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

function ItemSheet({ gun, owned, equipped, price, onMoney, busy, onClose, onAct, bottom }) {
  return (
    <Modal visible={!!gun} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {gun && (
        <View style={[styles.sheetWrap, { paddingBottom: bottom + 12 }]} pointerEvents="box-none">
          <Glass scheme="dark" radius={30} strong style={styles.sheet}>
            <LinearGradient colors={rarityGradient(gun)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sheetArt}>
              <View style={styles.featGlow} />
              <Image source={gunArt(gun)} style={styles.sheetImg} resizeMode="contain" />
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
                price ? (
                  <PlayButton title={`Buy for ${price}`} icon="cart" onPress={onMoney} busy={busy} colors={['#ffc94d', '#ff8a3c']} />
                ) : (
                  <GhostButton title="Coming soon" icon="time-outline" disabled />
                )
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
  loadoutImg: { width: 54, height: 30 },
  loadoutName: { fontSize: 18, ...font.heavy, color: AC.text, marginVertical: 2 },
  feat: { height: 280, borderRadius: 28, padding: 18, overflow: 'hidden' },
  featGlow: { position: 'absolute', width: 240, height: 240, borderRadius: 120, right: -60, top: -60, backgroundColor: 'rgba(255,255,255,0.16)' },
  featImg: { width: '100%', height: 110, marginTop: 6 },
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
  itemImg: { width: 54, height: 30 },
  lock: { position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 17, ...font.bold, color: AC.text, flexShrink: 1 },
  itemMeta: { fontSize: 12, color: AC.muted },
  itemDesc: { fontSize: 13, color: AC.text, opacity: 0.85, marginTop: 6, lineHeight: 18 },
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
  sheetImg: { width: '86%', height: 140 },
  sheetClose: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  specs: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 18 },
  spec: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: AC.card },
  specValue: { fontSize: 14, ...font.heavy, color: AC.text },
  specLabel: { fontSize: 10, ...font.semibold, color: AC.faint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { fontSize: 14, ...font.bold, color: AC.text },
})
