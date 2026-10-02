import { useState } from 'react'
import { View, Text, Modal, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'
import { MP_GAMES, getCurrentRoom, openRoom } from '../lib/multiplayer'
import { sendGameInvite } from '../lib/invites'

const CHALLENGE_GAMES = ['chess', 'lasertag', 'spider-spider', 'beside-them']
const SHORT = {
  chess: 'Online chess — moves sync live',
  lasertag: 'Free-for-all, Team Deathmatch or Search & Destroy',
  'spider-spider': 'Real-world tag — run from the spider',
  'beside-them': 'Find the imposter walking among you (4+ players)',
}

// Resolves once the room's channel is connected (or after a few seconds regardless —
// the invite still carries the code, and the lobby shows connection status).
function whenConnected(room, timeoutMs = 6000) {
  if (room.status === 'connected') return Promise.resolve()
  return new Promise((resolve) => {
    let off = null
    const t = setTimeout(() => { off?.(); resolve() }, timeoutMs)
    off = room.subscribe(() => {
      if (room.status === 'connected' || room.status === 'error') {
        clearTimeout(t)
        off?.()
        resolve()
      }
    })
  })
}

// "Challenge" on someone's profile: pick a multiplayer game, host a room for it, send
// them an invite with the join code, and go to the lobby to wait for them.
export default function ChallengeSheet({ visible, onClose, navigation, target }) {
  const [busy, setBusy] = useState(null)

  const host = async (gameId) => {
    setBusy(gameId)
    try {
      const room = await openRoom({ gameId, mode: 'host' })
      await whenConnected(room)
      if (room.status === 'error') throw new Error(room.error || 'Couldn’t start the game.')
      let inviteError = null
      try {
        await sendGameInvite(target.id, { gameId, code: room.code })
      } catch (e) {
        inviteError = e?.message || 'Couldn’t send the invite.'
      }
      onClose?.()
      navigation.navigate('GameLobby', { gameId, code: room.code })
      if (inviteError) {
        Alert.alert('Invite not sent', `${inviteError} Your game is open — share code ${room.code} with ${target.username || 'them'}.`)
      }
    } catch (e) {
      Alert.alert('Couldn’t start the game', e?.message || 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const pick = (gameId) => {
    if (busy) return
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing') {
      Alert.alert('You’re in a match', 'Finish or leave your current game before starting a new one.')
      return
    }
    if (current) {
      Alert.alert('Leave your current lobby?', `You’re in a ${MP_GAMES[current.gameId]?.name ?? 'game'} lobby (${current.code}). Starting a challenge will leave it.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave & challenge', onPress: () => host(gameId) },
      ])
      return
    }
    host(gameId)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false}>
          <View style={styles.inner}>
            <View style={styles.head}>
              <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>Challenge {target?.username ?? ''}</Text>
              <Pressable onPress={onClose} disabled={!!busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={[type.caption, { marginBottom: 8 }]}>You host the game; they get an invite to join your lobby.</Text>
            {CHALLENGE_GAMES.map((id) => {
              const g = MP_GAMES[id]
              return (
                <Pressable
                  key={id}
                  onPress={() => pick(id)}
                  disabled={!!busy}
                  style={({ pressed }) => [styles.option, pressed && { opacity: 0.75 }, busy && busy !== id && { opacity: 0.5 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.icon}>{g.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontWeight: '700' }]}>{g.name}</Text>
                    <Text style={type.caption} numberOfLines={2}>{SHORT[id]}</Text>
                  </View>
                  {busy === id ? <ActivityIndicator color={colors.textMuted} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
                </Pressable>
              )
            })}
          </View>
        </GlassPanel>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: 34 },
  inner: { padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginTop: 8,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  icon: { fontSize: 28 },
})
