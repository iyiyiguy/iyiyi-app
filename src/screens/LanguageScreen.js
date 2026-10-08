import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import GlassPanel from '../components/GlassPanel'
import { HeaderButton } from '../components/BrandHeader'
import { LANGUAGES, setLanguage, useLanguage, useT } from '../i18n'
import strings from '../i18n/strings/language'

// Language picker. Shown once on first launch (`onDone` set: a Continue button) and from
// Settings → Language (a back button; the choice applies immediately).
export default function LanguageScreen({ navigation, onDone }) {
  const insets = useSafeAreaInsets()
  const current = useLanguage()
  const t = useT(strings)
  const firstRun = typeof onDone === 'function'
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {!firstRun && navigation?.canGoBack?.() ? (
          <View style={styles.topBar}><HeaderButton icon="chevron-back" onPress={() => navigation.goBack()} label="Back" /></View>
        ) : null}
        <FadeIn style={{ alignItems: 'center', marginTop: firstRun ? 24 : 4 }}>
          <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.globe}>
            <Ionicons name="language" size={32} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>{firstRun ? t('title') : t('settingsTitle')}</Text>
          <Text style={styles.sub}>{t('sub')}</Text>
        </FadeIn>
        <FadeIn index={1} style={{ marginTop: 22 }}>
          <GlassPanel radius={radii.lg} animateIn={false}>
            {LANGUAGES.map((l, i) => {
              const on = l.code === current
              return (
                <Press key={l.code} onPress={() => setLanguage(l.code)} haptic="selection" accessibilityLabel={l.name} accessibilityState={{ selected: on }}>
                  <View style={[styles.row, i > 0 && styles.divider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={type.headline}>{l.native}</Text>
                      {l.native !== l.name ? <Text style={type.caption}>{l.name}</Text> : null}
                    </View>
                    {on ? <Ionicons name="checkmark-circle" size={22} color={colors.magenta} /> : <View style={styles.dot} />}
                  </View>
                </Press>
              )
            })}
          </GlassPanel>
        </FadeIn>
        {firstRun ? (
          <FadeIn index={2} style={{ marginTop: 22 }}>
            <Press onPress={() => { setLanguage(current); onDone() }} scaleTo={0.97} haptic="light" accessibilityLabel={t('continue')}>
              <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
                <Text style={styles.buttonText}>{t('continue')}</Text>
              </LinearGradient>
            </Press>
          </FadeIn>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  topBar: { flexDirection: 'row', minHeight: 44 },
  globe: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { ...type.display, textAlign: 'center' },
  sub: { ...type.subhead, textAlign: 'center', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.hairline },
  button: { paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 17 },
})
