import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View, useColorScheme, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Location from 'expo-location'
import { Avatar, ConnectionBanner, Pill, PlayerTap, PlayerTapContext } from '../games/MultiplayerUI'
import InvitePeopleSheet from '../components/InvitePeopleSheet'
import { openProfile } from '../lib/profileNav'
import { inviteByText, shareInvite } from '../lib/textInvite'
import { CodeEntry, NearbyRoomsList } from './JoinGameScreen'
import {
  LASER_MODES, MP_GAMES, gameIdFromCode, howToPlay, openRoom, resolveGameId, statsIdFor, useLiveCounts, useRoomSnapshot,
} from '../lib/multiplayer'
import { getGame, playersLabel } from '../lib/games'
import { loadArcadeStats } from '../lib/arcadeStats'
import { buzz, setPref, useGamePrefs } from '../lib/gamePrefs'
import { LaserTagSetup, laserCanStart } from '../games/laser/Setup'
import { BesideSetup, besideCanStart } from '../games/beside/Setup'
import {
  AC, ArcadeBackground, ArcadeBox, ArcadeBtn, CoverArt, GhostButton, IconCircle, LiveBadge, PlayButton, StatusBarScrim, arcadeType, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { colors as themeColors, font, radii } from '../theme'

// The lobby is always the dark arcade look, whatever the system appearance. (Beside Them's
// setup panel follows the app theme, so in light mode it sits on its own light well.)
const type = arcadeType
const colors = { ...themeColors, text: AC.text, textMuted: AC.muted, textFaint: AC.faint, hairline: AC.border }
const Card = ArcadeBox
const Btn = ArcadeBtn
function PlayerRow({ player, right, subtitle, dim }) {
  return (
    <View style={[styles.pRow, dim && { opacity: 0.5 }]}>
      <PlayerTap player={player} style={styles.pRowTap}>
        <Avatar uri={player.avatar} name={player.username} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={arcadeType.body} numberOfLines={1}>{player.username}</Text>
          {!!subtitle && <Text style={arcadeType.caption} numberOfLines={1}>{subtitle}</Text>}
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
  const gameId = resolveGameId(rawGameId)
  const game = MP_GAMES[gameId]
  const meta = getGame(gameId)
  // Battle Royale's lobby (map + area setup) lives in the game screen; invites/codes land here.
  useEffect(() => {
    if (gameId !== 'royale') return
    // Without a code GamePlayScreen would bounce straight back here (endless replace loop).
    if (initialCode) navigation.replace('GamePlayScreen', { gameId: 'royale', gameName: 'Battle Royale', code: initialCode })
    else navigation.replace('LaserTagLobby')
  }, [gameId, initialCode, navigation])
  const scheme = useColorScheme()
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
        throw new Error('That code doesn’t match a game.')
      }
      const r = await openRoom({ gameId, code, mode })
      if (mode === 'host' && initialMode && gameId === 'lasertag') {
        r.info = { ...r.info, settings: { ...r.info.settings, mode: initialMode } }
      }
      roomRef.current = r
      setRoom(r)
      if (invite) setInviteOpen(true)
    } catch (e) {
      setOpenError(e?.message || 'Couldn’t open the game. Try again.')
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
      Alert.alert('Not enough players', `${game.name} needs at least ${game.minPlayers} players. Invite someone to join.`)
      return
    }
    const check = canStart(gameId, snap.info, snap.roster)
    if (!check.ok) {
      Alert.alert('Almost ready', check.reason)
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
          <Text style={type.title}>This game isn’t available.</Text>
          <Btn title="Back" onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
        </View>
      </View>
    )
  }

  const inRoom = !!room && snap && snap.status !== 'error'
  const roster = snap?.roster || []
  const enough = roster.length >= game.minPlayers
  const readiness = inRoom ? canStart(gameId, snap.info, roster) : null
  const myStats = stats?.games?.[statsIdFor(gameId)] || null
  const third = gameId === 'chess'
    ? { label: 'Rating', value: stats?.chess?.rating ?? '—' }
    : { label: 'Best', value: myStats?.bestScore ?? '—' }
  const visibility = snap?.info?.settings?.visibility
  // Covers are square: show the whole thing, a little smaller once you're in a room.
  const heroArtH = Math.max(140, Math.min(inRoom ? 190 : 270, Math.round((winW || 375) - 80)))

  return (
    <PlayerTapContext.Provider value={openPlayer}>
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Hero art header */}
        {/* The whole cover sits between the top bar and the title block - nothing is drawn over it. */}
        <CoverArt game={meta || { icon: game.icon }} style={styles.hero} artStyle={{ height: heroArtH, marginTop: insets.top + HERO_BAR_H }} glyphSize={Math.round(heroArtH * 0.5)}>
          <LinearGradient pointerEvents="none" colors={['rgba(4,5,13,0)', 'rgba(4,5,13,0.75)', AC.bg[0]]} locations={[0, 0.45, 1]} style={[styles.heroShade, { top: insets.top + HERO_BAR_H + heroArtH - 10 }]} />
          <View style={[styles.heroBar, { top: insets.top + 6 }]}>
            <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} />
            <LiveBadge count={live[gameId] || 0} />
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroCat} numberOfLines={1}>{(meta?.categories || []).map((c) => c.toUpperCase()).join(' · ')}{meta ? ' · ' : ''}{(meta ? playersLabel(meta) : `${game.minPlayers}–${game.maxPlayers} players`).toUpperCase()}</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>{game.name}</Text>
            {!!meta?.tagline && <Text style={styles.heroTag} numberOfLines={2}>{meta.tagline}</Text>}
            {!inRoom && (
              <View style={styles.statRow}>
                <HeroStat label="Played" value={myStats?.played ?? 0} />
                <HeroStat label="Wins" value={myStats?.wins ?? 0} />
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
              <PlayButton title="Play Now" icon="play" busy={busy} onPress={() => { buzz('medium'); enter('host') }} />
              <GhostButton title="Invite friends" icon="person-add" style={{ marginTop: 10 }} disabled={busy} onPress={() => enter('host', null, { invite: true })} />
              <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>You host a lobby; invite people nearby, people you follow or your followers.</Text>

              <Card style={{ marginTop: 20 }}>
                <Text style={[type.body, { marginBottom: 10 }]}>{game.blurb}</Text>
                {gameId === 'lasertag' && (
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[type.label, { marginBottom: 6 }]}>Modes</Text>
                    {Object.values(LASER_MODES).map((m) => (
                      <Text key={m.id} style={[type.caption, { marginBottom: 4 }]}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{m.name}</Text> — {m.blurb}
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
                  <Text style={type.label}>Game code</Text>
                  {visibility && (
                    <Pill text={visibility === 'private' ? 'PRIVATE' : 'PUBLIC'} color={visibility === 'private' ? colors.violet : colors.success} />
                  )}
                </View>
                <View style={styles.codeRow}>
                  <Text style={styles.code} selectable>{room.code}</Text>
                  <Btn title="Share" size="sm" onPress={share} />
                </View>
                <PlayButton title="Invite friends" icon="person-add" onPress={() => { buzz('select'); setInviteOpen(true) }} />
                <GhostButton title="Invite by text" icon="chatbubble-ellipses" style={{ marginTop: 10 }} onPress={textInvite} />
                <Text style={[type.caption, { marginTop: 8 }]}>
                  {visibility === 'private'
                    ? 'Private lobby — only people with the code or an invite can join.'
                    : 'Invite people nearby, people you follow or your followers. Players nearby can also find this game under Join.'}
                </Text>
              </Card>

              <Card>
                <Text style={[type.label, { marginBottom: 4 }]}>Players ({roster.length}/{game.maxPlayers})</Text>
                {roster.length === 0 && <Text style={type.caption}>Connecting…</Text>}
                {roster.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    right={
                      <View style={{ flexDirection: 'row' }}>
                        {p.id === snap.hostId && <Pill text="HOST" color={colors.violet} />}
                        {p.id === snap.me.id && <Pill text="YOU" color={colors.magenta} />}
                      </View>
                    }
                  />
                ))}
                {!enough && (
                  <Text style={[type.caption, { marginTop: 6 }]}>
                    Waiting for {game.minPlayers - roster.length} more player{game.minPlayers - roster.length === 1 ? '' : 's'}…
                  </Text>
                )}
              </Card>

              <Settings game={game} info={snap.info} editable={snap.isHost} onChange={(patch) => room.setInfo({ settings: { ...(room.info.settings || {}), ...patch } })} />
              {gameId === 'lasertag' && <LaserTagSetup room={room} snap={snap} />}
              {gameId === 'beside-them' && (
                <View style={scheme === 'light' ? styles.lightWell : null}>
                  <BesideSetup room={room} snap={snap} />
                </View>
              )}
              <Card><HowTo gameId={gameId} settings={snap.info.settings} /></Card>
              <FeedbackPrefs laser={gameId === 'lasertag'} />

              {snap.isHost ? (
                <>
                  {readiness && !readiness.ok && enough && <Text style={[type.caption, { textAlign: 'center', marginBottom: 8 }]}>{readiness.reason}</Text>}
                  <PlayButton title="Start game" icon="flag" disabled={!enough || snap.status !== 'connected' || (readiness && !readiness.ok)} onPress={start} />
                </>
              ) : (
                <Text style={[type.caption, { textAlign: 'center', marginVertical: 8 }]}>Waiting for the host to start…</Text>
              )}
              <View style={{ height: 12 }} />
              <Btn title="Leave lobby" onPress={leave} />
            </>
          )}
        </View>
      </ScrollView>
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
  const prefs = useGamePrefs()
  return (
    <Card>
      <Text style={[type.label, { marginBottom: 4 }]}>Your settings</Text>
      <View style={styles.prefRow}>
        <Text style={type.body}>Vibration</Text>
        <Switch value={!!prefs.haptics} onValueChange={(v) => { setPref('haptics', v); if (v) buzz('medium') }} trackColor={{ true: colors.magenta }} />
      </View>
      <View style={styles.prefRow}>
        <Text style={type.body}>Sound effects</Text>
        <Switch value={!!prefs.sound} onValueChange={(v) => setPref('sound', v)} trackColor={{ true: colors.magenta }} />
      </View>
      {laser && <Text style={type.caption}>Rumble and sound effects when you fire and when you get hit. Also in the in-game menu.</Text>}
    </Card>
  )
}

function HeroStat({ label, value }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  )
}

