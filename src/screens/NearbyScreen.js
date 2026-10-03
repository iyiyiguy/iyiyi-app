import { useState, useCallback, useEffect, useRef } from 'react'
import { View, FlatList, StyleSheet, Pressable, Text } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, radii, type, font } from '../theme'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import UserCard from '../components/UserCard'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import TagDropdown from '../components/TagDropdown'
import ScopeChips, { scopeLabel } from '../components/ScopeChips'
import SearchField from '../components/SearchField'
import { matchesTags, matchesSearch } from '../lib/tags'
import { API_URL, supabase } from '../lib/supabase'
import { openProfile } from '../lib/profileNav'
import { loadSafeZone, updateSafeZonePresence } from '../lib/safeZone'

const REFRESH_INTERVAL_MS = 10000 // re-scan even if the user hasn't moved

export default function NearbyScreen({ navigation }) {
  const [layout, setLayout] = useState('grid')
  const [scope, setScope] = useState('local')
  const [users, setUsers] = useState([])
  const [activeTags, setActiveTags] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const { statuses, setStatus } = useFollowStatuses(users)
  const lastCoords = useRef(null)
  const [myName, setMyName] = useState(null)
  const [inSafeZone, setInSafeZone] = useState(false)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // First name / username for the greeting.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const id = data?.session?.user?.id
        if (!id) return
        const { data: p } = await supabase.from('profiles').select('username').eq('id', id).maybeSingle()
        if (alive && p?.username) setMyName(p.username)
      } catch {}
    })()
    return () => { alive = false }
  }, [])

  const pushLocationAndFetch = useCallback(async (coords) => {
    lastCoords.current = coords
    const { data: sessionData } = await supabase.auth.getSession()
    const session = sessionData?.session
    if (!session?.access_token) throw new Error('Please sign in again')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }

    // Inside the safe zone: don't share this position (and the profile is hidden).
    await loadSafeZone()
    const inside = updateSafeZonePresence(coords)
    setInSafeZone(inside)
    if (!inside) {
      await fetch(`${API_URL}/api/locations/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
      })
    }

    const res = await fetch(
      `${API_URL}/api/locations/nearby?latitude=${coords.latitude}&longitude=${coords.longitude}&scope=${scopeRef.current}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    )
    if (!res.ok) throw new Error('Could not load nearby users')
    const json = await res.json()
    setUsers(Array.isArray(json?.users) ? json.users.filter(Boolean) : [])
    setHasLoadedOnce(true)
  }, [])

  const manualRefresh = useCallback(async () => {
    setLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setPermissionDenied(true)
        return
      }
      setPermissionDenied(false)
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      await pushLocationAndFetch(loc.coords)
    } catch (e) {
      console.warn('Manual refresh failed', e)
    } finally {
      setLoading(false)
    }
  }, [pushLocationAndFetch])

  useFocusEffect(
    useCallback(() => {
      let watchSubscription
      let pollTimer
      let cancelled = false
      const refresh = (coords) =>
        pushLocationAndFetch(coords).catch((e) => console.warn('Nearby refresh failed', e?.message ?? e))

      const start = async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (cancelled) return
          if (status !== 'granted') {
            setPermissionDenied(true)
            return
          }
          setPermissionDenied(false)

          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          if (cancelled) return
          await refresh(loc.coords)
          if (cancelled) return

          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 10000 },
            (update) => { if (!cancelled) refresh(update.coords) }
          )
          if (cancelled) {
            // Focus was lost while the watch was starting: don't leak it.
            sub.remove()
            return
          }
          watchSubscription = sub

          pollTimer = setInterval(() => {
            if (!cancelled && lastCoords.current) refresh(lastCoords.current)
          }, REFRESH_INTERVAL_MS)
        } catch (e) {
          console.warn('Location start failed', e)
        }
      }

      start()

      return () => {
        cancelled = true
        watchSubscription?.remove()
        if (pollTimer) clearInterval(pollTimer)
      }
    }, [pushLocationAndFetch])
  )

  useFocusEffect(
    useCallback(() => {
      if (lastCoords.current) pushLocationAndFetch(lastCoords.current).catch(() => {})
    }, [scope, pushLocationAndFetch])
  )

  const scopeText = scopeLabel(scope)
  const query = search.trim()
  const filtered = users.filter((u) => matchesTags(u, activeTags) && matchesSearch(u, query))
  const filtering = !!query || activeTags.length > 0
  const subtitle = permissionDenied
    ? 'Location is off'
    : users.length
      ? `${users.length} ${users.length === 1 ? 'person' : 'people'} ${scope === 'local' ? 'within 150 ft' : `· ${scopeText}`}`
      : 'Who\'s around you today'

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="social" />
      <BrandHeader
        title={myName ? `Hello, ${myName}` : 'Hello'}
        subtitle={subtitle}
        right={<HeaderButton icon="notifications-outline" label="Activity" onPress={() => navigation.navigate('Activity')} />}
      />
      <SearchField
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search people or tags"
      />
      <View style={styles.quickRow}>
        <QuickAction icon="time-outline" label="History" onPress={() => navigation.navigate('History')} />
        <QuickAction
          icon={layout === 'grid' ? 'list-outline' : 'grid-outline'}
          label={layout === 'grid' ? 'List' : 'Grid'}
          onPress={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
        />
        <TagDropdown selected={activeTags} onApply={setActiveTags} />
      </View>
      <ScopeChips value={scope} onChange={setScope} />
      {inSafeZone ? (
        <Pressable onPress={() => navigation.navigate('Map', { safeZone: true })} style={styles.safeBanner} accessibilityRole="button">
          <Ionicons name="shield-checkmark" size={16} color="#3ef08b" />
          <Text style={styles.safeText}>You're in your safe zone. Your profile is hidden from the map and Nearby.</Text>
        </Pressable>
      ) : null}
      {filtering ? (
        <View style={styles.filterLine}>
          <Text style={styles.filterText} numberOfLines={1}>
            {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}
            {activeTags.length ? ` · ${activeTags.join(', ')}` : ''}
          </Text>
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={8} accessibilityRole="button">
            <Text style={styles.filterClear}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        key={layout}
        data={filtered}
        keyExtractor={(u, i) => String(u.user_id ?? u.id ?? i)}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={layout === 'grid' ? styles.row : undefined}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={loading}
        onRefresh={manualRefresh}
        renderItem={({ item, index }) => {
          const card = (
            <UserCard
              user={item}
              layout={layout}
              followStatus={statuses[item.user_id]}
              onFollowChange={setStatus}
              onPress={() => openProfile(navigation, item.user_id)}
            />
          )
          // Keep a lone last card in an odd-length grid at half width.
          if (layout === 'grid' && index === filtered.length - 1 && filtered.length % 2 === 1) {
            return <View style={styles.lastRow}><View style={{ flex: 1 }}>{card}</View><View style={{ flex: 1 }} /></View>
          }
          return card
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {permissionDenied
              ? 'Location access is off. Enable it in Settings to see who\'s nearby.'
              : filtering && users.length
                ? 'No one matches that search or those tags.'
                : hasLoadedOnce
                  ? 'No one nearby right now — check back in a bit.'
                  : `Scanning ${scope === 'local' ? 'within 150 ft' : scopeText}…`}
          </Text>
        }
      />
    </View>
  )
}

function QuickAction({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.() }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
    >
      <GlassPanel radius={radii.pill} animateIn={false}>
        <View style={styles.quick}>
          <Ionicons name={icon} size={16} color={colors.text} />
          <Text style={styles.quickText}>{label}</Text>
        </View>
      </GlassPanel>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.lg, backgroundColor: 'rgba(62,240,139,0.12)', borderWidth: 1, borderColor: 'rgba(62,240,139,0.45)' },
  safeText: { ...type.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  screen: { flex: 1, backgroundColor: 'transparent' },
  search: { marginHorizontal: 16, marginTop: 4 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  quick: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  quickText: { fontSize: 14, ...font.semibold, color: colors.text },
  filterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 2 },
  filterText: { ...type.caption, color: colors.textMuted, flex: 1 },
  filterClear: { fontSize: 13, ...font.semibold, color: colors.accent },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 14 },
  row: { gap: 14 },
  lastRow: { flex: 1, flexDirection: 'row', gap: 14 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
