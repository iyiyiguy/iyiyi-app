// Map used by the arcade: bomb-site / play-area pickers in the lobby and the
// full "View map" sheet in game. Follows MapScreen's Fabric rule: never hand
// MapView/Marker/Circle a non-finite coordinate.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import MapView from '../components/SafeMapView'
import { Circle, Marker } from 'react-native-maps'
import * as Location from 'expo-location'
import { colors, radii, type } from '../theme'

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
              strokeColor={withAlpha(c.color || colors.magenta, 0.9)}
              fillColor={withAlpha(c.color || colors.magenta, 0.18)}
              strokeWidth={2}
            />
          ))}
          {markers.filter((m) => isValidCoord(m.lat, m.lng)).map((m) => (
            <Marker key={`m-${m.id}`} coordinate={{ latitude: m.lat, longitude: m.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.pin, { backgroundColor: m.color || colors.magenta }]}>
                <Text style={styles.pinText} numberOfLines={1}>{m.label}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      ) : failed ? (
        <View style={styles.center}><Text style={[type.caption, { textAlign: 'center' }]}>Location is off, so the map can’t be shown. Turn on location for iYiYi in Settings.</Text></View>
      ) : (
        <View style={styles.center}><ActivityIndicator color={colors.textMuted} /></View>
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
  wrap: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.inkSurfaceRaised },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  pin: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, borderWidth: 2, borderColor: colors.onBrand, maxWidth: 140 },
  pinText: { fontSize: 11, fontWeight: '700', color: colors.onBrand },
  hint: { position: 'absolute', top: 8, left: 8, right: 8, alignItems: 'center' },
  hintText: { fontSize: 12, fontWeight: '600', color: colors.onBrand, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, overflow: 'hidden' },
})
