import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Image, StyleSheet, FlatList, ActivityIndicator, useWindowDimensions } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../theme'
import { supabase, API_URL } from '../lib/supabase'
import { FadeIn, Press, animateLayout } from '../lib/motion'
import ScopeChips from '../components/ScopeChips'
import GlassPanel from '../components/GlassPanel'
import Surface from '../components/Surface'
import Avatar from '../components/Avatar'
import { HeaderButton } from '../components/BrandHeader'
import { useT } from '../i18n'
import strings from '../i18n/strings/guestExplore'

// Logged-out home (the Explore tab of the guest tab bar): look around before signing up.
// Square panes of public profiles, distance ranges across the top, tap a pane to open that
// profile. The floating "Sign up free" pill lives in GuestTabs (App.js) above the tab bar.
// Only public profiles are listed (database function guest_explore); guests see ranges of
// 1 mile and up - 150 ft is for members. Under the grid, three cards say what the app does,
// so the screen never looks empty where few people have joined yet.
// Word labels (City, State, ...) are translated inside ScopeChips; distances stay as-is.
const RANGES = [
  { key: 'mi1', label: '1 mi', m: 1609.34 },
  { key: 'mi5', label: '5 mi', m: 8046.7 },
  { key: 'city', label: 'City', m: 40233.6 },
  { key: 'state', label: 'State', m: 482803 },
  { key: 'nation', label: 'Nation', m: 4000000 },
  { key: 'world', label: 'Worldwide', m: null },
]
const MAX_W = 1100
const ICON = require('../../assets/icon.png')

const FEATURES = [
  // title / text are keys in strings/guestExplore.js.
  { icon: 'map', colors: ['#6b7cff', '#9b8cff'], title: 'featMapTitle', text: 'featMapText' },
  { icon: 'camera', colors: ['#ff6fb5', '#ff9fd0'], title: 'featCameraTitle', text: 'featCameraText' },
  { icon: 'game-controller', colors: ['#4fd1c5', '#7fb3ff'], title: 'featArcadeTitle', text: 'featArcadeText' },
  { icon: 'link', colors: ['#ffb16b', '#ff7e9d'], title: 'featFollowTitle', text: 'featFollowText' },
]

// Cache so switching tabs and coming back is instant.
let lastPeople = null
let lastRange = 'world'

