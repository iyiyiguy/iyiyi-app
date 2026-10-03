import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, Image, Pressable, StyleSheet, FlatList, ActivityIndicator, Platform, useWindowDimensions, Animated,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radii } from '../theme'
import { supabase, API_URL } from '../lib/supabase'
import ScopeChips from '../components/ScopeChips'
import GlassPanel from '../components/GlassPanel'

// Logged-out home: look around before signing up. Square panes of public profiles, distance
// ranges across the top, tap a pane to open that profile, and a floating "Sign up" button in
// the lower middle. Only public profiles are listed (database function guest_explore), and
// guests see ranges of 1 mile and up; 150 ft is for members.
const RANGES = [
  { key: 'mi1', label: '1 mi', m: 1609.34 },
  { key: 'mi5', label: '5 mi', m: 8046.7 },
  { key: 'city', label: 'City', m: 40233.6 },
  { key: 'state', label: 'State', m: 482803 },
  { key: 'nation', label: 'Nation', m: 4000000 },
  { key: 'world', label: 'Worldwide', m: null },
]
const MAX_W = 1100

export default function GuestExploreScreen({ navigation }) {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [range, setRange] = useState('world')
  const [coords, setCoords] = useState(null)
  const [people, setPeople] = useState(null)
  const [total, setTotal] = useState(null)
  const pulse = useRef(new Animated.Value(0)).current

  const contentW = Math.min(width, MAX_W)
  const cols = contentW >= 900 ? 5 : contentW >= 640 ? 4 : 3
  const GAP = 6
  const pad = 12
  const cell = Math.floor((contentW - pad * 2 - GAP * (cols - 1)) / cols)

  useEffect(() => {
    fetch(`${API_URL}/api/public/total-users`).then((r) => r.json()).then((d) => setTotal(d.total_users)).catch(() => {})
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
    ])).start()
  }, [pulse])

  // Location is optional: with it, the nearby ranges work; without it, Worldwide.
  const askLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setCoords(c)
      return c
    } catch {
      return null
    }
  }, [])

  const load = useCallback(async (key, c) => {
    setPeople(null)
    const r = RANGES.find((x) => x.key === key)
    const args = r?.m && c ? { lat: c.lat, lng: c.lng, radius_m: r.m, lim: 90 } : { lim: 90 }
    const { data, error } = await supabase.rpc('guest_explore', args)
    if (!error && Array.isArray(data)) {
      setPeople(data)
      return
    }
    // Older database without guest_explore: fall back to the public showcase.
    try {
      const d = await fetch(`${API_URL}/api/public/showcase`).then((x) => x.json())
      setPeople((d.profiles ?? []).map((p) => ({ ...p, range_label: null })))
    } catch {
      setPeople([])
    }
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
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.logo}>iYiYi</Text>
        <Pressable onPress={() => navigation.navigate('SignIn')} hitSlop={10} accessibilityRole="button" style={styles.loginBtn}>
          <Text style={styles.loginText}>Log in</Text>
        </Pressable>
      </View>
      <Text style={styles.headline}>See who's around.</Text>
      <Text style={styles.sub}>
        {total != null ? `${Number(total).toLocaleString()} people on iYiYi · ` : ''}tap anyone to see their profile and socials
      </Text>
      <ScopeChips options={RANGES} value={range} onChange={pickRange} style={{ marginTop: 14, marginBottom: 12 }} />
    </View>
  )

  const renderItem = ({ item }) => (
    <Pressable
      onPress={() => navigation.navigate('PublicProfile', { username: item.username })}
      style={({ pressed }) => [{ width: cell, height: cell, marginBottom: GAP }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.username}'s profile`}
    >
      <Image source={{ uri: item.avatar_url }} style={styles.paneImg} />
      <LinearGradient colors={['transparent', 'rgba(5,6,14,0.85)']} style={styles.paneShade} pointerEvents="none" />
      <View style={styles.paneInfo} pointerEvents="none">
        <Text style={styles.paneName} numberOfLines={1}>@{item.username}</Text>
        {item.range_label ? <Text style={styles.paneMeta} numberOfLines={1}>{item.range_label}</Text> : null}
      </View>
    </Pressable>
  )

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['#151133', '#0b0d1a', '#07080f']} style={StyleSheet.absoluteFill} />
      <View style={[styles.orb, { backgroundColor: 'rgba(232,62,140,0.22)', top: -80, left: -60 }]} />
      <View style={[styles.orb, { backgroundColor: 'rgba(110,130,255,0.20)', top: 120, right: -90 }]} />
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
        <FlatList
          key={cols}
          data={people ?? []}
          keyExtractor={(p) => String(p.id ?? p.username)}
          numColumns={cols}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: pad }}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            people == null ? (
              <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
            ) : (
              <GlassPanel style={{ marginHorizontal: pad, marginTop: 12 }} animateIn={false} scheme="dark">
                <View style={{ padding: 22, alignItems: 'center' }}>
                  <Text style={styles.emptyTitle}>No one here yet</Text>
                  <Text style={styles.emptySub}>Try a bigger range, or sign up and be the first one in your area.</Text>
                </View>
              </GlassPanel>
            )
          }
          contentContainerStyle={{ paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <Animated.View style={[styles.signupWrap, { bottom: insets.bottom + 28, transform: [{ scale }] }]} pointerEvents="box-none">
        <Pressable
          onPress={() => navigation.navigate('SignIn', { mode: 'signup' })}
          accessibilityRole="button"
          accessibilityLabel="Sign up"
          style={({ pressed }) => [pressed && { opacity: 0.9 }]}
        >
          <LinearGradient colors={['#ff4fa3', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.signup}>
            <Ionicons name="sparkles" size={16} color="#fff" />
            <Text style={styles.signupText}>Sign up free</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07080f', overflow: 'hidden' },
  orb: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.9, ...(Platform.OS === 'web' ? { filter: 'blur(60px)' } : {}) },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  logo: { fontSize: 28, ...font.heavy, color: '#fff', letterSpacing: -0.8 },
  loginBtn: {
    paddingHorizontal: 16, height: 36, borderRadius: radii.pill, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  loginText: { color: '#fff', fontSize: 14, ...font.semibold },
  headline: { marginTop: 18, fontSize: 30, ...font.heavy, color: '#fff', letterSpacing: -0.8 },
  sub: { marginTop: 6, fontSize: 14, color: 'rgba(255,255,255,0.65)' },
  paneImg: { ...StyleSheet.absoluteFillObject, borderRadius: 14, backgroundColor: '#1a1d2e' },
  paneShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  paneInfo: { position: 'absolute', left: 8, right: 8, bottom: 7 },
  paneName: { color: '#fff', fontSize: 12, ...font.bold },
  paneMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 1 },
  emptyTitle: { color: colors.text, fontSize: 17, ...font.bold },
  emptySub: { color: colors.textMuted, fontSize: 14, marginTop: 6, textAlign: 'center' },
  signupWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  signup: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 28, height: 54, borderRadius: radii.pill,
    shadowColor: '#ff4fa3', shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  signupText: { color: '#fff', fontSize: 17, ...font.bold, letterSpacing: 0.2 },
})
