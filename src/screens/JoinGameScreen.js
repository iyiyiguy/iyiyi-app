import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { CODE_LENGTH, LASER_MODES, MP_GAMES, formatDistance, gameIdFromCode, isValidCode, normalizeCode, useNearbyRooms } from '../lib/multiplayer'
import { useOpenProfile } from '../lib/profileNav'
import {
  AC, ArcadeBackground, ArcadeHeader, GhostButton, PlayButton, StatusBarScrim, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { font } from '../theme'

// Open rooms advertised nearby (optionally for one game). Shared with GameLobby.
export function NearbyRoomsList({ gameId = null, onJoin }) {
  const { rooms, status, locationStatus, refresh } = useNearbyRooms(gameId)
  const openHost = useOpenProfile()
  return (
    <View>
      <View style={styles.listHeader}>
        <Text style={arcadeText.label}>Open games near you</Text>
        <Pressable onPress={refresh} hitSlop={10} accessibilityRole="button" style={styles.refresh}>
          <Ionicons name="refresh" size={13} color={AC.accent} />
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
      {locationStatus === 'denied' ? (
        <Text style={arcadeText.caption}>Turn on location for iYiYi in Settings to see games near you. You can still join with a code.</Text>
      ) : status === 'connecting' || locationStatus === 'pending' ? (
        <ActivityIndicator color={AC.muted} style={{ marginVertical: 12 }} />
      ) : status === 'error' ? (
        <Text style={arcadeText.caption}>Couldn't load nearby games. Check your connection and tap Refresh.</Text>
      ) : rooms.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="radio-outline" size={22} color={AC.faint} />
          <Text style={[arcadeText.caption, { textAlign: 'center' }]}>No open games nearby right now. Host one and invite people around you.</Text>
        </View>
      ) : (
        rooms.map((r) => {
          const g = MP_GAMES[r.gameId]
          return (
            <View key={`${r.gameId}:${r.code}`} style={styles.room}>
              <View style={styles.roomIconWrap}><Text style={styles.roomIcon}>{g?.icon}</Text></View>
              <Pressable
                style={{ flex: 1, minWidth: 0 }}
                disabled={!r.hostId}
                onPress={() => openHost(r.hostId)}
                accessibilityRole="button"
                accessibilityHint="Opens the host’s profile"
              >
                <Text style={styles.roomTitle} numberOfLines={1}>
                  {r.mode && LASER_MODES[r.mode] ? LASER_MODES[r.mode].name : g?.name} · <Text style={{ color: AC.accent }}>{r.hostName}</Text>
                </Text>
                <Text style={arcadeText.caption}>
                  {r.players}/{r.maxPlayers} players · about {formatDistance(r.distance)} away
                </Text>
              </Pressable>
              <PlayButton title="Join" icon="enter" small onPress={() => onJoin(r.gameId, r.code)} />
            </View>
          )
        })
      )}
    </View>
  )
}

export function CodeEntry({ onJoin, initialCode = '' }) {
  const [code, setCode] = useState(() => normalizeCode(initialCode))
  useEffect(() => {
    if (initialCode) setCode(normalizeCode(initialCode))
  }, [initialCode])
  const valid = isValidCode(code)
  return (
    <View>
      <Text style={[arcadeText.label, { marginBottom: 8 }]}>Join with a code</Text>
      <View style={styles.codeRow}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(normalizeCode(t))}
          placeholder="ABCDE"
          placeholderTextColor={AC.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          style={[styles.codeInput, valid && styles.codeInputValid]}
          returnKeyType="go"
          onSubmitEditing={() => valid && onJoin(code)}
          accessibilityLabel="Game code"
          keyboardAppearance="dark"
        />
        <PlayButton title="Join" icon="enter" disabled={!valid} onPress={() => onJoin(code)} />
      </View>
    </View>
  )
}

// Params: { code? } — set by the text-invite deep link (iyiyi://join/CODE, see App.js
// LINKING). A valid code goes straight to that game's lobby (the code's first letter names the
// game; GameLobby forwards Battle Royale codes to its own screen). An invalid one is left in
// the code box with a note.
export default function JoinGameScreen({ navigation, route }) {
  const insets = useArcadeInsets()
  useArcadeStatusBar()
  const joinRoom = (gid, code) => navigation.navigate('GameLobby', { gameId: gid, code })
  const linkCode = normalizeCode(route?.params?.code ?? '')
  const [linkError, setLinkError] = useState(null)
  const handled = useRef(null)

  useEffect(() => {
    if (!linkCode || handled.current === linkCode) return
    handled.current = linkCode
    try {
      const gid = gameIdFromCode(linkCode)
      if (!gid || !isValidCode(linkCode)) {
        setLinkError(`“${linkCode}” isn’t a valid game code. Check the invite and try again.`)
        return
      }
      setLinkError(null)
      // Replace so Back from the lobby doesn't land on this screen again.
      navigation.replace('GameLobby', { gameId: gid, code: linkCode })
    } catch {
      setLinkError('Couldn’t open that invite. Enter the code below to join.')
    }
  }, [linkCode, navigation])

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 60, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ArcadeHeader kicker="Arcade" title="Join a game" onBack={() => navigation.goBack()} />
        <Text style={[arcadeText.caption, { marginTop: 6, marginBottom: 18 }]}>Play with people around you.</Text>

        {linkError ? <Text style={styles.linkError}>{linkError}</Text> : null}
        <LinearGradient colors={AC.panel} style={styles.panel}>
          <CodeEntry initialCode={linkCode} onJoin={(code) => joinRoom(gameIdFromCode(code), code)} />
        </LinearGradient>
        <View style={{ height: 22 }} />
        <NearbyRoomsList onJoin={joinRoom} />

        <View style={{ height: 24 }} />
        <GhostButton title="Host a game instead" icon="add-circle" onPress={() => navigation.popTo('Tabs', { screen: 'Games' })} />
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  panel: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: AC.border },
  linkError: { fontSize: 13, color: AC.danger, marginBottom: 10 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshText: { fontSize: 13, ...font.semibold, color: AC.accent },
  emptyBox: { alignItems: 'center', gap: 8, padding: 18, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: AC.border },
  room: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10, borderRadius: 18, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  roomIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: AC.cardStrong, alignItems: 'center', justifyContent: 'center' },
  roomIcon: { fontSize: 24 },
  roomTitle: { fontSize: 15, ...font.bold, color: AC.text },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: {
    flex: 1,
    fontSize: 22,
    ...font.heavy,
    color: AC.text,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AC.border,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  codeInputValid: { borderColor: AC.live },
})
