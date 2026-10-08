import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Press } from '../lib/motion'
import { colors, radii, type } from '../theme'
import GlassPanel from './GlassPanel'
import FollowButton from './FollowButton'
import { avatarSource } from '../lib/avatarSource'

const TIER_ACCENT = {
  premium: colors.gold,
  pro: colors.magenta,
  creator: colors.violet,
  normal: colors.textMuted,
}
const TIER_TINT = {
  premium: 'rgba(232,176,75,0.14)',
  pro: 'rgba(91,108,240,0.14)',
  creator: 'rgba(125,108,240,0.14)',
  normal: 'rgba(107,110,121,0.1)',
}

// followStatus / onFollowChange are optional; when a screen passes onFollowChange
// the card shows a Follow button. isSelf marks the signed-in user's own card with a
// "You" badge (and never shows Follow on it).
export default function UserCard({ user, onPress, layout = 'grid', followStatus, onFollowChange, rank, isSelf = false }) {
  if (!user) return null
  const accent = TIER_ACCENT[user.account_type] ?? TIER_ACCENT.normal
  const tint = TIER_TINT[user.account_type] ?? TIER_TINT.normal
  const userId = user.user_id ?? user.id
  const showFollow = !isSelf && !!onFollowChange && !!userId

  if (layout === 'list') {
    return (
      <Press onPress={onPress} scaleTo={0.98}>
        <GlassPanel radius={radii.lg} style={styles.listRow} lite animateIn={false}>
          <View style={styles.listRowInner}>
            {rank != null && <Text style={styles.rank}>{rank}</Text>}
            <View>
              <Image source={avatarSource(user.avatar_url)} style={styles.avatarSm} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={String(userId)} />
              {isSelf ? <View style={styles.youDot}><Text style={styles.youDotText}>You</Text></View> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: '600' }]} numberOfLines={1}>{user.username}</Text>
              <Text style={[type.caption, { color: accent }]}>{tierLabel(user.account_type)}</Text>
            </View>
            <TierMark tier={user.account_type} size={18} />
            {showFollow && <FollowButton userId={userId} status={followStatus} onChange={onFollowChange} />}
          </View>
        </GlassPanel>
      </Press>
    )
  }

  // Glass card: photo sits as a rounded thumbnail inside the padded panel, name/tag below -
  // matches the clear-glass redesign (photo stays a normal solid image, only the
  // surrounding panel is glass).
  return (
    <Press onPress={onPress} style={{ flex: 1 }} scaleTo={0.97}>
      <GlassPanel radius={28} style={styles.card} lite animateIn={false}>
        <View style={styles.cardInner}>
          <View>
            <Image source={avatarSource(user.avatar_url)} style={styles.avatar} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={String(userId)} />
            {isSelf ? (
              <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>
            ) : null}
          </View>
          <Text style={[type.body, { marginTop: 10, fontWeight: '700' }]} numberOfLines={1}>{user.username}</Text>
          <Text style={[type.caption, { marginTop: 1 }]} numberOfLines={1}>{user.tagline ?? tierLabel(user.account_type)}</Text>
          <View style={styles.cardFooter}>
            <View style={[styles.tag, { backgroundColor: tint }]}>
              <Text style={[styles.tagText, { color: accent }]}>{tierLabel(user.account_type)}</Text>
            </View>
            {showFollow ? (
              <FollowButton userId={userId} status={followStatus} onChange={onFollowChange} style={styles.followBtn} />
            ) : isSelf ? null : (
              <TierMark tier={user.account_type} size={16} />
            )}
          </View>
        </View>
      </GlassPanel>
    </Press>
  )
}

function tierLabel(tier) {
  if (tier === 'premium') return 'Premium'
  if (tier === 'pro') return 'Pro'
  if (tier === 'creator') return 'Creator'
  return 'Nearby'
}

function TierMark({ tier, size }) {
  if (tier === 'premium') return <Text style={{ fontSize: size }}>👑</Text>
  if (tier === 'pro') return <Text style={{ fontSize: size, color: colors.magenta }}>⭐</Text>
  if (tier === 'creator') return <Text style={{ fontSize: size, color: colors.violet }}>★</Text>
  return <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>+</Text></View>
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  cardInner: { padding: 12 },
  avatar: { width: '100%', height: 128, borderRadius: 20, backgroundColor: 'rgba(127,140,180,0.18)' },
  cardFooter: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  tagText: { fontSize: 11, fontWeight: '700' },
  followBtn: { minWidth: 0, paddingHorizontal: 10, paddingVertical: 5 },
  listRow: {},
  listRowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  rank: { ...type.title, width: 28, textAlign: 'center', color: colors.gold },
  avatarSm: { width: 46, height: 46, borderRadius: 23 },
  youBadge: {
    position: 'absolute', top: 8, left: 8, backgroundColor: colors.magenta, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  youText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  youDot: {
    position: 'absolute', bottom: -4, alignSelf: 'center', backgroundColor: colors.magenta, borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  youDotText: { color: '#fff', fontSize: 9, fontWeight: '700' },
})
