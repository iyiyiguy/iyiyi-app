import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, useWindowDimensions } from 'react-native'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import { Segmented } from '../components/ScopeChips'
import GlowBackdrop from '../components/GlowBackdrop'
import MasonryGrid from '../components/MasonryGrid'
import GuestViewer from '../components/GuestViewer'
import { GuestLoginButton, useGuestPrompt } from '../components/GuestPrompt'
import { colors, type } from '../theme'
import { supabase } from '../lib/supabase'

// Logged-out Feed: public posts only (database function guest_feed, migration 070), newest
// or most liked. Read-only - tapping a post opens GuestViewer, tapping an avatar opens the
// public profile, and Live / like / comment / save ask the visitor to sign up.
const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'popular', label: 'Popular' },
]
const PAGE = 30

export default function GuestFeedScreen({ navigation }) {
  const { width } = useWindowDimensions()
  const columns = width >= 1000 ? 4 : width >= 680 ? 3 : 2
  const [sort, setSort] = useState('recent')
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(false)
  const [viewer, setViewer] = useState({ open: false, index: 0 })
  const [sheet, prompt] = useGuestPrompt()
  const seq = useRef(0)

  const load = useCallback(async (sortKey) => {
    const my = ++seq.current
    setLoading(true)
    setError(false)
    const { data, error: err } = await supabase.rpc('guest_feed', { lim: PAGE, sort: sortKey })
    if (my !== seq.current) return
    if (err || !Array.isArray(data)) {
      setItems([])
      setError(true)
    } else {
      setItems(data)
      setDone(sortKey === 'popular' || data.length < PAGE)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(sort) }, [sort, load])

  const loadMore = useCallback(async () => {
    if (more || done || loading || !items?.length || sort !== 'recent') return
    const my = seq.current
    setMore(true)
    const before = items[items.length - 1]?.created_at
    const { data, error: err } = await supabase.rpc('guest_feed', { lim: PAGE, before, sort })
    if (my === seq.current) {
      if (!err && Array.isArray(data)) {
        const seen = new Set(items.map((m) => String(m.id)))
        setItems([...items, ...data.filter((m) => !seen.has(String(m.id)))])
        if (data.length < PAGE) setDone(true)
      }
    }
    setMore(false)
  }, [more, done, loading, items, sort])

  const openProfile = useCallback((username, avatarUrl = null) => {
    if (username) navigation.navigate('PublicProfile', { username, avatarUrl })
  }, [navigation])

  const list = items ?? []
  const usernameById = (id) => list.find((m) => m.owner_id === id)?.owner_username

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="social" />
      <BrandHeader
        title="Feed"
        subtitle="Public posts"
        right={
          <>
            <HeaderButton icon="radio-outline" label="Live" onPress={() => prompt('live')} />
            <GuestLoginButton />
          </>
        }
      />
      <Segmented options={SORTS} value={sort} onChange={setSort} style={styles.sort} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading && items != null} onRefresh={() => load(sort)} tintColor={colors.magenta} />}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent: e }) => {
          if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600) loadMore()
        }}
      >
        {list.length > 0 ? (
          <MasonryGrid
            items={list}
            columns={columns}
            showOwner
            onOpen={(i) => setViewer({ open: true, index: i })}
            onOpenProfile={(id) => { const m = list.find((x) => x.owner_id === id); openProfile(m?.owner_username, m?.owner_avatar_url ?? null) }}
          />
        ) : items == null ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: 60 }} />
        ) : (
          <Text style={styles.empty}>
            {error ? "Couldn't load the feed right now. Pull down to try again." : 'No public posts yet.'}
          </Text>
        )}
        {more ? <ActivityIndicator color={colors.text} style={{ marginTop: 16 }} /> : null}
      </ScrollView>

      <GuestViewer
        visible={viewer.open}
        items={list}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
        onOpenProfile={(m) => {
          setViewer({ open: false, index: 0 })
          openProfile(m.owner_username, m.owner_avatar_url ?? null)
        }}
      />
      {sheet}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  sort: { marginHorizontal: 16, marginTop: 4, marginBottom: 10 },
  // Room for the floating "Sign up free" pill above the tab bar.
  content: { paddingBottom: 96 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
