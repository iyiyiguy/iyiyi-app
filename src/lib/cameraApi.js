// Camera data straight against Supabase (the deployed API function has no /api/camera/*
// routes). Relies on supabase/migrations/040_camera_direct.sql: own-row RLS on profile_media,
// media_tags policies, and the camera_nearby() RPC.
import { supabase } from './supabase'
import { emitMediaPosted } from './mediaEvents'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (num(v) == null ? null : Math.round(v))

async function authUserId() {
  const { data } = await supabase.auth.getSession()
  const id = data?.session?.user?.id
  if (!id) throw new Error('You need to be signed in to post.')
  return id
}

// iYiYi users within ~150 ft who can be tagged, with their position (for camera matching).
// Same shape the old GET /api/camera/nearby returned: { users: [{ id, username, avatar_url,
// distance_m, latitude, longitude }] }. Never throws.
export async function fetchCameraNearby(lat, lng) {
  try {
    if (num(lat) == null || num(lng) == null) return { users: [] }
    const { data, error } = await supabase.rpc('camera_nearby', { lat, lng })
    if (error) throw error
    const users = (Array.isArray(data) ? data : []).filter((u) => u && typeof u.id === 'string')
    return { users }
  } catch (e) {
    console.warn('camera_nearby failed', e?.message ?? e)
    return { users: [] }
  }
}

// Creates the camera post (a profile_media row) and tags whoever was nearby. Returns the row.
// Throws if the post itself can't be created; tag failures (people who don't allow tagging,
// or RLS) are logged and skipped.
export async function createCameraPost({
  media_url, media_type, watermarked_url, width, height, lat, lng, location_label, tagged_ids,
}) {
  const userId = await authUserId()
  if (!media_url) throw new Error('Nothing was uploaded.')
  const row = {
    user_id: userId,
    media_url,
    media_type: media_type === 'video' ? 'video' : 'photo',
    position: 0,
    source: 'camera',
    watermarked_url: watermarked_url || null,
    width: int(width),
    height: int(height),
    captured_lat: num(lat),
    captured_lng: num(lng),
    location_label: typeof location_label === 'string' && location_label ? location_label.slice(0, 200) : null,
  }
  const { data, error } = await supabase.from('profile_media').insert(row).select().single()
  if (error) throw error
  const media = data || row

  const ids = Array.from(new Set((Array.isArray(tagged_ids) ? tagged_ids : []).filter((x) => typeof x === 'string' && x && x !== userId)))
  if (ids.length && media?.id != null) {
    const rows = ids.map((id) => ({ media_id: media.id, tagged_user_id: id, kind: 'nearby' }))
    try {
      const { error: tagErr } = await supabase.from('media_tags').insert(rows)
      if (tagErr) {
        // One refused row fails the batch: retry one by one so the allowed ones still land.
        await Promise.allSettled(rows.map(async (r) => {
          const { error: e1 } = await supabase.from('media_tags').insert(r)
          if (e1) console.warn('Tag skipped', r.tagged_user_id, e1.message)
        }))
      }
    } catch (e) {
      console.warn('Tagging failed', e?.message ?? e)
    }
  }
  try { emitMediaPosted(media) } catch {}
  return media
}

// Removes the signed-in user's own tag from a post (replaces DELETE /api/camera/tags/:id).
export async function removeCameraTag(mediaId) {
  const userId = await authUserId()
  const { error } = await supabase.from('media_tags').delete().eq('media_id', mediaId).eq('tagged_user_id', userId)
  if (error) throw error
  return true
}
