import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useColorScheme,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassBackground } from '../components/GlassBackground'
import { GlassCard } from '../components/GlassCard'
import { BesideThemGame } from '../games/BesideThemGame'
import { ChessGame } from '../games/ChessGame'
import { OnlineChessGame } from '../games/OnlineChessGame'
import { WordGame } from '../games/WordGame'
import { SpiderGame } from '../games/SpiderGame'
import { LaserTagGame } from '../games/LaserTagGame'
import { RoyaleGame } from '../games/royale/RoyaleGame'
import { GameMenu } from '../games/GameMenu'
import { Btn, Card, ConnectionBanner, Pill, PlayerRow, PlayerTapContext, useTint } from '../games/MultiplayerUI'
import ProfilePreviewSheet from '../components/ProfilePreviewSheet'
import {
  MP_GAMES, getActiveRoom, getMyProfile, isArenaCode, isMultiplayerGame, openRoom, resolveGameId, useRoomPositions, useRoomSnapshot,
} from '../lib/multiplayer'
import { colors, radii, type } from '../theme'

export default function GamePlayScreen({ navigation, route }) {
  const params = route.params || {}
  const { code, mode = 'social', aiDifficulty = null } = params
  const gameId = resolveGameId(params.gameId)
  const gameName = params.gameName || MP_GAMES[gameId]?.name || 'Game'
  const multiplayer = isMultiplayerGame(gameId)
  const immersive = gameId === 'lasertag' || gameId === 'royale' // camera fills the whole screen
  const scheme = useColorScheme()
  const tint = useTint()
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
      .catch((e) => { if (!cancelled) setRoomError(e?.message || 'Couldn’t connect to the game.') })
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
  const showPlayer = useCallback((p) => {
    if (!p?.id || p.id === myId) return
    setPreview({ id: p.id, username: p.username, avatar: p.avatar })
  }, [myId])
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
      default:
        return <Text style={[type.body, { padding: 24 }]}>This game isn’t available.</Text>
    }
  }

  const fatal = roomError || (snap?.status === 'error' ? snap.error : null)
  const body = fatal ? (
    <View style={styles.center}>
      <Text style={[type.title, { textAlign: 'center' }]}>{fatal}</Text>
      <Btn title="Back to games" onPress={leave} style={{ marginTop: 16 }} />
    </View>
  ) : multiplayer && !room ? (
    <View style={styles.center}><Text style={type.caption}>Connecting…</Text></View>
  ) : renderGame()

  if (!multiplayer) {
    return (
      <GlassBackground isDark={scheme !== 'light'}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Text style={type.title}>✕</Text>
            </Pressable>
            <Text style={[type.title, { flex: 1, marginLeft: 8 }]} numberOfLines={1}>{gameName}</Text>
          </View>
          <View style={{ flex: 1 }}>{body}</View>
        </SafeAreaView>
      </GlassBackground>
    )
  }

  const buttons = (
    <View style={styles.btnRow}>
      <Pressable onPress={() => setPanel((p) => (p === 'players' ? null : 'players'))} style={[styles.iconBtn, immersive && styles.iconBtnDark]} accessibilityRole="button" accessibilityLabel="Players">
        <Text style={styles.iconText}>👥</Text>
      </Pressable>
      {gameId !== 'chess' ? (
        <Pressable onPress={() => setPanel((p) => (p === 'chat' ? null : 'chat'))} style={[styles.iconBtn, immersive && styles.iconBtnDark]} accessibilityRole="button" accessibilityLabel="Chat">
          <Text style={styles.iconText}>💬</Text>
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>}
        </Pressable>
      ) : null}
      <Pressable onPress={() => { setPanel(null); setMenuOpen(true) }} style={[styles.iconBtn, immersive && styles.iconBtnDark]} accessibilityRole="button" accessibilityLabel="Menu">
        <Text style={[styles.iconText, immersive && { color: colors.onBrand }]}>☰</Text>
      </Pressable>
    </View>
  )

  const overlays = (
    <>
      {panel === 'players' && snap && (
        <View style={[styles.overlay, { top: insets.top + 56 }]}>
          <Card>
            <Text style={[type.label, { marginBottom: 4 }]}>Players · code {snap.code}</Text>
            {snap.roster.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                subtitle={p.id === snap.hostId ? 'Host' : null}
                right={p.id === snap.me.id
                  ? <Pill text="YOU" color={colors.magenta} />
                  : <Btn size="sm" title={muted.has(p.id) ? 'Unmute' : 'Mute'} onPress={() => toggleMute(p.id)} />}
              />
            ))}
            <Text style={[type.caption, { marginTop: 6 }]}>Muting hides that player’s chat messages on your phone.</Text>
          </Card>
        </View>
      )}
      {panel === 'chat' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.chatWrap, { bottom: insets.bottom + 12 }]} keyboardVerticalOffset={insets.top + 20}>
          <GlassCard tint={tint} intensity={85} radius={radii.md} padding={10} style={{ flex: 1 }}>
            <FlatList
              data={newestFirst}
              keyExtractor={(m, i) => String(m?.id ?? i)}
              style={{ maxHeight: 260 }}
              inverted
              ListEmptyComponent={<Text style={type.caption}>No messages yet. Say hi!</Text>}
              renderItem={({ item }) => (
                <View style={styles.msg}>
                  <Pressable
                    disabled={item.from === snap?.me?.id}
                    onPress={() => showPlayer({ id: item.from, username: nameOf[item.from], avatar: avatarOf[item.from] })}
                    hitSlop={6}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Text style={[type.caption, { color: item.from === snap?.me?.id ? colors.magenta : colors.textMuted }]}>
                      {item.from === snap?.me?.id ? 'You' : nameOf[item.from] || 'Player'}
                    </Text>
                  </Pressable>
                  <Text style={type.body}>{item.text}</Text>
                </View>
              )}
            />
            <View style={styles.chatInputRow}>
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Message"
                placeholderTextColor={colors.textFaint}
                style={styles.chatInput}
                maxLength={300}
                returnKeyType="send"
                onSubmitEditing={send}
              />
              <Btn title="Send" size="sm" variant="primary" onPress={send} disabled={!chatInput.trim() || snap?.status !== 'connected'} />
            </View>
          </GlassCard>
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
          <View style={[styles.floating, { top: insets.top + 6 }]}>{buttons}</View>
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
    <GlassBackground isDark={scheme !== 'light'}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={type.title} numberOfLines={1}>{gameName}</Text>
            {snap && <Text style={type.caption}>Code {snap.code} · {snap.roster.length} player{snap.roster.length === 1 ? '' : 's'}</Text>}
          </View>
          {buttons}
        </View>
        {snap && <View style={{ paddingHorizontal: 12 }}><ConnectionBanner status={snap.status === 'error' ? 'closed' : snap.status} /></View>}
        <View style={{ flex: 1 }}>{body}</View>
      </SafeAreaView>
      {overlays}
    </GlassBackground>
    </PlayerTapContext.Provider>
  )
}

const styles = StyleSheet.create({
  immersive: { flex: 1, backgroundColor: colors.ink },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  btnRow: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.glassBorderDark },
  iconBtnDark: { backgroundColor: 'rgba(0,0,0,0.45)', borderColor: 'rgba(255,255,255,0.25)' },
  iconText: { fontSize: 18, color: colors.text },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.magenta, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.onBrand },
  floating: { position: 'absolute', right: 12 },
  floatBanner: { position: 'absolute', left: 12, right: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { position: 'absolute', left: 12, right: 12 },
  chatWrap: { position: 'absolute', left: 12, right: 12, height: 340 },
  msg: { marginVertical: 4 },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chatInput: { flex: 1, ...type.body, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline },
})
