import { useCallback, useEffect, useRef, useState } from 'react'
import { View, FlatList, StyleSheet, Pressable, Text, TextInput } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Location from 'expo-location'
import { ensureLocationPermission } from '../lib/locationPermission'
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
import { getPositionFast } from '../lib/location'
import { getCached, setCached } from '../lib/cache'
import { useT } from '../i18n'
import strings from '../i18n/strings/recommended'

// Ranked people at a scope around a point. Shared with the Here tab (its "Recommended" sort).
// Resolves to a list (possibly empty); throws only when signed out or the request fails.
export async function fetchRecommended(scope, coords) {
  const session = (await supabase.auth.getSession()).data?.session
  if (!session?.access_token) throw new Error('Please sign in again')
  const res = await fetch(
    `${API_URL}/api/profiles/discover/recommended?scope=${scope}&lat=${coords.latitude}&lng=${coords.longitude}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } }
  )
  if (!res.ok) throw new Error('Could not load recommended profiles')
  const json = await res.json().catch(() => ({}))
  return Array.isArray(json?.users) ? json.users.filter(Boolean) : []
}

// The "Recommended" tab route is kept so older links and navigate('Recommended') calls still
// land somewhere sensible: Discover is now the Recommended sort on the Here tab.
export function RecommendedRedirect({ navigation, route }) {
  useFocusEffect(useCallback(() => {
    navigation.navigate('Nearby', { sort: 'recommended', scope: route?.params?.scope, at: Date.now() })
  }, [navigation, route?.params?.scope]))
  return <View style={styles.screen} />
}

export default function RecommendedScreen({ navigation }) {
  const t = useT(strings)
  const [scope, setScope] = useState('local')
  const [layout, setLayout] = useState('grid')
  const [users, setUsersState] = useState(() => getCached('recommended:local') ?? [])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const seqRef = useRef(0)
  const setUsers = useCallback((list, forScope = scopeRef.current) => { setCached(`recommended:${forScope}`, list); setUsersState(list) }, [])
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

  // Any of the fast fix / fresh fix / place lookups can land last: only the newest applies,
  // and only while its scope is still the one on screen.
  const loadAt = useCallback(async (currentScope, coords, viewScope = currentScope) => {
    const my = ++seqRef.current
    setLoading(true)
    try {
      const list = await fetchRecommended(currentScope, coords)
      if (my === seqRef.current && viewScope === scopeRef.current) setUsers(list, viewScope)
    } catch (e) {
      console.warn('Recommended load failed', e)
    } finally {
      if (my === seqRef.current) setLoading(false)
    }
  }, [setUsers])

  useEffect(() => {
    const cached = getCached(`recommended:${scope}`)
    setUsersState(cached ?? [])
  }, [scope])

  const load = useCallback(async (currentScope) => {
    setLoading(true)
    try {
      const { status } = await ensureLocationPermission()
      if (status !== 'granted') {
        setPermissionDenied(true)
        setLoading(false)
        return
      }
      setPermissionDenied(false)
      const loc = await getPositionFast({ onFresh: (pos) => loadAt(currentScope, pos.coords) })
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
        setPlaceError('notFound')
        return
      }
      await loadAt(scope === 'local' || scope === 'regional' ? 'state' : scope, results[0], scope)
    } catch (e) {
      setPlaceError('notFound')
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
        title={t('title')}
        subtitle={users.length ? t(users.length === 1 ? 'countOne' : 'countMany', { n: users.length, scope: scopeLabel(scope) }) : scopeLabel(scope)}
        right={
          <Pressable
            onPress={() => navigation.navigate('TopProfiles')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('topA11y')}
            style={({ pressed }) => [styles.topButton, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Ionicons name="trophy-outline" size={15} color={colors.ink} />
            <Text style={styles.topButtonText}>{t('top')}</Text>
          </Pressable>
        }
      />
      <SearchField style={styles.search} value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} />

      <View style={styles.toolbar}>
        <TagDropdown selected={activeTags} onApply={setActiveTags} />
        <Pressable
          onPress={() => { Haptics.selectionAsync().catch(() => {}); setLayout((l) => (l === 'grid' ? 'list' : 'grid')) }}
          accessibilityRole="button"
          accessibilityLabel={layout === 'grid' ? t('showAsList') : t('showAsGrid')}
          hitSlop={6}
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <GlassPanel radius={radii.pill} animateIn={false}>
            <View style={styles.pill}>
              <Ionicons name={layout === 'grid' ? 'list-outline' : 'grid-outline'} size={16} color={colors.text} />
              <Text style={styles.pillText}>{layout === 'grid' ? t('list') : t('grid')}</Text>
            </View>
          </GlassPanel>
        </Pressable>
        <GlassPanel radius={radii.pill} animateIn={false} style={{ flex: 1 }}>
          <View style={styles.placeRow}>
            <Ionicons name="location-outline" size={16} color={colors.textFaint} />
            <TextInput
              style={styles.placeInput}
              placeholder={t('placePlaceholder')}
              accessibilityLabel={t('placePlaceholder')}
              placeholderTextColor={colors.textFaint}
              value={place}
              onChangeText={(t) => { setPlace(t); if (placeError) setPlaceError('') }}
              onSubmitEditing={searchPlace}
              returnKeyType="go"
            />
            {place.trim() ? (
              <Pressable onPress={searchPlace} hitSlop={8} style={styles.goButton} accessibilityRole="button" accessibilityLabel={t('browsePlace')}>
                <Ionicons name="arrow-forward" size={14} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>
        </GlassPanel>
      </View>
      {placeError ? <Text style={styles.placeError} accessibilityLiveRegion="polite">{t('placeNotFound')}</Text> : null}

      <ScopeChips value={scope} onChange={setScope} />

      {filtering ? (
        <View style={styles.filterLine}>
          <Text style={styles.filterText} numberOfLines={1}>
            {t(data.length === 1 ? 'matchOne' : 'matchMany', { n: data.length })}
            {activeTags.length ? ` · ${activeTags.join(', ')}` : ''}
          </Text>
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('clearFilters')}>
            <Text style={styles.filterClear}>{t('clear')}</Text>
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
              ? t('locationOff')
              : filtering
                ? t('noMatch')
                : loading ? t('loading') : t('empty')}
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
