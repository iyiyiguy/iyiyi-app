import { useState } from 'react'
import { View, Text, Modal, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'
import { MP_GAMES, getCurrentRoom, openRoom } from '../lib/multiplayer'
import { sendGameInvite } from '../lib/invites'
import { useT } from '../i18n'
import strings from '../i18n/strings/arcadeSocial'
import { mpGameName } from '../lib/games'

const CHALLENGE_GAMES = ['chess', 'lasertag', 'spider-spider', 'beside-them']

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
  const t = useT(strings)
  const [busy, setBusy] = useState(null)

  const host = async (gameId) => {
    setBusy(gameId)
    try {
      const room = await openRoom({ gameId, mode: 'host' })
      await whenConnected(room)
      if (room.status === 'error') throw new Error(room.error || t('err_start'))
      let inviteError = null
      try {
        await sendGameInvite(target.id, { gameId, code: room.code })
      } catch (e) {
        inviteError = e?.message || t('err_invite')
      }
      onClose?.()
      navigation.navigate('GameLobby', { gameId, code: room.code })
      if (inviteError) {
        Alert.alert(t('invite_not_sent'), t('invite_not_sent_msg', { err: inviteError, code: room.code, name: target.username || t('them') }))
      }
    } catch (e) {
      Alert.alert(t('cant_start_title'), e?.message || t('try_again'))
    } finally {
      setBusy(null)
    }
  }

  const pick = (gameId) => {
    if (busy) return
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing') {
      Alert.alert(t('in_match_title'), t('in_match_msg'))
      return
    }
    if (current) {
      Alert.alert(t('leave_lobby_title'), t('leave_lobby_msg', { game: MP_GAMES[current.gameId] ? mpGameName(current.gameId, MP_GAMES[current.gameId].name) : t('game'), code: current.code }), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('leave_challenge'), onPress: () => host(gameId) },
      ])
      return
    }
    host(gameId)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessibilityLabel={t('close')} />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false}>
          <View style={styles.inner}>
            <View style={styles.head}>
              <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>{t('challenge_title', { name: target?.username ?? '' })}</Text>
              <Pressable onPress={onClose} disabled={!!busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('close')}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={[type.caption, { marginBottom: 8 }]}>{t('challenge_sub')}</Text>
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
                    <Text style={[type.body, { fontWeight: '700' }]}>{mpGameName(id, g.name)}</Text>
                    <Text style={type.caption} numberOfLines={2}>{t(`short_${id}`)}</Text>
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
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: 34 },
  inner: { padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginTop: 8,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  icon: { fontSize: 28 },
})
