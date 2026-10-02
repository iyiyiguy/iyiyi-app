import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import BrandHeader, { HeaderButton } from '../components/BrandHeader'
import Glass from '../components/Glass'
import { GlassButton } from '../components/GlassButton'
import MapTagMenu from '../components/MapTagMenu'
import CountryPicker from '../components/CountryPicker'
import { countryMatches } from '../lib/countries'
import { countryRegion } from '../lib/countryRegions'
import { colors, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { openProfile } from '../lib/profileNav'

// react-native-maps has no web implementation, so this screen (Metro picks
// it automatically when bundled for web) uses Leaflet + OpenStreetMap
// instead — no API key needed, loaded from CDN on first use.
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'

let leafletPromise = null
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = LEAFLET_CSS
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.id = 'leaflet-js'
    script.src = LEAFLET_JS
    script.onload = () => resolve(window.L)
    script.onerror = () => reject(new Error('Could not load the map'))
    document.head.appendChild(script)
  })
  return leafletPromise
}

const TIER_LABEL = { premium: '👑', pro: '⭐', creator: '★', normal: '' }

// Quick-zoom presets (Leaflet zoom levels) + the Nearby scope each one loads.
const PRESETS = [
  { key: 'local', label: '150 ft', zoom: 19 },
  { key: 'regional', label: '5 mi', zoom: 12 },
  { key: 'city', label: 'City', zoom: 10 },
  { key: 'state', label: 'State', zoom: 7 },
  { key: 'national', label: 'Nation', zoom: 4 },
  { key: 'global', label: 'Worldwide', zoom: 2 },
]

// Same original penguin as the native PenguinMarker, drawn in CSS for Leaflet.
const PENGUIN_CSS = `
.iy-peng{position:relative;width:92px;display:flex;flex-direction:column;align-items:center;padding-top:6px;font-family:-apple-system,system-ui,sans-serif}
.iy-peng-anim{animation:iy-waddle 2.6s ease-in-out infinite;transform-origin:50% 90%}
@keyframes iy-waddle{0%,100%{transform:translateY(-1px) rotate(0)}20%{transform:translateY(-3px) rotate(7deg)}60%{transform:translateY(-3px) rotate(-7deg)}80%{transform:translateY(-1px) rotate(0)}}
.iy-peng-body{position:relative;width:36px;height:44px;border-radius:18px 18px 16px 16px;background:#1d2540;border:1.5px solid #fff;overflow:hidden;box-sizing:border-box}
.iy-peng-belly{position:absolute;bottom:-2px;left:5px;right:5px;height:30px;border-radius:14px 14px 12px 12px;background:#f6f8ff}
.iy-peng-eye{position:absolute;top:9px;width:7px;height:8px;border-radius:4px;background:#fff;display:flex;align-items:center;justify-content:center}
.iy-peng-eye i{width:4px;height:5px;border-radius:3px;background:#10131f;margin-top:1px}
.iy-peng-beak{position:absolute;top:16px;left:12.5px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #ffa53a}
.iy-peng-scarf{position:absolute;top:23px;left:0;right:0;height:4px;background:#5b6cf0}
.iy-peng-flip{position:absolute;top:22px;width:9px;height:20px;border-radius:6px;background:#1d2540;border:1px solid #fff}
.iy-peng-feet{display:flex;gap:6px;margin-top:-3px}
.iy-peng-feet i{width:10px;height:5px;border-radius:3px;background:#ffa53a}
.iy-peng-badge{position:absolute;top:0;left:54px;width:22px;height:22px;border-radius:11px;overflow:hidden;background:#8fa2ff;border:2px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800}
.iy-peng-badge img{width:100%;height:100%;object-fit:cover}
.iy-peng-label{margin-top:2px;max-width:92px;padding:2px 7px;border-radius:9px;background:rgba(255,255,255,.92);border:1px solid rgba(30,40,80,.18);font-size:10px;font-weight:700;color:#151a2b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}
.iy-peng-icon{background:none;border:none}
`

function ensurePenguinCss() {
  if (document.getElementById('iy-peng-css')) return
  const style = document.createElement('style')
  style.id = 'iy-peng-css'
  style.textContent = PENGUIN_CSS
  document.head.appendChild(style)
}

// Profile countries aren't in the nearby rows; look them up (null if the lookup failed).
async function lookupProfileCountries(ids) {
  const out = {}
  try {
    for (let i = 0; i < ids.length && i < 1500; i += 150) {
      const chunk = ids.slice(i, i + 150)
      const { data, error } = await supabase.from('profiles').select('id, country').in('id', chunk)
      if (error) return null
      for (const row of data || []) out[row.id] = row.country ?? null
    }
  } catch {
    return null
  }
  return out
}

