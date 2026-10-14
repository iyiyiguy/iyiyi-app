// Lobby setup for Beside Them: the play area (center + radius on a map) and how task
// stations are made. The host picks one of four station modes (settings.stationKind):
//   auto  (default) – the host's phone drops N GPS waypoints with fun names inside the
//                     area, spread out and preferring paths/sidewalks. Zero setup.
//   place           – "Walk & place": the host walks the house / venue and taps "Place
//                     station here" at each spot (GPS + barometer floor; ./PlaceStations).
//   qr              – N printable / on-screen QR markers for indoors and small areas.
//   photo           – the original flow: photograph real objects (now optional; 1+).
// Stations still live in settings.stations (fields only added: kind, icon, toy, no, code,
// acc, alt, floor, photo), so older app versions keep reading them. Also here: where the
// game is played (settings.venue, steers the recommendation) and the elimination hold
// (settings.killHoldMs).
import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { GameMap } from '../GameMap'
import { StationImage } from './StationImage'
import { StationScanner } from './StationScanner'
import { QrCodesSheet } from './QrCodes'
import { Toy } from './toys'
import { fetchWalkablePoints } from './walkable'
import { PlacePanel } from './PlaceStations'
import { AUTO_MIN_GAP_M, KILL_HOLD_OPTIONS, MAX_AUTO_STATIONS, floorLabel, generateAutoStations, hasPos, holdMsOf, makeQrStations, stationKind } from './engine'
import { distanceMeters, formatDistance } from '../../lib/multiplayer'
import { ST, StButton, StPanel, stType, withAlpha } from '../studio'

export const MIN_STATIONS = 1
export const MAX_STATIONS = MAX_AUTO_STATIONS
const AREA_SIZES = [50, 100, 200, 400]
const COUNTS = [4, 6, 8, 10]
const DEFAULT_COUNT = 6
const INDOOR_ACC_M = 15 // host's GPS worse than this: probably indoors
const HOLD_LABELS = { 0: 'Instant', 1000: '1 s', 1500: '1.5 s', 2000: '2 s' }

const MODES = [
  { id: 'auto', title: 'Auto GPS', tag: 'Outdoors · no setup', icon: 'navigate-outline', text: 'Stations with silly names appear around your circle. Walk there and the task opens. Needs open sky — GPS is poor indoors.' },
  { id: 'place', title: 'Walk & place', tag: 'Indoors · multiple floors', icon: 'footsteps-outline', text: 'Walk around the house or venue and tap “Place station here” at each spot. Uses GPS plus the barometer, so a station upstairs only opens upstairs.' },
  { id: 'qr', title: 'QR markers', tag: 'Most precise · any floor', icon: 'qr-code-outline', text: 'Print or show a code for each station and tape them up. Scanning the code starts the task — works indoors and on every floor.' },
  { id: 'photo', title: 'Photo stations', tag: 'Scan an object', icon: 'camera-outline', text: 'Photograph real objects (a bench, a door, a sign). Players find the object and match the photo. Uses GPS.' },
]
const MODE_IDS = MODES.map((m) => m.id)

/** Effective station mode. Lobbies from older versions have photo stations and no kind. */
export function stationModeOf(settings) {
  const s = settings || {}
  if (MODE_IDS.includes(s.stationKind)) return s.stationKind
  const list = s.stations || []
  return list.length && list.every((st) => stationKind(st) === 'photo') ? 'photo' : 'auto'
}

export function besideCanStart(info) {
  const s = info.settings || {}
  const mode = stationModeOf(s)
  const n = (s.stations || []).length
  if (mode !== 'qr' && mode !== 'place' && !s.area) return { ok: false, reason: 'Set the play area on the map.' }
  if (n < MIN_STATIONS) {
    if (mode === 'auto') return { ok: false, reason: 'Placing task stations…' }
    if (mode === 'qr') return { ok: false, reason: 'Make the station codes first.' }
    if (mode === 'place') return { ok: false, reason: 'Walk around and place at least one station.' }
    return { ok: false, reason: 'Scan at least one task station (5–10 is best).' }
  }
  return { ok: true }
}

const validStation = (st) =>
  st && typeof st.id === 'string' && Number.isFinite(st.lat) && Number.isFinite(st.lng) && typeof st.name === 'string'

