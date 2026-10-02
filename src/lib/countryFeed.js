// Feed filtered to posts from users in one country (Feed > Country chip).
//
// The deployed /api/content/feed has no country filter, so two sources are unioned by id:
//  1. A direct profile_media query joined to profiles.country (case-insensitive on the
//     country's name, ISO code and common aliases). Works when the RLS read policy from
//     supabase/migrations/005_stream_realtime.sql is applied; otherwise it returns nothing.
//  2. The API feed at scope=global (asking for a larger page), with each owner's country
//     looked up from `profiles` (readable by any signed-in user) and matched client-side.
// Your own posts are included when your profile's country matches. Never throws.
import { apiJson } from './api'
import { supabase } from './supabase'
import { getMyUserId } from './profileNav'
import { countryMatches, countryVariants, countryByCode } from './countries'
import { fetchMyMedia, normalizeMediaItem } from './myContent'

const toTime = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : 0
}

async function fromDatabase(country, limit) {
  try {
    const variants = countryVariants(country).filter((v) => !/["\\]/.test(v))
    if (!variants.length) return []
    const orFilter = variants.map((v) => `country.ilike."${v}"`).join(',')
    const { data, error } = await supabase
      .from('profile_media')
      .select('*, profiles!inner(id, username, avatar_url, country)')
      .or(orFilter, { referencedTable: 'profiles' })
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !Array.isArray(data)) return []
    return data.map((r) => ({
      ...r,
      media_url: r.watermarked_url || r.media_url,
      media_type: r.media_type === 'video' ? 'video' : 'photo',
      owner_id: r.user_id,
      owner_username: r.profiles?.username ?? 'Someone',
      owner_avatar_url: r.profiles?.avatar_url ?? null,
      owner_country: r.profiles?.country ?? null,
      profiles: undefined,
    }))
  } catch {
    return []
  }
}

async function ownerCountries(ids) {
  const out = new Map()
  const list = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < list.length; i += 100) {
    try {
      const { data } = await supabase.from('profiles').select('id, country').in('id', list.slice(i, i + 100))
      ;(data ?? []).forEach((p) => out.set(p.id, p.country ?? null))
    } catch {}
  }
  return out
}

async function fromApi(coords, limit) {
  try {
    const lat = coords?.latitude ?? 0
    const lng = coords?.longitude ?? 0
    const data = await apiJson(`/api/content/feed?lat=${lat}&lng=${lng}&scope=global&sort=recent&limit=${limit}`)
    return (Array.isArray(data?.items) ? data.items : []).map(normalizeMediaItem).filter((m) => m && m.kind !== 'youtube')
  } catch {
    return []
  }
}

// country: entry from lib/countries or an ISO code. sort: 'blend' | 'recent' | 'popular'.
export async function fetchCountryFeed(country, { coords, sort = 'recent', limit = 200 } = {}) {
  const c = typeof country === 'string' ? countryByCode(country) : country
  if (!c) return []
  try {
    const [db, api, mine, myId] = await Promise.all([
      fromDatabase(c, limit),
      fromApi(coords, limit),
      fetchMyMedia(60).catch(() => []),
      getMyUserId(),
    ])
    const candidates = [...api, ...mine]
    const needLookup = candidates.filter((m) => m.owner_country == null && m.owner_id).map((m) => m.owner_id)
    const countries = needLookup.length ? await ownerCountries(needLookup) : new Map()
    const byId = new Map()
    const add = (m) => {
      const k = String(m.id)
      byId.set(k, byId.has(k) ? { ...m, ...byId.get(k) } : m)
    }
    db.forEach(add)
    candidates.forEach((m) => {
      const ctry = m.owner_country ?? countries.get(m.owner_id)
      if (countryMatches(ctry, c)) add({ ...m, owner_country: ctry })
    })
    const list = [...byId.values()].map((m) => (myId && m.owner_id === myId ? { ...m, is_mine: true } : m))
    if (sort === 'popular') return list.sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0) || toTime(b.created_at) - toTime(a.created_at))
    return list.sort((a, b) => toTime(b.created_at) - toTime(a.created_at))
  } catch {
    return []
  }
}