function el(tag, cls, parent) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (parent) parent.appendChild(node)
  return node
}

// Built as DOM nodes (never innerHTML) so usernames/avatars can't inject markup.
function buildPenguinNode(user) {
  const root = el('div', 'iy-peng')
  const anim = el('div', 'iy-peng-anim', root)
  anim.style.animationDelay = `-${(Math.random() * 2.6).toFixed(2)}s`
  const holder = el('div', null, anim)
  holder.style.cssText = 'position:relative;width:44px;height:50px;display:flex;flex-direction:column;align-items:center'
  const fl = el('div', 'iy-peng-flip', holder)
  fl.style.cssText += ';left:1px;transform:rotate(22deg);top:16px'
  const fr = el('div', 'iy-peng-flip', holder)
  fr.style.cssText += ';right:1px;transform:rotate(-22deg);top:16px'
  const body = el('div', 'iy-peng-body', holder)
  el('div', 'iy-peng-belly', body)
  const eyeL = el('div', 'iy-peng-eye', body)
  eyeL.style.left = '8px'
  el('i', null, eyeL)
  const eyeR = el('div', 'iy-peng-eye', body)
  eyeR.style.right = '8px'
  el('i', null, eyeR)
  el('div', 'iy-peng-beak', body)
  el('div', 'iy-peng-scarf', body)
  const feet = el('div', 'iy-peng-feet', holder)
  el('i', null, feet)
  el('i', null, feet)
  const badge = el('div', 'iy-peng-badge', root)
  if (typeof user.avatar_url === 'string' && user.avatar_url) {
    const img = el('img', null, badge)
    img.src = user.avatar_url
    img.alt = ''
    img.onerror = () => {
      img.remove()
      badge.textContent = (String(user.username || '?').trim()[0] || '?').toUpperCase()
    }
  } else {
    badge.textContent = (String(user.username || '?').trim()[0] || '?').toUpperCase()
  }
  if (user.username) {
    const label = el('div', 'iy-peng-label', root)
    label.textContent = user.username
  }
  return root
}

// Builds the popup as real DOM nodes (not innerHTML) so a username can't
// inject markup, then wires a click on the whole card to open the full
// profile — same UserProfileScreen used everywhere else, which is where
// the other-platform links (Instagram, TikTok, etc.) live.
function buildProfilePopup(user, onOpenProfile) {
  const card = document.createElement('div')
  card.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:170px;cursor:pointer;padding:2px;'

  const avatar = document.createElement('img')
  avatar.src = user.avatar_url ?? ''
  avatar.style.cssText = 'width:42px;height:42px;border-radius:21px;object-fit:cover;background:#2a1f2e;flex-shrink:0;'
  card.appendChild(avatar)

  const info = document.createElement('div')

  const nameRow = document.createElement('div')
  nameRow.style.cssText = 'font-weight:700;font-size:14px;color:#1a1a1a;'
  nameRow.textContent = `${user.username ?? 'iYiYi user'} ${TIER_LABEL[user.account_type] ?? ''}`.trim()
  info.appendChild(nameRow)

  const linkRow = document.createElement('div')
  linkRow.style.cssText = 'font-size:11px;color:#e0158b;font-weight:600;margin-top:2px;'
  linkRow.textContent = 'View profile ›'
  info.appendChild(linkRow)

  card.appendChild(info)
  card.addEventListener('click', () => onOpenProfile(user.user_id))
  return card
}

