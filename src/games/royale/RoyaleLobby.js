// Battle Royale lobby (shown inside the game screen while the room is in its lobby phase):
// join code + share + invites, Public/Private, the starting area on the real map around the
// host or a tapped point — a preset (¼ mi, ⅓ mi "Quick" (default, ~20-25 min), 1, 5 or 10 mi)
// or a custom radius (100 m - 16 km) in any lobby, with the passenger/no-driving note for
// 5+ mile games — gas pace with the estimated match length, the roster (up to 100) and Start.
import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import InvitePeopleSheet from '../../components/InvitePeopleSheet'
import { GameMap } from '../GameMap'
import { Avatar } from '../MultiplayerUI'
import { StatusBarScrim, useArcadeInsets } from '../arcadeUI'
import { FONT, ST, StButton, stType, withAlpha } from '../studio'
import { useNavigation } from '@react-navigation/native'
import { UavBalancePill, openArcadeStore } from '../UavStore'
import { useUavInventory } from '../../lib/uav'
import { MP_GAMES, howToPlay } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import {
  BIG_AREA_TEXT, CUSTOM_AREA_ID, CUSTOM_DEFAULT_M, CUSTOM_MAX_M, CUSTOM_MIN_M, CUSTOM_STEPS_M, FOOT_RADIUS_M, PACE, PRESET_AREA_IDS, ROYALE_AREAS,
  areaRadius, clampRadius, isBigArea, radiusText, resolveArea,
} from './constants'
import { estimateMatch } from './zone'
import { isValidCoord } from './geo'
import { RoyaleCover } from './RoyaleCover'

const MAX_AVATARS = 40

// ---- studio building blocks for the lobby ------------------------------------------

