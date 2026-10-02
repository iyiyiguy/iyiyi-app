// Laser Tag map HUD: a small, non-interactive, heading-up real map (Apple Maps on iOS)
// in place of the old drawn radar, plus a large map overlay opened by double-tapping it.
//
// Follows GameMap.js conventions: never hand MapView/Marker/Circle a non-finite
// coordinate. Markers use tracksViewChanges={false}; the camera follows the player at
// most about once a second.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { isValidCoord, withAlpha } from '../GameMap'
import { colors, radii } from '../../theme'
import { PulseDot, RadarSweep, ShotPing } from './Uav'

// Map ranges (radius shown around the player, metres).
export const MAP_RANGES = [
  { id: '150ft', label: '150 ft', r: 45.72 },
  { id: '1mi', label: '1 mi', r: 1609.34 },
  { id: '2mi', label: '2 mi', r: 3218.69 },
  { id: '5mi', label: '5 mi', r: 8046.72 },
  { id: 'city', label: 'City', r: 16000 },
  { id: 'state', label: 'State', r: 250000 },
  { id: 'nation', label: 'Nation', r: 2500000 },
]
export const DEFAULT_MAP_RANGE = '150ft'

/** Ranges allowed by the lobby: up to its play area (everything for the endless arena). */
export function allowedRanges({ endless, areaR }) {
  if (endless || !(areaR > 0)) return MAP_RANGES.map((r) => r.id)
  const ok = MAP_RANGES.filter((r) => r.r <= areaR + 1).map((r) => r.id)
  return ok.length ? ok : [MAP_RANGES[0].id]
}

export const rangeById = (id) => MAP_RANGES.find((r) => r.id === id) || MAP_RANGES[0]

const CAMERA_EVERY_MS = 1000

// Apple Maps zooms by camera altitude, Google by zoom level.
function cameraFor(center, rangeM, sizePx, headingDeg) {
  const r = Math.max(20, rangeM)
  const metersPerPx = r / Math.max(40, sizePx / 2)
  const zoom = Math.log2((156543.03 * Math.cos((center.lat * Math.PI) / 180)) / metersPerPx)
  return {
    center: { latitude: center.lat, longitude: center.lng },
    heading: Number.isFinite(headingDeg) ? headingDeg : 0,
    pitch: 0,
    altitude: Math.min(4.0e7, r * 2.6),
    zoom: Math.max(1, Math.min(20, zoom)),
  }
}

function Dot({ color, label, ring, me, kind }) {
  if (kind === 'uav') return <PulseDot ring={ring} />
  if (kind === 'ping') return <ShotPing />
  if (me) {
    return (
      <View style={s.meWrap}>
        <View style={s.meDot} />
      </View>
    )
  }
  return (
    <View style={[s.dot, { backgroundColor: color || colors.danger }, ring && s.dotRing]}>
      {!!label && <Text style={s.dotLabel}>{label}</Text>}
    </View>
  )
}

