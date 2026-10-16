// Sounds: beats and samples members make in the Studio (or record), usable on videos.
// Tables: public.sounds, public.saved_sounds, public.sound_reports (supabase/migrations/080_sounds.sql).
// Files live in the public profile-media bucket under <uid>/sounds/.
//
// Status lifecycle: 'private' (only the owner) | 'scanning' -> 'public' (passed the AudD check)
// or 'blocked' (matched a commercial song). A copyright report that isn't reviewed within
// 12 hours mutes the sound everywhere (is_muted) until Colin reinstates it.
import { Platform } from 'react-native'
import { supabase } from './supabase'

const BUCKET = 'profile-media'
const COLS = 'id, user_id, title, audio_url, storage_path, duration_s, bpm, kind, tags, status, is_muted, use_count, play_count, created_at, profiles:user_id (username, avatar_url)'
export const SOUND_COLS = COLS
export const SUGGESTED_TAGS = ['trap', 'drill', 'boom bap', 'house', 'lo-fi', 'afrobeats', 'r&b', 'hip hop', 'pop', 'chill', 'hype', 'dark', 'happy', 'sad', 'love', 'party', 'gym', 'funny', 'vocal', 'sample', 'loop', 'instrumental']

async function uid() {
  const { data } = await supabase.auth.getSession()
  const id = data?.session?.user?.id
  if (!id) throw new Error('Sign in to save sounds.')
  return id
}

