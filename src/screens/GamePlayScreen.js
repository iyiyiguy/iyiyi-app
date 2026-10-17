import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { BesideThemGame } from '../games/BesideThemGame'
import { ChessGame } from '../games/ChessGame'
import { OnlineChessGame } from '../games/OnlineChessGame'
import { WordGame } from '../games/WordGame'
import { SpiderGame } from '../games/SpiderGame'
import { LaserTagGame } from '../games/LaserTagGame'
import { RoyaleGame } from '../games/royale/RoyaleGame'
import { MafiaGame } from '../games/MafiaGame'
import { HeadsUp7UpGame } from '../games/HeadsUp7UpGame'
import { GameMenu } from '../games/GameMenu'
import { Ionicons } from '@expo/vector-icons'
import { HUD } from '../games/laser/HudPro'
import { Btn, ConnectionBanner, Pill, PlayerRow, PlayerTapContext } from '../games/MultiplayerUI'
import { FONT, ST, stType, useStudioFonts } from '../games/studio'
import ProfilePreviewSheet from '../components/ProfilePreviewSheet'
import { translate, useT } from '../i18n'
import R from '../i18n/strings/gameRoom'
import { mpGameName, teamName } from '../lib/games'
import {
  MP_GAMES, TEAMS, getActiveRoom, getMyProfile, isArenaCode, isMultiplayerGame, openRoom, resolveGameId, useRoomPositions, useRoomSnapshot,
} from '../lib/multiplayer'