function Panel({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>
}

function Section({ title, action, onAction }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text style={s.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Chip({ label, icon, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? ST.friendly : ST.muted} /> : null}
      <Text style={[s.chipText, active && { color: ST.friendly }]}>{label}</Text>
    </Pressable>
  )
}

function SquareIcon({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [s.sqIcon, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color="#fff" />
    </Pressable>
  )
}

const Caption = ({ children, style }) => <Text style={[stType.small, style]}>{children}</Text>

const fmtMinutes = (m) => (m >= 90 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)
const kmText = (r) => `${Math.round((r / 1000) * 10) / 10} km`

/** The next custom radius stop up (dir 1) or down (dir -1) from r. */
function stepRadius(r, dir) {
  const v = clampRadius(r)
  if (dir > 0) return CUSTOM_STEPS_M.find((x) => x > v) ?? CUSTOM_MAX_M
  return [...CUSTOM_STEPS_M].reverse().find((x) => x < v) ?? CUSTOM_MIN_M
}

function Stepper({ value, onMinus, onPlus, disabled }) {
  const btn = (icon, onPress, off, label) => (
    <Pressable onPress={onPress} disabled={disabled || off} hitSlop={6} style={({ pressed }) => [s.stepBtn, (disabled || off) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color="#fff" />
    </Pressable>
  )
  return (
    <View style={s.stepper} accessibilityRole="adjustable" accessibilityValue={{ text: `${radiusText(value)} radius` }}>
      {btn('remove', onMinus, value <= CUSTOM_MIN_M, 'Smaller area')}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.stepValue}>{radiusText(value)}</Text>
        <Text style={stType.small}>{`radius · ${value >= 1000 ? kmText(value) : `${Math.round(value * 3.28084)} ft`}`}</Text>
      </View>
      {btn('add', onPlus, value >= CUSTOM_MAX_M, 'Bigger area')}
    </View>
  )
}

export function RoyaleLobby({ room, snap, onExit }) {
  const insets = useArcadeInsets()
  const navigation = useNavigation()
  const uavInv = useUavInventory()
  const info = snap?.info || {}
  const settings = info.settings || {}
  const isHost = !!snap?.isHost
  const roster = Array.isArray(snap?.roster) ? snap.roster : []
  const max = MP_GAMES.royale?.maxPlayers || 100
  const visibility = settings.visibility === 'private' ? 'private' : 'public'
  // Any preset or a custom radius, public or private (the host engine resolves the same way).
  const { id: areaId, r: radius } = resolveArea(settings)
  const big = isBigArea(radius)
  const area = settings.area && isValidCoord(settings.area.lat, settings.area.lng) ? settings.area : null
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
          const a = resolveArea(room.info.settings)
          patch({ areaId: a.id, area: { preset: a.id, lat, lng, r: a.r } })
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
      if (isValidCoord(lat, lng)) patch({ area: { preset: areaId, lat, lng, r: radius } })
    } catch {
      Alert.alert('Location unavailable', 'Turn on location, or tap the map to set the centre.')
    }
  }

  const pickCenter = (c) => {
    if (!isHost || !isValidCoord(c?.lat, c?.lng)) return
    buzz('light')
    patch({ area: { preset: areaId, lat: c.lat, lng: c.lng, r: radius } })
  }

  // A preset, or 'custom' (starts from the last custom radius, else the current radius).
  const setArea = (id) => {
    if (!isHost || !(ROYALE_AREAS[id] || id === CUSTOM_AREA_ID)) return
    buzz('select')
    const r = id === CUSTOM_AREA_ID ? clampRadius(settings.radiusM ?? (radius || CUSTOM_DEFAULT_M)) : areaRadius(id)
    patch({ areaId: id, ...(id === CUSTOM_AREA_ID ? { radiusM: r } : null), area: area ? { ...area, preset: id, r } : undefined })
  }
  const setCustomRadius = (r) => {
    if (!isHost) return
    const v = clampRadius(r)
    buzz('light')
    patch({ areaId: CUSTOM_AREA_ID, radiusM: v, area: area ? { ...area, preset: CUSTOM_AREA_ID, r: v } : undefined })
  }

  const setVisibility = (v) => {
    if (!isHost) return
    patch({ visibility: v })
  }

  const estimate = useMemo(() => {
    try { return estimateMatch({ r0: radius, pace }) } catch { return null }
  }, [radius, pace])

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
    () => (area ? [{ id: 'zone', lat: area.lat, lng: area.lng, radius, color: ST.objective }] : []),
    [area?.lat, area?.lng, radius], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const shown = roster.slice(0, MAX_AVATARS)
  const how = howToPlay('royale', settings)
  const coverH = 200

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <RoyaleCover height={insets.top + 56 + coverH} glyphSize={64}>
          <View style={[s.bar, { top: insets.top + 6 }]}>
            <SquareIcon icon="chevron-back" label="Leave lobby" onPress={onExit} />
            <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
          </View>
          <View style={s.heroInfo} pointerEvents="none">
            <Text style={[stType.kicker, { color: ST.objective }]}>REAL WORLD · UP TO {max} PLAYERS</Text>
            <Text style={s.heroTitle}>Battle Royale</Text>
            <Text style={s.heroTag}>One life. Shrinking zone. Last one standing.</Text>
          </View>
        </RoyaleCover>

        <View style={s.pad}>
          {/* Code + invites */}
          <Panel>
            <View style={s.rowBetween}>
              <Text style={stType.label}>GAME CODE</Text>
              <View style={[s.tag, { borderColor: visibility === 'private' ? ST.lineStrong : withAlpha(ST.health, 0.6) }]}>
                <Ionicons name={visibility === 'private' ? 'lock-closed' : 'globe-outline'} size={11} color={visibility === 'private' ? ST.muted : ST.health} />
                <Text style={[s.tagText, { color: visibility === 'private' ? ST.muted : ST.health }]}>{visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}</Text>
              </View>
            </View>
            <View style={s.rowBetween}>
              <Text style={s.code} selectable>{room.code}</Text>
              <StButton title="Share" tone="ghost" height={38} onPress={share} left={<Ionicons name="share-outline" size={15} color="#fff" />} />
            </View>
            <StButton title="Invite friends" onPress={() => { buzz('select'); setInviteOpen(true) }} left={<Ionicons name="person-add" size={17} color={ST.ink} />} />
            <Caption style={{ marginTop: 8 }}>
              {visibility === 'private' ? 'Private — only people with the code or an invite can join.' : 'Public — anyone can find this lobby under Laser Tag › Battle Royale.'}
            </Caption>
          </Panel>

          {/* Settings */}
          <Section title="MATCH SETTINGS" />
          <Panel>
            <Text style={stType.label}>LOBBY</Text>
            <View style={s.chips}>
              <Chip label="PUBLIC" icon="globe-outline" active={visibility === 'public'} onPress={() => setVisibility('public')} />
              <Chip label="PRIVATE" icon="lock-closed" active={visibility === 'private'} onPress={() => setVisibility('private')} />
            </View>
            <Text style={[stType.label, { marginTop: 14 }]}>STARTING AREA · RADIUS</Text>
            <View style={s.chips}>
              {PRESET_AREA_IDS.map((id) => ROYALE_AREAS[id]).filter(Boolean).map((a) => (
                <Chip key={a.id} label={`${a.id === 'quick' ? 'QUICK · ' : ''}${a.label.toUpperCase()}`} icon={isBigArea(a.r) ? 'car-outline' : undefined} active={areaId === a.id} onPress={() => setArea(a.id)} />
              ))}
              <Chip label="CUSTOM" icon="options-outline" active={areaId === CUSTOM_AREA_ID} onPress={() => setArea(CUSTOM_AREA_ID)} />
            </View>
            {areaId === CUSTOM_AREA_ID ? (
              <Stepper value={radius} disabled={!isHost} onMinus={() => setCustomRadius(stepRadius(radius, -1))} onPlus={() => setCustomRadius(stepRadius(radius, 1))} />
            ) : null}
            {big ? (
              <View style={s.warn} accessibilityRole="alert">
                <Ionicons name="warning" size={14} color={ST.objective} />
                <Text style={[stType.small, { flex: 1, color: ST.text }]}>{BIG_AREA_TEXT}</Text>
              </View>
            ) : radius > FOOT_RADIUS_M + 1 ? (
              <Caption style={{ marginTop: 8 }}>A long match on foot: the gas always gives walkers time to reach the next zone. Never play while driving.</Caption>
            ) : null}
            <Text style={[stType.label, { marginTop: 14 }]}>GAS PACE</Text>
            <View style={s.chips}>
              {Object.values(PACE).map((p) => (
                <Chip key={p.id} label={p.label.toUpperCase()} active={pace === p.id} onPress={() => isHost && (buzz('select'), patch({ pace: p.id }))} />
              ))}
            </View>
            {estimate ? (
              <Caption style={{ marginTop: 10 }}>
                {big
                  ? `Estimated match: about ${fmtMinutes(estimate.minutes)} · the zone edge travels ~${estimate.walkKm} km. Early circles allow for passenger travel; the last ones are on foot.`
                  : `Estimated match: about ${fmtMinutes(estimate.minutes)} · up to ~${estimate.walkKm} km of walking. Played on foot.`}
              </Caption>
            ) : null}
            {!isHost && <Caption style={{ marginTop: 10 }}>The host chooses the settings.</Caption>}
          </Panel>

          {/* Area map */}
          <Section title="STARTING ZONE" action={isHost ? 'USE MY LOCATION' : null} onAction={useMyLocation} />
          <Panel style={{ padding: 10 }}>
            <View style={s.mapFrame}>
              <GameMap
                center={area}
                fitRadius={radius}
                follow
                height={260}
                onPick={isHost ? pickCenter : undefined}
                hint={isHost ? 'Tap the map to move the centre' : null}
                circles={circles}
              />
            </View>
            <Caption style={{ marginTop: 8, paddingHorizontal: 4 }}>
              {area
                ? `${radiusText(radius)} radius. Weapons are scattered across this zone at the start. The gas starts shrinking after the drop-in${big ? '' : ' and always gives walkers time to reach the next zone'}. Never play while driving.`
                : isHost
                  ? (locState === 'error' ? 'Turn on location to centre the zone on you, or tap the map.' : 'Finding your location…')
                  : 'The host is setting the starting zone.'}
            </Caption>
          </Panel>

          {/* Roster */}
          <Section title={`PLAYERS · ${roster.length}/${max}`} />
          <Panel>
            {roster.length === 0 ? (
              <Caption>Connecting…</Caption>
            ) : (
              <View style={s.avatars}>
                {shown.map((p) => (
                  <View key={p.id} style={s.person}>
                    <View>
                      <Avatar uri={p.avatar} name={p.username} size={40} />
                      {p.id === snap.hostId && <View style={s.hostBadge}><Ionicons name="star" size={9} color={ST.ink} /></View>}
                    </View>
                    <Text style={[s.personName, p.id === snap.me?.id && { color: ST.friendly }]} numberOfLines={1}>{p.id === snap.me?.id ? 'You' : p.username}</Text>
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
          </Panel>

          {/* How to play */}
          <Pressable onPress={() => setHowOpen((v) => !v)} style={s.section} accessibilityRole="button" accessibilityState={{ expanded: howOpen }}>
            <Text style={s.sectionTitle}>HOW TO PLAY</Text>
            <Text style={s.sectionAction}>{howOpen ? 'HIDE' : 'SHOW'}</Text>
          </Pressable>
          {howOpen && (
            <Panel>
              {how.steps.map((t, i) => (
                <View key={t} style={[s.step, i ? { marginTop: 8 } : null]}>
                  <Text style={s.stepNum}>{i + 1}</Text>
                  <Text style={[stType.body, { flex: 1 }]}>{t}</Text>
                </View>
              ))}
            </Panel>
          )}

          <View style={{ height: 18 }} />
          {isHost ? (
            <StButton title={`Start match · ${roster.length} player${roster.length === 1 ? '' : 's'}`} height={54} disabled={snap.status !== 'connected' || roster.length < (MP_GAMES.royale?.minPlayers || 2)} onPress={start} left={<Ionicons name="flag" size={18} color={ST.ink} />} />
          ) : (
            <Caption style={{ textAlign: 'center' }}>Waiting for the host to start…</Caption>
          )}
          {isHost && roster.length < 2 && <Caption style={{ textAlign: 'center', marginTop: 8 }}>Waiting for at least one more player.</Caption>}
          <StButton title="Leave lobby" tone="ghost" onPress={onExit} style={{ marginTop: 12 }} left={<Ionicons name="exit-outline" size={16} color="#fff" />} />
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
  screen: { flex: 1, backgroundColor: ST.ground },
  pad: { paddingHorizontal: 16, paddingTop: 12 },
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sqIcon: { width: 40, height: 40, borderRadius: ST.radius, backgroundColor: ST.panel, borderWidth: 1, borderColor: ST.lineStrong, alignItems: 'center', justifyContent: 'center' },
  heroInfo: { position: 'absolute', left: 20, right: 20, bottom: 16 },
  heroTitle: { fontFamily: FONT.display, fontSize: 34, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', marginTop: 4, includeFontPadding: false },
  heroTag: { ...stType.body, fontSize: 15, color: 'rgba(242,244,247,0.9)', marginTop: 2 },
  card: { padding: 16, marginBottom: 4, backgroundColor: ST.ground2, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  sectionTitle: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 2.4, color: ST.muted },
  sectionAction: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.6, color: ST.friendly },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  code: { fontFamily: FONT.display, fontSize: 34, color: ST.text, letterSpacing: 7, includeFontPadding: false },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: ST.radius },
  tagText: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, backgroundColor: ST.cell },
  chipOn: { borderColor: ST.friendly, backgroundColor: withAlpha(ST.friendly, 0.14) },
  chipText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1.2, color: ST.text },
  mapFrame: { borderRadius: ST.radius, overflow: 'hidden' },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  person: { width: 56, alignItems: 'center' },
  personName: { fontFamily: FONT.uiSemi, fontSize: 11, color: ST.muted, marginTop: 4, maxWidth: 56 },
  hostBadge: { position: 'absolute', right: -2, top: -2, width: 16, height: 16, borderRadius: 2, backgroundColor: ST.objective, alignItems: 'center', justifyContent: 'center' },
  more: { width: 40, height: 40, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontFamily: FONT.display, fontSize: 12, color: ST.text },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: 10, borderRadius: ST.radius, borderWidth: 1, borderColor: withAlpha(ST.objective, 0.6), backgroundColor: withAlpha(ST.objective, 0.1) },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 8, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, backgroundColor: ST.cell },
  stepBtn: { width: 40, height: 40, borderRadius: ST.radius, backgroundColor: ST.panel, borderWidth: 1, borderColor: ST.lineStrong, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: FONT.display, fontSize: 20, color: ST.text, letterSpacing: 1, includeFontPadding: false },
  stepNum: { fontFamily: FONT.display, fontSize: 14, color: ST.friendly, width: 18, lineHeight: 19 },
})

export default RoyaleLobby
