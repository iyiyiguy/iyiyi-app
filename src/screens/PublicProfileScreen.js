import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { getMyUserId } from '../lib/profileNav'
import { socialUrl, openLink } from '../lib/socialLinks'
import SocialIcon, { socialA11yLabel } from '../components/SocialIcon'
import Avatar from '../components/Avatar'
import { useT } from '../i18n'
import profileStrings from '../i18n/strings/profile'
import socialStrings from '../i18n/strings/social'

// [badge, social.js key]; the badge glyph stays, the tier word is translated.
const TIER_LABEL = {
  premium: ['⭐', 'tierPro'], pro: ['⭐', 'tierPro'], pro_local: ['⭐', 'tierPro'], pro_national: ['⭐', 'tierPro'], pro_all: ['⭐', 'tierPro'], creator: ['⭐', 'tierPro'],
  business: ['✓', 'tierBusiness'], business_pro: ['✓', 'tierBusiness'], normal: null,
}
const tierLabel = (accountType, ts) => {
  const tier = TIER_LABEL[accountType]
  return tier ? `${tier[0]} ${ts(tier[1])}` : ''
}

// Signed-in members who open app.iyiyi.xyz/u/<username> belong on the full UserProfile screen
// (Follow, posts, etc.); the member stack has no SignIn route. Resolves the username to an id.
async function resolveUserId(username, publicProfile) {
  if (publicProfile?.id) return publicProfile.id
  try {
    const { data } = await supabase.from('profiles').select('id').eq('username', username).limit(1)
    return data?.[0]?.id ?? null
  } catch {
    return null
  }
}

// A no-auth preview of a profile, reachable straight from the sign-in screen's
// avatar wall so a curious visitor can see who's on iYiYi before creating an
// account. Backed by the same public/gated endpoint as the shareable web
// profile link — never shows more than a stranger with the link would see.
export default function PublicProfileScreen({ route, navigation }) {
  const { username, avatarUrl: avatarHint = null } = route.params
  const [profile, setProfile] = useState(undefined)
  const [member, setMember] = useState(null) // null = unknown, false = guest, true = signed in
  const insets = useSafeAreaInsets()
  const t = useT(profileStrings)
  const ts = useT(socialStrings)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const me = await getMyUserId()
      if (!alive) return
      setMember(!!me)
      let p = null
      try {
        const r = await fetch(`${API_URL}/api/public/profile/${encodeURIComponent(username)}`)
        p = r.ok ? await r.json() : null
      } catch {
        p = null
      }
      if (!alive) return
      if (me) {
        const id = await resolveUserId(username, p)
        if (!alive) return
        if (id === me) { navigation.navigate('Tabs', { screen: 'MyProfile' }); return }
        if (id) { navigation.replace('UserProfile', { userId: id, avatarUrl: p?.avatar_url ?? avatarHint }); return }
      }
      setProfile(p ? { ...p, avatar_url: p.avatar_url || p.avatar || p.photo_url || p.profile_photo_url || avatarHint } : p)
    }
    load()
    return () => { alive = false }
  }, [username]) // eslint-disable-line react-hooks/exhaustive-deps

  // A cold deep link has no history to go back to.
  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs'))

  if (profile === undefined) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  if (!profile) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <Text style={type.body}>{t('unavailable')}</Text>
        <Pressable onPress={goBack} style={styles.joinButton} accessibilityRole="button">
          <Text style={styles.joinButtonText}>{t('back')}</Text>
        </Pressable>
      </View>
    )
  }

  const socials = profile.social_links ?? []
  const isGated = profile.visibility === 'private' || profile.visibility === 'ghost'

  const websites = profile.websites?.length ? profile.websites : profile.website ? [profile.website] : []

  return (
    <View style={[styles.screen, styles.wideBackdrop]}>
      <ScrollView contentContainerStyle={[styles.column, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 32 }]}>
        <Pressable onPress={goBack} style={styles.back} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Text style={{ color: colors.text, fontSize: 26 }}>‹</Text>
        </Pressable>

        {/* Compact profile header: round photo next to the name, like a normal profile page. */}
        <View style={styles.heroTop}>
          <View style={styles.heroAvatar}>
            <Avatar uri={profile.avatar_url} name={profile.username} size={96} transition={250} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{profile.username} {tierLabel(profile.account_type, ts)}</Text>
            {!isGated && profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          </View>
        </View>

        {isGated ? (
          <Text style={styles.privateNotice}>{t('privateGuest')}</Text>
        ) : profile.tags?.length > 0 ? (
          <View style={styles.tagRow}>
            {profile.tags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {!isGated && (socials.length > 0 || websites.length > 0) && (
          <View style={styles.socialBar}>
            {socials.map((link, i) => (
              <Pressable
                key={i}
                style={styles.socialPill}
                accessibilityRole="link"
                accessibilityLabel={socialA11yLabel(ts, link.platform, /^https?:\/\//i.test(String(link.value ?? '')) ? undefined : link.value)}
                onPress={() => {
                  const url = socialUrl(link.platform, link.value)
                  if (url) openLink(url)
                }}
              >
                <SocialIcon platform={link.platform} size={28} color={colors.text} />
              </Pressable>
            ))}
            {websites.map((site, i) => (
              <Pressable
                key={`w${i}`}
                style={styles.socialPill}
                accessibilityRole="link"
                accessibilityLabel={t('websiteA11y', { site })}
                onPress={() => {
                  const url = site.startsWith('http') ? site : `https://${site}`
                  openLink(url)
                }}
              >
                <Text style={{ fontSize: 22 }}>🔗</Text>
              </Pressable>
            ))}
          </View>
        )}

        {member === false ? (
          <Pressable onPress={() => navigation.navigate('SignIn', { mode: 'signup' })} style={styles.joinButton} accessibilityRole="button">
            <LinearGradient colors={gradients.brand} style={styles.joinButtonGradient}>
              <Text style={styles.joinButtonText}>{t('createOwn')}</Text>
            </LinearGradient>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  wideBackdrop: { backgroundColor: 'transparent' },
  column: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 20 },
  back: {
    width: 44, height: 44, borderRadius: 22, marginLeft: -4, marginBottom: 8,
    backgroundColor: 'rgba(127,127,127,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroAvatar: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  name: { ...type.title, color: colors.text, fontSize: 24, fontWeight: '800' },
  bio: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  privateNotice: { ...type.caption, color: colors.textMuted, marginTop: 16 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  tagChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: 'rgba(224,21,139,0.2)', borderWidth: 1, borderColor: colors.magenta,
  },
  tagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  socialBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  socialPill: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(224,21,139,0.18)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.magenta,
  },
  joinButton: { marginTop: 22, borderRadius: radii.pill, overflow: 'hidden', alignSelf: 'stretch' },
  joinButtonGradient: { paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center' },
  joinButtonText: { color: colors.onBrand, fontWeight: '700', fontSize: 16 },
})
