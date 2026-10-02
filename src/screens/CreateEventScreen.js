import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, Pressable, ScrollView, StyleSheet, Alert, TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { GlassButton } from '../components/GlassButton'
import MapPickerModal from '../components/MapPickerModal'
import { colors, radii, type } from '../theme'
import { supabase } from '../lib/supabase'
import { GAMES } from '../lib/games'
import {
  CATEGORIES, UNLIMITED_CAPACITY, createEvent, setRsvp, uploadEventCover, formatEventWhen, getCategory,
} from '../lib/events'

const DAY_MS = 24 * 3600 * 1000
const CAPACITY_PRESETS = [10, 25, 50, 100, 250]
const DURATIONS = [60, 120, 180, 240, 360, 480]
const durationLabel = (m) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

function defaultStart() {
  const d = new Date(Date.now() + DAY_MS)
  d.setHours(18, 0, 0, 0)
  return d
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

function formatAddress(a) {
  if (!a) return ''
  if (a.formattedAddress) return a.formattedAddress
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ')
  return [a.name && a.name !== street ? a.name : null, street, a.city, a.region].filter(Boolean).join(', ')
}

// Professional event setup: cover, details, category, date/time, location (here / map / typed),
// capacity and privacy, with a live preview. Inserts into `events` (002 + 010 migrations; the
// 010 columns are dropped automatically if that migration hasn't run) and RSVPs the host.
export default function CreateEventScreen({ navigation }) {
  const [userId, setUserId] = useState(null)
  const [cover, setCover] = useState(null) // local uri
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(null)
  const [selectedGame, setSelectedGame] = useState(null)
  const [start, setStart] = useState(defaultStart)
  const [duration, setDuration] = useState(120) // minutes
  const [venue, setVenue] = useState('')
  const [address, setAddress] = useState('')
  const [coords, setCoords] = useState(null)
  const [locBusy, setLocBusy] = useState(null) // 'here' | 'find' | null
  const [pickerOpen, setPickerOpen] = useState(false)
  const [capacity, setCapacity] = useState(25)
  const [unlimited, setUnlimited] = useState(false)
  const [visibility, setVisibility] = useState('public')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data }) => { if (alive) setUserId(data?.user?.id ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const end = useMemo(() => new Date(start.getTime() + duration * 60000), [start, duration])
  const days = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Array.from({ length: 90 }, (_, i) => new Date(today.getTime() + i * DAY_MS))
  }, [])

  const tap = () => Haptics.selectionAsync().catch(() => {})
  const clearError = (k) => setErrors((e) => (e[k] ? { ...e, [k]: null } : e))

  // ---- cover ----
  const pickCover = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.85 })
      if (res?.canceled || !res?.assets?.[0]?.uri) return
      setCover(res.assets[0].uri)
    } catch (e) {
      Alert.alert('Couldn’t open photos', e?.message || 'Please try again.')
    }
  }

  // ---- date/time ----
  const pickDay = (day) => {
    tap()
    const next = new Date(day)
    next.setHours(start.getHours(), start.getMinutes(), 0, 0)
    setStart(next)
    clearError('when')
  }
  const nudgeStart = (mins) => {
    tap()
    setStart((s) => new Date(s.getTime() + mins * 60000))
    clearError('when')
  }
  const nudgeDuration = (mins) => {
    tap()
    setDuration((d) => Math.min(7 * 24 * 60, Math.max(15, d + mins)))
  }

  // ---- location ----
  const useCurrentLocation = async () => {
    setLocBusy('here')
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Allow location access to use where you are now.')
        return
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setCoords(c)
      clearError('where')
      try {
        const [a] = await Location.reverseGeocodeAsync(c)
        const text = formatAddress(a)
        if (text) setAddress(text)
      } catch { /* coordinates are enough */ }
    } catch (e) {
      Alert.alert('Couldn’t get your location', e?.message || 'Please try again.')
    } finally {
      setLocBusy(null)
    }
  }

  const findAddress = async () => {
    const q = address.trim()
    if (!q) return
    setLocBusy('find')
    try {
      try { await Location.requestForegroundPermissionsAsync() } catch { /* geocoding may still work */ }
      const results = await Location.geocodeAsync(q)
      const r = results?.[0]
      if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) {
        Alert.alert('Address not found', 'Try adding a city, or pick the spot on the map.')
        return
      }
      setCoords({ latitude: r.latitude, longitude: r.longitude })
      clearError('where')
    } catch (e) {
      Alert.alert('Couldn’t look that up', e?.message || 'Try picking the spot on the map.')
    } finally {
      setLocBusy(null)
    }
  }

  const onPickedOnMap = async (c) => {
    setPickerOpen(false)
    setCoords(c)
    clearError('where')
    try {
      const [a] = await Location.reverseGeocodeAsync(c)
      const text = formatAddress(a)
      if (text) setAddress(text)
    } catch { /* fine */ }
  }

  // ---- validation + submit ----
  const validate = () => {
    const e = {}
    if (name.trim().length < 3) e.name = 'Give your event a name (at least 3 characters).'
    if (!category) e.category = 'Pick a category.'
    if (start.getTime() <= Date.now() + 5 * 60000) e.when = 'Start time must be in the future.'
    if (!venue.trim() && !address.trim()) e.where = 'Add a venue name or an address.'
    if (!unlimited && (!Number.isFinite(capacity) || capacity < 2 || capacity >= UNLIMITED_CAPACITY)) e.capacity = 'Capacity must be at least 2.'
    setErrors(e)
    return e
  }

  const confirmAsync = (title, msg, okText) =>
    new Promise((resolve) => {
      Alert.alert(title, msg, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) })
    })

  const handleCreate = async () => {
    if (!userId) return Alert.alert('Sign in required', 'Sign in to create an event.')
    const e = validate()
    const first = Object.values(e).find(Boolean)
    if (first) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      return Alert.alert('Almost there', first)
    }

    setLoading(true)
    try {
      let coverUrl = null
      if (cover) {
        try {
          coverUrl = await uploadEventCover(cover, userId)
        } catch {
          const go = await confirmAsync('Cover photo didn’t upload', 'Create the event without a cover? You can try again later.', 'Create anyway')
          if (!go) return
        }
      }
      const place = venue.trim() || address.trim()
      const base = {
        name: name.trim(),
        description: description.trim() || null,
        location: place,
        game_id: category === 'gaming' && selectedGame ? selectedGame : category,
        max_players: unlimited ? UNLIMITED_CAPACITY : capacity,
        current_players: 1,
        creator_id: userId,
        event_date: start.toISOString(),
      }
      const ext = {
        cover_url: coverUrl,
        category,
        ends_at: end.toISOString(),
        address: address.trim() || null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        visibility,
      }
      const data = await createEvent(base, ext)
      try { await setRsvp(data.id, userId, 'going') } catch { /* host can RSVP from the event page */ }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      navigation.replace('EventDetails', { eventId: data.id, created: true })
    } catch (err) {
      Alert.alert('Couldn’t create event', err?.message || 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const cat = getCategory(category)

  return (
    <View style={styles.screen}>
      <BrandHeader title="New Event" subtitle="Host something great" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Cover */}
          <Pressable onPress={pickCover} accessibilityRole="button" accessibilityLabel="Choose cover photo">
            <GlassPanel radius={radii.md} animateIn={false} style={styles.coverPanel}>
              {cover ? (
                <View style={styles.coverBox}>
                  <Image source={{ uri: cover }} style={styles.coverImg} />
                  <View style={styles.coverActions}>
                    <GlassButton size="sm" tint="dark" onPress={pickCover} icon={<Ionicons name="image-outline" size={14} color="#fff" />}>Change</GlassButton>
                    <GlassButton size="sm" tint="dark" onPress={() => setCover(null)} icon={<Ionicons name="trash-outline" size={14} color="#fff" />}>Remove</GlassButton>
                  </View>
                </View>
              ) : (
                <View style={[styles.coverBox, styles.coverEmpty]}>
                  <Ionicons name="image-outline" size={30} color={colors.textMuted} />
                  <Text style={styles.coverTitle}>Add a cover photo</Text>
                  <Text style={type.caption}>16:9 looks best · optional</Text>
                </View>
              )}
            </GlassPanel>
          </Pressable>

          {/* Details */}
          <Section icon="create-outline" title="Details">
            <Text style={styles.label}>Event name</Text>
            <TextInput
              style={[styles.input, errors.name && styles.inputError]}
              placeholder="e.g. Rooftop sunset meetup"
              placeholderTextColor={colors.textFaint}
              value={name}
              onChangeText={(t) => { setName(t); clearError('name') }}
              maxLength={80}
            />
            <FieldError text={errors.name} />
            <View style={styles.labelRow}>
              <Text style={styles.label}>Description</Text>
              <Text style={styles.counter}>{description.length}/600</Text>
            </View>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="What should people expect? Dress code, what to bring, schedule…"
              placeholderTextColor={colors.textFaint}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={600}
            />
          </Section>

          {/* Category */}
          <Section icon="pricetag-outline" title="Category">
            <View style={styles.chips}>
              {CATEGORIES.map((c) => (
                <Chip key={c.key} active={category === c.key} icon={c.icon} label={c.label} onPress={() => { tap(); setCategory(c.key); clearError('category') }} />
              ))}
            </View>
            <FieldError text={errors.category} />
            {category === 'gaming' ? (
              <>
                <Text style={[styles.label, { marginTop: 14 }]}>Game (optional)</Text>
                <View style={styles.chips}>
                  {GAMES.map((g) => (
                    <Chip key={g.id} active={selectedGame === g.id} label={`${g.icon} ${g.name}`} onPress={() => { tap(); setSelectedGame(selectedGame === g.id ? null : g.id) }} />
                  ))}
                </View>
              </>
            ) : null}
          </Section>

          {/* When */}
          <Section icon="time-outline" title="Date & time">
            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
              {days.map((d) => {
                const active = sameDay(d, start)
                return (
                  <Pressable key={d.toISOString()} onPress={() => pickDay(d)} style={[styles.day, active && styles.dayActive]}>
                    <Text style={[styles.dayWeek, active && styles.dayTextActive]}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                    <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.getDate()}</Text>
                    <Text style={[styles.dayWeek, active && styles.dayTextActive]}>{d.toLocaleDateString(undefined, { month: 'short' })}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            <Text style={[styles.label, { marginTop: 14 }]}>Starts</Text>
            <Stepper
              value={start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              sub={start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              onMinusBig={() => nudgeStart(-60)}
              onMinus={() => nudgeStart(-15)}
              onPlus={() => nudgeStart(15)}
              onPlusBig={() => nudgeStart(60)}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Length</Text>
            <View style={styles.chips}>
              {DURATIONS.map((m) => (
                <Chip key={m} active={duration === m} label={durationLabel(m)} onPress={() => { tap(); setDuration(m) }} />
              ))}
            </View>
            <Text style={[styles.label, { marginTop: 14 }]}>Ends</Text>
            <Stepper
              value={end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              sub={sameDay(end, start) ? `${durationLabel(duration)} event` : end.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              onMinus={() => nudgeDuration(-15)}
              onPlus={() => nudgeDuration(15)}
            />
            <FieldError text={errors.when} />
          </Section>

          {/* Where */}
          <Section icon="location-outline" title="Location">
            <Text style={styles.label}>Venue name</Text>
            <TextInput
              style={[styles.input, errors.where && styles.inputError]}
              placeholder="e.g. The Grove, rooftop bar"
              placeholderTextColor={colors.textFaint}
              value={venue}
              onChangeText={(t) => { setVenue(t); clearError('where') }}
              maxLength={80}
            />
            <Text style={[styles.label, { marginTop: 10 }]}>Address</Text>
            <View style={styles.addressRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Street, city"
                placeholderTextColor={colors.textFaint}
                value={address}
                onChangeText={(t) => { setAddress(t); clearError('where') }}
                onSubmitEditing={findAddress}
                returnKeyType="search"
                maxLength={160}
              />
              <GlassButton size="sm" onPress={findAddress} disabled={!address.trim() || !!locBusy}>
                {locBusy === 'find' ? 'Finding…' : 'Find'}
              </GlassButton>
            </View>
            <View style={styles.locButtons}>
              <GlassButton size="sm" onPress={useCurrentLocation} disabled={!!locBusy} icon={locBusy === 'here' ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="navigate-outline" size={15} color={colors.text} />}>
                Use current location
              </GlassButton>
              {Platform.OS !== 'web' ? (
                <GlassButton size="sm" onPress={() => setPickerOpen(true)} disabled={!!locBusy} icon={<Ionicons name="map-outline" size={15} color={colors.text} />}>
                  Pick on map
                </GlassButton>
              ) : null}
            </View>
            {coords ? (
              <View style={styles.pinned}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.pinnedText}>Pinned on the map · {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</Text>
                <Pressable onPress={() => setCoords(null)} hitSlop={8}><Text style={styles.link}>Clear</Text></Pressable>
              </View>
            ) : (
              <Text style={[type.caption, { marginTop: 8 }]}>Pin the exact spot so guests get a map and directions.</Text>
            )}
            <FieldError text={errors.where} />
          </Section>

          {/* Capacity */}
          <Section icon="people-outline" title="Capacity">
            <View style={styles.chips}>
              {CAPACITY_PRESETS.map((n) => (
                <Chip key={n} active={!unlimited && capacity === n} label={String(n)} onPress={() => { tap(); setUnlimited(false); setCapacity(n); clearError('capacity') }} />
              ))}
              <Chip active={unlimited} icon="infinite-outline" label="Unlimited" onPress={() => { tap(); setUnlimited(true); clearError('capacity') }} />
            </View>
            {!unlimited ? (
              <View style={{ marginTop: 12 }}>
                <Stepper
                  value={`${capacity} guests`}
                  onMinusBig={() => { tap(); setCapacity((c) => Math.max(2, c - 10)) }}
                  onMinus={() => { tap(); setCapacity((c) => Math.max(2, c - 1)) }}
                  onPlus={() => { tap(); setCapacity((c) => Math.min(UNLIMITED_CAPACITY - 1, c + 1)) }}
                  onPlusBig={() => { tap(); setCapacity((c) => Math.min(UNLIMITED_CAPACITY - 1, c + 10)) }}
                />
              </View>
            ) : null}
            <FieldError text={errors.capacity} />
          </Section>

          {/* Privacy */}
          <Section icon="lock-closed-outline" title="Who can see it">
            <View style={styles.segment}>
              {[
                { key: 'public', icon: 'globe-outline', title: 'Public', sub: 'Anyone on iYiYi can find and join' },
                { key: 'invite', icon: 'mail-outline', title: 'Invite only', sub: 'Only people you invite can see it' },
              ].map((o) => {
                const active = visibility === o.key
                return (
                  <Pressable key={o.key} onPress={() => { tap(); setVisibility(o.key) }} style={[styles.segmentItem, active && styles.segmentItemActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                    <Ionicons name={o.icon} size={18} color={active ? colors.ink : colors.text} />
                    <Text style={[styles.segmentTitle, active && { color: colors.ink }]}>{o.title}</Text>
                    <Text style={[styles.segmentSub, active && { color: colors.ink, opacity: 0.75 }]}>{o.sub}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={[type.caption, { marginTop: 10 }]}>You can invite people right after creating the event.</Text>
          </Section>

          {/* Preview */}
          <Text style={styles.previewLabel}>Preview</Text>
          <GlassPanel radius={radii.md} animateIn={false} style={styles.previewCard}>
            <View style={styles.previewCover}>
              {cover ? (
                <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} />
              ) : (
                <LinearGradient colors={['#a9b8ff', '#c6a9ff', '#ffc4de']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
              {cat ? (
                <View style={styles.previewBadge}>
                  <Ionicons name={cat.icon} size={12} color="#fff" />
                  <Text style={styles.previewBadgeText}>{cat.label}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ padding: 14, gap: 4 }}>
              <Text style={styles.previewWhen}>{formatEventWhen(start, end).toUpperCase()}</Text>
              <Text style={type.title} numberOfLines={2}>{name.trim() || 'Your event name'}</Text>
              <Text style={type.caption} numberOfLines={1}>
                {venue.trim() || address.trim() || 'Location'} · {unlimited ? 'Unlimited spots' : `${capacity} spots`} · {visibility === 'invite' ? 'Invite only' : 'Public'}
              </Text>
            </View>
          </GlassPanel>

          <GlassButton variant="primary" size="lg" onPress={handleCreate} disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Creating…' : 'Create event'}
          </GlassButton>
        </ScrollView>
      </KeyboardAvoidingView>
      {Platform.OS !== 'web' ? (
        <MapPickerModal visible={pickerOpen} initial={coords} onClose={() => setPickerOpen(false)} onPick={onPickedOnMap} />
      ) : null}
    </View>
  )
}

function Section({ icon, title, children }) {
  return (
    <GlassPanel style={styles.section} radius={radii.md} animateIn={false}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={16} color={colors.textMuted} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </GlassPanel>
  )
}

function Chip({ active, label, icon, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      {icon ? <Ionicons name={icon} size={14} color={active ? colors.ink : colors.text} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

function StepBtn({ label, onPress, icon }) {
  if (!onPress) return null
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : <Text style={styles.stepBtnText}>{label}</Text>}
    </Pressable>
  )
}

function Stepper({ value, sub, onMinus, onPlus, onMinusBig, onPlusBig }) {
  return (
    <View style={styles.stepper}>
      <StepBtn label={onMinusBig ? '−−' : ''} icon="play-back-outline" onPress={onMinusBig} />
      <StepBtn label="Decrease" icon="remove" onPress={onMinus} />
      <View style={styles.stepValue}>
        <Text style={styles.stepValueText}>{value}</Text>
        {sub ? <Text style={type.caption}>{sub}</Text> : null}
      </View>
      <StepBtn label="Increase" icon="add" onPress={onPlus} />
      <StepBtn label={onPlusBig ? '++' : ''} icon="play-forward-outline" onPress={onPlusBig} />
    </View>
  )
}

function FieldError({ text }) {
  if (!text) return null
  return (
    <View style={styles.errorRow}>
      <Ionicons name="alert-circle" size={14} color={colors.danger} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 80, gap: 14 },

  coverPanel: {},
  coverBox: { height: 180, borderRadius: radii.md, overflow: 'hidden' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  coverTitle: { ...type.headline },
  coverImg: { width: '100%', height: '100%' },
  coverActions: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', gap: 8 },

  section: { padding: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { ...type.headline },
  label: { ...type.label, marginBottom: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  counter: { ...type.caption, fontSize: 11, marginBottom: 6 },
  input: {
    ...type.body, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  inputError: { borderColor: colors.danger },
  multiline: { minHeight: 96, textAlignVertical: 'top' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { ...type.caption, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.ink },

  dayRow: { gap: 8, paddingRight: 8 },
  day: { width: 56, paddingVertical: 8, borderRadius: radii.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  dayActive: { backgroundColor: colors.text, borderColor: colors.text },
  dayWeek: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  dayNum: { fontSize: 20, fontWeight: '700', color: colors.text, marginVertical: 1 },
  dayTextActive: { color: colors.ink },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  stepBtnText: { ...type.body, fontWeight: '700' },
  stepValue: { flex: 1, alignItems: 'center' },
  stepValueText: { fontSize: 20, fontWeight: '700', color: colors.text },

  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  pinnedText: { ...type.caption, color: colors.text, flex: 1 },
  link: { fontSize: 13, fontWeight: '600', color: colors.magenta },

  segment: { flexDirection: 'row', gap: 10 },
  segmentItem: { flex: 1, padding: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline, gap: 4 },
  segmentItemActive: { backgroundColor: colors.text, borderColor: colors.text },
  segmentTitle: { ...type.body, fontWeight: '700' },
  segmentSub: { ...type.caption, fontSize: 12 },

  previewLabel: { ...type.label, marginTop: 6 },
  previewCard: {},
  previewCover: { height: 120, overflow: 'hidden', borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  previewBadge: {
    position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  previewBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  previewWhen: { fontSize: 12, fontWeight: '700', color: colors.magenta, letterSpacing: 0.4 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  errorText: { ...type.caption, color: colors.danger, flex: 1 },
})
