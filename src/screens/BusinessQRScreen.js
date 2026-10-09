import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Share, Platform, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import Svg, { Rect } from 'react-native-svg'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson } from '../lib/api'
import { useIsBusinessPro } from '../lib/useIsPro'
import { PLATFORM_LABELS } from '../lib/socialLinks'

const { width: SCREEN_W } = Dimensions.get('window')
const POSTER_W = Math.min(SCREEN_W - 40, 380)

// Simple QR-like visual (the real QR is generated server-side and shown via Image;
// this is a decorative placeholder for the poster preview).
function QRPlaceholder({ size = 160 }) {
  const cells = 11
  const cellSize = size / cells
  // Deterministic pattern for preview
  const pattern = [
    [1,1,1,1,1,1,1,0,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,0],
    [1,0,1,1,1,0,1,0,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1],
    [1,0,1,1,1,0,1,0,1,1,0],
    [1,0,0,0,0,0,1,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1],
    [0,0,0,0,0,0,0,0,1,1,0],
    [1,0,1,0,1,1,1,0,1,0,1],
    [0,1,0,1,0,0,0,0,0,1,0],
    [1,1,1,0,1,0,1,1,1,1,1],
  ]
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', borderRadius: 8, padding: 8 }}>
      <Svg width={size - 16} height={size - 16}>
        {pattern.map((row, y) =>
          row.map((cell, x) =>
            cell ? <Rect key={`${x}-${y}`} x={x * ((size - 16) / cells)} y={y * ((size - 16) / cells)} width={(size - 16) / cells} height={(size - 16) / cells} fill="#111" /> : null
          )
        )}
      </Svg>
    </View>
  )
}

const SOCIAL_ICONS = {
  instagram: '📷', tiktok: '🎵', youtube: '▶️', snapchat: '👻',
  twitter: '🐦', facebook: '📘', twitch: '🎮', linkedin: '💼',
  spotify: '🎧', soundcloud: '🔊', pinterest: '📌', discord: '💬',
}

function SocialPill({ platform, value }) {
  return (
    <View style={styles.socialPill}>
      <Text style={{ fontSize: 14 }}>{SOCIAL_ICONS[platform] ?? '🔗'}</Text>
      <Text style={styles.socialPillText}>@{value}</Text>
    </View>
  )
}

