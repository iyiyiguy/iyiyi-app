import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Modal, Image, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../components/Glass'
import GunSpinViewer from '../components/GunSpinViewer'
import {
  GUNS, GUN_CATEGORIES, RARITIES, FEATURED_GUN_IDS, setEquippedGun, ensureOwnerUnlocks, gunRatings, fireRateLabel,
} from '../lib/guns'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, useArcadeInsets, GhostButton, IconCircle, PlayButton, SectionHeader, arcadeText, useArcadeStatusBar,
} from '../games/arcadeUI'
import { font } from '../theme'
import { useUavInventory } from '../lib/uav'
import { UavShopCard } from '../games/laser/Uav'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { fetchGunProducts, purchaseGun, restoreGunPurchases, isUserCancelled } from '../lib/iap'
import { gunArt } from '../lib/gunArt'
import { gunSpinFrames } from '../lib/gunSpin'
import { useGrenadeInventory, useGrenadeStore, GRENADE_PACK } from '../lib/grenades'
import { isReviewAccount } from '../lib/reviewAccount'

// Kept for existing importers (e.g. the Laser Tag lobby).
export { GUNS }

const FIRE_MODE = { single: 'Semi-auto', burst: 'Burst', automatic: 'Full-auto' }
const PAD = 20
const GAP = 12
const HERO_MS = 5000

const rarityOf = (gun) => RARITIES[gun?.rarity] || RARITIES.common
const safeFrames = (gun) => { try { return gunSpinFrames(gun) } catch { return null } }

