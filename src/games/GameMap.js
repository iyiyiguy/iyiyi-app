// Map used by the arcade: bomb-site / play-area pickers in the lobby and the
// full "View map" sheet in game. Follows MapScreen's Fabric rule: never hand
// MapView/Marker/Circle a non-finite coordinate.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import MapView from '../components/SafeMapView'
import { Circle, Marker } from 'react-native-maps'
import * as Location from 'expo-location'
import { FONT, ST } from './studio'
import { useT } from '../i18n'
import AM from '../i18n/strings/arcadeMisc'

export const isValidCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

export function withAlpha(hex, a) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// Dark ink on bright pin colours, white on dark / red ones.
function pinInk(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#ffffff'
  const n = parseInt(h, 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? ST.ink : '#ffffff'
}

// Map span (degrees) that fits a circle of `r` metres with a little margin.
export function deltaForRadius(r) {
  if (!(r > 0)) return 0.003
  return Math.min(60, Math.max(0.0025, (r * 2.6) / 111000))
}

// markers: [{ id, lat, lng, label, color }]
// circles: [{ id, lat, lng, radius, color }]
// fitRadius: zoom so a circle of this many metres around `center` fits.
// follow: re-centre (animated) whenever `center` / `fitRadius` change.
export function GameMap({ center, markers = [], circles = [], onPick, style, height = 280, hint, fitRadius, follow = false }) {
  const t = useT(AM)
  const delta = deltaForRadius(fitRadius)
  const [region, setRegion] = useState(() =>
    center && isValidCoord(center.lat, center.lng)
      ? { latitude: center.lat, longitude: center.lng, latitudeDelta: delta, longitudeDelta: delta }
      : null,
  )
  const [failed, setFailed] = useState(false)
  const mapRef = useRef(null)

  const cLat = center?.lat
  const cLng = center?.lng
  useEffect(() => {
    if (!follow || !isValidCoord(cLat, cLng)) return
    const next = { latitude: cLat, longitude: cLng, latitudeDelta: delta, longitudeDelta: delta }
    if (!region) { setRegion(next); return }
    try { mapRef.current?.animateToRegion(next, 350) } catch { /* map not ready */ }
  }, [follow, cLat, cLng, delta]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (region) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted') { if (!cancelled) setFailed(true); return }
        const last = await Location.getLastKnownPositionAsync().catch(() => null)
        const pos = last || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
        if (!cancelled && pos && isValidCoord(pos.coords.latitude, pos.coords.longitude)) {
          setRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: delta, longitudeDelta: delta })
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [region])

  const pick = (e) => {
    const c = e?.nativeEvent?.coordinate
    if (onPick && c && isValidCoord(c.latitude, c.longitude)) onPick({ lat: c.latitude, lng: c.longitude })
  }

  return (
    <View style={[styles.wrap, { height }, style]}>
      {region ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsCompass
          rotateEnabled
          pitchEnabled={false}
          onPress={onPick ? pick : undefined}
          onLongPress={onPick ? pick : undefined}
        >
          {circles.filter((c) => isValidCoord(c.lat, c.lng) && c.radius > 0).map((c) => (
            <Circle
              key={`c-${c.id}`}
              center={{ latitude: c.lat, longitude: c.lng }}
              radius={c.radius}
              strokeColor={withAlpha(c.color || ST.friendly, 0.9)}
              fillColor={withAlpha(c.color || ST.friendly, 0.18)}
              strokeWidth={2}
            />
          ))}
          {markers.filter((m) => isValidCoord(m.lat, m.lng)).map((m) => (
            <Marker key={`m-${m.id}`} coordinate={{ latitude: m.lat, longitude: m.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.pin, { backgroundColor: m.color || ST.friendly }]}>
                <Text style={[styles.pinText, { color: pinInk(m.color || ST.friendly) }]} numberOfLines={1}>{m.label}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      ) : failed ? (
        <View style={styles.center}><Text style={styles.offText}>{t('map_loc_off')}</Text></View>
      ) : (
        <View style={styles.center}><ActivityIndicator color={ST.muted} /></View>
      )}
      {!!hint && region && (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderRadius: ST.radius, overflow: 'hidden', backgroundColor: ST.ground2, borderWidth: 1, borderColor: ST.line },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  offText: { fontFamily: FONT.uiSemi, fontSize: 13, lineHeight: 17, color: ST.muted, textAlign: 'center' },
  pin: { paddingHorizontal: 6, height: 20, justifyContent: 'center', borderRadius: 2, borderWidth: 1.5, borderColor: '#ffffff', maxWidth: 140 },
  pinText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#ffffff' },
  hint: { position: 'absolute', top: 8, left: 8, right: 8, alignItems: 'center' },
  hintText: { fontFamily: FONT.uiSemi, fontSize: 12, color: ST.text, backgroundColor: ST.panelStrong, paddingHorizontal: 10, paddingVertical: 4, borderRadius: ST.radius, overflow: 'hidden' },
})
