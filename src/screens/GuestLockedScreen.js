import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font } from '../theme'
import GlassPanel from '../components/GlassPanel'
import { GUEST_PROMPTS, SignUpButton, useGuestAuth } from '../components/GuestPrompt'
import { useT } from '../i18n'
import strings from '../i18n/strings/guest'

// The Camera and Arcade tabs for logged-out visitors: visible, but they only explain what's
// behind them and ask the visitor to sign up. The real camera and games never open for guests.
// text / SUBS values are keys in i18n/strings/guest.
const PERKS = {
  camera: [
    { icon: 'aperture-outline', text: 'perkCameraFilters' },
    { icon: 'people-outline', text: 'perkCameraTag' },
    { icon: 'albums-outline', text: 'perkCameraPost' },
  ],
  arcade: [
    { icon: 'flash-outline', text: 'perkArcadeRealtime' },
    { icon: 'trophy-outline', text: 'perkArcadeChallenge' },
    { icon: 'sparkles-outline', text: 'perkArcadeNew' },
  ],
}

const SUBS = {
  camera: 'lockedCameraSub',
  arcade: 'lockedArcadeSub',
}

export default function GuestLockedScreen({ route }) {
  const kind = route?.params?.kind === 'arcade' ? 'arcade' : 'camera'
  const p = GUEST_PROMPTS[kind]
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { signUp, logIn } = useGuestAuth()

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <GlassPanel radius={32} strong style={styles.card}>
        <View style={styles.inner}>
          <LinearGradient colors={['rgba(255,79,163,0.45)', 'rgba(143,91,255,0.45)']} style={styles.iconRing}>
            <Ionicons name={p.icon} size={38} color="#fff" />
            <View style={styles.lock}><Ionicons name="lock-closed" size={12} color="#fff" /></View>
          </LinearGradient>
          <Text style={styles.title} accessibilityRole="header">{t(p.title)}</Text>
          <Text style={styles.sub}>{t(SUBS[kind])}</Text>
          <View style={styles.perks}>
            {PERKS[kind].map((k) => (
              <View key={k.text} style={styles.perk}>
                <Ionicons name={k.icon} size={18} color={colors.accent} />
                <Text style={styles.perkText}>{t(k.text)}</Text>
              </View>
            ))}
          </View>
          <SignUpButton onPress={signUp} style={{ alignSelf: 'stretch', marginTop: 24 }} />
          <Pressable onPress={logIn} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t('haveAccount')} ${t('logIn')}`} style={{ marginTop: 16 }}>
            <Text style={styles.login}>{t('haveAccount')} <Text style={styles.loginStrong}>{t('logIn')}</Text></Text>
          </Pressable>
        </View>
      </GlassPanel>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 18, paddingBottom: 32 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  inner: { paddingHorizontal: 24, paddingTop: 30, paddingBottom: 24, alignItems: 'center' },
  iconRing: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  lock: {
    position: 'absolute', right: 2, bottom: 2, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#8f5bff', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
  },
  title: { marginTop: 18, fontSize: 24, ...font.heavy, color: colors.text, letterSpacing: -0.5, textAlign: 'center' },
  sub: { marginTop: 8, fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
  perks: { marginTop: 20, alignSelf: 'stretch', gap: 12 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perkText: { flex: 1, fontSize: 14, color: colors.text, ...font.medium },
  login: { color: colors.textMuted, fontSize: 14 },
  loginStrong: { color: colors.text, ...font.bold },
})
