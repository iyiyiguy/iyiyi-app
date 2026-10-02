// Lobby setup for Beside Them: the play area (center + radius on a map) and
// task stations scanned from real objects inside it.
import React, { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Btn, Card } from '../MultiplayerUI'
import { GameMap } from '../GameMap'
import { StationImage } from './StationImage'
import { StationScanner } from './StationScanner'
import { distanceMeters, formatDistance } from '../../lib/multiplayer'
import { colors, radii, type } from '../../theme'

export const MIN_STATIONS = 3
export const MAX_STATIONS = 10
const AREA_SIZES = [50, 100, 200, 400]

export function besideCanStart(info) {
  const s = info.settings || {}
  if (!s.area) return { ok: false, reason: 'Set the play area on the map.' }
  if ((s.stations || []).length < MIN_STATIONS) return { ok: false, reason: `Scan at least ${MIN_STATIONS} task stations (5–10 is best).` }
  return { ok: true }
}

const validStation = (st) =>
  st && typeof st.id === 'string' && Number.isFinite(st.lat) && Number.isFinite(st.lng) && typeof st.name === 'string'

export function BesideSetup({ room, snap }) {
  const info = snap.info
  const s = info.settings || {}
  const isHost = snap.isHost
  const canScan = isHost || s.stationMode === 'all'
  const area = s.area || null
  const stations = s.stations || []
  const [scanning, setScanning] = useState(false)

  // Host accepts stations scanned by other players.
  useEffect(() => {
    if (!isHost) return undefined
    return room.onRequest((kind, data, from) => {
      const cur = room.info.settings || {}
      const list = cur.stations || []
      if (kind === 'station_add') {
        const st = data?.station
        if (cur.stationMode !== 'all' || !validStation(st) || list.length >= MAX_STATIONS) return
        room.setInfo({ settings: { ...cur, stations: [...list, { ...st, name: st.name.slice(0, 40), by: from, url: typeof st.url === 'string' ? st.url : null }] } })
      }
      if (kind === 'station_remove' && list.some((x) => x.id === data?.id && x.by === from)) {
        room.setInfo({ settings: { ...cur, stations: list.filter((x) => x.id !== data.id) } })
      }
    })
  }, [room, isHost])

  const setArea = (coord) => {
    if (!isHost) return
    room.setInfo({ settings: { ...s, area: { lat: coord.lat, lng: coord.lng, r: area?.r || 100 } } })
  }
  const setRadius = (r) => isHost && area && room.setInfo({ settings: { ...s, area: { ...area, r } } })

  const save = ({ station, thumb }) => {
    room.putAsset(station.id, thumb, { owner: true })
    if (isHost) {
      const cur = room.info.settings || {}
      room.setInfo({ settings: { ...cur, stations: [...(cur.stations || []), station].slice(0, MAX_STATIONS) } })
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

  return (
    <>
      <Card>
        <Text style={[type.label, { marginBottom: 6 }]}>Play area</Text>
        <GameMap
          center={area}
          onPick={isHost ? setArea : undefined}
          hint={isHost ? (area ? 'Tap to move the center' : 'Tap the map to set the center') : null}
          circles={area ? [{ id: 'area', lat: area.lat, lng: area.lng, radius: area.r, color: colors.violet }] : []}
          markers={stations.map((st, i) => ({ id: st.id, lat: st.lat, lng: st.lng, label: `${i + 1}. ${st.name}`, color: colors.magenta }))}
        />
        {isHost && area && (
          <View style={styles.chips}>
            {AREA_SIZES.map((r) => (
              <Pressable key={r} onPress={() => setRadius(r)} style={[styles.chip, area.r === r && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: area.r === r }}>
                <Text style={[type.caption, { color: area.r === r ? colors.onBrand : colors.text }]}>{formatDistance(r)}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={[type.caption, { marginTop: 8 }]}>
          {area ? 'Everyone plays inside this circle. Keep it somewhere safe and walkable.' : isHost ? 'Choose where the game is played.' : 'The host is choosing the play area.'}
        </Text>
      </Card>

      <Card>
        <View style={styles.headRow}>
          <Text style={type.label}>Task stations ({stations.length}/{MAX_STATIONS})</Text>
        </View>
        {stations.length === 0 && (
          <Text style={type.caption}>
            {canScan ? 'Walk to real objects inside the play area and scan them. 5–10 stations spread around works best.' : 'The host is scanning task stations.'}
          </Text>
        )}
        {stations.map((st, i) => (
          <View key={st.id} style={styles.station}>
            <StationImage room={room} station={st} assets={snap.assets} style={styles.thumb} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={type.body} numberOfLines={1}>{i + 1}. {st.name}</Text>
              <Text style={type.caption}>
                {area ? `${formatDistance(distanceMeters(area, st))} from center` : ''}{st.url ? '' : ' · shared from phone'}
              </Text>
            </View>
            {(isHost || st.by === snap.me.id) && (
              <Pressable onPress={() => remove(st)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${st.name}`}>
                <Text style={[type.caption, { color: colors.danger }]}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
        {canScan && stations.length < MAX_STATIONS && (
          <Btn title="📷  Scan a station" onPress={() => (area ? setScanning(true) : Alert.alert('Set the play area first', 'Stations need to be inside the play area.'))} style={{ marginTop: 10 }} />
        )}
      </Card>

      <StationScanner visible={scanning} onClose={() => setScanning(false)} onSave={save} area={area} meId={snap.me.id} />
    </>
  )
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  station: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  thumb: { width: 48, height: 48 },
})
