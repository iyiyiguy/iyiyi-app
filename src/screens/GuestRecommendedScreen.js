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
import { useT } from '../i18n'
import strings from '../i18n/strings/guest'
import socialStrings from '../i18n/strings/social'

// Logged-out "Discover": popular public profiles (database function guest_recommended,
// migration 070), same glass cards as the member Recommended tab. Tapping a card opens the
// public profile; Follow asks the visitor to sign up. Tier labels are keys in i18n/strings/social.
const TIER = {
  premium: { label: 'tierPremium', color: colors.gold, tint: 'rgba(232,176,75,0.14)', mark: '👑' },
  pro: { label: 'tierPro', color: colors.magenta, tint: 'rgba(91,108,240,0.14)', mark: '⭐' },
  creator: { label: 'tierCreator', color: colors.violet, tint: 'rgba(125,108,240,0.14)', mark: '★' },
}

const compact = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}

function GuestUserCard({ user, onPress, onFollow }) {
  const t = useT(strings)
  const tsoc = useT(socialStrings)
  const tier = TIER[user.account_type]
  const followers = Number(user.follower_count) || 0
  const posts = Number(user.post_count) || 0
  const stat = followers > 0
    ? t(followers === 1 ? 'followerOne' : 'followerMany', { n: compact(followers) })
    : posts > 0 ? t(posts === 1 ? 'postOne' : 'postMany', { n: compact(posts) }) : t('newOnIyiyi')
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={`${t('openProfileA11y', { name: user.username })}, ${stat}`}>
      <GlassPanel radius={28} style={{ flex: 1 }}>
        <View style={styles.cardInner}>
          <Image source={avatarSource(user?.avatar_url)} style={styles.avatar} />
          <Text style={[type.body, { marginTop: 10, fontWeight: '700' }]} numberOfLines={1}>{user.username}</Text>
          <Text style={[type.caption, { marginTop: 1 }]} numberOfLines={1}>{stat}</Text>
          <View style={styles.cardFooter}>
            {tier ? (
              <View style={[styles.tag, { backgroundColor: tier.tint }]}>
                <Text style={[styles.tagText, { color: tier.color }]}>{tier.mark} {tsoc(tier.label)}</Text>
              </View>
            ) : <View />}
            <Pressable onPress={onFollow} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('followNameA11y', { name: user.username })} style={({ pressed }) => [styles.follow, pressed && { opacity: 0.85 }]}>
              <Text style={styles.followText}>{t('follow')}</Text>
            </Pressable>
          </View>
        </View>
      </GlassPanel>
    </Pressable>
  )
}

export default function GuestRecommendedScreen({ navigation }) {
  const t = useT(strings)
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
        title={t('discoverTitle')}
        subtitle={users?.length ? t(users.length === 1 ? 'popularProfileOne' : 'popularProfileMany', { n: users.length }) : t('popularOnIyiyi')}
        right={<GuestLoginButton />}
      />
      <SearchField style={styles.search} value={search} onChangeText={setSearch} placeholder={t('searchPeopleTags')} />
      <View style={styles.toolbar}>
        <TagDropdown selected={activeTags} onApply={setActiveTags} />
        {filtering ? (
          <Pressable onPress={() => { setSearch(''); setActiveTags([]) }} hitSlop={12} accessibilityRole="button">
            <Text style={styles.filterClear}>{t(data.length === 1 ? 'clearMatchOne' : 'clearMatchMany', { n: data.length })}</Text>
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
