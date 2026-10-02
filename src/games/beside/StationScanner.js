// Full-screen camera for creating a Beside Them task station: photograph a
// real object, name it, and save it with the current GPS position.
import React, { useRef, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { Btn } from '../MultiplayerUI'
import { hudShadow } from '../laser/Hud'
import { makeThumbnail, uploadStationPhoto } from '../../lib/arcadeMedia'
import { distanceMeters } from '../../lib/multiplayer'
import { colors, radii, type } from '../../theme'

// onSave({ station, thumb }) — station: { id, name, lat, lng, url, by }
export function StationScanner({ visible, onClose, onSave, area, meId }) {
  const [perm, requestPerm] = useCameraPermissions()
  const cam = useRef(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const reset = () => { setName(''); setError(null); setBusy(false) }
  const close = () => { reset(); onClose() }

  const capture = async () => {
    if (!cam.current || busy) return
    setBusy(true)
    setError(null)
    try {
      const [photo, pos] = await Promise.all([
        cam.current.takePictureAsync({ quality: 0.7, skipProcessing: false }),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
      ])
      const where = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      if (area && distanceMeters(where, area) > area.r + 15) {
        setError('You’re outside the play area. Stations must be inside it.')
        setBusy(false)
        return
      }
      const thumb = await makeThumbnail(photo.uri)
      let url = null
      try {
        url = await uploadStationPhoto(photo.uri)
      } catch (e) {
        console.warn('station upload failed; sharing thumbnail only', e?.message ?? e)
      }
      const id = `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      onSave({ station: { id, name: name.trim().slice(0, 40) || 'Station', lat: where.lat, lng: where.lng, url, by: meId }, thumb })
      reset()
      onClose()
    } catch (e) {
      setError(e?.message || 'Couldn’t save the station. Try again.')
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={styles.fill}>
        {perm?.granted ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={[type.body, { color: colors.onBrand, textAlign: 'center', marginBottom: 12 }]}>The camera is needed to scan task stations.</Text>
            <Btn title="Allow camera" variant="primary" onPress={() => requestPerm().catch(() => {})} />
          </View>
        )}
        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View>
            <Text style={[type.title, { color: colors.onBrand }, hudShadow]}>Scan a task station</Text>
            <Text style={[type.caption, { color: colors.onBrand, marginTop: 4 }, hudShadow]}>
              Stand right next to a real object (a bench, door, sign, tree…) and fill the frame with it. Players will need to find and match it.
            </Text>
          </View>
          <View style={styles.frame} pointerEvents="none" />
          <View style={styles.bottom}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name it (e.g. Red bench)"
              placeholderTextColor={colors.onBrandMuted}
              style={styles.input}
              maxLength={40}
            />
            {!!error && <Text style={[type.caption, { color: colors.gold, marginBottom: 8 }, hudShadow]}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Cancel" onPress={close} style={{ flex: 1 }} />
              <Btn title={busy ? 'Saving…' : 'Capture station'} variant="primary" disabled={!perm?.granted || busy} onPress={capture} style={{ flex: 2 }} />
            </View>
            {busy && <ActivityIndicator color={colors.onBrand} style={{ marginTop: 8 }} />}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },
  frame: { alignSelf: 'center', width: '80%', aspectRatio: 1, borderWidth: 2, borderColor: colors.onBrand, borderRadius: radii.lg, borderStyle: 'dashed' },
  bottom: { },
  input: { ...type.body, color: colors.onBrand, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
})
