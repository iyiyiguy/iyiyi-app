import { useCallback, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, FlatList, Image, ScrollView } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { GlassButton } from '../components/GlassButton'
import { colors, radii, type } from '../theme'
import { supabase } from '../lib/supabase'
import { getGame } from '../lib/games'
import * as Location from 'expo-location'
import {
  CATEGORIES, fetchEvents, fetchHostedEvents, fetchPastEvents, fetchProfiles, getCategory, isUnlimited, formatEventWhen,
  eventPlace, eventDistanceM, categoryLabel,
} from '../lib/events'
import { getPositionFast } from '../lib/location'
import { useT } from '../i18n'
import strings from '../i18n/strings/events'

// Kept for any older imports: id -> username.
export async function fetchUsernames(ids) {
  const profiles = await fetchProfiles(ids)
  return Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.username]))
}

// Labels are keys in i18n/strings/events.
const TABS = [
  { key: 'upcoming', label: 'tabUpcoming' },
  { key: 'mine', label: 'tabMine' },
  { key: 'past', label: 'tabPast' },
]

// Lists real events from the `events` table. No placeholder data: on failure an error with
// Retry is shown, otherwise an empty state.
// Upcoming events come from a server-side filter (started in the last few hours or later),
// soonest day first and nearest first within a day when your location is available. Past and
// hosted events are their own small queries.
async function myPosition() {
  try {
    // Only when location is already allowed: this screen never prompts for it.
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') return null
    const pos = await getPositionFast()
    return pos?.coords ?? null
  } catch {
    return null
  }
}