// Shared map body. points: [{ id, pos, color, label?, ring?, kind?: 'uav'|'ping', opacity? }], areas: [{ id, pos, r, color, label }]
// boundary: { lat, lng, r } | null.
function LaserMap({ me, headingDeg, rangeM, points, areas, boundary, rangeRingM, sizePx, headingUp, interactive, style, legalLabelInsets }) {
  const mapRef = useRef(null)
  const lastCam = useRef(0)
  const pending = useRef(null)
  const timer = useRef(null)
  const hasMe = !!me && isValidCoord(me.lat, me.lng)
  const [ready, setReady] = useState(false)

  const initial = useMemo(
    () => (hasMe ? cameraFor(me, rangeM, sizePx, headingUp ? headingDeg : 0) : null),
    [hasMe], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Throttled camera follow (~1/s). Range changes apply immediately.
  const apply = (cam, duration) => {
    try {
      if (!mapRef.current) return
      if (duration > 0) mapRef.current.animateCamera(cam, { duration })
      else mapRef.current.setCamera(cam)
    } catch {
      // Map not ready yet.
    }
  }
  const lat = me?.lat
  const lng = me?.lng
  const hdg = headingUp ? Math.round(headingDeg || 0) : 0
  useEffect(() => {
    if (!ready || !isValidCoord(lat, lng) || interactive) return undefined
    pending.current = cameraFor({ lat, lng }, rangeM, sizePx, hdg)
    const wait = Math.max(0, CAMERA_EVERY_MS - (Date.now() - lastCam.current))
    if (timer.current) return undefined
    timer.current = setTimeout(() => {
      timer.current = null
      lastCam.current = Date.now()
      if (pending.current) apply(pending.current, 800)
    }, wait)
    return undefined
  }, [ready, lat, lng, hdg, interactive]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !isValidCoord(lat, lng)) return
    lastCam.current = Date.now()
    apply(cameraFor({ lat, lng }, rangeM, sizePx, hdg), 350)
  }, [ready, rangeM]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!initial) {
    return <View style={[style, s.noFix]}><Text style={s.noFixText}>Waiting for GPS…</Text></View>
  }

  const validPoints = (points || []).filter((p) => p?.pos && isValidCoord(p.pos.lat, p.pos.lng))
  const validAreas = (areas || []).filter((a) => a?.pos && isValidCoord(a.pos.lat, a.pos.lng) && a.r > 0)
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
        pitchEnabled={false}
        rotateEnabled={!!interactive}
        showsCompass={false}
        showsScale={false}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        legalLabelInsets={legalLabelInsets}
        onMapReady={() => setReady(true)}
      >
        {boundary && isValidCoord(boundary.lat, boundary.lng) && boundary.r > 0 && (
          <Circle center={{ latitude: boundary.lat, longitude: boundary.lng }} radius={boundary.r} strokeColor={withAlpha('#7c8cff', 0.95)} fillColor={withAlpha('#7c8cff', 0.06)} strokeWidth={2} />
        )}
        {hasMe && rangeRingM > 0 && (
          <Circle center={{ latitude: me.lat, longitude: me.lng }} radius={rangeRingM} strokeColor="rgba(255,255,255,0.55)" fillColor="rgba(255,255,255,0.04)" strokeWidth={1} lineDashPattern={[4, 4]} />
        )}
        {validAreas.map((a) => (
          <Circle key={`a-${a.id}`} center={{ latitude: a.pos.lat, longitude: a.pos.lng }} radius={a.r} strokeColor={withAlpha(a.color || colors.gold, 0.95)} fillColor={withAlpha(a.color || colors.gold, 0.22)} strokeWidth={2} />
        ))}
        {validAreas.map((a) => (
          <Marker key={`al-${a.id}`} coordinate={{ latitude: a.pos.lat, longitude: a.pos.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.siteTag}><Text style={s.siteText}>{a.label}</Text></View>
          </Marker>
        ))}
        {validPoints.map((p) => (
          <Marker
            key={`p-${p.id}`}
            coordinate={{ latitude: p.pos.lat, longitude: p.pos.lng }}
            tracksViewChanges={p.kind === 'uav'}
            opacity={Number.isFinite(p.opacity) ? Math.max(0, Math.min(1, p.opacity)) : 1}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <Dot color={p.color} label={p.label} ring={p.ring} kind={p.kind} />
          </Marker>
        ))}
        {hasMe && interactive && (
          <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
            <Dot me />
          </Marker>
        )}
      </MapView>
    </View>
  )
}

/**
 * Small heading-up minimap. Single taps do nothing (and never reach the fire handler);
 * a double tap calls onOpen.
 */
