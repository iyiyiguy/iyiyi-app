import { useCallback, useEffect, useState } from 'react'
import { View, Text, Image, FlatList, StyleSheet, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native'
import { colors, type, font, radii } from '../theme'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import TagDropdown from '../components/TagDropdown'
import SearchField from '../components/SearchField'
import { GuestLoginButton, useGuestPrompt } from '../components/GuestPrompt'
import { supabase, API_URL } from '../lib/supabase'
import { matchesTags, matchesSearch } from '../lib/tags'
import { avatarSource } from '../lib/avatarSource'

// Logged-out "Discover": popular public profiles (database function guest_recommended,
// migration 070), same glass cards as the member Recommended tab. Tapping a card opens the
// public profile; Follow asks the visitor to sign up.
const TIER = {
  premium: { label: 'Premium', color: colors.gold, tint: 'rgba(232,176,75,0.14)', mark: '👑' },
  pro: { label: 'Pro', color: colors.magenta, tint: 'rgba(91,108,240,0.14)', mark: '⭐' },
  creator: { label: 'Creator', color: colors.violet, tint: 'rgba(125,108,240,0.14)', mark: '★' },
}

const compact = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}

function GuestUserCard({ user, onPress, onFollow }) {
  const tier = TIER[user.account_type]
  const followers = Number(user.follower_count) || 0
  const posts = Number(user.post_count) || 0
  const stat = followers > 0 ? `${compact(followers)} ${followers === 1 ? 'follower' : 'followers'}` : posts > 0 ? `${compact(posts)} ${posts === 1 ? 'post' : 'posts'}` : 'New on iYiYi'
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={`Open ${user.username}'s profile`}>
      <GlassPanel radius={28} style={{ flex: 1 }}>
        <View style={styles.cardInner}>
          <Image source={avatarSource(user?.avatar_url)} style={styles.avatar} />
          <Text style={[type.body, { marginTop: 10, fontWeight: '700' }]} numberOfLines={1}>{user.username}</Text>
          <Text style={[type.caption, { marginTop: 1 }]} numberOfLines={1}>{stat}</Text>
          <View style={styles.cardFooter}>
            {tier ? (
              <View style={[styles.tag, { backgroundColor: tier.tint }]}>
                <Text style={[styles.tagText, { color: tier.color }]}>{tier.mark} {tier.label}</Text>
              </View>
            ) : <View />}
            <Pressable onPress={onFollow} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Follow ${user.username}`} style={({ pressed }) => [styles.follow, pressed && { opacity: 0.85 }]}>
              <Text style={styles.followText}>Follow</Text>
            </Pressable>
          </View>
        </View>
      </GlassPanel>
    </Pressable>
  )
}

export default function GuestRecommendedScreen({ navigation }) {
  const { width } = useWindowDimensions()
  const cols = width >= 1000 ? 4 : width >= 680 ? 3 : 2
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTags, setActiveTags] = useState([])
  const [sheet, prompt] = useGuestPrompt()

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('guest_recommended', { lim: 90 })
    if (!error && Array.isArray(data)) {
      setUsers(data)
    } else {
      // Database without migration 070 yet: fall back to the public showcase.
      try {
        const d = await fetch(`${API_URL}/api/public/showcase`).then((x) => x.json())
        setUsers(Array.isArray(d?.profiles) ? d.profiles : [])
      } catch {
        setUsers([])
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const query = search.trim()
  const data = (users ?? []).filter((u) => u?.username && matchesTags(u, activeTags) && matchesSearch(u, query))
  const filtering = !!query || activeTags.length > 0

  // Pad the last row so a short row's cards keep the column width.
  const padded = data.length % cols ? [...data, ...Array.from({ length: cols - (data.length % cols) }, (_, i) => ({ _pad: i }))] : data

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="social" />
      <BrandHeader
        title="Discover"
        subtitle={users?.length ? `${users.length} popular ${users.length === 1 ? 'profile' : 'profiles'}` : 'Popular on iYiYi'}
        right={<GuestLoginButton />}
      />
      <SearchField style={styles.search} value={search} onChangeText={setSearch} placeholder="Search people or tags" />
      <View style={styles.toolbar}>
        <TagDropdown selected={activeTags} onApply={setActiveTags} />
        {filtering ? (
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={8} accessibilityRole="button">
            <Text style={styles.filterClear}>Clear · {data.length} {data.length === 1 ? 'match' : 'matches'}</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        key={cols}
        data={padded}
        keyExtractor={(u, i) => (u._pad != null ? `pad-${u._pad}` : String(u.id ?? u.user_id ?? i))}
        numColumns={cols}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={loading && users != null}
        onRefresh={load}
        renderItem={({ item }) => (item._pad != null ? <View style={{ flex: 1 }} /> : (
          <GuestUserCard
            user={item}
            onPress={() => navigation.navigate('PublicProfile', { username: item.username, avatarUrl: item.avatar_url ?? null })}
            onFollow={() => prompt('follow')}
          />
        ))}
        ListEmptyComponent={
          users == null ? <ActivityIndicator color={colors.text} style={{ marginTop: 60 }} /> : (
            <Text style={styles.empty}>{filtering ? 'No profiles match that search or those tags.' : 'No profiles to show yet.'}</Text>
          )
        }
      />
      {sheet}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  search: { marginHorizontal: 16, marginTop: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  filterClear: { fontSize: 13, ...font.semibold, color: colors.accent },
  // Bottom room for the floating "Sign up free" pill above the tab bar.
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 96, gap: 14 },
  row: { gap: 14 },
  cardInner: { padding: 12 },
  avatar: { width: '100%', aspectRatio: 1, maxHeight: 180, borderRadius: 20, backgroundColor: 'rgba(127,140,180,0.18)' },
  cardFooter: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, flexShrink: 1 },
  tagText: { fontSize: 11, fontWeight: '700' },
  follow: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.magenta },
  followText: { color: colors.onBrand, fontWeight: '700', fontSize: 12 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
