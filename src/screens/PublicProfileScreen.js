import { useEffect, useState } from 'react'
import { View, Text, Image, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type, onImageType } from '../theme'
import { API_URL } from '../lib/supabase'
import { socialUrl, openLink } from '../lib/socialLinks'
import SocialIcon from '../components/SocialIcon'

const TIER_LABEL = { premium: '👑 Premium', pro: '⭐ Pro', creator: '★ Creator', normal: '' }

// A no-auth preview of a profile, reachable straight from the sign-in screen's
// avatar wall so a curious visitor can see who's on iYiYi before creating an
// account. Backed by the same public/gated endpoint as the shareable web
// profile link — never shows more than a stranger with the link would see.
export default function PublicProfileScreen({ route, navigation }) {
  const { username } = route.params
  const [profile, setProfile] = useState(undefined)

  useEffect(() => {
    fetch(`${API_URL}/api/public/profile/${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
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

  return (
    <View style={styles.screen}>
      <Image source={{ uri: profile.avatar_url }} style={styles.photo} />
      <LinearGradient colors={['transparent', 'rgba(13,7,16,0.95)']} style={styles.overlay}>
        <Text style={onImageType.display}>{profile.username} {TIER_LABEL[profile.account_type]}</Text>
        {!isGated && profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

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

        <Pressable onPress={() => navigation.navigate('SignIn', { mode: 'signup' })} style={styles.joinButton}>
          <LinearGradient colors={gradients.brand} style={styles.joinButtonGradient}>
            <Text style={styles.joinButtonText}>Create your own iYiYi profile</Text>
          </LinearGradient>
        </Pressable>
      </LinearGradient>

      <Pressable onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={{ color: colors.onBrand, fontSize: 26 }}>‹</Text>
      </Pressable>

      {!isGated && socials.length > 0 && (
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
              <SocialIcon platform={link.platform} size={32} color={colors.onBrand} />
            </Pressable>
          ))}
          {(profile.websites?.length ? profile.websites : profile.website ? [profile.website] : []).map((site, i) => (
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
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  photo: { flex: 1, width: '100%', height: '100%', ...(Platform.OS === 'web' ? { resizeMode: 'cover' } : {}) },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 110 },
  bio: { ...type.caption, color: colors.onBrandMuted, marginTop: 6 },
  privateNotice: { ...type.caption, color: colors.onBrandMuted, marginTop: 10 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    backgroundColor: 'rgba(224,21,139,0.2)', borderWidth: 1, borderColor: colors.magenta,
  },
  tagText: { color: colors.onBrand, fontSize: 12, fontWeight: '600' },
  joinButton: { marginTop: 18, borderRadius: radii.pill, overflow: 'hidden', alignSelf: 'flex-start' },
  joinButtonGradient: { paddingHorizontal: 20, paddingVertical: 12 },
  joinButtonText: { color: colors.onBrand, fontWeight: '700' },
  back: {
    position: 'absolute', top: 50, left: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  socialBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', backgroundColor: 'rgba(13,7,16,0.85)', paddingVertical: 14, paddingHorizontal: 16, gap: 12,
  },
  socialPill: {
    flexGrow: 1, flexBasis: 68, maxWidth: 96, height: 68, borderRadius: 20, backgroundColor: 'rgba(224,21,139,0.25)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.magenta,
  },
})
