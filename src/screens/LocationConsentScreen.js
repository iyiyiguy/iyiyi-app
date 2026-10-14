import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, AppState, Linking, Platform } from 'react-native'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import GlassPanel from '../components/GlassPanel'
import OnboardingSteps from '../components/OnboardingSteps'
import { useT } from '../i18n'
import strings from '../i18n/strings/locationConsent'

// Onboarding step after sign-up (and the nametag / social-links steps): what location is used
// for, in plain words, then the phone's own permission prompt straight from Continue, so the
// prompt arrives with its reason on screen. Denying is fine - the app continues and Nearby shows
// its "turn on location" state.
// Three branches, from the current permission:
//   granted  - nothing to ask: the step is skipped straight away (no screen, no OS prompt).
//   blocked  - denied and the OS won't ask again (iOS ignores requests after a "Don't Allow"):
//              "Open Settings" plus "Continue without"; coming back with access on continues.
//   otherwise - the explainer, Continue -> OS prompt.
// title/text are keys into strings/locationConsent, translated at render.
const POINTS = [
  { icon: 'people', colors: ['#6b7cff', '#9b8cff'], title: 'p1Title', text: 'p1Text' },
  { icon: 'eye-off', colors: ['#4fd1c5', '#7fb3ff'], title: 'p2Title', text: 'p2Text' },
  { icon: 'shield-checkmark', colors: ['#ff6fb5', '#ff9fd0'], title: 'p3Title', text: 'p3Text' },
]
const SUB = { player: 'subPlayer', business: 'subBiz' }
const CHECK_TIMEOUT_MS = 1500

// null when the permission can't be read in time (treated as "ask").
async function readPermission() {
  let timer
  try {
    return await Promise.race([
      Location.getForegroundPermissionsAsync(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS) }),
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
const isBlocked = (perm) => Platform.OS !== 'web' && perm?.status === 'denied' && perm?.canAskAgain === false

export default function LocationConsentScreen({ onContinue, intent, step, total }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  const [asking, setAsking] = useState(false)
  const [mode, setMode] = useState('checking') // checking | ask | blocked
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    onContinue()
  }

  useEffect(() => {
    let cancelled = false
    readPermission().then((perm) => {
      if (cancelled) return
      if (perm?.status === 'granted') finish()
      else setMode(isBlocked(perm) ? 'blocked' : 'ask')
    })
    return () => { cancelled = true }
  }, [])

  // Back from Settings: carry on if location was turned on there.
  useEffect(() => {
    if (mode !== 'blocked') return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      readPermission().then((perm) => { if (perm?.status === 'granted') finish() })
    })
    return () => sub.remove()
  }, [mode])

  const onPress = async () => {
    if (asking) return
    setAsking(true)
    try {
      const cur = await Location.getForegroundPermissionsAsync()
      if (cur?.status === 'undetermined' || (cur?.status !== 'granted' && cur?.canAskAgain)) {
        await Location.requestForegroundPermissionsAsync()
      }
    } catch {
      // No location module or the prompt failed: carry on, Nearby asks again in context.
    }
    finish()
  }
  const openSettings = () => {
    Linking.openSettings().catch(() => finish())
  }

  if (mode === 'checking') return <View style={styles.screen} />
  const blocked = mode === 'blocked'

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <OnboardingSteps step={step} total={total} style={{ paddingHorizontal: 0, marginBottom: 24 }} />
        <FadeIn style={{ alignItems: 'center' }}>
          <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pin}>
            <Ionicons name={blocked ? 'location-outline' : 'location'} size={34} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>{blocked ? t('blockedTitle') : t('title')}</Text>
          <Text style={styles.sub}>{blocked ? t('blockedText') : t(SUB[intent] ?? 'sub')}</Text>
        </FadeIn>

        <View style={{ marginTop: 26, gap: 10 }}>
          {POINTS.map((p, i) => (
            <FadeIn key={p.title} index={i + 1}>
              <GlassPanel radius={radii.lg} animateIn={false}>
                <View style={styles.row}>
                  <LinearGradient colors={p.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.icon}>
                    <Ionicons name={p.icon} size={20} color="#fff" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={type.headline}>{t(p.title)}</Text>
                    <Text style={[type.caption, { marginTop: 3 }]}>{t(p.text)}</Text>
                  </View>
                </View>
              </GlassPanel>
            </FadeIn>
          ))}
        </View>

        <FadeIn index={5} style={{ marginTop: 28 }}>
          {blocked ? (
            <>
              <Press onPress={openSettings} scaleTo={0.97} haptic="light" accessibilityLabel={t('openSettings')}>
                <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
                  <Text style={styles.buttonText}>{t('openSettings')}</Text>
                </LinearGradient>
              </Press>
              <Press onPress={finish} haptic="selection" accessibilityLabel={t('continueWithout')} style={styles.secondary}>
                <Text style={styles.secondaryText}>{t('continueWithout')}</Text>
              </Press>
            </>
          ) : (
            <>
              <Press onPress={onPress} disabled={asking} scaleTo={0.97} haptic="light" accessibilityLabel={t('continue')}>
                <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
                  <Text style={styles.buttonText}>{t('continue')}</Text>
                </LinearGradient>
              </Press>
              <Text style={styles.fine}>{t('fine')}</Text>
            </>
          )}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  pin: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: '#6b7cff', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  title: { ...type.display, textAlign: 'center' },
  sub: { ...type.subhead, textAlign: 'center', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  button: { paddingVertical: 16, borderRadius: 999, alignItems: 'center', shadowColor: '#6b7cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  fine: { ...type.caption, textAlign: 'center', marginTop: 14, color: colors.textFaint },
  secondary: { alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 12 },
  secondaryText: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
})
