import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { HUD, HudCta } from '../games/laser/HudPro'
import * as Location from 'expo-location'
import { Avatar, ConnectionBanner, Pill, PlayerTap, PlayerTapContext } from '../games/MultiplayerUI'
import InvitePeopleSheet from '../components/InvitePeopleSheet'
import { openProfile } from '../lib/profileNav'
import { inviteByText, shareInvite } from '../lib/textInvite'
import { CodeEntry, NearbyRoomsList } from './JoinGameScreen'
import { NeedPlayersPanel } from '../games/NeedPlayersPanel'
import { formatOnlineRating } from '../lib/chessMatchmaking'
import {
  LASER_MODES, MP_GAMES, gameIdFromCode, openRoom, resolveGameId, statsIdFor, useLiveCounts, useRoomSnapshot,
} from '../lib/multiplayer'
import { categoryName, gameText, getGame, howToPlayText, laserMode, mpBlurb, mpGameName, optionLabel, playersLabel, settingLabel } from '../lib/games'
import { translate, useT } from '../i18n'
import R from '../i18n/strings/gameRoom'
import { loadArcadeStats } from '../lib/arcadeStats'
import { buzz, setPref, useGamePrefs } from '../lib/gamePrefs'
import { LaserTagSetup, laserCanStart } from '../games/laser/Setup'
import { BesideSetup, besideCanStart } from '../games/beside/Setup'
import {
  ArcadeBackground, ArcadeBox, ArcadeBtn, CoverArt, GhostButton, IconCircle, LiveBadge, PlayButton, StatusBarScrim, arcadeType, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { FONT, ST, stType, withAlpha } from '../games/studio'

// The lobby is always the dark studio look, whatever the system appearance.
const type = arcadeType
const tr = (k, v) => translate(R, k, v)
const colors = { text: ST.text, textMuted: ST.muted, textFaint: ST.faint, hairline: ST.line, magenta: ST.friendly, violet: ST.epic, success: ST.health, onBrand: ST.ink }
const Card = ArcadeBox
const Btn = ArcadeBtn
function PlayerRow({ player, right, subtitle, dim }) {
  return (
    <View style={[styles.pRow, dim && { opacity: 0.5 }]}>
      <PlayerTap player={player} style={styles.pRowTap}>
        <Avatar uri={player.avatar} name={player.username} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.pName} numberOfLines={1}>{player.username}</Text>
          {!!subtitle && <Text style={styles.pSub} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </PlayerTap>
      {right}
    </View>
  )
}

// Host or join a real multiplayer room for one game.
// Params: { gameId, code?, mode?, autoHost?, autoInvite? } — with a code, joins that room
// straight away (this is also how a challenge/invite lands here; if this device is already
// hosting that code, openRoom hands back the same room). autoHost opens a new room on
// arrival; autoInvite also opens the invite sheet.
export default function GameLobbyScreen({ navigation, route }) {
  const { gameId: rawGameId, code: initialCode, mode: initialMode, autoHost, autoInvite } = route.params || {}
  const t = useT(R)
  const gameId = resolveGameId(rawGameId)
  const game = MP_GAMES[gameId]
  const gameName = game ? mpGameName(gameId, game.name) : ''
  const meta = getGame(gameId)
  // Battle Royale's lobby (map + area setup) lives in the game screen; invites/codes land here.
  useEffect(() => {
    if (gameId !== 'royale') return
    // Without a code GamePlayScreen would bounce straight back here (endless replace loop).
    if (initialCode) navigation.replace('GamePlayScreen', { gameId: 'royale', gameName: 'Battle Royale', code: initialCode })
    else navigation.replace('LaserTagLobby')
  }, [gameId, initialCode, navigation])
  const insets = useArcadeInsets()
  useArcadeStatusBar() // light clock/battery over the dark cover header + scrim
  const { width: winW } = useWindowDimensions()
  const [room, setRoom] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openError, setOpenError] = useState(null)
  const [stats, setStats] = useState(null)
  const snap = useRoomSnapshot(room)
  const roomRef = useRef(null)
  const autoJoined = useRef(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const live = useLiveCounts(!room)

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setStats(s) }).catch(() => {})
    return () => { alive = false }
  }, []))

  const enter = useCallback(async (mode, code, { invite = false } = {}) => {
    setBusy(true)
    setOpenError(null)
    try {
      if (code && gameIdFromCode(code) !== gameId) {
        // A code for a different game: hop to that game's lobby instead.
        const other = gameIdFromCode(code)
        if (other) {
          navigation.replace('GameLobby', { gameId: other, code })
          return
        }
        throw new Error(tr('code_mismatch'))
      }
      const r = await openRoom({ gameId, code, mode })
      if (mode === 'host' && initialMode && gameId === 'lasertag') {
        r.info = { ...r.info, settings: { ...r.info.settings, mode: initialMode } }
      }
      roomRef.current = r
      setRoom(r)
      if (invite) setInviteOpen(true)
    } catch (e) {
      setOpenError(e?.message || tr('open_failed'))
    } finally {
      setBusy(false)
    }
  }, [gameId, navigation, initialMode])

  // Auto-join when opened with a code; auto-host when asked to.
  useEffect(() => {
    if (autoJoined.current || gameId === 'royale') return // royale: GamePlayScreen opens the room
    if (initialCode) {
      autoJoined.current = true
      enter('join', initialCode)
    } else if (autoHost) {
      autoJoined.current = true
      enter('host', null, { invite: !!autoInvite })
    }
  }, [initialCode, autoHost, autoInvite, enter])

  // Leave the room on unmount unless it was handed to the game screen.
  useEffect(() => () => {
    const r = roomRef.current
    if (r && !r.handedOff) r.leave()
  }, [])

  // Hosts advertise a coarse location so nearby players can find the room.
  const isHost = !!snap?.isHost
  useEffect(() => {
    if (!room || !isHost) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted' || cancelled) return
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (!cancelled) room.setAdvertLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      } catch {
        // Room still works by code without a location.
      }
    })()
    return () => { cancelled = true }
  }, [room, isHost])

  // Tapping someone in the lobby opens their profile on top of the lobby; the lobby stays
  // mounted underneath, so the room is kept and Back returns here.
  const myId = snap?.me?.id
  const openPlayer = useCallback((p) => {
    if (p?.id && p.id !== myId) openProfile(navigation, p.id)
  }, [myId, navigation])

  // Someone joined: a little tap so the host notices.
  const rosterCount = snap?.roster?.length || 0
  const prevCount = useRef(rosterCount)
  useEffect(() => {
    if (rosterCount > prevCount.current && prevCount.current > 0) buzz('success')
    prevCount.current = rosterCount
  }, [rosterCount])

  // When the host starts, everyone moves to the game screen.
  const phase = snap?.info?.phase
  useEffect(() => {
    if (room && phase === 'playing' && snap?.status !== 'error') {
      room.handedOff = true
      navigation.replace('GamePlayScreen', { gameId, gameName: game?.name, code: room.code })
    }
  }, [room, phase, snap?.status, gameId, game?.name, navigation])

  const leave = () => {
    if (room) room.leave()
    roomRef.current = null
    setRoom(null)
  }

  const share = () => {
    if (!room?.code) return
    shareInvite({ gameName: game?.name, code: room.code })
  }
  const textInvite = () => {
    if (!room?.code) return
    buzz('select')
    inviteByText({ gameName: game?.name, code: room.code })
  }

  const start = () => {
    if (!room) return
    const n = snap.roster.length
    if (n < game.minPlayers) {
      Alert.alert(t('not_enough_title'), t('not_enough_msg', { game: gameName, n: game.minPlayers }))
      return
    }
    const check = canStart(gameId, snap.info, snap.roster)
    if (!check.ok) {
      Alert.alert(t('almost_ready'), check.reason)
      return
    }
    buzz('heavy')
    room.setInfo({ phase: 'playing', round: (snap.info.round || 0) + 1, startedAt: Date.now() })
  }

  if (!game) {
    return (
      <View style={styles.screen}>
        <ArcadeBackground />
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={type.title}>{t('unavailable')}</Text>
          <Btn title={t('back')} onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
        </View>
      </View>
    )
  }

  const inRoom = !!room && snap && snap.status !== 'error'
  const roster = snap?.roster || []
  const enough = roster.length >= game.minPlayers
  const readiness = inRoom ? canStart(gameId, snap.info, roster) : null
  const myStats = stats?.games?.[statsIdFor(gameId)] || null
  // Chess lobbies are games against people, so the hero shows the ONLINE rating ("?" while
  // provisional); the vs-AI rating lives on the chess screen / records.
  const third = gameId === 'chess'
    ? { label: t('stat_online'), value: stats?.chess?.online?.games > 0 ? formatOnlineRating(stats.chess.online.rating, stats.chess.online.games) ?? '—' : '—' }
    : { label: t('stat_best'), value: myStats?.bestScore ?? '—' }
  const visibility = snap?.info?.settings?.visibility
  // Covers are square: show the whole thing, a little smaller once you're in a room.
  const heroArtH = Math.max(140, Math.min(inRoom ? 190 : 270, Math.round((winW || 375) - 80)))

  return (
    <PlayerTapContext.Provider value={openPlayer}>
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (inRoom && snap?.isHost ? 128 : 60) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Hero art header */}
        {/* The whole cover sits between the top bar and the title block - nothing is drawn over it. */}
        <CoverArt game={meta || { icon: game.icon }} style={styles.hero} artStyle={{ height: heroArtH, marginTop: insets.top + HERO_BAR_H }} glyphSize={Math.round(heroArtH * 0.5)}>
          <LinearGradient pointerEvents="none" colors={[withAlpha(ST.ground, 0), withAlpha(ST.ground, 0.8), ST.ground]} locations={[0, 0.45, 1]} style={[styles.heroShade, { top: insets.top + HERO_BAR_H + heroArtH - 10 }]} />
          <View style={[styles.heroBar, { top: insets.top + 6 }]}>
            <IconCircle icon="chevron-back" label={t('back')} onPress={() => navigation.goBack()} />
            <LiveBadge count={live[gameId] || 0} />
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroCat} numberOfLines={1}>{(meta?.categories || []).map((c) => categoryName(c).toUpperCase()).join(' · ')}{meta ? ' · ' : ''}{(meta ? playersLabel(meta) : `${game.minPlayers}–${game.maxPlayers}`).toUpperCase()}</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>{gameName}</Text>
            {!!meta?.tagline && <Text style={styles.heroTag} numberOfLines={2}>{gameText(meta, 'tagline')}</Text>}
            {!inRoom && (
              <View style={styles.statRow}>
                <HeroStat label={t('stat_played')} value={myStats?.played ?? 0} />
                <HeroStat label={t('stat_wins')} value={myStats?.wins ?? 0} />
                <HeroStat label={third.label} value={third.value} />
              </View>
            )}
          </View>
        </CoverArt>

        <View style={styles.container}>
          {!inRoom ? (
            <>
              {(openError || snap?.status === 'error') && (
                <ConnectionBanner status="error" error={openError || snap?.error} />
              )}
              <PlayButton title={t('play_now')} icon="play" busy={busy} onPress={() => { buzz('medium'); enter('host') }} />
              <GhostButton title={t('invite_friends')} icon="person-add" style={{ marginTop: 10 }} disabled={busy} onPress={() => enter('host', null, { invite: true })} />
              <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>{t('host_note')}</Text>

              <Card style={{ marginTop: 20 }}>
                <Text style={[type.body, { marginBottom: 10 }]}>{mpBlurb(game)}</Text>
                {gameId === 'lasertag' && (
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[type.label, { marginBottom: 6 }]}>{t('modes')}</Text>
                    {Object.values(LASER_MODES).map((m) => (
                      <Text key={m.id} style={[type.caption, { marginBottom: 4 }]}>
                        <Text style={{ color: colors.text, fontFamily: FONT.ui }}>{laserMode(m.id)}</Text> — {laserMode(m.id, 'blurb')}
                      </Text>
                    ))}
                  </View>
                )}
                <HowTo gameId={gameId} settings={{ mode: initialMode }} bare />
              </Card>
              <View style={{ height: 8 }} />
              <CodeEntry onJoin={(c) => enter('join', c)} />
              <View style={{ height: 24 }} />
              <NearbyRoomsList gameId={gameId} onJoin={(gid, c) => enter('join', c)} />
            </>
          ) : (
            <>
              <ConnectionBanner status={snap.status} error={snap.error} />
              <Card>
                <View style={styles.codeHead}>
                  <Text style={type.label}>{t('game_code')}</Text>
                  {visibility && (
                    <Pill text={t(visibility === 'private' ? 'private_caps' : 'public_caps')} color={visibility === 'private' ? ST.objective : ST.health} />
                  )}
                </View>
                <View style={styles.codeRow}>
                  <Text style={styles.code} selectable>{room.code}</Text>
                  <Btn title={t('share')} size="sm" onPress={share} />
                </View>
                <PlayButton title={t('invite_friends')} icon="person-add" onPress={() => { buzz('select'); setInviteOpen(true) }} />
                <GhostButton title={t('invite_text')} icon="chatbubble-ellipses" style={{ marginTop: 10 }} onPress={textInvite} />
                <Text style={[type.caption, { marginTop: 8 }]}>
                  {visibility === 'private'
                    ? t('private_note')
                    : t('public_note')}
                </Text>
              </Card>

              {roster.length > 0 && (
                <NeedPlayersPanel gameId={gameId} count={roster.length} code={room.code} gameName={gameName} onInvite={() => setInviteOpen(true)} onText={textInvite} />
              )}
              <Card>
                <Text style={[type.label, { marginBottom: 4 }]}>{t('players_count', { n: roster.length, max: game.maxPlayers })}</Text>
                {roster.length === 0 && <Text style={type.caption}>{t('connecting')}</Text>}
                {roster.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    right={
                      <View style={{ flexDirection: 'row' }}>
                        {p.id === snap.hostId && <Pill text={t('host_pill')} color={ST.objective} />}
                        {p.id === snap.me.id && <Pill text={t('you_pill')} color={ST.friendly} />}
                      </View>
                    }
                  />
                ))}
              </Card>

              <Settings game={game} info={snap.info} editable={snap.isHost} onChange={(patch) => room.setInfo({ settings: { ...(room.info.settings || {}), ...patch } })} />
              {gameId === 'lasertag' && <LaserTagSetup room={room} snap={snap} />}
              {gameId === 'beside-them' && (
                <BesideSetup room={room} snap={snap} />
              )}
              <Card><HowTo gameId={gameId} settings={snap.info.settings} /></Card>
              <FeedbackPrefs laser={gameId === 'lasertag'} />

              {!snap.isHost && <Text style={[type.caption, { textAlign: 'center', marginVertical: 8 }]}>{t('waiting_host')}</Text>}
              <View style={{ height: 12 }} />
              <Btn title={t('leave_lobby')} onPress={leave} />
            </>
          )}
        </View>
      </ScrollView>
      {/* Host: the Start button is always within reach instead of at the bottom of the page. */}
      {inRoom && snap.isHost && (
        <View style={[styles.startBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.startKicker}>{t('n_players_caps', { n: roster.length, max: game.maxPlayers })}{visibility ? `  ·  ${t(visibility === 'private' ? 'private_caps' : 'public_caps')}` : ''}</Text>
            <Text style={styles.startNote} numberOfLines={1}>
              {!enough ? t(game.minPlayers - roster.length === 1 ? 'need_more_one' : 'need_more', { n: game.minPlayers - roster.length }) : readiness && !readiness.ok ? readiness.reason : snap.status !== 'connected' ? t('connecting') : t('ready')}
            </Text>
          </View>
          <HudCta title={t('start')} icon="flag" compact disabled={!enough || snap.status !== 'connected' || (readiness && !readiness.ok)} onPress={start} style={{ minWidth: 130 }} />
        </View>
      )}
      {/* Keeps scrolled content from running under the clock / Dynamic Island. */}
      <StatusBarScrim height={insets.top} />
      {inRoom && (
        <InvitePeopleSheet
          visible={inviteOpen}
          onClose={() => setInviteOpen(false)}
          gameId={gameId}
          code={room.code}
          excludeIds={roster.map((p) => p.id)}
        />
      )}
    </View>
    </PlayerTapContext.Provider>
  )
}

