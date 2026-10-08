import { useCallback, useEffect, useRef, useState } from 'react'
import TagLinks from '../components/TagLinks'
import BusinessLocationCard from '../components/BusinessLocationCard'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import { View, Text, Image, TextInput, StyleSheet, Pressable, ScrollView, Share, ActivityIndicator, Modal, Linking, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import GoProBanner from '../components/GoProBanner'
import { colors, gradients, radii, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { apiJson } from '../lib/api'
import { getCached, setCached } from '../lib/cache'
import { TAGS } from '../lib/tags'

import SocialIcon from '../components/SocialIcon'
import ContentViewer from '../components/ContentViewer'
import ImportLinksPanel from '../components/ImportLinksPanel'
import { mergeLinks } from '../lib/importLinks'
import ContentGrid from '../components/ContentGrid'
import { fetchMyMedia, normalizeMediaItem, sortMediaNewest } from '../lib/myContent'
import { useT } from '../i18n'
import strings from '../i18n/strings/myProfile'
import { avatarSource } from '../lib/avatarSource'

const RECOMMENDED_TIERS = ['pro', 'premium', 'creator']

// On native, ImagePicker returns a file:// URI with a real extension we can
// parse for the content type. On web it returns a blob: URI instead (e.g.
// blob:https://host/<uuid>) which has no extension at all — splitting that
// on '.' just returns the whole string, producing a garbage Content-Type
// header (like "image/blob:https://...") that Supabase Storage rejects.
// The picker's own `mimeType` is reliable on both platforms, so prefer that.
function mimeAndExtFromAsset(asset, isVideo) {
  if (asset.mimeType) {
    const ext = asset.mimeType.split('/').pop()
    return { mimeType: asset.mimeType, ext }
  }
  const uriExt = asset.uri.split('.').pop()?.toLowerCase()
  const ext = uriExt && uriExt.length <= 4 ? uriExt : isVideo ? 'mp4' : 'jpg'
  const normalizedExt = ext === 'jpg' ? 'jpeg' : ext
  return { mimeType: `${isVideo ? 'video' : 'image'}/${normalizedExt}`, ext }
}

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'snapchat', label: 'Snapchat' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'discord', label: 'Discord' },
  { key: 'twitch', label: 'Twitch' },
  { key: 'telegram', label: 'Telegram' },
]
const PROFILE_LABELS = [
  { key: 'standard', label: 'Standard' },
  { key: 'creator', label: 'Creator' },
  { key: 'business', label: 'Business' },
]

