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
import { AUTO_MIN_GAP_M, KILL_HOLD_OPTIONS, MAX_AUTO_STATIONS, floorIndex, generateAutoStations, hasPos, holdMsOf, makeQrStations, stationKind } from './engine'
import { distanceMeters, formatDistance } from '../../lib/multiplayer'
import { ST, StButton, StPanel, stType, withAlpha } from '../studio'
import { useT } from '../../i18n'
import B from '../../i18n/strings/besideThem'
import { bt, floorName, stationName } from './text'

export const MIN_STATIONS = 1
export const MAX_STATIONS = MAX_AUTO_STATIONS
const AREA_SIZES = [50, 100, 200, 400]
const COUNTS = [4, 6, 8, 10]
const DEFAULT_COUNT = 6
const INDOOR_ACC_M = 15 // host's GPS worse than this: probably indoors
const HOLD_LABELS = { get 0() { return bt('instant') }, 1000: '1 s', 1500: '1.5 s', 2000: '2 s' }

const MODES = [
  { id: 'auto', get title() { return bt('mode_auto') }, get tag() { return bt('mode_auto_tag') }, icon: 'navigate-outline', get text() { return bt('mode_auto_text') } },
  { id: 'place', get title() { return bt('mode_place') }, get tag() { return bt('mode_place_tag') }, icon: 'footsteps-outline', get text() { return bt('mode_place_text') } },
  { id: 'qr', get title() { return bt('mode_qr') }, get tag() { return bt('mode_qr_tag') }, icon: 'qr-code-outline', get text() { return bt('mode_qr_text') } },
  { id: 'photo', get title() { return bt('mode_photo') }, get tag() { return bt('mode_photo_tag') }, icon: 'camera-outline', get text() { return bt('mode_photo_text') } },
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
  if (mode !== 'qr' && mode !== 'place' && !s.area) return { ok: false, reason: bt('cs_set_area') }
  if (n < MIN_STATIONS) {
    if (mode === 'auto') return { ok: false, reason: bt('cs_placing') }
    if (mode === 'qr') return { ok: false, reason: bt('cs_make_codes') }
    if (mode === 'place') return { ok: false, reason: bt('cs_place_one') }
    return { ok: false, reason: bt('cs_scan_one') }
  }
  return { ok: true }
}

const validStation = (st) =>
  st && typeof st.id === 'string' && Number.isFinite(st.lat) && Number.isFinite(st.lng) && typeof st.name === 'string'

