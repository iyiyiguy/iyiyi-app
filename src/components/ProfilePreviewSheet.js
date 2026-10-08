import { useEffect, useState } from 'react'
import { View, Text, Image, Modal, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import FollowButton from './FollowButton'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { avatarSource } from '../lib/avatarSource'

// Lightweight profile card shown over a running game (laser tag camera, live GPS games)
// so you can see who someone is and follow them without leaving the match.
// person: { id, username?, avatar? } - username/avatar are what the game already knows,
// shown until the real profile loads.
export default function ProfilePreviewSheet({ person, onClose }) {
  const visible = !!person?.id
  const [profile, setProfile] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!person?.id) return undefined
    let alive = true
    setProfile(null)
    setStatus(null)
    setFailed(false)
    setLoading(true)
    apiJson(`/api/profiles/${person.id}`)
      .then((p) => {
        if (!alive) return
        setProfile(p)
        setStatus(p?.is_following ? 'accepted' : p?.follow_status ?? null)
      })
      .catch(() => { if (alive) setFailed(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [person?.id])

  const name = profile?.username || person?.username || 'Player'
  const avatar = profile?.avatar_url || person?.avatar || null

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false} style={styles.panel}>
          <View style={styles.inner}>
            <View style={styles.row}>
              {avatar ? (
                <Image source={avatarSource(avatar)} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={type.title} numberOfLines={1}>{name}</Text>
                {profile ? (
                  <Text style={type.caption}>{profile.follower_count ?? 0} followers · {profile.following_count ?? 0} following</Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginTop: 16 }} />
            ) : failed ? (
              <Text style={[type.caption, { marginTop: 14 }]}>Couldn’t load this profile right now.</Text>
            ) : (
              <>
                {profile?.bio ? <Text style={[type.body, styles.bio]} numberOfLines={4}>{profile.bio}</Text> : null}
                <View style={styles.actions}>
                  <FollowButton userId={person?.id} status={status} onChange={(_, s) => setStatus(s)} style={styles.follow} />
                </View>
              </>
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
  panel: {},
  inner: { padding: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.inkSurfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.violet },
  avatarLetter: { color: colors.onBrand, fontSize: 24, fontWeight: '700' },
  bio: { color: colors.textMuted, marginTop: 12 },
  actions: { flexDirection: 'row', marginTop: 14 },
  follow: { minWidth: 120, paddingVertical: 10 },
})
