import { useState, useCallback, useEffect, useRef } from 'react'
import { View, FlatList, ScrollView, StyleSheet, Pressable, Text, Modal } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Location from 'expo-location'
import { ensureLocationPermission } from '../lib/locationPermission'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, radii, type, font } from '../theme'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import UserCard from '../components/UserCard'
import { useFollowEverywhere } from '../components/FollowEverywhereSheet'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import TagDropdown from '../components/TagDropdown'
import { SCOPES, scopeLabel } from '../components/ScopeChips'
import SearchField from '../components/SearchField'
import { matchesTags, matchesSearch } from '../lib/tags'
import { API_URL, supabase } from '../lib/supabase'
import { openProfile } from '../lib/profileNav'
import { loadSafeZone, updateSafeZonePresence } from '../lib/safeZone'
import { getPositionFast } from '../lib/location'
import { getCached, setCached } from '../lib/cache'
import { fetchMyProfileCard } from '../lib/myContent'
import MyQRSheet from '../components/MyQRSheet'
import { shareProfileLink } from '../lib/shareLinks'
import { fetchRecommended } from './RecommendedScreen'
import { fetchUnreadActivityCount } from './ActivityScreen'
import { useT } from '../i18n'
import strings from '../i18n/strings/nearby'
import hereStrings from '../i18n/strings/here'
import feStrings from '../i18n/strings/followEverywhere'

// The Here tab: everyone around you, as a list (this screen) or on the map (the Map tab route,
// which shows the same List / Map switch). "Nearby" sorts by distance; "Recommended" is the old
// Discover ranking at the same range. One compact control row keeps the first person high on
// the screen.
//
// Loading: one 10 s timer (Nearby sort only), at most one request in flight, and every
// response is tagged with the sort + range it was asked for, so a slow answer for one range
// can't land under another. The position watcher only records where you are; it triggers a
// fetch only after a real move. Your position is posted when you've moved or a minute passed.
const REFRESH_INTERVAL_MS = 10000
const RECOMMENDED_EVERY_TICKS = 6 // the ranked list changes slowly: once a minute is plenty
const MOVE_REFETCH_M = 40
const POST_MOVE_M = 20
const POST_MAX_AGE_MS = 60000

