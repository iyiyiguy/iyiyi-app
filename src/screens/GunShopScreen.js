import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Modal, Image, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import GunSpinViewer from '../components/GunSpinViewer'
import {
  GUNS, GUN_CATEGORIES, RARITIES, FEATURED_GUN_IDS, setEquippedGun, ensureOwnerUnlocks, gunRatings,
  getGunById, isPaidGun, tagStats, cycleMs, pullsPerSecond, FIRE_MODE_LABELS,
} from '../lib/guns'
import { translate, useT } from '../i18n'
import G from '../i18n/strings/gunShop'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, ArcadePanel as Glass, useArcadeInsets, GhostButton, IconCircle, PlayButton, SectionHeader, arcadeText, useArcadeStatusBar,
} from '../games/arcadeUI'
import { FONT, ST, stType, withAlpha } from '../games/studio'
import { useUavInventory } from '../lib/uav'
import { UavShopCard } from '../games/laser/Uav'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { fetchGunProducts, purchaseGun, restoreGunPurchases, isUserCancelled } from '../lib/iap'
import { gunArt } from '../lib/gunArt'
import { gunSpinFrames } from '../lib/gunSpin'
import { useGrenadeInventory, useGrenadeStore, GRENADE_PACK, GRENADES_PER_MATCH } from '../lib/grenades'
import { useStickyBombInventory, useStickyBombStore, STICKY_BOMB_PACK, STICKY_BOMBS_PER_MATCH } from '../lib/stickyBombs'
import { useLandMineInventory, useLandMineStore, LAND_MINE_PACK, LAND_MINES_PER_MATCH } from '../lib/landMines'
import { isReviewAccount } from '../lib/reviewAccount'

// Kept for existing importers (e.g. the Laser Tag lobby).
export { GUNS }

const FIRE_MODE = FIRE_MODE_LABELS
const tg = (k, v) => translate(G, k, v)
const PAD = 20
const GAP = 12
const HERO_MS = 5000

const rarityOf = (gun) => RARITIES[gun?.rarity] || RARITIES.common
// The free Starter Pistol is the yardstick every stat bar is compared against.
const BASELINE = getGunById('pistol')
const safeFrames = (gun) => { try { return gunSpinFrames(gun) } catch { return null } }

