import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { getPositionFast } from '../lib/location'
import { getCached, setCached } from '../lib/cache'
import * as Location from 'expo-location'
import { ensureLocationPermission } from '../lib/locationPermission'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import ScopeChips, { SCOPES, Segmented, scopeLabel } from '../components/ScopeChips'
import LiveButton from '../components/LiveButton'
import GlowBackdrop from '../components/GlowBackdrop'
import MasonryGrid from '../components/MasonryGrid'
import FeedScroll from '../components/FeedScroll'
import ContentViewer from '../components/ContentViewer'
import { colors, type } from '../theme'
import { apiJson } from '../lib/api'
import { openLink } from '../lib/socialLinks'
import { openProfile, getMyUserId } from '../lib/profileNav'
import { fetchMyMedia, mergeMine, itemFromMediaRow, prependUnique, withoutMedia } from '../lib/myContent'
import { fetchCountryFeed } from '../lib/countryFeed'
import { countryMatches } from '../lib/countries'
import { onMediaPosted, onMediaRemoved } from '../lib/mediaEvents'
import CountryPicker from '../components/CountryPicker'
import { useT, translate } from '../i18n'
import contentStrings from '../i18n/strings/content'
import scopeStrings from '../i18n/strings/scope'

// "blend" is the algorithmic default: recency while a range is sparse, blending in
// engagement + the paid-tier boost once there's enough content to actually rank.
// "You" sits in front of the distance ranges and shows only your own posts, newest first.
// "Country" sits after the ranges and opens a searchable picker; the feed then shows posts
// from users whose profile country matches.
const feedScopeLabel = (key, country) => {
  if (key === 'mine') return translate(scopeStrings, 'yourPosts')
  if (key === 'country') return country ? `${country.flag} ${country.name}` : translate(scopeStrings, 'country')
  return scopeLabel(key)
}

const GRID_PAGE = 40

const SORTS = [
  { key: 'blend', label: 'For You' },
  { key: 'recent', label: 'Recent' },
  { key: 'popular', label: 'Popular' },
]

const MINE_SORTS = [
  { key: 'recent', label: 'Newest' },
  { key: 'popular', label: 'Most liked' },
]

