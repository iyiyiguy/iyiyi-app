// Each person's best post (most liked / shared / commented photo) for their map pin.
// rpc map_top_posts (migration 082); cached for a few minutes per user.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const TTL = 5 * 60 * 1000
const cache = new Map() // userId -> { post | null, at }

export async function topPostsFor(userIds) {
  const now = Date.now()
  const need = userIds.filter((id) => id && (!cache.has(id) || now - cache.get(id).at > TTL)).slice(0, 300)
  if (need.length) {
    try {
      const { data, error } = await supabase.rpc('map_top_posts', { p_users: need })
      if (!error) {
        const got = new Map((data || []).map((r) => [r.user_id, r]))
        need.forEach((id) => cache.set(id, { post: got.get(id) || null, at: now }))
      }
    } catch {}
  }
  const out = {}
  userIds.forEach((id) => { const c = cache.get(id); if (c?.post) out[id] = c.post })
  return out
}

export function useTopPosts(userIds) {
  const key = userIds.slice().sort().join(',')
  const [posts, setPosts] = useState({})
  useEffect(() => {
    if (!key) { setPosts({}); return undefined }
    let alive = true
    const t = setTimeout(() => { topPostsFor(key.split(',')).then((p) => { if (alive) setPosts(p) }) }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [key])
  return posts
}

/** Counts a share of a post (one per person per post per hour, enforced in the database). */
export function recordShare(mediaId) {
  if (mediaId == null || !/^\d+$/.test(String(mediaId))) return
  supabase.rpc('record_media_share', { p_media: Number(mediaId) }).then(() => {}, () => {})
}