export function BesideSetup({ room, snap }) {
  const t = useT(B)
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
    Alert.alert(t('remove_station_q'), stationName(st), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'),
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
        <Text style={[stType.label, { marginBottom: 6 }]}>{t('where_playing')}</Text>
        <View style={[styles.chips, { marginTop: 0, marginBottom: 10 }]}>
          {[['outdoors', t('outdoors'), 'sunny-outline'], ['indoors', t('indoors'), 'home-outline']].map(([v, label, icon]) => {
            const on = v === 'indoors' ? indoors : !indoors
            return (
              <Pressable
                key={v}
                onPress={isHost ? () => put({ venue: v }) : undefined}
                disabled={!isHost}
                style={[styles.chip, styles.chipRow, on && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !isHost }}
                accessibilityLabel={t(v === 'indoors' ? 'playing_indoors' : 'playing_outdoors')}
              >
                <Ionicons name={icon} size={14} color={on ? ST.ink : ST.text} />
                <Text style={[styles.chipText, { color: on ? ST.ink : ST.text, marginLeft: 5 }]}>{label}</Text>
              </Pressable>
            )
          })}
          {!venue && weakGps ? <Text style={[stType.small, { fontSize: 11, alignSelf: 'center' }]}>{t('gps_looks_indoors', { n: Math.round(hostFix.acc) })}</Text> : null}
        </View>
        <Text style={[stType.label, { marginBottom: 8 }]}>{t('task_stations')}</Text>
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
                  {m.tag}{recommended.includes(m.id) ? ` · ${t('recommended')}` : ''}
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
                {weakGps ? `${t('gps_is_here', { n: Math.round(hostFix.acc) })} ` : ''}{t('indoor_hint')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <StButton title={t('use_qr')} tone="objective" height={32} onPress={() => setMode('qr')} style={{ paddingHorizontal: 10 }} />
                <StButton title={t('mode_place')} tone="outline" color={ST.objective} height={32} onPress={() => setMode('place')} style={{ paddingHorizontal: 10 }} />
              </View>
            </View>
          </View>
        ) : null}
      </StPanel>

      <StPanel accent={ST.enemy} style={styles.panel}>
        <Text style={[stType.label, { marginBottom: 6 }]}>{t('elimination')}</Text>
        <View style={[styles.chips, { marginTop: 0 }]}>
          {KILL_HOLD_OPTIONS.map((ms) => (
            <Pressable
              key={ms}
              onPress={isHost ? () => put({ killHoldMs: ms }) : undefined}
              disabled={!isHost}
              style={[styles.chip, holdMs === ms && styles.chipOn, !isHost && holdMs !== ms && { opacity: 0.45 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: holdMs === ms, disabled: !isHost }}
              accessibilityLabel={ms ? t('hold_x_eliminate', { s: HOLD_LABELS[ms] }) : t('instant_elimination')}
            >
              <Text style={[styles.chipText, { color: holdMs === ms ? ST.ink : ST.text }]}>{HOLD_LABELS[ms]}{ms === 1500 ? ' ★' : ''}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[stType.small, { marginTop: 8 }]}>
          {holdMs ? t('hold_explain', { s: HOLD_LABELS[holdMs] }) : t('instant_explain')}
        </Text>
      </StPanel>

      {!areaOptional || isHost ? (
        <StPanel accent={ST.friendly} style={styles.panel}>
          <Text style={[stType.label, { marginBottom: 6 }]}>{areaOptional ? t('play_area_optional') : t('play_area')}</Text>
          <GameMap
            center={area}
            onPick={isHost ? setArea : undefined}
            hint={isHost ? (area ? t('tap_move_center') : t('tap_set_center')) : null}
            circles={area ? [{ id: 'area', lat: area.lat, lng: area.lng, radius: area.r, color: ST.friendly }] : []}
            markers={mapStations.map((st, i) => ({ id: st.id, lat: st.lat, lng: st.lng, label: `${st.no || i + 1}. ${stationName(st)}`, color: ST.objective }))}
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
            {area ? t('area_inside') : isHost ? t('area_choose') : t('area_host_choosing')}
          </Text>
          {tooSmall ? <Text style={[stType.small, { marginTop: 4, color: ST.objective }]}>{t('small_area')}</Text> : null}
        </StPanel>
      ) : null}

      <StPanel accent={ST.objective} style={styles.panel}>
        <View style={styles.headRow}>
          <Text style={stType.label}>{mode === 'qr' ? t('station_codes') : t('stations')} · {stations.length}{mode === 'photo' || mode === 'place' ? `/${MAX_STATIONS}` : ''}</Text>
          <Text style={[stType.label, { color: stations.length >= MIN_STATIONS ? ST.health : ST.objective }]}>
            {placing ? t('snapping') : stations.length >= MIN_STATIONS ? t('ready_word') : mode === 'photo' ? t('scan_one_more') : mode === 'place' ? t('place_one_more') : '—'}
          </Text>
        </View>

        {isHost && (mode === 'auto' || mode === 'qr') ? (
          <View style={[styles.chips, { marginTop: 0, marginBottom: 8 }]}>
            {COUNTS.map((n) => (
              <Pressable key={n} onPress={() => setCount(n)} style={[styles.chip, count === n && styles.chipOn]} accessibilityRole="button" accessibilityLabel={t('n_stations', { n })} accessibilityState={{ selected: count === n }}>
                <Text style={[styles.chipText, { color: count === n ? ST.ink : ST.text }]}>{n}</Text>
              </Pressable>
            ))}
            {mode === 'auto' && area ? (
              <Pressable onPress={() => placeAuto(area, count)} style={styles.chip} accessibilityRole="button" accessibilityLabel={t('shuffle_a11y')}>
                <Text style={[styles.chipText, { color: ST.friendly }]}>{t('shuffle')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {stations.length === 0 && (
          <Text style={stType.small}>
            {mode === 'auto'
              ? (area ? t('placing_stations') : isHost ? t('set_area_first_hint') : t('host_setting_up'))
              : mode === 'qr'
                ? (isHost ? t('pick_codes') : t('host_making_codes'))
                : mode === 'place'
                  ? (isHost ? t('place_hint') : t('host_placing'))
                : canScan ? t('scan_hint') : t('host_scanning')}
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
                <Text style={[stType.name, { fontSize: 15 }]} numberOfLines={1}>{st.no || i + 1}. {stationName(st)}</Text>
                <Text style={[stType.small, { fontSize: 11 }]}>
                  {k === 'qr' ? t('code_x', { code: st.code })
                    : k === 'place' ? [floorName(floorIndex(st.alt)) || t('floor_unknown'), Number.isFinite(st.acc) ? `GPS ±${st.acc} m` : null, st.photo || st.url ? t('photo_hint') : null].filter(Boolean).join(' · ')
                      : area && hasPos(st) ? t('from_center', { d: formatDistance(distanceMeters(area, st)) }) : ''}
                  {k === 'photo' && !st.url ? ` · ${t('shared_from_phone')}` : ''}
                </Text>
              </View>
              {((k === 'photo' && (isHost || st.by === snap.me.id)) || (k === 'place' && isHost)) && (
                <Pressable onPress={() => remove(st)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('remove_x', { name: stationName(st) })}>
                  <Ionicons name="trash-outline" size={18} color={ST.enemy} />
                </Pressable>
              )}
            </View>
          )
        })}
        {mode === 'qr' && isHost && stations.length ? (
          <StButton
            title={t('show_print_codes')}
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
            title={t('scan_a_station')}
            tone="objective"
            height={46}
            left={<Ionicons name="camera-outline" size={18} color={ST.ink} />}
            onPress={() => (area ? setScanning(true) : Alert.alert(t('set_area_first'), t('stations_inside_area')))}
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
