import { useEffect, useRef, useState } from 'react'
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView from './SafeMapView'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import Glass from './Glass'
import { GlassButton } from './GlassButton'
import { colors, radii, type } from '../theme'

const valid = (c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180

// Full-screen "drop a pin" picker: pan the map under a fixed center pin, then confirm.
// onPick({ latitude, longitude })
export default function MapPickerModal({ visible, initial, onClose, onPick }) {
  const insets = useSafeAreaInsets()
  const scheme = useColorScheme()
  const [start, setStart] = useState(null)
  const centerRef = useRef(null)

  useEffect(() => {
    if (!visible) {
      setStart(null)
      return undefined
    }
    let alive = true
    ;(async () => {
      let c = valid(initial) ? initial : null
      if (!c) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            if (valid(loc?.coords)) c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          }
        } catch { /* fall through to a default view */ }
      }
      if (!c) c = { latitude: 36.1699, longitude: -115.1398 }
      if (!alive) return
      centerRef.current = c
      setStart({ ...c, latitudeDelta: 0.01, longitudeDelta: 0.01 })
    })()
    return () => { alive = false }
  }, [visible, initial])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.screen}>
        {start ? (
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={start}
            showsUserLocation
            userInterfaceStyle={scheme === 'light' ? 'light' : 'dark'}
            onRegionChangeComplete={(r) => {
              if (valid(r)) centerRef.current = { latitude: r.latitude, longitude: r.longitude }
            }}
          />
        ) : (
          <View style={styles.loading}><ActivityIndicator color={colors.textMuted} /></View>
        )}
        {start ? (
          <View style={styles.pinWrap} pointerEvents="none">
            <Ionicons name="location" size={44} color="#5b6cf0" />
          </View>
        ) : null}
        <View style={[styles.top, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
            <Glass radius={21} style={{ width: 42, height: 42 }} shadow={false}>
              <View style={styles.iconCenter}><Ionicons name="close" size={22} color={colors.text} /></View>
            </Glass>
          </Pressable>
          <Glass radius={radii.pill} shadow={false} style={{ flexShrink: 1 }}>
            <Text style={styles.hint}>Move the map to place the pin</Text>
          </Glass>
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <GlassButton
            variant="primary"
            size="lg"
            disabled={!start}
            onPress={() => {
              if (valid(centerRef.current)) onPick?.(centerRef.current)
            }}
          >
            Use this spot
          </GlassButton>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Pin tip sits on the map center: icon is 44 tall, so lift it by ~half.
  pinWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  top: { position: 'absolute', top: 0, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { ...type.caption, color: colors.text, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 10 },
  iconCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0 },
})
