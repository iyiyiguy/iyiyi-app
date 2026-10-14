import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Press } from '../lib/motion'
import { colors, radii, type } from '../theme'
import GlassPanel from './GlassPanel'
import FollowButton from './FollowButton'
import FollowEverywhereButton from './FollowEverywhereButton'
import SocialIcon from './SocialIcon'
import { formatDistance, platformsOf } from './FollowEverywhereSheet'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// Paid tiers get a small mark next to the name (normal accounts get nothing). The backend
// stores Creator Pro as 'pro_all' (older rows: 'pro', 'pro_local', 'pro_national') and
// Business Pro as 'business_pro' (older rows: 'business'); see useIsPro / iap BACKEND_TIER.
// labelKey: key in i18n/strings/social.
const PRO_TIER = { icon: 'star', color: colors.magenta, labelKey: 'tierPro' }
const BUSINESS_TIER = { icon: 'briefcase', color: colors.gold, labelKey: 'tierBusiness' }
const TIER = {
  premium: { icon: 'diamond', color: colors.gold, labelKey: 'tierPremium' },
  pro: PRO_TIER,
  pro_local: PRO_TIER,
  pro_national: PRO_TIER,
  pro_all: PRO_TIER,
  creator: { icon: 'sparkles', color: colors.violet, labelKey: 'tierCreator' },
  business: BUSINESS_TIER,
  business_pro: BUSINESS_TIER,
}

// A person in a list or grid: photo, name, how far away they are and the platforms they're on.
//   onFollowEverywhere(user, opts)  shows "Follow ×N" (follows on iYiYi now, then opens the
//                                   Follow Everywhere sheet via this callback)
//   onFollowChange                  older screens: a plain iYiYi Follow button instead
//   distanceHint                    shown when the payload has no distance (e.g. "Within 150 ft")
// isSelf marks the signed-in user's own card with a "You" badge (and never shows Follow on it).
export default function UserCard({
  user, onPress, layout = 'grid', followStatus, onFollowChange, onFollowEverywhere, distanceHint, rank, isSelf = false,
}) {
  const t = useT(strings)
  if (!user) return null
  const userId = user.user_id ?? user.id
  const tierDef = TIER[user.account_type]
  const tier = tierDef ? { ...tierDef, label: t(tierDef.labelKey) } : null
  const platforms = platformsOf(user) ?? []
  const distance = formatDistance(user) ?? distanceHint ?? null
  const meta = distance ?? user.tagline ?? tier?.label ?? null
  const canFollow = !isSelf && !!userId
  const follow = canFollow
    ? onFollowEverywhere
      ? (
        <FollowEverywhereButton
          user={user}
          status={followStatus}
          onStatus={onFollowChange}
          onOpen={onFollowEverywhere}
          showIcons={false}
          style={layout === 'grid' ? styles.followWide : null}
        />
      )
      : onFollowChange
        ? <FollowButton userId={userId} name={user.username} status={followStatus} onChange={onFollowChange} style={layout === 'grid' ? styles.followWide : null} />
        : null
    : null
  const a11y = [
    rank != null ? t('rankA11y', { n: rank }) : null,
    user.username,
    isSelf ? t('you') : null,
    tier?.label,
    distance,
    platforms.length ? t('onPlatformsA11y', { list: platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(', ') }) : null,
  ].filter(Boolean).join(', ')

  // The card body and the Follow button are separate touch targets (a pressable card would
  // swallow the button for VoiceOver / TalkBack).
  if (layout === 'list') {
    return (
      <GlassPanel radius={radii.lg} style={styles.listRow} lite animateIn={false}>
        <View style={styles.listRowInner}>
          <Press onPress={onPress} scaleTo={0.98} style={styles.listMain} accessibilityLabel={a11y}>
            <View style={styles.listMainInner}>
              {rank != null && <Text style={styles.rank}>{rank}</Text>}
              <View>
                <Image source={avatarSource(user?.avatar_url)} style={styles.avatarSm} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={String(userId)} />
                {isSelf ? <View style={styles.youDot}><Text style={styles.youDotText}>{t('you')}</Text></View> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <NameLine name={user.username} tier={tier} />
                <MetaLine meta={meta} platforms={platforms} />
              </View>
            </View>
          </Press>
          {follow}
        </View>
      </GlassPanel>
    )
  }

  return (
    <GlassPanel radius={28} style={styles.card} lite animateIn={false}>
      <View style={styles.cardInner}>
        <Press onPress={onPress} scaleTo={0.97} accessibilityLabel={a11y}>
          <View>
            <Image source={avatarSource(user?.avatar_url)} style={styles.avatar} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={String(userId)} />
            {isSelf ? (
              <View style={styles.youBadge}><Text style={styles.youText}>{t('you')}</Text></View>
            ) : null}
            {distance ? (
              <View style={styles.distancePill}>
                <Ionicons name="navigate" size={10} color="#fff" />
                <Text style={styles.distanceText} numberOfLines={1}>{distance}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ marginTop: 10 }}><NameLine name={user.username} tier={tier} /></View>
          <MetaLine meta={distance ? (user.tagline ?? tier?.label ?? null) : meta} platforms={platforms} />
        </Press>
        {follow ? <View style={styles.cardFooter}>{follow}</View> : null}
      </View>
    </GlassPanel>
  )
}

function NameLine({ name, tier }) {
  return (
    <View style={styles.nameRow}>
      <Text style={[type.body, styles.name]} numberOfLines={1}>{name}</Text>
      {tier ? <Ionicons name={tier.icon} size={13} color={tier.color} accessibilityLabel={tier.label} /> : null}
    </View>
  )
}

function MetaLine({ meta, platforms }) {
  if (!meta && !platforms.length) return <View style={styles.metaSpacer} />
  return (
    <View style={styles.metaRow}>
      {platforms.length ? (
        <View style={styles.platforms}>
          {platforms.slice(0, 5).map((p) => <SocialIcon key={p} platform={p} size={12} color={colors.textMuted} />)}
          {platforms.length > 5 ? <Text style={styles.more}>+{platforms.length - 5}</Text> : null}
        </View>
      ) : null}
      {meta ? <Text style={[type.caption, { flexShrink: 1 }]} numberOfLines={1}>{meta}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  cardInner: { padding: 12 },
  avatar: { width: '100%', height: 120, borderRadius: 20, backgroundColor: 'rgba(127,140,180,0.18)' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontWeight: '700', flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, minHeight: 18 },
  metaSpacer: { height: 18, marginTop: 2 },
  platforms: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  more: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  cardFooter: { marginTop: 10 },
  followWide: { alignSelf: 'stretch', minWidth: 0 },
  distancePill: {
    position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(12,15,26,0.62)', maxWidth: '90%',
  },
  distanceText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  listRow: {},
  listRowInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  listMain: { flex: 1 },
  listMainInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
