// Search & Destroy bomb sites, generated automatically inside the host's play area.
//
// Sites go on a street, sidewalk or path — never inside a building: we ask the
// OpenStreetMap Overpass API for walkable highway ways in the area, pick a random
// segment and a random point along it. If Overpass fails or takes longer than 8 s, we
// fall back to the centre of the play area (the host's location).
import { distanceMeters } from '../../lib/multiplayer'
import { SITE_RADIUS_M } from './engine'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const TIMEOUT_MS = 8000
// Bomb sites must be walkable, so for big areas (5 miles, a city, a state) they are placed
// within this distance of the area's centre.
const MAX_SEARCH_M = 600

// Highway types and how much we prefer them (pedestrian ways first, quiet streets next).
const HIGHWAY_WEIGHTS = {
  pedestrian: 4,
  footway: 4,
  sidewalk: 4,
  path: 3,
  living_street: 3,
  cycleway: 2,
  residential: 2,
  service: 1.5,
  track: 1,
  unclassified: 1,
  tertiary: 0.5,
}

function buildQuery(center, radius) {
  const types = Object.keys(HIGHWAY_WEIGHTS).join('|')
  const r = Math.max(15, Math.round(radius))
  const lat = center.lat.toFixed(6)
  const lng = center.lng.toFixed(6)
  // Skip anything indoors, in a tunnel / building passage, covered, or private.
  return `[out:json][timeout:8];way(around:${r},${lat},${lng})["highway"~"^(${types})$"]["indoor"!~"."]["tunnel"!~"^(yes|building_passage)$"]["covered"!~"^yes$"]["access"!~"^(private|no)$"]["area"!~"^yes$"];out geom 200;`
}

async function fetchWays(center, radius) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller?.abort() } catch { /* ignore */ }
      reject(new Error('timeout'))
    }, TIMEOUT_MS)
  })
  try {
    const request = fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `data=${encodeURIComponent(buildQuery(center, radius))}`,
      signal: controller?.signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`overpass ${res.status}`)
      return res.json()
    })
    const json = await Promise.race([request, timeout])
    return Array.isArray(json?.elements) ? json.elements : []
  } finally {
    clearTimeout(timer)
  }
}

// Flatten ways into weighted segments.
function segmentsOf(ways) {
  const out = []
  for (const w of ways) {
    const geom = Array.isArray(w?.geometry) ? w.geometry : []
    const hw = w?.tags?.highway
    const footwayKind = w?.tags?.footway
    const weight = (footwayKind === 'sidewalk' ? HIGHWAY_WEIGHTS.sidewalk : HIGHWAY_WEIGHTS[hw]) || 0
    if (!weight) continue
    for (let i = 1; i < geom.length; i++) {
      const a = { lat: geom[i - 1]?.lat, lng: geom[i - 1]?.lon }
      const b = { lat: geom[i]?.lat, lng: geom[i]?.lon }
      if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) continue
      const len = distanceMeters(a, b)
      if (!(len > 0.5)) continue
      out.push({ a, b, len, w: weight * len })
    }
  }
  return out
}

function pickWeighted(segs) {
  const total = segs.reduce((n, s) => n + s.w, 0)
  let x = Math.random() * total
  for (const s of segs) {
    x -= s.w
    if (x <= 0) return s
  }
  return segs[segs.length - 1]
}

function pointOn(seg) {
  const t = 0.15 + Math.random() * 0.7 // stay off the very ends (intersections)
  return { lat: seg.a.lat + (seg.b.lat - seg.a.lat) * t, lng: seg.a.lng + (seg.b.lng - seg.a.lng) * t }
}

/**
 * Generate bomb sites inside a play area.
 * @param {{ lat: number, lng: number, r: number }} area  centre + radius (metres)
 * @param {{ count?: 1|2 }} opts
 * @returns {Promise<{ sites: Array<{ id: 'A'|'B', lat: number, lng: number, r: number }>, source: 'streets'|'fallback' }>}
 *   Never rejects.
 */
export async function generateBombSites(area, { count = 2 } = {}) {
  const center = area && Number.isFinite(area.lat) && Number.isFinite(area.lng) ? { lat: area.lat, lng: area.lng } : null
  if (!center) return { sites: [], source: 'fallback' }
  const radius = Math.max(20, Number(area.r) || 45)
  const searchR = Math.min(radius, MAX_SEARCH_M)
  // Keep the whole site circle inside the boundary when there's room for it.
  const maxFromCenter = Math.max(5, searchR - Math.min(SITE_RADIUS_M, searchR / 3))
  const want = radius < 40 ? 1 : count
  const minGap = Math.min(250, Math.max(28, searchR * 0.35))

  try {
    const ways = await fetchWays(center, searchR)
    const segs = segmentsOf(ways).filter((s) => distanceMeters(center, s.a) <= searchR + 50 || distanceMeters(center, s.b) <= searchR + 50)
    if (segs.length) {
      const picks = []
      for (let i = 0; i < 80 && picks.length < want; i++) {
        const p = pointOn(pickWeighted(segs))
        if (distanceMeters(center, p) > maxFromCenter) continue
        const gap = i < 50 ? minGap : 15
        if (picks.some((q) => distanceMeters(q, p) < gap)) continue
        picks.push(p)
      }
      if (picks.length) {
        return {
          sites: picks.map((p, i) => ({ id: i === 0 ? 'A' : 'B', lat: p.lat, lng: p.lng, r: SITE_RADIUS_M })),
          source: 'streets',
        }
      }
    }
  } catch (e) {
    console.warn('bomb site lookup failed', e?.message ?? e)
  }
  // Fallback: the centre of the play area (where the host set it up).
  return { sites: [{ id: 'A', ...center, r: SITE_RADIUS_M }], source: 'fallback' }
}

