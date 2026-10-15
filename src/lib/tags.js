// Fixed set of profile tags — chosen from a list, never free-typed. Used on
// Edit Profile (pick your tags), and as filters on Nearby/History/Map.
export const TAGS = [
  'Business', 'Online', 'Creator', 'Video', 'Actor', 'Cars', 'Crypto', 'Fitness',
  'Fashion', 'Modeling', 'YouTube', 'Instagram', 'TikTok', 'Snapchat',
  'Vegan', 'Music', 'Photography', 'Travel', 'Food', 'Gaming', 'Art',
  'Comedy', 'Dance', 'Beauty', 'Tech',
]

const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : '')

// True when the user has at least one of the selected tags (an empty / missing selection
// matches everyone). Case-insensitive so 'youtube' and 'YouTube' agree.
export function matchesTags(user, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true
  const own = Array.isArray(user?.tags) ? user.tags.map(lower) : []
  if (own.length === 0) return false
  return selected.some((t) => own.includes(lower(t)))
}

// General search box: matches a username, a display name (whichever field the API sends),
// or any of the user's tags. A leading '#' or '@' is ignored, so '#music' and '@colin' work.
export function matchesSearch(user, query) {
  const q = lower(query).trim().replace(/^[#@]+/, '')
  if (!q) return true
  if (!user) return false
  // Usernames and real names
  const names = [user.username, user.display_name, user.full_name, user.name, user.real_name, user.first_name, user.last_name, user.profile_label, user.tagline, user.bio]
  if (names.some((n) => lower(n).includes(q))) return true
  // Every social profile they entered: the handle/URL and the platform name (e.g. "instagram", "@maya.dance")
  const socials = Array.isArray(user.social_links) ? user.social_links : Array.isArray(user.platforms) ? user.platforms : []
  for (const l of socials) {
    if (!l) continue
    const vals = typeof l === 'string' ? [l] : [l.value, l.handle, l.username, l.url, l.platform, l.label, l.title]
    if (vals.some((v) => lower(v).replace(/^@+/, '').includes(q))) return true
  }
  // Their links: the site name / domain and the full URL (link-in-bio, shop, website…)
  const sites = Array.isArray(user.websites) ? user.websites : user.website ? [user.website] : []
  for (const w of sites) {
    if (!w) continue
    const vals = typeof w === 'string' ? [w, w.replace(/^https?:\/\/(www\.)?/, '')] : [w.url, w.title, w.label, w.name]
    if (vals.some((v) => lower(v).includes(q))) return true
  }
  const tags = Array.isArray(user.tags) ? user.tags : []
  return tags.some((t) => lower(t).includes(q))
}