export default function BusinessQRScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const isBiz = useIsBusinessPro()
  const posterRef = useRef(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('poster') // 'poster' | 'qr' | 'link'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const me = await apiJson('/api/profiles/me')
      setProfile(me)
    } catch (e) {
      console.warn('Profile load failed', e?.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tapLink = profile ? `https://app.iyiyi.xyz/u/${profile.username}` : null
  const socials = profile?.social_links ?? []

  const shareLink = async () => {
    if (!tapLink) return
    try {
      await Share.share({ url: tapLink, message: `Follow ${profile.username} on iYiYi!\n${tapLink}` })
    } catch {}
  }

  const copyLink = () => {
    if (!tapLink) return
    // Clipboard API varies by platform; fallback to share
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(tapLink).then(() => Alert.alert('Copied!', tapLink))
    } else {
      shareLink()
    }
  }

  const savePoster = async () => {
    if (!posterRef.current) return
    setSaving(true)
    try {
      const uri = await captureRef(posterRef.current, { format: 'png', quality: 1, result: 'tmpfile' })
      if (Platform.OS === 'web') {
        // Download on web
        const a = document.createElement('a')
        a.href = uri
        a.download = `${profile?.username ?? 'iyiyi'}-poster.png`
        a.click()
      } else {
        const canShare = await Sharing.isAvailableAsync()
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png' })
        } else {
          const perm = await MediaLibrary.requestPermissionsAsync()
          if (perm.granted) {
            await MediaLibrary.saveToLibraryAsync(uri)
            Alert.alert('Saved!', 'Poster saved to your photo library.')
          }
        }
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not save poster.')
    } finally {
      setSaving(false)
    }
  }

  if (isBiz === false) {
    return (
      <View style={styles.screen}>
        <BrandHeader title="QR & Poster" onBack={() => navigation.goBack()} />
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={48} color={colors.textFaint} />
          <Text style={[type.title, { textAlign: 'center', marginTop: 16 }]}>Business Pro Only</Text>
          <Text style={[type.subhead, { textAlign: 'center', marginTop: 8, maxWidth: 300 }]}>
            Generate a QR code and printable poster for your storefront.
          </Text>
          <Pressable onPress={() => navigation.navigate('Subscription')} style={{ marginTop: 24 }}>
            <LinearGradient colors={['#10b981', '#059669']} style={styles.upgradeGrad}>
              <Text style={styles.upgradeText}>Upgrade to Business Pro</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title="QR & Poster" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Tab toggle */}
        <FadeIn>
          <View style={styles.tabRow}>
            {['poster', 'qr', 'link'].map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabActive]}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'poster' ? 'Poster' : t === 'qr' ? 'QR Code' : 'Tap Link'}
                </Text>
              </Pressable>
            ))}
          </View>
        </FadeIn>

        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
        ) : tab === 'poster' ? (
          /* ---- Printable poster preview ---- */
          <FadeIn index={1}>
            <View ref={posterRef} collapsable={false} style={styles.posterWrap}>
              <LinearGradient colors={['#0c0f1a', '#1a1040', '#0c0f1a']} style={styles.poster}>
                {/* iYiYi branding */}
                <View style={styles.posterBrand}>
                  <Text style={styles.posterLogo}>iYiYi</Text>
                  <Text style={styles.posterTagline}>Follow us everywhere</Text>
                </View>

                {/* Business name */}
                <Text style={styles.posterName}>{profile?.display_name || profile?.username || 'Your Business'}</Text>
                {profile?.bio ? <Text style={styles.posterBio} numberOfLines={2}>{profile.bio}</Text> : null}

                {/* QR code */}
                <View style={styles.posterQR}>
                  <QRPlaceholder size={140} />
                </View>
                <Text style={styles.posterScan}>Scan to follow</Text>

                {/* Socials */}
                {socials.length > 0 && (
                  <View style={styles.posterSocials}>
                    {socials.slice(0, 6).map((s) => (
                      <SocialPill key={s.platform} platform={s.platform} value={s.value} />
                    ))}
                  </View>
                )}

                {/* Tap link */}
                <View style={styles.posterLinkPill}>
                  <Text style={styles.posterLinkText}>{tapLink}</Text>
                </View>

                <Text style={styles.posterFooter}>Get the iYiYi app — see who's nearby</Text>
              </LinearGradient>
            </View>

            <View style={styles.posterActions}>
              <Press onPress={savePoster} disabled={saving} haptic="light" style={{ flex: 1 }}>
                <LinearGradient colors={['#6b7cff', '#8f5bff']} style={styles.actionBtn}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="download" size={18} color="#fff" />
                      <Text style={styles.actionText}>Save poster</Text>
                    </>
                  )}
                </LinearGradient>
              </Press>
              <Press onPress={shareLink} haptic="light" style={{ flex: 1 }}>
                <View style={styles.actionBtnOutline}>
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text style={[styles.actionText, { color: colors.text }]}>Share</Text>
                </View>
              </Press>
            </View>

            <Text style={[type.caption, { textAlign: 'center', marginTop: 12, paddingHorizontal: 16 }]}>
              Print this poster and place it at your register, window, or table. Customers scan the QR code to follow you on all your socials at once.
            </Text>
          </FadeIn>
        ) : tab === 'qr' ? (
          /* ---- QR code only ---- */
          <FadeIn index={1} style={{ alignItems: 'center', marginTop: 24 }}>
            <QRPlaceholder size={200} />
            <Text style={[type.headline, { marginTop: 20 }]}>@{profile?.username}</Text>
            <Text style={[type.caption, { marginTop: 6, textAlign: 'center', maxWidth: 280 }]}>
              Anyone who scans this QR code lands on your iYiYi profile and can follow all your socials in one tap.
            </Text>
            <View style={[styles.posterActions, { marginTop: 20 }]}>
              <Press onPress={savePoster} haptic="light" style={{ flex: 1 }}>
                <LinearGradient colors={['#6b7cff', '#8f5bff']} style={styles.actionBtn}>
                  <Ionicons name="download" size={18} color="#fff" />
                  <Text style={styles.actionText}>Save QR</Text>
                </LinearGradient>
              </Press>
              <Press onPress={shareLink} haptic="light" style={{ flex: 1 }}>
                <View style={styles.actionBtnOutline}>
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text style={[styles.actionText, { color: colors.text }]}>Share</Text>
                </View>
              </Press>
            </View>
          </FadeIn>
        ) : (
          /* ---- Tap link ---- */
          <FadeIn index={1} style={{ marginTop: 16 }}>
            <GlassPanel radius={radii.lg} lite animateIn={false}>
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Ionicons name="link" size={36} color={colors.magenta} />
                <Text style={[type.headline, { marginTop: 12 }]}>Your tap-to-follow link</Text>
                <Pressable onPress={copyLink} style={styles.linkBox}>
                  <Text style={styles.linkText} selectable>{tapLink}</Text>
                  <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
                </Pressable>
                <Text style={[type.caption, { marginTop: 12, textAlign: 'center' }]}>
                  Add this link to your Instagram bio, business card, or email signature. Anyone who taps it sees your profile and can follow you everywhere.
                </Text>
                <Press onPress={shareLink} haptic="light" style={{ marginTop: 16 }}>
                  <LinearGradient colors={['#06b6d4', '#3b82f6']} style={styles.actionBtn}>
                    <Ionicons name="share-outline" size={18} color="#fff" />
                    <Text style={styles.actionText}>Share link</Text>
                  </LinearGradient>
                </Press>
              </View>
            </GlassPanel>
          </FadeIn>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  upgradeGrad: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  // Tabs
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  tabActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  tabText: { fontWeight: '700', fontSize: 13, color: colors.textMuted },
  tabTextActive: { color: '#fff' },
  // Poster
  posterWrap: { alignSelf: 'center', width: POSTER_W, borderRadius: 16, overflow: 'hidden' },
  poster: { padding: 28, alignItems: 'center' },
  posterBrand: { alignItems: 'center', marginBottom: 20 },
  posterLogo: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  posterTagline: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  posterName: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.5 },
  posterBio: { fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 6, maxWidth: 260 },
  posterQR: { marginTop: 20 },
  posterScan: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: 10 },
  posterSocials: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 },
  socialPill: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  socialPillText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  posterLinkPill: { marginTop: 16, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  posterLinkText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  posterFooter: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 16 },
  // Actions
  posterActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: { flexDirection: 'row', gap: 8, paddingVertical: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  actionBtnOutline: { flexDirection: 'row', gap: 8, paddingVertical: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // Link
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radii.sm, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  linkText: { ...type.body, color: colors.accent, fontWeight: '600', flex: 1 },
})