// Personal (per-device) feedback settings, shared with the in-game menu.
function FeedbackPrefs({ laser }) {
  const t = useT(R)
  const prefs = useGamePrefs()
  return (
    <Card>
      <Text style={[type.label, { marginBottom: 4 }]}>{t('your_settings')}</Text>
      <View style={styles.prefRow}>
        <Text style={type.body}>{t('vibration')}</Text>
        <Switch value={!!prefs.haptics} onValueChange={(v) => { setPref('haptics', v); if (v) buzz('medium') }} trackColor={{ true: ST.friendly, false: 'rgba(255,255,255,0.18)' }} thumbColor="#ffffff" ios_backgroundColor="rgba(255,255,255,0.18)" />
      </View>
      <View style={styles.prefRow}>
        <Text style={type.body}>{t('sound_fx')}</Text>
        <Switch value={!!prefs.sound} onValueChange={(v) => setPref('sound', v)} trackColor={{ true: ST.friendly, false: 'rgba(255,255,255,0.18)' }} thumbColor="#ffffff" ios_backgroundColor="rgba(255,255,255,0.18)" />
      </View>
      {laser && <Text style={type.caption}>{t('feedback_note')}</Text>}
    </Card>
  )
}

function HeroStat({ label, value }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.heroStatValue} numberOfLines={1}>{value}</Text>
    </View>
  )
}

