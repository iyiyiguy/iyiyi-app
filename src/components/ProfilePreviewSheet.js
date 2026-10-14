import { useEffect } from 'react'
import { View, Text, Image, Modal, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GameFollowButton from './GameFollowButton'
import { avatarSource } from '../lib/avatarSource'
import { useFollow, loadProfile } from '../lib/followCache'
import { useOpenProfile } from '../lib/profileNav'
import { FONT, ST, stType, useStudioFonts } from '../games/studio'

// Player card shown over a running game (laser tag camera, live GPS games, party games):
// who someone is, Follow (teammates and enemies alike) and View profile, without the
// match stopping behind it. The game screen stays mounted under the profile screen, so
// "View profile" then Back returns to the same match. Studio look (Player.dc.html): square
// avatar with a team-colour bar, relation kicker, stat tiles, FOLLOW + VIEW PROFILE.
// person: { id, username?, avatar?, teamColor?, teamLabel?, relation?, stats?, line? } - what
// the game knows, shown until the real profile loads. relation: 'teammate' | 'enemy' |
// 'opponent'; stats: [{ label, value, color? }] (this-match numbers, shown first).
const RELATION = { teammate: 'Teammate', enemy: 'Enemy', opponent: 'Opponent' }

function compact(n) {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}m`
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`
  return String(v)
}

export default function ProfilePreviewSheet({ person, onClose }) {
  useStudioFonts()
  const visible = !!person?.id
  const insets = useSafeAreaInsets()
  const openProfile = useOpenProfile()
  const { profile, loaded } = useFollow(person?.id)

  useEffect(() => { if (person?.id) loadProfile(person.id) }, [person?.id])

  const name = profile?.username || person?.username || 'Player'
  const avatar = profile?.avatar_url || person?.avatar || null
  const relation = RELATION[person?.relation] ? person.relation : null
  const team = person?.teamColor || (relation === 'teammate' ? ST.friendly : relation ? ST.enemy : ST.friendly)
  const kicker = [person?.teamLabel, relation ? RELATION[relation] : null].filter(Boolean).join(' · ')

  const tiles = [
    ...(Array.isArray(person?.stats) ? person.stats.filter((x) => x && x.label != null) : []),
    ...(profile ? [
      { label: 'Followers', value: compact(profile.follower_count) },
      { label: 'Following', value: compact(profile.following_count) },
    ] : []),
  ].slice(0, 3)

  const viewProfile = () => {
    const id = person?.id
    const av = avatar
    onClose?.()
    if (id) setTimeout(() => openProfile(id, av), 50)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close player card" />
      <View style={[s.sheet, { paddingBottom: 16 + insets.bottom, borderTopColor: team }]}>
        <View style={s.grab} />
        <View style={s.row}>
          {avatar ? (
            <Image source={avatarSource(avatar)} style={[s.avatar, { borderBottomColor: team }]} />
          ) : (
            <View style={[s.avatar, s.avatarFallback, { borderBottomColor: team }]}>
              <Text style={s.avatarLetter} allowFontScaling={false}>{name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {kicker ? <Text style={[s.kicker, { color: team }]} numberOfLines={1}>{kicker}</Text> : null}
            <Text style={s.name} numberOfLines={1}>{name}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [s.close, pressed && { opacity: 0.7 }]}>
            <Ionicons name="close" size={20} color={ST.muted} />
          </Pressable>
        </View>

        {tiles.length ? (
          <View style={s.tiles}>
            {tiles.map((x) => (
              <View key={x.label} style={s.tile}>
                <Text style={s.tileLabel} numberOfLines={1}>{x.label}</Text>
                <Text style={[s.tileValue, x.color && { color: x.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{x.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {person?.line ? <Text style={s.line}>{person.line}</Text> : null}
        {!loaded ? <ActivityIndicator color={ST.muted} style={{ marginTop: 12 }} /> : null}
        {profile?.bio ? <Text style={s.bio} numberOfLines={3}>{profile.bio}</Text> : null}

        <View style={s.actions}>
          <GameFollowButton userId={person?.id} name={name} style={s.follow} />
          <Pressable onPress={viewProfile} accessibilityRole="button" accessibilityLabel={`View ${name}’s profile`} style={({ pressed }) => [s.ghost, pressed && { opacity: 0.8 }]}>
            <Text style={s.ghostTxt}>VIEW PROFILE</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>The match keeps running behind this card.</Text>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6,8,12,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: ST.ground2, borderTopWidth: 2, paddingHorizontal: 18, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 36, height: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 0, backgroundColor: '#3c434c', borderBottomWidth: 3 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: FONT.display, color: ST.text, fontSize: 28, includeFontPadding: false },
  kicker: { ...stType.label, letterSpacing: 1.8 },
  name: { fontFamily: FONT.display, color: ST.text, fontSize: 24, includeFontPadding: false },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line },
  tiles: { flexDirection: 'row', gap: 6, marginTop: 14 },
  tile: { flex: 1, minWidth: 0, padding: 8, backgroundColor: ST.cell, borderRadius: 2, gap: 2 },
  tileLabel: { ...stType.label },
  tileValue: { fontFamily: FONT.display, fontSize: 17, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  line: { fontFamily: FONT.uiSemi, color: 'rgba(242,244,247,0.8)', fontSize: 13, marginTop: 12 },
  bio: { ...stType.body, color: 'rgba(242,244,247,0.7)', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  follow: { flex: 1.3, height: 50 },
  ghost: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ST.lineStrong, borderRadius: ST.radius },
  ghostTxt: { fontFamily: FONT.display, color: '#ffffff', fontSize: 13, letterSpacing: 1.2, includeFontPadding: false },
  hint: { fontFamily: FONT.uiSemi, color: 'rgba(242,244,247,0.6)', fontSize: 12, marginTop: 10 },
})