export default function GamePlayScreen({ navigation, route }) {
  const params = route.params || {}
  const { code, mode = 'social', aiDifficulty = null } = params
  const t = useT(R)
  const gameId = resolveGameId(params.gameId)
  const gameName = mpGameName(gameId, params.gameName || MP_GAMES[gameId]?.name || t('game'))
  const multiplayer = isMultiplayerGame(gameId)
  const immersive = gameId === 'lasertag' || gameId === 'royale' // camera fills the whole screen
  // Every game is dark (studio look) whatever the system theme, so the shell is too.
  useStudioFonts()
  const insets = useSafeAreaInsets()

  const [room, setRoom] = useState(() => (multiplayer ? getActiveRoom(gameId, code) : null))
  const [roomError, setRoomError] = useState(null)
  const [me, setMe] = useState(null)
  const [panel, setPanel] = useState(null) // null | 'chat' | 'players'
  const [menuOpen, setMenuOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [muted, setMuted] = useState(() => new Set())
  const [seenCount, setSeenCount] = useState(0)
  // Tapping a player mid-match shows a preview sheet over the game instead of navigating
  // away: the camera / GPS loop and the room stay exactly as they are.
  const [preview, setPreview] = useState(null)
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const roomRef = useRef(room)
  roomRef.current = room
  const leaving = useRef(false)

  const leave = () => {
    leaving.current = true
    navigation.goBack()
  }

  // Multiplayer games always go through the lobby first.
  useEffect(() => {
    if (multiplayer && !code) {
      leaving.current = true
      navigation.replace('GameLobby', { gameId })
    }
  }, [multiplayer, code, gameId, navigation])

  // Swipe-back is disabled for this screen; any other back (Android button,
  // header) goes through the menu's leave confirmation.
  useEffect(() => {
    if (!multiplayer) return undefined
    return navigation.addListener('beforeRemove', (e) => {
      if (leaving.current) return
      e.preventDefault()
      setMenuOpen(true)
    })
  }, [navigation, multiplayer])

  // Re-open the room if we arrived without one (e.g. screen restored).
  useEffect(() => {
    if (!multiplayer || !code || room) return undefined
    let cancelled = false
    openRoom({ gameId, code, mode: params.arena || isArenaCode(code) ? 'public' : 'join' })
      .then((r) => {
        if (cancelled) { r.leave(); return }
        r.handedOff = true
        setRoom(r)
      })
      .catch((e) => { if (!cancelled) setRoomError(e?.message || translate(R, 'connect_failed')) })
    return () => { cancelled = true }
  }, [multiplayer, code, gameId, room])

  // Leave the room when this screen goes away (presence drops and, if we were
  // host, the next player takes over).
  useEffect(() => () => { roomRef.current?.leave() }, [])

  useEffect(() => {
    let cancelled = false
    getMyProfile().then((p) => { if (!cancelled) setMe(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const chat = snap?.chat || []
  const visibleChat = useMemo(() => chat.filter((m) => !muted.has(m.from)), [chat, muted])
  const newestFirst = useMemo(() => [...visibleChat].reverse(), [visibleChat])
  const nameOf = useMemo(() => {
    const map = {}
    for (const p of snap?.roster || []) map[p.id] = p.username
    return map
  }, [snap?.roster])

  useEffect(() => {
    if (panel === 'chat') setSeenCount(visibleChat.length)
  }, [panel, visibleChat.length])
  const unread = panel === 'chat' ? 0 : Math.max(0, visibleChat.length - seenCount)

  const send = () => {
    if (!room || !chatInput.trim()) return
    room.sendChat(chatInput)
    setChatInput('')
  }

  const myId = snap?.me?.id ?? me?.id
  const snapRef = useRef(snap)
  snapRef.current = snap
  const showPlayer = useCallback((p) => {
    if (!p?.id || p.id === myId) return
    setPreview({ id: p.id, username: p.username, avatar: p.avatar, ...matchContext(gameId, snapRef.current, p.id, myId) })
  }, [myId, gameId])
  const avatarOf = useMemo(() => {
    const map = {}
    for (const p of snap?.roster || []) map[p.id] = p.avatar
    return map
  }, [snap?.roster])

  const toggleMute = (id) => {
    setMuted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderGame = () => {
    switch (gameId) {
      case 'chess':
        if (multiplayer) return <OnlineChessGame room={room} onExit={leave} />
        return <ChessGame players={me ? [{ id: me.id, name: me.username, avatar: me.avatar }] : []} aiDifficulty={aiDifficulty} mode={mode} />
      case 'word-game':
      case 'word-race':
        return <WordGame players={me ? [{ id: me.id, name: me.username, avatar: me.avatar }] : []} mode={mode} />
      case 'lasertag':
        return <LaserTagGame room={room} onExit={leave} />
      case 'spider-spider':
        return <SpiderGame room={room} onExit={leave} />
      case 'royale':
        return <RoyaleGame room={room} onExit={leave} />
      case 'beside-them':
        return <BesideThemGame room={room} onExit={leave} />
      case 'mafia':
        return <MafiaGame room={room} onExit={leave} />
      case 'heads-up':
        return <HeadsUp7UpGame room={room} onExit={leave} />
      default:
        return <Text style={[stType.body, { padding: 24 }]}>{t('unavailable')}</Text>
    }
  }

  const fatal = roomError || (snap?.status === 'error' ? snap.error : null)
  const body = fatal ? (
    <View style={styles.center}>
      <Ionicons name="cloud-offline" size={28} color={ST.enemy} style={{ marginBottom: 10 }} />
      <Text style={[stType.kicker, { color: ST.enemy, marginBottom: 4 }]}>{t('connection')}</Text>
      <Text style={[stType.title, { textAlign: 'center' }]}>{fatal}</Text>
      <Btn title={t('back_to_games')} onPress={leave} style={{ marginTop: 16 }} />
    </View>
  ) : multiplayer && !room ? (
    <View style={styles.center}><Text style={stType.label}>{t('connecting')}</Text></View>
  ) : renderGame()

  if (!multiplayer) {
    return (
      <View style={styles.ground}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={8}>
              <Ionicons name="close" size={20} color={ST.text} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
              <Text style={styles.kicker} numberOfLines={1}>{t('arcade_kicker')}</Text>
              <Text style={styles.title} numberOfLines={1}>{gameName}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>{body}</View>
        </SafeAreaView>
      </View>
    )
  }

  const buttons = (
    <View style={styles.btnRow}>
      <Pressable onPress={() => setPanel((p) => (p === 'players' ? null : 'players'))} style={({ pressed }) => [styles.iconBtn, panel === 'players' && styles.iconBtnOn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('players')} accessibilityState={{ selected: panel === 'players' }}>
        <Ionicons name="people" size={18} color={panel === 'players' ? ST.friendly : ST.text} />
      </Pressable>
      {gameId !== 'chess' ? (
        <Pressable onPress={() => setPanel((p) => (p === 'chat' ? null : 'chat'))} style={({ pressed }) => [styles.iconBtn, panel === 'chat' && styles.iconBtnOn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('chat')} accessibilityState={{ selected: panel === 'chat' }}>
          <Ionicons name="chatbubble-ellipses" size={18} color={panel === 'chat' ? ST.friendly : ST.text} />
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>}
        </Pressable>
      ) : null}
      <Pressable onPress={() => { setPanel(null); setMenuOpen(true) }} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('menu')}>
        <Ionicons name="menu" size={20} color={ST.text} />
      </Pressable>
    </View>
  )

  const overlays = (
    <>
      {panel === 'players' && snap && (
        <View style={[styles.overlay, { top: insets.top + 56 }]}>
          <View style={[styles.panel, { borderTopColor: ST.friendly, borderTopWidth: 2 }]}>
            <Text style={[stType.label, { marginBottom: 4 }]}>{t('players_code', { code: snap.code })}</Text>
            {snap.roster.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                subtitle={p.id === snap.hostId ? t('host') : null}
                right={p.id === snap.me.id
                  ? <Pill text={t('you_pill')} color={ST.friendly} />
                  : <Btn size="sm" title={t(muted.has(p.id) ? 'unmute' : 'mute')} onPress={() => toggleMute(p.id)} />}
              />
            ))}
            <Text style={[stType.small, { marginTop: 8 }]}>{t('mute_note')}</Text>
          </View>
        </View>
      )}
      {panel === 'chat' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.chatWrap, { bottom: insets.bottom + 12 }]} keyboardVerticalOffset={insets.top + 20}>
          <View style={[styles.panel, { flex: 1, padding: 10 }]}>
            <FlatList
              data={newestFirst}
              keyExtractor={(m, i) => String(m?.id ?? i)}
              style={{ maxHeight: 260 }}
              inverted
              ListEmptyComponent={<Text style={stType.small}>{t('no_messages')}</Text>}
              renderItem={({ item }) => (
                <View style={styles.msg}>
                  <Pressable
                    disabled={item.from === snap?.me?.id}
                    onPress={() => showPlayer({ id: item.from, username: nameOf[item.from], avatar: avatarOf[item.from] })}
                    hitSlop={6}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Text style={[styles.msgName, { color: item.from === snap?.me?.id ? ST.friendly : ST.muted }]}>
                      {item.from === snap?.me?.id ? t('you') : nameOf[item.from] || t('player')}
                    </Text>
                  </Pressable>
                  <Text style={stType.body}>{item.text}</Text>
                </View>
              )}
            />
            <View style={styles.chatInputRow}>
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={t('message_ph')}
                placeholderTextColor={ST.faint}
                selectionColor={ST.friendly}
                keyboardAppearance="dark"
                style={styles.chatInput}
                maxLength={300}
                returnKeyType="send"
                onSubmitEditing={send}
              />
              <Btn title={t('send')} size="sm" variant="primary" onPress={send} disabled={!chatInput.trim() || snap?.status !== 'connected'} />
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
      <GameMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        gameId={gameId}
        snap={snap}
        positions={positions}
        onLeave={() => { setMenuOpen(false); leave() }}
      />
      <ProfilePreviewSheet person={preview} onClose={() => setPreview(null)} />
    </>
  )

  if (immersive) {
    return (
      <PlayerTapContext.Provider value={showPlayer}>
      <View style={styles.immersive}>
        {body}
        {/* Battle Royale's lobby (shown in this screen) has its own header and Leave button. */}
        {!(gameId === 'royale' && snap?.info?.phase !== 'playing') && (
          <View style={[styles.floating, { top: insets.top + 6, right: 12 + (insets.right || 0) }]}>{buttons}</View>
        )}
        {snap && snap.status !== 'connected' && snap.status !== 'error' && (
          <View style={[styles.floatBanner, { top: insets.top + 54 }]}><ConnectionBanner status={snap.status} /></View>
        )}
        {overlays}
      </View>
      </PlayerTapContext.Provider>
    )
  }

  return (
    <PlayerTapContext.Provider value={showPlayer}>
    <View style={styles.ground}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {snap ? <Text style={styles.kicker} numberOfLines={1}>{t(snap.roster.length === 1 ? 'code_players_one' : 'code_players_n', { code: snap.code, n: snap.roster.length })}</Text> : null}
            <Text style={styles.title} numberOfLines={1}>{gameName}</Text>
          </View>
          {buttons}
        </View>
        {snap && <View style={{ paddingHorizontal: 12 }}><ConnectionBanner status={snap.status === 'error' ? 'closed' : snap.status} /></View>}
        <View style={{ flex: 1 }}>{body}</View>
      </SafeAreaView>
      {overlays}
    </View>
    </PlayerTapContext.Provider>
  )
}

// What the match knows about a tapped player, for the player card: relation (teammate /
// enemy / opponent), team label and this-match stats. Laser Tag only for now (its host
// state has per-player teams and K/D); every other game shows the plain card.
function matchContext(gameId, snap, id, myId) {
  try {
    const st = snap?.state
    if (gameId !== 'lasertag' || !st?.players?.[id]) return {}
    const them = st.players[id]
    const mine = myId ? st.players[myId] : null
    const out = { stats: [{ label: translate(R, 'this_match'), value: `${them.kills || 0} / ${them.deaths || 0}` }, { label: translate(R, 'score'), value: them.score ?? 0 }] }
    if (st.mode && st.mode !== 'ffa' && them.team) {
      out.teamLabel = translate(R, 'team_label', { team: TEAMS[them.team] ? teamName(them.team) : them.team })
      if (mine?.team) out.relation = mine.team === them.team ? 'teammate' : 'enemy'
    } else if (mine) {
      out.relation = 'opponent'
    }
    out.teamColor = out.relation === 'teammate' ? ST.friendly : ST.enemy
    return out
  } catch {
    return {}
  }
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: ST.ground },
  immersive: { flex: 1, backgroundColor: HUD.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ST.line },
  kicker: { ...stType.kicker, fontSize: 10, letterSpacing: 2 },
  title: { fontFamily: FONT.display, fontSize: 19, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  btnRow: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  iconBtnOn: { borderColor: ST.friendly },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 2, backgroundColor: ST.enemy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: ST.ground },
  badgeText: { fontFamily: FONT.display, fontSize: 10, color: '#fff', includeFontPadding: false },
  floating: { position: 'absolute' },
  floatBanner: { position: 'absolute', left: 12, right: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { position: 'absolute', left: 12, right: 12 },
  panel: { borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, padding: 14, marginBottom: 12 },
  chatWrap: { position: 'absolute', left: 12, right: 12, height: 340 },
  msg: { marginVertical: 4 },
  msgName: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chatInput: { flex: 1, fontFamily: FONT.uiSemi, fontSize: 15, color: ST.text, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line, backgroundColor: ST.cell },
})