function canStart(gameId, info, roster) {
  if (gameId === 'lasertag') return laserCanStart(info, roster)
  if (gameId === 'beside-them') return besideCanStart(info)
  return { ok: true }
}

function HowTo({ gameId, settings, bare }) {
  const [open, setOpen] = useState(false)
  const h = howToPlay(gameId, settings)
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.howHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={type.label}>How to play</Text>
        <Text style={[type.caption, { color: colors.magenta }]}>{open ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {open && h.steps.map((r, i) => (
        <Text key={r} style={[bare ? type.caption : type.body, { marginTop: 8 }]}>{i + 1}. {r}</Text>
      ))}
    </View>
  )
}

function Settings({ game, info, editable, onChange }) {
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
              <Text style={[type.label, { marginBottom: 8 }]}>{d.label}</Text>
              {d.options.map((o) => {
                const active = o === value
                return (
                  <Pressable
                    key={o}
                    disabled={!editable}
                    onPress={() => { buzz('select'); onChange({ [k]: o }) }}
                    style={[styles.modeOpt, active && { borderColor: colors.magenta, backgroundColor: 'rgba(91,108,240,0.16)' }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, disabled: !editable }}
                  >
                    <View style={[styles.radio, active && { borderColor: colors.magenta }]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { fontWeight: '700' }]}>{LASER_MODES[o]?.name ?? d.labels?.[o]}</Text>
                      <Text style={type.caption}>{LASER_MODES[o]?.blurb}</Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )
        }
        return (
          <View key={k} style={idx > 0 && { marginTop: 14 }}>
            <Text style={[type.label, { marginBottom: 8 }]}>{d.label}</Text>
            <View style={styles.optRow}>
              {d.options.map((o) => {
                const active = o === value
                return (
                  <Pressable
                    key={String(o)}
                    disabled={!editable}
                    onPress={() => { buzz('select'); onChange({ [k]: o }) }}
                    style={[styles.opt, active && { backgroundColor: colors.magenta, borderColor: colors.magenta }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: !editable }}
                  >
                    <Text style={[type.caption, { color: active ? colors.onBrand : colors.text }]}>{d.labels?.[o] ?? `${o}${d.unit ? ` ${d.unit}` : ''}`}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
      {!editable && <Text style={[type.caption, { marginTop: 10 }]}>The host chooses the settings.</Text>}
    </Card>
  )
}

const HERO_BAR_H = 56 // back button row above the art

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pRowTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  lightWell: { backgroundColor: '#e6eaf3', borderRadius: 20, padding: 6, marginBottom: 12 },
  container: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { width: '100%', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroInfo: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 },
  heroCat: { fontSize: 11, ...font.bold, color: 'rgba(255,255,255,0.75)', letterSpacing: 1.2 },
  heroTitle: { fontSize: 34, ...font.heavy, color: '#fff', letterSpacing: -0.8, marginTop: 4 },
  heroTag: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroStat: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  heroStatValue: { fontSize: 18, ...font.heavy, color: AC.text },
  heroStatLabel: { fontSize: 10, ...font.bold, color: 'rgba(255,255,255,0.65)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  code: { ...type.display, fontSize: 36, lineHeight: 44, letterSpacing: 8 },
  optRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  prefRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  howHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, marginBottom: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.magenta },
  opt: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline },
})
