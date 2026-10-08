import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import GlassPanel from '../components/GlassPanel'
import { useT } from '../i18n'
import strings from '../i18n/strings/locationConsent'

// First screen after sign-up: what location is used for, in plain words, before the system
// prompt ever appears. Informational only - the OS asks for the actual permission later, when
// the Nearby tab opens.
// title/text are keys into strings/locationConsent, translated at render.
const POINTS = [
  { icon: 'people', colors: ['#6b7cff', '#9b8cff'], title: 'p1Title', text: 'p1Text' },
  { icon: 'eye-off', colors: ['#4fd1c5', '#7fb3ff'], title: 'p2Title', text: 'p2Text' },
  { icon: 'shield-checkmark', colors: ['#ff6fb5', '#ff9fd0'], title: 'p3Title', text: 'p3Text' },
]

export default function LocationConsentScreen({ onContinue }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <FadeIn style={{ alignItems: 'center' }}>
          <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pin}>
            <Ionicons name="location" size={34} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>{t('title')}</Text>
          <Text style={styles.sub}>{t('sub')}</Text>
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
          <Press onPress={onContinue} scaleTo={0.97} haptic="light" accessibilityLabel={t('continue')}>
            <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
              <Text style={styles.buttonText}>{t('continue')}</Text>
            </LinearGradient>
          </Press>
          <Text style={styles.fine}>{t('fine')}</Text>
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
})