// The Arcade Shop (Armory): buy Laser Tag weapons with real money (one Non-Consumable In-App
// Purchase per gun, lib/iap.js), then equip one. Guns are side-grades (lib/guns.js): the
// inspect view shows each one's trade-off and stat bars against the free Starter Pistol.
// UAV packs and explosive packs are consumable In-App Purchases with per-match use limits
// (lib/uav.js, lib/grenades.js, lib/stickyBombs.js, lib/landMines.js, lib/matchLimits.js). Optional route params (legacy):
// { onGunSelected(gunId), selectedGunId }.
export default function GunShopScreen({ navigation, route }) {
  const { onGunSelected } = route?.params || {}
  const t = useT(G)
  const insets = useArcadeInsets()
  const { width } = useWindowDimensions()
  const [stats, setStats] = useState(null)
  const [owner, setOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState('all')
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)
  const [prices, setPrices] = useState({}) // gunId -> localized store price
  const [pricesLoaded, setPricesLoaded] = useState(false)
  const uav = useUavInventory()
  const grenades = useGrenadeInventory()
  const grenadeStore = useGrenadeStore()
  const stickyBombs = useStickyBombInventory()
  const stickyBombStore = useStickyBombStore()
  const landMines = useLandMineInventory()
  const landMineStore = useLandMineStore()
  const scrollRef = useRef(null)
  const equipY = useRef(0)
  useArcadeStatusBar()

  useFocusEffect(useCallback(() => {
    let alive = true
    ;(async () => {
      const o = await ensureOwnerUnlocks().catch(() => false)
      const s = await loadArcadeStats()
      if (!alive) return
      setOwner(!!o)
      setStats(s)
      const p = await fetchGunProducts().catch(() => ({}))
      if (alive) { setPrices(p || {}); setPricesLoaded(true) }
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
    const tm = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(tm)
  }, [toast])

  const unlocked = stats?.unlockedGuns ?? ['pistol', 'uzi']
  const equipped = stats?.equippedGun ?? 'pistol'
  // The owner owns everything (shown as "Owned", never priced).
  const owns = (g) => owner || unlocked.includes(g.id)
  const equippedGun = GUNS.find((g) => g.id === equipped && unlocked.includes(g.id)) || GUNS[0]
  const ownedCount = owner ? GUNS.length : unlocked.filter((id) => GUNS.some((g) => g.id === id)).length

  const list = useMemo(() => GUNS.filter((g) => category === 'all' || (category === 'owned' ? owner || unlocked.includes(g.id) : g.category === category)), [category, unlocked, owner])
  const featured = useMemo(() => FEATURED_GUN_IDS.map((id) => GUNS.find((g) => g.id === id)).filter(Boolean), [])

  const equip = async (gun) => {
    if (busy) return
    setBusy(true)
    try {
      if (owner && !unlocked.includes(gun.id)) await ensureOwnerUnlocks()
      const ok = await setEquippedGun(gun.id)
      if (ok) {
        buzz('success')
        setToast(t('x_equipped', { name: gun.name }))
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
      if (res.status === 'purchased') await afterUnlock(gun, t('x_unlocked', { name: gun.name }))
      else Alert.alert(t('pending_title'), t('pending_gun'))
    } catch (e) {
      if (!isUserCancelled(e)) {
        buzz('error')
        Alert.alert(t('failed_title'), t('not_charged_retry'))
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
      Alert.alert(ids.length ? t('restored_title') : t('nothing_restore'), ids.length ? t(ids.length === 1 ? 'restored_one' : 'restored_n', { n: ids.length }) : t('no_guns_bought'))
    } finally {
      setBusy(false)
    }
  }

  const buy = (gun) => {
    if (busy) return
    if (owns(gun)) { equip(gun); return }
    const price = prices[gun.id]
    if (!price) {
      Alert.alert(t('not_available'), t('not_in_store', { name: gun.name }))
      return
    }
    buzz('medium')
    buyWithMoney(gun)
  }

  const act = (gun) => (owns(gun) ? equip(gun) : buy(gun))

  const buyStickyBombs = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await stickyBombStore.buy()
      if (res.ok) { buzz('success'); setToast(t('sticky_added', { n: res.count })) }
      else if (res.pending) Alert.alert(t('pending_title'), t('pending_sticky'))
      else if (res.cancelled) { /* noop */ }
      else if (res.error) Alert.alert(t('purchase_failed'), res.error)
    } catch { Alert.alert(t('error'), t('went_wrong')) }
    setBusy(false)
  }

  const buyLandMines = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await landMineStore.buy()
      if (res.ok) { buzz('success'); setToast(t('mines_added', { n: res.count })) }
      else if (res.pending) Alert.alert(t('pending_title'), t('pending_mines'))
      else if (res.cancelled) { /* noop */ }
      else if (res.error) Alert.alert(t('purchase_failed'), res.error)
    } catch { Alert.alert(t('error'), t('went_wrong')) }
    setBusy(false)
  }

  const buyGrenades = async () => {
    if (grenadeStore.busy) return
    buzz('medium')
    const res = await grenadeStore.buy()
    if (res?.ok) {
      buzz('success')
      setToast(t('grenades_added', { n: res.count || GRENADE_PACK.count }))
    } else if (res?.cancelled) {
      // silent
    } else if (res?.pending) {
      Alert.alert(t('pending_title'), t('pending_grenades'))
    } else if (res?.error) {
      buzz('error')
      Alert.alert(t('failed_title'), res.error)
    }
  }

  const open = (gun) => { buzz('select'); setDetail(gun) }
  const toStore = () => { buzz('select'); openArcadeStore(navigation) }
  const toEquipment = () => {
    buzz('select')
    try { scrollRef.current?.scrollTo({ y: Math.max(0, equipY.current - insets.top - 10), animated: true }) } catch { /* ignore */ }
  }

  const contentW = width - PAD * 2
  const cardW = Math.floor((contentW - GAP) / 2)

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 48 }} showsVerticalScrollIndicator={false}>
        <View style={styles.pad}>
          {/* Header */}
          <View style={styles.header}>
            <IconCircle icon="chevron-back" label={t('back')} onPress={() => navigation.goBack()} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
              <Text style={styles.headerKicker} numberOfLines={1}>{t('armory')}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>{t('shop')}</Text>
            </View>
            <View style={styles.headerRight}>
              <GrenadePill balance={grenades.balance} owner={grenades.owner || owner} onPress={toEquipment} />
              <UavBalancePill balance={uav.balance} owner={uav.owner || owner} onPress={toStore} />
            </View>
          </View>

          {owner && (
            <View style={styles.ownerBanner}>
              <Ionicons name="key" size={18} color={ST.objective} />
              <Text style={styles.ownerText}>{t('owner_access')}</Text>
            </View>
          )}

          {/* Hero */}
          {featured.length > 0 && (
            <HeroCarousel
              guns={featured}
              width={contentW}
              prices={prices}
              loading={!pricesLoaded}
              owns={owns}
              equippedId={equippedGun.id}
              onOpen={open}
            />
          )}

          {/* Loadout strip */}
          <Pressable onPress={() => navigation.navigate('MyEquip')} accessibilityRole="button" accessibilityLabel={t('my_equip_a11y', { name: equippedGun.name })} style={({ pressed }) => pressed && { opacity: 0.85 }}>
            <View style={styles.loadout}>
              <View style={[styles.loadoutIcon, { borderColor: rarityOf(equippedGun).color + '66' }]}>
                <Image source={gunArt(equippedGun)} style={styles.loadoutImg} resizeMode="contain" fadeDuration={0} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.loadoutLabel}>{t('equipped_caps')}</Text>
                <Text style={styles.loadoutName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{equippedGun.name}</Text>
              </View>
              <View style={styles.ownedBox}>
                <Text style={styles.ownedNum}>{ownedCount}<Text style={styles.ownedOf}>/{GUNS.length}</Text></Text>
                <Text style={styles.ownedLabel}>{t('owned_caps')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={AC.faint} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>
        </View>

        {/* Category tabs */}
        <SectionHeader title={t('weapons')} style={styles.pad} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {[...GUN_CATEGORIES, { id: 'owned', name: t('owned') }].map((c) => {
            const active = category === c.id
            return (
              <Pressable
                key={c.id}
                onPress={() => { buzz('select'); setCategory(c.id) }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{c.name.toUpperCase()}</Text>
                {active && <View style={styles.tabUnderline} />}
              </Pressable>
            )
          })}
        </ScrollView>

        {/* Weapon grid */}
        <View style={[styles.pad, styles.grid]}>
          {list.map((g) => (
            <WeaponCard
              key={g.id}
              gun={g}
              width={cardW}
              price={prices[g.id]}
              loading={!pricesLoaded}
              owned={owns(g)}
              equipped={equippedGun.id === g.id}
              onPress={() => open(g)}
            />
          ))}
        </View>
        {list.length === 0 && <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 8 }]}>{t('nothing_yet')}</Text>}

        {/* Equipment */}
        <View onLayout={(e) => { equipY.current = e.nativeEvent.layout.y }}>
          <SectionHeader title={t('equipment')} action={t('arcade_store')} onAction={toStore} style={styles.pad} />
          <View style={styles.pad}>
            <UavShopCard balance={uav.balance} owner={uav.owner || owner} onOpenStore={toStore} />
            <GrenadeCard
              balance={grenades.balance}
              owner={grenades.owner || owner}
              store={grenadeStore}
              onBuy={buyGrenades}
            />
            <StickyBombCard
              balance={stickyBombs.balance}
              owner={stickyBombs.owner || owner}
              store={stickyBombStore}
              onBuy={buyStickyBombs}
            />
            <LandMineCard
              balance={landMines.balance}
              owner={landMines.owner || owner}
              store={landMineStore}
              onBuy={buyLandMines}
            />
          </View>
        </View>

        {/* Footer */}
        <View style={[styles.pad, { marginTop: 18 }]}>
          <Pressable onPress={restore} disabled={busy} hitSlop={10} accessibilityRole="button" style={({ pressed }) => [styles.restore, (pressed || busy) && { opacity: 0.6 }]}>
            <Ionicons name="refresh" size={14} color={AC.text} />
            <Text style={styles.restoreText}>{t('restore')}</Text>
          </Pressable>
          <Text style={styles.footer}>{t('side_grade')}</Text>
          <Text style={styles.footer}>{t('one_time')}</Text>
        </View>
      </ScrollView>

      <InspectModal
        gun={detail}
        owned={detail ? owns(detail) : false}
        equipped={detail ? equippedGun.id === detail.id : false}
        price={detail ? prices[detail.id] : null}
        loading={!pricesLoaded}
        onMoney={() => detail && buyWithMoney(detail)}
        onAct={() => detail && act(detail)}
        busy={busy}
        onClose={() => setDetail(null)}
        insets={insets}
      />

      {toast && (
        <View style={[styles.toastWrap, { top: insets.top + 8 }]} pointerEvents="none">
          <Glass style={styles.toast} accent={ST.health}>
            <Ionicons name="checkmark-circle" size={20} color={ST.health} />
            <Text style={styles.toastText}>{toast}</Text>
          </Glass>
        </View>
      )}
    </View>
  )
}