const metersBetween = (a, b) => {
  if (!a || !b) return Infinity
  const dLat = (b.latitude - a.latitude) * 111320
  const dLng = (b.longitude - a.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}
const cacheKey = (key) => `here:${key}`

// List | Map switch, shared with MapScreen so both halves of the Here tab look the same.
// compact: icons only (the Map header, where space is tight at 360 dp); labels stay for a11y.
export function HereModeToggle({ mode, onChange, style, compact = false }) {
  const t = useT(hereStrings)
  const opts = [
    { key: 'list', icon: 'list', label: t('list'), a11y: t('listA11y') },
    { key: 'map', icon: 'map', label: t('map'), a11y: t('mapA11y') },
  ]
  return (
    <GlassPanel radius={radii.pill} animateIn={false} style={style}>
      <View style={styles.segTrack} accessibilityRole="tablist">
        {opts.map((o) => {
          const active = mode === o.key
          return (
            <Pressable
              key={o.key}
              onPress={() => { if (!active) { Haptics.selectionAsync().catch(() => {}); onChange?.(o.key) } }}
              accessibilityRole="tab"
              accessibilityLabel={o.a11y}
              accessibilityState={{ selected: active }}
              hitSlop={4}
              style={[styles.seg, active && styles.segActive]}
            >
              <Ionicons name={active ? o.icon : `${o.icon}-outline`} size={14} color={active ? colors.ink : colors.textMuted} />
              {compact ? null : <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>{o.label}</Text>}
            </Pressable>
          )
        })}
      </View>
    </GlassPanel>
  )
}

export default function NearbyScreen({ navigation, route }) {
  const t = useT(strings)
  const th = useT(hereStrings)
  const tf = useT(feStrings)
  const [layout, setLayout] = useState('grid')
  const [scope, setScope] = useState('local')
  const [sort, setSort] = useState('nearby') // nearby | recommended
  const viewKey = `${sort}:${scope}`
  const keyRef = useRef(viewKey)
  keyRef.current = viewKey
  const [users, setUsersState] = useState(() => getCached(cacheKey('nearby:local')) ?? [])
  const loadedKeys = useRef(new Set(getCached(cacheKey('nearby:local')) ? ['nearby:local'] : []))
  const [, bumpLoaded] = useState(0)
  const [activeTags, setActiveTags] = useState([])
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [inSafeZone, setInSafeZone] = useState(false)
  const [menu, setMenu] = useState(null) // 'range' | 'sort'
  const [unread, setUnread] = useState(0)
  const [qrOpen, setQrOpen] = useState(false)
  const { statuses, setStatus } = useFollowStatuses(users)

  const lastCoords = useRef(null)
  const lastFetchCoords = useRef(null)
  const lastPost = useRef({ at: 0, coords: null })
  const inFlight = useRef(null) // { key, my }
  const seq = useRef(0)
  const latestByKey = useRef({})

  // Route params: navigate('Nearby', { sort: 'recommended', scope }) (old Discover links land here).
  const paramSort = route?.params?.sort
  const paramScope = route?.params?.scope
  const paramAt = route?.params?.at
  useEffect(() => {
    if (paramSort === 'recommended' || paramSort === 'nearby') setSort(paramSort)
    if (paramScope && SCOPES.some((s) => s.key === paramScope)) setScope(paramScope)
  }, [paramSort, paramScope, paramAt])

  // Fetch the list for whatever sort + range is on screen. Skips when a request for the same
  // view is already running (unless forced); a forced request for a new view supersedes it.
  const runFetch = useCallback(async (coords, { force = false } = {}) => {
    if (!coords) return
    lastCoords.current = coords
    const key = keyRef.current
    // (A request stuck for 20 s no longer blocks the next one.)
    if (inFlight.current && inFlight.current.key === key && !force && Date.now() - inFlight.current.at < 20000) return
    const my = ++seq.current
    latestByKey.current[key] = my
    inFlight.current = { key, my, at: Date.now() }
    const [forSort, forScope] = key.split(':')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData?.session
      if (!session?.access_token) throw new Error('Please sign in again')

      // Inside the safe zone: don't share this position (and the profile is hidden).
      await loadSafeZone()
      const inside = updateSafeZonePresence(coords)
      setInSafeZone(inside)
      const now = Date.now()
      if (!inside && (metersBetween(lastPost.current.coords, coords) > POST_MOVE_M || now - lastPost.current.at > POST_MAX_AGE_MS)) {
        lastPost.current = { at: now, coords }
        await fetch(`${API_URL}/api/locations/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
        }).catch(() => { lastPost.current = { at: 0, coords: null } })
      }

      let list
      if (forSort === 'recommended') {
        list = await fetchRecommended(forScope, coords)
      } else {
        const res = await fetch(
          `${API_URL}/api/locations/nearby?latitude=${coords.latitude}&longitude=${coords.longitude}&scope=${forScope}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        )
        if (!res.ok) throw new Error('Could not load nearby users')
        const json = await res.json()
        list = Array.isArray(json?.users) ? json.users.filter(Boolean) : []
      }
      lastFetchCoords.current = coords
      // Cached under the view it was asked for; shown only if that view is still on screen
      // and nothing newer was requested since.
      if (latestByKey.current[key] !== my) return // a newer request for this view was sent
      setCached(cacheKey(key), list)
      loadedKeys.current.add(key)
      if (my === seq.current && key === keyRef.current) {
        setUsersState(list)
        bumpLoaded((n) => n + 1)
      }
    } finally {
      if (inFlight.current?.my === my) inFlight.current = null
    }
  }, [])

  const refresh = useCallback((coords, opts) => runFetch(coords, opts).catch((e) => console.warn('Nearby refresh failed', e?.message ?? e)), [runFetch])

  const manualRefresh = useCallback(async () => {
    setLoading(true)
    try {
      const { status } = await ensureLocationPermission()
      if (status !== 'granted') {
        setPermissionDenied(true)
        return
      }
      setPermissionDenied(false)
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      await runFetch(loc.coords, { force: true })
    } catch (e) {
      console.warn('Manual refresh failed', e)
    } finally {
      setLoading(false)
    }
  }, [runFetch])

  useFocusEffect(
    useCallback(() => {
      let watchSubscription
      let pollTimer
      let cancelled = false
      let ticks = 0

      fetchUnreadActivityCount().then((n) => { if (!cancelled) setUnread(n) })

      const start = async () => {
        try {
          const { status } = await ensureLocationPermission()
          if (cancelled) return
          if (status !== 'granted') {
            setPermissionDenied(true)
            return
          }
          setPermissionDenied(false)

          // Last known position first (instant), then a fresh fix refines the list if it moved.
          const loc = await getPositionFast({ onFresh: (pos) => { if (!cancelled) refresh(pos.coords, { force: true }) } })
          if (cancelled) return
          await refresh(loc.coords, { force: true })
          if (cancelled) return

          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 10000 },
            (update) => {
              if (cancelled) return
              lastCoords.current = update.coords
              if (metersBetween(lastFetchCoords.current, update.coords) > MOVE_REFETCH_M) refresh(update.coords)
            }
          )
          if (cancelled) {
            sub.remove()
            return
          }
          watchSubscription = sub

          pollTimer = setInterval(() => {
            ticks += 1
            if (cancelled || !lastCoords.current) return
            if (keyRef.current.startsWith('recommended') && ticks % RECOMMENDED_EVERY_TICKS !== 0) return
            refresh(lastCoords.current)
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
    }, [refresh])
  )

  // New sort / range: show what we have for it straight away, then ask for the real list.
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    setUsersState(getCached(cacheKey(viewKey)) ?? [])
    if (lastCoords.current) refresh(lastCoords.current, { force: true })
  }, [viewKey, refresh])

  const hasLoadedOnce = loadedKeys.current.has(viewKey)
  const scopeText = scopeLabel(scope)
  const query = search.trim()
  const filtered = users.filter((u) => matchesTags(u, activeTags) && matchesSearch(u, query))
  const filtering = !!query || activeTags.length > 0
  const fe = useFollowEverywhere({ onStatus: setStatus, people: filtered, getStatus: (id) => statuses[id] })

  const subtitle = permissionDenied
    ? t('locationOff')
    : users.length
      ? sort === 'recommended'
        ? th('countRecommended', { n: users.length, scope: scopeText })
        : scope === 'local'
          ? t(users.length === 1 ? 'countOne150' : 'countMany150', { n: users.length })
          : t(users.length === 1 ? 'countOneScope' : 'countManyScope', { n: users.length, scope: scopeText })
      : t('tagline')

  const nextScope = SCOPES[SCOPES.findIndex((s) => s.key === scope) + 1] ?? null
  const shareMine = async () => {
    const me = await fetchMyProfileCard()
    if (me?.username) shareProfileLink(me.username, th('shareMessage'))
  }
  const openMap = () => navigation.navigate('Map')

  const empty = permissionDenied ? (
    <Text style={styles.empty}>{t('emptyLocationOff')}</Text>
  ) : filtering && users.length ? (
    <Text style={styles.empty}>{t('emptyNoMatch')}</Text>
  ) : !hasLoadedOnce ? (
    <Text style={styles.empty}>{scope === 'local' ? t('scanning150') : t('scanningScope', { scope: scopeText })}</Text>
  ) : (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}><Ionicons name="people-outline" size={28} color={colors.accent} /></View>
      <Text style={styles.emptyTitle}>{sort === 'recommended' ? th('emptyRecommended') : th('emptyTitle')}</Text>
      {sort === 'recommended' ? null : (
        <Text style={styles.emptyBody}>{scope === 'local' ? th('emptyBody150') : th('emptyBodyScope')}</Text>
      )}
      <EmptyAction primary icon="qr-code-outline" label={th('showQr')} onPress={() => setQrOpen(true)} />
      <EmptyAction icon="share-outline" label={th('shareLink')} onPress={shareMine} />
      <View style={styles.emptyRow}>
        {nextScope ? (
          <EmptyAction small icon="expand-outline" label={th('widen', { scope: scopeLabel(nextScope.key) })} onPress={() => setScope(nextScope.key)} />
        ) : null}
        <EmptyAction small icon="map-outline" label={th('seeMap')} onPress={openMap} />
      </View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <BrandHeader
        title={th('here')}
        subtitle={subtitle}
        right={(
          <HeaderButton
            icon="notifications-outline"
            label={unread ? th('activityNew', { n: unread }) : t('activity')}
            badge={unread > 0}
            onPress={() => { setUnread(0); navigation.navigate('Activity') }}
          />
        )}
      />

      {/* One compact control row: List/Map · range · sort · search · tags · people you met · layout */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.controls} style={styles.controlsWrap}>
        <HereModeToggle mode="list" onChange={(m) => { if (m === 'map') openMap() }} />
        <Chip
          label={scopeText}
          chevron
          a11y={th('rangeA11y', { scope: scopeText })}
          onPress={() => setMenu('range')}
        />
        <Chip
          icon={sort === 'recommended' ? 'sparkles-outline' : 'navigate-outline'}
          label={sort === 'recommended' ? th('sortRecommended') : th('sortNearby')}
          chevron
          a11y={th('sortA11y', { sort: sort === 'recommended' ? th('sortRecommended') : th('sortNearby') })}
          onPress={() => setMenu('sort')}
        />
        <Chip
          icon={searchOpen ? 'close' : 'search'}
          a11y={searchOpen ? th('closeSearch') : th('search')}
          active={!!query}
          onPress={() => { if (searchOpen) setSearch(''); setSearchOpen((v) => !v) }}
        />
        <TagDropdown selected={activeTags} onApply={setActiveTags} label={th('tags')} title={th('filterTags')} />
        <Chip icon="time-outline" a11y={th('history')} onPress={() => navigation.navigate('History')} />
        <Chip
          icon={layout === 'grid' ? 'list-outline' : 'grid-outline'}
          a11y={layout === 'grid' ? th('showList') : th('showGrid')}
          onPress={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
        />
      </ScrollView>
      {searchOpen ? (
        <SearchField style={styles.search} value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} />
      ) : null}
      {inSafeZone ? (
        <Pressable onPress={() => navigation.navigate('Map', { safeZone: Date.now() })} style={styles.safeBanner} accessibilityRole="button" accessibilityLabel={t('safeZone')}>
          <Ionicons name="shield-checkmark" size={16} color="#3ef08b" />
          <Text style={styles.safeText}>{t('safeZone')}</Text>
        </Pressable>
      ) : null}
      {filtering ? (
        <View style={styles.filterLine}>
          <Text style={styles.filterText} numberOfLines={1}>
            {t(filtered.length === 1 ? 'matchOne' : 'matchMany', { n: filtered.length })}
            {activeTags.length ? ` · ${activeTags.join(', ')}` : ''}
          </Text>
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={8} accessibilityRole="button">
            <Text style={styles.filterClear}>{t('clear')}</Text>
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
        initialNumToRender={6}
        renderItem={({ item, index }) => {
          const card = (
            <UserCard
              user={item}
              layout={layout}
              followStatus={statuses[item.user_id]}
              onFollowChange={setStatus}
              onFollowEverywhere={fe.open}
              distanceHint={sort === 'nearby' && scope === 'local' ? tf('within150') : null}
              onPress={() => openProfile(navigation, item.user_id, item.avatar_url ?? null)}
            />
          )
          // Keep a lone last card in an odd-length grid at half width.
          if (layout === 'grid' && index === filtered.length - 1 && filtered.length % 2 === 1) {
            return <View style={styles.lastRow}><View style={{ flex: 1 }}>{card}</View><View style={{ flex: 1 }} /></View>
          }
          return card
        }}
        ListEmptyComponent={empty}
      />

      <ChoiceMenu
        visible={menu === 'range'}
        title={th('chooseRange')}
        options={SCOPES.map((s) => ({ key: s.key, label: scopeLabel(s.key) }))}
        value={scope}
        onChange={setScope}
        onClose={() => setMenu(null)}
      />
      <ChoiceMenu
        visible={menu === 'sort'}
        title={th('chooseSort')}
        options={[
          { key: 'nearby', label: th('sortNearby'), icon: 'navigate-outline' },
          { key: 'recommended', label: th('sortRecommended'), icon: 'sparkles-outline' },
          { key: 'top', label: th('top'), icon: 'trophy-outline', chevron: true },
        ]}
        value={sort}
        onChange={(k) => (k === 'top' ? navigation.navigate('TopProfiles') : setSort(k))}
        onClose={() => setMenu(null)}
      />
      <MyQRSheet visible={qrOpen} onClose={() => setQrOpen(false)} />
      {fe.element}
    </View>
  )
}

function Chip({ icon, label, chevron, a11y, onPress, active }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.() }}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      hitSlop={4}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
    >
      <GlassPanel radius={radii.pill} animateIn={false} style={active ? styles.chipActive : null}>
        <View style={[styles.chip, !label && styles.chipIcon]}>
          {icon ? <Ionicons name={icon} size={16} color={colors.text} /> : null}
          {label ? <Text style={styles.chipText} numberOfLines={1}>{label}</Text> : null}
          {chevron ? <Ionicons name="chevron-down" size={12} color={colors.textMuted} /> : null}
        </View>
      </GlassPanel>
    </Pressable>
  )
}