export default function MyProfileScreen({ navigation }) {
  const t = useT(strings)
  const [profile, setProfileState] = useState(() => getCached('me:profile') ?? null)
  const setProfile = useCallback((v) => { setProfileState((prev) => { const next = typeof v === 'function' ? v(prev) : v; setCached('me:profile', next); return next }) }, [])
  const [stats, setStatsState] = useState(() => getCached('me:stats') ?? null)
  const setStats = useCallback((v) => { setCached('me:stats', v); setStatsState(v) }, [])
  const [totalUsers, setTotalUsers] = useState(null)
  const [requestCount, setRequestCount] = useState(0)
  const [media, setMediaState] = useState(() => getCached('me:media') ?? [])
  const setMedia = useCallback((v) => { setMediaState((prev) => { const next = typeof v === 'function' ? v(prev) : v; setCached('me:media', next); return next }) }, [])
  const [uploading, setUploading] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [platformFollowCount, setPlatformFollowCount] = useState(0)
  const [viewer, setViewer] = useState({ open: false, index: 0 })

  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // Edit fields live behind "Edit profile" so your posts sit right under the header.
  const [editOpen, setEditOpen] = useState(false)
  const scrollRef = useRef(null)
  const editY = useRef(0)
  const scrollToEditOnLayout = useRef(false)

  const getSessionOrThrow = async () => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error(t('signInAgain'))
    return session
  }

  const authedFetch = async (path, options = {}) => {
    const session = await getSessionOrThrow()
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
    })
  }

  useEffect(() => {
    let cancelled = false
    const loadProfile = async () => {
      const session = await getSessionOrThrow()
      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [profileRes, totalRes] = await Promise.all([
        fetch(`${API_URL}/api/profiles/me`, { headers }),
        fetch(`${API_URL}/api/profiles/discover/total-count`, { headers }),
      ])
      const profileJson = await profileRes.json().catch(() => null)
      if (!profileRes.ok || !profileJson || profileJson.error) throw new Error(profileJson?.error || 'Could not load your profile')
      if (cancelled) return
      setLoadError(false)
      setProfile(profileJson)
      const totalJson = totalRes.ok ? await totalRes.json().catch(() => null) : null
      if (totalJson?.total_users != null) setTotalUsers(totalJson.total_users)
    }
    // Your posts: the profile media API unioned with a direct profile_media read (see
    // fetchMyMedia), newest first - camera posts (POST /api/camera/posts) land here too.
    // Runs on every focus so a post made from the camera shows up as soon as you come back.
    // On a failed refresh the grid keeps what it had instead of going blank.
    const refreshMedia = async () => {
      try {
        const list = await fetchMyMedia(300, { strict: true })
        if (!cancelled) setMedia(list)
      } catch (e) {
        console.warn('Profile media refresh failed', e?.message ?? e)
      }
    }
    let followUp = null
    // Stats and the follow-request count can change from other screens (e.g.
    // accepting a request in FollowList), so those refresh every time this
    // screen regains focus. The profile fields themselves are only ever
    // edited right here, so re-running loadProfile on focus would clobber
    // whatever the user just typed but hasn't saved yet - it only runs once.
    const loadOnFocus = async () => {
      refreshMedia()
      // A camera post can still be finishing its upload when you land back here.
      if (followUp) clearTimeout(followUp)
      followUp = setTimeout(() => { if (!cancelled) refreshMedia() }, 4000)
      try {
        const session = await getSessionOrThrow()
        const headers = { Authorization: `Bearer ${session.access_token}` }
        const [statsRes, requestsRes] = await Promise.all([
          fetch(`${API_URL}/api/profiles/me/stats`, { headers }),
          fetch(`${API_URL}/api/profiles/follow-requests`, { headers }),
        ])
        apiJson('/api/platform-follows/mine').then((d) => setPlatformFollowCount(d?.count ?? 0)).catch(() => {})
        const statsJson = statsRes.ok ? await statsRes.json().catch(() => null) : null
        if (statsJson && !cancelled) setStats(statsJson)
        const requestsJson = requestsRes.ok ? await requestsRes.json().catch(() => null) : null
        if (requestsJson && !cancelled) setRequestCount((requestsJson.requests ?? []).length)
      } catch (e) {
        console.warn('Profile stats refresh failed', e?.message ?? e)
      }
    }
    const unsub = navigation.addListener('focus', loadOnFocus)
    loadProfile().catch((e) => {
      console.warn('Profile load failed', e?.message ?? e)
      if (!cancelled) setLoadError(true)
    })
    loadOnFocus()
    return () => {
      cancelled = true
      if (followUp) clearTimeout(followUp)
      unsub()
    }
  }, [navigation, reloadKey])

  if (!profile) {
    return (
      <View style={styles.screen}>
        {loadError ? (
          <Pressable onPress={() => { setLoadError(false); setReloadKey((k) => k + 1) }} style={{ marginTop: 120, alignItems: 'center' }}>
            <Text style={type.body}>{t('couldNotLoad')}</Text>
            <Text style={[type.caption, { marginTop: 6 }]}>{t('tapToRetry')}</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  const set = (key, value) => setProfile((p) => ({ ...p, [key]: value }))
  const socialLinks = profile.social_links ?? []
  const websites = profile.websites ?? []

  const shareProfile = () => {
    Share.share({
      message: t('shareMessage', { url: `https://app.iyiyi.xyz/u/${encodeURIComponent(profile.username)}` }),
    }).catch(() => {})
  }

  const addSocialLink = (platform) => set('social_links', [...socialLinks, { platform, value: '' }])
  const updateSocialLink = (index, value) =>
    set('social_links', socialLinks.map((l, i) => (i === index ? { ...l, value } : l)))
  const removeSocialLink = (index) => set('social_links', socialLinks.filter((_, i) => i !== index))
  const addWebsite = () => set('websites', [...websites, ''])
  const updateWebsite = (index, value) => set('websites', websites.map((w, i) => (i === index ? value : w)))
  const removeWebsite = (index) => set('websites', websites.filter((_, i) => i !== index))
  const toggleTag = (tag) => {
    const current = profile.tags ?? []
    set('tags', current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag])
  }

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1],
    })
    if (result.canceled) return

    setError('')
    setUploading(true)
    try {
      const session = await getSessionOrThrow()
      const asset = result.assets[0]
      const uri = asset.uri
      const { mimeType, ext } = mimeAndExtFromAsset(asset, false)
      const path = `${session.user.id}/${Date.now()}.${ext}`
      const arrayBuffer = await fetch(uri).then((r) => r.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, { contentType: mimeType, upsert: true })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const avatar_url = `${publicUrl}?t=${Date.now()}`
      set('avatar_url', avatar_url)
      // The upload itself is already committed to storage, so persist the
      // new URL right away instead of waiting for the user to separately
      // press "Save Changes" - otherwise a photo upload with no manual save
      // right after looks successful but is lost on the next screen load.
      await authedFetch('/api/profiles/me', { method: 'PATCH', body: JSON.stringify({ avatar_url }) })
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const uploadContent = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], quality: 0.8,
    })
    if (result.canceled) return

    setError('')
    setUploadingMedia(true)
    try {
      const asset = result.assets[0]
      const isVideo = asset.type === 'video'
      const session = await getSessionOrThrow()
      const uri = asset.uri
      const { mimeType, ext } = mimeAndExtFromAsset(asset, isVideo)
      const path = `${session.user.id}/${Date.now()}.${ext}`
      const arrayBuffer = await fetch(uri).then((r) => r.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from('profile-media')
        .upload(path, arrayBuffer, { contentType: mimeType, upsert: true })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('profile-media').getPublicUrl(path)
      const res = await authedFetch('/api/profiles/me/media', {
        method: 'POST',
        body: JSON.stringify({ media_url: publicUrl, media_type: isVideo ? 'video' : 'photo', width: asset.width, height: asset.height }),
      })
      const created = await res.json().catch(() => null)
      if (!res.ok || !created || created.error) throw new Error(created?.error || t('addFailed'))
      const item = normalizeMediaItem({
        ...created,
        created_at: created.created_at ?? new Date().toISOString(),
        owner_id: profile.id,
        is_mine: true,
      })
      if (item) setMedia((m) => sortMediaNewest([item, ...m.filter((x) => String(x?.id) !== String(item.id))]))
    } catch (e) {
      setError(e.message)
    } finally {
      setUploadingMedia(false)
    }
  }

  const confirmDelete = (item) => {
    if (!item?.id) return
    Alert.alert(t('deleteTitle'), t('deleteMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => deleteMedia(item.id) },
    ])
  }

  const toggleEdit = () => {
    if (editOpen) {
      setEditOpen(false)
      return
    }
    scrollToEditOnLayout.current = true
    setEditOpen(true)
  }

  const deleteMedia = async (id) => {
    const before = media
    setMedia((m) => m.filter((item) => item.id !== id))
    try {
      const res = await authedFetch(`/api/profiles/me/media/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('deleteFailed'))
    } catch (e) {
      setMedia(before)
      setError(e?.message ?? t('deleteFailed'))
    }
  }

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const session = await getSessionOrThrow()
      const res = await fetch(`${API_URL}/api/profiles/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(profile),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || t('saveFailed', { status: res.status }))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="profile" />
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled">
      {/* ---- Header: avatar, name, counts, actions ---- */}
      <LinearGradient colors={gradients.brandSubtle} style={styles.hero}>
        <Image source={avatarSource(profile.avatar_url)} style={styles.heroAvatar} />
      </LinearGradient>

      <View style={styles.avatarWrap}>
        <Pressable onPress={pickAvatar} disabled={uploading} accessibilityRole="button" accessibilityLabel={t('changePhotoA11y')}>
          <Image source={avatarSource(profile.avatar_url)} style={styles.avatar} />
          <View style={styles.editBadge}>
            {uploading ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Text style={{ fontSize: 16 }}>📷</Text>}
          </View>
        </Pressable>
      </View>
      <Text style={styles.name}>{profile.username}</Text>
      {profile.bio ? <Text style={styles.headerBio} numberOfLines={3}>{profile.bio}</Text> : null}

      <View style={[styles.followRow, { marginTop: 14, gap: 18, flexWrap: 'wrap', paddingHorizontal: 12 }]}>
        <Pressable onPress={() => navigation.navigate('FollowList', { userId: profile.id, mode: 'followers' })} style={styles.followStatWrap}>
          <Text style={styles.followStatNum}>{profile.follower_count ?? 0}</Text>
          <Text style={type.caption}>{t('followers')}</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('FollowList', { userId: profile.id, mode: 'following' })} style={styles.followStatWrap}>
          <Text style={styles.followStatNum}>{profile.following_count ?? 0}</Text>
          <Text style={type.caption}>{t('following')}</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('PlatformFollows')} style={styles.followStatWrap}>
          <Text style={styles.followStatNum}>{platformFollowCount}</Text>
          <Text style={type.caption}>{t('profilesFollowed')}</Text>
        </Pressable>
        <View style={styles.followStatWrap}>
          <Text style={styles.followStatNum}>{media.length}</Text>
          <Text style={type.caption}>{t('posts')}</Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        <Pressable
          onPress={toggleEdit}
          style={[styles.headerBtn, editOpen && styles.headerBtnActive]}
          accessibilityRole="button"
          accessibilityState={{ expanded: editOpen }}
        >
          <Ionicons name={editOpen ? 'chevron-up' : 'create-outline'} size={16} color={editOpen ? colors.ink : colors.text} />
          <Text style={[styles.headerBtnText, editOpen && { color: colors.ink }]}>{editOpen ? t('doneEditing') : t('editProfile')}</Text>
        </Pressable>
        <Pressable onPress={shareProfile} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="share-outline" size={16} color={colors.text} />
          <Text style={styles.headerBtnText}>{t('share')}</Text>
        </Pressable>
        <Pressable onPress={() => profile?.id && navigation.navigate('UserProfile', { userId: profile.id, preview: true, avatarUrl: profile.avatar_url ?? null })} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('previewA11y')}>
          <Ionicons name="eye-outline" size={16} color={colors.text} />
          <Text style={styles.headerBtnText}>{t('preview')}</Text>
        </Pressable>
      </View>
      <GoProBanner navigation={navigation} compact style={{ marginBottom: 14 }} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* ---- Your posts, right under the header ---- */}
      <View style={styles.postsHead}>
        <Text style={type.label}>{t('yourPosts')}</Text>
        <Pressable onPress={() => navigation.navigate('Camera')} hitSlop={8} accessibilityRole="button" style={styles.postsCamera}>
          <Ionicons name="camera-outline" size={16} color={colors.magenta} />
          <Text style={styles.postsCameraText}>{t('camera')}</Text>
        </Pressable>
      </View>
      <ContentGrid
        items={media}
        autoplay
        onOpen={(i) => setViewer({ open: true, index: i })}
        onDelete={confirmDelete}
        addTile={{ onPress: uploadContent, busy: uploadingMedia, label: t('upload') }}
      />
      {media.length === 0 ? (
        <Text style={[type.caption, { marginHorizontal: 20, marginTop: 10 }]}>
          {t('noPosts')}
        </Text>
      ) : null}
      <View style={{ height: 20 }} />

      {/* ---- Account, stats, settings ---- */}
      {RECOMMENDED_TIERS.includes(profile.account_type) && (
        <View style={styles.recommendedBadge}>
          <Text style={styles.recommendedBadgeText}>{t('recommendedBadge')}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Row
          label={t('followRequests')}
          value={requestCount > 0 ? String(requestCount) : null}
          onPress={() => navigation.navigate('FollowList', { userId: profile.id, mode: 'requests' })}
        />
        <Row label={t('shareMyProfile')} onPress={shareProfile} />
        <Row label={t('settings')} onPress={() => navigation.navigate('Settings')} />
      </View>

      {stats && (
        <GlassPanel radius={radii.lg} style={styles.statsCard}>
          <View style={styles.statsRow}>
            <Stat label={t('profileViews')} value={stats.total_views} />
            <Stat label={t('thisWeek')} value={stats.views_last_7_days} />
            <Stat label={t('likes')} value={stats.total_likes ?? 0} />
          </View>
          <Pressable onPress={() => navigation.navigate('Recap')} style={styles.viewersLink}>
            <Text style={styles.viewersLinkText}>{t('growthRecap')}</Text>
          </Pressable>
          <TagLinks navigation={navigation} />
          <Pressable onPress={() => navigation.navigate('Viewers')} style={styles.viewersLink}>
            <Text style={styles.viewersLinkText}>{t('whoViewed')}</Text>
          </Pressable>
          {!profile.stats_public && (
            <Text style={styles.statsHint}>
              {t('statsHint')}
            </Text>
          )}
        </GlassPanel>
      )}


      {/* ---- Edit profile (collapsed by default) ---- */}
      <Pressable
        onPress={toggleEdit}
        style={styles.editToggle}
        onLayout={(e) => {
          editY.current = e?.nativeEvent?.layout?.y ?? 0
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: editOpen }}
      >
        <View style={{ flex: 1 }}>
          <Text style={type.body}>{t('editProfile')}</Text>
          <Text style={type.caption}>{t('editProfileSub')}</Text>
        </View>
        <Ionicons name={editOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>

      {editOpen ? (
        <View
          onLayout={() => {
            if (!scrollToEditOnLayout.current) return
            scrollToEditOnLayout.current = false
            try {
              scrollRef.current?.scrollTo?.({ y: Math.max(0, editY.current - 12), animated: true })
            } catch {
              // Scrolling is a convenience.
            }
          }}
        >
        <GoProBanner navigation={navigation} showWhenPro style={{ marginTop: 6, marginBottom: 6 }} />
        <Text onPress={pickAvatar} style={[styles.changePhotoText, { marginLeft: 20, marginTop: 4 }]}>{t('changePhoto')}</Text>
        <Text style={styles.section}>{t('personalInfo')}</Text>
        <Field label={t('username')} value={profile.username} onChangeText={(v) => set('username', v)} />
        <Field label={t('email')} value={profile.email} editable={false} />
        <Field label={t('country')} placeholder={t('countryPlaceholder')} value={profile.country} onChangeText={(v) => set('country', v)} />
        <View style={styles.field}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={type.label}>{t('bio')}</Text>
            <Text style={type.caption}>{(profile.bio ?? '').length}/200</Text>
          </View>
          <TextInput
            placeholderTextColor={colors.textFaint}
            style={[styles.input, { minHeight: 60 }]}
            placeholder={t('bioPlaceholder')}
            multiline
            maxLength={200}
            value={profile.bio ?? ''}
            onChangeText={(v) => set('bio', v)}
          />
        </View>

        <Text style={styles.section}>{t('profileType')}</Text>
        <Text style={[type.caption, { marginHorizontal: 20, marginBottom: 12 }]}>
          {t('profileTypeHint')}
        </Text>
        <View style={styles.tagWrap}>
          {PROFILE_LABELS.map((opt) => {
            const active = profile.profile_label === opt.key
            if (active) {
              return (
                <Pressable key={opt.key} onPress={() => set('profile_label', opt.key)} style={styles.tagChipActive}>
                  <Text style={styles.tagTextActive}>{t(`label_${opt.key}`)}</Text>
                </Pressable>
              )
            }
            return (
              <Pressable key={opt.key} onPress={() => set('profile_label', opt.key)}>
                <GlassPanel radius={radii.pill}>
                  <View style={styles.tagChip}><Text style={styles.tagText}>{t(`label_${opt.key}`)}</Text></View>
                </GlassPanel>
              </Pressable>
            )
          })}
        </View>

        {(profile.profile_label === 'business' || (profile.tags ?? []).includes('Business')) && <BusinessLocationCard />}

        <Text style={styles.section}>{t('privacy')}</Text>
        <View style={styles.privacyOptions}>
          {[
            {
              key: 'public',
              title: t('public'),
              desc: t('publicDesc'),
            },
            {
              key: 'private',
              title: t('private'),
              desc: t('privateDesc'),
            },
            {
              key: 'ghost',
              title: t('ghost'),
              desc: t('ghostDesc'),
            },
          ].map((opt) => {
            const active = (profile.visibility ?? 'public') === opt.key
            return (
              <Pressable key={opt.key} onPress={() => set('visibility', opt.key)}>
                <GlassPanel
                  radius={radii.md}
                  strong={active}
                  style={active ? { shadowColor: colors.magenta, shadowOpacity: 0.3 } : undefined}
                >
                  <View style={styles.privacyCard}>
                    <Text style={[styles.privacyTitle, active && styles.privacyTitleActive]}>{opt.title}</Text>
                    <Text style={styles.privacyDesc}>{opt.desc}</Text>
                  </View>
                </GlassPanel>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.section}>{t('websites')}</Text>
        {websites.map((site, i) => (
          <View key={i} style={styles.socialRow}>
            <View style={[styles.field, { flex: 1, marginBottom: 0 }]}>
              <Text style={type.label}>{t('websiteN', { n: i + 1 })}</Text>
              <TextInput
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                placeholder="yoursite.com"
                autoCapitalize="none"
                keyboardType="url"
                value={site}
                onChangeText={(v) => updateWebsite(i, v)}
              />
            </View>
            <Pressable onPress={() => removeWebsite(i)} style={styles.socialRemoveBtn}>
              <Text style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addWebsite} style={[styles.addSocialChip, { marginHorizontal: 20, marginBottom: 24, alignSelf: 'flex-start' }]}>
          <Text style={styles.addSocialChipText}>{t('addWebsite')}</Text>
        </Pressable>

        <Text style={styles.section}>{t('socialMedia')}</Text>
        <Text style={[type.caption, { marginHorizontal: 20, marginBottom: 12 }]}>
          {t('socialHint')}
        </Text>
        <Pressable onPress={() => setImportOpen(true)} style={[styles.addSocialChip, { marginHorizontal: 20, marginBottom: 16, alignSelf: 'flex-start' }]}>
          <Text style={styles.addSocialChipText}>{t('importLinks')}</Text>
        </Pressable>
        {socialLinks.map((link, i) => {
          const platform = SOCIAL_PLATFORMS.find((p) => p.key === link.platform)
          return (
            <View key={i} style={styles.socialRow}>
              <View style={[styles.field, { flex: 1, marginBottom: 0 }]}>
                <Text style={type.label}>{platform?.label ?? link.platform}</Text>
                <TextInput
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  autoCapitalize="none"
                  value={link.value}
                  onChangeText={(v) => updateSocialLink(i, v)}
                />
              </View>
              <Pressable onPress={() => removeSocialLink(i)} style={styles.socialRemoveBtn}>
                <Text style={{ color: colors.textMuted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
          )
        })}
        <View style={styles.tagWrap}>
          {SOCIAL_PLATFORMS.map((p) => (
            <Pressable key={p.key} onPress={() => addSocialLink(p.key)} style={styles.addSocialChip}>
              <Text style={styles.addSocialChipText}>+ {p.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>{t('tags')}</Text>
        <Text style={[type.caption, { marginHorizontal: 20, marginBottom: 12 }]}>
          {t('tagsHint')}
        </Text>
        <View style={styles.tagWrap}>
          {TAGS.map((tag) => {
            const active = (profile.tags ?? []).includes(tag)
            return (
              <Pressable key={tag} onPress={() => toggleTag(tag)} style={[styles.tagChip, active && styles.tagChipActive]}>
                <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
              </Pressable>
            )
          })}
        </View>

        <Pressable onPress={save} disabled={saving || uploading}>
          <LinearGradient colors={gradients.brand} style={styles.button}>
            <Text style={styles.buttonText}>{saving ? t('saving') : t('saveChanges')}</Text>
          </LinearGradient>
        </Pressable>

        </View>
      ) : null}

      {totalUsers != null && (
        <Text style={styles.totalUsers}>{t('totalUsers', { n: totalUsers.toLocaleString() })}</Text>
      )}

      <Modal visible={importOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setImportOpen(false)} onDismiss={() => setImportOpen(false)}>
        <View style={styles.screen}>
          <View style={{ paddingTop: 24, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={type.title}>{t('importTitle')}</Text>
            <Pressable onPress={() => setImportOpen(false)} hitSlop={12}>
              <Text style={{ color: colors.textMuted, fontSize: 16 }}>{t('close')}</Text>
            </Pressable>
          </View>
          <ImportLinksPanel
            intro={t('importIntro')}
            importLabel={t('addToProfile')}
            onImport={async (imported) => {
              const merged = mergeLinks(profile, imported)
              set('social_links', merged.social_links)
              set('websites', merged.websites)
              setImportOpen(false)
            }}
          />
        </View>
      </Modal>

      <ContentViewer
        visible={viewer.open}
        items={media.map((m) => ({ ...m, owner_id: profile.id, owner_username: profile.username, owner_avatar_url: profile.avatar_url }))}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
      />

      </ScrollView>
    </View>
  )
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={type.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.textFaint} style={styles.input} {...props} />
    </View>
  )
}

function Stat({ label, value }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  )
}

function Row({ label, value, onPress }) {
  const Wrap = onPress ? Pressable : View
  return (
    <Wrap onPress={onPress} style={styles.row}>
      <Text style={type.body}>{label}</Text>
      {value ? <Text style={{ color: colors.magenta }}>{value}</Text> : onPress ? <Text style={{ color: colors.textFaint }}>›</Text> : null}
    </Wrap>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  error: { color: colors.danger, textAlign: 'center', marginHorizontal: 20, marginBottom: 8 },
  hero: { height: 140 },
  heroAvatar: { width: '100%', height: '100%', opacity: 0.35 },
  avatarWrap: { alignSelf: 'center', alignItems: 'center', marginTop: -50, marginBottom: 12 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: colors.ink },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0, backgroundColor: colors.magenta,
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.ink,
  },
  changePhotoText: { ...type.caption, color: colors.magenta, marginTop: 8, fontWeight: '700' },
  name: { ...type.title, textAlign: 'center', marginTop: 10 },
  email: { ...type.caption, textAlign: 'center', marginBottom: 20 },
  card: {
    marginHorizontal: 20, marginBottom: 16, backgroundColor: colors.inkSurface,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  statsCard: { marginHorizontal: 20, marginBottom: 16, padding: 16 },
  statsRow: { flexDirection: 'row' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.magenta },
  statsHint: { ...type.caption, textAlign: 'center', marginTop: 12 },
  followRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 16 },
  followStatWrap: { alignItems: 'center' },
  followStatNum: { fontSize: 18, fontWeight: '800', color: colors.text },
  recommendedBadge: {
    marginHorizontal: 20, marginBottom: 16, padding: 12, borderRadius: radii.md,
    backgroundColor: 'rgba(232,176,75,0.15)', borderWidth: 1, borderColor: colors.gold,
  },
  recommendedBadgeText: { color: colors.gold, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  section: { ...type.label, marginLeft: 20, marginTop: 20, marginBottom: 8 },
  field: {
    marginHorizontal: 20, marginBottom: 12, backgroundColor: colors.inkSurface,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, padding: 12,
  },
  input: { ...type.body, marginTop: 4, padding: 0 },
  tagWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    marginHorizontal: 20, marginBottom: 24,
  },
  tagChip: { paddingHorizontal: 14, paddingVertical: 8 },
  tagChipActive: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.text,
  },
  tagText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  tagTextActive: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  privacyOptions: { marginHorizontal: 20, marginBottom: 24, gap: 10 },
  privacyCard: { padding: 14 },
  privacyTitle: { color: colors.textMuted, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  privacyTitleActive: { color: colors.text },
  privacyDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  mediaGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginHorizontal: 20, marginBottom: 24,
  },
  mediaTile: { width: 100, height: 100, borderRadius: radii.md, overflow: 'hidden' },
  mediaThumbImg: { width: '100%', height: '100%' },
  socialRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 12,
  },
  socialRemoveBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline,
  },
  addSocialChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface,
  },
  addSocialChipText: { color: colors.magenta, fontSize: 13, fontWeight: '600' },
  button: { margin: 20, paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center' },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 16 },
  totalUsers: { ...type.caption, textAlign: 'center', marginTop: -8, marginBottom: 24 },
  viewersLink: { alignItems: 'center', paddingTop: 10 },
  viewersLinkText: { color: colors.magenta, fontWeight: '600', fontSize: 13 },
  previewButton: {
    alignSelf: 'center', marginTop: 12, marginBottom: 8, paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface,
  },
  previewButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  headerBio: { ...type.body, color: colors.textMuted, textAlign: 'center', marginHorizontal: 28, marginTop: 6 },
  headerActions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface,
  },
  headerBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  headerBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  postsHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 20, marginTop: 8, marginBottom: 10,
  },
  postsCamera: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  postsCameraText: { color: colors.magenta, fontSize: 13, fontWeight: '700' },
  editToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 8, padding: 16, borderRadius: radii.lg,
    backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline,
  },
})

