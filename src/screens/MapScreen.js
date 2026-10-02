import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, ScrollView, Image, Platform, useColorScheme } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import MapView, { Marker } from 'react-native-maps'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import Glass from '../components/Glass'
import { GlassButton } from '../components/GlassButton'
import PenguinMarker from '../components/PenguinMarker'
import MapTagMenu from '../components/MapTagMenu'
import CountryPicker from '../components/CountryPicker'
import { colors, radii, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { openProfile } from '../lib/profileNav'
import { fetchEvents } from '../lib/events'
import { countryByCode, countryMatches } from '../lib/countries'
import { bundledCountryRegion, countryRegion, countryCodeAt } from '../lib/countryRegions'

// Fabric (React Native's new architecture, on by default since SDK 52) is far
// stricter than the old bridge about native view prop types — a marker or
// region fed a non-finite/missing lat-lng (a malformed API row, a location
// fix that hasn't settled yet) can crash the native map view outright instead
// of just being silently ignored like it used to be. Always validate before
// handing coordinates to MapView/Marker.
const isValidCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// MapKit throws (= native crash) on a region whose span runs past the poles or is not
// finite, so every region we animate to goes through here first.
function safeRegion(r) {
  if (!r) return null
  let latitude = Number(r.latitude)
  const longitude = Number(r.longitude)
  let latitudeDelta = Number(r.latitudeDelta)
  let longitudeDelta = Number(r.longitudeDelta)
  if (![latitude, longitude, latitudeDelta, longitudeDelta].every(Number.isFinite)) return null
  latitudeDelta = clamp(latitudeDelta, 0.0006, 120)
  longitudeDelta = clamp(longitudeDelta, 0.0006, 180)
  latitude = clamp(latitude, -85, 85)
  if (Math.abs(latitude) + latitudeDelta / 2 > 89) latitude = Math.sign(latitude) * Math.max(0, 89 - latitudeDelta / 2)
  return { latitude, longitude: clamp(longitude, -180, 180), latitudeDelta, longitudeDelta }
}

function regionForRadius(coords, meters) {
  const latitudeDelta = ((meters * 2) / 111320) * 1.25
  const cos = Math.max(Math.cos((coords.latitude * Math.PI) / 180), 0.2)
  return safeRegion({ latitude: coords.latitude, longitude: coords.longitude, latitudeDelta, longitudeDelta: latitudeDelta / cos })
}

// Quick-zoom presets. `scope` matches the Nearby screen's scopes so the API returns
// people across the same distance the map is showing.
const PRESETS = [
  { key: 'local', label: '150 ft', meters: 45.72 },
  { key: 'regional', label: '5 mi', meters: 8046.72 },
  { key: 'city', label: 'City', meters: 25000 },
  { key: 'state', label: 'State', meters: 280000 },
  // ~2,500 km across (roughly the lower-48 US); refined to the user's actual country.
  { key: 'national', label: 'Nation', meters: 1250000 },
  { key: 'global', label: 'Worldwide', meters: null },
]

const MAX_ANIMATED_PENGUINS = 40

// ---- "Search this area" helpers -------------------------------------------------------
// The people API (/api/locations/nearby -> nearby_users) only understands scopes:
// 'local' (<= 150 ft of the point), 'regional' (<= 5 mi), 'city'/'state'/'national' (matched on
// the profile's typed-in city/state/country, NOT distance) and 'global' (everyone, sorted by
// distance from the point). To show "everyone in the visible region" we pick the smallest
// distance scope that covers the region's half-diagonal, centered on the region, and then keep
// only the people actually inside the visible bounds.
const LOCAL_M = 45.72
const REGIONAL_M = 8046.72

function regionRadiusMeters(r) {
  if (!r) return 0
  const latM = (r.latitudeDelta / 2) * 111320
  const lngM = (r.longitudeDelta / 2) * 111320 * Math.max(Math.cos((r.latitude * Math.PI) / 180), 0.01)
  return Math.sqrt(latM * latM + lngM * lngM)
}

function scopeForRadius(m) {
  if (m <= LOCAL_M) return 'local'
  if (m <= REGIONAL_M) return 'regional'
  return 'global'
}

function inRegion(u, r, margin = 1.08) {
  if (!r) return true
  if (Math.abs(u.latitude - r.latitude) > (r.latitudeDelta / 2) * margin) return false
  if (r.longitudeDelta >= 300) return true
  const dLng = ((((u.longitude - r.longitude) % 360) + 540) % 360) - 180
  return Math.abs(dLng) <= (r.longitudeDelta / 2) * margin
}

// Did the visible region move/zoom enough since the last search to offer "Search this area"?
// MapKit fits a requested region to the view's aspect ratio, so one delta can legitimately grow;
// a zoom only counts when both deltas changed the same way.
function areaChanged(a, b) {
  if (!a || !b) return false
  const rLat = b.latitudeDelta / a.latitudeDelta
  const rLng = b.longitudeDelta / a.longitudeDelta
  if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) return false
  if ((rLat > 1.5 && rLng > 1.5) || (rLat < 0.67 && rLng < 0.67)) return true
  const dLat = Math.abs(b.latitude - a.latitude) / Math.max(a.latitudeDelta, b.latitudeDelta)
  const rawLng = Math.abs(((((b.longitude - a.longitude) % 360) + 540) % 360) - 180)
  const dLng = rawLng / Math.max(a.longitudeDelta, b.longitudeDelta)
  return dLat > 0.28 || dLng > 0.28
}