export function BesideSetup({ room, snap }) {
  const info = snap.info
  const s = info.settings || {}
  const isHost = snap.isHost
  const mode = stationModeOf(s)
  const canScan = mode === 'photo' && (isHost || s.stationMode === 'all')
  const area = s.area || null
  const stations = s.stations || []
  const count = COUNTS.includes(s.stationCount) ? s.stationCount : DEFAULT_COUNT
  const [scanning, setScanning] = useState(false)
  const [showCodes, setShowCodes] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [hostFix, setHostFix] = useState(null) // { lat, lng, acc }
  const genNo = useRef(0)

  // Host accepts stations scanned by other players (photo mode only).
  useEffect(() => {
    if (!isHost) return undefined
    return room.onRequest((kind, data, from) => {
      const cur = room.info.settings || {}
      const list = cur.stations || []
      if (kind === 'station_add') {
        const st = data?.station
        if (stationModeOf(cur) !== 'photo' || cur.stationMode !== 'all' || !validStation(st) || list.length >= MAX_STATIONS) return
        room.setInfo({ settings: { ...cur, stations: [...list, { ...st, name: st.name.slice(0, 40), by: from, url: typeof st.url === 'string' ? st.url : null }] } })
      }
      if (kind === 'station_remove' && list.some((x) => x.id === data?.id && x.by === from)) {
        room.setInfo({ settings: { ...cur, stations: list.filter((x) => x.id !== data.id) } })
      }
    })
  }, [room, isHost])

  // Host's own fix: keeps auto stations off the start and hints "indoors? use QR".
  useEffect(() => {
    if (!isHost) return undefined
    let alive = true
    ;(async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (!perm?.granted) return
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        if (alive && pos) setHostFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? null })
      } catch { /* optional */ }
    })()
    return () => { alive = false }
  }, [isHost])

  const put = (patch) => room.setInfo({ settings: { ...(room.info.settings || {}), ...patch } })

  // Auto stations: random points straight away (never blocks the start), then re-placed on
  // walkable paths when the map query answers.
  const placeAuto = async (a, n) => {
    if (!isHost || !a) return
    const my = ++genNo.current
    const start = hostFix && hasPos(hostFix) ? hostFix : null
    put({ stationKind: 'auto', stationCount: n, stations: generateAutoStations(a, n, { start }) })
    setPlacing(true)
    const pts = await fetchWalkablePoints(a)
    if (my !== genNo.current) return
    setPlacing(false)
    const cur = room.info.settings || {}
    if (stationModeOf(cur) !== 'auto' || !cur.area || cur.area.lat !== a.lat || cur.area.lng !== a.lng || cur.area.r !== a.r) return
    if (pts.length >= n * 3) put({ stations: generateAutoStations(a, n, { start, candidates: pts }) })
  }

  const setArea = (coord) => {
    if (!isHost) return
    const next = { lat: coord.lat, lng: coord.lng, r: area?.r || 100 }
    put({ area: next })
    if (mode === 'auto') placeAuto(next, count)
  }
  const setRadius = (r) => {
    if (!isHost || !area) return
    const next = { ...area, r }
    put({ area: next })
    if (mode === 'auto') placeAuto(next, count)
  }
  const setCount = (n) => {
    if (!isHost) return
    if (mode === 'auto') { if (area) placeAuto(area, n); else put({ stationCount: n }) }
    else if (mode === 'qr') put({ stationCount: n, stations: makeQrStations(n) })
  }

  const setMode = (m) => {
    if (!isHost || m === mode) return
    genNo.current += 1
    setPlacing(false)
    const cur = room.info.settings || {}
    // Keep photo and walk & place stations aside so switching back doesn't lose them.
    const photoStash = mode === 'photo' ? (cur.stations || []) : (cur.photoStations || [])
    const placeStash = mode === 'place' ? (cur.stations || []) : (cur.placeStations || [])
    const stash = { photoStations: m === 'photo' ? [] : photoStash, placeStations: m === 'place' ? [] : placeStash }
    if (m === 'photo') { put({ stationKind: 'photo', stations: photoStash, ...stash }); return }
    if (m === 'place') { put({ stationKind: 'place', stations: placeStash, ...stash }); return }
    if (m === 'qr') { put({ stationKind: 'qr', stationCount: count, stations: makeQrStations(count), ...stash }); return }
    put({ stationKind: 'auto', stations: [], ...stash })
    if (cur.area) placeAuto(cur.area, count)
  }

  // A fresh lobby in auto mode with an area but no stations (e.g. the area came from an
  // older client): place them once.
  useEffect(() => {
    if (isHost && mode === 'auto' && area && stations.length === 0 && !placing) placeAuto(area, count)
  }, [isHost, mode, area?.lat, area?.lng, area?.r]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = ({ station, thumb }) => {
    room.putAsset(station.id, thumb, { owner: true })
    if (isHost) {
      const cur = room.info.settings || {}
      room.setInfo({ settings: { ...cur, stationKind: 'photo', stations: [...(cur.stations || []), { ...station, kind: 'photo' }].slice(0, MAX_STATIONS) } })
    } else {
      room.request('station_add', { station })
    }
  }

  const remove = (st) => {
    Alert.alert('Remove station?', st.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          if (isHost) room.setInfo({ settings: { ...s, stations: stations.filter((x) => x.id !== st.id) } })
          else room.request('station_remove', { id: st.id })
        },
      },
    ])
  }

  // Indoors (the host says so, or the host's GPS is weak): recommend QR or walk & place.
  const venue = s.venue === 'indoors' || s.venue === 'outdoors' ? s.venue : null
  const weakGps = Number.isFinite(hostFix?.acc) && hostFix.acc > INDOOR_ACC_M
  const indoors = venue === 'indoors' || (venue !== 'outdoors' && weakGps)
  const recommended = indoors ? ['qr', 'place'] : ['auto']
  const indoorHint = isHost && indoors && (mode === 'auto' || mode === 'photo')
  const tooSmall = mode === 'auto' && area && area.r < AUTO_MIN_GAP_M * 2
  const mapStations = stations.filter(hasPos)
  const holdMs = holdMsOf(s.killHoldMs)
  const areaOptional = mode === 'qr' || mode === 'place'

  return (
    <>
      <StPanel accent={ST.objective} style={styles.panel}>
        <Text style={[stType.label, { marginBottom: 6 }]}>Where are you playing?</Text>
        <View style={[styles.chips, { marginTop: 0, marginBottom: 10 }]}>
          {[['outdoors', 'Outdoors', 'sunny-outline'], ['indoors', 'Indoors', 'home-outline']].map(([v, label, icon]) => {
            const on = v === 'indoors' ? indoors : !indoors
            return (
              <Pressable
                key={v}
                onPress={isHost ? () => put({ venue: v }) : undefined}
                disabled={!isHost}
                style={[styles.chip, styles.chipRow, on && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !isHost }}
                accessibilityLabel={`Playing ${label.toLowerCase()}`}
              >
                <Ionicons name={icon} size={14} color={on ? ST.ink : ST.text} />
                <Text style={[styles.chipText, { color: on ? ST.ink : ST.text, marginLeft: 5 }]}>{label}</Text>
              </Pressable>
            )
          })}
          {!venue && weakGps ? <Text style={[stType.small, { fontSize: 11, alignSelf: 'center' }]}>GPS ±{Math.round(hostFix.acc)} m — looks indoors</Text> : null}
        </View>
        <Text style={[stType.label, { marginBottom: 8 }]}>Task stations</Text>
        {MODES.map((m) => {
          const on = mode === m.id
          return (
            <Pressable
              key={m.id}
              onPress={isHost ? () => setMode(m.id) : undefined}
              disabled={!isHost}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !isHost }}
              accessibilityLabel={`${m.title}. ${m.text}`}
              style={[styles.mode, on ? styles.modeOn : null, !isHost && !on ? { opacity: 0.45 } : null]}
            >
              <View style={[styles.radio, on ? styles.radioOn : null]} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={m.icon} size={15} color={on ? ST.friendly : ST.muted} />
                  <Text style={[stType.name, { fontSize: 15 }]}>{m.title}</Text>
                </View>
                <Text style={[stType.label, { fontSize: 10, color: on ? ST.friendly : ST.faint, marginTop: 1 }]}>
                  {m.tag}{recommended.includes(m.id) ? ' · recommended' : ''}
                </Text>
                {on ? <Text style={[stType.small, { fontSize: 12, marginTop: 3 }]}>{m.text}</Text> : null}
              </View>
            </Pressable>
          )
        })}
        {indoorHint ? (
          <View style={styles.hint}>
            <Ionicons name="business-outline" size={16} color={ST.objective} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[stType.small, { color: ST.text }]}>
                {weakGps ? `GPS is ±${Math.round(hostFix.acc)} m here. ` : ''}Indoors, GPS can’t tell rooms or floors apart. QR markers are the most reliable and work on every floor; Walk & place uses the barometer for floors.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <StButton title="Use QR" tone="objective" height={32} onPress={() => setMode('qr')} style={{ paddingHorizontal: 10 }} />
                <StButton title="Walk & place" tone="outline" color={ST.objective} height={32} onPress={() => setMode('place')} style={{ paddingHorizontal: 10 }} />
              </View>
            </View>
          </View>
        ) : null}
      </StPanel>

      <StPanel accent={ST.enemy} style={styles.panel}>
        <Text style={[stType.label, { marginBottom: 6 }]}>Elimination</Text>
        <View style={[styles.chips, { marginTop: 0 }]}>
          {KILL_HOLD_OPTIONS.map((ms) => (
            <Pressable
              key={ms}
              onPress={isHost ? () => put({ killHoldMs: ms }) : undefined}
              disabled={!isHost}
              style={[styles.chip, holdMs === ms && styles.chipOn, !isHost && holdMs !== ms && { opacity: 0.45 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: holdMs === ms, disabled: !isHost }}
              accessibilityLabel={ms ? `Hold ${HOLD_LABELS[ms]} to eliminate` : 'Instant elimination'}
            >
              <Text style={[styles.chipText, { color: holdMs === ms ? ST.ink : ST.text }]}>{HOLD_LABELS[ms]}{ms === 1500 ? ' ★' : ''}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[stType.small, { marginTop: 8 }]}>
          {holdMs ? `The imposter holds on someone for ${HOLD_LABELS[holdMs]} within arm’s reach — enough for a sharp crewmate to notice.` : 'One tap — still only within arm’s reach, with a good signal and on the same floor.'}
        </Text>
      </StPanel>

      {!areaOptional || isHost ? (
        <StPanel accent={ST.friendly} style={styles.panel}>
          <Text style={[stType.label, { marginBottom: 6 }]}>Play area{areaOptional ? ' (optional)' : ''}</Text>
          <GameMap
            center={area}
            onPick={isHost ? setArea : undefined}
            hint={isHost ? (area ? 'Tap to move the center' : 'Tap the map to set the center') : null}
            circles={area ? [{ id: 'area', lat: area.lat, lng: area.lng, radius: area.r, color: ST.friendly }] : []}
            markers={mapStations.map((st, i) => ({ id: st.id, lat: st.lat, lng: st.lng, label: `${st.no || i + 1}. ${st.name}`, color: ST.objective }))}
          />
          {isHost && area && (
            <View style={styles.chips}>
              {AREA_SIZES.map((r) => (
                <Pressable key={r} onPress={() => setRadius(r)} style={[styles.chip, area.r === r && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: area.r === r }}>
                  <Text style={[styles.chipText, { color: area.r === r ? ST.ink : ST.text }]}>{formatDistance(r)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[stType.small, { marginTop: 8 }]}>
            {area ? 'Everyone plays inside this circle. Keep it somewhere safe and walkable.' : isHost ? 'Choose where the game is played.' : 'The host is choosing the play area.'}
          </Text>
          {tooSmall ? <Text style={[stType.small, { marginTop: 4, color: ST.objective }]}>Small area: GPS stations will sit close together. QR markers work better here.</Text> : null}
        </StPanel>
      ) : null}

      <StPanel accent={ST.objective} style={styles.panel}>
        <View style={styles.headRow}>
          <Text style={stType.label}>{mode === 'qr' ? 'Station codes' : 'Stations'} · {stations.length}{mode === 'photo' || mode === 'place' ? `/${MAX_STATIONS}` : ''}</Text>
          <Text style={[stType.label, { color: stations.length >= MIN_STATIONS ? ST.health : ST.objective }]}>
            {placing ? 'Snapping to paths…' : stations.length >= MIN_STATIONS ? 'Ready' : mode === 'photo' ? 'Scan one or more' : mode === 'place' ? 'Place one or more' : '—'}
          </Text>
        </View>

        {isHost && (mode === 'auto' || mode === 'qr') ? (
          <View style={[styles.chips, { marginTop: 0, marginBottom: 8 }]}>
            {COUNTS.map((n) => (
              <Pressable key={n} onPress={() => setCount(n)} style={[styles.chip, count === n && styles.chipOn]} accessibilityRole="button" accessibilityLabel={`${n} stations`} accessibilityState={{ selected: count === n }}>
                <Text style={[styles.chipText, { color: count === n ? ST.ink : ST.text }]}>{n}</Text>
              </Pressable>
            ))}
            {mode === 'auto' && area ? (
              <Pressable onPress={() => placeAuto(area, count)} style={styles.chip} accessibilityRole="button" accessibilityLabel="Shuffle station spots">
                <Text style={[styles.chipText, { color: ST.friendly }]}>Shuffle</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {stations.length === 0 && (
          <Text style={stType.small}>
            {mode === 'auto'
              ? (area ? 'Placing stations…' : isHost ? 'Set the play area and stations appear on the map.' : 'The host is setting up stations.')
              : mode === 'qr'
                ? (isHost ? 'Pick how many codes to make.' : 'The host is making station codes.')
                : mode === 'place'
                  ? (isHost ? 'Walk to each spot and tap “Place station here”. 5–10 spread over the rooms (and floors) works best.' : 'The host is walking around placing stations.')
                : canScan ? 'Walk to real objects inside the play area and scan them. 5–10 stations spread around works best.' : 'The host is scanning task stations.'}
          </Text>
        )}
        {stations.map((st, i) => {
          const k = stationKind(st)
          return (
            <View key={st.id} style={styles.station}>
              {k === 'photo' || (k === 'place' && (st.photo || st.url))
                ? <StationImage room={room} station={st} assets={snap.assets} style={styles.thumb} />
                : <View style={[styles.thumb, styles.toyBox]}>{st.toy ? <Toy kind={st.toy} size={38} /> : <Ionicons name={st.icon || 'flag-outline'} size={20} color={ST.objective} />}</View>}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[stType.name, { fontSize: 15 }]} numberOfLines={1}>{st.no || i + 1}. {st.name}</Text>
                <Text style={[stType.small, { fontSize: 11 }]}>
                  {k === 'qr' ? `Code ${st.code}`
                    : k === 'place' ? [floorLabel(st.alt) || 'Floor ?', Number.isFinite(st.acc) ? `GPS ±${st.acc} m` : null, st.photo || st.url ? 'photo hint' : null].filter(Boolean).join(' · ')
                      : area && hasPos(st) ? `${formatDistance(distanceMeters(area, st))} from center` : ''}
                  {k === 'photo' && !st.url ? ' · shared from phone' : ''}
                </Text>
              </View>
              {((k === 'photo' && (isHost || st.by === snap.me.id)) || (k === 'place' && isHost)) && (
                <Pressable onPress={() => remove(st)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${st.name}`}>
                  <Ionicons name="trash-outline" size={18} color={ST.enemy} />
                </Pressable>
              )}
            </View>
          )
        })}
        {mode === 'qr' && isHost && stations.length ? (
          <StButton
            title="Show / print codes"
            tone="objective"
            height={46}
            left={<Ionicons name="qr-code-outline" size={18} color={ST.ink} />}
            onPress={() => setShowCodes(true)}
            style={{ marginTop: 10 }}
          />
        ) : null}
        {mode === 'place' && isHost ? <PlacePanel room={room} stations={stations} meId={snap.me.id} /> : null}
        {canScan && stations.length < MAX_STATIONS && (
          <StButton
            title="Scan a station"
            tone="objective"
            height={46}
            left={<Ionicons name="camera-outline" size={18} color={ST.ink} />}
            onPress={() => (area ? setScanning(true) : Alert.alert('Set the play area first', 'Stations need to be inside the play area.'))}
            style={{ marginTop: 10 }}
          />
        )}
      </StPanel>

      <StationScanner visible={scanning} onClose={() => setScanning(false)} onSave={save} area={area} meId={snap.me.id} />
      {isHost ? <QrCodesSheet visible={showCodes} onClose={() => setShowCodes(false)} stations={mode === 'qr' ? stations : []} /> : null}
    </>
  )
}

const styles = StyleSheet.create({
  panel: { marginBottom: 12, backgroundColor: ST.panelStrong },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, backgroundColor: withAlpha('#ffffff', 0.04) },
  chipOn: { backgroundColor: ST.friendly, borderColor: ST.friendly },
  chipRow: { flexDirection: 'row', alignItems: 'center' },
  chipText: { ...stType.label, fontSize: 12, letterSpacing: 1.2 },
  mode: { flexDirection: 'row', alignItems: 'flex-start', padding: 10, marginBottom: 6, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line, backgroundColor: ST.cell },
  modeOn: { borderColor: ST.friendly, backgroundColor: withAlpha(ST.friendly, 0.1) },
  radio: { width: 14, height: 14, marginTop: 3, transform: [{ rotate: '45deg' }], borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  radioOn: { backgroundColor: ST.friendly, borderColor: ST.friendly },
  hint: { flexDirection: 'row', alignItems: 'center', padding: 10, marginTop: 4, borderRadius: ST.radius, borderWidth: 1, borderColor: withAlpha(ST.objective, 0.5), backgroundColor: withAlpha(ST.objective, 0.08) },
  station: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, marginVertical: 2, backgroundColor: ST.cell, borderRadius: ST.radius },
  thumb: { width: 48, height: 48 },
  toyBox: { borderRadius: ST.radius, backgroundColor: withAlpha('#7ce7ff', 0.1), alignItems: 'center', justifyContent: 'center' },
})