const formatMeters = (m) => {
  if (m == null) return null
  const mi = m / 1609.34
  return mi < 0.1 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

export default function EventsScreen({ navigation }) {
  const t = useT(strings)
  const [upcomingRows, setUpcomingRows] = useState([])
  const [pastRows, setPastRows] = useState([])
  const [hostedRows, setHostedRows] = useState([])
  const [near, setNear] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('upcoming')
  const [category, setCategory] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const [{ data: auth }, coords] = await Promise.all([supabase.auth.getUser(), myPosition()])
      const uid = auth?.user?.id ?? null
      const [up, past, hosted] = await Promise.all([
        fetchEvents({ near: coords }),
        fetchPastEvents().catch(() => []),
        fetchHostedEvents(uid).catch(() => []),
      ])
      if (my !== seq.current) return
      setUserId(uid)
      setNear(coords)
      setUpcomingRows(up)
      setPastRows(past)
      setHostedRows(hosted)
      setProfiles(await fetchProfiles([...up, ...past, ...hosted].map((e) => e.creator_id)))
    } catch (e) {
      console.warn('Failed to load events', e)
      if (my !== seq.current) return
      setUpcomingRows([])
      setError('load')
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const { upcoming, past, mine } = useMemo(() => {
    const byId = new Map()
    ;[...hostedRows, ...upcomingRows, ...pastRows].forEach((e) => {
      if (userId && (e.creator_id === userId || e.attendeeIds.includes(userId))) byId.set(String(e.id), e)
    })
    const my = [...byId.values()].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
    return { upcoming: upcomingRows, past: pastRows, mine: my }
  }, [upcomingRows, pastRows, hostedRows, userId])

  const base = tab === 'upcoming' ? upcoming : tab === 'past' ? past : mine
  const shown = category ? base.filter((e) => (e.category || (getGame(e.game_id) ? 'gaming' : null)) === category) : base
  const counts = { upcoming: upcoming.length, mine: mine.length, past: past.length }

  const renderEvent = ({ item: event }) => {
    const cat = getCategory(event.category)
    const game = getGame(event.game_id)
    const start = new Date(event.event_date)
    const host = profiles[event.creator_id]
    const isMine = event.creator_id === userId
    const dist = tab === 'upcoming' ? formatMeters(eventDistanceM(event, near)) : null
    const going = isUnlimited(event.max_players)
      ? t('goingN', { n: event.goingCount })
      : t('goingOf', { n: event.goingCount, max: event.max_players })
    return (
      <Pressable
        onPress={() => navigation.navigate('EventDetails', { eventId: event.id })}
        style={({ pressed }) => [styles.cardWrap, pressed && { transform: [{ scale: 0.985 }] }]}
        accessibilityRole="button"
        accessibilityLabel={[
          event.name,
          formatEventWhen(event.event_date, event.ends_at),
          eventPlace(event),
          dist,
          going,
          isMine ? t('hosting') : null,
          event.visibility === 'invite' ? t('inviteOnly') : null,
        ].filter(Boolean).join(', ')}
      >
        <GlassPanel radius={radii.md} animateIn={false}>
          <View style={styles.cover}>
            {event.cover_url ? (
              <Image source={{ uri: event.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <LinearGradient colors={['#a9b8ff', '#c6a9ff', '#ffc4de']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.badges}>
              {cat || game ? (
                <View style={styles.badge}>
                  <Ionicons name={cat?.icon || 'game-controller-outline'} size={11} color="#fff" />
                  <Text style={styles.badgeText}>{cat ? categoryLabel(cat) : game?.name}</Text>
                </View>
              ) : null}
              {event.visibility === 'invite' ? (
                <View style={styles.badge}><Ionicons name="lock-closed" size={10} color="#fff" /><Text style={styles.badgeText}>{t('inviteOnly')}</Text></View>
              ) : null}
              {isMine ? <View style={styles.badge}><Text style={styles.badgeText}>{t('hosting')}</Text></View> : null}
            </View>
            <View style={styles.dateTile}>
              <Text style={styles.dateMonth}>{Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text>
              <Text style={styles.dateDay}>{Number.isNaN(start.getTime()) ? '–' : start.getDate()}</Text>
            </View>
          </View>
          <View style={styles.body}>
            <Text style={styles.when}>{formatEventWhen(event.event_date, event.ends_at).toUpperCase()}</Text>
            <Text style={styles.eventName} numberOfLines={2}>{event.name}</Text>
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={colors.textMuted} />
              <Text style={styles.meta} numberOfLines={1}>
                {eventPlace(event)}{dist ? ` · ${dist}` : ''}
              </Text>
            </View>
            <View style={styles.footer}>
              <Text style={styles.meta}>
                {going}
                {event.interestedCount ? ` · ${t('interestedN', { n: event.interestedCount })}` : ''}
              </Text>
              {host?.username ? <Text style={styles.host} numberOfLines={1}>{t('byHost', { name: host.username })}</Text> : null}
            </View>
          </View>
        </GlassPanel>
      </Pressable>
    )
  }

  return (
    <View style={styles.screen}>
      <BrandHeader
        title={t('events')}
        onBack={() => navigation.goBack()}
        right={
          <GlassButton size="sm" variant="primary" onPress={() => navigation.navigate('CreateEvent')} icon={<Ionicons name="add" size={16} color={colors.ink} />} accessibilityLabel={t('createEventA11y')}>
            {t('create')}
          </GlassButton>
        }
      />
      <View style={styles.tabs}>
        {TABS.map((tb) => {
          const active = tab === tb.key
          return (
            <Pressable key={tb.key} onPress={() => setTab(tb.key)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t(tb.label)} ({counts[tb.key]})</Text>
            </Pressable>
          )
        })}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
          <Pressable
            onPress={() => setCategory(null)}
            style={[styles.cat, !category && styles.catActive]}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityState={{ selected: !category }}
          >
            <Text style={[styles.catText, !category && styles.catTextActive]}>{t('all')}</Text>
          </Pressable>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setCategory(category === c.key ? null : c.key)}
              style={[styles.cat, category === c.key && styles.catActive]}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityState={{ selected: category === c.key }}
            >
              <Ionicons name={c.icon} size={13} color={category === c.key ? colors.ink : colors.text} />
              <Text style={[styles.catText, category === c.key && styles.catTextActive]}>{categoryLabel(c)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderEvent}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name={error ? 'cloud-offline-outline' : 'calendar-outline'} size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {error ? t('loadFailed') : (tab === 'upcoming' ? t('emptyUpcoming') : tab === 'mine' ? t('emptyMine') : t('emptyPast'))}
              </Text>
              <GlassButton size="sm" variant={error ? 'glass' : 'primary'} onPress={error ? load : () => navigation.navigate('CreateEvent')}>
                {error ? t('retry') : t('hostEvent')}
              </GlassButton>
            </View>
          )
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radii.pill, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  tabActive: { backgroundColor: colors.text, borderColor: colors.text },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.ink },
  cats: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline },
  catActive: { backgroundColor: colors.text, borderColor: colors.text },
  catText: { fontSize: 12, fontWeight: '600', color: colors.text },
  catTextActive: { color: colors.ink },
  list: { paddingHorizontal: 16, paddingBottom: 80 },
  cardWrap: { marginBottom: 14 },
  cover: { height: 130, overflow: 'hidden', borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  badges: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 6, flexWrap: 'wrap', right: 80 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.45)' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dateTile: { position: 'absolute', right: 10, top: 10, width: 48, paddingVertical: 5, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center' },
  dateMonth: { fontSize: 10, fontWeight: '800', color: '#5b6cf0', letterSpacing: 0.6 },
  dateDay: { fontSize: 19, fontWeight: '800', color: '#151a2b', marginTop: -2 },
  body: { padding: 14, gap: 4 },
  when: { fontSize: 11, fontWeight: '700', color: colors.magenta, letterSpacing: 0.4 },
  eventName: { ...type.title, fontSize: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...type.caption, color: colors.textMuted, flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  host: { ...type.caption, flexShrink: 1 },
  empty: { alignItems: 'center', marginTop: 50, paddingHorizontal: 32, gap: 14 },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },
})
