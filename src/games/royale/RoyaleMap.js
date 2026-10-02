// Battle Royale map (Apple Maps on iOS): current safe zone, next zone (dashed), the
// players (nearest MAP_MAX_DOTS as dots, the rest grouped into count bubbles), loot and
// you. Used as the HUD minimap (non-interactive, follows you) and as the full map.
//
// Follows GameMap.js conventions: never hand MapView/Marker/Circle a non-finite
// coordinate, markers use tracksViewChanges={false}, and the camera follows at most
// about once a second.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import MapView from '../../components/SafeMapView'
import { Circle, Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { MAP_MAX_CLUSTERS, MAP_MAX_DOTS, MAP_MAX_LOOT, ROYALE_COLORS } from './constants'
import { dist, isValidCoord, validPos } from './geo'

const CAMERA_EVERY_MS = 1000

function cameraFor(center, rangeM, sizePx) {
  const r = Math.max(30, Number.isFinite(rangeM) ? rangeM : 400)
  const metersPerPx = r / Math.max(40, sizePx / 2)
  const zoom = Math.log2((156543.03 * Math.cos((center.lat * Math.PI) / 180)) / metersPerPx)
  return {
    center: { latitude: center.lat, longitude: center.lng },
    heading: 0,
    pitch: 0,
    altitude: Math.min(4.0e7, r * 2.8),
    zoom: Math.max(1, Math.min(20, Number.isFinite(zoom) ? zoom : 14)),
  }
}

const Dot = memo(function Dot({ color, ring }) {
  return <View style={[s.dot, { backgroundColor: color }, ring && s.dotRing]} />
})

const Bubble = memo(function Bubble({ count }) {
  return (
    <View style={s.bubble}>
      <Text style={s.bubbleText}>{count > 99 ? '99+' : count}</Text>
    </View>
  )
})

const LootPin = memo(function LootPin({ label, color }) {
  return (
    <View style={[s.loot, { borderColor: color || ROYALE_COLORS.loot }]}>
      <Text style={s.lootText} numberOfLines={1}>{label}</Text>
    </View>
  )
})

const MeDot = memo(function MeDot() {
  return (
    <View style={s.meWrap}>
      <View style={s.meDot} />
    </View>
  )
})

// Nearest `max` players as dots; the rest bucketed into grid cells.
export function splitPlayers(players, focus, rangeM, max = MAP_MAX_DOTS) {
  const valid = (players || []).filter((p) => p && isValidCoord(p.lat, p.lng))
  if (valid.length <= max || !validPos(focus)) return { dots: valid.slice(0, max), clusters: [] }
  const withD = valid.map((p) => ({ p, d: dist(focus, p) })).sort((a, b) => a.d - b.d)
  const dots = withD.slice(0, max).map((x) => x.p)
  const cellM = Math.max(80, (rangeM || 1000) / 5)
  const cellLat = cellM / 111320
  const cellLng = cellM / (111320 * Math.max(0.05, Math.cos((focus.lat * Math.PI) / 180)))
  const cells = new Map()
  for (const { p } of withD.slice(max)) {
    const key = `${Math.floor(p.lat / cellLat)}:${Math.floor(p.lng / cellLng)}`
    const c = cells.get(key) || { id: `c${key}`, lat: 0, lng: 0, count: 0 }
    c.lat += p.lat
    c.lng += p.lng
    c.count += 1
    cells.set(key, c)
  }
  const clusters = [...cells.values()]
    .map((c) => ({ id: c.id, lat: c.lat / c.count, lng: c.lng / c.count, count: c.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAP_MAX_CLUSTERS)
  return { dots, clusters }
}

/**
 * props:
 *   me        { lat, lng } | null
 *   focus     what the camera follows (defaults to me)
 *   zone      { current: {lat,lng,r}, next: {lat,lng,r}|null } | null
 *   players   [{ id, lat, lng, color, ring? }]   (others only)
 *   loot      [{ id, lat, lng, label, color }]
 *   rangeM    radius shown around focus
 *   sizePx    approx. map size (for zoom)
 *   interactive  pan/zoom enabled (full map) — the camera then only follows on recenter
 */
export const RoyaleMap = memo(function RoyaleMap({ me, focus, zone, players, loot, rangeM = 400, sizePx = 300, interactive = false, style, showRecenter = false, legalLabelInsets }) {
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const lastCam = useRef(0)
  const timer = useRef(null)
  const pending = useRef(null)
  const target = validPos(focus) ? focus : validPos(me) ? me : zone?.current && validPos(zone.current) ? zone.current : null
  const hasTarget = !!target

  const initial = useMemo(
    () => (hasTarget ? cameraFor(target, rangeM, sizePx) : null),
    [hasTarget], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const apply = (cam, duration) => {
    try {
      if (!mapRef.current) return
      if (duration > 0) mapRef.current.animateCamera(cam, { duration })
      else mapRef.current.setCamera(cam)
    } catch {
      // Map not ready.
    }
  }

  // Follow (non-interactive maps), throttled.
  const tLat = target?.lat
  const tLng = target?.lng
  useEffect(() => {
    if (!ready || interactive || !isValidCoord(tLat, tLng)) return undefined
    pending.current = cameraFor({ lat: tLat, lng: tLng }, rangeM, sizePx)
    if (timer.current) return undefined
    const wait = Math.max(0, CAMERA_EVERY_MS - (Date.now() - lastCam.current))
    timer.current = setTimeout(() => {
      timer.current = null
      lastCam.current = Date.now()
      if (pending.current) apply(pending.current, 700)
    }, wait)
    return undefined
  }, [ready, interactive, tLat, tLng]) // eslint-disable-line react-hooks/exhaustive-deps
  // Range / focus target changes apply right away.
  const focusKey = focus?.id || ''
  useEffect(() => {
    if (!ready || !isValidCoord(tLat, tLng)) return
    lastCam.current = Date.now()
    apply(cameraFor({ lat: tLat, lng: tLng }, rangeM, sizePx), 350)
  }, [ready, rangeM, focusKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), [])

  const lat = target?.lat
  const lng = target?.lng
  const split = useMemo(
    () => splitPlayers(players, target, rangeM),
    // Recompute when the player list changes or the focus moves noticeably.
    [players, Math.round((lat || 0) * 2000), Math.round((lng || 0) * 2000), rangeM], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const lootShown = useMemo(() => {
    const valid = (loot || []).filter((l) => l && isValidCoord(l.lat, l.lng))
    if (valid.length <= MAP_MAX_LOOT || !target) return valid.slice(0, MAP_MAX_LOOT)
    return valid.map((l) => ({ l, d: dist(target, l) })).sort((a, b) => a.d - b.d).slice(0, MAP_MAX_LOOT).map((x) => x.l)
  }, [loot, Math.round((lat || 0) * 500), Math.round((lng || 0) * 500)]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!initial) {
    return <View style={[style, s.noFix]}><Text style={s.noFixText}>Waiting for GPS…</Text></View>
  }
  const cur = zone?.current && validPos(zone.current) && zone.current.r > 0 ? zone.current : null
  const next = zone?.next && validPos(zone.next) && zone.next.r > 0 ? zone.next : null

  return (
    <View style={style} pointerEvents={interactive ? 'auto' : 'none'}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialCamera={initial}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        userInterfaceStyle="dark"
        scrollEnabled={!!interactive}
        zoomEnabled={!!interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
        showsScale={false}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        legalLabelInsets={legalLabelInsets}
        onMapReady={() => setReady(true)}
      >
        {cur && (
          <Circle
            center={{ latitude: cur.lat, longitude: cur.lng }}
            radius={cur.r}
            strokeColor="rgba(232,241,255,0.95)"
            fillColor="rgba(120,180,255,0.07)"
            strokeWidth={3}
          />
        )}
        {next && (
          <Circle
            center={{ latitude: next.lat, longitude: next.lng }}
            radius={next.r}
            strokeColor="rgba(255,255,255,0.9)"
            fillColor="rgba(255,255,255,0.02)"
            strokeWidth={2}
            lineDashPattern={[8, 6]}
          />
        )}
        {lootShown.map((l) => (
          <Marker key={`l-${l.id}`} coordinate={{ latitude: l.lat, longitude: l.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <LootPin label={l.label} color={l.color} />
          </Marker>
        ))}
        {split.clusters.map((c) => (
          <Marker key={`${c.id}-${c.count}`} coordinate={{ latitude: c.lat, longitude: c.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <Bubble count={c.count} />
          </Marker>
        ))}
        {split.dots.map((p) => (
          <Marker key={`p-${p.id}-${p.color}-${p.ring ? 1 : 0}`} coordinate={{ latitude: p.lat, longitude: p.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <Dot color={p.color || ROYALE_COLORS.enemy} ring={!!p.ring} />
          </Marker>
        ))}
        {validPos(me) && (
          <Marker key="me" coordinate={{ latitude: me.lat, longitude: me.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <MeDot />
          </Marker>
        )}
      </MapView>
      {interactive && showRecenter && (
        <Pressable
          onPress={() => { if (isValidCoord(tLat, tLng)) apply(cameraFor({ lat: tLat, lng: tLng }, rangeM, sizePx), 350) }}
          style={s.recenter}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Recenter map"
        >
          <Ionicons name="locate" size={18} color="#fff" />
        </Pressable>
      )}
    </View>
  )
})

const s = StyleSheet.create({
  noFix: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#141826' },
  noFixText: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: '#fff' },
  dotRing: { width: 15, height: 15, borderRadius: 8, borderWidth: 3, borderColor: ROYALE_COLORS.follow },
  bubble: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5, backgroundColor: 'rgba(255,93,108,0.85)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  bubbleText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  loot: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 7, backgroundColor: 'rgba(10,12,22,0.85)', borderWidth: 1.5, maxWidth: 80 },
  lootText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  meWrap: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(58,209,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: ROYALE_COLORS.me, borderWidth: 2, borderColor: '#fff' },
  recenter: { position: 'absolute', right: 10, bottom: 10, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
})

export default RoyaleMap
