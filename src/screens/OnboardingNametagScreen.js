import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, gradients, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import GlassPanel from '../components/GlassPanel'
import OnboardingSteps from '../components/OnboardingSteps'
import { supabase } from '../lib/supabase'
import { patch } from '../lib/api'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/onboarding'

// "Your nametag" onboarding step: photo, display name and @handle - what strangers within
// 150 ft see. Sign-up picks a username silently for Apple / Google / phone accounts (first name,
// email prefix or iyiyi_xxxxxxxx), so this is where people choose their own. Skippable.
//
// Saving reuses what Edit Profile (MyProfileScreen) does: the photo goes to the 'avatars'
// storage bucket at <uid>/<timestamp>.<ext> and its public URL is PATCHed to /api/profiles/me
// straight away; the username is PATCHed to /api/profiles/me. There's no availability endpoint,
// so the live check uses the same profiles lookup by username as PublicProfileScreen plus the
// username_is_clean RPC sign-up uses; the server still has the final say on save.
const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/
const SUB = { business: 'nametagSubBiz', creator: 'nametagSubCreator', player: 'nametagSubPlayer' }

// Same as MyProfileScreen: the picker's mimeType is reliable on native and web (web URIs are
// blob: with no extension).
function mimeAndExtFromAsset(asset) {
  if (asset.mimeType) return { mimeType: asset.mimeType, ext: asset.mimeType.split('/').pop() }
  const uriExt = asset.uri.split('.').pop()?.toLowerCase()
  const ext = uriExt && uriExt.length <= 4 ? uriExt : 'jpg'
  return { mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, ext }
}

// Never leave someone stuck on a spinner on a slow network.
function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// Tells whether this account still needs the step: no photo, or a username the app picked.
export function needsNametag(profile, user) {
  if (!profile) return false
  const provider = user?.app_metadata?.provider
  const autoName = !profile.username || /^iyiyi_[a-z0-9]{6,}$/i.test(profile.username) || (provider && provider !== 'email')
  return !profile.avatar_url || autoName
}

