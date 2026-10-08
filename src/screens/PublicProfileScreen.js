import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type } from '../theme'
import { API_URL } from '../lib/supabase'
import { socialUrl, openLink } from '../lib/socialLinks'
import SocialIcon from '../components/SocialIcon'
import Avatar from '../components/Avatar'

const TIER_LABEL = { premium: '👑 Premium', pro: '⭐ Pro', creator: '★ Creator', normal: '' }

// A no-auth preview of a profile, reachable straight from the sign-in screen's
// avatar wall so a curious visitor can see who's on iYiYi before creating an
// account. Backed by the same public/gated endpoint as the shareable web
// profile link — never shows more than a stranger with the link would see.
export default function PublicProfileScreen({ route, navigation }) {
  const { username, avatarUrl: avatarHint = null } = route.params
  const [profile, setProfile] = useState(undefined)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    fetch(`${API_URL}/api/public/profile/${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProfile(p ? { ...p, avatar_url: p.avatar_url || p.avatar || p.photo_url || p.profile_photo_url || avatarHint } : p))
      .catch(() => setProfile(null))
  }, [username])

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
        <Text style={type.body}>This profile isn't available.</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.joinButton}>
          <Text style={styles.joinButtonText}>Back</Text>
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
        <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={{ color: colors.text, fontSize: 26 }}>‹</Text>
        </Pressable>

        {/* Compact profile header: round photo next to the name, like a normal profile page. */}
        <View style={styles.heroTop}>
          <View style={styles.heroAvatar}>
            <Avatar uri={profile.avatar_url} name={profile.username} size={96} transition={250} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{profile.username} {TIER_LABEL[profile.account_type]}</Text>
            {!isGated && profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          </View>
        </View>

        {isGated ? (
          <Text style={styles.privateNotice}>🔒 This account is private. Create an account and follow to see more.</Text>
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

        <Pressable onPress={() => navigation.navigate('SignIn', { mode: 'signup' })} style={styles.joinButton}>
          <LinearGradient colors={gradients.brand} style={styles.joinButtonGradient}>
            <Text style={styles.joinButtonText}>Create your own iYiYi profile</Text>
          </LinearGradient>
        </Pressable>
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
