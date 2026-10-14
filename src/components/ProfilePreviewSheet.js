import { useEffect } from 'react'
import { View, Text, Image, Modal, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GameFollowButton from './GameFollowButton'
import { avatarSource } from '../lib/avatarSource'
import { useFollow, loadProfile } from '../lib/followCache'
import { useOpenProfile } from '../lib/profileNav'

// Player card shown over a running game (laser tag camera, live GPS games, party games):
// who someone is, Follow (teammates and enemies alike) and View profile, without the
// match stopping behind it. The game screen stays mounted under the profile screen, so
// "View profile" then Back returns to the same match.
// person: { id, username?, avatar?, teamColor?, teamLabel?, line? } - what the game knows,
// shown until the real profile loads.
export default function ProfilePreviewSheet({ person, onClose }) {
  const visible = !!person?.id
  const insets = useSafeAreaInsets()
  const openProfile = useOpenProfile()
  const { profile, loaded } = useFollow(person?.id)

  useEffect(() => { if (person?.id) loadProfile(person.id) }, [person?.id])

  const name = profile?.username || person?.username || 'Player'
  const avatar = profile?.avatar_url || person?.avatar || null
  const team = person?.teamColor || '#3ad1ff'

  const viewProfile = () => {
    const id = person?.id
    const av = avatar
    onClose?.()
    if (id) setTimeout(() => openProfile(id, av), 50)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close player card" />
      <View style={[s.sheet, { paddingBottom: 18 + insets.bottom, borderTopColor: team }]}>
        <View style={s.grab} />
        <View style={s.row}>
          {avatar ? (
            <Image source={avatarSource(avatar)} style={[s.avatar, { borderBottomColor: team }]} />
          ) : (
            <View style={[s.avatar, s.avatarFallback, { borderBottomColor: team }]}>
              <Text style={s.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {person?.teamLabel ? <Text style={[s.kicker, { color: team }]} numberOfLines={1}>{person.teamLabel}</Text> : null}
            <Text style={s.name} numberOfLines={1}>{name}</Text>
            {profile ? (
              <Text style={s.meta} numberOfLines={1}>{profile.follower_count ?? 0} followers · {profile.following_count ?? 0} following</Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="rgba(255,255,255,0.66)" />
          </Pressable>
        </View>
        {person?.line ? <Text style={s.line}>{person.line}</Text> : null}
        {!loaded ? <ActivityIndicator color="rgba(255,255,255,0.66)" style={{ marginTop: 14 }} /> : null}
        {profile?.bio ? <Text style={s.bio} numberOfLines={3}>{profile.bio}</Text> : null}
        <View style={s.actions}>
          <GameFollowButton userId={person?.id} name={name} style={s.follow} />
          <Pressable onPress={viewProfile} accessibilityRole="button" style={({ pressed }) => [s.ghost, pressed && { opacity: 0.8 }]}>
            <Text style={s.ghostTxt}>VIEW PROFILE</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>The match keeps running behind this card.</Text>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6,8,12,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#101318', borderTopWidth: 2, paddingHorizontal: 18, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 60, height: 60, borderRadius: 3, backgroundColor: '#2a3038', borderBottomWidth: 3 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontSize: 26, fontWeight: '900' },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.8, textTransform: 'uppercase' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 0.6 },
  meta: { color: 'rgba(255,255,255,0.66)', fontSize: 13, fontWeight: '600', marginTop: 1 },
  line: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginTop: 12 },
  bio: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  follow: { flex: 1.3, height: 50 },
  ghost: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', borderRadius: 3 },
  ghostTxt: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', marginTop: 10 },
})