// Dark panel tinted with the rarity color (top-left) for cards and the hero.
function rarityPanel(gun, strength = 1) {
  const c = rarityOf(gun).color
  const a = (x) => Math.round(Math.min(1, x * strength) * 255).toString(16).padStart(2, '0')
  return [c + a(0.14), ST.ground2, ST.ground2]
}

function priceLabel({ gun, price, owned, equipped, loading }) {
  if (equipped) return { text: tg('equipped'), kind: 'equipped' }
  if (owned) return { text: tg('owned'), kind: 'owned' }
  // Store-sold guns (gun.iap, e.g. the Rocket Launcher with unlockPoints 0, and every other
  // paid gun) are never "Free": the store price, '…' while it loads, else "Coming soon".
  if (gun.iap || isPaidGun(gun)) return price ? { text: price, kind: 'price' } : loading ? { text: '…', kind: 'soon' } : { text: tg('coming_soon'), kind: 'soon' }
  if (!gun.unlockPoints) return { text: tg('free'), kind: 'owned' }
  if (price) return { text: price, kind: 'price' }
  return { text: tg('coming_soon'), kind: 'soon' }
}

function PricePill({ gun, price, owned, equipped, large, loading }) {
  const p = priceLabel({ gun, price, owned, equipped, loading })
  const base = [styles.pill, large && styles.pillLarge]
  if (p.kind === 'price') {
    return (
      <View style={[base, { backgroundColor: ST.objective }]}>
        <Text style={[styles.pillText, large && styles.pillTextLarge, { color: ST.ink }]}>{p.text}</Text>
      </View>
    )
  }
  const look = {
    equipped: { bg: withAlpha(ST.health, 0.12), border: withAlpha(ST.health, 0.6), color: ST.health, icon: 'checkmark-circle' },
    owned: { bg: 'rgba(255,255,255,0.08)', border: AC.border, color: AC.text, icon: null },
    soon: { bg: 'rgba(255,255,255,0.05)', border: AC.border, color: AC.muted, icon: 'time-outline' },
  }[p.kind]
  return (
    <View style={[base, { backgroundColor: look.bg, borderWidth: 1, borderColor: look.border }]}>
      {look.icon ? <Ionicons name={look.icon} size={large ? 14 : 12} color={look.color} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.pillText, large && styles.pillTextLarge, { color: look.color }]} numberOfLines={1}>{p.text}</Text>
    </View>
  )
}