function canStart(gameId, info, roster) {
  if (gameId === 'lasertag') return laserCanStart(info, roster)
  if (gameId === 'beside-them') return besideCanStart(info)
  return { ok: true }
}

function HowTo({ gameId, settings, bare }) {
  const t = useT(R)
  const [open, setOpen] = useState(false)
  const h = howToPlayText(gameId, settings)
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.howHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={type.label}>{t('how_to_play')}</Text>
        <View style={styles.howToggle}>
          <Text style={styles.howToggleText}>{t(open ? 'hide' : 'show')}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={ST.friendly} />
        </View>
      </Pressable>
      {open && h.steps.map((r, i) => (
        <View key={r} style={styles.howStep}>
          <Text style={styles.howNum}>{String(i + 1).padStart(2, '0')}</Text>
          <Text style={[bare ? type.caption : type.body, { flex: 1 }]}>{r}</Text>
        </View>
      ))}
    </View>
  )
}

function Settings({ game, info, editable, onChange }) {
  const t = useT(R)
  const defs = game.settings || {}
  const current = { ...Object.fromEntries(Object.keys(defs).map((k) => [k, defs[k].default])), ...(info?.settings || {}) }
  const keys = Object.keys(defs).filter((k) => !defs[k].when || defs[k].when(current))
  if (!keys.length) return null
  return (
    <Card>
      {keys.map((k, idx) => {
        const d = defs[k]
        const value = current[k]
        if (game.id === 'lasertag' && k === 'mode') {
          return (
            <View key={k} style={idx > 0 && { marginTop: 14 }}>
              <Text style={[type.label, { marginBottom: 8 }]}>{settingLabel(game.id, k, d)}</Text>
              {d.options.map((o) => {
                const active = o === value
                return (
                  <Pressable
                    key={o}
                    disabled={!editable}
                    onPress={() => { buzz('select'); onChange({ [k]: o }) }}
                    style={[styles.modeOpt, active && { borderColor: ST.friendly, backgroundColor: withAlpha(ST.friendly, 0.1) }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, disabled: !editable }}
                  >
                    <View style={[styles.radio, active && { borderColor: ST.friendly }]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modeName}>{LASER_MODES[o] ? laserMode(o) : d.labels?.[o]}</Text>
                      <Text style={type.caption}>{LASER_MODES[o] ? laserMode(o, 'blurb') : ''}</Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )
        }
        return (
          <View key={k} style={idx > 0 && { marginTop: 14 }}>
            <Text style={[type.label, { marginBottom: 8 }]}>{settingLabel(game.id, k, d)}</Text>
            <View style={styles.optRow}>
              {d.options.map((o) => {
                const active = o === value
                return (
                  <Pressable
                    key={String(o)}
                    disabled={!editable}
                    onPress={() => { buzz('select'); onChange({ [k]: o }) }}
                    style={[styles.opt, active && { backgroundColor: ST.friendly, borderColor: ST.friendly }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: !editable }}
                  >
                    <Text style={[styles.optText, { color: active ? ST.ink : ST.text }]}>{optionLabel(k, d, o)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
      {!editable && <Text style={[type.caption, { marginTop: 10 }]}>{t('host_chooses')}</Text>}
    </Card>
  )
}

const HERO_BAR_H = 56 // back button row above the art

const styles = StyleSheet.create({
  startBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: withAlpha(ST.ground, 0.96), borderTopWidth: 1, borderTopColor: ST.line },
  startKicker: { ...stType.kicker, fontSize: 10, letterSpacing: 1.8, color: HUD.accent },
  startNote: { fontFamily: FONT.uiSemi, fontSize: 13, color: ST.text, marginTop: 2 },
  screen: { flex: 1, backgroundColor: ST.ground },
  pRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  pRowTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  pName: { fontFamily: FONT.display, fontSize: 15, color: ST.text, includeFontPadding: false },
  pSub: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.muted, marginTop: 2 },
  container: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { width: '100%', borderRadius: 0 },
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroInfo: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 },
  heroCat: { ...stType.kicker, fontSize: 10, letterSpacing: 2 },
  heroTitle: { fontFamily: FONT.display, fontSize: 32, letterSpacing: 1.4, color: ST.text, textTransform: 'uppercase', marginTop: 4, includeFontPadding: false },
  heroTag: { fontFamily: FONT.uiSemi, fontSize: 15, lineHeight: 20, color: 'rgba(242,244,247,0.82)', marginTop: 4 },
  statRow: { flexDirection: 'row', gap: 6, marginTop: 14 },
  heroStat: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 2 },
  heroStatValue: { fontFamily: FONT.display, fontSize: 18, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  heroStatLabel: { ...stType.label },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 10 },
  code: { fontFamily: FONT.display, fontSize: 36, lineHeight: 44, letterSpacing: 8, color: ST.friendly, fontVariant: ['tabular-nums'], includeFontPadding: false },
  optRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  prefRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  howHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 },
  howToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  howToggleText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.friendly },
  howStep: { flexDirection: 'row', gap: 10, marginTop: 10 },
  howNum: { fontFamily: FONT.display, fontSize: 13, color: ST.friendly, width: 20, fontVariant: ['tabular-nums'], includeFontPadding: false, marginTop: 1 },
  modeOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line, backgroundColor: ST.cell, marginBottom: 8 },
  modeName: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false, marginBottom: 2 },
  radio: { width: 18, height: 18, borderRadius: 2, borderWidth: 2, borderColor: ST.muted, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, backgroundColor: ST.friendly },
  opt: { paddingHorizontal: 12, height: 34, justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line, backgroundColor: ST.cell },
  optText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase' },
})
