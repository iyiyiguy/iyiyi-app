// Battle Royale lobby (shown inside the game screen while the room is in its lobby phase):
// join code + share + invites, Public/Private, the starting area on the real map (1, 2, 3
// or 5 mile radius around the host or a tapped point), gas pace, the roster (up to 100)
// and Start.
import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../../components/Glass'
import InvitePeopleSheet from '../../components/InvitePeopleSheet'
import { GameMap } from '../GameMap'
import { Avatar } from '../MultiplayerUI'
import {
  AC, ArcadeBackground, Chip, GhostButton, IconCircle, PlayButton, SectionHeader, StatusBarScrim, arcadeText, useArcadeInsets,
} from '../arcadeUI'
import { useNavigation } from '@react-navigation/native'
import { UavBalancePill, openArcadeStore } from '../UavStore'
import { useUavInventory } from '../../lib/uav'
import { MP_GAMES, howToPlay } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import { font } from '../../theme'
import { DEFAULT_AREA_ID, PACE, ROYALE_AREAS, areaRadius } from './constants'
import { isValidCoord } from './geo'
import { RoyaleCover } from './RoyaleCover'

const MAX_AVATARS = 40

export function RoyaleLobby({ room, snap, onExit }) {
  const insets = useArcadeInsets()
  const navigation = useNavigation()
  const uavInv = useUavInventory()
  const info = snap?.info || {}
  const settings = info.settings || {}
  const isHost = !!snap?.isHost
  const roster = Array.isArray(snap?.roster) ? snap.roster : []
  const max = MP_GAMES.royale?.maxPlayers || 100
  const areaId = ROYALE_AREAS[settings.areaId] ? settings.areaId : DEFAULT_AREA_ID
  const area = settings.area && isValidCoord(settings.area.lat, settings.area.lng) ? settings.area : null
  const visibility = settings.visibility === 'private' ? 'private' : 'public'
  const pace = PACE[settings.pace] ? settings.pace : 'normal'
  const [inviteOpen, setInviteOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  const [locState, setLocState] = useState('pending') // pending | ok | error

  const patch = (p) => {
    try { room.setInfo({ settings: { ...(room.info.settings || {}), ...p } }) } catch { /* not host */ }
  }

  // Host: start the area at their location, and advertise a coarse location for discovery.
  useEffect(() => {
    if (!isHost) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted') { if (!cancelled) setLocState('error'); return }
        const last = await Location.getLastKnownPositionAsync().catch(() => null)
        const pos = last || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
        const lat = pos?.coords?.latitude
        const lng = pos?.coords?.longitude
        if (cancelled || !isValidCoord(lat, lng)) return
        setLocState('ok')
        try { room.setAdvertLocation({ lat, lng }) } catch { /* ignore */ }
        if (!room.info.settings?.area) {
          const id = ROYALE_AREAS[room.info.settings?.areaId] ? room.info.settings.areaId : DEFAULT_AREA_ID
          patch({ areaId: id, area: { preset: id, lat, lng, r: areaRadius(id) } })
        }
      } catch {
        if (!cancelled) setLocState('error')
      }
    })()
    return () => { cancelled = true }
  }, [isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  const useMyLocation = async () => {
    buzz('select')
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const lat = pos?.coords?.latitude
      const lng = pos?.coords?.longitude
      if (isValidCoord(lat, lng)) patch({ area: { preset: areaId, lat, lng, r: areaRadius(areaId) } })
    } catch {
      Alert.alert('Location unavailable', 'Turn on location, or tap the map to set the centre.')
    }
  }

  const pickCenter = (c) => {
    if (!isHost || !isValidCoord(c?.lat, c?.lng)) return
    buzz('light')
    patch({ area: { preset: areaId, lat: c.lat, lng: c.lng, r: areaRadius(areaId) } })
  }

  const setArea = (id) => {
    if (!isHost || !ROYALE_AREAS[id]) return
    buzz('select')
    patch({ areaId: id, area: area ? { ...area, preset: id, r: areaRadius(id) } : undefined })
  }

  const share = async () => {
    try {
      await Share.share({ message: `Join my Battle Royale on iYiYi — open Arcade › Laser Tag › Join with a code and enter ${room.code}` })
    } catch { /* dismissed */ }
  }

  const start = () => {
    if (!isHost) return
    const min = MP_GAMES.royale?.minPlayers || 2
    if (roster.length < min) {
      Alert.alert('Not enough players', `Battle Royale needs at least ${min} players. Invite someone to join.`)
      return
    }
    buzz('heavy')
    if (!area) {
      Alert.alert('Starting area', 'No centre is set yet, so the zone will start around your current location.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => room.setInfo({ phase: 'playing', round: (room.info.round || 0) + 1, startedAt: Date.now() }) },
      ])
      return
    }
    room.setInfo({ phase: 'playing', round: (room.info.round || 0) + 1, startedAt: Date.now() })
  }

  const circles = useMemo(
    () => (area ? [{ id: 'zone', lat: area.lat, lng: area.lng, radius: areaRadius(areaId), color: '#ff8a00' }] : []),
    [area?.lat, area?.lng, areaId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const shown = roster.slice(0, MAX_AVATARS)
  const how = howToPlay('royale', settings)
  const coverH = 200

  return (
    <View style={s.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <RoyaleCover height={insets.top + 56 + coverH} glyphSize={64}>
          <View style={[s.bar, { top: insets.top + 6 }]}>
            <IconCircle icon="chevron-back" label="Leave lobby" onPress={onExit} />
            <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
          </View>
          <View style={s.heroInfo} pointerEvents="none">
            <Text style={s.heroCat}>ACTION · REAL WORLD · UP TO {max} PLAYERS</Text>
            <Text style={s.heroTitle}>Battle Royale</Text>
            <Text style={s.heroTag}>One life. Shrinking zone. Last one standing.</Text>
          </View>
        </RoyaleCover>

        <View style={s.pad}>
          {/* Code + invites */}
          <Glass scheme="dark" radius={24} shadow={false} style={s.card}>
            <View style={s.rowBetween}>
              <Text style={arcadeText.label}>Game code</Text>
              <View style={[s.pill, { backgroundColor: visibility === 'private' ? 'rgba(125,108,240,0.5)' : 'rgba(47,220,143,0.3)' }]}>
                <Text style={s.pillText}>{visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}</Text>
              </View>
            </View>
            <View style={s.rowBetween}>
              <Text style={s.code} selectable>{room.code}</Text>
              <GhostButton title="Share" icon="share-outline" small onPress={share} />
            </View>
            <PlayButton title="Invite friends" icon="person-add" onPress={() => { buzz('select'); setInviteOpen(true) }} />
            <Text style={[arcadeText.caption, { marginTop: 8 }]}>
              {visibility === 'private' ? 'Private — only people with the code or an invite can join.' : 'Public — anyone can find this lobby under Laser Tag › Battle Royale.'}
            </Text>
          </Glass>

          {/* Settings */}
          <SectionHeader title="Match settings" />
          <Glass scheme="dark" radius={24} shadow={false} style={s.card}>
            <Text style={arcadeText.label}>Lobby</Text>
            <View style={s.chips}>
              <Chip label="Public" icon="globe-outline" active={visibility === 'public'} onPress={() => isHost && patch({ visibility: 'public' })} />
              <Chip label="Private" icon="lock-closed" active={visibility === 'private'} onPress={() => isHost && patch({ visibility: 'private' })} />
            </View>
            <Text style={[arcadeText.label, { marginTop: 14 }]}>Starting area (radius)</Text>
            <View style={s.chips}>
              {Object.values(ROYALE_AREAS).map((a) => (
                <Chip key={a.id} label={a.label} active={areaId === a.id} onPress={() => setArea(a.id)} />
              ))}
            </View>
            <Text style={[arcadeText.label, { marginTop: 14 }]}>Gas pace</Text>
            <View style={s.chips}>
              {Object.values(PACE).map((p) => (
                <Chip key={p.id} label={p.label} active={pace === p.id} onPress={() => isHost && (buzz('select'), patch({ pace: p.id }))} />
              ))}
            </View>
            {!isHost && <Text style={[arcadeText.caption, { marginTop: 10 }]}>The host chooses the settings.</Text>}
          </Glass>

          {/* Area map */}
          <SectionHeader title="Starting zone" action={isHost ? 'Use my location' : null} onAction={useMyLocation} />
          <Glass scheme="dark" radius={24} shadow={false} style={[s.card, { padding: 10 }]}>
            <GameMap
              center={area}
              fitRadius={areaRadius(areaId)}
              follow
              height={260}
              onPick={isHost ? pickCenter : undefined}
              hint={isHost ? 'Tap the map to move the centre' : null}
              circles={circles}
            />
            <Text style={[arcadeText.caption, { marginTop: 8, paddingHorizontal: 4 }]}>
              {area
                ? `${ROYALE_AREAS[areaId].label} radius. The gas starts shrinking after the drop-in. Big areas mean long matches — only travel between zones as a passenger, never while driving.`
                : isHost
                  ? (locState === 'error' ? 'Turn on location to centre the zone on you, or tap the map.' : 'Finding your location…')
                  : 'The host is setting the starting zone.'}
            </Text>
          </Glass>

          {/* Roster */}
          <SectionHeader title={`Players · ${roster.length}/${max}`} />
          <Glass scheme="dark" radius={24} shadow={false} style={s.card}>
            {roster.length === 0 ? (
              <Text style={arcadeText.caption}>Connecting…</Text>
            ) : (
              <View style={s.avatars}>
                {shown.map((p) => (
                  <View key={p.id} style={s.person}>
                    <View>
                      <Avatar uri={p.avatar} name={p.username} size={40} />
                      {p.id === snap.hostId && <View style={s.hostBadge}><Ionicons name="star" size={9} color="#10121f" /></View>}
                    </View>
                    <Text style={[s.personName, p.id === snap.me?.id && { color: AC.gold }]} numberOfLines={1}>{p.id === snap.me?.id ? 'You' : p.username}</Text>
                  </View>
                ))}
                {roster.length > shown.length && (
                  <View style={s.person}>
                    <View style={s.more}><Text style={s.moreText}>+{roster.length - shown.length}</Text></View>
                    <Text style={s.personName}>more</Text>
                  </View>
                )}
              </View>
            )}
          </Glass>

          {/* How to play */}
          <Pressable onPress={() => setHowOpen((v) => !v)} style={s.howHead} accessibilityRole="button" accessibilityState={{ expanded: howOpen }}>
            <Text style={s.howTitle}>How to play</Text>
            <Text style={s.howToggle}>{howOpen ? 'Hide' : 'Show'}</Text>
          </Pressable>
          {howOpen && (
            <Glass scheme="dark" radius={24} shadow={false} style={s.card}>
              {how.steps.map((t, i) => (
                <Text key={t} style={[arcadeText.caption, { marginTop: i ? 8 : 0, color: AC.text }]}>{i + 1}. {t}</Text>
              ))}
            </Glass>
          )}

          <View style={{ height: 18 }} />
          {isHost ? (
            <PlayButton title={`Start match · ${roster.length} player${roster.length === 1 ? '' : 's'}`} icon="flag" disabled={snap.status !== 'connected' || roster.length < (MP_GAMES.royale?.minPlayers || 2)} onPress={start} colors={['#ff8a00', '#ff2e63']} />
          ) : (
            <Text style={[arcadeText.caption, { textAlign: 'center' }]}>Waiting for the host to start…</Text>
          )}
          {isHost && roster.length < 2 && <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 8 }]}>Waiting for at least one more player.</Text>}
          <GhostButton title="Leave lobby" icon="exit-outline" onPress={onExit} style={{ marginTop: 12 }} />
        </View>
      </ScrollView>
      <StatusBarScrim height={insets.top} />
      <InvitePeopleSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        gameId="royale"
        code={room.code}
        excludeIds={roster.map((p) => p.id)}
      />
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: 18, paddingTop: 12 },
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroInfo: { position: 'absolute', left: 20, right: 20, bottom: 16 },
  heroCat: { fontSize: 11, ...font.bold, color: 'rgba(255,255,255,0.8)', letterSpacing: 1.2 },
  heroTitle: { fontSize: 34, ...font.heavy, color: '#fff', letterSpacing: -0.8, marginTop: 4 },
  heroTag: { fontSize: 15, color: 'rgba(255,255,255,0.88)', marginTop: 2 },
  card: { padding: 16, marginBottom: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  code: { fontSize: 34, ...font.heavy, color: AC.text, letterSpacing: 7 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, ...font.heavy, color: '#fff', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  person: { width: 56, alignItems: 'center' },
  personName: { fontSize: 10, color: AC.muted, marginTop: 4, maxWidth: 56 },
  hostBadge: { position: 'absolute', right: -2, top: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: AC.gold, alignItems: 'center', justifyContent: 'center' },
  more: { width: 40, height: 40, borderRadius: 20, backgroundColor: AC.cardStrong, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 12, ...font.heavy, color: AC.text },
  howHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  howTitle: { fontSize: 20, ...font.bold, color: AC.text, letterSpacing: -0.3 },
  howToggle: { fontSize: 14, ...font.semibold, color: AC.accent },
})

export default RoyaleLobby
