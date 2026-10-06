import { useCallback, useEffect, useRef, useState } from 'react'
import TagLinks from '../components/TagLinks'
import { View, Text, Image, StyleSheet, Pressable, Modal, Alert, Share, ScrollView, useWindowDimensions } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type, onImageType } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { socialUrl, openLink } from '../lib/socialLinks'
import SocialIcon from '../components/SocialIcon'
import ContentViewer from '../components/ContentViewer'
import FollowEverywhereSheet from '../components/FollowEverywhereSheet'
import ChallengeSheet from '../components/ChallengeSheet'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HeaderButton } from '../components/BrandHeader'
import { openProfile, useMyUserId } from '../lib/profileNav'
import ContentGrid from '../components/ContentGrid'
import Avatar from '../components/Avatar'
import { mediaArrayFrom, sortMediaNewest } from '../lib/myContent'

const TIER_LABEL = { premium: '👑 Premium', pro: '⭐ Pro', creator: '★ Creator', normal: '' }

const REPORT_REASONS = [
  'Harassment or abuse',
  'Fake profile / impersonation',
  'Inappropriate content',
  'Spam',
  'Other',
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
  const [viewer, setViewer] = useState({ open: false, index: 0 })
  const [challengeOpen, setChallengeOpen] = useState(false)
  const myId = useMyUserId()
  const { width: winW } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const loadedOnce = useRef(false)

  const authedFetch = async (path, options = {}) => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error('Please sign in again')
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
      throw new Error(profileJson?.error || "This profile isn't available.")
    }
    // Some API responses leave the photo out (your own profile in Preview, for one); fall back
    // to the photo the caller already had so the hero never comes up blank.
    setProfile({ ...profileJson, avatar_url: profileJson.avatar_url || profileJson.avatar || profileJson.photo_url || avatarHint })
    const mediaJson = mediaRes.ok ? await mediaRes.json().catch(() => null) : null
    // The route orders by `position`, which camera posts never set - newest first instead.
    setMedia(sortMediaNewest(mediaArrayFrom(mediaJson)))
    loadedOnce.current = true
    authedFetch(`/api/profiles/${userId}/social-content`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSocial(d?.items ?? []))
      .catch(() => setSocial([]))
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
      Alert.alert("Couldn't open profile", e?.message ?? 'Please try again.')
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
        if (!res.ok) throw new Error(json?.error || 'Could not follow')
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
      Alert.alert('Something went wrong', e?.message ?? 'Please try again.')
    } finally {
      setFollowBusy(false)
    }
  }

  const shareProfile = () => {
    if (!profile) return
    Share.share({
      message: `Check out @${profile.username}'s iYiYi profile: https://iyiyi.iyiyiguy.workers.dev/iyiyi-app/profile/${profile.username}`,
    }).catch(() => {})
  }

  const blockUser = async () => {
    setMenuOpen(false)
    try {
      const res = await authedFetch(`/api/profiles/block/${userId}`, { method: 'POST' })
      if (!res.ok) throw new Error('Could not block this user. Please try again.')
      navigation.goBack()
    } catch (e) {
      Alert.alert("Couldn't block", e?.message ?? 'Please try again.')
    }
  }

  const submitReport = async (reason) => {
    setReportOpen(false)
    try {
      const res = await authedFetch(`/api/profiles/report/${userId}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error('Could not send the report. Please try again.')
      Alert.alert('Report submitted', "Thanks — this user has been blocked and we'll review your report.")
      navigation.goBack()
    } catch (e) {
      Alert.alert("Couldn't send report", e?.message ?? 'Please try again.')
    }
  }

  if (!profile) return <View style={styles.screen} />

  const socials = profile.social_links ?? []
  const isPending = profile.follow_status === 'pending'

  const websites = profile.websites?.length ? profile.websites : profile.website ? [profile.website] : []
  const canSeeContent = profile.visibility !== 'private' || !!profile.is_following

  return (
    <View style={styles.screen}>
      <ScrollView>
        <View style={[styles.heroWrap, { height: Math.max(340, Math.min(440, Math.round((winW || 390) * 1.0))) }]}>
          <Avatar uri={profile.avatar_url} name={profile.username} fill radius={0} transition={250} />
          <LinearGradient colors={['transparent', 'rgba(13,7,16,0.95)']} style={styles.overlay}>
            <Text style={onImageType.display}>{profile.username} {TIER_LABEL[profile.account_type]}</Text>
            <View style={styles.followRow}>
              <Text style={styles.followStat}><Text style={styles.followStatNum}>{profile.follower_count ?? 0}</Text> followers</Text>
              <Text style={styles.followStat}><Text style={styles.followStatNum}>{profile.following_count ?? 0}</Text> following</Text>
            </View>
            {profile.stats_public && (
              <Text style={styles.viewCount}>
                {profile.view_count} profile views{profile.like_count != null ? ` · ${profile.like_count} likes` : ''}
              </Text>
            )}
            {preview ? null : <View style={styles.actionRow}>
              <Pressable onPress={toggleFollow} disabled={followBusy} style={[styles.followButton, (profile.is_following || isPending) && styles.followButtonActive]}>
                <Text style={[styles.followButtonText, (profile.is_following || isPending) && styles.followButtonTextActive]}>
                  {profile.is_following ? 'Following' : isPending ? 'Requested' : 'Follow'}
                </Text>
              </Pressable>
              {myId !== userId && (
                <Pressable
                  onPress={() => setChallengeOpen(true)}
                  style={styles.challengeButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Challenge ${profile.username} to a game`}
                >
                  <Ionicons name="game-controller-outline" size={16} color={colors.onBrand} />
                  <Text style={styles.followButtonText}>Challenge</Text>
                </Pressable>
              )}
            </View>}
            {profile.visibility === 'private' && !profile.is_following && (
              <Text style={styles.privateNotice}>
                {isPending
                  ? '🔒 This account is private. Your follow request is pending approval.'
                  : '🔒 This account is private. Send a follow request to see their photos, tags, and socials.'}
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
          </LinearGradient>

          <View style={[styles.headerBar, { top: insets.top + 6 }]} pointerEvents="box-none">
            <HeaderButton icon="chevron-back" onPress={() => navigation.goBack()} label="Back" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <HeaderButton icon="share-outline" onPress={shareProfile} label="Share profile" />
              {preview ? null : <HeaderButton icon="ellipsis-horizontal" onPress={() => setMenuOpen(true)} label="More" />}
            </View>
          </View>
        </View>

        {preview ? (
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={16} color={colors.accent} />
            <Text style={styles.previewText}>This is how your profile looks to other people.</Text>
          </View>
        ) : null}

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {/* Posts first, right under the header. */}
        {canSeeContent && (
          <View style={styles.postsWrap}>
            <Text style={styles.postsTitle}>Posts{media.length ? ` · ${media.length}` : ''}</Text>
            {media.length > 0 ? (
              <ContentGrid items={media} autoplay onOpen={(i) => setViewer({ open: true, index: i })} />
            ) : (
              <Text style={styles.postsEmpty}>No posts yet.</Text>
            )}
          </View>
        )}

        {canSeeContent && socials.length > 0 && (
          <Pressable onPress={() => setFollowAllOpen(true)} style={styles.followAll}>
            <Text style={styles.followAllText}>Follow everywhere ›</Text>
          </Pressable>
        )}

        {canSeeContent && (
          <TagLinks navigation={navigation} userId={profile.id} title={profile.username} />
        )}

        {canSeeContent && social.length > 0 && (
          <View style={styles.socialContent}>
            <Text style={styles.socialContentTitle}>Latest on YouTube</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
              {social.map((it) => (
                <Pressable key={it.id} onPress={() => openLink(it.url)} style={styles.socialCard}>
                  <Image source={{ uri: it.thumbnail }} style={styles.socialThumb} />
                  <Text style={styles.socialCardTitle} numberOfLines={2}>{it.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {canSeeContent && (
        <View style={styles.socialBar}>
          {socials.map((link, i) => (
            <Pressable
              key={i}
              style={styles.socialPill}
              onPress={() => {
                const url = socialUrl(link.platform, link.value)
                if (url) openLink(url)
              }}
            >
              <SocialIcon platform={link.platform} size={32} color={colors.text} />
            </Pressable>
          ))}
          {websites.map((site, i) => (
            <Pressable
              key={i}
              style={styles.socialPill}
              onPress={() => {
                const url = site.startsWith('http') ? site : `https://${site}`
                openLink(url)
              }}
            >
              <Text style={{ fontSize: 24 }}>🔗</Text>
            </Pressable>
          ))}
        </View>
        )}
      </ScrollView>

      <FollowEverywhereSheet
        visible={followAllOpen}
        onClose={() => setFollowAllOpen(false)}
        profile={profile}
        iyiyiStatus={profile.is_following ? 'accepted' : profile.follow_status}
        onToggleIyiyi={toggleFollow}
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
        <SheetOption label="Report user" danger onPress={() => { setMenuOpen(false); setReportOpen(true) }} />
        <SheetOption label="Block user" danger onPress={blockUser} />
        <SheetOption label="Cancel" onPress={() => setMenuOpen(false)} />
      </ActionSheet>

      <ActionSheet visible={reportOpen} onClose={() => setReportOpen(false)}>
        <Text style={styles.sheetTitle}>Why are you reporting {profile.username}?</Text>
        {REPORT_REASONS.map((reason) => (
          <SheetOption key={reason} label={reason} onPress={() => submitReport(reason)} />
        ))}
        <SheetOption label="Cancel" onPress={() => setReportOpen(false)} />
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
    <Pressable onPress={onPress} style={styles.sheetOption}>
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
  photo: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 24 },
  bio: { ...type.body, color: colors.textMuted, marginHorizontal: 20, marginTop: 16 },
  viewCount: { ...type.caption, color: colors.onBrandMuted, marginTop: 4 },
  followRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  followStat: { ...type.caption, color: colors.onBrandMuted },
  followStatNum: { color: colors.onBrand, fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
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
  privateNotice: { ...type.caption, color: colors.onBrandMuted, marginTop: 10 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: 'rgba(224,21,139,0.2)', borderWidth: 1, borderColor: colors.magenta,
  },
  tagText: { color: colors.onBrand, fontSize: 12, fontWeight: '600' },
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
  socialBar: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    paddingVertical: 16, paddingHorizontal: 16, gap: 12,
  },
  socialPill: {
    flexGrow: 1, flexBasis: 68, maxWidth: 96, height: 68, borderRadius: 20, backgroundColor: 'rgba(224,21,139,0.25)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.magenta,
  },
  postsWrap: { marginTop: 16 },
  postsTitle: { ...type.label, marginHorizontal: 20, marginBottom: 10 },
  postsEmpty: { ...type.caption, marginHorizontal: 20 },
  followAll: { alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 12, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.magenta },
  followAllText: { color: colors.magenta, fontWeight: '700', fontSize: 13 },
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
