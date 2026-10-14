// "Walk & place" station setup (host only): walk around the house / venue and tap
// "Place station here" at each spot. Each placement records the GPS fix (with accuracy)
// and the barometric altitude vs the host's start floor (./baro.js), so a station
// upstairs only opens upstairs. Optional: a typed name and a photo of the spot as a hint.
//
// The host's start-floor reference is also saved in settings.altRefP (a pressure
// altitude, with altRefBy = the host's id) so an app restart in the lobby doesn't lose
// the floors.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import * as ImagePicker from 'expo-image-picker'
import { FONT, ST, StButton, stType, withAlpha } from '../studio'
import { makeThumbnail, uploadStationPhoto } from '../../lib/arcadeMedia'
import { STATION_OBJECTS, finiteAlt, floorIndex, floorLabel, makePlaceStation, MAX_AUTO_STATIONS } from './engine'
import { SETUP_TAG, calibrate, refPressureAlt, refTag, restoreRef, useBaro } from './baro'
const WEAK_ACC_M = 15

function suggestName(taken, skip) {
  const free = STATION_OBJECTS.filter((o) => !taken.includes(o.name) && o.name !== skip)
  const list = free.length ? free : STATION_OBJECTS
  return list[Math.floor(Math.random() * list.length)].name
}

export function PlacePanel({ room, stations, meId }) {
  const baro = useBaro(true)
  const [fix, setFix] = useState(null) // { lat, lng, acc }
  const [locErr, setLocErr] = useState(null)
  const [name, setName] = useState('')
  const [suggested, setSuggested] = useState(() => suggestName(stations.map((s) => s.name)))
  const [photoUri, setPhotoUri] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)
  const flashTimer = useRef(null)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const put = (patch) => room.setInfo({ settings: { ...(room.info.settings || {}), ...patch } })

  // Live GPS while placing.
  useEffect(() => {
    let sub = null
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (perm.status !== 'granted') { setLocErr('Location is off. Allow it to place stations.'); return }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (l) => setFix({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null }),
          () => {},
        )
        if (cancelled) sub?.remove()
      } catch {
        if (!cancelled) setLocErr('Couldn’t read your location.')
      }
    })()
    return () => { cancelled = true; sub?.remove() }
  }, [])

  // The host's start floor: restored from settings, or taken where setup begins.
  useEffect(() => {
    if (baro.status !== 'ready' || refTag() === SETUP_TAG) return
    const saved = room.info.settings?.altRefP
    // A saved reference is only valid on the phone that took it (sensors differ).
    const mine = room.info.settings?.altRefBy === meId
    if (mine && Number.isFinite(saved) && stations.some((st) => finiteAlt(st.alt))) restoreRef(saved, SETUP_TAG)
    else if (calibrate(SETUP_TAG) !== false) put({ altRefP: refPressureAlt(), altRefBy: meId })
  }, [baro.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const alt = baro.tag === SETUP_TAG ? baro.alt : null
  const noBaro = baro.status === 'none'

  const resetFloor = () => {
    const prev = calibrate(SETUP_TAG)
    if (prev === false) return
    const shift = finiteAlt(prev) ? prev : 0
    const cur = room.info.settings?.stations || []
    put({
      altRefP: refPressureAlt(),
      altRefBy: meId,
      stations: cur.map((st) => (st.kind === 'place' && finiteAlt(st.alt)
        ? { ...st, alt: Math.round((st.alt - shift) * 10) / 10, floor: floorIndex(st.alt - shift) + 1 }
        : st)),
    })
    setFlash('Start floor set here. Floors are counted from this one.')
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  const takePhoto = async () => {
    setError(null)
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) { setError('Camera is off. You can place the station without a photo.'); return }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: false })
      if (!res.canceled && res.assets?.[0]?.uri) setPhotoUri(res.assets[0].uri)
    } catch {
      setError('Couldn’t open the camera.')
    }
  }

  const place = async () => {
    if (busy) return
    if (!fix) { setError('Waiting for GPS…'); return }
    setBusy(true)
    setError(null)
    // Position and floor at the moment of the tap; the photo is processed afterwards.
    const here = { ...fix, alt: noBaro ? null : alt }
    const cur = room.info.settings?.stations || []
    const no = cur.reduce((m, st) => Math.max(m, st.no || 0), 0) + 1
    let thumb = null
    let url = null
    if (photoUri) {
      try { thumb = await makeThumbnail(photoUri) } catch { thumb = null }
      try { url = await uploadStationPhoto(photoUri) } catch (e) { console.warn('place photo upload failed; sharing thumbnail only', e?.message ?? e) }
    }
    const st = makePlaceStation({ ...here, name: name || suggested, no, photo: !!(thumb || url), url }, { taken: cur.map((x) => x.name) })
    if (st) {
      if (thumb) room.putAsset(st.id, thumb, { owner: true })
      const latest = room.info.settings?.stations || []
      put({ stationKind: 'place', stations: [...latest, st].slice(0, MAX_AUTO_STATIONS) })
      setName('')
      setPhotoUri(null)
      setSuggested(suggestName([...latest, st].map((x) => x.name)))
      setFlash(`${st.name} placed${st.floor ? ` · Floor ${st.floor}` : ''}.`)
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), 3500)
    }
    setBusy(false)
  }

  const full = stations.length >= MAX_AUTO_STATIONS
  const weak = fix && Number.isFinite(fix.acc) && fix.acc > WEAK_ACC_M
  const floorText = noBaro
    ? 'No barometer on this phone — floors are off.'
    : baro.status === 'ready' && finiteAlt(alt)
      ? `${floorLabel(alt)} (${alt >= 0 ? '+' : ''}${alt.toFixed(1)} m)`
      : 'Reading the barometer…'

  return (
    <View style={styles.wrap}>
      <View style={styles.readouts}>
        <View style={styles.readout}>
          <Text style={stType.label}>GPS</Text>
          <Text style={[stType.small, { color: weak ? ST.objective : ST.text }]}>{locErr || (fix ? `±${Math.round(fix.acc ?? 0)} m${weak ? ' · weak (ok indoors)' : ''}` : 'Finding you…')}</Text>
        </View>
        <View style={styles.readout}>
          <Text style={stType.label}>Floor</Text>
          <Text style={[stType.small, { color: noBaro ? ST.objective : ST.text }]}>{floorText}</Text>
        </View>
      </View>
      {!noBaro ? (
        <Pressable onPress={resetFloor} hitSlop={6} accessibilityRole="button" accessibilityLabel="Set the start floor here">
          <Text style={[stType.small, { color: ST.friendly, marginBottom: 8, fontSize: 12 }]}>Start floor = where the game starts. Set it here</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={suggested}
          placeholderTextColor={ST.faint}
          style={styles.input}
          maxLength={40}
          accessibilityLabel="Station name"
        />
        <Pressable onPress={() => setSuggested(suggestName(stations.map((s) => s.name), suggested))} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Suggest another name">
          <Ionicons name="shuffle-outline" size={18} color={ST.friendly} />
        </Pressable>
        <Pressable onPress={photoUri ? () => setPhotoUri(null) : takePhoto} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={photoUri ? 'Remove the photo hint' : 'Add a photo of the spot as a hint'}>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : <Ionicons name="camera-outline" size={18} color={ST.friendly} />}
        </Pressable>
      </View>
      <Text style={[stType.small, { fontSize: 11, marginTop: 4 }]}>Leave the name empty to use “{suggested}”. The photo is optional — a hint for players.</Text>
      {error ? <Text style={[stType.small, { color: ST.objective, marginTop: 6 }]}>{error}</Text> : null}
      {flash ? <Text style={[stType.small, { color: ST.health, marginTop: 6 }]}>{flash}</Text> : null}
      <StButton
        title={full ? `Max ${MAX_AUTO_STATIONS} stations` : busy ? 'Placing…' : 'Place station here'}
        tone="objective"
        height={46}
        disabled={busy || full || !fix}
        left={busy ? <ActivityIndicator color={ST.ink} /> : <Ionicons name="pin-outline" size={18} color={ST.ink} />}
        onPress={place}
        style={{ marginTop: 10 }}
      />
      <Text style={[stType.small, { fontSize: 11, marginTop: 6 }]}>
        Stand right at the spot (a doorway, the fridge, the top of the stairs). Players must come within about 15 m{noBaro ? '' : ' on the same floor'} to start its task.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, padding: 10, borderRadius: ST.radius, borderWidth: 1, borderColor: withAlpha(ST.objective, 0.45), backgroundColor: withAlpha(ST.objective, 0.06) },
  readouts: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  readout: { flex: 1, padding: 8, borderRadius: ST.radius, backgroundColor: ST.cell },
  input: { flex: 1, fontFamily: FONT.uiSemi, fontSize: 15, color: ST.text, backgroundColor: ST.panelStrong, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, paddingHorizontal: 12, paddingVertical: 9 },
  iconBtn: { width: 42, height: 42, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  preview: { width: 42, height: 42 },
})
