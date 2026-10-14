// Helpers so the signed-in user can see their own uploads / profile mixed into discovery
// screens (Feed, Recommended, Stream), which the server endpoints otherwise leave out.
import { apiJson, apiFetch } from './api'
import { supabase } from './supabase'
import { getMyUserId } from './profileNav'
import { emitMediaRemoved, sameMediaId } from './mediaEvents'

const FAILED = Symbol('failed')

const toTime = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

// The signed-in user's profile row (via the API, which returns the full row), shaped like
// the users the discover endpoints return ({ user_id, username, avatar_url, tags, ... }).
export async function fetchMyProfileCard() {
  try {
    const me = await apiJson('/api/profiles/me')
    if (!me?.id) return null
    return { ...me, user_id: me.id }
  } catch {
    return null
  }
}

// Newest first by created_at (ties: higher id first). Rows without a timestamp keep their
// relative order and go first, so a just-posted row the API returned without created_at is
// still seen. /api/profiles/:id/media orders by `position`, which camera posts never set
// (all 0), so without this new camera posts can land anywhere in the profile grid.
export function sortMediaNewest(list) {
  const arr = (Array.isArray(list) ? list : []).filter(Boolean).map((m, i) => ({ m, i, t: toTime(m.created_at) }))
  arr.sort((a, b) => {
    if (a.t == null && b.t == null) return a.i - b.i
    if (a.t == null) return -1
    if (b.t == null) return 1
    if (b.t !== a.t) return b.t - a.t
    const ai = Number(a.m.id)
    const bi = Number(b.m.id)
    if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai
    return a.i - b.i
  })
  return arr.map((x) => x.m)
}

// Pull the media array out of whatever shape the API answered with. The old Express route
// returned { media: [...] }; be tolerant of a bare array or { items } / { data } too.
export function mediaArrayFrom(res) {
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.media)) return res.media
  if (Array.isArray(res?.items)) return res.items
  if (Array.isArray(res?.data)) return res.data
  return []
}

// Feed rows can come back keyed media_id (content_feed RPC) instead of id; give every
// upload a stable `id` so dedupe / viewer lookups / list keys work.
export function normalizeMediaItem(m) {
  if (!m || typeof m !== 'object') return null
  if (m.kind === 'youtube') return m
  const id = m.id ?? m.media_id
  if (id == null) return m
  return m.id === id ? m : { ...m, id }
}

// The user's own photos/videos, newest first, decorated with the owner fields the feed
// tiles/viewer expect plus is_mine: true. Returns [] on any failure.
//
// Build 105 lost these on device: the only source was /api/profiles/{me}/media, and anything
// going wrong there (route error, a shape without created_at so the posts sorted to the very
// end of a 60-item feed) silently dropped them. Now the API and a direct profile_media query
// (RLS allows reading your own rows, migration 005) run side by side and are unioned by id;
// the DB row fills in created_at, and the API row contributes like counts.
//
// opts.strict: throw when BOTH sources failed (instead of resolving []), so a screen that
// already shows the grid can keep it on a flaky connection rather than blanking it.
export async function fetchMyMedia(limit = 30, opts = {}) {
  const strict = !!opts?.strict
  try {
    const myId = await getMyUserId()
    if (!myId) return []
    const [mediaRes, dbRes, profRes] = await Promise.all([
      apiJson(`/api/profiles/${myId}/media`).catch(() => FAILED),
      supabase
        .from('profile_media')
        .select('*')
        .eq('user_id', myId)
        .order('created_at', { ascending: false })
        .limit(Math.max(limit, 30))
        .then((r) => (r?.error ? FAILED : r), () => FAILED),
      supabase.from('profiles').select('username, avatar_url').eq('id', myId).maybeSingle().then((r) => r, () => ({ data: null })),
    ])
    if (strict && mediaRes === FAILED && dbRes === FAILED) throw new Error('Could not load your posts')
    const prof = profRes?.data ?? {}
    const byId = new Map()
    const add = (m, preferExisting) => {
      const n = normalizeMediaItem(m)
      if (!n || n.id == null || !n.media_url) return
      const k = String(n.id)
      const prev = byId.get(k)
      if (!prev) byId.set(k, n)
      else byId.set(k, preferExisting ? { ...n, ...prev } : { ...prev, ...n })
    }
    if (mediaRes !== FAILED) mediaArrayFrom(mediaRes).forEach((m) => add(m, false))
    // DB rows only fill gaps (created_at etc.); API fields such as like_count win.
    ;(dbRes !== FAILED && Array.isArray(dbRes?.data) ? dbRes.data : []).forEach((m) => add(m, true))
    // Rows still without created_at (route didn't return it) get it from the DB row if it
    // exists; otherwise they keep their API order at the top.
    return sortMediaNewest([...byId.values()]
      .map((m) => ({
        ...m,
        media_type: m.media_type === 'video' ? 'video' : 'photo',
        owner_id: myId,
        owner_username: m.owner_username ?? prof.username ?? 'You',
        owner_avatar_url: m.owner_avatar_url ?? prof.avatar_url ?? null,
        is_mine: true,
      })))
      .slice(0, limit)
  } catch (e) {
    if (strict) throw e
    return []
  }
}

