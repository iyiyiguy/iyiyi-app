import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import {
  AREA_PRESETS, CODE_LENGTH, LASER_MODES, formatDistance, gameIdFromCode, getCurrentRoom, isValidCode, normalizeCode, openArena,
  openRoom, useLiveCounts, usePublicLobbies,
} from '../lib/multiplayer'
import { RoyaleCover } from '../games/royale/RoyaleCover'
import { getGame } from '../lib/games'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, ArcadePanel as Glass, CoverArt, GhostButton, IconCircle, LiveBadge, PlayButton, SectionHeader, StatusBarScrim, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { useUavInventory } from '../lib/uav'
import { FONT, ST, stType, withAlpha } from '../games/studio'
import { inviteByText } from '../lib/textInvite'

const MODE_ICONS = { ffa: 'person', tdm: 'people', snd: 'flame' }

// Laser Tag hub: one-tap Play Now into the endless public arena, or start your own lobby
// (play area on the map, Public / Private), browse public lobbies, or join by code.
export default function LaserTagLobbyScreen({ navigation }) {
  const insets = useArcadeInsets()
  const uavInv = useUavInventory()
  const { width: winW } = useWindowDimensions()
  const heroArtH = Math.max(140, Math.min(260, Math.round((winW || 375) - 80)))
  const focused = useIsFocused()
  const game = getGame('laser-tag')
  const live = useLiveCounts(focused)
  const { rooms, status, refresh } = usePublicLobbies('lasertag')
  const royale = usePublicLobbies('royale')
  const [royaleBusy, setRoyaleBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('ffa')
  const [code, setCode] = useState('')
  const mounted = useRef(true)
  useArcadeStatusBar()
  useEffect(() => () => { mounted.current = false }, [])

  const playNow = async () => {
    if (busy) return
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing' && !current.info.arena) {
      Alert.alert('You’re in a match', 'Finish or leave your current game first.')
      return
    }
    buzz('heavy')
    setBusy(true)
    try {
      const room = await openArena()
      if (!mounted.current) { room.leave(); return }
      room.handedOff = true
      navigation.navigate('GamePlayScreen', { gameId: 'lasertag', gameName: 'Laser Tag', code: room.code, arena: true })
    } catch (e) {
      buzz('error')
      Alert.alert('Couldn’t join the arena', e?.message || 'Please try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const startOwn = () => {
    buzz('medium')
    navigation.navigate('GameLobby', { gameId: 'lasertag', autoHost: true, mode })
  }

  const join = (c) => {
    const gid = gameIdFromCode(c)
    if (!gid) return
    buzz('select')
    // Battle Royale's lobby lives in the game screen (map + area setup).
    if (gid === 'royale') navigation.navigate('GamePlayScreen', { gameId: 'royale', gameName: 'Battle Royale', code: c })
    else navigation.navigate('GameLobby', { gameId: gid, code: c })
  }

  const startRoyale = async () => {
    if (royaleBusy) return
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing' && !current.info.arena) {
      Alert.alert('You’re in a match', 'Finish or leave your current game first.')
      return
    }
    buzz('heavy')
    setRoyaleBusy(true)
    try {
      const room = await openRoom({ gameId: 'royale', mode: 'host' })
      if (!mounted.current) { room.leave(); return }
      room.handedOff = true
      navigation.navigate('GamePlayScreen', { gameId: 'royale', gameName: 'Battle Royale', code: room.code })
    } catch (e) {
      buzz('error')
      Alert.alert('Couldn’t create the lobby', e?.message || 'Please try again.')
    } finally {
      if (mounted.current) setRoyaleBusy(false)
    }
  }

  const arenaCount = live.lasertag || 0

  // Invite by text: your open (non-arena) Laser Tag / Battle Royale lobby's code if you're in
  // one, otherwise a plain "come play" message with the App Store link.
  const textInvite = () => {
    buzz('select')
    let code = null
    let gameName = 'Laser Tag'
    try {
      const r = getCurrentRoom()
      const gid = r?.code ? gameIdFromCode(r.code) : null
      if (r?.code && !r?.info?.arena && (gid === 'lasertag' || gid === 'royale')) {
        code = r.code
        gameName = gid === 'royale' ? 'Battle Royale' : 'Laser Tag'
      }
    } catch {
      code = null
    }
    inviteByText({ gameName, code })
  }

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The whole cover sits between the top bar and the title block - nothing is drawn over it. */}
        <CoverArt game={game} style={styles.hero} artStyle={{ height: heroArtH, marginTop: insets.top + HERO_BAR_H }} glyphSize={Math.round(heroArtH * 0.5)}>
          <LinearGradient pointerEvents="none" colors={[withAlpha(ST.ground, 0), withAlpha(ST.ground, 0.8), ST.ground]} locations={[0, 0.45, 1]} style={[styles.heroShade, { top: insets.top + HERO_BAR_H + heroArtH - 10 }]} />
          <View style={[styles.heroBar, { top: insets.top + 6 }]}>
            <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} />
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <LiveBadge count={arenaCount} />
              <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
              <IconCircle icon="bag-handle" label="Shop" onPress={() => navigation.navigate('GunShop')} />
            </View>
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroCat}>ACTION · AR · 2–24 PLAYERS</Text>
            <Text style={styles.heroTitle}>Laser Tag</Text>
            <Text style={styles.heroTag}>{game?.tagline}</Text>
          </View>
        </CoverArt>

        <View style={styles.pad}>
          {/* Play Now: public arena */}
          <View style={styles.arena}>
            <View style={styles.arenaHead}>
              <View style={styles.liveTag}><View style={styles.liveDot} /><Text style={styles.liveTagText}>LIVE · 24/7</Text></View>
              <Text style={styles.arenaCount}>{arenaCount > 0 ? `${arenaCount} playing worldwide` : 'Be the first in'}</Text>
            </View>
            <Text style={styles.arenaTitle}>Public Arena</Text>
            <Text style={styles.arenaBody}>Endless free-for-all. No setup — drop in, respawn, and leave whenever you like.</Text>
            <Pressable onPress={playNow} disabled={busy} style={({ pressed }) => [styles.arenaBtn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel="Play now in the public arena">
              {busy ? <ActivityIndicator color={ST.ink} /> : <Ionicons name="play" size={18} color={ST.ink} />}
              <Text style={styles.arenaBtnText}>{busy ? 'Finding an arena…' : 'Play Now'}</Text>
            </Pressable>
            <Text style={styles.arenaNote}>Your live location is shared with arena players while you play. Only players within range can tag you.</Text>
          </View>

          {/* Battle Royale */}
          <SectionHeader title="Battle Royale" />
          <Glass style={styles.brCard} accent={ST.objective}>
            <RoyaleCover height={150} glyphSize={48} style={styles.brCover}>
              <View style={styles.brBadges}>
                <View style={styles.liveTag}><Text style={styles.liveTagText}>UP TO 100</Text></View>
                {(live.royale || 0) > 0 && <LiveBadge count={live.royale} />}
              </View>
            </RoyaleCover>
            <View style={{ padding: 16 }}>
              <Text style={styles.brTitle}>Battle Royale</Text>
              <Text style={arcadeText.caption}>One life on the real map. The gas zone shrinks from 1–5 miles down to a final circle; grab the weapons the fallen drop. Last one standing wins.</Text>
              <PlayButton title="Create Battle Royale lobby" icon="add-circle" busy={royaleBusy} onPress={startRoyale} colors={[ST.objective, ST.objective]} style={{ marginTop: 14 }} />
              {royale.rooms.slice(0, 10).map((r) => (
                <View key={r.code} style={styles.brLobby}>
                  <View style={[styles.lobbyIcon, { borderColor: withAlpha(ST.objective, 0.5) }]}><Ionicons name="planet" size={20} color={ST.objective} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lobbyName} numberOfLines={1}>Battle Royale · {r.hostName}</Text>
                    <Text style={styles.lobbyMeta} numberOfLines={1}>
                      {r.players}/{r.maxPlayers} players{r.areaLabel ? ` · ${r.areaLabel} zone` : ''}{Number.isFinite(r.distance) ? ` · ${formatDistance(r.distance)} away` : ''}
                    </Text>
                  </View>
                  <PlayButton title="Join" icon={null} small onPress={() => join(r.code)} />
                </View>
              ))}
            </View>
          </Glass>

          {/* Start your own lobby */}
          <SectionHeader title="Start your own lobby" />
          <Glass style={styles.card}>
            <Text style={arcadeText.caption}>Pick the play area on the map — {Object.values(AREA_PRESETS).map((p) => p.label).join(', ')} — make it Public or Private, and invite friends.</Text>
            <View style={styles.modes}>
              {Object.values(LASER_MODES).map((m) => {
                const on = mode === m.id
                return (
                  <Pressable key={m.id} onPress={() => { buzz('select'); setMode(m.id) }} style={[styles.mode, on && styles.modeOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Ionicons name={MODE_ICONS[m.id]} size={20} color={on ? ST.friendly : AC.muted} />
                    <Text style={[styles.modeName, on && { color: ST.text }]}>{m.short}</Text>
                    <Text style={styles.modeFull} numberOfLines={1}>{m.name}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={[arcadeText.caption, { marginBottom: 14 }]}>{LASER_MODES[mode].blurb}</Text>
            <PlayButton title="Create lobby" icon="add-circle" onPress={startOwn} />
          </Glass>

          {/* Public lobbies */}
          <SectionHeader title="Public lobbies" action="Refresh" onAction={refresh} />
          {status === 'connecting' ? (
            <ActivityIndicator color={AC.muted} style={{ marginVertical: 16 }} />
          ) : status === 'error' ? (
            <Text style={arcadeText.caption}>Couldn’t load lobbies. Check your connection and tap Refresh.</Text>
          ) : rooms.length === 0 ? (
            <Glass style={[styles.card, { alignItems: 'center' }]}>
              <Ionicons name="radio-outline" size={26} color={AC.faint} />
              <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 6 }]}>No public lobbies right now. Create one, or jump into the Public Arena.</Text>
            </Glass>
          ) : (
            rooms.slice(0, 20).map((r) => (
              <Glass key={r.code} style={styles.lobby}>
                <View style={styles.lobbyIcon}><Ionicons name={MODE_ICONS[r.mode] || 'locate'} size={20} color={ST.enemy} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lobbyName} numberOfLines={1}>{LASER_MODES[r.mode]?.name || 'Laser Tag'} · {r.hostName}</Text>
                  <Text style={styles.lobbyMeta} numberOfLines={1}>
                    {r.players}/{r.maxPlayers} players{r.areaLabel ? ` · ${r.areaLabel} area` : ''}{Number.isFinite(r.distance) ? ` · ${formatDistance(r.distance)} away` : ''}
                  </Text>
                </View>
                <PlayButton title="Join" icon={null} small onPress={() => join(r.code)} />
              </Glass>
            ))
          )}

          {/* Join with code */}
          <SectionHeader title="Join with a code" />
          <View style={styles.codeRow}>
            <Glass style={{ flex: 1 }}>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(normalizeCode(t))}
                placeholder="ABCDE"
                placeholderTextColor={AC.faint}
                selectionColor={ST.friendly}
                keyboardAppearance="dark"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={CODE_LENGTH}
                style={styles.codeInput}
                returnKeyType="go"
                onSubmitEditing={() => isValidCode(code) && join(code)}
                accessibilityLabel="Game code"
              />
            </Glass>
            <GhostButton title="Join" disabled={!isValidCode(code)} onPress={() => join(code)} />
          </View>
          <GhostButton title="Invite by text" icon="chatbubble-ellipses" onPress={textInvite} style={{ marginTop: 12 }} />
          <Text style={[arcadeText.caption, { marginTop: 8, textAlign: 'center' }]}>Texts your lobby code and the App Store link. Friends tap the link to jump straight in.</Text>
        </View>
      </ScrollView>
      {/* Keeps scrolled content from running under the clock / Dynamic Island. */}
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

const HERO_BAR_H = 56 // back / shop buttons row above the art

const LABEL = { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  pad: { paddingHorizontal: 20 },
  hero: { width: '100%', borderRadius: 0 },
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroInfo: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  heroCat: { ...stType.kicker, fontSize: 10, letterSpacing: 2 },
  heroTitle: { fontFamily: FONT.display, fontSize: 34, letterSpacing: 1.6, color: ST.text, textTransform: 'uppercase', marginTop: 4, includeFontPadding: false },
  heroTag: { fontFamily: FONT.uiSemi, fontSize: 15, lineHeight: 20, color: 'rgba(242,244,247,0.82)', marginTop: 4 },
  arena: { borderRadius: ST.radius, padding: 18, marginTop: 8, overflow: 'hidden', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.enemy },
  arenaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  liveTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: ST.panelStrong, paddingHorizontal: 8, height: 22, borderRadius: 2, borderWidth: 1, borderColor: ST.line },
  liveDot: { width: 6, height: 6, backgroundColor: ST.health, marginRight: 6 },
  liveTagText: { ...LABEL, color: ST.text },
  arenaCount: { ...LABEL, color: ST.health, flexShrink: 1, textAlign: 'right' },
  arenaTitle: { fontFamily: FONT.display, fontSize: 26, letterSpacing: 1.2, color: ST.text, textTransform: 'uppercase', marginTop: 14, includeFontPadding: false },
  arenaBody: { ...stType.body, color: ST.muted, marginTop: 4 },
  arenaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ST.friendly, borderRadius: ST.radius, height: 54, marginTop: 18 },
  arenaBtnText: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 2, textTransform: 'uppercase', color: ST.ink, includeFontPadding: false },
  arenaNote: { ...stType.small, fontSize: 11, lineHeight: 15, color: ST.faint, marginTop: 10, textAlign: 'center' },
  card: { padding: 16 },
  brCard: { overflow: 'hidden' },
  brCover: { borderRadius: 0 },
  brBadges: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brTitle: { fontFamily: FONT.display, fontSize: 20, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', marginBottom: 4, includeFontPadding: false },
  brLobby: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ST.line },
  modes: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line, gap: 2 },
  modeOn: { backgroundColor: withAlpha(ST.friendly, 0.1), borderColor: ST.friendly },
  modeName: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 1, color: ST.muted, marginTop: 4, includeFontPadding: false },
  modeFull: { ...LABEL, fontSize: 9, letterSpacing: 1, color: ST.faint },
  lobby: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8 },
  lobbyIcon: { width: 42, height: 42, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: withAlpha(ST.enemy, 0.5), alignItems: 'center', justifyContent: 'center' },
  lobbyName: { fontFamily: FONT.display, fontSize: 14, color: ST.text, includeFontPadding: false },
  lobbyMeta: { fontFamily: FONT.uiMedium, fontSize: 12, color: ST.muted, marginTop: 3 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: { fontFamily: FONT.display, fontSize: 22, letterSpacing: 6, textAlign: 'center', color: ST.text, height: 52, paddingVertical: 0 },
})
