import { useCallback, useMemo, useState } from 'react'
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
import { CATEGORIES, fetchEvents, fetchProfiles, getCategory, isUnlimited, formatEventWhen, defaultEnd, eventPlace } from '../lib/events'

// Kept for any older imports: id -> username.
export async function fetchUsernames(ids) {
  const profiles = await fetchProfiles(ids)
  return Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.username]))
}

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'mine', label: 'My events' },
  { key: 'past', label: 'Past' },
]

// Lists real events from the `events` table. No placeholder data: on failure an error with
// Retry is shown, otherwise an empty state.
export default function EventsScreen({ navigation }) {
  const [events, setEvents] = useState([])
  const [profiles, setProfiles] = useState({})
  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('upcoming')
  const [category, setCategory] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      setUserId(auth?.user?.id ?? null)
      const rows = await fetchEvents()
      setEvents(rows)
      setProfiles(await fetchProfiles(rows.map((e) => e.creator_id)))
    } catch (e) {
      console.warn('Failed to load events', e)
      setEvents([])
      setError('Couldn’t load events. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const { upcoming, past, mine } = useMemo(() => {
    const now = Date.now()
    const endOf = (e) => (defaultEnd(e) || new Date(e.event_date)).getTime()
    const up = events.filter((e) => endOf(e) > now)
    const pa = events.filter((e) => endOf(e) <= now).reverse()
    const my = userId ? events.filter((e) => e.creator_id === userId || e.attendeeIds.includes(userId)) : []
    return { upcoming: up, past: pa, mine: my }
  }, [events, userId])

  const base = tab === 'upcoming' ? upcoming : tab === 'past' ? past : mine
  const shown = category ? base.filter((e) => (e.category || (getGame(e.game_id) ? 'gaming' : null)) === category) : base
  const counts = { upcoming: upcoming.length, mine: mine.length, past: past.length }

  const renderEvent = ({ item: event }) => {
    const cat = getCategory(event.category)
    const game = getGame(event.game_id)
    const start = new Date(event.event_date)
    const host = profiles[event.creator_id]
    const isMine = event.creator_id === userId
    return (
      <Pressable
        onPress={() => navigation.navigate('EventDetails', { eventId: event.id })}
        style={({ pressed }) => [styles.cardWrap, pressed && { transform: [{ scale: 0.985 }] }]}
        accessibilityRole="button"
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
                  <Text style={styles.badgeText}>{cat?.label || game?.name}</Text>
                </View>
              ) : null}
              {event.visibility === 'invite' ? (
                <View style={styles.badge}><Ionicons name="lock-closed" size={10} color="#fff" /><Text style={styles.badgeText}>Invite only</Text></View>
              ) : null}
              {isMine ? <View style={styles.badge}><Text style={styles.badgeText}>Hosting</Text></View> : null}
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
              <Text style={styles.meta} numberOfLines={1}>{eventPlace(event)}</Text>
            </View>
            <View style={styles.footer}>
              <Text style={styles.meta}>
                {isUnlimited(event.max_players) ? `${event.goingCount} going` : `${event.goingCount}/${event.max_players} going`}
                {event.interestedCount ? ` · ${event.interestedCount} interested` : ''}
              </Text>
              {host?.username ? <Text style={styles.host} numberOfLines={1}>by {host.username}</Text> : null}
            </View>
          </View>
        </GlassPanel>
      </Pressable>
    )
  }

  return (
    <View style={styles.screen}>
      <BrandHeader
        title="Events"
        onBack={() => navigation.goBack()}
        right={
          <GlassButton size="sm" variant="primary" onPress={() => navigation.navigate('CreateEvent')} icon={<Ionicons name="add" size={16} color={colors.ink} />}>
            Create
          </GlassButton>
        }
      />
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label} ({counts[t.key]})</Text>
            </Pressable>
          )
        })}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
          <Pressable onPress={() => setCategory(null)} style={[styles.cat, !category && styles.catActive]}>
            <Text style={[styles.catText, !category && styles.catTextActive]}>All</Text>
          </Pressable>
          {CATEGORIES.map((c) => (
            <Pressable key={c.key} onPress={() => setCategory(category === c.key ? null : c.key)} style={[styles.cat, category === c.key && styles.catActive]}>
              <Ionicons name={c.icon} size={13} color={category === c.key ? colors.ink : colors.text} />
              <Text style={[styles.catText, category === c.key && styles.catTextActive]}>{c.label}</Text>
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
                {error || (tab === 'upcoming' ? 'No upcoming events yet.' : tab === 'mine' ? 'Events you host or RSVP to show up here.' : 'No past events.')}
              </Text>
              <GlassButton size="sm" variant={error ? 'glass' : 'primary'} onPress={error ? load : () => navigation.navigate('CreateEvent')}>
                {error ? 'Retry' : 'Host an event'}
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