// An "area" is what the map is currently showing people for.
//   region  visible region it was searched for (bounds filter + change detection)
//   center  point sent to the API; scope  API scope; all  skip the bounds filter (Worldwide)
//   follow  re-center on the user as their location updates (area "around me")
//   country        only keep people whose profile country is this { code, name, flag }
//   nationFallback if the 'national' scope returns nobody (e.g. your own profile has no
//                  country), retry as 'global' filtered to this country
function makeArea(region, { scope, all = false, follow = false, center, country = null, nationFallback = null } = {}) {
  const r = safeRegion(region)
  if (!r) return null
  return {
    region: r,
    center: center ?? { latitude: r.latitude, longitude: r.longitude },
    scope: scope ?? scopeForRadius(regionRadiusMeters(r)),
    all,
    follow,
    country,
    nationFallback,
  }
}

// Region showing a whole country ({ latitude, longitude, zoomDelta } from countryRegions).
function regionForCountry(cr) {
  if (!cr) return null
  const cos = Math.max(Math.cos((cr.latitude * Math.PI) / 180), 0.2)
  return safeRegion({ latitude: cr.latitude, longitude: cr.longitude, latitudeDelta: cr.zoomDelta, longitudeDelta: cr.zoomDelta / cos })
}

// Profile countries (free text from Edit Profile) aren't in the nearby API rows, so look them
// up directly. Returns { id: country } or null if the lookup failed. Cached per session.
const countryCache = new Map()
async function lookupProfileCountries(ids) {
  const missing = ids.filter((id) => !countryCache.has(id)).slice(0, 1500)
  try {
    for (let i = 0; i < missing.length; i += 150) {
      const chunk = missing.slice(i, i + 150)
      const { data, error } = await supabase.from('profiles').select('id, country').in('id', chunk)
      if (error) return null
      const got = new Map((data || []).map((row) => [row.id, row.country ?? null]))
      for (const id of chunk) countryCache.set(id, got.get(id) ?? null)
    }
  } catch {
    return null
  }
  const out = {}
  for (const id of ids) out[id] = countryCache.get(id) ?? null
  return out
}

