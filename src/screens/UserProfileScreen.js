import { useCallback, useEffect, useRef, useState } from 'react'
import TagLinks from '../components/TagLinks'
import { View, Text, Image, StyleSheet, Pressable, Modal, Alert, ScrollView, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { openLink } from '../lib/socialLinks'
import SocialIcon from '../components/SocialIcon'
import ContentViewer from '../components/ContentViewer'
import FollowEverywhereSheet, { openPlatform, platformRows } from '../components/FollowEverywhereSheet'
import { apiJson } from '../lib/api'
import { shareProfileLink } from '../lib/shareLinks'
import { useT } from '../i18n'
import feStrings from '../i18n/strings/followEverywhere'
import profileStrings from '../i18n/strings/profile'
import socialStrings from '../i18n/strings/social'
import ChallengeSheet from '../components/ChallengeSheet'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HeaderButton } from '../components/BrandHeader'
import { openProfile, useMyUserId } from '../lib/profileNav'
import { maybeOfferPushAfterFollow } from '../lib/pushPrompt'
import ContentGrid from '../components/ContentGrid'
import ProfileMusic from '../components/ProfileMusic'
import Avatar from '../components/Avatar'
import { mediaArrayFrom, sortMediaNewest } from '../lib/myContent'

// Every paid tier the backend uses (Creator Pro is stored as 'pro_all', Business Pro as
// 'business_pro'; older rows may still carry the other names).
// [badge, social.js key]; the badge glyph stays, the tier word is translated.
const TIER_LABEL = {
  premium: ['👑', 'tierPremium'], pro: ['⭐', 'tierPro'], pro_local: ['⭐', 'tierPro'], pro_national: ['⭐', 'tierPro'], pro_all: ['⭐', 'tierPro'],
  creator: ['★', 'tierCreator'], business: ['✓', 'tierBusiness'], business_pro: ['✓', 'tierBusiness'], normal: null,
}
const tierLabel = (accountType, ts) => {
  const tier = TIER_LABEL[accountType]
  return tier ? `${tier[0]} ${ts(tier[1])}` : ''
}

// `reason` is what the server stores (kept in English for the review team); `key` is shown.
const REPORT_REASONS = [
  { reason: 'Harassment or abuse', key: 'reasonHarassment' },
  { reason: 'Fake profile / impersonation', key: 'reasonFake' },
  { reason: 'Inappropriate content', key: 'reasonInappropriate' },
  { reason: 'Spam', key: 'reasonSpam' },
  { reason: 'Other', key: 'reasonOther' },
]

