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
import { MP_GAMES } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import {
  bigAreaText, CUSTOM_AREA_ID, CUSTOM_DEFAULT_M, CUSTOM_MAX_M, CUSTOM_MIN_M, CUSTOM_STEPS_M, FOOT_RADIUS_M, PACE, PRESET_AREA_IDS, ROYALE_AREAS,
  areaRadius, clampRadius, isBigArea, radiusText, resolveArea,
} from './constants'
import { estimateMatch } from './zone'
import { isValidCoord } from './geo'
import { RoyaleCover } from './RoyaleCover'
import { translate, useT } from '../../i18n'
import S from '../../i18n/strings/royale'
import { howToPlayText, mpGameName } from '../../lib/games'

const tr = (k, v) => translate(S, k, v)

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

const fmtMinutes = (m) => (m >= 90 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`) // h / min / km: unit symbols, kept as is
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
    <View style={s.stepper} accessibilityRole="adjustable" accessibilityValue={{ text: tr('radius_val', { d: radiusText(value) }) }}>
      {btn('remove', onMinus, value <= CUSTOM_MIN_M, tr('smaller_area'))}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.stepValue}>{radiusText(value)}</Text>
        <Text style={stType.small}>{`${tr('radius_word')} · ${value >= 1000 ? kmText(value) : `${Math.round(value * 3.28084)} ft`}`}</Text>
      </View>
      {btn('add', onPlus, value >= CUSTOM_MAX_M, tr('bigger_area'))}
    </View>
  )
}

export function RoyaleLobby({ room, snap, onExit }) {
  const t = useT(S)
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
      Alert.alert(t('loc_unavailable'), t('loc_unavailable_msg'))
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
      await Share.share({ message: t('share_msg', { code: room.code }) })
    } catch { /* dismissed */ }
  }

  const start = () => {
    if (!isHost) return
    const min = MP_GAMES.royale?.minPlayers || 2
    if (roster.length < min) {
      Alert.alert(t('not_enough_title'), t('not_enough_msg', { n: min }))
      return
    }
    buzz('heavy')
    if (!area) {
      Alert.alert(t('starting_area'), t('no_centre'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('start'), onPress: () => room.setInfo({ phase: 'playing', round: (room.info.round || 0) + 1, startedAt: Date.now() }) },
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
  const how = howToPlayText('royale', settings)
  const coverH = 200

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <RoyaleCover height={insets.top + 56 + coverH} glyphSize={64}>
          <View style={[s.bar, { top: insets.top + 6 }]}>
            <SquareIcon icon="chevron-back" label={t('leave_lobby')} onPress={onExit} />
            <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
          </View>
          <View style={s.heroInfo} pointerEvents="none">
            <Text style={[stType.kicker, { color: ST.objective }]}>{t('hero_kicker', { n: max })}</Text>
            <Text style={s.heroTitle}>{mpGameName('royale', 'Battle Royale')}</Text>
            <Text style={s.heroTag}>{t('hero_tag')}</Text>
          </View>
        </RoyaleCover>

        <View style={s.pad}>
          {/* Code + invites */}
          <Panel>
            <View style={s.rowBetween}>
              <Text style={stType.label}>{t('game_code')}</Text>
              <View style={[s.tag, { borderColor: visibility === 'private' ? ST.lineStrong : withAlpha(ST.health, 0.6) }]}>
                <Ionicons name={visibility === 'private' ? 'lock-closed' : 'globe-outline'} size={11} color={visibility === 'private' ? ST.muted : ST.health} />
                <Text style={[s.tagText, { color: visibility === 'private' ? ST.muted : ST.health }]}>{t(visibility === 'private' ? 'private_caps' : 'public_caps')}</Text>
              </View>
            </View>
            <View style={s.rowBetween}>
              <Text style={s.code} selectable>{room.code}</Text>
              <StButton title={t('share')} tone="ghost" height={38} onPress={share} left={<Ionicons name="share-outline" size={15} color="#fff" />} />
            </View>
            <StButton title={t('invite_friends')} onPress={() => { buzz('select'); setInviteOpen(true) }} left={<Ionicons name="person-add" size={17} color={ST.ink} />} />
            <Caption style={{ marginTop: 8 }}>
              {t(visibility === 'private' ? 'private_note' : 'public_note')}
            </Caption>
          </Panel>

          {/* Settings */}
          <Section title={t('match_settings')} />
          <Panel>
            <Text style={stType.label}>{t('lobby')}</Text>
            <View style={s.chips}>
              <Chip label={t('public_caps')} icon="globe-outline" active={visibility === 'public'} onPress={() => setVisibility('public')} />
              <Chip label={t('private_caps')} icon="lock-closed" active={visibility === 'private'} onPress={() => setVisibility('private')} />
            </View>
            <Text style={[stType.label, { marginTop: 14 }]}>{t('area_radius')}</Text>
            <View style={s.chips}>
              {PRESET_AREA_IDS.map((id) => ROYALE_AREAS[id]).filter(Boolean).map((a) => (
                <Chip key={a.id} label={`${a.id === 'quick' ? t('quick_prefix') : ''}${a.label.toUpperCase()}`} icon={isBigArea(a.r) ? 'car-outline' : undefined} active={areaId === a.id} onPress={() => setArea(a.id)} />
              ))}
              <Chip label={t('custom')} icon="options-outline" active={areaId === CUSTOM_AREA_ID} onPress={() => setArea(CUSTOM_AREA_ID)} />
            </View>
            {areaId === CUSTOM_AREA_ID ? (
              <Stepper value={radius} disabled={!isHost} onMinus={() => setCustomRadius(stepRadius(radius, -1))} onPlus={() => setCustomRadius(stepRadius(radius, 1))} />
            ) : null}
            {big ? (
              <View style={s.warn} accessibilityRole="alert">
                <Ionicons name="warning" size={14} color={ST.objective} />
                <Text style={[stType.small, { flex: 1, color: ST.text }]}>{bigAreaText()}</Text>
              </View>
            ) : radius > FOOT_RADIUS_M + 1 ? (
              <Caption style={{ marginTop: 8 }}>{t('long_foot')}</Caption>
            ) : null}
            <Text style={[stType.label, { marginTop: 14 }]}>{t('gas_pace')}</Text>
            <View style={s.chips}>
              {Object.values(PACE).map((p) => (
                <Chip key={p.id} label={p.label.toUpperCase()} active={pace === p.id} onPress={() => isHost && (buzz('select'), patch({ pace: p.id }))} />
              ))}
            </View>
            {estimate ? (
              <Caption style={{ marginTop: 10 }}>
                {big
                  ? t('est_big', { t: fmtMinutes(estimate.minutes), km: estimate.walkKm })
                  : t('est_foot', { t: fmtMinutes(estimate.minutes), km: estimate.walkKm })}
              </Caption>
            ) : null}
            {!isHost && <Caption style={{ marginTop: 10 }}>{t('host_chooses')}</Caption>}
          </Panel>

          {/* Area map */}
          <Section title={t('starting_zone')} action={isHost ? t('use_my_loc') : null} onAction={useMyLocation} />
          <Panel style={{ padding: 10 }}>
            <View style={s.mapFrame}>
              <GameMap
                center={area}
                fitRadius={radius}
                follow
                height={260}
                onPick={isHost ? pickCenter : undefined}
                hint={isHost ? t('tap_move_centre') : null}
                circles={circles}
              />
            </View>
            <Caption style={{ marginTop: 8, paddingHorizontal: 4 }}>
              {area
                ? t(big ? 'zone_info' : 'zone_info_foot', { d: radiusText(radius) })
                : isHost
                  ? t(locState === 'error' ? 'loc_off_zone' : 'finding_loc')
                  : t('host_setting_zone')}
            </Caption>
          </Panel>

          {/* Roster */}
          <Section title={t('players_n', { n: roster.length, max })} />
          <Panel>
            {roster.length === 0 ? (
              <Caption>{t('connecting')}</Caption>
            ) : (
              <View style={s.avatars}>
                {shown.map((p) => (
                  <View key={p.id} style={s.person}>
                    <View>
                      <Avatar uri={p.avatar} name={p.username} size={40} />
                      {p.id === snap.hostId && <View style={s.hostBadge}><Ionicons name="star" size={9} color={ST.ink} /></View>}
                    </View>
                    <Text style={[s.personName, p.id === snap.me?.id && { color: ST.friendly }]} numberOfLines={1}>{p.id === snap.me?.id ? t('you_name') : p.username}</Text>
                  </View>
                ))}
                {roster.length > shown.length && (
                  <View style={s.person}>
                    <View style={s.more}><Text style={s.moreText}>+{roster.length - shown.length}</Text></View>
                    <Text style={s.personName}>{t('more')}</Text>
                  </View>
                )}
              </View>
            )}
          </Panel>

          {/* How to play */}
          <Pressable onPress={() => setHowOpen((v) => !v)} style={s.section} accessibilityRole="button" accessibilityState={{ expanded: howOpen }}>
            <Text style={s.sectionTitle}>{t('how_to_play')}</Text>
            <Text style={s.sectionAction}>{t(howOpen ? 'hide' : 'show')}</Text>
          </Pressable>
          {howOpen && (
            <Panel>
              {how.steps.map((step, i) => (
                <View key={step} style={[s.step, i ? { marginTop: 8 } : null]}>
                  <Text style={s.stepNum}>{i + 1}</Text>
                  <Text style={[stType.body, { flex: 1 }]}>{step}</Text>
                </View>
              ))}
            </Panel>
          )}

          <View style={{ height: 18 }} />
          {isHost ? (
            <StButton title={t(roster.length === 1 ? 'start_match_one' : 'start_match', { n: roster.length })} height={54} disabled={snap.status !== 'connected' || roster.length < (MP_GAMES.royale?.minPlayers || 2)} onPress={start} left={<Ionicons name="flag" size={18} color={ST.ink} />} />
          ) : (
            <Caption style={{ textAlign: 'center' }}>{t('waiting_host')}</Caption>
          )}
          {isHost && roster.length < 2 && <Caption style={{ textAlign: 'center', marginTop: 8 }}>{t('waiting_one_more')}</Caption>}
          <StButton title={t('leave_lobby')} tone="ghost" onPress={onExit} style={{ marginTop: 12 }} left={<Ionicons name="exit-outline" size={16} color="#fff" />} />
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