export default function MapScreen({ navigation }) {
  const scheme = useColorScheme()
  const mapRef = useRef(null)
  const currentRegionRef = useRef(null)
  const userCoordsRef = useRef(null)
  // The area the penguins are loaded for (see makeArea); null until the first fix.
  const areaRef = useRef(null)
  const loadSeqRef = useRef(0)
  // After a preset / search animates the map, re-baseline the searched region on the next
  // settle so MapKit's aspect-fit doesn't immediately re-show "Search this area".
  const rebaseUntilRef = useRef(0)
  const userCountryRef = useRef(null) // ISO code where the user is, once reverse-geocoded

  const [region, setRegion] = useState(null)
  const [locState, setLocState] = useState('pending') // pending | denied | ready
  const [users, setUsers] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [events, setEvents] = useState([])
  const [visible, setVisible] = useState(null)
  const [isGhost, setIsGhost] = useState(false)
  const [visibilityBusy, setVisibilityBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [preset, setPreset] = useState(null)
  const [selectedTags, setSelectedTags] = useState([])
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [areaDirty, setAreaDirty] = useState(false)
  const [areaLoading, setAreaLoading] = useState(false)
  const [areaLoaded, setAreaLoaded] = useState(false)
  const [country, setCountry] = useState(null) // { code, name, flag } | null
  const [countryOpen, setCountryOpen] = useState(false)
  // Bumped by every preset/country pick so a slow async lookup can't override a newer pick.
  const pickSeqRef = useRef(0)

  const authedFetch = async (path, options = {}) => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error('Please sign in again')
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
    })
  }

  useEffect(() => {
    authedFetch('/api/profiles/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return
        setVisible(!!p.show_on_map)
        setIsGhost(p.visibility === 'ghost')
      })
      .catch(() => {})
  }, [])

  const toggleVisibility = async () => {
    if (visible === null || visibilityBusy || isGhost) return
    setVisibilityBusy(true)
    const next = !visible
    setVisible(next)
    try {
      const res = await authedFetch('/api/profiles/me', { method: 'PATCH', body: JSON.stringify({ show_on_map: next }) })
      if (!res.ok) throw new Error('save failed')
    } catch {
      setVisible(!next)
      Alert.alert("Couldn't save", 'Check your connection and try again.')
    } finally {
      setVisibilityBusy(false)
    }
  }

  // Load everyone in an area (see makeArea). Out-of-order responses are dropped so a slow
  // earlier search can't overwrite a newer one.
  const fetchArea = useCallback(async (area) => {
    if (!area?.center || !isValidCoord(area.center.latitude, area.center.longitude)) return
    const seq = ++loadSeqRef.current
    setAreaLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData?.session
      if (!session?.access_token) throw new Error('Please sign in again')
      const { latitude, longitude } = area.center
      const scopeParam = area.scope ? `&scope=${encodeURIComponent(area.scope)}` : ''
      const res = await fetch(
        `${API_URL}/api/locations/nearby?latitude=${latitude}&longitude=${longitude}${scopeParam}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      if (!res.ok) throw new Error('Could not load the map')
      const json = await res.json().catch(() => null)
      if (seq !== loadSeqRef.current) return
      let valid = (Array.isArray(json?.users) ? json.users : [])
        .filter((u) => u && u.user_id && isValidCoord(u.latitude, u.longitude))
      if (!area.all && area.region) valid = valid.filter((u) => inRegion(u, area.region))
      // De-dupe by user_id: duplicate marker keys confuse the native map.
      const seen = new Set()
      valid = valid.filter((u) => (seen.has(u.user_id) ? false : (seen.add(u.user_id), true)))
      if (area.country) {
        const byId = await lookupProfileCountries(valid.map((u) => u.user_id))
        if (seq !== loadSeqRef.current) return
        if (byId) valid = valid.filter((u) => countryMatches(byId[u.user_id], area.country))
        else if (area.region) valid = valid.filter((u) => inRegion(u, area.region, 1))
      }
      if (area.nationFallback && valid.length === 0) {
        // 'national' needs a country on YOUR profile; without one, find people by theirs.
        const retry = { ...area, scope: 'global', country: area.nationFallback, nationFallback: null }
        if (areaRef.current === area) areaRef.current = retry
        return fetchArea(retry)
      }
      setUsers(valid)
      setAreaLoaded(true)
      try {
        const bRes = await fetch(
          `${API_URL}/api/business-locations?lat=${latitude}&lng=${longitude}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        )
        const bJson = await bRes.json().catch(() => null)
        if (seq !== loadSeqRef.current) return
        setBusinesses((Array.isArray(bJson?.businesses) ? bJson.businesses : []).filter((b) => b && isValidCoord(b.latitude, b.longitude)))
      } catch {
        // Pins are a bonus; the map still works without them.
      }
    } finally {
      if (seq === loadSeqRef.current) setAreaLoading(false)
    }
  }, [])

  // Refresh the current area; an "around me" area follows the user's new position.
  const refreshArea = useCallback((coords) => {
    let area = areaRef.current
    if (!area) return Promise.resolve()
    if (area.follow && coords && isValidCoord(coords.latitude, coords.longitude)) {
      const center = { latitude: coords.latitude, longitude: coords.longitude }
      area = { ...area, center, region: { ...area.region, ...center } }
      areaRef.current = area
    }
    return fetchArea(area)
  }, [fetchArea])

  const loadEvents = useCallback(async () => {
    try {
      const now = Date.now()
      const rows = await fetchEvents()
      setEvents(rows.filter((e) => isValidCoord(e.latitude, e.longitude) && new Date(e.ends_at || e.event_date).getTime() > now - 3600 * 1000).slice(0, 100))
    } catch {
      // Event pins are optional.
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      let watchSubscription
      let cancelled = false
      const refresh = (coords) =>
        refreshArea(coords).catch((e) => console.warn('Map refresh failed', e?.message ?? e))

      const start = async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (cancelled) return
          if (status !== 'granted') {
            setLocState('denied')
            return
          }

          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          if (cancelled) return
          if (!isValidCoord(loc.coords.latitude, loc.coords.longitude)) return
          userCoordsRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          const initial = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }
          // Keep the map where the user left it when coming back to the tab.
          setRegion((prev) => prev ?? initial)
          if (!currentRegionRef.current) currentRegionRef.current = initial
          // First visit: the area is what's on screen around you. Coming back keeps the last
          // searched area (refreshed).
          if (!areaRef.current) {
            areaRef.current = makeArea(initial, { follow: true })
            rebaseUntilRef.current = Date.now() + 2500
          }
          setLocState('ready')
          refresh(loc.coords)

          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 10000 },
            (update) => {
              if (!cancelled && isValidCoord(update.coords.latitude, update.coords.longitude)) {
                userCoordsRef.current = { latitude: update.coords.latitude, longitude: update.coords.longitude }
                refresh(update.coords)
              }
            }
          )
          if (cancelled) {
            // Focus was lost while the watch was starting: don't leak it.
            sub.remove()
            return
          }
          watchSubscription = sub
        } catch (e) {
          console.warn('Location start failed', e)
        }
      }

      start()
      loadEvents()

      return () => {
        cancelled = true
        watchSubscription?.remove()
      }
    }, [refreshArea, loadEvents])
  )

  const animateTo = (r, duration = 450) => {
    const safe = safeRegion(r)
    if (!safe) return
    try {
      mapRef.current?.animateToRegion(safe, duration)
    } catch (e) {
      console.warn('animateToRegion failed', e)
    }
  }

  const doRefreshLocation = async () => {
    setRefreshing(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      if (!isValidCoord(loc.coords.latitude, loc.coords.longitude)) return
      userCoordsRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      const next = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: currentRegionRef.current?.latitudeDelta ?? 0.01,
        longitudeDelta: currentRegionRef.current?.longitudeDelta ?? 0.01,
      }
      if (!region) setRegion(next)
      else animateTo(next)
      setLocState('ready')
      if (!areaRef.current) areaRef.current = makeArea(next, { follow: true })
      await refreshArea(loc.coords)
    } catch (e) {
      console.warn('Manual location refresh failed', e)
    } finally {
      setRefreshing(false)
    }
  }

  const refreshLocation = () => {
    Alert.alert(
      'Refresh Location',
      "iYiYi refreshes your location every 10 seconds... Would you like to refresh your location?",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refresh', onPress: doRefreshLocation },
      ]
    )
  }

  const zoom = (factor) => {
    const r = currentRegionRef.current
    if (!r) return
    Haptics.selectionAsync().catch(() => {})
    animateTo({ ...r, latitudeDelta: r.latitudeDelta * factor, longitudeDelta: r.longitudeDelta * factor }, 300)
  }

  const recenter = () => {
    const c = userCoordsRef.current
    if (!c) return
    Haptics.selectionAsync().catch(() => {})
    const r = currentRegionRef.current
    animateTo({ ...c, latitudeDelta: r?.latitudeDelta ?? 0.01, longitudeDelta: r?.longitudeDelta ?? 0.01 })
  }

  // Presets jump the map AND load everyone in that range right away. 150 ft / 5 mi use the
  // API's distance scopes around you; City / State use 'global' (everyone, nearest first)
  // trimmed to the visible region, since the API's city/state scopes match typed-in profile
  // fields rather than distance and miss people who never filled them in.
  const choosePreset = (p) => {
    const c = userCoordsRef.current
    if (!c) {
      Alert.alert('Location needed', 'Turn on location to jump around the map.')
      return
    }
    Haptics.selectionAsync().catch(() => {})
    setPreset(p.key)
    setCountry(null)
    const pick = ++pickSeqRef.current
    if (p.key === 'national') {
      chooseNation(c, pick)
      return
    }
    const target = p.meters
      ? regionForRadius(c, p.meters)
      : safeRegion({ latitude: clamp(c.latitude, -25, 25), longitude: c.longitude, latitudeDelta: 120, longitudeDelta: 180 })
    if (!target) return
    animateTo(target, 650)
    const scope = p.key === 'local' ? 'local' : p.key === 'regional' ? 'regional' : 'global'
    const area = makeArea(target, { scope, all: !p.meters, follow: true, center: { latitude: c.latitude, longitude: c.longitude } })
    if (!area) return
    areaRef.current = area
    rebaseUntilRef.current = Date.now() + 2500
    setAreaDirty(false)
    fetchArea(area).catch((e) => console.warn('Map refresh failed', e?.message ?? e))
  }

  // Nation: jump to roughly your country right away, then refine to its real outline once
  // reverse geocoding says which country you're in. Loads with the API's 'national' scope
  // (same as Nearby's Nationwide: people whose profile country matches yours).
  const chooseNation = async (c, pick) => {
    const cached = userCountryRef.current
    const first = (cached && regionForCountry(bundledCountryRegion(cached))) || regionForRadius(c, 1250000)
    if (!first) return
    animateTo(first, 650)
    const start = (target, code) => {
      const entry = code ? countryByCode(code) : null
      const area = makeArea(target, { scope: 'national', all: true, follow: false, center: { latitude: c.latitude, longitude: c.longitude }, nationFallback: entry })
      if (!area) return
      areaRef.current = area
      rebaseUntilRef.current = Date.now() + 2500
      setAreaDirty(false)
      fetchArea(area).catch((e) => console.warn('Map refresh failed', e?.message ?? e))
    }
    if (cached) {
      start(first, cached)
      return
    }
    const code = await countryCodeAt(c)
    if (pick !== pickSeqRef.current) return
    if (code) userCountryRef.current = code
    const refined = code ? regionForCountry(await countryRegion(code)) : null
    if (pick !== pickSeqRef.current) return
    if (refined) animateTo(refined, 500)
    start(refined || first, code)
  }

  // Country picker: zoom to the country and show only people whose profile country matches.
  const selectCountry = async (entry) => {
    const pick = ++pickSeqRef.current
    if (!entry) {
      clearCountry()
      return
    }
    setCountry(entry)
    setPreset(null)
    setSelected(null)
    const cr = await countryRegion(entry.code)
    if (pick !== pickSeqRef.current) return
    const target = regionForCountry(cr)
    if (!target) {
      Alert.alert('Couldn’t find that country', 'Try again in a moment.')
      return
    }
    animateTo(target, 700)
    const area = makeArea(target, { scope: 'global', all: true, center: { latitude: target.latitude, longitude: target.longitude }, country: entry })
    if (!area) return
    areaRef.current = area
    rebaseUntilRef.current = Date.now() + 2500
    setAreaDirty(false)
    fetchArea(area).catch((e) => console.warn('Country search failed', e?.message ?? e))
  }

  // Dropping the country filter reloads what's on screen, unfiltered.
  const clearCountry = () => {
    ++pickSeqRef.current
    setCountry(null)
    const r = currentRegionRef.current
    const area = makeArea(r, { all: !!r && r.longitudeDelta >= 300 })
    if (!area) return
    areaRef.current = area
    setAreaDirty(false)
    fetchArea(area).catch((e) => console.warn('Map search failed', e?.message ?? e))
  }

  // "Search this area": load everyone inside the region currently on screen (keeps a
  // selected country filter).
  const searchThisArea = () => {
    const r = currentRegionRef.current
    const area = makeArea(r, { all: !!r && r.longitudeDelta >= 300, country })
    if (!area) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    ++pickSeqRef.current
    areaRef.current = area
    setPreset(null)
    setAreaDirty(false)
    fetchArea(area).catch((e) => console.warn('Map search failed', e?.message ?? e))
  }

  const onRegionChangeComplete = (r) => {
    if (!r || ![r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta].every(Number.isFinite)) return
    currentRegionRef.current = r
    const area = areaRef.current
    if (!area) return
    if (Date.now() < rebaseUntilRef.current) {
      // The map just settled on a region we searched for: remember what it really shows.
      rebaseUntilRef.current = 0
      const next = { ...area, settled: { ...r } }
      // A bounds-filtered 'global' area (City / State) adopts what's really on screen, so the
      // people at the top/bottom edges of a portrait map aren't trimmed off. 150 ft / 5 mi keep
      // their exact range (the server limits those by distance anyway).
      const adopt = !area.all && area.scope === 'global'
      if (adopt) next.region = { ...r }
      areaRef.current = next
      setAreaDirty(false)
      if (adopt) fetchArea(next).catch(() => {})
      return
    }
    const changed = areaChanged(area.settled ?? area.region, r)
    setAreaDirty((d) => (d === changed ? d : changed))
  }

  const tagSet = useMemo(() => new Set(selectedTags), [selectedTags])
  const shownUsers = useMemo(
    () => (tagSet.size ? users.filter((u) => Array.isArray(u.tags) && u.tags.some((t) => tagSet.has(t))) : users),
    [users, tagSet]
  )
  const shownBusinesses = tagSet.size && !tagSet.has('Business') ? [] : businesses
  const animatePenguins = shownUsers.length <= MAX_ANIMATED_PENGUINS

  useEffect(() => {
    // Drop the selection if that person is filtered out or left the map.
    if (selected && !shownUsers.some((u) => u.user_id === selected.user_id)) setSelected(null)
  }, [shownUsers, selected])

  const onSelectUser = useCallback((u) => {
    Haptics.selectionAsync().catch(() => {})
    setSelected(u)
  }, [])

  return (
    <View style={styles.screen}>
      <BrandHeader
        title="Map"
        right={
          <>
            <GlassButton
              size="sm"
              onPress={() => navigation.navigate('Events')}
              icon={<Ionicons name="calendar-outline" size={16} color={colors.text} />}
            >
              Events
            </GlassButton>
            <HeaderButton icon={tagSet.size ? 'funnel' : 'funnel-outline'} label="Filter by tag" badge={tagSet.size > 0} onPress={() => setTagMenuOpen((v) => !v)} />
          </>
        }
      />
      <View style={styles.mapWrap}>
        {region ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            onRegionChangeComplete={onRegionChangeComplete}
            onPress={(e) => {
              if (e?.nativeEvent?.action === 'marker-press') return
              setSelected(null)
              setTagMenuOpen(false)
            }}
            userInterfaceStyle={scheme === 'light' ? 'light' : 'dark'}
            showsUserLocation
            zoomEnabled
            zoomTapEnabled
            zoomControlEnabled
            pitchEnabled
            rotateEnabled
          >
            {shownUsers.map((u) => (
              <UserPin
                key={u.user_id}
                user={u}
                animate={animatePenguins}
                selected={selected?.user_id === u.user_id}
                onSelect={onSelectUser}
              />
            ))}
            {shownBusinesses.map((b) => (
              <Marker
                key={`biz-${b.user_id}`}
                coordinate={{ latitude: b.latitude, longitude: b.longitude }}
                title={b.name}
                description={b.address || `@${b.username}`}
                pinColor="#19e3ff"
                onCalloutPress={() => openProfile(navigation, b.user_id)}
              />
            ))}
            {events.map((ev) => (
              <Marker
                key={`ev-${ev.id}`}
                coordinate={{ latitude: ev.latitude, longitude: ev.longitude }}
                title={ev.name}
                description="Tap for event details"
                tracksViewChanges={false}
                onCalloutPress={() => navigation.navigate('EventDetails', { eventId: ev.id })}
              >
                <View style={styles.eventPin}>
                  <Ionicons name="calendar" size={15} color="#ffffff" />
                </View>
              </Marker>
            ))}
          </MapView>
        ) : (
          <View style={styles.center}>
            {locState === 'denied' ? (
              <>
                <Ionicons name="location-outline" size={36} color={colors.textMuted} />
                <Text style={[type.body, styles.centerText]}>Location access is off. Turn it on in Settings to see the map.</Text>
              </>
            ) : (
              <>
                <ActivityIndicator color={colors.textMuted} />
                <Text style={[type.caption, styles.centerText]}>Finding your spot…</Text>
              </>
            )}
          </View>
        )}

        {/* Quick-zoom presets */}
        <View style={styles.presetBar} pointerEvents="box-none">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
            {PRESETS.map((p) => {
              const active = preset === p.key
              return (
                <Pressable key={p.key} onPress={() => choosePreset(p)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  {active ? (
                    <View style={styles.presetActive}><Text style={styles.presetTextActive}>{p.label}</Text></View>
                  ) : (
                    <Glass radius={16} shadow={false} interactive>
                      <View style={styles.preset}><Text style={styles.presetText}>{p.label}</Text></View>
                    </Glass>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
          {country ? (
            <Pressable onPress={() => setCountryOpen(true)} style={styles.filterSummaryWrap} accessibilityLabel={`Country: ${country.name}`}>
              <Glass radius={14} shadow={false}>
                <View style={styles.filterSummary}>
                  <Text style={styles.flag}>{country.flag || '🌐'}</Text>
                  <Text style={styles.filterSummaryText} numberOfLines={1}>{country.name}</Text>
                  <Pressable onPress={clearCountry} hitSlop={10} accessibilityLabel="Clear country">
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              </Glass>
            </Pressable>
          ) : null}
          {tagSet.size > 0 ? (
            <Pressable onPress={() => setTagMenuOpen(true)} style={styles.filterSummaryWrap}>
              <Glass radius={14} shadow={false}>
                <View style={styles.filterSummary}>
                  <Ionicons name="pricetags-outline" size={13} color={colors.text} />
                  <Text style={styles.filterSummaryText} numberOfLines={1}>
                    {selectedTags.slice(0, 3).join(', ')}{selectedTags.length > 3 ? ` +${selectedTags.length - 3}` : ''} · {shownUsers.length}
                  </Text>
                  <Pressable onPress={() => setSelectedTags([])} hitSlop={10} accessibilityLabel="Clear tag filter">
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              </Glass>
            </Pressable>
          ) : null}
        </View>

        {/* Search this area + people count */}
        {region && locState === 'ready' ? (
          <View style={[styles.areaBar, { top: 56 + (tagSet.size > 0 ? 40 : 0) + (country ? 40 : 0) }]} pointerEvents="box-none">
            {areaDirty ? (
              <Pressable
                onPress={searchThisArea}
                accessibilityRole="button"
                accessibilityLabel="Search this area"
                style={({ pressed }) => [pressed && { transform: [{ scale: 0.95 }] }]}
              >
                <Glass radius={radii.pill} strong interactive style={styles.searchArea}>
                  <Ionicons name="search" size={15} color={colors.text} />
                  <Text style={styles.searchAreaText}>Search this area</Text>
                </Glass>
              </Pressable>
            ) : null}
            {areaLoaded || areaLoading ? (
              <Glass radius={radii.pill} shadow={false} style={styles.areaCount} pointerEvents="none">
                {areaLoading ? <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.7 }] }} /> : <Ionicons name="people" size={13} color={colors.textMuted} />}
                <Text style={styles.areaCountText}>
                  {areaLoading && !areaLoaded
                    ? 'Searching…'
                    : `${shownUsers.length} ${shownUsers.length === 1 ? 'person' : 'people'} ${country ? `in ${country.name}` : 'in this area'}`}
                </Text>
              </Glass>
            ) : null}
          </View>
        ) : null}

        {/* Map controls */}
        <View style={styles.controls} pointerEvents="box-none">
          <MapCircleButton onPress={refreshLocation} disabled={refreshing} label="Refresh location">
            {refreshing ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="refresh" size={20} color={colors.text} />}
          </MapCircleButton>
          <MapCircleButton onPress={recenter} label="Center on me">
            <Ionicons name="navigate" size={18} color={colors.text} />
          </MapCircleButton>
          <MapCircleButton onPress={() => setCountryOpen(true)} label="Choose a country">
            <Ionicons name={country ? 'globe' : 'globe-outline'} size={20} color={country ? colors.magenta : colors.text} />
          </MapCircleButton>
          <Glass radius={22} style={styles.zoomGroup} shadow={false}>
            <Pressable onPress={() => zoom(0.5)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in" hitSlop={4}>
              <Ionicons name="add" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.zoomDivider} />
            <Pressable onPress={() => zoom(2)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out" hitSlop={4}>
              <Ionicons name="remove" size={22} color={colors.text} />
            </Pressable>
          </Glass>
        </View>

        {/* Bottom: selected person + visibility */}
        <View style={styles.bottom} pointerEvents="box-none">
          {selected ? (
            <SelectedCard
              user={selected}
              onClose={() => setSelected(null)}
              onOpen={() => openProfile(navigation, selected.user_id)}
            />
          ) : null}
          {visible !== null && (
            <Pressable onPress={toggleVisibility} disabled={visibilityBusy || isGhost}>
              <Glass radius={radii.lg} style={[styles.visibilityPill, visible && !isGhost && styles.visibilityPillActive]} shadow={false}>
                {visibilityBusy ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : isGhost ? (
                  <Text style={styles.visibilityText}>
                    Your profile cannot be shown because you have a ghost account, switch to public or private to display your account on the nearby users and map tabs.
                  </Text>
                ) : (
                  <>
                    <View style={[styles.visibilityDot, visible ? styles.visibilityDotOn : styles.visibilityDotOff]} />
                    <Text style={styles.visibilityText}>{visible ? "You're visible on the map" : "You're hidden from the map"}</Text>
                  </>
                )}
              </Glass>
            </Pressable>
          )}
        </View>

        <CountryPicker
          visible={countryOpen}
          value={country?.code ?? null}
          allowAll
          title="Show people in"
          onSelect={(c) => selectCountry(c && c.code ? c : null)}
          onClose={() => setCountryOpen(false)}
        />

        {tagMenuOpen ? (
          <MapTagMenu
            initial={selectedTags}
            onClose={() => setTagMenuOpen(false)}
            onApply={(tags) => {
              setSelectedTags(tags)
              setTagMenuOpen(false)
            }}
          />
        ) : null}
      </View>
    </View>
  )
}

// One penguin. On Android (Google snapshots marker views) we stop tracking view changes
// once the avatar has loaded; on iOS Apple Maps renders the live view, so it can animate.
const UserPin = memo(function UserPin({ user, animate, selected, onSelect }) {
  const [tracks, setTracks] = useState(true)
  const onReady = useCallback(() => {
    if (Platform.OS === 'android') setTimeout(() => setTracks(false), 250)
  }, [])
  return (
    <Marker
      coordinate={{ latitude: user.latitude, longitude: user.longitude }}
      anchor={{ x: 0.5, y: 0.78 }}
      tracksViewChanges={Platform.OS === 'android' ? tracks || selected : true}
      zIndex={selected ? 999 : 1}
      onPress={() => onSelect(user)}
    >
      <PenguinMarker
        username={user.username}
        avatarUrl={typeof user.avatar_url === 'string' ? user.avatar_url : null}
        animate={animate}
        selected={selected}
        onReady={onReady}
      />
    </Marker>
  )
})

function MapCircleButton({ children, onPress, disabled, label }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.92 }] }]}
    >
      <Glass radius={22} style={styles.circleBtn} interactive shadow={false}>
        <View style={styles.iconCenter}>{children}</View>
      </Glass>
    </Pressable>
  )
}