export default function ContentFeedScreen({ navigation }) {
  const t = useT(contentStrings)
  const [scope, setScope] = useState('local')
  const [sort, setSort] = useState('blend')
  const [layout, setLayout] = useState('grid') // grid | scroll
  const [items, setItemsState] = useState(() => getCached('feed') ?? [])
  const setItems = useCallback((v) => { setItemsState((prev) => { const next = typeof v === 'function' ? v(prev) : v; setCached('feed', next); return next }) }, [])
  const [loading, setLoading] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [viewer, setViewer] = useState({ open: false, index: 0 })
  const [country, setCountry] = useState(null) // { code, name, flag }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [gridLimit, setGridLimit] = useState(GRID_PAGE)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const countryRef = useRef(country)
  countryRef.current = country

  const feedScopes = useMemo(() => [
    { key: 'mine', label: 'You' },
    ...SCOPES,
    {
      key: 'country',
      label: country ? `${country.flag} ${country.name}` : 'Country',
      icon: country ? undefined : 'flag-outline',
      chevron: true,
      onPress: () => setPickerOpen(true),
    },
  ], [country])

  const pickCountry = useCallback((c) => {
    if (c) {
      setCountry(c)
      setScope('country')
    } else {
      setCountry(null)
      if (scopeRef.current === 'country') setScope('global')
    }
  }, [])

  // A camera post shows up right away (the focus refresh then confirms it from the server).
  useEffect(() => {
    let alive = true
    const off = onMediaPosted(async (row) => {
      const item = await itemFromMediaRow(row)
      if (!alive || !item) return
      if (scopeRef.current === 'country' && !countryMatches(item.owner_country, countryRef.current)) return
      setItems((prev) => prependUnique(prev, { ...item, is_mine: true }))
    })
    return () => { alive = false; off?.() }
  }, [])

  // A post you deleted (from the viewer here or anywhere else) leaves the feed right away.
  useEffect(() => onMediaRemoved((id) => setItems((prev) => withoutMedia(prev, id))), [setItems])

  // Your own posts are fetched alongside the feed and merged in by time, so you always see
  // what you've shared (the server's content_feed excludes your own rows). They're fetched in
  // parallel and nothing else - no location, feed error or timeout - can drop them: each
  // step falls back to showing at least your posts.
  const loadSeq = useRef(0)
  const load = useCallback(async (s, sortKey, ctry) => {
    const seq = ++loadSeq.current
    const current = () => seq === loadSeq.current
    setLoading(true)
    const minePromise = Promise.all([fetchMyMedia(s === 'mine' ? 300 : 30), getMyUserId()]).catch(() => [[], null])
    try {
      if (s === 'mine') {
        const [mine] = await minePromise
        if (!current()) return
        const list = Array.isArray(mine) ? mine : []
        setItems(sortKey === 'popular'
          ? [...list].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
          : list)
        return
      }
      let coords = null
      try {
        const { status } = await ensureLocationPermission()
        if (status !== 'granted') {
          if (current()) setPermissionDenied(s !== 'country')
        } else {
          if (current()) setPermissionDenied(false)
          const loc = await getPositionFast().catch(() => null)
          if (loc?.coords && Number.isFinite(loc.coords.latitude) && Number.isFinite(loc.coords.longitude)) coords = loc.coords
        }
      } catch (e) {
        console.warn('Feed location failed', e?.message ?? e)
      }
      if (s === 'country') {
        const list = ctry ? await fetchCountryFeed(ctry, { coords, sort: sortKey }) : []
        if (current()) setItems(list)
        return
      }
      const [data, [mine, myId]] = await Promise.all([
        coords
          ? apiJson(`/api/content/feed?lat=${coords.latitude}&lng=${coords.longitude}&scope=${s}&sort=${sortKey}`)
            .catch((e) => { console.warn('Feed load failed', e?.message ?? e); return null })
          : Promise.resolve(null),
        minePromise,
      ])
      if (!current()) return
      setItems(mergeMine(Array.isArray(data?.items) ? data.items : [], mine, myId))
    } catch (e) {
      console.warn('Feed load failed', e)
    } finally {
      if (current()) setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load(scope, sort, country) }, [scope, sort, country, load]))
  useEffect(() => { setGridLimit(GRID_PAGE) }, [scope, sort, country])

  // Optimistic like update from the inline scroll-view action row, matched by id since
  // youtube items are mixed into the same array without stable numeric indices.
  const updateItem = (index, patch) => {
    const target = viewerItems[index]
    if (!target) return
    setItems((prev) => prev.map((it) => (it.id === target.id ? { ...it, ...patch } : it)))
  }

  // Uploads open in the full-screen viewer (like/save/comments); YouTube videos open on
  // YouTube. The viewer only gets the uploads, so map a tapped tile to its viewer index.
  const tiles = items
  const viewerItems = useMemo(() => items.filter((m) => m.kind !== 'youtube'), [items])
  const gridTiles = useMemo(() => (tiles.length > gridLimit ? tiles.slice(0, gridLimit) : tiles), [tiles, gridLimit])
  const refreshControl = <RefreshControl refreshing={loading} onRefresh={() => load(scope, sort, country)} tintColor={colors.magenta} />
  const scopeIdx = SCOPES.findIndex((x) => x.key === scope)
  const nextScope = scopeIdx >= 0 ? SCOPES[scopeIdx + 1] ?? null : null
  const openTile = (i) => {
    const item = tiles[i]
    if (!item) return
    if (item.kind === 'youtube') return openLink(item.url)
    setViewer({ open: true, index: Math.max(0, viewerItems.findIndex((m) => String(m.id) === String(item.id))) })
  }

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="social" />
      <BrandHeader
        title={t('feedTitle')}
        subtitle={feedScopeLabel(scope, country)}
        right={
          <>
            <LiveButton onPress={() => navigation.navigate('Stream')} />
            <HeaderButton
              icon={layout === 'grid' ? 'reorder-four-outline' : 'grid-outline'}
              label={layout === 'grid' ? t('showAsList') : t('showAsGrid')}
              onPress={() => setLayout((l) => (l === 'grid' ? 'scroll' : 'grid'))}
            />
            <HeaderButton icon="bookmark-outline" label={t('saved')} onPress={() => navigation.navigate('SavedContent')} />
          </>
        }
      />
      <ScopeChips options={feedScopes} value={scope} onChange={setScope} />
      <Segmented options={scope === 'mine' ? MINE_SORTS : SORTS} value={scope === 'mine' && sort !== 'popular' ? 'recent' : sort} onChange={setSort} style={styles.sort} />

      {layout === 'scroll' && tiles.length > 0 ? (
        // List mode is a windowed FlatList: rows mount near the screen only and just the
        // most visible video plays.
        <FeedScroll
          items={viewerItems}
          onOpen={(i) => setViewer({ open: true, index: i })}
          onChange={updateItem}
          contentContainerStyle={styles.content}
          refreshControl={refreshControl}
        />
      ) : (
        // The grid renders in pages of GRID_PAGE tiles, adding more as you near the bottom, so
        // a 200-post Country feed doesn't mount every tile at once.
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={refreshControl}
          scrollEventThrottle={200}
          onScroll={({ nativeEvent: e }) => {
            if (gridLimit >= tiles.length) return
            if (e.contentOffset.y + e.layoutMeasurement.height > e.contentSize.height - e.layoutMeasurement.height * 1.5) {
              setGridLimit((n) => Math.min(tiles.length, n + GRID_PAGE))
            }
          }}
        >
          {tiles.length > 0 ? (
            <MasonryGrid items={gridTiles} showOwner onOpen={openTile} />
          ) : (
            <Text style={styles.empty}>
              {loading
                ? t('loading')
                : scope === 'mine'
                  ? t('emptyMine')
                  : scope === 'country'
                    ? (country ? t('noPostsFrom', { country: country.name }) : t('pickCountry'))
                    : permissionDenied
                    ? t('locationOff')
                    : t('emptyRange')}
            </Text>
          )}
          {tiles.length === 0 && !loading && !permissionDenied && nextScope ? (
            <Pressable onPress={() => setScope(nextScope.key)} style={styles.widen} accessibilityRole="button" accessibilityLabel={t('widenTo', { scope: scopeLabel(nextScope.key) })}>
              <Text style={styles.widenText}>{t('widenTo', { scope: scopeLabel(nextScope.key) })}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <CountryPicker
        visible={pickerOpen}
        value={country?.code ?? null}
        onSelect={pickCountry}
        onClose={() => setPickerOpen(false)}
        allowAll
        title={t('postsFrom')}
      />

      <ContentViewer
        visible={viewer.open}
        items={viewerItems}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
        onOpenProfile={(id) => {
          setViewer({ open: false, index: 0 })
          openProfile(navigation, id)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  sort: { marginHorizontal: 16, marginTop: 4, marginBottom: 10 },
  content: { paddingBottom: 32 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
  widen: { alignSelf: 'center', marginTop: 14, minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.hairline },
  widenText: { fontSize: 15, fontWeight: '600', color: colors.text },
})
