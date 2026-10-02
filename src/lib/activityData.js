// Activity + Recap data built on what the deployed backend actually serves: direct supabase
// queries against existing tables (RLS applies - a table the client can't read just yields
// nothing) plus the API routes that do exist (/api/profiles/me, /me/stats, /me/viewers,
// /follow-requests, /:id/media, /api/content/:id/comments, /api/locations/history).
// /api/activity and /api/profiles/me/recap don't exist on the deployed API.
//
// Every source is independent and failure-tolerant: nothing here throws.
import { apiJson } from './api'
import { supabase } from './supabase'
import { getMyUserId } from './profileNav'

const DAY = 86400000
const toTime = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}
const safe = (p, fallback) => Promise.resolve().then(() => p).then((v) => v, () => fallback)
// supabase result -> rows ([] on error / RLS refusal)
const rows = (r) => (r && !r.error && Array.isArray(r.data) ? r.data : [])

async function q(build) {
  try {
    return rows(await build())
  } catch {
    return []
  }
}

async function api(path) {
  try {
    return await apiJson(path)
  } catch {
    return null
  }
}

async function myMediaRows(myId) {
  const db = await q(() => supabase.from('profile_media')
    .select('id, media_url, watermarked_url, media_type, created_at')
    .eq('user_id', myId)
    .order('created_at', { ascending: false })
    .limit(200))
  if (db.length) return db
  const res = await api(`/api/profiles/${myId}/media`)
  const list = Array.isArray(res?.media) ? res.media : Array.isArray(res) ? res : []
  return list.filter((m) => m && m.id != null)
}

async function profilesById(ids) {
  const out = new Map()
  const list = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < list.length; i += 100) {
    const data = await q(() => supabase.from('profiles').select('id, username, avatar_url').in('id', list.slice(i, i + 100)))
    data.forEach((p) => out.set(p.id, p))
  }
  return out
}

