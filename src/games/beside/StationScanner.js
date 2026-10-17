// Full-screen camera for creating a Beside Them task station: photograph a
// real object, name it, and save it with the current GPS position.
import React, { useRef, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../../components/CameraGate'
import * as Location from 'expo-location'
import { FONT, ST, StButton, stShadow, stType } from '../studio'
import { makeThumbnail, uploadStationPhoto } from '../../lib/arcadeMedia'
import { distanceMeters } from '../../lib/multiplayer'
import { useT } from '../../i18n'
import B from '../../i18n/strings/besideThem'

// onSave({ station, thumb }) — station: { id, name, lat, lng, url, by }
export function StationScanner({ visible, onClose, onSave, area, meId }) {
  const t = useT(B)
  const [perm] = useCameraGate(visible)
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
        setError(t('outside_area'))
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
      onSave({ station: { id, name: name.trim().slice(0, 40) || t('station_default'), lat: where.lat, lng: where.lng, url, by: meId }, thumb })
      reset()
      onClose()
    } catch (e) {
      setError(e?.message || t('save_failed'))
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
            {perm && !perm.granted && perm.status === 'denied' ? <CameraOff what={t('cam_what_task')} compact /> : null}
          </View>
        )}
        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View>
            <Text style={[stType.kicker, { color: ST.objective }, stShadow]}>{t('new_station_kicker')}</Text>
            <Text style={[stType.title, stShadow]}>{t('scan_task_station')}</Text>
            <Text style={[stType.small, { color: ST.text, marginTop: 4 }, stShadow]}>
              {t('scanner_hint')}
            </Text>
          </View>
          <View style={styles.frame} pointerEvents="none" />
          <View style={styles.bottom}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('name_it')}
              placeholderTextColor={ST.faint}
              style={styles.input}
              maxLength={40}
            />
            {!!error && <Text style={[stType.small, { color: ST.objective, marginBottom: 8 }, stShadow]}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StButton title={t('cancel')} tone="ghost" onPress={close} style={{ flex: 1, backgroundColor: ST.panelStrong }} />
              <StButton title={busy ? t('saving') : t('capture')} tone="objective" disabled={!perm?.granted || busy} onPress={capture} style={{ flex: 2 }} />
            </View>
            {busy && <ActivityIndicator color={ST.objective} style={{ marginTop: 8 }} />}
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
  frame: { alignSelf: 'center', width: '80%', aspectRatio: 1, borderWidth: 2, borderColor: ST.objective, borderRadius: ST.radius, borderStyle: 'dashed' },
  bottom: { },
  input: { fontFamily: FONT.uiSemi, fontSize: 16, color: ST.text, backgroundColor: ST.panelStrong, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
})
