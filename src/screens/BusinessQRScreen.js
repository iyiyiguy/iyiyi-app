import { useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Share, Platform, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library/legacy'
import * as Sharing from 'expo-sharing'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import SocialIcon from '../components/SocialIcon'
import QRCode, { profileQrUrl } from '../components/business/QRCode'
import { BusinessGate, StateCard } from '../components/business/BusinessStates'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import useBusinessAccess from '../lib/useBusinessAccess'
import { useT } from '../i18n'
import strings from '../i18n/strings/business'

// Business Pro: a real, scannable QR code (drawn on the device by src/lib/qr.js) for
// https://app.iyiyi.xyz/u/<username>?src=qr, a printable poster around it, and the plain tap link.
// The ?src=qr tag lets "Where people find you" count scans as their own source.

export default function BusinessQRScreen({ navigation }) {
  const t = useT(strings)
  const access = useBusinessAccess()
  return (
    <BusinessGate access={access} title={t('qr_title')} lockedText={t('locked_qr')} navigation={navigation}>
      <QRTools navigation={navigation} profile={access.profile} retry={access.retry} />
    </BusinessGate>
  )
}

function QRTools({ navigation, profile, retry }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const posterW = Math.min(winW - 40, 380)
  const posterRef = useRef(null)
  const qrRef = useRef(null)
  const [saving, setSaving] = useState(null) // 'poster' | 'qr' | null
  const [tab, setTab] = useState('qr') // 'qr' | 'poster' | 'link'

  const username = profile?.username
  const qrUrl = username ? profileQrUrl(username) : null
  const tapLink = username ? `https://app.iyiyi.xyz/u/${encodeURIComponent(username)}` : null
  const name = profile?.display_name || username || t('your_business')
  const socials = (profile?.social_links ?? []).filter((s) => s?.platform && s?.value)

  const shareLink = async () => {
    if (!tapLink) return
    try {
      await Share.share({ url: tapLink, message: t('share_message', { name, url: tapLink }) })
    } catch {}
  }

  const copyLink = () => {
    if (!tapLink) return
    if (Platform.OS === 'web' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(tapLink).then(() => Alert.alert(t('copied'), tapLink)).catch(() => shareLink())
    } else {
      // expo-clipboard isn't installed; the share sheet has "Copy".
      shareLink()
    }
  }

  // Saves the QR (or the whole poster) as a PNG: photo library first, share sheet as fallback.
  const saveImage = async (which) => {
    const ref = which === 'poster' ? posterRef : qrRef
    if (!ref.current) return
    setSaving(which)
    try {
      const uri = await captureRef(ref.current, { format: 'png', quality: 1, result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile' })
      const fileName = `${username ?? 'iyiyi'}-${which}.png`
      if (Platform.OS === 'web') {
        const a = document.createElement('a')
        a.href = uri
        a.download = fileName
        a.click()
        return
      }
      let saved = false
      try {
        const perm = await MediaLibrary.requestPermissionsAsync(true)
        if (perm.granted) {
          await MediaLibrary.saveToLibraryAsync(uri)
          saved = true
          Alert.alert(t('saved_title'), t('saved_msg'))
        }
      } catch {
        saved = false
      }
      if (!saved) {
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: name, UTI: 'public.png' })
        else Alert.alert(t('save_qr'), t('err_photos'))
      }
    } catch (e) {
      Alert.alert(t('save_qr'), e?.message || t('err_save'))
    } finally {
      setSaving(null)
    }
  }

  if (!username) {
    return (
      <View style={styles.screen}>
        <BrandHeader title={t('qr_title')} onBack={() => navigation.goBack()} />
        <View style={{ padding: 16 }}>
          <StateCard tone="error" title={t('err_profile_title')} message={t('no_username')} actionLabel={t('retry')} onAction={retry} />
        </View>
      </View>
    )
  }

  const saveButton = (which, label) => (
    <Press onPress={() => saveImage(which)} disabled={!!saving} haptic="light" style={{ flex: 1 }} accessibilityLabel={label}>
      <LinearGradient colors={['#6b7cff', '#8f5bff']} style={styles.actionBtn}>
        {saving === which ? <ActivityIndicator color="#fff" /> : (
          <>
            <Ionicons name="download" size={18} color="#fff" />
            <Text style={styles.actionText}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Press>
  )
  const shareButton = () => (
    <Press onPress={shareLink} haptic="light" style={{ flex: 1 }} accessibilityLabel={t('share')}>
      <View style={styles.actionBtnOutline}>
        <Ionicons name="share-outline" size={18} color={colors.text} />
        <Text style={[styles.actionText, { color: colors.text }]}>{t('share')}</Text>
      </View>
    </Press>
  )

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('qr_title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <View style={styles.tabRow}>
            {['qr', 'poster', 'link'].map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.tabBtn, tab === k && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
                <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
                  {k === 'poster' ? t('tab_poster') : k === 'qr' ? t('tab_qr') : t('tab_link')}
                </Text>
              </Pressable>
            ))}
          </View>
        </FadeIn>

        {tab === 'poster' ? (
          <FadeIn index={1}>
            <View ref={posterRef} collapsable={false} style={[styles.posterWrap, { width: posterW }]}>
              <LinearGradient colors={['#0c0f1a', '#1a1040', '#0c0f1a']} style={styles.poster}>
                <View style={styles.posterBrand}>
                  <Text style={styles.posterLogo}>iYiYi</Text>
                  <Text style={styles.posterTagline}>{t('poster_tagline')}</Text>
                </View>
                <Text style={styles.posterName}>{name}</Text>
                {profile?.bio ? <Text style={styles.posterBio} numberOfLines={2}>{profile.bio}</Text> : null}
                <View style={styles.posterQR}>
                  <QRCode value={qrUrl} size={168} accessibilityLabel={qrUrl} />
                </View>
                <Text style={styles.posterScan}>{t('poster_scan')}</Text>
                {socials.length > 0 && (
                  <View style={styles.posterSocials}>
                    {socials.slice(0, 6).map((s) => (
                      <View key={`${s.platform}-${s.value}`} style={styles.socialPill}>
                        <SocialIcon platform={s.platform} size={14} color="rgba(255,255,255,0.9)" />
                        <Text style={styles.socialPillText} numberOfLines={1}>{String(s.value).replace(/^@/, '').slice(0, 24)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.posterLinkPill}>
                  <Text style={styles.posterLinkText}>{tapLink.replace(/^https:\/\//, '')}</Text>
                </View>
                <Text style={styles.posterFooter}>{t('poster_footer')}</Text>
              </LinearGradient>
            </View>
            <View style={styles.posterActions}>
              {saveButton('poster', t('save_poster'))}
              {shareButton()}
            </View>
            <Text style={[type.caption, styles.hint]}>{t('poster_hint')}</Text>
          </FadeIn>
        ) : tab === 'qr' ? (
          <FadeIn index={1} style={{ alignItems: 'center', marginTop: 8 }}>
            <View ref={qrRef} collapsable={false} style={styles.qrCard}>
              <QRCode value={qrUrl} size={220} accessibilityLabel={qrUrl} />
              <Text style={styles.qrCardName} numberOfLines={1}>@{username}</Text>
            </View>
            <Text style={[type.caption, styles.hint, { maxWidth: 300 }]}>{t('qr_hint')}</Text>
            <View style={[styles.posterActions, { alignSelf: 'stretch' }]}>
              {saveButton('qr', t('save_qr'))}
              {shareButton()}
            </View>
          </FadeIn>
        ) : (
          <FadeIn index={1} style={{ marginTop: 4 }}>
            <GlassPanel radius={radii.lg} lite animateIn={false}>
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Ionicons name="link" size={36} color={colors.magenta} />
                <Text style={[type.headline, { marginTop: 12 }]}>{t('link_heading')}</Text>
                <Pressable onPress={copyLink} style={styles.linkBox} accessibilityRole="button" accessibilityLabel={tapLink}>
                  <Text style={styles.linkText} selectable>{tapLink}</Text>
                  <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
                </Pressable>
                <Text style={[type.caption, { marginTop: 12, textAlign: 'center' }]}>{t('link_hint')}</Text>
                <Press onPress={shareLink} haptic="light" style={{ marginTop: 16, alignSelf: 'stretch' }} accessibilityLabel={t('share_link')}>
                  <LinearGradient colors={['#06b6d4', '#3b82f6']} style={styles.actionBtn}>
                    <Ionicons name="share-outline" size={18} color="#fff" />
                    <Text style={styles.actionText}>{t('share_link')}</Text>
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
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  tabActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  tabText: { fontWeight: '700', fontSize: 13, color: colors.textMuted },
  tabTextActive: { color: '#fff' },
  qrCard: { backgroundColor: '#ffffff', borderRadius: 18, padding: 14, alignItems: 'center' },
  qrCardName: { color: '#111', fontWeight: '700', fontSize: 15, marginTop: 4 },
  hint: { textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },
  posterWrap: { alignSelf: 'center', borderRadius: 16, overflow: 'hidden' },
  poster: { padding: 28, alignItems: 'center' },
  posterBrand: { alignItems: 'center', marginBottom: 20 },
  posterLogo: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  posterTagline: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  posterName: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.5 },
  posterBio: { fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 6, maxWidth: 260 },
  posterQR: { marginTop: 20, borderRadius: 10, overflow: 'hidden' },
  posterScan: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: 10 },
  posterSocials: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 },
  socialPill: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, maxWidth: 160 },
  socialPillText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600', flexShrink: 1 },
  posterLinkPill: { marginTop: 16, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  posterLinkText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  posterFooter: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 16 },
  posterActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: { flexDirection: 'row', gap: 8, paddingVertical: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  actionBtnOutline: { flexDirection: 'row', gap: 8, paddingVertical: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radii.sm, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  linkText: { ...type.body, color: colors.accent, fontWeight: '600', flex: 1 },
})
