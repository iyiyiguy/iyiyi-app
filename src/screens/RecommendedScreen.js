import { useCallback, useEffect, useState } from 'react'
import { View, FlatList, StyleSheet, Pressable, Text, TextInput } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, font, radii } from '../theme'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import UserCard from '../components/UserCard'
import TagDropdown from '../components/TagDropdown'
import ScopeChips, { scopeLabel } from '../components/ScopeChips'
import SearchField from '../components/SearchField'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { API_URL, supabase } from '../lib/supabase'
import { openProfile } from '../lib/profileNav'
import { matchesTags, matchesSearch } from '../lib/tags'
import { fetchMyProfileCard } from '../lib/myContent'

export default function RecommendedScreen({ navigation }) {
  const [scope, setScope] = useState('local')
  const [layout, setLayout] = useState('grid')
  const [users, setUsers] = useState([])
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTags, setActiveTags] = useState([])
  const [place, setPlace] = useState('')
  const [placeError, setPlaceError] = useState('')
  const { statuses, setStatus } = useFollowStatuses(users)

  // Your own card is pinned first so you can see how you show up.
  useEffect(() => {
    let alive = true
    fetchMyProfileCard().then((p) => { if (alive && p) setMe(p) })
    return () => { alive = false }
  }, [])

  const loadAt = useCallback(async (currentScope, coords) => {
    setLoading(true)
    try {
      const session = (await supabase.auth.getSession()).data?.session
      if (!session?.access_token) throw new Error('Please sign in again')
      const res = await fetch(
        `${API_URL}/api/profiles/discover/recommended?scope=${currentScope}&lat=${coords.latitude}&lng=${coords.longitude}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      const json = await res.json().catch(() => ({}))
      setUsers(Array.isArray(json?.users) ? json.users : [])
    } catch (e) {
      console.warn('Recommended load failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const load = useCallback(async (currentScope) => {
    setLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setPermissionDenied(true)
        setLoading(false)
        return
      }
      setPermissionDenied(false)
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      await loadAt(currentScope, loc.coords)
    } catch (e) {
      console.warn('Recommended load failed', e)
      setLoading(false)
    }
  }, [loadAt])

  const searchPlace = useCallback(async () => {
    if (!place.trim()) return
    setPlaceError('')
    setLoading(true)
    try {
      const results = await Location.geocodeAsync(place.trim())
      if (!results?.length) {
        setPlaceError('Could not find that place')
        return
      }
      await loadAt(scope === 'local' || scope === 'regional' ? 'state' : scope, results[0])
    } catch (e) {
      setPlaceError('Could not find that place')
    } finally {
      setLoading(false)
    }
  }, [place, scope, loadAt])

  useFocusEffect(useCallback(() => { load(scope) }, [scope, load]))

  const query = search.trim()
  const myId = me?.user_id ?? null
  const others = users.filter((u) => u && u.user_id !== myId && matchesTags(u, activeTags) && matchesSearch(u, query))
  const showMe = !!me && matchesTags(me, activeTags) && matchesSearch(me, query)
  const data = showMe ? [me, ...others] : others
  const filtering = !!query || activeTags.length > 0

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="social" />
      <BrandHeader
        title="Recommended"
        subtitle={users.length ? `${users.length} ${users.length === 1 ? 'profile' : 'profiles'} · ${scopeLabel(scope)}` : scopeLabel(scope)}
        right={
          <Pressable
            onPress={() => navigation.navigate('TopProfiles')}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.topButton, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Ionicons name="trophy-outline" size={15} color={colors.ink} />
            <Text style={styles.topButtonText}>Top</Text>
          </Pressable>
        }
      />
      <SearchField style={styles.search} value={search} onChangeText={setSearch} placeholder="Search people or tags" />

      <View style={styles.toolbar}>
        <TagDropdown selected={activeTags} onApply={setActiveTags} />
        <Pressable
          onPress={() => { Haptics.selectionAsync().catch(() => {}); setLayout((l) => (l === 'grid' ? 'list' : 'grid')) }}
          accessibilityRole="button"
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <GlassPanel radius={radii.pill} animateIn={false}>
            <View style={styles.pill}>
              <Ionicons name={layout === 'grid' ? 'list-outline' : 'grid-outline'} size={16} color={colors.text} />
              <Text style={styles.pillText}>{layout === 'grid' ? 'List' : 'Grid'}</Text>
            </View>
          </GlassPanel>
        </Pressable>
        <GlassPanel radius={radii.pill} animateIn={false} style={{ flex: 1 }}>
          <View style={styles.placeRow}>
            <Ionicons name="location-outline" size={16} color={colors.textFaint} />
            <TextInput
              style={styles.placeInput}
              placeholder="City or state"
              placeholderTextColor={colors.textFaint}
              value={place}
              onChangeText={(t) => { setPlace(t); if (placeError) setPlaceError('') }}
              onSubmitEditing={searchPlace}
              returnKeyType="go"
            />
            {place.trim() ? (
              <Pressable onPress={searchPlace} hitSlop={8} style={styles.goButton} accessibilityRole="button" accessibilityLabel="Browse this place">
                <Ionicons name="arrow-forward" size={14} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>
        </GlassPanel>
      </View>
      {placeError ? <Text style={styles.placeError}>{placeError}</Text> : null}

      <ScopeChips value={scope} onChange={setScope} />

      {filtering ? (
        <View style={styles.filterLine}>
          <Text style={styles.filterText} numberOfLines={1}>
            {data.length} {data.length === 1 ? 'match' : 'matches'}
            {activeTags.length ? ` · ${activeTags.join(', ')}` : ''}
          </Text>
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={8} accessibilityRole="button">
            <Text style={styles.filterClear}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        key={layout}
        data={data}
        keyExtractor={(u, i) => String(u.user_id ?? u.id ?? i)}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={layout === 'grid' ? styles.row : undefined}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={loading}
        onRefresh={() => load(scope)}
        renderItem={({ item, index }) => {
          const isSelf = !!myId && item.user_id === myId
          const card = (
            <UserCard
              user={item}
              layout={layout}
              isSelf={isSelf}
              followStatus={statuses[item.user_id]}
              onFollowChange={isSelf ? undefined : setStatus}
              onPress={() => openProfile(navigation, item.user_id)}
            />
          )
          // An odd-length grid's last card would otherwise stretch to full width.
          if (layout === 'grid' && index === data.length - 1 && data.length % 2 === 1) {
            return <View style={styles.lastRow}><View style={{ flex: 1 }}>{card}</View><View style={{ flex: 1 }} /></View>
          }
          return card
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {permissionDenied
              ? 'Location access is off. Enable it in Settings.'
              : filtering
                ? 'No profiles match that search or those tags.'
                : loading ? 'Loading…' : 'No recommended profiles yet at this range.'}
          </Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  search: { marginHorizontal: 16, marginTop: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  pill: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  pillText: { fontSize: 14, ...font.semibold, color: colors.text },
  placeRow: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 4 },
  placeInput: { flex: 1, fontSize: 14, ...font.regular, color: colors.text, paddingVertical: 0 },
  goButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  placeError: { ...type.caption, color: colors.danger, marginHorizontal: 20, marginTop: 4 },
  topButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.text,
    paddingHorizontal: 14, height: 36, borderRadius: radii.pill,
  },
  topButtonText: { color: colors.ink, fontSize: 14, ...font.bold },
  filterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 2 },
  filterText: { ...type.caption, color: colors.textMuted, flex: 1 },
  filterClear: { fontSize: 13, ...font.semibold, color: colors.accent },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 14 },
  row: { gap: 14 },
  lastRow: { flex: 1, flexDirection: 'row', gap: 14 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
