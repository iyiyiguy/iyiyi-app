import { useCallback, useRef, useState } from 'react'
import { View, Text, Image, SectionList, Pressable, StyleSheet, RefreshControl } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import BrandHeader from '../components/BrandHeader'
import { colors, font, radii, type } from '../theme'
import { fetchActivity } from '../lib/activityData'
import { getMyUserId, openProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'
import { supabase } from '../lib/supabase'
import { useT } from '../i18n'
import strings from '../i18n/strings/activity'

// ---- unread badge ----------------------------------------------------------------------
// "New since you last opened Activity": new followers / follow requests after the time this
// screen was last shown (stored per account on the device). Counted with one head-only query
// on `follows` (RLS lets you read rows where you're the one followed); anything the app can't
// read counts as 0, so the badge never shows on a guess.
const seenKey = (uid) => `iyiyi_activity_seen_${uid}`

export async function markActivitySeen() {
  try {
    const uid = await getMyUserId()
    if (uid) await AsyncStorage.setItem(seenKey(uid), new Date().toISOString())
  } catch {}
}

export async function fetchUnreadActivityCount() {
  try {
    const uid = await getMyUserId()
    if (!uid) return 0
    const seen = await AsyncStorage.getItem(seenKey(uid))
    if (!seen) {
      // First run on this device: start counting from now rather than badging all history.
      await AsyncStorage.setItem(seenKey(uid), new Date().toISOString())
      return 0
    }
    const { count, error } = await supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('followed_id', uid)
      .gt('created_at', seen)
    if (error) return 0
    return Number.isFinite(count) ? count : 0
  } catch {
    return 0
  }
}

const ICONS = {
  follow: { name: 'person-add', color: '#5b6cf0' },
  follow_request: { name: 'person-add-outline', color: '#e8b04b' },
  view: { name: 'eye', color: '#2fbf8f' },
  like: { name: 'heart', color: '#ff3b6b' },
  comment: { name: 'chatbubble', color: '#7d6cf0' },
  tagged: { name: 'pricetag', color: '#19a7e3' },
}

// t: useT(i18n/strings/activity) from the screen.
function describe(item, t) {
  switch (item.type) {
    case 'follow': return t('descFollow')
    case 'follow_request': return t('descRequest')
    case 'view': return item.count > 1 ? t('descViewTimes', { n: item.count }) : t('descView')
    case 'like': return t('descLike')
    case 'comment': return item.text ? t('descCommentText', { text: item.text }) : t('descComment')
    case 'tagged': return t('descTagged')
    default: return t('descOther')
  }
}

function ago(iso, t) {
  const ts = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(ts)) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('agoNow')
  if (s < 3600) return t('agoMin', { n: Math.floor(s / 60) })
  if (s < 86400) return t('agoHour', { n: Math.floor(s / 3600) })
  if (s < 86400 * 7) return t('agoDay', { n: Math.floor(s / 86400) })
  try { return new Date(ts).toLocaleDateString() } catch { return '' }
}

function sectionsFor(items, t) {
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
    { title: t('today'), data: groups.today },
    { title: t('thisWeek'), data: groups.week },
    { title: t('earlier'), data: groups.earlier },
  ].filter((s) => s.data.length)
}

// Everything that happened on your profile lately, newest first: follows and requests,
// profile views, likes and comments on your posts, and tags. Built client-side
// (lib/activityData) - any source the app can't read is simply left out.
export default function ActivityScreen({ navigation }) {
  const t = useT(strings)
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

  useFocusEffect(useCallback(() => { load(); markActivitySeen() }, [load]))

  const sections = sectionsFor(items, t)

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('activity')} subtitle={items.length ? t(items.length === 1 ? 'updatesOne' : 'updatesMany', { n: items.length }) : undefined} onBack={() => navigation.goBack()} />
      <SectionList
        sections={sections}
        keyExtractor={(i, idx) => `${i.type}:${i.user_id}:${i.media_id ?? ''}:${i.at ?? ''}:${idx}`}
        refreshControl={<RefreshControl refreshing={loading && loadedOnce} onRefresh={load} tintColor={colors.magenta} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>}
        renderItem={({ item }) => {
          const icon = ICONS[item.type] ?? ICONS.follow
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              onPress={() => openProfile(navigation, item.user_id, item.avatar_url ?? null)}
              accessibilityRole="button"
              accessibilityLabel={`${item.username} ${describe(item, t)}, ${ago(item.at, t)}`}
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
                  <Text style={styles.name}>{item.username}</Text> {describe(item, t)}
                </Text>
                <Text style={styles.time}>{ago(item.at, t)}</Text>
              </View>
              {item.media_url ? (
                <Image source={{ uri: item.media_url }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbIcon]}>
                  <Ionicons name={`${icon.name.replace(/-outline$/, '')}-outline`} size={20} color={icon.color} />
                </View>
              )}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          loadedOnce ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name="notifications-outline" size={28} color={colors.textMuted} /></View>
              <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('emptyText')}</Text>
            </View>
          ) : (
            <Text style={styles.loading}>{t('loading')}</Text>
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
  thumbIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  emptyTitle: { ...type.headline, marginTop: 16 },
  emptyText: { ...type.caption, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  loading: { ...type.caption, textAlign: 'center', marginTop: 60 },
})
