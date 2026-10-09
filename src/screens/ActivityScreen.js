import { useCallback, useRef, useState } from 'react'
import { View, Text, Image, SectionList, Pressable, StyleSheet, RefreshControl } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import BrandHeader from '../components/BrandHeader'
import { colors, font, radii, type } from '../theme'
import { fetchActivity } from '../lib/activityData'
import { openProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'

const ICONS = {
  follow: { name: 'person-add', color: '#5b6cf0' },
  follow_request: { name: 'person-add-outline', color: '#e8b04b' },
  view: { name: 'eye', color: '#2fbf8f' },
  like: { name: 'heart', color: '#ff3b6b' },
  comment: { name: 'chatbubble', color: '#7d6cf0' },
  tagged: { name: 'pricetag', color: '#19a7e3' },
}

function describe(item) {
  switch (item.type) {
    case 'follow': return 'started following you'
    case 'follow_request': return 'requested to follow you'
    case 'view': return item.count > 1 ? `viewed your profile ${item.count} times` : 'viewed your profile'
    case 'like': return 'liked your post'
    case 'comment': return item.text ? `commented: ${item.text}` : 'commented on your post'
    case 'tagged': return 'tagged you in a post'
    default: return 'interacted with you'
  }
}

function ago(iso) {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  try { return new Date(t).toLocaleDateString() } catch { return '' }
}

function sectionsFor(items) {
  const now = Date.now()
  const groups = { today: [], week: [], earlier: [] }
  items.forEach((it) => {
    const t = it.at ? new Date(it.at).getTime() : NaN
    const age = Number.isFinite(t) ? now - t : Infinity
    if (age < 86400000) groups.today.push(it)
    else if (age < 7 * 86400000) groups.week.push(it)
    else groups.earlier.push(it)
  })
  return [
    { title: 'Today', data: groups.today },
    { title: 'This week', data: groups.week },
    { title: 'Earlier', data: groups.earlier },
  ].filter((s) => s.data.length)
}

// Everything that happened on your profile lately, newest first: follows and requests,
// profile views, likes and comments on your posts, and tags. Built client-side
// (lib/activityData) - any source the app can't read is simply left out.
export default function ActivityScreen({ navigation }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const list = await fetchActivity()
      if (my === seq.current) setItems(Array.isArray(list) ? list : [])
    } catch (e) {
      console.warn('Activity load failed', e?.message ?? e)
    } finally {
      if (my === seq.current) {
        setLoading(false)
        setLoadedOnce(true)
      }
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const sections = sectionsFor(items)

  return (
    <View style={styles.screen}>
      <BrandHeader title="Activity" subtitle={items.length ? `${items.length} updates` : undefined} onBack={() => navigation.goBack()} />
      <SectionList
        sections={sections}
        keyExtractor={(i, idx) => `${i.type}:${i.user_id}:${i.media_id ?? ''}:${i.at ?? ''}:${idx}`}
        refreshControl={<RefreshControl refreshing={loading && loadedOnce} onRefresh={load} tintColor={colors.magenta} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => {
          const icon = ICONS[item.type] ?? ICONS.follow
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              onPress={() => openProfile(navigation, item.user_id)}
              accessibilityRole="button"
            >
              <View>
                {item.avatar_url ? (
                  <Image source={avatarSource(item?.avatar_url)} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={20} color={colors.textFaint} /></View>
                )}
                <View style={[styles.typeBadge, { backgroundColor: icon.color }]}>
                  <Ionicons name={icon.name} size={10} color="#fff" />
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.text} numberOfLines={2}>
                  <Text style={styles.name}>{item.username}</Text> {describe(item)}
                </Text>
                <Text style={styles.time}>{ago(item.at)}</Text>
              </View>
              {<Image source={{ uri: item.media_url }} style={styles.thumb} />}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          loadedOnce ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name="notifications-outline" size={28} color={colors.textMuted} /></View>
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptyText}>When people follow you, view your profile, or like, comment on or tag you in posts, it shows up here.</Text>
            </View>
          ) : (
            <Text style={styles.loading}>Loading…</Text>
          )
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingBottom: 40 },
  sectionTitle: { ...type.label, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  avatar: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.inkSurfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  typeBadge: {
    position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink,
  },
  text: { fontSize: 15, ...font.regular, color: colors.text, lineHeight: 20 },
  name: { ...font.bold },
  time: { ...type.caption, marginTop: 2 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.inkSurfaceRaised },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  emptyTitle: { ...type.headline, marginTop: 16 },
  emptyText: { ...type.caption, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  loading: { ...type.caption, textAlign: 'center', marginTop: 60 },
})