function RarityTag({ gun, solid }) {
  const r = rarityOf(gun)
  return (
    <View style={[styles.rarity, solid ? { backgroundColor: r.color } : { borderColor: r.color + 'aa', borderWidth: 1, backgroundColor: r.color + '1f' }]}>
      <View style={[styles.rarityDot, { backgroundColor: solid ? ST.ink : r.color }]} />
      <Text style={[styles.rarityText, { color: solid ? ST.ink : r.color }]}>{r.name.toUpperCase()}</Text>
    </View>
  )
}

// Soft radial glow made of stacked translucent discs.
function Glow({ color, size, style }) {
  return (
    <View style={[styles.glowWrap, style]} pointerEvents="none">
      {[1, 0.7, 0.45].map((k, i) => (
        <View key={i} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: (size * k) / 2, backgroundColor: color, opacity: 0.08 + i * 0.05 }} />
      ))}
    </View>
  )
}

function GrenadePill({ balance, owner, onPress }) {
  const t = useT(G)
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.gPill, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('grenades_a11y', { n: owner ? t('unlimited_lc') : balance })}>
      <MaterialCommunityIcons name="bomb" size={15} color={ST.objective} />
      {owner ? <MaterialCommunityIcons name="infinity" size={16} color={ST.text} /> : <Text style={styles.gPillText}>{Number(balance || 0).toLocaleString()}</Text>}
    </Pressable>
  )
}