/** Uploads a rendered WAV (ArrayBuffer) and creates the sound. Public sounds get scanned. */
export async function publishSound({ wav, title, visibility = 'private', durationS, bpm, kind = 'beat', projectId, tags = [], contentType = 'audio/wav', ext = 'wav' }) {
  const userId = await uid()
  const path = `${userId}/sounds/snd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, wav, { contentType, upsert: false })
  if (upErr) throw upErr
  const audioUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const status = visibility === 'public' ? 'scanning' : 'private'
  const { data, error } = await supabase
    .from('sounds')
    .insert({ user_id: userId, title: (title || 'Untitled beat').slice(0, 80), audio_url: audioUrl, storage_path: path, duration_s: durationS, bpm, kind, status, project_id: projectId || null, tags: cleanTags(tags) })
    .select(COLS)
    .single()
  if (error) throw error
  if (status === 'scanning') return scanSound(data.id).catch(() => data)
  return data
}

/** Runs the copyright scan (edge function sound-scan). Resolves the updated sound. */
export async function scanSound(soundId) {
  const { data, error } = await supabase.functions.invoke('sound-scan', { body: { sound_id: soundId } })
  if (error) throw error
  return data?.sound ?? data
}

export async function setSoundVisibility(sound, visibility) {
  if (visibility === 'public') {
    const { error } = await supabase.from('sounds').update({ status: 'scanning' }).eq('id', sound.id)
    if (error) throw error
    return scanSound(sound.id)
  }
  const { data, error } = await supabase.from('sounds').update({ status: 'private' }).eq('id', sound.id).select(COLS).single()
  if (error) throw error
  return data
}

export async function renameSound(id, title) {
  const { error } = await supabase.from('sounds').update({ title: title.slice(0, 80) }).eq('id', id)
  if (error) throw error
}

export async function deleteSound(sound) {
  const { error } = await supabase.from('sounds').delete().eq('id', sound.id)
  if (error) throw error
  if (sound.storage_path) supabase.storage.from(BUCKET).remove([sound.storage_path]).catch(() => {})
}

export async function mySounds(userId) {
  const id = userId || (await uid())
  const { data, error } = await supabase.from('sounds').select(COLS).eq('user_id', id).order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data ?? []
}

/** Someone's public sounds (profile Sounds tab). */
export async function publicSoundsOf(userId) {
  const { data, error } = await supabase.from('sounds').select(COLS).eq('user_id', userId).eq('status', 'public').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data ?? []
}

/** Public, unmuted sounds; query matches title, creator or a tag. sort: trending | popular | new. */
export async function searchSounds(query = '', limit = 40, { tag = null, sort = 'popular' } = {}) {
  const { data, error } = await supabase.rpc('search_sounds', { q: query.trim(), lim: limit, tag, sort })
  if (error) throw error
  return data ?? []
}

export async function soundTags(limit = 24) {
  const { data, error } = await supabase.rpc('sound_tags', { lim: limit })
  if (error) throw error
  return (data ?? []).map((r) => r.tag)
}

/** Counts a play / view (once per person per sound per hour, enforced in the database). */
export function recordPlay(soundId) {
  if (!soundId) return
  supabase.rpc('record_sound_play', { p_sound: soundId }).then(() => {}, () => {})
}

export function cleanTags(tags) {
  return Array.from(new Set((tags || []).map((t) => String(t).toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9& -]/g, '').slice(0, 24)).filter(Boolean))).slice(0, 8)
}

export async function setSoundTags(id, tags) {
  const { error } = await supabase.from('sounds').update({ tags: cleanTags(tags) }).eq('id', id)
  if (error) throw error
}

/** Share link (opens the sound page in the app / web app). */
export const soundLink = (id) => `https://app.iyiyi.xyz/sound/${id}`

/** Uploads a full song / audio file the member picked. */
export async function uploadSong({ uri, name, mimeType, title, visibility = 'private', tags = [], durationS }) {
  let body
  if (Platform.OS === 'web' || !/^file:/.test(uri)) body = await fetch(uri).then((r) => r.arrayBuffer())
  else {
    const { File } = require('expo-file-system')
    body = await new File(uri).arrayBuffer()
  }
  const ext = ((name || '').split('.').pop() || 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '') || 'm4a'
  const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' }
  return publishSound({ wav: body, title: title || (name || 'Song').replace(/\.[^.]+$/, ''), visibility, durationS, kind: 'song', tags, contentType: mimeType || types[ext] || 'audio/mpeg', ext })
}

export async function savedSounds() {
  const userId = await uid()
  const { data, error } = await supabase
    .from('saved_sounds')
    .select(`created_at, sound:sound_id (${COLS})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => r.sound).filter((s) => s && (s.status === 'public' || s.user_id === userId))
}

export async function setSaved(soundId, saved) {
  const userId = await uid()
  if (saved) {
    const { error } = await supabase.from('saved_sounds').upsert({ user_id: userId, sound_id: soundId })
    if (error) throw error
  } else {
    const { error } = await supabase.from('saved_sounds').delete().eq('user_id', userId).eq('sound_id', soundId)
    if (error) throw error
  }
}

export async function getSound(id) {
  const { data, error } = await supabase.from('sounds').select(COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/** Copyright report. Emails Colin (via the report-sound function) and starts the 12 h clock. */
export async function reportSound({ soundId, reason, contactEmail, ownsWork }) {
  const { data: reportId, error } = await supabase.rpc('submit_sound_report', {
    p_sound: soundId, p_reason: reason || '', p_contact: contactEmail || '', p_owns: !!ownsWork,
  })
  if (error) throw error
  // The site worker emails the report to the admin (it reads it once via claim_report_email).
  fetch('https://iyiyi.xyz/api/report-mail', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '' }, body: JSON.stringify({ report_id: reportId }),
  }).catch(() => {})
  return reportId
}

// ---- admin (copyright review) ----
export async function reportQueue() {
  const { data, error } = await supabase.rpc('sound_report_queue')
  if (error) throw error
  return data ?? []
}
export async function resolveReport(soundId, action) {
  const { error } = await supabase.rpc('resolve_sound_report', { p_sound: soundId, p_action: action })
  if (error) throw error
}

// ---- playlists ----
const PL_COLS = 'id, user_id, title, visibility, created_at, updated_at, playlist_items(count)'
export async function myPlaylists() {
  const userId = await uid()
  const { data, error } = await supabase.from('playlists').select(PL_COLS).eq('user_id', userId).order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
export async function publicPlaylistsOf(userId) {
  const { data, error } = await supabase.from('playlists').select(PL_COLS).eq('user_id', userId).eq('visibility', 'public').order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
export async function createPlaylist(title, visibility = 'private') {
  const userId = await uid()
  const { data, error } = await supabase.from('playlists').insert({ user_id: userId, title: (title || 'My playlist').slice(0, 60), visibility }).select(PL_COLS).single()
  if (error) throw error
  return data
}
export async function updatePlaylist(id, patch) {
  const { error } = await supabase.from('playlists').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
export async function deletePlaylist(id) {
  const { error } = await supabase.from('playlists').delete().eq('id', id)
  if (error) throw error
}
export async function playlistSounds(playlistId) {
  const { data, error } = await supabase.from('playlist_items').select(`position, added_at, sound:sound_id (${COLS})`).eq('playlist_id', playlistId).order('position').order('added_at')
  if (error) throw error
  return (data ?? []).map((r) => r.sound).filter(Boolean)
}
export async function addToPlaylist(playlistId, soundId) {
  const { error } = await supabase.from('playlist_items').upsert({ playlist_id: playlistId, sound_id: soundId, position: Math.floor(Date.now() / 1000) })
  if (error) throw error
  updatePlaylist(playlistId, {}).catch(() => {})
}
export async function removeFromPlaylist(playlistId, soundId) {
  const { error } = await supabase.from('playlist_items').delete().eq('playlist_id', playlistId).eq('sound_id', soundId)
  if (error) throw error
}

export const soundPlayable = (s) => !!s && !s.is_muted && (s.status === 'public' || s.status === 'private')

export const formatCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n || 0))

/** Videos posted with this sound (sound page grid). */
export async function videosWithSound(soundId, limit = 60) {
  const { data, error } = await supabase
    .from('profile_media')
    .select('*, profiles:user_id (id, username, avatar_url)')
    .eq('sound_id', soundId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []).map((r) => ({
    ...r,
    media_url: r.watermarked_url || r.media_url,
    media_type: r.media_type === 'video' ? 'video' : 'photo',
    owner_id: r.user_id,
    owner_username: r.profiles?.username ?? 'Someone',
    owner_avatar_url: r.profiles?.avatar_url ?? null,
    profiles: undefined,
  }))
}

const ADMIN_EMAILS = ['iyiyiguy@gmail.com', 'hibernationprophet@gmail.com', 'playappdev16@gmail.com', 'iyiyidev@gmail.com']
/** Shows the copyright review entry (the database enforces it separately). */
export async function isSoundAdmin() {
  const { data } = await supabase.auth.getSession()
  return ADMIN_EMAILS.includes((data?.session?.user?.email || '').toLowerCase())
}