export default function OnboardingNametagScreen({ user, profile, intent, onDone, step, total }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  const original = profile?.username ?? ''
  const originalName = profile?.display_name ?? user?.user_metadata?.display_name ?? ''
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null)
  const [displayName, setDisplayName] = useState(originalName)
  const [username, setUsername] = useState(original)
  const [status, setStatus] = useState('idle') // idle | checking | available | taken | invalid | notAllowed
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const checkSeq = useRef(0)

  const handle = username.trim().replace(/^@+/, '')
  const changed = handle !== original

  useEffect(() => {
    const seq = ++checkSeq.current
    if (!changed || !handle) { setStatus('idle'); return }
    if (!USERNAME_RE.test(handle)) { setStatus('invalid'); return }
    setStatus('checking')
    const timer = setTimeout(async () => {
      try {
        const { data: clean } = await withTimeout(supabase.rpc('username_is_clean', { u: handle }), 5000)
        if (seq !== checkSeq.current) return
        if (clean === false) { setStatus('notAllowed'); return }
      } catch {
        // The filter couldn't be reached; the save will still be checked by the server.
      }
      try {
        const pattern = handle.replace(/[\\%_]/g, '\\$&')
        const { data, error: e } = await withTimeout(supabase.from('profiles').select('id').ilike('username', pattern).limit(1), 5000)
        if (seq !== checkSeq.current) return
        if (e) { setStatus('idle'); return }
        const other = (data ?? []).some((r) => r.id && r.id !== user?.id)
        setStatus(other ? 'taken' : 'available')
      } catch {
        if (seq === checkSeq.current) setStatus('idle')
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [handle, changed, user?.id])

  const pickAvatar = async () => {
    if (uploading) return
    let result
    try {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] })
    } catch {
      return
    }
    if (result.canceled || !result.assets?.[0]) return
    setError('')
    setUploading(true)
    try {
      const asset = result.assets[0]
      const { mimeType, ext } = mimeAndExtFromAsset(asset)
      const path = `${user.id}/${Date.now()}.${ext}`
      await withTimeout((async () => {
        const arrayBuffer = await fetch(asset.uri).then((r) => r.arrayBuffer())
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, arrayBuffer, { contentType: mimeType, upsert: true })
        if (uploadError) throw uploadError
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
        const avatar_url = `${publicUrl}?t=${Date.now()}`
        await patch('/api/profiles/me', { avatar_url })
        setAvatarUrl(avatar_url)
      })(), 30000)
    } catch {
      setError(t('uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const blocked = changed && (status === 'taken' || status === 'invalid' || status === 'notAllowed' || !handle)
  const save = async () => {
    if (saving || uploading || blocked) return
    setError('')
    const name = displayName.trim()
    // Display name isn't an Edit Profile field: kept best-effort (profile + account metadata),
    // never a reason to hold someone on this step.
    if (name && name !== originalName) {
      patch('/api/profiles/me', { display_name: name }).catch(() => {})
      supabase.auth.updateUser({ data: { display_name: name } }).catch(() => {})
    }
    if (!changed) { onDone(); return }
    setSaving(true)
    try {
      await withTimeout(patch('/api/profiles/me', { username: handle }), 10000)
      onDone()
    } catch (e) {
      setError(e?.message && e.message !== 'timeout' && e.message !== 'Something went wrong' ? e.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const statusView = {
    checking: { icon: null, color: colors.textFaint, text: t('checking') },
    available: { icon: 'checkmark-circle', color: colors.success, text: t('available') },
    taken: { icon: 'close-circle', color: colors.danger, text: t('taken') },
    invalid: { icon: 'alert-circle', color: colors.danger, text: t('invalid') },
    notAllowed: { icon: 'close-circle', color: colors.danger, text: t('notAllowed') },
  }[status]
  const role = intent ? t(`role_${intent}`) : null
  const shownName = displayName.trim() || handle || original

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <OnboardingSteps step={step} total={total} onSkip={onDone} style={{ paddingHorizontal: 0 }} />
        <FadeIn style={{ marginTop: 28 }}>
          <Text style={styles.title}>{t('nametagTitle')}</Text>
          <Text style={styles.sub}>{t(SUB[intent] ?? 'nametagSubCreator')}</Text>
        </FadeIn>

        {/* Preview: the card people nearby see. */}
        <FadeIn index={1} style={{ marginTop: 22 }}>
          <GlassPanel radius={radii.lg} animateIn={false}>
            <View style={styles.preview}>
              <Press onPress={pickAvatar} disabled={uploading} scaleTo={0.95} haptic="light" accessibilityLabel={avatarUrl ? t('changePhoto') : t('addPhoto')}>
                <View>
                  <Image source={avatarSource(avatarUrl)} style={styles.avatar} contentFit="cover" />
                  <View style={styles.camBadge}>
                    {uploading ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Ionicons name="camera" size={15} color={colors.onBrand} />}
                  </View>
                </View>
              </Press>
              <View style={{ flex: 1 }}>
                <Text style={type.title3} numberOfLines={1}>{shownName}</Text>
                <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>@{handle || original}{role ? ` · ${role}` : ''}</Text>
                <Press onPress={pickAvatar} disabled={uploading} haptic="selection" accessibilityLabel={avatarUrl ? t('changePhoto') : t('addPhoto')} style={{ alignSelf: 'flex-start' }}>
                  <Text style={styles.photoLink}>{avatarUrl ? t('changePhoto') : t('addPhoto')}</Text>
                </Press>
              </View>
            </View>
          </GlassPanel>
          <Text style={styles.previewHint}>{t('preview')}</Text>
        </FadeIn>

        <FadeIn index={2} style={{ marginTop: 18 }}>
          <Text style={type.label}>{t('displayName')}</Text>
          <GlassPanel radius={radii.md} animateIn={false} style={{ marginTop: 8 }}>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('displayNamePlaceholder')}
              placeholderTextColor={colors.textFaint}
              maxLength={50}
              returnKeyType="next"
              accessibilityLabel={t('displayName')}
            />
          </GlassPanel>

          <Text style={[type.label, { marginTop: 16 }]}>{t('username')}</Text>
          <GlassPanel radius={radii.md} animateIn={false} style={{ marginTop: 8 }}>
            <View style={styles.handleRow}>
              <Text style={styles.at}>@</Text>
              <TextInput
                style={[styles.input, { flex: 1, paddingLeft: 2 }]}
                value={username}
                onChangeText={(v) => setUsername(v.replace(/\s/g, ''))}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={save}
                accessibilityLabel={t('username')}
              />
              {statusView ? (
                <View style={styles.status}>
                  {statusView.icon ? <Ionicons name={statusView.icon} size={16} color={statusView.color} /> : <ActivityIndicator size="small" color={colors.textFaint} />}
                </View>
              ) : null}
            </View>
          </GlassPanel>
          {statusView ? <Text style={[styles.statusText, { color: statusView.color }]}>{statusView.text}</Text> : null}
        </FadeIn>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FadeIn index={3} style={{ marginTop: 26 }}>
          <Press onPress={save} disabled={saving || uploading || blocked} scaleTo={0.97} haptic="light" accessibilityLabel={t('continue')} style={{ opacity: saving || uploading || blocked ? 0.5 : 1 }}>
            <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
              {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>{t('continue')}</Text>}
            </LinearGradient>
          </Press>
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { ...type.display },
  sub: { ...type.subhead, marginTop: 8 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: colors.glassBorderLight },
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.magenta, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink },
  photoLink: { color: colors.accent, fontWeight: '600', fontSize: 14, marginTop: 8 },
  previewHint: { ...type.caption, textAlign: 'center', marginTop: 8 },
  input: { paddingHorizontal: 16, paddingVertical: 14, color: colors.text, fontSize: 16 },
  handleRow: { flexDirection: 'row', alignItems: 'center' },
  at: { color: colors.textMuted, fontSize: 16, fontWeight: '600', paddingLeft: 16 },
  status: { paddingRight: 14 },
  statusText: { ...type.caption, marginTop: 6, fontWeight: '600' },
  error: { color: colors.danger, marginTop: 14, textAlign: 'center' },
  button: { paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center', shadowColor: '#6b7cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 17 },
})