export const MapMinimap = React.memo(function MapMinimap({ size = 140, me, headingDeg = 0, rangeM, points, areas, boundary, rangeRingM, onOpen, rangeLabel, uavActive }) {
  const lastTap = useRef(0)
  const onPress = () => {
    const t = Date.now()
    if (t - lastTap.current < 320) {
      lastTap.current = 0
      onOpen?.()
    } else {
      lastTap.current = t
    }
  }
  const half = size / 2
  // Apple's "Maps · Legal" label must stay visible: centre it near the bottom of the circle
  // (the square's corners are clipped). The range label sits at the top instead.
  const legalInsets = useMemo(() => ({ top: 0, left: Math.max(0, Math.round(half - 34)), right: 0, bottom: Math.round(size * 0.07) }), [half, size])
  const nRad = (-(headingDeg || 0) * Math.PI) / 180
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size }} accessibilityRole="button" accessibilityLabel="Minimap. Double-tap to open the large map" accessibilityHint="Double-tap to open the map">
      <View style={[s.mini, { width: size, height: size, borderRadius: half }]}>
        <LaserMap
          me={me}
          headingDeg={headingDeg}
          rangeM={rangeM}
          points={points}
          areas={areas}
          boundary={boundary}
          rangeRingM={rangeRingM}
          sizePx={size}
          headingUp
          legalLabelInsets={legalInsets}
          style={StyleSheet.absoluteFill}
        />
        {/* You (centre, facing up) */}
        <View style={[s.meArrowWrap, { left: half - 8, top: half - 9 }]} pointerEvents="none">
          <Ionicons name="navigate" size={16} color="#3ad1ff" style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>
        {uavActive ? <RadarSweep size={size} /> : <View style={s.rim} pointerEvents="none" />}
        <Text style={[s.north, { left: half + Math.sin(nRad) * (half - 11) - 6, top: half - Math.cos(nRad) * (half - 11) - 8 }]} pointerEvents="none">N</Text>
        {!!rangeLabel && <Text style={s.scale} pointerEvents="none">{rangeLabel}</Text>}
      </View>
    </Pressable>
  )
})

/** Full-screen map overlay (not a native Modal, so it can never get stuck over the game). */
export function MapOverlay({ visible, onClose, insets, me, rangeId, allowed, onRange, points, areas, boundary, rangeRingM, uavActive }) {
  if (!visible) return null
  const range = rangeById(rangeId)
  return (
    <View style={[StyleSheet.absoluteFill, s.overlayRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close map" />
      <View style={[s.overlayWrap, { paddingTop: (insets?.top || 0) + 12, paddingBottom: (insets?.bottom || 0) + 16 }]} pointerEvents="box-none">
        <View style={s.panel}>
          <View style={s.panelHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.panelTitle}>Map</Text>
              {!!uavActive && <Text style={s.uavTag}>UAV ONLINE</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close map">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={s.ranges}>
            {MAP_RANGES.map((r) => {
              const ok = allowed.includes(r.id)
              const on = r.id === range.id
              return (
                <Pressable
                  key={r.id}
                  disabled={!ok}
                  onPress={() => onRange(r.id)}
                  style={[s.rangeChip, on && s.rangeOn, !ok && { opacity: 0.3 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !ok }}
                >
                  <Text style={[s.rangeText, on && { color: '#10121f' }]}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <LaserMap
            me={me}
            headingDeg={0}
            rangeM={range.r}
            points={points}
            areas={areas}
            boundary={boundary}
            rangeRingM={rangeRingM}
            sizePx={340}
            interactive
            style={s.bigMap}
          />
          <Text style={s.panelNote}>
            {allowed.length < MAP_RANGES.length ? 'Larger ranges are limited by this lobby’s play area.' : 'Pinch and drag to look around.'}
          </Text>
          <Text style={s.panelNote}>Enemies stay hidden — they flash red when they fire, or all show while a UAV is up.</Text>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  mini: { overflow: 'hidden', backgroundColor: '#1a1f2e' },
  rim: { ...StyleSheet.absoluteFillObject, borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  north: { position: 'absolute', width: 12, textAlign: 'center', fontSize: 11, fontWeight: '900', color: '#ff5d6c', textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 3 },
  scale: { position: 'absolute', top: 20, alignSelf: 'center', fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden' },
  meArrowWrap: { position: 'absolute', width: 16, height: 18, alignItems: 'center', justifyContent: 'center' },
  noFix: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1f2e' },
  noFixText: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  dot: { minWidth: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  dotRing: { borderColor: '#ffc94d', borderWidth: 3 },
  dotLabel: { fontSize: 9, paddingHorizontal: 2 },
  meWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(58,209,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#3ad1ff', borderWidth: 2, borderColor: '#fff' },
  siteTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' },
  siteText: { fontSize: 10, fontWeight: '900', color: '#ffc94d' },
  overlayRoot: { zIndex: 50, elevation: 50 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  panel: { backgroundColor: 'rgba(14,17,30,0.96)', borderRadius: radii.lg, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  panelTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  rangeChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  rangeOn: { backgroundColor: '#fff', borderColor: '#fff' },
  rangeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  bigMap: { height: 360, borderRadius: radii.md, overflow: 'hidden' },
  uavTag: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#fff', backgroundColor: '#d4202f', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  panelNote: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8, textAlign: 'center' },
})