// Recent activity on your profile, newest first:
// { type, user_id, username, avatar_url, at, text?, media_id?, media_url? }
// type: follow | follow_request | like | comment | tagged | view
export async function fetchActivity() {
  const myId = await getMyUserId()
  if (!myId) return []
  const media = await safe(myMediaRows(myId), [])
  const mediaIds = media.map((m) => m.id).slice(0, 200)
  const mediaById = new Map(media.map((m) => [String(m.id), m]))
  const thumb = (id) => {
    const m = mediaById.get(String(id))
    return m ? (m.watermarked_url || m.media_url) : null
  }

  const [follows, requests, likes, comments, tags, views, viewersApi] = await Promise.all([
    q(() => supabase.from('follows').select('follower_id, created_at, status').eq('followed_id', myId)
      .order('created_at', { ascending: false }).limit(60)),
    api('/api/profiles/follow-requests'),
    mediaIds.length
      ? q(() => supabase.from('media_likes').select('media_id, user_id, created_at').in('media_id', mediaIds)
        .neq('user_id', myId).order('created_at', { ascending: false }).limit(80))
      : [],
    mediaIds.length
      ? q(() => supabase.from('media_comments').select('id, media_id, user_id, body, created_at').in('media_id', mediaIds)
        .neq('user_id', myId).order('created_at', { ascending: false }).limit(60))
      : [],
    q(() => supabase.from('media_tags').select('media_id, created_at, kind, hidden').eq('tagged_user_id', myId)
      .order('created_at', { ascending: false }).limit(40)),
    q(() => supabase.from('profile_views').select('viewer_id, created_at').eq('viewed_user_id', myId)
      .order('created_at', { ascending: false }).limit(60)),
    api('/api/profiles/me/viewers'),
  ])

  const out = []
  follows.forEach((f) => out.push({
    type: f.status === 'pending' ? 'follow_request' : 'follow', user_id: f.follower_id, at: f.created_at,
  }))
  const reqList = Array.isArray(requests?.requests) ? requests.requests : []
  reqList.forEach((r) => {
    const uid = r.follower_id ?? r.user_id ?? r.id
    if (!uid || out.some((x) => x.type === 'follow_request' && x.user_id === uid)) return
    out.push({ type: 'follow_request', user_id: uid, username: r.username, avatar_url: r.avatar_url, at: r.created_at ?? r.requested_at ?? null })
  })
  likes.forEach((l) => out.push({ type: 'like', user_id: l.user_id, at: l.created_at, media_id: l.media_id, media_url: thumb(l.media_id) }))

  // Comments: table if readable, otherwise the comments route for your latest posts.
  let commentRows = comments
  if (!commentRows.length && media.length) {
    const recent = media.slice(0, 8)
    const lists = await Promise.all(recent.map((m) => api(`/api/content/${m.id}/comments`)))
    commentRows = []
    lists.forEach((res, i) => {
      const list = Array.isArray(res?.comments) ? res.comments : []
      list.forEach((c) => {
        const p = c.profiles ?? c.user ?? {}
        const uid = c.user_id ?? p.id
        if (!uid || uid === myId) return
        commentRows.push({
          media_id: recent[i].id, user_id: uid, body: c.body ?? c.text, created_at: c.created_at,
          username: c.username ?? p.username, avatar_url: c.avatar_url ?? p.avatar_url,
        })
      })
    })
  }
  commentRows.forEach((c) => out.push({
    type: 'comment', user_id: c.user_id, at: c.created_at, text: c.body, media_id: c.media_id,
    media_url: thumb(c.media_id), username: c.username, avatar_url: c.avatar_url,
  }))

  // Tags: who posted the photo you're in (readable for visible posts).
  const visibleTags = tags.filter((t) => !t.hidden)
  if (visibleTags.length) {
    const tagMedia = await q(() => supabase.from('profile_media').select('id, user_id, media_url, watermarked_url')
      .in('id', visibleTags.map((t) => t.media_id)))
    const byId = new Map(tagMedia.map((m) => [String(m.id), m]))
    visibleTags.forEach((t) => {
      const m = byId.get(String(t.media_id))
      if (!m || m.user_id === myId) return
      out.push({ type: 'tagged', user_id: m.user_id, at: t.created_at, media_id: t.media_id, media_url: m.watermarked_url || m.media_url })
    })
  }

  if (views.length) {
    // Collapse repeat views by the same person into their latest.
    const latest = new Map()
    views.forEach((v) => { if (v.viewer_id && v.viewer_id !== myId && !latest.has(v.viewer_id)) latest.set(v.viewer_id, v) })
    latest.forEach((v) => out.push({ type: 'view', user_id: v.viewer_id, at: v.created_at }))
  } else {
    const list = Array.isArray(viewersApi?.viewers) ? viewersApi.viewers : []
    list.slice(0, 40).forEach((v) => {
      if (!v?.id || v.id === myId) return
      out.push({ type: 'view', user_id: v.id, username: v.username, avatar_url: v.avatar_url, at: v.last_viewed_at, count: v.view_count })
    })
  }

  const missing = out.filter((x) => !x.username).map((x) => x.user_id)
  const profs = missing.length ? await profilesById(missing) : new Map()
  const seen = new Set()
  return out
    .map((x) => {
      const p = profs.get(x.user_id)
      return { ...x, username: x.username ?? p?.username ?? 'Someone', avatar_url: x.avatar_url ?? p?.avatar_url ?? null }
    })
    .filter((x) => {
      const k = `${x.type}:${x.user_id}:${x.media_id ?? ''}:${x.at ?? ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0))
    .slice(0, 150)
}

// Daily buckets (oldest -> newest) for a list of timestamps over the last `days` days.
function buckets(times, days, now) {
  const out = Array.from({ length: days }, () => 0)
  const start = now - days * DAY
  times.forEach((t) => {
    if (t == null || t < start || t > now) return
    const i = Math.min(days - 1, Math.floor((t - start) / DAY))
    out[i] += 1
  })
  return out
}

// Recap for the last `days` days (7 | 30). Numbers the client can't get are null.
// { username, avatar_url, account_type, total_followers, new_followers, previous_new_followers,
//   profile_views, likes_received, likes_all_time, posts, people_discovered, mode, personality,
//   series: { views: number[] | null, likes: number[] | null, followers: number[] | null } }
export async function fetchRecap(days = 7) {
  const now = Date.now()
  const since = now - days * DAY
  const before = since - days * DAY
  const myId = await getMyUserId()
  if (!myId) return null

  const [me, stats, media, follows, history, viewersApi, mediaApi] = await Promise.all([
    api('/api/profiles/me'),
    api('/api/profiles/me/stats'),
    safe(myMediaRows(myId), []),
    q(() => supabase.from('follows').select('created_at, status').eq('followed_id', myId)
      .gte('created_at', new Date(before).toISOString()).limit(2000)),
    api('/api/locations/history'),
    api('/api/profiles/me/viewers'),
    api(`/api/profiles/${myId}/media`),
  ])
  let profile = me
  if (!profile?.username) {
    const p = await q(() => supabase.from('profiles').select('username, avatar_url, account_type').eq('id', myId).limit(1))
    profile = { ...(profile ?? {}), ...(p[0] ?? {}) }
  }

  const mediaIds = media.map((m) => m.id).slice(0, 200)
  const [likes, views] = await Promise.all([
    mediaIds.length
      ? q(() => supabase.from('media_likes').select('created_at, user_id').in('media_id', mediaIds)
        .gte('created_at', new Date(since).toISOString()).limit(5000))
      : [],
    q(() => supabase.from('profile_views').select('created_at').eq('viewed_user_id', myId)
      .gte('created_at', new Date(since).toISOString()).limit(5000)),
  ])

  // Followers
  const accepted = follows.filter((f) => f.status !== 'pending')
  const followTimes = accepted.map((f) => toTime(f.created_at))
  const haveFollows = accepted.length > 0
  const newFollowers = haveFollows ? followTimes.filter((t) => t != null && t >= since).length : null
  const prevFollowers = haveFollows ? followTimes.filter((t) => t != null && t >= before && t < since).length : null

  // Views: table, else API stats (7-day count), else viewers list (approximate: last view in range).
  let profileViews = null
  let viewSeries = null
  if (views.length) {
    profileViews = views.length
    viewSeries = buckets(views.map((v) => toTime(v.created_at)), days, now)
  } else if (days === 7 && Number.isFinite(stats?.views_last_7_days)) {
    profileViews = stats.views_last_7_days
  } else if (Array.isArray(viewersApi?.viewers)) {
    const inRange = viewersApi.viewers.filter((v) => (toTime(v.last_viewed_at) ?? 0) >= since)
    profileViews = inRange.length // unique viewers whose latest view is in range
    viewSeries = buckets(inRange.map((v) => toTime(v.last_viewed_at)), days, now)
  }

  // Likes: table in range, else all-time total from your posts' like counts.
  const apiMedia = Array.isArray(mediaApi?.media) ? mediaApi.media : Array.isArray(mediaApi) ? mediaApi : []
  const likesAllTime = (apiMedia.length ? apiMedia : media).reduce((s, m) => s + (Number(m?.like_count) || 0), 0)
  const likesReceived = likes.length ? likes.filter((l) => l.user_id !== myId).length : null

  const posts = media.filter((m) => (toTime(m.created_at) ?? 0) >= since).length
  const hist = Array.isArray(history?.history) ? history.history : []
  const discovered = hist.filter((h) => (toTime(h.first_seen_at) ?? 0) >= since).length

  const totalFollowers = Number.isFinite(profile?.follower_count) ? profile.follower_count : null
  const accountType = profile?.account_type ?? 'normal'
  const mode = ['creator', 'premium', 'pro'].includes(accountType) || (newFollowers ?? 0) > 0 ? 'grower' : 'explorer'

  const personality =
    posts >= 5 ? { title: 'The Creator', blurb: `${posts} posts ${days === 7 ? 'this week' : 'this month'} - you keep the feed alive.` }
      : discovered >= 15 ? { title: 'The Explorer', blurb: `You crossed paths with ${discovered} new people.` }
        : (profileViews ?? 0) >= 20 ? { title: 'The Magnet', blurb: 'People keep checking out your profile.' }
          : (newFollowers ?? 0) >= 3 ? { title: 'The Rising Star', blurb: 'Your following is growing.' }
            : { title: 'The Original', blurb: 'Keep posting and exploring to level up your vibe.' }

  return {
    username: profile?.username ?? null,
    avatar_url: profile?.avatar_url ?? null,
    account_type: accountType,
    total_followers: totalFollowers,
    new_followers: newFollowers,
    previous_new_followers: prevFollowers,
    profile_views: profileViews,
    likes_received: likesReceived,
    likes_all_time: likesAllTime,
    posts,
    people_discovered: discovered,
    mode,
    personality,
    series: {
      views: viewSeries,
      likes: likes.length ? buckets(likes.map((l) => toTime(l.created_at)), days, now) : null,
      followers: haveFollows ? buckets(followTimes, days, now) : null,
      posts: media.length ? buckets(media.map((m) => toTime(m.created_at)), days, now) : null,
    },
  }
}