// The Arcade Shop (Armory): buy Laser Tag weapons with real money (one Non-Consumable In-App
// Purchase per gun, lib/iap.js), then equip one. UAV packs and grenade packs are consumable
// In-App Purchases (lib/uav.js, lib/grenades.js). Optional route params (legacy):
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
  const [prices, setPrices] = useState({}) // gunId -> localized store price
  const uav = useUavInventory()
  const grenades = useGrenadeInventory()
  const grenadeStore = useGrenadeStore()
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

  const buyGrenades = async () => {
    if (grenadeStore.busy) return
    buzz('medium')
    const res = await grenadeStore.buy()
    if (res?.ok) {
      buzz('success')
      setToast(`${res.count || GRENADE_PACK.count} grenades added`)
    } else if (res?.cancelled) {
      // silent
    } else if (res?.pending) {
      Alert.alert('Purchase pending', 'Your purchase is waiting for approval. The grenades are added as soon as it goes through.')
    } else if (res?.error) {
      buzz('error')
      Alert.alert('Purchase didn’t go through', res.error)
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
            <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
              <Text style={styles.headerKicker} numberOfLines={1}>ARMORY</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>Shop</Text>
            </View>
            <View style={styles.headerRight}>
              <GrenadePill balance={grenades.balance} owner={grenades.owner || owner} onPress={toEquipment} />
              <UavBalancePill balance={uav.balance} owner={uav.owner || owner} onPress={toStore} />
            </View>
          </View>

          {owner && (
            <LinearGradient colors={['#ffcf5c', '#ff9a3c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ownerBanner}>
              <Ionicons name="key" size={18} color="#3a2200" />
              <Text style={styles.ownerText}>Owner access — every weapon is unlocked on this account.</Text>
            </LinearGradient>
          )}

          {/* Hero */}
          {featured.length > 0 && (
            <HeroCarousel
              guns={featured}
              width={contentW}
              prices={prices}
              owns={owns}
              equippedId={equippedGun.id}
              onOpen={open}
            />
          )}

          {/* Loadout strip */}
          <Pressable onPress={() => open(equippedGun)} accessibilityRole="button" accessibilityLabel={`Equipped: ${equippedGun.name}. Inspect`} style={({ pressed }) => pressed && { opacity: 0.85 }}>
            <View style={styles.loadout}>
              <View style={[styles.loadoutIcon, { borderColor: rarityOf(equippedGun).color + '66' }]}>
                <Image source={gunArt(equippedGun)} style={styles.loadoutImg} resizeMode="contain" fadeDuration={0} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.loadoutLabel}>EQUIPPED</Text>
                <Text style={styles.loadoutName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{equippedGun.name}</Text>
              </View>
              <View style={styles.ownedBox}>
                <Text style={styles.ownedNum}>{ownedCount}<Text style={styles.ownedOf}>/{GUNS.length}</Text></Text>
                <Text style={styles.ownedLabel}>OWNED</Text>
              </View>
            </View>
          </Pressable>
        </View>

        {/* Category tabs */}
        <SectionHeader title="Weapons" style={styles.pad} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {[...GUN_CATEGORIES, { id: 'owned', name: 'Owned' }].map((c) => {
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
              owned={owns(g)}
              equipped={equippedGun.id === g.id}
              onPress={() => open(g)}
            />
          ))}
        </View>
        {list.length === 0 && <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 8 }]}>Nothing here yet.</Text>}

        {/* Equipment */}
        <View onLayout={(e) => { equipY.current = e.nativeEvent.layout.y }}>
          <SectionHeader title="Equipment" action="Arcade Store ›" onAction={toStore} style={styles.pad} />
          <View style={styles.pad}>
            <UavShopCard balance={uav.balance} owner={uav.owner || owner} onOpenStore={toStore} />
            <GrenadeCard
              balance={grenades.balance}
              owner={grenades.owner || owner}
              store={grenadeStore}
              onBuy={buyGrenades}
            />
          </View>
        </View>

        {/* Footer */}
        <View style={[styles.pad, { marginTop: 18 }]}>
          <Pressable onPress={restore} disabled={busy} hitSlop={10} accessibilityRole="button" style={({ pressed }) => [styles.restore, (pressed || busy) && { opacity: 0.6 }]}>
            <Ionicons name="refresh" size={14} color={AC.text} />
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </Pressable>
          <Text style={styles.footer}>Each gun is a one-time purchase and stays unlocked on your Apple ID or Google account.</Text>
        </View>
      </ScrollView>

      <InspectModal
        gun={detail}
        owned={detail ? owns(detail) : false}
        equipped={detail ? equippedGun.id === detail.id : false}
        price={detail ? prices[detail.id] : null}
        onMoney={() => detail && buyWithMoney(detail)}
        onAct={() => detail && act(detail)}
        busy={busy}
        onClose={() => setDetail(null)}
        insets={insets}
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

// Dark panel tinted with the rarity color (top-left) for cards and the hero.
function rarityPanel(gun, strength = 1) {
  const c = rarityOf(gun).color
  const a = (x) => Math.round(Math.min(1, x * strength) * 255).toString(16).padStart(2, '0')
  return [c + a(0.28), '#11142a', '#090b18']
}

function priceLabel({ gun, price, owned, equipped }) {
  if (equipped) return { text: 'Equipped', kind: 'equipped' }
  if (owned) return { text: 'Owned', kind: 'owned' }
  if (!gun.unlockPoints) return { text: 'Free', kind: 'owned' }
  if (price) return { text: price, kind: 'price' }
  return { text: 'Coming soon', kind: 'soon' }
}

function PricePill({ gun, price, owned, equipped, large }) {
  const p = priceLabel({ gun, price, owned, equipped })
  const base = [styles.pill, large && styles.pillLarge]
  if (p.kind === 'price') {
    return (
      <LinearGradient colors={['#ffd76a', '#ff9a3c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={base}>
        <Text style={[styles.pillText, large && styles.pillTextLarge, { color: '#2b1600' }]}>{p.text}</Text>
      </LinearGradient>
    )
  }
  const look = {
    equipped: { bg: 'rgba(47,220,143,0.16)', border: 'rgba(47,220,143,0.55)', color: AC.live, icon: 'checkmark-circle' },
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
      <View style={[styles.rarityDot, { backgroundColor: solid ? '#0b0d1c' : r.color }]} />
      <Text style={[styles.rarityText, { color: solid ? '#0b0d1c' : r.color }]}>{r.name.toUpperCase()}</Text>
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
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.gPill, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Grenades: ${owner ? 'unlimited' : balance}`}>
      <Text style={styles.gPillIcon}>💣</Text>
      <Text style={styles.gPillText}>{owner ? '∞' : Number(balance || 0).toLocaleString()}</Text>
    </Pressable>
  )
}

function HeroCarousel({ guns, width, prices, owns, equippedId, onOpen }) {
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

function HeroSlide({ gun, width, height, price, owned, equipped, onOpen }) {
  const r = rarityOf(gun)
  const imgW = Math.min(width - 24, 420)
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${gun.name}. Inspect`} style={{ width, height }}>
      <LinearGradient colors={rarityPanel(gun, 1.5)} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={StyleSheet.absoluteFill} />
      <Glow color={r.color} size={width * 0.9} style={{ top: -width * 0.12, height: width * 0.75 }} />
      <View style={[styles.heroStripe, { backgroundColor: r.color }]} />
      <View style={styles.heroTop}>
        <View style={styles.heroKickerRow}>
          <Ionicons name="flame" size={12} color={r.color} />
          <Text style={[styles.heroKicker, { color: r.color }]}>FEATURED</Text>
        </View>
        <RarityTag gun={gun} solid />
      </View>
      <View style={{ alignItems: 'center', marginTop: 2 }}>
        <Image source={gunArt(gun)} style={{ width: imgW, height: imgW / 2 * 0.86 }} resizeMode="contain" fadeDuration={0} />
        <View style={[styles.heroFloor, { width: imgW * 0.6, backgroundColor: r.color }]} />
      </View>
      <LinearGradient colors={['rgba(9,11,24,0)', 'rgba(9,11,24,0.92)']} style={styles.heroBottomFade} pointerEvents="none" />
      <View style={styles.heroInfo}>
        <Text style={styles.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{gun.name.toUpperCase()}</Text>
        <Text style={styles.heroDesc} numberOfLines={2}>{gun.description}</Text>
        <View style={styles.heroFoot}>
          <PricePill gun={gun} price={price} owned={owned} equipped={equipped} large />
          <View style={styles.inspectBtn}>
            <Ionicons name="cube-outline" size={15} color="#fff" />
            <Text style={styles.inspectText}>Inspect</Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function WeaponCard({ gun, width, price, owned, equipped, onPress }) {
  const r = rarityOf(gun)
  const artH = Math.round(width * 0.62)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${gun.name}, ${r.name}. ${priceLabel({ gun, price, owned, equipped }).text}`}
      style={({ pressed }) => [{ width, marginBottom: GAP }, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <View style={[styles.card, { borderColor: equipped ? AC.live : r.color + '55', shadowColor: r.color }]}>
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
            <PricePill gun={gun} price={price} owned={owned} equipped={equipped} />
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function GrenadeCard({ balance, owner, store, onBuy }) {
  const count = GRENADE_PACK?.count || 10
  return (
    <View style={[styles.gCard]}>
      <LinearGradient colors={['rgba(255,94,58,0.22)', '#121428', '#0b0d1c']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.gArt}>
        <Glow color="#ff7a3c" size={110} />
        <Text style={styles.gEmoji}>💣</Text>
        <View style={styles.gBadge}><Text style={styles.gBadgeText}>×{count}</Text></View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.gTitle}>{count} Grenades</Text>
        <Text style={styles.gMeta}>Throw grenades in Laser Tag to flush enemies out of cover.</Text>
        <Text style={styles.gBal}>{owner ? 'Unlimited (owner)' : `Balance: ${Number(balance || 0).toLocaleString()}`}</Text>
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          {owner ? (
            <GhostButton title="Unlimited" icon="infinite" small disabled />
          ) : store.status === 'ready' ? (
            <PlayButton title={store.displayPrice ? `Buy · ${store.displayPrice}` : 'Buy'} icon="cart" small busy={store.busy} onPress={onBuy} colors={['#ffc94d', '#ff8a3c']} />
          ) : store.status === 'loading' ? (
            <GhostButton title="Loading…" icon="hourglass-outline" small disabled />
          ) : (
            <GhostButton title="Unavailable" icon="time-outline" small disabled />
          )}
        </View>
      </View>
    </View>
  )
}

function StatBar({ label, value, color }) {
  const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100)
  return (
    <View style={styles.bar}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <LinearGradient colors={[color + '88', color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${pct}%` }]} />
        {[0.25, 0.5, 0.75].map((t) => <View key={t} style={[styles.barTick, { left: `${t * 100}%` }]} />)}
      </View>
      <Text style={styles.barValue}>{pct}</Text>
    </View>
  )
}

function InspectModal({ gun, owned, equipped, price, onMoney, onAct, busy, onClose, insets }) {
  const { height } = useWindowDimensions()
  const g = gun
  const r = rarityOf(g)
  const viewerH = Math.round(Math.max(240, height * 0.42))
  let ratings = { power: 0, fireRate: 0, accuracy: 0, range: 0 }
  try { if (g) ratings = gunRatings(g) } catch { /* keep zeros */ }
  let rate = ''
  try { rate = g ? fireRateLabel(g) : '' } catch { rate = '' }
  const frames = useMemo(() => (g ? safeFrames(g) : null), [g])

  return (
    <Modal visible={!!g} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      {g && (
        <View style={styles.inspect}>
          <LinearGradient colors={[r.color + '33', '#0a0c1c', '#05060f']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          <View style={[styles.inspectTop, { paddingTop: insets.top + 8 }]}>
            <IconCircle icon="close" label="Close" onPress={onClose} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.inspectKicker}>INSPECT</Text>
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

            <View style={styles.inspectPanel}>
              <StatBar label="Power" value={ratings.power} color={r.color} />
              <StatBar label="Fire rate" value={ratings.fireRate} color={r.color} />
              <StatBar label="Accuracy" value={ratings.accuracy} color={r.color} />
              <StatBar label="Range" value={ratings.range} color={r.color} />
            </View>

            <View style={styles.specs}>
              <Spec label="Mode" value={FIRE_MODE[g.fireMode]} />
              <Spec label="Ammo" value="∞" />
              <Spec label={g.fireMode === 'automatic' ? 'Rate' : 'Per tap'} value={g.fireMode === 'automatic' ? rate.replace(' held', '') : `${g.shotsPerClick || 1}×`} />
              <Spec label="Range" value={`${g.range} m`} />
            </View>
          </ScrollView>

          <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.actionLabel}>{equipped ? 'IN YOUR LOADOUT' : owned ? 'OWNED' : 'PRICE'}</Text>
              <Text style={styles.actionPrice} numberOfLines={1} adjustsFontSizeToFit>{equipped ? 'Equipped' : owned ? 'Ready to equip' : price || 'Coming soon'}</Text>
            </View>
            <View style={{ flex: 1.4 }}>
              {equipped ? (
                <GhostButton title="Equipped" icon="checkmark-circle" disabled />
              ) : owned ? (
                <PlayButton title="Equip" icon="flash" onPress={onAct} busy={busy} />
              ) : price ? (
                <PlayButton title={`Buy for ${price}`} icon="cart" onPress={onMoney} busy={busy} colors={['#ffc94d', '#ff8a3c']} />
              ) : (
                <GhostButton title="Coming soon" icon="time-outline" disabled />
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
      <Text style={styles.specValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={styles.specLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: PAD },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  headerTitle: { fontSize: 26, ...font.heavy, color: AC.text, letterSpacing: -0.5 },
  headerKicker: { fontSize: 11, ...font.heavy, color: AC.accent, letterSpacing: 2.4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,138,60,0.16)', borderWidth: 1, borderColor: 'rgba(255,154,60,0.55)' },
  gPillIcon: { fontSize: 13 },
  gPillText: { fontSize: 14, ...font.heavy, color: '#fff' },

  ownerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, marginTop: 16 },
  ownerText: { flex: 1, fontSize: 13, ...font.bold, color: '#3a2200' },

  hero: { borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: '#0b0d1c' },
  heroStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 },
  heroKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroKicker: { fontSize: 11, ...font.heavy, letterSpacing: 2 },
  heroFloor: { height: 10, borderRadius: 999, opacity: 0.25, marginTop: -8, transform: [{ scaleY: 0.6 }] },
  heroBottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },
  heroInfo: { position: 'absolute', left: 16, right: 16, bottom: 30 },
  heroName: { fontSize: 26, ...font.heavy, color: '#fff', letterSpacing: 0.5 },
  heroDesc: { fontSize: 13, color: 'rgba(255,255,255,0.78)', marginTop: 2, lineHeight: 18 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  inspectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  inspectText: { fontSize: 13, ...font.heavy, color: '#fff', letterSpacing: 0.3 },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { width: 18 },

  loadout: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginTop: 14, borderRadius: 18, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  loadoutIcon: { width: 64, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1 },
  loadoutImg: { width: 58, height: 29 },
  loadoutLabel: { fontSize: 10, ...font.heavy, color: AC.live, letterSpacing: 1.6 },
  loadoutName: { fontSize: 16, ...font.heavy, color: AC.text, marginTop: 1 },
  ownedBox: { alignItems: 'flex-end' },
  ownedNum: { fontSize: 18, ...font.heavy, color: AC.text },
  ownedOf: { fontSize: 13, color: AC.faint },
  ownedLabel: { fontSize: 9, ...font.heavy, color: AC.faint, letterSpacing: 1.4 },

  tabs: { paddingHorizontal: PAD, gap: 6, paddingBottom: 14 },
  tab: { paddingHorizontal: 14, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  tabActive: { backgroundColor: 'rgba(124,140,255,0.18)', borderColor: 'rgba(124,140,255,0.7)' },
  tabText: { fontSize: 12, ...font.heavy, color: AC.muted, letterSpacing: 1.2 },
  tabTextActive: { color: '#fff' },
  tabUnderline: { position: 'absolute', bottom: 4, width: 16, height: 2, borderRadius: 1, backgroundColor: AC.accent },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden', backgroundColor: '#0d0f20', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  cardStrip: { height: 3, width: '100%' },
  cardArt: { alignItems: 'center', justifyContent: 'center' },
  cardRarity: { position: 'absolute', top: 8, left: 10 },
  cardRarityText: { fontSize: 9, ...font.heavy, letterSpacing: 1.4 },
  lock: { position: 'absolute', top: 7, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 },
  cardName: { fontSize: 15, ...font.heavy, color: AC.text, lineHeight: 19, minHeight: 38 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardMeta: { fontSize: 11, ...font.semibold, color: AC.faint, letterSpacing: 0.4, flexShrink: 1 },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 26, borderRadius: 13, maxWidth: '100%' },
  pillLarge: { paddingHorizontal: 14, height: 34, borderRadius: 17 },
  pillText: { fontSize: 12, ...font.heavy, letterSpacing: 0.2 },
  pillTextLarge: { fontSize: 15 },

  rarity: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  rarityDot: { width: 5, height: 5, borderRadius: 3 },
  rarityText: { fontSize: 10, ...font.heavy, letterSpacing: 1.2 },
  glowWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  gCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,154,60,0.35)', marginBottom: 12 },
  gArt: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  gEmoji: { fontSize: 52 },
  gBadge: { position: 'absolute', bottom: 2, right: 2, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: '#ff7a3c' },
  gBadgeText: { fontSize: 12, ...font.heavy, color: '#fff' },
  gTitle: { fontSize: 17, ...font.bold, color: AC.text },
  gMeta: { fontSize: 12, color: AC.muted, lineHeight: 16 },
  gBal: { fontSize: 14, ...font.heavy, color: AC.gold },

  restore: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: AC.border },
  restoreText: { fontSize: 13, ...font.bold, color: AC.text },
  footer: { fontSize: 12, color: AC.faint, textAlign: 'center', marginTop: 12, lineHeight: 17 },

  inspect: { flex: 1, backgroundColor: '#05060f' },
  inspectTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD },
  inspectKicker: { fontSize: 11, ...font.heavy, color: AC.muted, letterSpacing: 3 },
  inspectCat: { fontSize: 11, ...font.heavy, color: AC.faint, letterSpacing: 1.6 },
  inspectName: { fontSize: 28, ...font.heavy, color: AC.text, letterSpacing: 0.3, marginTop: 8 },
  inspectDesc: { fontSize: 15, color: AC.muted, lineHeight: 21, marginTop: 4 },
  inspectPanel: { marginTop: 18, padding: 14, gap: 10, borderRadius: 18, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 72, fontSize: 12, ...font.semibold, color: AC.muted },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barTick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(5,6,15,0.6)' },
  barValue: { width: 28, textAlign: 'right', fontSize: 12, ...font.heavy, color: AC.text },
  specs: { flexDirection: 'row', gap: 8, marginTop: 12 },
  spec: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 14, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  specValue: { fontSize: 14, ...font.heavy, color: AC.text },
  specLabel: { fontSize: 10, ...font.semibold, color: AC.faint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: PAD, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(8,9,20,0.96)' },
  actionLabel: { fontSize: 10, ...font.heavy, color: AC.faint, letterSpacing: 1.4 },
  actionPrice: { fontSize: 18, ...font.heavy, color: AC.text, marginTop: 2 },

  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50, elevation: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { fontSize: 14, ...font.bold, color: AC.text },
})