export default function GuestExploreScreen({ navigation }) {
  const t = useT(strings)
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [range, setRange] = useState(lastRange)
  const [coords, setCoords] = useState(null)
  const [people, setPeople] = useState(lastPeople)
  const [total, setTotal] = useState(null)
  const reqId = useRef(0)

  const contentW = Math.min(width, MAX_W)
  const cols = contentW >= 900 ? 5 : contentW >= 640 ? 4 : 3
  const GAP = 8
  const pad = 16
  const cell = Math.floor((contentW - pad * 2 - GAP * (cols - 1)) / cols)

  useEffect(() => {
    fetch(`${API_URL}/api/public/total-users`).then((r) => r.json()).then((d) => setTotal(d.total_users)).catch(() => {})
  }, [])

  // Location is optional: with it, the nearby ranges work; without it, Worldwide.
  const askLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') return null
      const last = await Location.getLastKnownPositionAsync().catch(() => null)
      const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setCoords(c)
      return c
    } catch {
      return null
    }
  }, [])

  const load = useCallback(async (key, c) => {
    const id = ++reqId.current
    const r = RANGES.find((x) => x.key === key)
    const args = r?.m && c ? { lat: c.lat, lng: c.lng, radius_m: r.m, lim: 90 } : { lim: 90 }
    let list = null
    const { data, error } = await supabase.rpc('guest_explore', args)
    if (!error && Array.isArray(data)) list = data
    else {
      // Older database without guest_explore: fall back to the public showcase.
      try {
        const d = await fetch(`${API_URL}/api/public/showcase`).then((x) => x.json())
        list = (d.profiles ?? []).map((p) => ({ ...p, range_label: null }))
      } catch {
        list = []
      }
    }
    if (id !== reqId.current) return
    lastPeople = list
    lastRange = key
    animateLayout()
    setPeople(list)
  }, [])

  useEffect(() => { load(range, coords) }, [range, coords, load])

  const pickRange = async (key) => {
    const r = RANGES.find((x) => x.key === key)
    if (r?.m && !coords) {
      const c = await askLocation()
      if (!c) {
        setRange('world')
        return
      }
    }
    setRange(key)
  }

  const header = (
    <View style={{ paddingHorizontal: pad }}>
      <FadeIn style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brandRow}>
          <Image source={ICON} style={styles.brandIcon} />
          <Text style={styles.logo}>iYiYi</Text>
        </View>
        <Press onPress={() => navigation.navigate('SignIn')} accessibilityLabel={t('logIn')} scaleTo={0.95}>
          <GlassPanel radius={999} animateIn={false} interactive>
            <View style={styles.loginBtn}><Text style={styles.loginText}>{t('logIn')}</Text></View>
          </GlassPanel>
        </Press>
      </FadeIn>
      <FadeIn index={1}>
        <Text style={styles.headline}>{t('headline')}</Text>
        <Text style={styles.sub}>
          {total != null ? `${t('peopleOn', { n: Number(total).toLocaleString() })} ` : ''}{t('tapAnyone')}
        </Text>
      </FadeIn>
      <FadeIn index={2}>
        <ScopeChips options={RANGES} value={range} onChange={pickRange} style={{ marginTop: 16, marginBottom: 14 }} />
      </FadeIn>
    </View>
  )

  const footer = (
    <View style={{ paddingHorizontal: pad, paddingTop: people?.length ? 10 : 0 }}>
      <Text style={styles.sectionTitle}>{t('sectionTitle')}</Text>
      {FEATURES.map((f, i) => (
        <FadeIn key={f.title} index={i + 1} enabled={!lastPeople}>
          <GlassPanel radius={radii.lg} style={{ marginBottom: 10 }} lite animateIn={false}>
            <View style={styles.feature}>
              <LinearGradient colors={f.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureIcon}>
                <Ionicons name={f.icon} size={20} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{t(f.title)}</Text>
                <Text style={styles.featureText}>{t(f.text)}</Text>
              </View>
            </View>
          </GlassPanel>
        </FadeIn>
      ))}
    </View>
  )

  const renderItem = ({ item, index }) => (
    <Press
      onPress={() => navigation.navigate('PublicProfile', { username: item.username, avatarUrl: item.avatar_url ?? null })}
      style={{ width: cell, height: cell, marginBottom: GAP }}
      scaleTo={0.96}
      accessibilityLabel={t('openProfile', { name: item.username })}
    >
      <Surface radius={18} style={StyleSheet.absoluteFill} shadow={false}>
        <Avatar uri={item.avatar_url} name={item.username} fill radius={0} recyclingKey={String(item.id ?? item.username)} />
        <LinearGradient colors={['transparent', 'rgba(5,6,14,0.78)']} style={styles.paneShade} pointerEvents="none" />
        <View style={styles.paneInfo} pointerEvents="none">
          <Text style={styles.paneName} numberOfLines={1}>@{item.username}</Text>
          {item.range_label ? <Text style={styles.paneMeta} numberOfLines={1}>{item.range_label}</Text> : null}
        </View>
      </Surface>
    </Press>
  )

  return (
    <View style={styles.screen}>
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
        <FlatList
          key={cols}
          data={people ?? []}
          keyExtractor={(p) => String(p.id ?? p.username)}
          numColumns={cols}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: pad }}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            people == null ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 28 }} />
            ) : (
              <GlassPanel style={{ marginHorizontal: pad, marginBottom: 18 }} animateIn={false} lite>
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
                  <Text style={styles.emptySub}>{t('emptySub')}</Text>
                </View>
              </GlassPanel>
            )
          }
          contentContainerStyle={{ paddingBottom: 150 }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={5}
          removeClippedSubviews
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 34, height: 34, borderRadius: 9 },
  logo: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.8 },
  loginBtn: { paddingHorizontal: 18, height: 38, justifyContent: 'center' },
  loginText: { ...type.subhead, fontWeight: '600', color: colors.text },
  headline: { ...type.largeTitle, marginTop: 14 },
  sub: { ...type.subhead, marginTop: 6 },
  sectionTitle: { ...type.title3, marginBottom: 10 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  featureIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { ...type.headline },
  featureText: { ...type.caption, marginTop: 2 },
  paneShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  paneInfo: { position: 'absolute', left: 9, right: 9, bottom: 8 },
  paneName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  paneMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 1 },
  emptyTitle: { ...type.headline },
  emptySub: { ...type.caption, marginTop: 6, textAlign: 'center' },
})
