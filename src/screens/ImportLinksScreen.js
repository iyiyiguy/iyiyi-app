import { useState } from 'react'
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ImportLinksPanel from '../components/ImportLinksPanel'
import GlassPanel from '../components/GlassPanel'
import SocialIcon from '../components/SocialIcon'
import OnboardingSteps from '../components/OnboardingSteps'
import { colors, gradients, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson, patch } from '../lib/api'
import { mergeLinks } from '../lib/importLinks'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import { useT } from '../i18n'
import strings from '../i18n/strings/importLinks'

// Onboarding "Where should people follow you?" step, shown once after sign-up to people whose
// profile has no links yet. Primary path: one field per platform, typed straight in (most local
// businesses and players have no link-in-bio page). Secondary: paste a Linktree-style page with
// ImportLinksPanel. Both save to /api/profiles/me the same way Edit Profile does
// ({ platform, value } entries in social_links, merged so nothing is duplicated). Skippable.

// The first fields shown, by what the person said brings them here; the rest of the app's
// platforms (lib/socialLinks PLATFORM_LABELS) are one tap away under "More platforms".
const PRIMARY = {
  business: ['instagram', 'facebook', 'tiktok', 'whatsapp', 'youtube'],
  creator: ['instagram', 'tiktok', 'youtube', 'snapchat', 'twitter'],
  player: ['twitch', 'discord', 'youtube', 'tiktok', 'instagram'],
}
const INTRO = { business: 'introBiz', creator: 'introCreator', player: 'introPlayer' }
const SAVE_TIMEOUT_MS = 12000

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// "@name", "name" or a full URL are all stored as typed (trimmed), like Edit Profile does;
// socialUrl() turns them into links. A lone "@" counts as empty.
const clean = (v) => {
  const s = String(v ?? '').trim()
  return s.replace(/^@+/, '') ? s : ''
}

export default function ImportLinksScreen({ onDone, intent, step, total }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState('handles') // 'handles' | 'linktree'
  const primary = PRIMARY[intent] ?? PRIMARY.creator
  const [shown, setShown] = useState(primary)
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const more = Object.keys(PLATFORM_LABELS).filter((k) => !shown.includes(k))
  const entered = shown.map((platform) => ({ platform, value: clean(values[platform]) })).filter((l) => l.value)

  const saveLinks = async (imported) => {
    const current = await apiJson('/api/profiles/me')
    await patch('/api/profiles/me', mergeLinks(current, imported))
  }

  const saveHandles = async () => {
    if (saving) return
    if (entered.length === 0) { onDone(); return }
    setSaving(true)
    setError('')
    try {
      await withTimeout(saveLinks({ social_links: entered, websites: [] }), SAVE_TIMEOUT_MS)
      onDone()
    } catch {
      setError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // ImportLinksPanel shows its own inline error when this throws.
  const importLinktree = async (imported) => {
    try {
      await withTimeout(saveLinks(imported), SAVE_TIMEOUT_MS)
    } catch {
      throw new Error(t('saveFailed'))
    }
    onDone()
  }

  if (mode === 'linktree') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
        <OnboardingSteps step={step} total={total} onSkip={onDone} />
        <Text style={[styles.title, { marginHorizontal: 20, marginTop: 24, marginBottom: 12 }]}>{t('title')}</Text>
        <View style={{ flex: 1 }}>
          <ImportLinksPanel intro={t('linktreeIntro')} importLabel={t('linktreeAdd')} onImport={importLinktree} />
        </View>
        <Press onPress={() => setMode('handles')} haptic="selection" accessibilityLabel={t('typeInstead')} style={[styles.secondary, { marginBottom: insets.bottom + 12 }]}>
          <Text style={styles.secondaryText}>{t('typeInstead')}</Text>
        </Press>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <OnboardingSteps step={step} total={total} onSkip={onDone} style={{ paddingHorizontal: 0 }} />
        <FadeIn style={{ marginTop: 28 }}>
          <Text style={styles.title}>{t('title')}</Text>
          <Text style={styles.sub}>{t(INTRO[intent] ?? 'introCreator')}</Text>
        </FadeIn>

        <View style={{ marginTop: 20, gap: 10 }}>
          {shown.map((platform, i) => (
            <FadeIn key={platform} index={Math.min(i + 1, 6)}>
              <GlassPanel radius={radii.md} animateIn={false}>
                <View style={styles.field}>
                  <View style={styles.iconWrap}><SocialIcon platform={platform} size={20} color={colors.text} /></View>
                  <Text style={styles.platform} numberOfLines={1}>{PLATFORM_LABELS[platform] ?? platform}</Text>
                  <TextInput
                    style={styles.input}
                    value={values[platform] ?? ''}
                    onChangeText={(v) => setValues((prev) => ({ ...prev, [platform]: v }))}
                    onFocus={() => { if (!values[platform] && platform !== 'whatsapp') setValues((prev) => ({ ...prev, [platform]: '@' })) }}
                    placeholder={platform === 'whatsapp' ? t('phonePlaceholder') : t('handlePlaceholder')}
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={platform === 'whatsapp' ? 'phone-pad' : 'default'}
                    returnKeyType="next"
                    accessibilityLabel={PLATFORM_LABELS[platform] ?? platform}
                  />
                </View>
              </GlassPanel>
            </FadeIn>
          ))}
        </View>

        {more.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={type.label}>{t('more')}</Text>
            <View style={styles.chips}>
              {more.map((platform) => (
                <Press key={platform} onPress={() => setShown((s) => [...s, platform])} haptic="selection" accessibilityLabel={`+ ${PLATFORM_LABELS[platform]}`}>
                  <GlassPanel radius={radii.pill} animateIn={false}>
                    <View style={styles.chip}>
                      <SocialIcon platform={platform} size={14} color={colors.textMuted} />
                      <Text style={styles.chipText}>{PLATFORM_LABELS[platform]}</Text>
                    </View>
                  </GlassPanel>
                </Press>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ marginTop: 24 }}>
          <Press onPress={saveHandles} disabled={saving} scaleTo={0.97} haptic="light" accessibilityLabel={t('continue')} style={{ opacity: saving ? 0.6 : 1 }}>
            <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
              {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>{t('continue')}</Text>}
            </LinearGradient>
          </Press>
          <Press onPress={() => setMode('linktree')} haptic="selection" accessibilityLabel={t('linktree')} style={styles.secondary}>
            <Text style={styles.secondaryText}>{t('linktree')}</Text>
          </Press>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { ...type.display },
  sub: { ...type.subhead, marginTop: 8 },
  field: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14 },
  iconWrap: { width: 26, alignItems: 'center' },
  platform: { ...type.headline, fontSize: 15, width: 96, marginLeft: 8 },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 14, color: colors.text, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  error: { color: colors.danger, marginTop: 14, textAlign: 'center' },
  button: { paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center', shadowColor: '#6b7cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 17 },
  secondary: { alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 12 },
  secondaryText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
})
