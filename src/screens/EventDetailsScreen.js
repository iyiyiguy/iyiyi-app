import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator, Image, Share, Linking, Platform, useColorScheme,
} from 'react-native'
import MapView from '../components/SafeMapView'
import { Marker } from 'react-native-maps'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { GlassButton } from '../components/GlassButton'
import InvitePeopleSheet from '../components/InvitePeopleSheet'
import { colors, radii, type } from '../theme'
import { supabase } from '../lib/supabase'
import { getGame } from '../lib/games'
import { openProfile } from '../lib/profileNav'
import { sendEventInvite } from '../lib/invites'
import {
  fetchEvent, fetchAttendees, fetchProfiles, fetchInvitedIds, recordInvite, setRsvp, getLocalInterested,
  getCategory, isUnlimited, formatEventWhen, formatDay, formatTime, defaultEnd, eventPlace, eventShareUrl,
} from '../lib/events'
import { addToCalendar } from '../lib/calendar'

// A shareable event page: cover, title, date/time, location with mini-map + directions, host,
// attendee avatars, Going/Interested RSVP, share link, add-to-calendar and (for hosts) invites.
// Opened from Events, the Map, invite banners (params { eventId }) and after creating (created: true).
export default function EventDetailsScreen({ navigation, route }) {
  const eventId = route?.params?.eventId
  const justCreated = !!route?.params?.created
  const scheme = useColorScheme()
  const [event, setEvent] = useState(null)
  const [attendees, setAttendees] = useState([])
  const [profiles, setProfiles] = useState({})
  const [userId, setUserId] = useState(null)
  const [localInterested, setLocalInterested] = useState(false)
  const [invitedIds, setInvitedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // 'going' | 'interested' | null
  const [inviteOpen, setInviteOpen] = useState(false)
  const [calState, setCalState] = useState('idle') // 'idle' | 'adding' | 'added'
  const onAddToCalendar = async () => {
    if (!event || calState === 'adding') return
    setCalState('adding')
    let result = 'error'
    try {
      result = await addToCalendar(event)
    } catch {
      result = 'error'
    }
    setCalState(result === 'added' || (result === 'duplicate-skipped' && calState === 'added') ? 'added' : 'idle')
  }
  const newlyInvited = useRef(new Set())
  const autoOpened = useRef(false)

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Event not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const me = auth?.user?.id ?? null
      setUserId(me)
      const ev = await fetchEvent(eventId)
      if (!ev) {
        setEvent(null)
        setError('This event no longer exists, or it’s invite only.')
        return
      }
      const att = await fetchAttendees(eventId)
      const [profs, interested, invited] = await Promise.all([
        fetchProfiles([ev.creator_id, ...att.map((a) => a.user_id)]),
        getLocalInterested(eventId),
        me && me === ev.creator_id ? fetchInvitedIds(eventId) : Promise.resolve([]),
      ])
      setEvent(ev)
      setAttendees(att)
      setProfiles(profs)
      setLocalInterested(interested)
      setInvitedIds(invited)
    } catch (e) {
      console.warn('Failed to load event', e)
      setError('Couldn’t load this event. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => { load() }, [load])

  const isHost = !!event && !!userId && event.creator_id === userId
  useEffect(() => {
    if (justCreated && isHost && !autoOpened.current) {
      autoOpened.current = true
      setInviteOpen(true)
    }
  }, [justCreated, isHost])

  const going = attendees.filter((a) => a.status !== 'interested')
  const interestedList = attendees.filter((a) => a.status === 'interested')
  const myRow = userId ? attendees.find((a) => a.user_id === userId) : null
  const myStatus = myRow ? myRow.status : localInterested ? 'interested' : null
  const unlimited = event ? isUnlimited(event.max_players) : true
  const isFull = event && !unlimited ? going.length >= event.max_players : false
  const endsAt = event ? defaultEnd(event) : null
  const isPast = event ? (endsAt ? endsAt : new Date(event.event_date)) <= new Date() : false
  const canInvite = !!event && !!userId && (isHost || (event.visibility === 'public' && !isPast))
  const hasCoords = !!event && Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
  const category = event ? getCategory(event.category) : null
  const game = event ? getGame(event.game_id) : null
  const host = event ? profiles[event.creator_id] : null

  const rsvp = async (status) => {
    if (!userId) return Alert.alert('Sign in required', 'Sign in to RSVP.')
    const next = myStatus === status ? null : status
    if (next === 'going' && isFull && myStatus !== 'going') return Alert.alert('Event is full', 'There are no spots left.')
    Haptics.selectionAsync().catch(() => {})
    setBusy(status)
    try {
      await setRsvp(eventId, userId, next)
      await load()
    } catch (e) {
      Alert.alert('Couldn’t update your RSVP', e?.message || 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const share = async () => {
    if (!event) return
    const url = eventShareUrl(event.id)
    const when = formatEventWhen(event.event_date, event.ends_at)
    const message = `${event.name}\n${when}\n📍 ${eventPlace(event)}\n\n${url}`
    try {
      await Share.share(Platform.OS === 'ios' ? { message: `${event.name}\n${when}\n📍 ${eventPlace(event)}`, url, title: event.name } : { message, title: event.name })
    } catch (e) {
      Alert.alert('Couldn’t share', e?.message || 'Please try again.')
    }
  }

  const openDirections = () => {
    if (!event) return
    const q = encodeURIComponent(event.address || event.location || event.name)
    const url = hasCoords
      ? Platform.OS === 'ios'
        ? `https://maps.apple.com/?daddr=${event.latitude},${event.longitude}&q=${encodeURIComponent(event.name)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`
      : Platform.OS === 'ios'
        ? `https://maps.apple.com/?q=${q}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`
    Linking.openURL(url).catch(() => Alert.alert('Couldn’t open maps'))
  }

  const onInvite = async (user) => {
    if (!event || !user?.id) throw new Error('Missing person')
    await sendEventInvite(user.id, { eventId: event.id, title: event.name, startsAt: event.event_date })
    newlyInvited.current.add(user.id)
    recordInvite(event.id, user.id, userId)
  }

  const closeInvites = () => {
    setInviteOpen(false)
    if (newlyInvited.current.size) {
      const added = [...newlyInvited.current]
      newlyInvited.current = new Set()
      setInvitedIds((prev) => [...new Set([...prev, ...added])])
    }
  }

  const nameOf = (id) => (id === userId ? 'You' : profiles[id]?.username || 'iYiYi user')

  return (
    <View style={styles.screen}>
      <BrandHeader
        title="Event"
        onBack={() => navigation.goBack()}
        right={event ? <HeaderButton icon="share-outline" label="Share event" onPress={share} /> : null}
      />
      {loading && !event ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
      ) : !event ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-clear-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{error || 'Event not found.'}</Text>
          <GlassButton size="sm" onPress={load}>Retry</GlassButton>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Hero */}
          <GlassPanel radius={radii.lg} animateIn={false}>
            <View style={styles.hero}>
              {event.cover_url ? (
                <Image source={{ uri: event.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <LinearGradient colors={['#a9b8ff', '#c6a9ff', '#ffc4de']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
              <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.heroShade} />
              <View style={styles.heroBadges}>
                {category || game ? (
                  <View style={styles.badge}>
                    <Ionicons name={category?.icon || 'game-controller-outline'} size={12} color="#fff" />
                    <Text style={styles.badgeText}>{category?.label || game?.name}</Text>
                  </View>
                ) : null}
                {event.visibility === 'invite' ? (
                  <View style={styles.badge}>
                    <Ionicons name="lock-closed" size={11} color="#fff" />
                    <Text style={styles.badgeText}>Invite only</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.dateTile}>
                <Text style={styles.dateTileMonth}>{new Date(event.event_date).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text>
                <Text style={styles.dateTileDay}>{new Date(event.event_date).getDate()}</Text>
              </View>
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.title}>{event.name}</Text>
              <InfoRow icon="calendar-outline" title={formatDay(event.event_date)} sub={`${formatTime(event.event_date)}${endsAt ? ` – ${formatTime(endsAt)}` : ''}`} />
              <InfoRow icon="location-outline" title={event.location || 'Location'} sub={event.address && event.address !== event.location ? event.address : null} />
              <InfoRow
                icon="people-outline"
                title={unlimited ? `${going.length} going` : `${going.length} / ${event.max_players} going`}
                sub={interestedList.length || (localInterested && !myRow) ? `${interestedList.length + (localInterested && !myRow ? 1 : 0)} interested` : null}
              />
              {isPast ? (
                <Text style={styles.pastNote}>This event has ended.</Text>
              ) : (
                <View style={styles.rsvpRow}>
                  <RsvpButton
                    label={myStatus === 'going' ? 'Going' : isFull ? 'Full' : 'Going'}
                    icon={myStatus === 'going' ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    active={myStatus === 'going'}
                    busy={busy === 'going'}
                    disabled={!!busy || (isFull && myStatus !== 'going')}
                    onPress={() => rsvp('going')}
                  />
                  <RsvpButton
                    label="Interested"
                    icon={myStatus === 'interested' ? 'star' : 'star-outline'}
                    active={myStatus === 'interested'}
                    busy={busy === 'interested'}
                    disabled={!!busy}
                    onPress={() => rsvp('interested')}
                  />
                </View>
              )}
            </View>
          </GlassPanel>

          {/* Actions */}
          <View style={styles.actions}>
            <ActionTile icon="share-social-outline" label="Share" onPress={share} />
            <ActionTile
              icon={calState === 'added' ? 'checkmark-circle-outline' : 'calendar-number-outline'}
              label={calState === 'adding' ? 'Adding…' : calState === 'added' ? 'In calendar' : 'Add to calendar'}
              onPress={onAddToCalendar}
            />
            {canInvite ? <ActionTile icon="person-add-outline" label="Invite" onPress={() => setInviteOpen(true)} /> : null}
          </View>

          {/* About */}
          {event.description ? (
            <>
              <Text style={styles.section}>About</Text>
              <GlassPanel style={styles.card} radius={radii.md} animateIn={false}>
                <Text style={styles.description}>{event.description}</Text>
              </GlassPanel>
            </>
          ) : null}

          {/* Location */}
          <Text style={styles.section}>Location</Text>
          <GlassPanel radius={radii.md} animateIn={false}>
            {hasCoords && Platform.OS !== 'web' ? (
              <View style={styles.miniMap} pointerEvents="none">
                <MapView
                  style={StyleSheet.absoluteFill}
                  initialRegion={{ latitude: event.latitude, longitude: event.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  liteMode
                  userInterfaceStyle={scheme === 'light' ? 'light' : 'dark'}
                >
                  <Marker coordinate={{ latitude: event.latitude, longitude: event.longitude }} tracksViewChanges={false}>
                    <View style={styles.mapPin}><Ionicons name="calendar" size={15} color="#fff" /></View>
                  </Marker>
                </MapView>
              </View>
            ) : null}
            <View style={styles.locBody}>
              <View style={{ flex: 1 }}>
                <Text style={type.headline} numberOfLines={2}>{event.location || 'Location'}</Text>
                {event.address && event.address !== event.location ? <Text style={type.caption} numberOfLines={2}>{event.address}</Text> : null}
              </View>
              <GlassButton size="sm" onPress={openDirections} icon={<Ionicons name="navigate-outline" size={14} color={colors.text} />}>Directions</GlassButton>
            </View>
          </GlassPanel>

          {/* Host */}
          <Text style={styles.section}>Hosted by</Text>
          <Pressable onPress={() => openProfile(navigation, event.creator_id)} accessibilityRole="button">
            <GlassPanel style={[styles.card, styles.hostRow]} radius={radii.md} animateIn={false}>
              <Avatar profile={host} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={type.headline}>{isHost ? 'You' : host?.username || 'iYiYi user'}</Text>
                <Text style={type.caption}>Host</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </GlassPanel>
          </Pressable>

          {/* Attendees */}
          <Text style={styles.section}>Going ({going.length})</Text>
          <GlassPanel style={styles.card} radius={radii.md} animateIn={false}>
            {going.length === 0 ? (
              <Text style={type.caption}>No one has RSVP’d yet. Be the first!</Text>
            ) : (
              <>
                <View style={styles.stack}>
                  {going.slice(0, 8).map((a, i) => (
                    <View key={a.user_id} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }]}>
                      <Avatar profile={profiles[a.user_id]} size={34} />
                    </View>
                  ))}
                  {going.length > 8 ? (
                    <View style={[styles.stackItem, styles.stackMore]}><Text style={styles.stackMoreText}>+{going.length - 8}</Text></View>
                  ) : null}
                </View>
                {going.map((a) => (
                  <Pressable key={a.user_id} onPress={() => openProfile(navigation, a.user_id)} style={styles.attendeeRow} accessibilityRole="button">
                    <Avatar profile={profiles[a.user_id]} size={30} />
                    <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{nameOf(a.user_id)}</Text>
                    {a.user_id === event.creator_id ? <Text style={styles.hostTag}>HOST</Text> : null}
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </>
            )}
          </GlassPanel>

          {interestedList.length ? (
            <>
              <Text style={styles.section}>Interested ({interestedList.length})</Text>
              <GlassPanel style={styles.card} radius={radii.md} animateIn={false}>
                {interestedList.map((a) => (
                  <Pressable key={a.user_id} onPress={() => openProfile(navigation, a.user_id)} style={styles.attendeeRow} accessibilityRole="button">
                    <Avatar profile={profiles[a.user_id]} size={30} />
                    <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{nameOf(a.user_id)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </GlassPanel>
            </>
          ) : null}

          <Text style={styles.linkNote} selectable>{eventShareUrl(event.id)}</Text>
        </ScrollView>
      )}

      {event && canInvite ? (
        <InvitePeopleSheet
          visible={inviteOpen}
          onClose={closeInvites}
          title={`Invite to ${event.name}`}
          subtitle={`They’ll get a notification to open the event · ${formatEventWhen(event.event_date, event.ends_at)}`}
          excludeIds={[...attendees.map((a) => a.user_id), ...invitedIds, ...(userId ? [userId] : [])]}
          onInvite={onInvite}
        />
      ) : null}
    </View>
  )
}

function Avatar({ profile, size }) {
  const [failed, setFailed] = useState(false)
  const s = { width: size, height: size, borderRadius: size / 2 }
  if (profile?.avatar_url && !failed) {
    return <Image source={{ uri: profile.avatar_url }} style={[styles.avatar, s]} onError={() => setFailed(true)} />
  }
  const initial = (String(profile?.username || '?').trim()[0] || '?').toUpperCase()
  return (
    <View style={[styles.avatar, styles.avatarEmpty, s]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  )
}

function InfoRow({ icon, title, sub }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}><Ionicons name={icon} size={18} color={colors.text} /></View>
      <View style={{ flex: 1 }}>
        <Text style={type.headline} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={type.caption} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </View>
  )
}

function RsvpButton({ label, icon, active, busy, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.rsvp, active && styles.rsvpActive, disabled && !active && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.97 }] }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      {busy ? <ActivityIndicator size="small" color={active ? colors.ink : colors.text} /> : <Ionicons name={icon} size={18} color={active ? colors.ink : colors.text} />}
      <Text style={[styles.rsvpText, active && { color: colors.ink }]}>{label}</Text>
    </Pressable>
  )
}

function ActionTile({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button" accessibilityLabel={label}>
      <GlassPanel radius={radii.md} animateIn={false} style={styles.actionTile}>
        <Ionicons name={icon} size={22} color={colors.text} />
        <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
      </GlassPanel>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 80 },
  hero: { height: 190, overflow: 'hidden', borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 },
  heroBadges: { position: 'absolute', left: 12, top: 12, flexDirection: 'row', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dateTile: {
    position: 'absolute', right: 12, bottom: 12, width: 54, paddingVertical: 6, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center',
  },
  dateTileMonth: { fontSize: 11, fontWeight: '800', color: '#5b6cf0', letterSpacing: 0.6 },
  dateTileDay: { fontSize: 22, fontWeight: '800', color: '#151a2b', marginTop: -2 },
  heroBody: { padding: 16, gap: 12 },
  title: { ...type.display, fontSize: 26 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoIcon: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  rsvpRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  rsvp: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  rsvpActive: { backgroundColor: colors.text, borderColor: colors.text },
  rsvpText: { ...type.body, fontWeight: '700' },
  pastNote: { ...type.caption, marginTop: 4 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionTile: { paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center', gap: 6 },
  actionText: { fontSize: 12, fontWeight: '600', color: colors.text },

  section: { ...type.label, marginTop: 22, marginBottom: 10 },
  card: { padding: 16 },
  description: { ...type.body, lineHeight: 22 },

  miniMap: { height: 150, overflow: 'hidden', borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  mapPin: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5b6cf0', borderWidth: 2, borderColor: '#fff' },
  locBody: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },

  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  avatar: { backgroundColor: colors.inkSurfaceRaised },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#8fa2ff' },
  avatarInitial: { color: '#fff', fontWeight: '800' },

  stack: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stackItem: { borderRadius: 20, borderWidth: 2, borderColor: colors.ink },
  stackMore: { marginLeft: -10, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inkSurfaceRaised },
  stackMoreText: { fontSize: 12, fontWeight: '700', color: colors.text },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  hostTag: { fontSize: 10, fontWeight: '800', color: colors.magenta, letterSpacing: 0.6 },

  linkNote: { ...type.caption, fontSize: 11, textAlign: 'center', marginTop: 24 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32, gap: 14 },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },
})