// Merge the user's own media into a feed list by time: each of your posts is placed before
// the first feed item that is older than it. Posts with no timestamp go first (rather than
// to the very bottom, where nobody would see them). Posts already in the feed aren't
// duplicated; feed items you own are flagged is_mine.
export function mergeMine(feed, mine, myId) {
  const base = (Array.isArray(feed) ? feed : [])
    .map(normalizeMediaItem)
    .filter(Boolean)
    .map((it) => (myId && it.owner_id === myId && it.kind !== 'youtube' ? { ...it, is_mine: true } : it))
  const seen = new Set(base.filter((it) => it.kind !== 'youtube').map((it) => String(it.id)))
  const extra = (Array.isArray(mine) ? mine : []).map(normalizeMediaItem).filter((m) => m && !seen.has(String(m.id)))
  if (extra.length === 0) return base
  const out = [...base]
  // A feed with no timestamps at all can't be interleaved; show your posts first so they're seen.
  const feedHasTimes = base.some((it) => toTime(it.created_at) != null)
  if (!feedHasTimes) return [...extra, ...base]
  // Insert oldest first so equal-time posts keep newest-first order among themselves.
  let undated = 0
  for (const m of [...extra].reverse()) {
    const t = toTime(m.created_at)
    if (t == null) {
      out.splice(0, 0, m)
      undated += 1
      continue
    }
    let at = out.length
    const i = out.findIndex((it, idx) => {
      if (idx < undated) return false
      const ti = toTime(it.created_at)
      return ti != null && ti <= t
    })
    if (i >= 0) at = i
    out.splice(at, 0, m)
  }
  return out
}

// Turn a just-inserted profile_media row (from mediaEvents.onMediaPosted or a Realtime
// INSERT) into a feed-shaped item. Owner name/avatar come from `profiles` (readable by any
// signed-in user) and are cached per user. Never throws; resolves null for unusable rows.
const ownerCache = new Map()
export async function itemFromMediaRow(row) {
  try {
    const n = normalizeMediaItem(row)
    if (!n || n.id == null || !(n.watermarked_url || n.media_url)) return null
    const ownerId = n.user_id ?? n.owner_id ?? null
    let owner = ownerId ? ownerCache.get(ownerId) : null
    if (!owner && ownerId) {
      try {
        const { data } = await supabase.from('profiles').select('username, avatar_url, country').eq('id', ownerId).maybeSingle()
        owner = data ?? {}
        ownerCache.set(ownerId, owner)
      } catch {
        owner = {}
      }
    }
    const myId = await getMyUserId()
    return {
      ...n,
      media_url: n.watermarked_url || n.media_url,
      media_type: n.media_type === 'video' ? 'video' : 'photo',
      created_at: n.created_at ?? new Date().toISOString(),
      owner_id: ownerId,
      owner_username: n.owner_username ?? owner?.username ?? 'Someone',
      owner_avatar_url: n.owner_avatar_url ?? owner?.avatar_url ?? null,
      owner_country: n.owner_country ?? owner?.country ?? null,
      like_count: n.like_count ?? 0,
      comment_count: n.comment_count ?? 0,
      is_mine: !!myId && ownerId === myId,
    }
  } catch {
    return null
  }
}

