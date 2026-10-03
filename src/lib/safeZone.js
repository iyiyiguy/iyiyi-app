// Safe zone: a home spot + radius, kept on this phone only (never uploaded). While the user is
// inside it:
//   - their location is not sent to iYiYi (Nearby / web map skip /api/locations/update), and
//   - their profile is hidden from the map and the Nearby tabs (show_on_map is switched off
//     automatically and switched back on when they leave, if it was on before).
// The map shows the zone as a circle they can move (drag the house) and resize (drag the edge
// handle), and the visibility pill says they're in their safe zone.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_URL, supabase } from './supabase'

const KEY = 'iyiyi_safe_zone_v1'
const AUTO_KEY = 'iyiyi_safe_zone_autohid_v1'
export const MILE_M = 1609.344
export const DEFAULT_RADIUS_M = 0.2 * MILE_M // ~320 m / 1,056 ft
export const MIN_RADIUS_M = 0.05 * MILE_M // ~80 m
export const MAX_RADIUS_M = 2 * MILE_M
// A little slack on the way out so GPS jitter at the edge doesn't flip hidden/visible.
const EXIT_SLACK_M = 25

let zone = null // { latitude, longitude, radiusM, enabled }
let loaded = null
let lastInside = false
const listeners = new Set()

const emit = () => listeners.forEach((fn) => { try { fn(zone) } catch {} })

export function subscribeSafeZone(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const valid = (z) => z && Number.isFinite(z.latitude) && Number.isFinite(z.longitude) && Number.isFinite(z.radiusM)

export async function loadSafeZone() {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const z = raw ? JSON.parse(raw) : null
        zone = valid(z) ? { enabled: z.enabled !== false, ...z } : null
        return zone
      })
      .catch(() => null)
  }
  await loaded
  return zone
}

export function getSafeZone() { return zone }

export async function saveSafeZone(next) {
  zone = valid(next)
    ? { ...next, radiusM: clampRadius(next.radiusM), enabled: next.enabled !== false }
    : null
  loaded = Promise.resolve(zone)
  try {
    if (zone) await AsyncStorage.setItem(KEY, JSON.stringify(zone))
    else await AsyncStorage.removeItem(KEY)
  } catch {}
  emit()
  return zone
}

export const clearSafeZone = () => saveSafeZone(null)

export const clampRadius = (m) => Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Number(m) || DEFAULT_RADIUS_M))

export function distanceM(a, b) {
  if (!a || !b) return Infinity
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Point `meters` east of `center` (for the resize handle).
export function offsetEast(center, meters) {
  const cos = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01)
  return { latitude: center.latitude, longitude: center.longitude + meters / (111320 * cos) }
}

export function isInSafeZone(coords, z = zone) {
  if (!z || !z.enabled || !coords) return false
  const d = distanceM(z, coords)
  return d <= z.radiusM + (lastInside ? EXIT_SLACK_M : 0)
}

export function formatRadius(m) {
  const mi = m / MILE_M
  if (mi < 0.1) return `${Math.round(m * 3.28084 / 10) * 10} ft`
  return `${mi < 1 ? mi.toFixed(2).replace(/0$/, '') : mi.toFixed(1)} mi`
}

async function authedFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('signed out')
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
  })
}

let syncing = Promise.resolve()
// Call with every fresh position. Hides the profile on entering the zone and restores it on
// leaving (only if we were the ones who hid it). Returns whether the user is inside.
export function updateSafeZonePresence(coords) {
  const inside = isInSafeZone(coords)
  const changed = inside !== lastInside
  lastInside = inside
  if (changed) syncing = syncing.then(() => syncVisibility(inside)).catch(() => {})
  return inside
}

async function syncVisibility(inside) {
  try {
    if (inside) {
      const me = await authedFetch('/api/profiles/me').then((r) => (r.ok ? r.json() : null))
      if (me?.show_on_map) {
        const res = await authedFetch('/api/profiles/me', { method: 'PATCH', body: JSON.stringify({ show_on_map: false }) })
        if (res.ok) await AsyncStorage.setItem(AUTO_KEY, '1')
      }
    } else if ((await AsyncStorage.getItem(AUTO_KEY)) === '1') {
      const res = await authedFetch('/api/profiles/me', { method: 'PATCH', body: JSON.stringify({ show_on_map: true }) })
      if (res.ok) await AsyncStorage.removeItem(AUTO_KEY)
    }
  } catch {
    // Offline: the next position update tries again.
    lastInside = !inside
  }
}

// Turning the zone off / removing it while inside: give the profile back.
export async function releaseSafeZoneHide() {
  lastInside = false
  await (syncing = syncing.then(() => syncVisibility(false)).catch(() => {}))
}
