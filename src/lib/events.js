// Data layer for Events (tables from supabase/migrations/002_events_tables.sql, extended by
// 010_event_planning.sql). Everything here degrades gracefully when 010 hasn't been run yet:
// queries that touch the new columns are retried with the original 002 columns, and the
// "Interested" RSVP falls back to on-device storage.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { supabase } from './supabase'

export const UNLIMITED_CAPACITY = 10000
export const isUnlimited = (max) => max == null || max === '' || !Number.isFinite(Number(max)) || Number(max) >= UNLIMITED_CAPACITY

export const CATEGORIES = [
  { key: 'party', label: 'Party', icon: 'sparkles-outline' },
  { key: 'meetup', label: 'Meetup', icon: 'people-outline' },
  { key: 'networking', label: 'Networking', icon: 'briefcase-outline' },
  { key: 'creator', label: 'Creator', icon: 'videocam-outline' },
  { key: 'music', label: 'Music', icon: 'musical-notes-outline' },
  { key: 'fitness', label: 'Sports & Fitness', icon: 'barbell-outline' },
  { key: 'food', label: 'Food & Drink', icon: 'restaurant-outline' },
  { key: 'gaming', label: 'Gaming', icon: 'game-controller-outline' },
  { key: 'art', label: 'Art & Culture', icon: 'color-palette-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
]
export const getCategory = (key) => CATEGORIES.find((c) => c.key === key) || null

const BASE_COLS = 'id, name, description, location, game_id, event_date, max_players, creator_id'
const EXT_COLS = `${BASE_COLS}, cover_url, category, ends_at, latitude, longitude, address, visibility`

// null = unknown yet, true = 010 columns exist, false = only the 002 columns.
let extended = null

export function isMissingColumnError(err) {
  if (!err) return false
  const code = String(err.code || '')
  if (code === '42703' || code === 'PGRST204' || code === 'PGRST200') return true
  const msg = String(err.message || '')
  return /column .* does not exist|could not find the .* column|schema cache/i.test(msg)
}

// Runs the extended query, and if the DB doesn't have the new columns yet, the base one.
async function withFallback(runExt, runBase) {
  if (extended !== false) {
    const res = await runExt()
    if (!res.error) {
      extended = true
      return res
    }
    if (!isMissingColumnError(res.error)) return res
    extended = false
  }
  return runBase()
}

export const hasExtendedSchema = () => extended === true

// Normalizes a row so screens never need to care which schema produced it.
export function normalizeEvent(row) {
  if (!row || typeof row !== 'object') return null
  // Number(null) is 0: a row without coordinates must not become a pin at 0,0.
  const lat = row.latitude == null || row.latitude === '' ? NaN : Number(row.latitude)
  const lng = row.longitude == null || row.longitude === '' ? NaN : Number(row.longitude)
  const atts = Array.isArray(row.event_attendees) ? row.event_attendees : []
  const going = atts.filter((a) => a && a.status !== 'interested').length
  const interested = atts.filter((a) => a && a.status === 'interested').length
  return {
    ...row,
    name: row.name || 'Untitled event',
    category: row.category || null,
    cover_url: row.cover_url || null,
    ends_at: row.ends_at || null,
    address: row.address || null,
    visibility: row.visibility === 'invite' ? 'invite' : 'public',
    latitude: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
    goingCount: going,
    interestedCount: interested,
    attendeeIds: atts.map((a) => a?.user_id).filter(Boolean),
  }
}

export async function fetchEvents() {
  const { data, error } = await withFallback(
    () => supabase.from('events').select(`${EXT_COLS}, event_attendees(user_id, status)`).order('event_date', { ascending: true }).limit(300),
    () => supabase.from('events').select(`${BASE_COLS}, event_attendees(user_id)`).order('event_date', { ascending: true }).limit(300),
  )
  if (error) throw error
  return (data || []).map(normalizeEvent).filter(Boolean)
}

export async function fetchEvent(eventId) {
  const { data, error } = await withFallback(
    () => supabase.from('events').select(EXT_COLS).eq('id', eventId).maybeSingle(),
    () => supabase.from('events').select(BASE_COLS).eq('id', eventId).maybeSingle(),
  )
  if (error) throw error
  return data ? normalizeEvent(data) : null
}

export async function fetchAttendees(eventId) {
  const { data, error } = await withFallback(
    () => supabase.from('event_attendees').select('user_id, joined_at, status').eq('event_id', eventId).order('joined_at', { ascending: true }),
    () => supabase.from('event_attendees').select('user_id, joined_at').eq('event_id', eventId).order('joined_at', { ascending: true }),
  )
  if (error) throw error
  return (data || []).map((a) => ({ ...a, status: a.status === 'interested' ? 'interested' : 'going' }))
}

export async function fetchProfiles(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  if (unique.length === 0) return {}
  try {
    const { data, error } = await supabase.from('profiles').select('id, username, avatar_url').in('id', unique)
    if (error) return {}
    return Object.fromEntries((data || []).map((p) => [p.id, p]))
  } catch {
    return {}
  }
}

// Inserts an event. `ext` holds the 010 columns; without the migration they are dropped and
// the event is still created with the original columns.
export async function createEvent(base, ext) {
  const { data, error } = await withFallback(
    () => supabase.from('events').insert([{ ...base, ...ext }]).select('id').single(),
    () => supabase.from('events').insert([base]).select('id').single(),
  )
  if (error) throw error
  return data
}

// ---- RSVP -------------------------------------------------------------------------------
const interestedKey = (eventId) => `event-interested:${eventId}`

export async function getLocalInterested(eventId) {
  try {
    return (await AsyncStorage.getItem(interestedKey(eventId))) === '1'
  } catch {
    return false
  }
}

async function setLocalInterested(eventId, on) {
  try {
    if (on) await AsyncStorage.setItem(interestedKey(eventId), '1')
    else await AsyncStorage.removeItem(interestedKey(eventId))
  } catch { /* best effort */ }
}

// status: 'going' | 'interested' | null (remove RSVP)
export async function setRsvp(eventId, userId, status) {
  if (!eventId || !userId) throw new Error('Sign in to RSVP.')
  if (!status) {
    const { error } = await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', userId)
    await setLocalInterested(eventId, false)
    if (error) throw error
    return
  }
  if (extended !== false) {
    const { error } = await supabase
      .from('event_attendees')
      .upsert([{ event_id: eventId, user_id: userId, status }], { onConflict: 'event_id,user_id' })
    if (!error) {
      extended = true
      await setLocalInterested(eventId, false)
      return
    }
    if (!isMissingColumnError(error)) throw error
    extended = false
  }
  // Pre-010 schema: "going" is a plain attendee row, "interested" lives on this device.
  if (status === 'going') {
    const { error } = await supabase.from('event_attendees').insert([{ event_id: eventId, user_id: userId }])
    if (error && String(error.code) !== '23505') throw error
    await setLocalInterested(eventId, false)
  } else {
    await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', userId)
    await setLocalInterested(eventId, true)
  }
}

// ---- Invites ----------------------------------------------------------------------------
export async function recordInvite(eventId, invitedUserId, invitedBy) {
  if (!eventId || !invitedUserId || !invitedBy) return
  try {
    await supabase
      .from('event_invites')
      .upsert([{ event_id: eventId, invited_user_id: invitedUserId, invited_by: invitedBy }], { onConflict: 'event_id,invited_user_id', ignoreDuplicates: true })
  } catch { /* the realtime invite already went out; the DB record is a bonus */ }
}

export async function fetchInvitedIds(eventId) {
  try {
    const { data, error } = await supabase.from('event_invites').select('invited_user_id').eq('event_id', eventId)
    if (error) return []
    return (data || []).map((r) => r.invited_user_id).filter(Boolean)
  } catch {
    return []
  }
}

// ---- Cover photo ------------------------------------------------------------------------
export async function uploadEventCover(uri, userId) {
  if (!uri || !userId) throw new Error('Missing photo')
  let fileUri = uri
  try {
    const ctx = ImageManipulator.manipulate(uri).resize({ width: 1280 })
    const img = await ctx.renderAsync()
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 })
    if (saved?.uri) fileUri = saved.uri
  } catch { /* upload the original if resizing fails */ }
  const body = await fetch(fileUri).then((r) => r.arrayBuffer())
  const path = `${userId}/events/cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('profile-media').upload(path, body, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return supabase.storage.from('profile-media').getPublicUrl(path).data.publicUrl
}

// ---- Links + formatting -----------------------------------------------------------------
export const eventShareUrl = (id) => `https://iyiyi.xyz/e/${encodeURIComponent(String(id))}`
export const eventDeepLink = (id) => `iyiyi://event/${encodeURIComponent(String(id))}`

const validDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function defaultEnd(event) {
  const start = validDate(event?.event_date)
  const end = validDate(event?.ends_at)
  if (end && start && end > start) return end
  return start ? new Date(start.getTime() + 2 * 3600 * 1000) : null
}

export function formatDay(d) {
  const date = validDate(d)
  if (!date) return ''
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatTime(d) {
  const date = validDate(d)
  if (!date) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatEventWhen(start, end) {
  const s = validDate(start)
  if (!s) return 'Date to be announced'
  const e = validDate(end)
  const sameDay = e && e.toDateString() === s.toDateString()
  if (!e || e <= s) return `${formatDay(s)} · ${formatTime(s)}`
  if (sameDay) return `${formatDay(s)} · ${formatTime(s)} – ${formatTime(e)}`
  return `${formatDay(s)} ${formatTime(s)} – ${formatDay(e)} ${formatTime(e)}`
}

export const eventPlace = (event) => event?.location || event?.address || 'Location to be announced'