function HeroCarousel({ guns, width, prices, loading, owns, equippedId, onOpen }) {
  const [idx, setIdx] = useState(0)
  const ref = useRef(null)
  const lastTouch = useRef(0)
  const height = Math.round(Math.min(360, Math.max(300, width * 0.92)))

  useEffect(() => {
    if (guns.length < 2) return undefined
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current < HERO_MS) return
      setIdx((i) => {
        const next = (i + 1) % guns.length
        try { ref.current?.scrollTo({ x: next * width, animated: true }) } catch { /* ignore */ }
        return next
      })
    }, HERO_MS)
    return () => clearInterval(t)
  }, [guns.length, width])

  const onEnd = (e) => {
    const x = e?.nativeEvent?.contentOffset?.x || 0
    const i = Math.max(0, Math.min(guns.length - 1, Math.round(x / width)))
    setIdx(i)
  }

  return (
    <View style={{ marginTop: 18 }}>
      <View style={[styles.hero, { width, height }]}>
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => { lastTouch.current = Date.now() }}
          onMomentumScrollEnd={onEnd}
          scrollEventThrottle={16}
        >
          {guns.map((g) => (
            <HeroSlide
              key={g.id}
              gun={g}
              width={width}
              height={height}
              price={prices[g.id]}
              loading={loading}
              owned={owns(g)}
              equipped={equippedId === g.id}
              onOpen={() => { lastTouch.current = Date.now(); onOpen(g) }}
            />
          ))}
        </ScrollView>
        {guns.length > 1 && (
          <View style={styles.dots} pointerEvents="none">
            {guns.map((g, i) => (
              <View key={g.id} style={[styles.dot, i === idx && [styles.dotActive, { backgroundColor: rarityOf(guns[idx]).color }]]} />
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

function HeroSlide({ gun, width, height, price, loading, owned, equipped, onOpen }) {
  const t = useT(G)
  const r = rarityOf(gun)
  const imgW = Math.min(width - 24, 420)
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('inspect_a11y', { name: gun.name })} style={{ width, height }}>
      <LinearGradient colors={rarityPanel(gun, 1.5)} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={StyleSheet.absoluteFill} />
      <Glow color={r.color} size={width * 0.9} style={{ top: -width * 0.12, height: width * 0.75 }} />
      <View style={[styles.heroStripe, { backgroundColor: r.color }]} />
      <View style={styles.heroTop}>
        <View style={styles.heroKickerRow}>
          <Ionicons name="flame" size={12} color={r.color} />
          <Text style={[styles.heroKicker, { color: r.color }]}>{t('featured_caps')}</Text>
        </View>
        <RarityTag gun={gun} solid />
      </View>
      <View style={{ alignItems: 'center', marginTop: 2, zIndex: 2 }}>
        <Image source={gunArt(gun)} style={{ width: imgW, height: imgW / 2 * 0.86 }} resizeMode="contain" fadeDuration={0} />
        <View style={[styles.heroFloor, { width: imgW * 0.6, backgroundColor: r.color }]} />
      </View>
      <LinearGradient colors={[withAlpha(ST.ground2, 0), withAlpha(ST.ground2, 0.94)]} style={styles.heroBottomFade} pointerEvents="none" />
      <View style={styles.heroInfo}>
        <Text style={styles.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{gun.name.toUpperCase()}</Text>
        <Text style={styles.heroDesc} numberOfLines={2}>{gun.description}</Text>
        <View style={styles.heroFoot}>
          <PricePill gun={gun} price={price} loading={loading} owned={owned} equipped={equipped} large />
          <View style={styles.inspectBtn}>
            <Ionicons name="cube-outline" size={15} color={ST.text} />
            <Text style={styles.inspectText}>{t('inspect')}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function WeaponCard({ gun, width, price, loading, owned, equipped, onPress }) {
  const t = useT(G)
  const r = rarityOf(gun)
  const artH = Math.round(width * 0.62)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${gun.name}, ${r.name}. ${priceLabel({ gun, price, owned, equipped, loading }).text}${gun.weakness ? `. ${t('tradeoff', { text: gun.weakness })}` : ''}`}
      style={({ pressed }) => [{ width, marginBottom: GAP }, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <View style={[styles.card, { borderColor: equipped ? ST.health : r.color + '55' }]}>
        <LinearGradient colors={rarityPanel(gun)} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.cardStrip, { backgroundColor: r.color }]} />
        <View style={[styles.cardArt, { height: artH }]}>
          <Glow color={r.color} size={width * 0.85} />
          <Image source={gunArt(gun)} style={{ width: width - 16, height: (width - 16) / 2 }} resizeMode="contain" fadeDuration={0} />
          {!owned && (
            <View style={styles.lock}>
              <Ionicons name="lock-closed" size={11} color="#fff" />
            </View>
          )}
          <View style={styles.cardRarity}>
            <Text style={[styles.cardRarityText, { color: r.color }]}>{r.name.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{gun.name}</Text>
          <View style={styles.cardMetaRow}>
            <Ionicons name={gun.fireMode === 'automatic' ? 'flash' : gun.fireMode === 'burst' ? 'layers' : 'radio-button-on'} size={11} color={AC.faint} />
            <Text style={styles.cardMeta} numberOfLines={1}>{FIRE_MODE[gun.fireMode]}</Text>
          </View>
          <View style={styles.cardFoot}>
            <PricePill gun={gun} price={price} loading={loading} owned={owned} equipped={equipped} />
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function GrenadeCard({ balance, owner, store, onBuy }) {
  const t = useT(G)
  const count = GRENADE_PACK?.count || 10
  return (
    <View style={[styles.gCard]}>
      <View style={styles.gArt}>
        <Glow color={ST.objective} size={110} />
        <MaterialCommunityIcons name="bomb" size={52} color={ST.objective} />
        <View style={[styles.gBadge, { backgroundColor: ST.objective }]}><Text style={styles.gBadgeText}>×{count}</Text></View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.gTitle}>{t('n_grenades', { n: count })}</Text>
        <Text style={styles.gMeta}>{t('grenades_meta', { n: GRENADES_PER_MATCH })}</Text>
        <Text style={styles.gBal}>{owner ? t('unlimited_owner') : t('balance', { n: Number(balance || 0).toLocaleString() })}</Text>
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          {owner ? (
            <GhostButton title={t('unlimited')} icon="infinite" small disabled />
          ) : store.status === 'ready' ? (
            <PlayButton title={store.displayPrice ? t('buy_price', { price: store.displayPrice }) : t('buy')} icon="cart" small busy={store.busy} onPress={onBuy} colors={[ST.objective]} />
          ) : store.status === 'loading' ? (
            <GhostButton title={t('loading')} icon="hourglass-outline" small disabled />
          ) : (
            <GhostButton title={t('coming_soon')} icon="time-outline" small disabled />
          )}
        </View>
      </View>
    </View>
  )
}

function StickyBombCard({ balance, owner, store, onBuy }) {
  const t = useT(G)
  const count = STICKY_BOMB_PACK?.count || 5
  return (
    <View style={[styles.gCard, { borderLeftColor: ST.epic }]}>
      <View style={styles.gArt}>
        <Glow color={ST.epic} size={110} />
        <Image source={require('../../assets/guns/stickybomb.png')} style={{ width: 80, height: 50 }} resizeMode="contain" />
        <View style={[styles.gBadge, { backgroundColor: ST.epic }]}><Text style={styles.gBadgeText}>×{count}</Text></View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.gTitle}>{t('n_sticky', { n: count })}</Text>
        <Text style={styles.gMeta}>{t('sticky_meta', { n: STICKY_BOMBS_PER_MATCH })}</Text>
        <Text style={[styles.gBal, { color: ST.epic }]}>{owner ? t('unlimited_owner') : t('balance', { n: Number(balance || 0).toLocaleString() })}</Text>
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          {owner ? (
            <GhostButton title={t('unlimited')} icon="infinite" small disabled />
          ) : store.status === 'ready' ? (
            <PlayButton title={store.displayPrice ? t('buy_price', { price: store.displayPrice }) : t('buy')} icon="cart" small busy={store.busy} onPress={onBuy} colors={[ST.epic]} />
          ) : store.status === 'loading' ? (
            <GhostButton title={t('loading')} icon="hourglass-outline" small disabled />
          ) : (
            <GhostButton title={t('coming_soon')} icon="time-outline" small disabled />
          )}
        </View>
      </View>
    </View>
  )
}

function LandMineCard({ balance, owner, store, onBuy }) {
  const t = useT(G)
  const count = LAND_MINE_PACK?.count || 5
  return (
    <View style={[styles.gCard, { borderLeftColor: ST.health }]}>
      <View style={styles.gArt}>
        <Glow color={ST.health} size={110} />
        <Image source={require('../../assets/guns/landmine.png')} style={{ width: 80, height: 50 }} resizeMode="contain" />
        <View style={[styles.gBadge, { backgroundColor: ST.health }]}><Text style={styles.gBadgeText}>×{count}</Text></View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.gTitle}>{t('n_mines', { n: count })}</Text>
        <Text style={styles.gMeta}>{t('mines_meta', { n: LAND_MINES_PER_MATCH })}</Text>
        <Text style={[styles.gBal, { color: ST.health }]}>{owner ? t('unlimited_owner') : t('balance', { n: Number(balance || 0).toLocaleString() })}</Text>
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          {owner ? (
            <GhostButton title={t('unlimited')} icon="infinite" small disabled />
          ) : store.status === 'ready' ? (
            <PlayButton title={store.displayPrice ? t('buy_price', { price: store.displayPrice }) : t('buy')} icon="cart" small busy={store.busy} onPress={onBuy} colors={[ST.health]} />
          ) : store.status === 'loading' ? (
            <GhostButton title={t('loading')} icon="hourglass-outline" small disabled />
          ) : (
            <GhostButton title={t('coming_soon')} icon="time-outline" small disabled />
          )}
        </View>
      </View>
    </View>
  )
}

// One stat bar. `base` (0-1) draws a white marker for the free Starter Pistol so every bar
// reads as a trade-off: above the marker = better than the free gun, below = worse.
function StatBar({ label, value, color, base }) {
  const t = useT(G)
  const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100)
  const basePct = Number.isFinite(base) ? Math.round(Math.max(0, Math.min(1, base)) * 100) : null
  const diff = basePct == null ? 0 : pct - basePct
  return (
    <View style={styles.bar} accessible accessibilityLabel={`${label} ${pct}${basePct != null ? `, ${t('starter_pistol_x', { n: basePct })}` : ''}`}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
        {[0.25, 0.5, 0.75].map((tk) => <View key={tk} style={[styles.barTick, { left: `${tk * 100}%` }]} />)}
        {basePct != null ? <View style={[styles.barBase, { left: `${Math.min(98, basePct)}%` }]} /> : null}
      </View>
      <Text style={[styles.barValue, basePct != null && diff !== 0 && { color: diff > 0 ? ST.health : ST.enemy }]}>{basePct != null && Math.abs(diff) >= 3 ? (diff > 0 ? '▲' : '▼') : ''}{pct}</Text>
    </View>
  )
}

function InspectModal({ gun, owned, equipped, price, loading, onMoney, onAct, busy, onClose, insets }) {
  const t = useT(G)
  const { height } = useWindowDimensions()
  const g = gun
  const r = rarityOf(g)
  const viewerH = Math.round(Math.max(240, height * 0.42))
  let ratings = { power: 0, fireRate: 0, accuracy: 0, range: 0 }
  try { if (g) ratings = gunRatings(g) } catch { /* keep zeros */ }
  let base = null
  try { base = g && g.id !== BASELINE.id ? gunRatings(BASELINE) : null } catch { base = null }
  let ttk = null
  try { ttk = g ? tagStats(g) : null } catch { ttk = null }
  let cycle = 0
  try { cycle = g ? cycleMs(g) : 0 } catch { cycle = 0 }
  const frames = useMemo(() => (g ? safeFrames(g) : null), [g])

  return (
    <Modal visible={!!g} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      {g && (
        <View style={styles.inspect}>
          <LinearGradient colors={[r.color + '22', ST.ground, ST.ground]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          <View style={[styles.inspectTop, { paddingTop: insets.top + 8 }]}>
            <IconCircle icon="close" label={t('close')} onPress={onClose} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.inspectKicker}>{t('inspect_caps')}</Text>
            </View>
            <View style={{ width: 42, alignItems: 'flex-end' }} />
          </View>

          <GunSpinViewer gun={g} frames={frames} height={viewerH} />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <RarityTag gun={g} solid />
              <Text style={styles.inspectCat}>{(GUN_CATEGORIES.find((c) => c.id === g.category)?.name || '').toUpperCase()}</Text>
            </View>
            <Text style={styles.inspectName}>{g.name.toUpperCase()}</Text>
            <Text style={styles.inspectDesc}>{g.description}</Text>

            {(g.strength || g.weakness) ? (
              <View style={styles.tradeoff}>
                {g.strength ? (
                  <View style={styles.tradeRow}>
                    <Ionicons name="add-circle" size={15} color={ST.health} />
                    <Text style={styles.tradeText}>{g.strength}</Text>
                  </View>
                ) : null}
                {g.weakness ? (
                  <View style={styles.tradeRow}>
                    <Ionicons name="remove-circle" size={15} color={ST.enemy} />
                    <Text style={styles.tradeText}>{g.weakness}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.inspectPanel}>
              <StatBar label={t('stat_power')} value={ratings.power} base={base?.power} color={r.color} />
              <StatBar label={t('stat_fire_rate')} value={ratings.fireRate} base={base?.fireRate} color={r.color} />
              <StatBar label={t('stat_hip_aim')} value={ratings.accuracy} base={base?.accuracy} color={r.color} />
              <StatBar label={t('stat_range')} value={ratings.range} base={base?.range} color={r.color} />
              {base ? (
                <View style={styles.legend}>
                  <View style={styles.legendMark} />
                  <Text style={styles.legendText}>{t('free_starter')}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.specs}>
              <Spec label={t('spec_mode')} value={FIRE_MODE[g.fireMode]} />
              <Spec label={g.fireMode === 'automatic' ? t('spec_rate') : cycle > 0 ? t('spec_cycle') : t('spec_per_tap')} value={g.fireMode === 'automatic' ? t('rate_short', { n: Math.round(pullsPerSecond(g) * 10) / 10 }) : cycle > 0 ? `${Math.round(cycle / 100) / 10} s` : `${g.shotsPerClick || 1}×`} />
              <Spec label={t('spec_tagout')} value={ttk ? t(ttk.hitsBody === 1 ? 'n_hit' : 'n_hits', { n: ttk.hitsBody }) : '—'} />
              <Spec label={t('stat_range')} value={`${g.range} m`} />
            </View>
            {ttk ? (
              <Text style={styles.specNote}>
                {`${t('ttk_note', { body: ttk.hitsBody, bs: ttk.ttkBody.toFixed(1), head: ttk.hitsHead, hs: ttk.ttkHead.toFixed(1) })}${g.blastRadius ? ` ${t('plus_splash', { n: g.blastRadius })}` : ''} ${t('unlimited_ammo')}`}
              </Text>
            ) : null}
            <Text style={styles.specNote}>{t('side_grade')}</Text>
          </ScrollView>

          <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.actionLabel}>{equipped ? t('in_loadout') : owned ? t('owned_caps') : t('price_caps')}</Text>
              <Text style={styles.actionPrice} numberOfLines={1} adjustsFontSizeToFit>{equipped ? t('equipped') : owned ? t('ready_equip') : price || (loading ? t('loading') : t('coming_soon'))}</Text>
            </View>
            <View style={{ flex: 1.4 }}>
              {equipped ? (
                <GhostButton title={t('equipped')} icon="checkmark-circle" disabled />
              ) : owned ? (
                <PlayButton title={t('equip')} icon="flash" onPress={onAct} busy={busy} />
              ) : price ? (
                <PlayButton title={t('buy_for', { price })} icon="cart" onPress={onMoney} busy={busy} colors={['#ffc94d', '#ff8a3c']} />
              ) : loading ? (
                <GhostButton title={t('loading')} icon="hourglass-outline" disabled />
              ) : (
                <GhostButton title={t('coming_soon')} icon="time-outline" disabled />
              )}
            </View>
          </View>
        </View>
      )}
    </Modal>
  )
}

function Spec({ label, value }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.specLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.specValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 34, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: withAlpha(ST.objective, 0.55) },
  gPillText: { ...DISPLAY, fontSize: 14, color: ST.text, fontVariant: ['tabular-nums'] },

  ownerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: ST.radius, marginTop: 16, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderLeftWidth: 3, borderLeftColor: ST.objective },
  ownerText: { flex: 1, fontFamily: FONT.uiSemi, fontSize: 13, color: ST.text },

  hero: { borderRadius: ST.radius, overflow: 'hidden', borderWidth: 1, borderColor: ST.line, backgroundColor: ST.ground2 },
  heroStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  heroTop: { zIndex: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 },
  heroKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroKicker: { ...LABEL, fontSize: 11, letterSpacing: 2.4 },
  heroFloor: { height: 10, borderRadius: 999, opacity: 0.25, marginTop: -8, transform: [{ scaleY: 0.6 }] },
  heroBottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', zIndex: 1 },
  heroInfo: { position: 'absolute', left: 16, right: 16, bottom: 30, zIndex: 4 },
  heroName: { ...DISPLAY, fontSize: 26, letterSpacing: 1.4, color: ST.text },
  heroDesc: { fontFamily: FONT.uiSemi, fontSize: 13, color: 'rgba(242,244,247,0.78)', marginTop: 4, lineHeight: 18 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  inspectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.5)', borderWidth: 1, borderColor: ST.lineStrong },
  inspectText: { ...DISPLAY, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.text },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 14, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { width: 24 },

  loadout: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginTop: 14, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderLeftWidth: 3, borderLeftColor: ST.health },
  loadoutIcon: { width: 64, height: 44, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.cell, borderWidth: 1 },
  loadoutImg: { width: 58, height: 29 },
  loadoutLabel: { ...LABEL, color: ST.health },
  loadoutName: { ...DISPLAY, fontSize: 16, letterSpacing: 0.6, color: ST.text, marginTop: 2, textTransform: 'uppercase' },
  ownedBox: { alignItems: 'flex-end' },
  ownedNum: { ...DISPLAY, fontSize: 18, color: ST.text, fontVariant: ['tabular-nums'] },
  ownedOf: { fontSize: 13, color: ST.faint },
  ownedLabel: { ...LABEL, fontSize: 9, letterSpacing: 1.4, color: ST.faint },

  tabs: { paddingHorizontal: PAD, gap: 6, paddingBottom: 14 },
  tab: { paddingHorizontal: 14, height: 34, borderRadius: ST.radius, justifyContent: 'center', alignItems: 'center', backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line },
  tabActive: { backgroundColor: ST.friendly, borderColor: ST.friendly },
  tabText: { ...LABEL, fontSize: 12, letterSpacing: 1.6, color: ST.muted },
  tabTextActive: { color: ST.ink },
  tabUnderline: { position: 'absolute', bottom: 0, width: 0, height: 0 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { borderRadius: ST.radius, borderWidth: 1, overflow: 'hidden', backgroundColor: ST.ground2 },
  cardStrip: { height: 2, width: '100%' },
  cardArt: { alignItems: 'center', justifyContent: 'center' },
  cardRarity: { position: 'absolute', top: 8, left: 10 },
  cardRarityText: { ...LABEL, fontSize: 9, letterSpacing: 1.4 },
  lock: { position: 'absolute', top: 7, right: 8, width: 22, height: 22, borderRadius: 2, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 2 },
  cardName: { ...DISPLAY, fontSize: 14, letterSpacing: 0.4, color: ST.text, lineHeight: 18, minHeight: 36, textTransform: 'uppercase' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta: { ...LABEL, color: ST.faint, flexShrink: 1 },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 26, borderRadius: ST.radius, maxWidth: '100%' },
  pillLarge: { paddingHorizontal: 12, height: 34 },
  pillText: { ...DISPLAY, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', fontVariant: ['tabular-nums'] },
  pillTextLarge: { fontSize: 15 },

  rarity: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 6, height: 20, borderRadius: 2 },
  rarityDot: { width: 5, height: 5 },
  rarityText: { ...LABEL, fontSize: 10, letterSpacing: 1.4 },
  glowWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },

  gCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: ST.radius, overflow: 'hidden', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderLeftWidth: 3, borderLeftColor: ST.objective, marginBottom: 10 },
  gArt: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  gBadge: { position: 'absolute', bottom: 2, right: 2, paddingHorizontal: 6, height: 20, justifyContent: 'center', borderRadius: 2 },
  gBadgeText: { ...DISPLAY, fontSize: 12, color: ST.ink, fontVariant: ['tabular-nums'] },
  gTitle: { ...DISPLAY, fontSize: 16, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase' },
  gMeta: { fontFamily: FONT.uiMedium, fontSize: 12, color: ST.muted, lineHeight: 16 },
  gBal: { ...LABEL, fontSize: 11, color: ST.objective },

  restore: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong },
  restoreText: { ...LABEL, fontSize: 12, letterSpacing: 1.6, color: ST.text },
  footer: { fontFamily: FONT.uiMedium, fontSize: 12, color: ST.faint, textAlign: 'center', marginTop: 12, lineHeight: 17 },

  inspect: { flex: 1, backgroundColor: ST.ground },
  inspectTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD },
  inspectKicker: { ...LABEL, fontSize: 11, letterSpacing: 3, color: ST.muted },
  inspectCat: { ...LABEL, fontSize: 11, color: ST.faint },
  inspectName: { ...DISPLAY, fontSize: 28, letterSpacing: 1.2, color: ST.text, marginTop: 8 },
  inspectDesc: { ...stType.body, fontSize: 15, lineHeight: 21, color: ST.muted, marginTop: 4 },
  inspectPanel: { marginTop: 18, padding: 14, gap: 10, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { ...LABEL, width: 72, color: ST.muted },
  barTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.1)' },
  barFill: { height: 6 },
  barTick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: withAlpha(ST.ground, 0.7) },
  barValue: { ...DISPLAY, width: 38, textAlign: 'right', fontSize: 13, color: ST.text, fontVariant: ['tabular-nums'] },
  barBase: { position: 'absolute', top: -2, bottom: -2, width: 2, backgroundColor: '#fff' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  legendMark: { width: 2, height: 10, backgroundColor: '#fff' },
  legendText: { ...LABEL, fontSize: 9, color: ST.faint },
  tradeoff: { marginTop: 14, gap: 6 },
  tradeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tradeText: { flex: 1, fontFamily: FONT.uiSemi, fontSize: 13, lineHeight: 18, color: ST.text },
  specNote: { fontFamily: FONT.uiMedium, fontSize: 12, lineHeight: 17, color: ST.faint, marginTop: 10 },
  specs: { flexDirection: 'row', gap: 6, marginTop: 12 },
  spec: { flex: 1, padding: 8, borderRadius: ST.radius, backgroundColor: ST.cell, gap: 2 },
  specValue: { ...DISPLAY, fontSize: 14, color: ST.text },
  specLabel: { ...LABEL, fontSize: 9, letterSpacing: 1.2, color: ST.faint },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: PAD, paddingTop: 12, borderTopWidth: 1, borderTopColor: ST.line, backgroundColor: withAlpha(ST.ground, 0.97) },
  actionLabel: { ...LABEL, color: ST.faint },
  actionPrice: { ...DISPLAY, fontSize: 18, color: ST.text, marginTop: 2 },

  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50, elevation: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  toastText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: ST.text },
})