export default function MapScreen({ navigation }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const userMarkersRef = useRef([])
  const usersRef = useRef([])
  const coordsRef = useRef(null)
  const scopeRef = useRef(null)
  const tagsRef = useRef([])
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [preset, setPreset] = useState(null)
  const [selectedTags, setSelectedTags] = useState([])
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [shownCount, setShownCount] = useState(0)
  const [country, setCountry] = useState(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const countryRef = useRef(null)
  const loadSeqRef = useRef(0)

  // (Re)draws the penguins for the current users + tag filter.
  function drawUsers() {
    const L = window.L
    const map = mapRef.current
    if (!L || !map) return
    userMarkersRef.current.forEach((m) => m.remove())
    userMarkersRef.current = []
    const tags = new Set(tagsRef.current)
    const list = usersRef.current.filter((u) => !tags.size || (Array.isArray(u.tags) && u.tags.some((t) => tags.has(t))))
    for (const u of list) {
      const icon = L.divIcon({ className: 'iy-peng-icon', html: buildPenguinNode(u), iconSize: [92, 76], iconAnchor: [46, 58], popupAnchor: [0, -50] })
      const popupNode = buildProfilePopup(u, (userId) => openProfile(navigation, userId))
      const marker = L.marker([u.latitude, u.longitude], { icon }).addTo(map).bindPopup(popupNode)
      userMarkersRef.current.push(marker)
    }
    setShownCount(list.length)
  }

  async function loadNearbyMarkers(L, map, latitude, longitude) {
    const seq = ++loadSeqRef.current
    const session = (await supabase.auth.getSession()).data?.session
    if (!session?.access_token) throw new Error('Please sign in again')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }

    await fetch(`${API_URL}/api/locations/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ latitude, longitude }),
    })

    const scopeParam = scopeRef.current ? `&scope=${encodeURIComponent(scopeRef.current)}` : ''
    const res = await fetch(
      `${API_URL}/api/locations/nearby?latitude=${latitude}&longitude=${longitude}${scopeParam}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    )
    const json = await res.json().catch(() => null)
    let list = (Array.isArray(json?.users) ? json.users : [])
      .filter((u) => u && Number.isFinite(u.latitude) && Number.isFinite(u.longitude))
    const ctry = countryRef.current
    if (ctry) {
      const byId = await lookupProfileCountries(list.map((u) => u.user_id))
      if (byId) list = list.filter((u) => countryMatches(byId[u.user_id], ctry))
    }
    if (seq !== loadSeqRef.current) return
    usersRef.current = list
    drawUsers()
  }

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          if (!cancelled) setError("Location access is off. Enable it to see the map.")
          return
        }

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        if (cancelled) return
        coordsRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }

        const L = await loadLeaflet()
        if (cancelled || !containerRef.current) return
        ensurePenguinCss()

        const map = L.map(containerRef.current, { zoomControl: false }).setView(
          [loc.coords.latitude, loc.coords.longitude], 16
        )
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map)

        L.circleMarker([loc.coords.latitude, loc.coords.longitude], {
          radius: 9, color: colors.magenta, weight: 3, fillColor: colors.magenta, fillOpacity: 0.9,
        }).addTo(map).bindPopup('You')

        mapRef.current = map

        if (cancelled) return
        await loadNearbyMarkers(L, map, loc.coords.latitude, loc.coords.longitude)
      } catch (e) {
        if (!cancelled) setError(e.message ?? 'Could not load the map')
      }
    }

    init()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  const refreshLocation = () => {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      "iYiYi refreshes your location every 10 seconds... Would you like to refresh your location?"
    )
    if (!confirmed) return

    setRefreshing(true)
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') return
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        coordsRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
        const L = window.L
        if (!L || !mapRef.current) return
        mapRef.current.setView([loc.coords.latitude, loc.coords.longitude], mapRef.current.getZoom())
        await loadNearbyMarkers(L, mapRef.current, loc.coords.latitude, loc.coords.longitude)
      } catch (e) {
        console.warn('Manual location refresh failed', e)
      } finally {
        setRefreshing(false)
      }
    })()
  }

  const choosePreset = (p) => {
    const map = mapRef.current
    const c = coordsRef.current
    if (!map || !c) return
    setPreset(p.key)
    countryRef.current = null
    setCountry(null)
    map.flyTo([c.latitude, c.longitude], p.zoom, { duration: 0.8 })
    if (scopeRef.current !== p.key) {
      scopeRef.current = p.key
      loadNearbyMarkers(window.L, map, c.latitude, c.longitude).catch((e) => console.warn('Map refresh failed', e))
    }
  }

  const selectCountry = async (entry) => {
    const map = mapRef.current
    if (!map || !window.L) return
    countryRef.current = entry && entry.code ? entry : null
    setCountry(countryRef.current)
    setPreset(null)
    let center = coordsRef.current
    if (countryRef.current) {
      const cr = await countryRegion(countryRef.current.code)
      if (cr) {
        map.flyTo([cr.latitude, cr.longitude], Math.max(2, Math.min(12, Math.round(Math.log2(360 / Math.max(cr.zoomDelta * 1.4, 0.1))))), { duration: 0.8 })
        center = { latitude: cr.latitude, longitude: cr.longitude }
      }
    }
    if (!center) return
    scopeRef.current = countryRef.current ? 'global' : null
    loadNearbyMarkers(window.L, map, center.latitude, center.longitude).catch((e) => console.warn('Country search failed', e))
  }

  const applyTags = (tags) => {
    tagsRef.current = tags
    setSelectedTags(tags)
    setTagMenuOpen(false)
    drawUsers()
  }

  const tagCount = useMemo(() => selectedTags.length, [selectedTags])

  return (
    <View style={styles.screen}>
      <BrandHeader
        title="Map"
        right={
          <>
            <GlassButton size="sm" onPress={() => navigation.navigate('Events')} icon={<Ionicons name="calendar-outline" size={16} color={colors.text} />}>
              Events
            </GlassButton>
            <HeaderButton icon={tagCount ? 'funnel' : 'funnel-outline'} label="Filter by tag" badge={tagCount > 0} onPress={() => setTagMenuOpen((v) => !v)} />
          </>
        }
      />
      <View style={styles.mapWrap}>
        {error ? (
          <View style={styles.center}>
            <Text style={[type.body, styles.errorText]}>{error}</Text>
          </View>
        ) : (
          <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
        )}
        {!error && (
          <>
            <View style={styles.presetBar} pointerEvents="box-none">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
                {PRESETS.map((p) => (
                  <Pressable key={p.key} onPress={() => choosePreset(p)}>
                    {preset === p.key ? (
                      <View style={styles.presetActive}><Text style={styles.presetTextActive}>{p.label}</Text></View>
                    ) : (
                      <Glass radius={16} shadow={false}><View style={styles.preset}><Text style={styles.presetText}>{p.label}</Text></View></Glass>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              {country ? (
                <Glass radius={14} shadow={false} style={styles.filterSummaryWrap}>
                  <View style={styles.filterSummary}>
                    <Text style={{ fontSize: 14 }}>{country.flag || '🌐'}</Text>
                    <Pressable onPress={() => setCountryOpen(true)}>
                      <Text style={styles.filterSummaryText} numberOfLines={1}>{country.name} · {shownCount}</Text>
                    </Pressable>
                    <Pressable onPress={() => selectCountry(null)} accessibilityLabel="Clear country">
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </Glass>
              ) : null}
              {tagCount ? (
                <Glass radius={14} shadow={false} style={styles.filterSummaryWrap}>
                  <View style={styles.filterSummary}>
                    <Text style={styles.filterSummaryText} numberOfLines={1}>{selectedTags.slice(0, 3).join(', ')}{tagCount > 3 ? ` +${tagCount - 3}` : ''} · {shownCount}</Text>
                    <Pressable onPress={() => applyTags([])} accessibilityLabel="Clear tag filter">
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </Glass>
              ) : null}
            </View>
            <View style={styles.controls} pointerEvents="box-none">
              <Pressable onPress={refreshLocation} disabled={refreshing} accessibilityLabel="Refresh location">
                <Glass radius={22} style={styles.circleBtn} shadow={false}>
                  <View style={styles.iconCenter}>
                    {refreshing ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="refresh" size={20} color={colors.text} />}
                  </View>
                </Glass>
              </Pressable>
              <Pressable onPress={() => setCountryOpen(true)} accessibilityLabel="Choose a country">
                <Glass radius={22} style={styles.circleBtn} shadow={false}>
                  <View style={styles.iconCenter}>
                    <Ionicons name={country ? 'globe' : 'globe-outline'} size={20} color={country ? colors.magenta : colors.text} />
                  </View>
                </Glass>
              </Pressable>
              <Glass radius={22} style={{ width: 44 }} shadow={false}>
                <Pressable onPress={() => mapRef.current?.zoomIn()} style={styles.zoomBtn} accessibilityLabel="Zoom in">
                  <Ionicons name="add" size={22} color={colors.text} />
                </Pressable>
                <View style={styles.zoomDivider} />
                <Pressable onPress={() => mapRef.current?.zoomOut()} style={styles.zoomBtn} accessibilityLabel="Zoom out">
                  <Ionicons name="remove" size={22} color={colors.text} />
                </Pressable>
              </Glass>
            </View>
          </>
        )}
        <CountryPicker
          visible={countryOpen}
          value={country?.code ?? null}
          allowAll
          title="Show people in"
          onSelect={(c) => selectCountry(c)}
          onClose={() => setCountryOpen(false)}
        />
        {tagMenuOpen ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
            <MapTagMenu initial={selectedTags} onClose={() => setTagMenuOpen(false)} onApply={applyTags} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  mapWrap: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorText: { textAlign: 'center' },
  presetBar: { position: 'absolute', top: 10, left: 0, right: 64, zIndex: 500 },
  presetRow: { paddingHorizontal: 12, gap: 8 },
  preset: { paddingHorizontal: 14, paddingVertical: 8 },
  presetText: { fontSize: 13, fontWeight: '600', color: colors.text },
  presetActive: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.text },
  presetTextActive: { fontSize: 13, fontWeight: '700', color: colors.ink },
  filterSummaryWrap: { marginTop: 8, marginLeft: 12, alignSelf: 'flex-start' },
  filterSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  filterSummaryText: { fontSize: 12, fontWeight: '600', color: colors.text },
  controls: { position: 'absolute', top: 10, right: 12, gap: 10, alignItems: 'center', zIndex: 500 },
  circleBtn: { width: 44, height: 44 },
  iconCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, backgroundColor: colors.hairline },
})
