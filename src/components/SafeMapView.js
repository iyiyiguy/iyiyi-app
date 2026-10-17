import { forwardRef, useImperativeHandle, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import MapView from 'react-native-maps'
import { useT } from '../i18n'
import mapStrings from '../i18n/strings/map'

// Android's maps need a Google Maps API key baked into the build (app.config.js reads it from
// GOOGLE_MAPS_ANDROID_API_KEY). Without one, Google's map would crash the app the moment it
// is shown, so in that case this renders a calm placeholder instead (children such as
// markers are not drawn) and its ref methods are harmless no-ops. iOS uses Apple Maps: always on.
export const mapsAvailable = Platform.OS !== 'android' || !!Constants.expoConfig?.extra?.androidMapsKey

const noop = () => {}
const MapPlaceholder = forwardRef(function MapPlaceholder({ style }, ref) {
  const t = useT(mapStrings)
  useImperativeHandle(ref, () => ({
    animateToRegion: noop,
    animateCamera: noop,
    setCamera: noop,
    fitToCoordinates: noop,
    fitToElements: noop,
    fitToSuppliedMarkers: noop,
    getCamera: () => Promise.resolve(null),
    getMapBoundaries: () => Promise.resolve(null),
    pointForCoordinate: () => Promise.resolve({ x: 0, y: 0 }),
    coordinateForPoint: () => Promise.resolve({ latitude: 0, longitude: 0 }),
  }), [])
  const [small, setSmall] = useState(false)
  return (
    <View style={[style, styles.box]} onLayout={(e) => setSmall(e.nativeEvent.layout.width < 180)}>
      <Text style={[styles.icon, small && { fontSize: 20, marginBottom: 0 }]}>🗺️</Text>
      {small ? null : <Text style={styles.text}>{t('mapUnavailable')}</Text>}
    </View>
  )
})

export default mapsAvailable ? MapView : MapPlaceholder

const styles = StyleSheet.create({
  box: { backgroundColor: '#1a1424', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  icon: { fontSize: 28, marginBottom: 6 },
  text: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
})
