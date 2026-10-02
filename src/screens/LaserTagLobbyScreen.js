import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../components/Glass'
import {
  AREA_PRESETS, CODE_LENGTH, LASER_MODES, formatDistance, gameIdFromCode, getCurrentRoom, isValidCode, normalizeCode, openArena,
  openRoom, useLiveCounts, usePublicLobbies,
} from '../lib/multiplayer'
import { RoyaleCover } from '../games/royale/RoyaleCover'
import { getGame } from '../lib/games'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, CoverArt, GhostButton, IconCircle, LiveBadge, PlayButton, SectionHeader, StatusBarScrim, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { useUavInventory } from '../lib/uav'
import { font } from '../theme'
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
          <LinearGradient pointerEvents="none" colors={['rgba(4,5,13,0)', 'rgba(4,5,13,0.75)', AC.bg[0]]} locations={[0, 0.45, 1]} style={[styles.heroShade, { top: insets.top + HERO_BAR_H + heroArtH - 10 }]} />
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
          <LinearGradient colors={['#ff2e63', '#7a1cff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.arena}>
            <View style={styles.arenaGlow} />
            <View style={styles.arenaHead}>
              <View style={styles.liveTag}><View style={styles.liveDot} /><Text style={styles.liveTagText}>LIVE · 24/7</Text></View>
              <Text style={styles.arenaCount}>{arenaCount > 0 ? `${arenaCount} playing worldwide` : 'Be the first in'}</Text>
            </View>
            <Text style={styles.arenaTitle}>Public Arena</Text>
            <Text style={styles.arenaBody}>Endless free-for-all. No setup — drop in, respawn, and leave whenever you like.</Text>
            <Pressable onPress={playNow} disabled={busy} style={({ pressed }) => [styles.arenaBtn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel="Play now in the public arena">
              {busy ? <ActivityIndicator color="#10121f" /> : <Ionicons name="play" size={18} color="#10121f" />}
              <Text style={styles.arenaBtnText}>{busy ? 'Finding an arena…' : 'Play Now'}</Text>
            </Pressable>
            <Text style={styles.arenaNote}>Your live location is shared with arena players while you play. Only players within range can tag you.</Text>
          </LinearGradient>

          {/* Battle Royale */}
          <SectionHeader title="Battle Royale" />
          <Glass scheme="dark" radius={26} shadow={false} style={styles.brCard}>
            <RoyaleCover height={150} glyphSize={48} style={styles.brCover}>
              <View style={styles.brBadges}>
                <View style={styles.liveTag}><Text style={styles.liveTagText}>UP TO 100</Text></View>
                {(live.royale || 0) > 0 && <LiveBadge count={live.royale} />}
              </View>
            </RoyaleCover>
            <View style={{ padding: 16 }}>
              <Text style={styles.brTitle}>Battle Royale</Text>
              <Text style={arcadeText.caption}>One life on the real map. The gas zone shrinks from 1–5 miles down to a final circle; grab the weapons the fallen drop. Last one standing wins.</Text>
              <PlayButton title="Create Battle Royale lobby" icon="add-circle" busy={royaleBusy} onPress={startRoyale} colors={['#ff8a00', '#ff2e63']} style={{ marginTop: 14 }} />
              {royale.rooms.slice(0, 10).map((r) => (
                <View key={r.code} style={styles.brLobby}>
                  <View style={[styles.lobbyIcon, { backgroundColor: 'rgba(255,138,0,0.35)' }]}><Ionicons name="planet" size={20} color="#fff" /></View>
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
          <Glass scheme="dark" radius={26} shadow={false} style={styles.card}>
            <Text style={arcadeText.caption}>Pick the play area on the map — {Object.values(AREA_PRESETS).map((p) => p.label).join(', ')} — make it Public or Private, and invite friends.</Text>
            <View style={styles.modes}>
              {Object.values(LASER_MODES).map((m) => {
                const on = mode === m.id
                return (
                  <Pressable key={m.id} onPress={() => { buzz('select'); setMode(m.id) }} style={[styles.mode, on && styles.modeOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Ionicons name={MODE_ICONS[m.id]} size={20} color={on ? '#fff' : AC.muted} />
                    <Text style={[styles.modeName, on && { color: '#fff' }]}>{m.short}</Text>
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
            <Glass scheme="dark" radius={22} shadow={false} style={[styles.card, { alignItems: 'center' }]}>
              <Ionicons name="radio-outline" size={26} color={AC.faint} />
              <Text style={[arcadeText.caption, { textAlign: 'center', marginTop: 6 }]}>No public lobbies right now. Create one, or jump into the Public Arena.</Text>
            </Glass>
          ) : (
            rooms.slice(0, 20).map((r) => (
              <Glass key={r.code} scheme="dark" radius={22} shadow={false} style={styles.lobby}>
                <View style={styles.lobbyIcon}><Ionicons name={MODE_ICONS[r.mode] || 'locate'} size={20} color="#fff" /></View>
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
            <Glass scheme="dark" radius={18} shadow={false} style={{ flex: 1 }}>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(normalizeCode(t))}
                placeholder="ABCDE"
                placeholderTextColor={AC.faint}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: 20 },
  hero: { width: '100%' },
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroInfo: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  heroCat: { fontSize: 11, ...font.bold, color: 'rgba(255,255,255,0.75)', letterSpacing: 1.2 },
  heroTitle: { fontSize: 36, ...font.heavy, color: '#fff', letterSpacing: -0.8, marginTop: 4 },
  heroTag: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  arena: { borderRadius: 28, padding: 20, marginTop: 8, overflow: 'hidden' },
  arenaGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, right: -80, top: -90, backgroundColor: 'rgba(255,255,255,0.16)' },
  arenaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AC.live, marginRight: 6 },
  liveTagText: { fontSize: 11, ...font.heavy, color: '#fff', letterSpacing: 1 },
  arenaCount: { fontSize: 12, ...font.bold, color: 'rgba(255,255,255,0.9)' },
  arenaTitle: { fontSize: 28, ...font.heavy, color: '#fff', marginTop: 14, letterSpacing: -0.5 },
  arenaBody: { fontSize: 14, color: 'rgba(255,255,255,0.88)', marginTop: 4 },
  arenaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 20, paddingVertical: 16, marginTop: 18 },
  arenaBtnText: { fontSize: 17, ...font.heavy, color: '#10121f' },
  arenaNote: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 10, textAlign: 'center' },
  card: { padding: 18 },
  brCard: { overflow: 'hidden' },
  brCover: { borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  brBadges: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brTitle: { fontSize: 22, ...font.heavy, color: '#fff', marginBottom: 4, letterSpacing: -0.4 },
  brLobby: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AC.border },
  modes: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 18, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border, gap: 2 },
  modeOn: { backgroundColor: 'rgba(124,140,255,0.28)', borderColor: AC.accent },
  modeName: { fontSize: 15, ...font.heavy, color: AC.muted, marginTop: 4 },
  modeFull: { fontSize: 10, color: AC.faint },
  lobby: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10 },
  lobbyIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,46,99,0.35)', alignItems: 'center', justifyContent: 'center' },
  lobbyName: { fontSize: 15, ...font.bold, color: AC.text },
  lobbyMeta: { fontSize: 12, color: AC.muted, marginTop: 2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: { fontSize: 22, ...font.heavy, letterSpacing: 6, textAlign: 'center', color: AC.text, paddingVertical: 14 },
})