export default function UserProfileScreen({ route, navigation }) {
  const { userId, preview = false, avatarUrl: avatarHint = null } = route.params
  const [profile, setProfile] = useState(null)
  const [media, setMedia] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [social, setSocial] = useState([])
  const [followAllOpen, setFollowAllOpen] = useState(false)
  const [platformDone, setPlatformDone] = useState({}) // platform -> true (followed via Follow Everywhere)
  const tf = useT(feStrings)
  const t = useT(profileStrings)
  const ts = useT(socialStrings)
  const [viewer, setViewer] = useState({ open: false, index: 0 })
  const [challengeOpen, setChallengeOpen] = useState(false)
  const myId = useMyUserId()
  const { width: winW } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const loadedOnce = useRef(false)

  const authedFetch = async (path, options = {}) => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error(t('signInAgain'))
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
    })
  }

  const load = async () => {
    const [profileRes, mediaRes] = await Promise.all([
      authedFetch(`/api/profiles/${userId}`),
      authedFetch(`/api/profiles/${userId}/media`),
    ])
    const profileJson = await profileRes.json().catch(() => null)
    if (!profileRes.ok || !profileJson || profileJson.error) {
      throw new Error(profileJson?.error || t('unavailable'))
    }
    // Some API responses leave the photo out (your own profile in Preview, for one); fall back
    // to the photo the caller already had so the hero never comes up blank.
    setProfile({ ...profileJson, avatar_url: profileJson.avatar_url || profileJson.avatar || profileJson.photo_url || avatarHint })
    const mediaJson = mediaRes.ok ? await mediaRes.json().catch(() => null) : null
    // The route orders by `position`, which camera posts never set - newest first instead.
    setMedia(sortMediaNewest(mediaArrayFrom(mediaJson)))
    loadedOnce.current = true
    loadPlatformDone()
    authedFetch(`/api/profiles/${userId}/social-content`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSocial(d?.items ?? []))
      .catch(() => setSocial([]))
  }

  const loadPlatformDone = () => {
    apiJson(`/api/platform-follows/status/${userId}`)
      .then((d) => setPlatformDone(Object.fromEntries((d?.platforms ?? []).map((p) => [p, true]))))
      .catch(() => {})
  }

  // Follow state changes made inside the Follow Everywhere sheet.
  const applyIyiyiStatus = (_id, status) => {
    setProfile((p) => {
      if (!p) return p
      const was = !!p.is_following
      const now = status === 'accepted'
      return { ...p, is_following: now, follow_status: status, follower_count: Math.max(0, (p.follower_count ?? 0) + (now ? 1 : 0) - (was ? 1 : 0)) }
    })
  }

  // Coming back to this profile (e.g. from the camera or a post) refreshes the posts grid
  // quietly; the first load above handles errors. A failed refresh keeps the current grid.
  const refreshMedia = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/profiles/${userId}/media`)
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      if (json) setMedia(sortMediaNewest(mediaArrayFrom(json)))
    } catch {
      // Keep what's shown.
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => {
    if (loadedOnce.current) refreshMedia()
  }, [refreshMedia]))

  useEffect(() => {
    loadedOnce.current = false
    load().catch((e) => {
      Alert.alert(t('couldntOpen'), e?.message ?? t('tryAgain'))
      if (navigation.canGoBack()) navigation.goBack()
    })
  }, [userId])

  const toggleFollow = async () => {
    if (!profile || followBusy) return
    setFollowBusy(true)
    const prev = profile
    const wasFollowing = profile.is_following
    const wasPending = profile.follow_status === 'pending'
    try {
      if (wasFollowing || wasPending) {
        setProfile((p) => ({
          ...p,
          is_following: false,
          follow_status: null,
          follower_count: p.follower_count - (wasFollowing ? 1 : 0),
        }))
        await authedFetch(`/api/profiles/follow/${userId}`, { method: 'DELETE' })
      } else {
        const res = await authedFetch(`/api/profiles/follow/${userId}`, { method: 'POST' })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || t('followFailed'))
        maybeOfferPushAfterFollow()
        setProfile((p) => ({
          ...p,
          is_following: json.status === 'accepted',
          follow_status: json.status,
          follower_count: p.follower_count + (json.status === 'accepted' ? 1 : 0),
        }))
      }
    } catch (e) {
      // Roll back the optimistic change.
      setProfile((p) => ({ ...p, is_following: prev.is_following, follow_status: prev.follow_status, follower_count: prev.follower_count }))
      Alert.alert(t('somethingWrong'), e?.message ?? t('tryAgain'))
    } finally {
      setFollowBusy(false)
    }
  }

  const shareProfile = () => {
    if (!profile) return
    shareProfileLink(profile.username, t('shareMessage', { username: profile.username }))
  }

  const blockUser = () => {
    setMenuOpen(false)
    Alert.alert(t('blockTitle', { name: profile?.username ?? t('thisUser') }), t('blockMsg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('block'), style: 'destructive', onPress: doBlock },
    ])
  }

  const doBlock = async () => {
    try {
      const res = await authedFetch(`/api/profiles/block/${userId}`, { method: 'POST' })
      if (!res.ok) throw new Error(t('blockFailedMsg'))
      navigation.goBack()
    } catch (e) {
      Alert.alert(t('couldntBlock'), e?.message ?? t('tryAgain'))
    }
  }

  const submitReport = async (reason) => {
    setReportOpen(false)
    try {
      const res = await authedFetch(`/api/profiles/report/${userId}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error(t('reportFailedMsg'))
      Alert.alert(t('reportSubmitted'), t('reportSubmittedMsg'))
      navigation.goBack()
    } catch (e) {
      Alert.alert(t('couldntReport'), e?.message ?? t('tryAgain'))
    }
  }

  if (!profile) {
    // Loading: the header and the photo we already have, instead of a blank screen.
    return (
      <View style={styles.screen}>
        <View style={[styles.headerBarRow, { paddingTop: insets.top + 6 }]}>
          <HeaderButton icon="chevron-back" onPress={() => navigation.goBack()} label={t('back')} />
        </View>
        <View style={[styles.hero, styles.heroTop]}>
          <View style={styles.heroAvatar}><Avatar uri={avatarHint} size={96} /></View>
          <View style={{ flex: 1, gap: 10 }}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: '55%' }]} />
          </View>
        </View>
      </View>
    )
  }

  const socials = profile.social_links ?? []
  const isPending = profile.follow_status === 'pending'
  const iyiyiActive = !!profile.is_following || isPending
  const rows = platformRows(socials)
  const everywhereLeft = rows.filter((r) => !platformDone[r.platform]).length + (iyiyiActive ? 0 : 1)

  const websites = profile.websites?.length ? profile.websites : profile.website ? [profile.website] : []
  const canSeeContent = profile.visibility !== 'private' || !!profile.is_following

  return (
    <View style={styles.screen}>
      <ScrollView>
        {/* Compact profile header: top bar, round photo next to the name and counts. */}
        <View style={[styles.headerBarRow, { paddingTop: insets.top + 6 }]}>
          <HeaderButton icon="chevron-back" onPress={() => navigation.goBack()} label={t('back')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <HeaderButton icon="share-outline" onPress={shareProfile} label={t('shareProfile')} />
            {preview ? null : <HeaderButton icon="ellipsis-horizontal" onPress={() => setMenuOpen(true)} label={t('more')} />}
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroAvatar}>
              <Avatar uri={profile.avatar_url} name={profile.username} size={96} transition={250} />
            </View>
            <View style={{ flex: 1 }}>
            <Text style={styles.heroName} numberOfLines={2}>{profile.username} {tierLabel(profile.account_type, ts)}</Text>
            <View style={styles.followRow}>
              <Text style={styles.followStat} accessibilityLabel={t('followersA11y', { n: profile.follower_count ?? 0 })}><Text style={styles.followStatNum}>{profile.follower_count ?? 0}</Text> {t('followersWord')}</Text>
              <Text style={styles.followStat} accessibilityLabel={t('followingA11yCount', { n: profile.following_count ?? 0 })}><Text style={styles.followStatNum}>{profile.following_count ?? 0}</Text> {t('followingWord')}</Text>
            </View>
            {profile.stats_public && (
              <Text style={styles.viewCount}>
                {t('profileViews', { n: profile.view_count ?? 0 })}{profile.like_count != null ? ` · ${t('likesCount', { n: profile.like_count })}` : ''}
              </Text>
            )}
            </View>
          </View>
            {preview ? null : <View style={styles.actionRow}>
              {rows.length > 0 ? (
                // The hero action: follow here and on every platform they've linked.
                <Pressable
                  onPress={() => setFollowAllOpen(true)}
                  style={({ pressed }) => [styles.everywhereButton, everywhereLeft === 0 && styles.everywhereDone, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${tf('followEverywhere')}, ${everywhereLeft ? tf('remaining', { n: everywhereLeft }) : tf('allDone', { name: profile.username, n: rows.length + 1 })}`}
                  accessibilityHint={tf('onPlatforms', { list: ['iYiYi', ...rows.map((r) => r.label)].join(', ') })}
                >
                  <View style={styles.everywhereIcons}>
                    {rows.slice(0, 3).map((r, i) => (
                      <View key={r.platform} style={[styles.everywhereIcon, i > 0 && { marginLeft: -6 }]}>
                        <SocialIcon platform={r.platform} size={11} color="#fff" />
                      </View>
                    ))}
                  </View>
                  <Text style={[styles.followButtonText, everywhereLeft === 0 && styles.followButtonTextActive]} numberOfLines={1}>
                    {everywhereLeft === 0 ? tf('following') : tf('followEverywhere')}
                  </Text>
                  {everywhereLeft > 0 ? <Text style={styles.everywhereLeft}>{tf('remaining', { n: everywhereLeft })}</Text> : null}
                </Pressable>
              ) : null}
              <Pressable
                onPress={toggleFollow}
                disabled={followBusy}
                style={[rows.length > 0 ? styles.followSecondary : styles.followButton, iyiyiActive && styles.followButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: iyiyiActive, busy: followBusy }}
                accessibilityLabel={profile.is_following ? t('followingA11y', { name: profile.username }) : isPending ? t('requestedA11y', { name: profile.username }) : t('followA11y', { name: profile.username })}
              >
                <Text style={[styles.followButtonText, iyiyiActive && styles.followButtonTextActive]}>
                  {profile.is_following ? tf('following') : isPending ? tf('requested') : tf('follow')}
                </Text>
              </Pressable>
              {myId !== userId && (
                <Pressable
                  onPress={() => setChallengeOpen(true)}
                  style={rows.length > 0 ? styles.challengeIcon : styles.challengeButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('challengeA11y', { name: profile.username })}
                >
                  <Ionicons name="game-controller-outline" size={rows.length > 0 ? 18 : 16} color={colors.onBrand} />
                  {rows.length > 0 ? null : <Text style={styles.followButtonText}>{t('challenge')}</Text>}
                </Pressable>
              )}
            </View>}
            {profile.visibility === 'private' && !profile.is_following && (
              <Text style={styles.privateNotice}>
                {isPending
                  ? t('privatePending')
                  : t('privateRequest')}
              </Text>
            )}
            {profile.tags?.length > 0 && (
              <View style={styles.tagRow}>
                {profile.tags.map((tag) => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
        </View>

        {preview ? (
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={16} color={colors.accent} />
            <Text style={styles.previewText}>{t('previewNote')}</Text>
          </View>
        ) : null}

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {/* Where else they are, near the top: labelled rows with your status on each. */}
        {canSeeContent && (rows.length > 0 || websites.length > 0) && (
          <View style={styles.platforms}>
            <Text style={styles.postsTitle}>{tf('subtitle', { n: rows.length + 1 })}</Text>
            {rows.map((r) => (
              <Pressable
                key={r.platform}
                onPress={() => openPlatform(r)}
                style={({ pressed }) => [styles.platformRow, pressed && { opacity: 0.6 }]}
                accessibilityRole="link"
                accessibilityLabel={`${r.handle ? ts('platformHandleA11y', { platform: r.label, handle: r.handle }) : `${r.label} ${r.value}`}, ${platformDone[r.platform] ? tf('statusFollowing') : tf('statusNotYet')}`}
              >
                <View style={styles.platformIcon}><SocialIcon platform={r.platform} size={18} color={colors.text} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.platformName}>{r.label}</Text>
                  <Text style={styles.platformHandle} numberOfLines={1}>{r.handle ? `@${r.handle}` : r.value}</Text>
                </View>
                <Text style={[styles.platformStatus, platformDone[r.platform] && { color: colors.success }]}>
                  {platformDone[r.platform] ? tf('statusFollowing') : tf('statusNotYet')}
                </Text>
              </Pressable>
            ))}
            {websites.map((site, i) => (
              <Pressable
                key={`w${i}`}
                onPress={() => openLink(site.startsWith('http') ? site : `https://${site}`)}
                style={({ pressed }) => [styles.platformRow, pressed && { opacity: 0.6 }]}
                accessibilityRole="link"
                accessibilityLabel={t('websiteA11y', { site })}
              >
                <View style={styles.platformIcon}><Ionicons name="link" size={18} color={colors.text} /></View>
                <Text style={[styles.platformHandle, { flex: 1 }]} numberOfLines={1}>{site.replace(/^https?:\/\//, '')}</Text>
                <Ionicons name="open-outline" size={15} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Their public music (sounds, songs, playlists); hidden when they have none. */}
        {canSeeContent && profile?.id ? (
          <ProfileMusic userId={profile.id} username={profile.username} navigation={navigation} style={{ marginHorizontal: 16, marginBottom: 14 }} />
        ) : null}

        {/* Posts first, right under the header. */}
        {canSeeContent && (
          <View style={styles.postsWrap}>
            <Text style={styles.postsTitle} accessibilityRole="header">{t('posts')}{media.length ? ` · ${media.length}` : ''}</Text>
            {media.length > 0 ? (
              <ContentGrid items={media} autoplay onOpen={(i) => setViewer({ open: true, index: i })} />
            ) : (
              <Text style={styles.postsEmpty}>{t('noPosts')}</Text>
            )}
          </View>
        )}

        {canSeeContent && (
          <TagLinks navigation={navigation} userId={profile.id} title={profile.username} />
        )}

        {canSeeContent && social.length > 0 && (
          <View style={styles.socialContent}>
            <Text style={styles.socialContentTitle} accessibilityRole="header">{t('latestYoutube')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
              {social.map((it) => (
                <Pressable key={it.id} onPress={() => openLink(it.url)} style={styles.socialCard} accessibilityRole="link" accessibilityLabel={it.title ? `YouTube: ${it.title}` : 'YouTube'}>
                  <Image source={{ uri: it.thumbnail }} style={styles.socialThumb} />
                  <Text style={styles.socialCardTitle} numberOfLines={2}>{it.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

      </ScrollView>

      <FollowEverywhereSheet
        visible={followAllOpen}
        onClose={() => { setFollowAllOpen(false); loadPlatformDone() }}
        profile={profile}
        iyiyiStatus={profile.is_following ? 'accepted' : profile.follow_status ?? null}
        onIyiyiStatus={applyIyiyiStatus}
      />

      <ContentViewer
        visible={viewer.open}
        items={media.map((m) => ({ ...m, owner_id: profile.id, owner_username: profile.username, owner_avatar_url: profile.avatar_url }))}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
        onOpenProfile={(id) => {
          setViewer({ open: false, index: 0 })
          // Tapping the owner here is this same profile; anyone else (tagged people) opens theirs.
          if (id !== profile.id) openProfile(navigation, id)
        }}
      />

      <ChallengeSheet
        visible={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        navigation={navigation}
        target={{ id: profile.id ?? userId, username: profile.username }}
      />

      <ActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <SheetOption label={t('reportUser')} danger onPress={() => { setMenuOpen(false); setReportOpen(true) }} />
        <SheetOption label={t('blockUser')} danger onPress={blockUser} />
        <SheetOption label={t('cancel')} onPress={() => setMenuOpen(false)} />
      </ActionSheet>

      <ActionSheet visible={reportOpen} onClose={() => setReportOpen(false)}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('reportWhy', { name: profile.username })}</Text>
        {REPORT_REASONS.map(({ reason, key }) => (
          <SheetOption key={reason} label={t(key)} onPress={() => submitReport(reason)} />
        ))}
        <SheetOption label={t('cancel')} onPress={() => setReportOpen(false)} />
      </ActionSheet>
    </View>
  )
}

function ActionSheet({ visible, onClose, children }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SheetOption({ label, onPress, danger }) {
  return (
    <Pressable onPress={onPress} style={styles.sheetOption} accessibilityRole="button">
      <Text style={[type.body, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  headerBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(91,108,240,0.12)' },
  previewText: { ...type.caption, color: colors.text, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: 'transparent' },
  heroWrap: { height: 480 },
  headerBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 4 },
  hero: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroAvatar: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  heroName: { ...type.title, color: colors.text, fontSize: 24, fontWeight: '800' },
  photo: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 24 },
  bio: { ...type.body, color: colors.textMuted, marginHorizontal: 20, marginTop: 16 },
  viewCount: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  followRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  followStat: { ...type.caption, color: colors.textMuted },
  followStatNum: { color: colors.text, fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  everywhereButton: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.magenta,
  },
  everywhereDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.magenta },
  everywhereIcons: { flexDirection: 'row', alignItems: 'center' },
  everywhereIcon: {
    width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(12,15,26,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
  },
  everywhereLeft: { color: colors.onBrandMuted, fontWeight: '600', fontSize: 12 },
  followSecondary: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.magenta,
  },
  challengeIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(13,7,16,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  platforms: { marginTop: 16, marginHorizontal: 16, gap: 2 },
  platformRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  platformIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFill },
  platformName: { ...type.body, fontWeight: '600' },
  platformHandle: { ...type.caption, color: colors.textMuted },
  platformStatus: { ...type.caption, fontWeight: '600', color: colors.textFaint },
  skeletonLine: { height: 16, width: '80%', borderRadius: 8, backgroundColor: colors.glassFill },
  challengeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: radii.pill, backgroundColor: 'rgba(13,7,16,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  followButton: {
    alignSelf: 'flex-start', paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: radii.pill, backgroundColor: colors.magenta,
  },
  followButtonActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.magenta },
  followButtonText: { color: colors.onBrand, fontWeight: '700' },
  followButtonTextActive: { color: colors.magenta },
  privateNotice: { ...type.caption, color: colors.textMuted, marginTop: 10 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: 'rgba(91,108,240,0.16)', borderWidth: 1, borderColor: colors.magenta,
  },
  tagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  back: {
    position: 'absolute', top: 50, left: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  menuButton: {
    position: 'absolute', top: 50, right: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  shareButton: {
    position: 'absolute', top: 50, right: 68, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  postsWrap: { marginTop: 16 },
  postsTitle: { ...type.label, marginHorizontal: 20, marginBottom: 10 },
  postsEmpty: { ...type.caption, marginHorizontal: 20 },
  socialContent: { marginTop: 20 },
  socialContentTitle: { ...type.label, marginHorizontal: 20, marginBottom: 10 },
  socialCard: { width: 170 },
  socialThumb: { width: 170, height: 96, borderRadius: radii.md, backgroundColor: colors.inkSurfaceRaised },
  socialCardTitle: { ...type.caption, color: colors.textMuted, marginTop: 6 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.inkSurfaceRaised, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    paddingBottom: 30, paddingTop: 8,
  },
  sheetTitle: { ...type.label, textAlign: 'center', paddingVertical: 12 },
  sheetOption: { padding: 18, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.hairline },
})
