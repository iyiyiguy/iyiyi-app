import { post } from './api'

export async function fetchImportedLinks(url) {
  return post('/api/import-links', { url })
}

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

// Adds imported links to an existing profile's lists without creating duplicates.
export function mergeLinks(current, imported) {
  const socials = [...(current.social_links ?? [])]
  for (const l of imported.social_links ?? []) {
    if (!socials.some((s) => s.platform === l.platform && norm(s.value) === norm(l.value))) socials.push(l)
  }
  const existingSites = current.websites?.length ? current.websites : current.website ? [current.website] : []
  const websites = [...existingSites]
  for (const w of imported.websites ?? []) {
    if (!websites.some((x) => norm(x) === norm(w))) websites.push(w)
  }
  return { social_links: socials, websites }
}
