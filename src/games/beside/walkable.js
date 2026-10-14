// Walkable points inside a play area, for placing Beside Them auto GPS stations on
// paths / sidewalks / quiet streets instead of rooftops or ponds. Same idea as the laser
// tag bomb sites (../laser/bombSites.js): ask the OpenStreetMap Overpass API for walkable
// highway ways and sample points along them. Never rejects: [] on any failure or after
// TIMEOUT_MS, and the caller falls back to plain random points.
import { distanceMeters } from '../../lib/multiplayer'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const TIMEOUT_MS = 6000
const TYPES = 'pedestrian|footway|path|living_street|cycleway|residential|service|track|steps'
const STEP_M = 6

function query(area) {
  const r = Math.max(20, Math.round(area.r))
  return `[out:json][timeout:6];way(around:${r},${area.lat.toFixed(6)},${area.lng.toFixed(6)})["highway"~"^(${TYPES})$"]["indoor"!~"."]["tunnel"!~"."]["access"!~"^(private|no)$"]["area"!~"^yes$"];out geom 150;`
}

/** @returns {Promise<Array<{lat:number,lng:number}>>} */
export async function fetchWalkablePoints(area) {
  if (!area || !Number.isFinite(area.lat) || !Number.isFinite(area.lng) || typeof fetch !== 'function') return []
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer = null
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { try { controller?.abort() } catch { /* ignore */ } reject(new Error('timeout')) }, TIMEOUT_MS)
    })
    const req = fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `data=${encodeURIComponent(query(area))}`,
      signal: controller?.signal,
    }).then((res) => (res.ok ? res.json() : null))
    const json = await Promise.race([req, timeout])
    const ways = Array.isArray(json?.elements) ? json.elements : []
    const out = []
    for (const w of ways) {
      const g = Array.isArray(w?.geometry) ? w.geometry : []
      for (let i = 1; i < g.length; i++) {
        const a = { lat: g[i - 1]?.lat, lng: g[i - 1]?.lon }
        const b = { lat: g[i]?.lat, lng: g[i]?.lon }
        if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) continue
        const n = Math.min(200, Math.max(1, Math.round(distanceMeters(a, b) / STEP_M)))
        for (let j = 0; j < n; j++) {
          const p = { lat: a.lat + ((b.lat - a.lat) * j) / n, lng: a.lng + ((b.lng - a.lng) * j) / n }
          if (distanceMeters(area, p) <= area.r) out.push(p)
        }
        if (out.length > 4000) return out
      }
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
