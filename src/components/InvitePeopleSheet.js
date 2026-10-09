import { useEffect, useMemo, useState } from 'react'
import { View, Text, Image, Modal, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import { GlassButton } from './GlassButton'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { fetchCameraNearby } from '../lib/cameraApi'
import { getMyUserId } from '../lib/profileNav'
import { MP_GAMES } from '../lib/multiplayer'
import { sendGameInvite } from '../lib/invites'
import { inviteByText } from '../lib/textInvite'
import { avatarSource } from '../lib/avatarSource'

// "Invite" sheet: people within 150 ft (same lookup the camera uses), everyone you follow and
// everyone who follows you. Each row sends an invite to that person's inbox.
// Game lobbies pass gameId + code; anything else (events, ...) passes onInvite(user) plus a
// title/subtitle. excludeIds: people already in the room / already invited.
export default function InvitePeopleSheet({ visible, onClose, gameId, code, excludeIds = [], onInvite, title, subtitle }) {
  const [nearby, setNearby] = useState([])
  const [following, setFollowing] = useState([])
  const [followers, setFollowers] = useState([])
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState({}) // id -> 'sending' | 'sent' | 'error'

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    setLoading(true)
    ;(async () => {
      const myId = await getMyUserId()
      const near = (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync()
          if (perm.status !== 'granted') return []
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          const d = await fetchCameraNearby(loc.coords.latitude, loc.coords.longitude)
          return Array.isArray(d?.users) ? d.users : []
        } catch {
          return []
        }
      })()
      const follows = (async () => {
        if (!myId) return []
        try {
          const d = await apiJson(`/api/profiles/${myId}/following`)
          return Array.isArray(d?.following) ? d.following : []
        } catch {
          return []
        }
      })()
      const fans = (async () => {
        if (!myId) return []
        try {
          const d = await apiJson(`/api/profiles/${myId}/followers`)
          return Array.isArray(d?.followers) ? d.followers : []
        } catch {
          return []
        }
      })()
      const [n, f, fl] = await Promise.all([near, follows, fans])
      if (!alive) return
      setNearby(n.filter((u) => u?.id && u.id !== myId))
      setFollowing(f.filter((u) => u?.id && u.id !== myId))
      setFollowers(fl.filter((u) => u?.id && u.id !== myId))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [visible])

  useEffect(() => { if (!visible) setSent({}) }, [visible])

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])
  const nearIds = useMemo(() => new Set(nearby.map((u) => u.id)), [nearby])
  const nearList = nearby.filter((u) => !exclude.has(u.id))
  const followList = following.filter((u) => !exclude.has(u.id) && !nearIds.has(u.id))
  const followIds = useMemo(() => new Set(following.map((u) => u.id)), [following])
  const fanList = followers.filter((u) => !exclude.has(u.id) && !nearIds.has(u.id) && !followIds.has(u.id))

  const invite = async (u) => {
    if (sent[u.id] === 'sending' || sent[u.id] === 'sent') return
    setSent((s) => ({ ...s, [u.id]: 'sending' }))
    try {
      if (onInvite) await onInvite(u)
      else await sendGameInvite(u.id, { gameId, code })
      setSent((s) => ({ ...s, [u.id]: 'sent' }))
    } catch {
      setSent((s) => ({ ...s, [u.id]: 'error' }))
    }
  }

  const renderRow = (u, key) => {
    const st = sent[u.id]
    return (
      <View key={key} style={styles.row}>
        {<Image source={avatarSource(u?.avatar_url)} style={styles.avatar} />}
        <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{u.username ?? 'iYiYi user'}</Text>
        <GlassButton size="sm" variant={st === 'sent' ? 'glass' : 'primary'} disabled={st === 'sending' || st === 'sent'} onPress={() => invite(u)}>
          {st === 'sending' ? 'Sending…' : st === 'sent' ? 'Invited' : st === 'error' ? 'Retry' : 'Invite'}
        </GlassButton>
      </View>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false}>
          <View style={styles.inner}>
            <View style={styles.head}>
              <Text style={[type.title, { flex: 1 }]}>{title || `Invite to ${MP_GAMES[gameId]?.name ?? 'game'}`}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={type.caption}>{subtitle || `They get a challenge with code ${code} to jump straight into this lobby.`}</Text>
            {!onInvite && code ? (
              <Pressable
                onPress={() => inviteByText({ gameName: MP_GAMES[gameId]?.name, code })}
                style={({ pressed }) => [styles.textInvite, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Invite by text message"
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.magenta} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.textInviteTitle}>Invite by text</Text>
                  <Text style={type.caption} numberOfLines={1}>Send the code and app link to anyone, even without iYiYi</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
            {loading ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView style={{ maxHeight: 420, marginTop: 8 }}>
                <Text style={styles.section}>Nearby</Text>
                {nearList.length ? nearList.map((u) => renderRow(u, `n-${u.id}`)) : (
                  <Text style={type.caption}>No one within 150 ft right now.</Text>
                )}
                <Text style={styles.section}>People you follow</Text>
                {followList.length ? followList.map((u) => renderRow(u, `f-${u.id}`)) : (
                  <Text style={type.caption}>{following.length ? 'Everyone you follow is already listed.' : 'You aren’t following anyone yet.'}</Text>
                )}
                {fanList.length ? <Text style={styles.section}>Your followers</Text> : null}
                {fanList.map((u) => renderRow(u, `fl-${u.id}`))}
              </ScrollView>
            )}
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
  section: { ...type.label, marginTop: 14, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.inkSurfaceRaised },
  textInvite: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  textInviteTitle: { ...type.body, fontWeight: '700' },
})