function SelectedCard({ user, onClose, onOpen }) {
  const tags = Array.isArray(user.tags) ? user.tags.slice(0, 3) : []
  const initial = (String(user.username || '?').trim()[0] || '?').toUpperCase()
  return (
    <Glass radius={radii.lg} strong style={styles.selectedCard}>
      <View style={styles.selectedRow}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={styles.selectedAvatar} />
        ) : (
          <View style={[styles.selectedAvatar, styles.selectedAvatarEmpty]}><Text style={styles.selectedInitial}>{initial}</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={type.headline} numberOfLines={1}>{user.username || 'iYiYi user'}</Text>
          {tags.length ? (
            <View style={styles.selectedTags}>
              {tags.map((t) => (
                <View key={t} style={styles.selectedTag}><Text style={styles.selectedTagText}>{t}</Text></View>
              ))}
            </View>
          ) : (
            <Text style={type.caption}>Nearby on iYiYi</Text>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      <GlassButton variant="primary" size="sm" onPress={onOpen} style={{ marginTop: 12 }}>View profile</GlassButton>
    </Glass>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  mapWrap: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  centerText: { textAlign: 'center', color: colors.textMuted },

  presetBar: { position: 'absolute', top: 10, left: 0, right: 64 },
  presetRow: { paddingHorizontal: 12, gap: 8 },
  preset: { paddingHorizontal: 14, paddingVertical: 8 },
  presetText: { fontSize: 13, fontWeight: '600', color: colors.text },
  presetActive: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.text },
  presetTextActive: { fontSize: 13, fontWeight: '700', color: colors.ink },
  filterSummaryWrap: { marginTop: 8, marginLeft: 12, alignSelf: 'flex-start', maxWidth: '100%' },
  filterSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  filterSummaryText: { fontSize: 12, fontWeight: '600', color: colors.text, flexShrink: 1 },
  flag: { fontSize: 14 },

  controls: { position: 'absolute', top: 10, right: 12, gap: 10, alignItems: 'center' },
  areaBar: { position: 'absolute', left: 64, right: 64, alignItems: 'center', gap: 8 },
  searchArea: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, height: 40 },
  searchAreaText: { fontSize: 14, fontWeight: '700', color: colors.text },
  areaCount: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26 },
  areaCountText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  circleBtn: { width: 44, height: 44 },
  iconCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoomGroup: { width: 44 },
  zoomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, backgroundColor: colors.hairline },

  bottom: { position: 'absolute', left: 16, right: 16, bottom: 20, gap: 10 },
  selectedCard: { padding: 14 },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.inkSurfaceRaised },
  selectedAvatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#8fa2ff' },
  selectedInitial: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  selectedTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline },
  selectedTagText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },

  visibilityPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  visibilityPillActive: { borderWidth: 1, borderColor: colors.magenta },
  visibilityDot: { width: 8, height: 8, borderRadius: 4 },
  visibilityDotOn: { backgroundColor: colors.magenta },
  visibilityDotOff: { backgroundColor: colors.textFaint },
  visibilityText: { ...type.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },

  eventPin: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#5b6cf0', borderWidth: 2, borderColor: '#ffffff',
  },

})