// Prepend items to a list, dropping any already present (by id).
export function prependUnique(list, add) {
  const base = Array.isArray(list) ? list : []
  const extra = (Array.isArray(add) ? add : [add]).filter(Boolean)
  const seen = new Set(base.filter((it) => it.kind !== 'youtube').map((it) => String(it.id)))
  const fresh = extra.filter((m) => !seen.has(String(m.id)))
  return fresh.length ? [...fresh, ...base] : base
}

// True when a feed/profile/stream item was posted by the signed-in user. Rows carry the
// owner as owner_id (feed / content_feed RPC / myContent decoration) or user_id (raw
// profile_media rows); is_mine is set by fetchMyMedia / mergeMine / itemFromMediaRow.
export function isMyMedia(item, myId) {
  if (!item || typeof item !== 'object' || item.kind === 'youtube') return false
  // Until the session id has loaded, trust the is_mine flag our own loaders set.
  if (!myId) return item.is_mine === true
  const owner = item.owner_id ?? item.user_id ?? null
  if (owner != null) return String(owner) === String(myId)
  return item.is_mine === true
}

// Drop an id from a media list (no-op when it isn't there, so the same array comes back).
export function withoutMedia(list, id) {
  const arr = Array.isArray(list) ? list : []
  const next = arr.filter((m) => !(m && m.kind !== 'youtube' && sameMediaId(m.id ?? m.media_id, id)))
  return next.length === arr.length ? arr : next
}

const STORAGE_BUCKET = 'profile-media'
const PUBLIC_PREFIX = `/storage/v1/object/public/${STORAGE_BUCKET}/`

// "<supabase>/storage/v1/object/public/profile-media/<uid>/x.jpg" -> "<uid>/x.jpg"
function storagePathFromUrl(url) {
  if (typeof url !== 'string') return null
  const at = url.indexOf(PUBLIC_PREFIX)
  if (at === -1) return null
  const path = url.slice(at + PUBLIC_PREFIX.length).split(/[?#]/)[0]
  try { return decodeURIComponent(path) } catch { return path }
}

// Delete one of your own posts. Tries the API (DELETE /api/profiles/me/media/:id); if that
// route isn't there (404/405) it deletes the profile_media row directly, filtered by id AND
// your user id (RLS "Own media delete", migration 040, enforces the same), then best-effort
// removes the uploaded file(s) from the profile-media bucket under your own folder.
// Broadcasts emitMediaRemoved(id) on success. Throws an Error with a friendly message.
export async function deleteMyMedia(item) {
  const id = item && typeof item === 'object' ? (item.id ?? item.media_id) : item
  if (id == null) throw new Error("This post can't be deleted.")
  const myId = await getMyUserId()
  if (!myId) throw new Error('Please sign in again.')

  let res = null
  try {
    res = await apiFetch(`/api/profiles/me/media/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
  } catch (e) {
    // Network error or no session: fall through to the direct delete below.
    res = null
  }
  if (res?.ok) {
    emitMediaRemoved(id)
    return { via: 'api' }
  }
  if (res && res.status !== 404 && res.status !== 405) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || "Couldn't delete this post.")
  }

  const { data, error } = await supabase
    .from('profile_media')
    .delete()
    .eq('id', id)
    .eq('user_id', myId)
    .select('id, media_url, watermarked_url')
  if (error) throw new Error(error.message || "Couldn't delete this post.")
  if (!Array.isArray(data) || data.length === 0) {
    // Nothing deleted: either it's already gone (fine) or it isn't yours.
    const { data: still } = await supabase.from('profile_media').select('id').eq('id', id).maybeSingle()
    if (still) throw new Error("You can only delete your own posts.")
  } else {
    const row = data[0] ?? {}
    const paths = [row.media_url, row.watermarked_url, item?.media_url, item?.watermarked_url]
      .map(storagePathFromUrl)
      .filter((p) => p && p.startsWith(`${myId}/`))
    const unique = Array.from(new Set(paths))
    if (unique.length) {
      try {
        await supabase.storage.from(STORAGE_BUCKET).remove(unique)
      } catch (e) {
        console.warn('Post file cleanup failed', e?.message ?? e)
      }
    }
  }
  emitMediaRemoved(id)
  return { via: 'supabase' }
}