function ChoiceMenu({ visible, title, options, value, onChange, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={title} />
      <View style={styles.menuWrap} pointerEvents="box-none">
        <View style={styles.menu}>
          <Text style={styles.menuTitle}>{title}</Text>
          {options.map((o) => {
            const selected = o.key === value
            return (
              <Pressable
                key={o.key}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); onClose(); onChange(o.key) }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={o.label}
                style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
              >
                {o.icon ? <Ionicons name={o.icon} size={18} color={colors.textMuted} /> : null}
                <Text style={[styles.menuText, selected && styles.menuTextOn]}>{o.label}</Text>
                {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : o.chevron ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
              </Pressable>
            )
          })}
        </View>
      </View>
    </Modal>
  )
}

function EmptyAction({ icon, label, onPress, primary, small }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.() }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.emptyAction, primary && styles.emptyPrimary, small && styles.emptySmall, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={icon} size={17} color={primary ? colors.onBrand : colors.text} />
      <Text style={[styles.emptyActionText, primary && { color: colors.onBrand }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.lg, backgroundColor: 'rgba(62,240,139,0.12)', borderWidth: 1, borderColor: 'rgba(62,240,139,0.45)' },
  safeText: { ...type.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  screen: { flex: 1, backgroundColor: 'transparent' },
  controlsWrap: { flexGrow: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  chip: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13 },
  chipIcon: { width: 40, paddingHorizontal: 0, justifyContent: 'center' },
  chipActive: { borderWidth: 1, borderColor: colors.accent },
  chipText: { fontSize: 14, ...font.semibold, color: colors.text, maxWidth: 140 },
  segTrack: { flexDirection: 'row', padding: 3, gap: 2 },
  seg: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: radii.pill },
  segActive: { backgroundColor: colors.text },
  segText: { fontSize: 13, ...font.semibold, color: colors.textMuted },
  segTextActive: { color: colors.ink },
  search: { marginHorizontal: 16, marginTop: 6 },
  filterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 6 },
  filterText: { ...type.caption, color: colors.textMuted, flex: 1 },
  filterClear: { fontSize: 13, ...font.semibold, color: colors.accent },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 14 },
  row: { gap: 14 },
  lastRow: { flex: 1, flexDirection: 'row', gap: 14 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyCard: {
    marginTop: 24, padding: 20, borderRadius: radii.lg, alignItems: 'center', gap: 10,
    backgroundColor: colors.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFillStrong },
  emptyTitle: { ...type.headline, textAlign: 'center' },
  emptyBody: { ...type.caption, textAlign: 'center', marginBottom: 6 },
  emptyRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  emptyAction: {
    alignSelf: 'stretch', minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  emptyPrimary: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  emptySmall: { flex: 1, minHeight: 44, paddingHorizontal: 8 },
  emptyActionText: { fontSize: 15, ...font.semibold, color: colors.text, flexShrink: 1 },
  menuBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuWrap: { flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: 34 },
  menu: { borderRadius: radii.lg, backgroundColor: colors.inkSurfaceRaised, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  menuTitle: { ...type.label, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6 },
  menuRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  menuText: { flex: 1, fontSize: 16, ...font.medium, color: colors.text },
  menuTextOn: { ...font.bold },
})
