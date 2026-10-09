import { useCallback, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import SocialIcon from '../components/SocialIcon'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import { openProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'

const TABS = [
  { key: 'mine', label: 'Profiles I followed' },
  { key: 'received', label: 'Followed me' },
]

// People followed on other platforms through iYiYi's "Follow everywhere". These are
// self-reported check-offs, not verified with the platforms.
export default function PlatformFollowsScreen({ navigation }) {
  const [tab, setTab] = useState('mine')
  const [data, setData] = useState({ count: 0, by_platform: {}, items: [] })
  const [platform, setPlatform] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (which) => {
    setLoading(true)
    try {
      const d = await apiJson(`/api/platform-follows/${which}`)
      setData({ count: d?.count ?? 0, by_platform: d?.by_platform ?? {}, items: d?.items ?? [] })
    } catch (e) {
      console.warn('Platform follows load failed', e)
      setData({ count: 0, by_platform: {}, items: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { setPlatform(null); load(tab) }, [tab, load]))

  const items = platform ? data.items.filter((i) => i.platform === platform) : data.items
  const platforms = Object.keys(data.by_platform)

  return (
    <View style={styles.screen}>
      <BrandHeader title="Followed on platforms" onBack={() => navigation.goBack()} />
      <GlassPanel radius={999} style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </GlassPanel>

      {platforms.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
          <Pressable onPress={() => setPlatform(null)} style={[styles.chip, !platform && styles.chipActive]}>
            <Text style={[styles.chipText, !platform && styles.chipTextActive]}>All {data.count}</Text>
          </Pressable>
          {platforms.map((p) => (
            <Pressable key={p} onPress={() => setPlatform(p)} style={[styles.chip, platform === p && styles.chipActive]}>
              <SocialIcon platform={p} size={13} color={platform === p ? colors.onBrand : colors.textMuted} />
              <Text style={[styles.chipText, platform === p && styles.chipTextActive]}>{data.by_platform[p]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={items}
        keyExtractor={(i) => `${i.id}:${i.platform}`}
        refreshing={loading}
        onRefresh={() => load(tab)}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openProfile(navigation, item.id, item.avatar_url ?? null)}>
            <Image source={avatarSource(item?.avatar_url)} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{item.username}</Text>
              <Text style={type.caption}>
                {tab === 'mine' ? 'You followed them on ' : 'Followed you on '}
                {PLATFORM_LABELS[item.platform] ?? item.platform} via iYiYi · {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            <SocialIcon platform={item.platform} size={22} color={colors.text} />
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading
              ? 'Loading…'
              : tab === 'mine'
                ? "When you use Follow everywhere on someone's profile and check off a platform, they'll show up here."
                : "When someone follows you on another platform using iYiYi's Follow everywhere, they'll show up here."}
          </Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  tabs: { flexDirection: 'row', margin: 16, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: colors.magenta },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: colors.onBrand },
  chips: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface,
  },
  chipActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
  chipTextActive: { color: colors.onBrand },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.inkSurfaceRaised },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
