import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font } from '../theme'
import GlassPanel from '../components/GlassPanel'
import { GUEST_PROMPTS, SignUpButton, useGuestAuth } from '../components/GuestPrompt'

// The Camera and Arcade tabs for logged-out visitors: visible, but they only explain what's
// behind them and ask the visitor to sign up. The real camera and games never open for guests.
const PERKS = {
  camera: [
    { icon: 'aperture-outline', text: 'Photos and videos with live filters' },
    { icon: 'people-outline', text: 'Tag the people around you' },
    { icon: 'albums-outline', text: 'Post straight to your profile and the feed' },
  ],
  arcade: [
    { icon: 'flash-outline', text: 'Real-time games against people nearby' },
    { icon: 'trophy-outline', text: 'Challenge friends and climb the leaderboards' },
    { icon: 'sparkles-outline', text: 'New games added all the time' },
  ],
}

const SUBS = {
  camera: 'The iYiYi camera is for members. Create a free account to start shooting.',
  arcade: 'The Arcade is for members. Create a free account to start playing.',
}

export default function GuestLockedScreen({ route }) {
  const kind = route?.params?.kind === 'arcade' ? 'arcade' : 'camera'
  const p = GUEST_PROMPTS[kind]
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
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.sub}>{SUBS[kind]}</Text>
          <View style={styles.perks}>
            {PERKS[kind].map((k) => (
              <View key={k.text} style={styles.perk}>
                <Ionicons name={k.icon} size={18} color={colors.accent} />
                <Text style={styles.perkText}>{k.text}</Text>
              </View>
            ))}
          </View>
          <SignUpButton onPress={signUp} style={{ alignSelf: 'stretch', marginTop: 24 }} />
          <Pressable onPress={logIn} hitSlop={8} accessibilityRole="button" style={{ marginTop: 16 }}>
            <Text style={styles.login}>Already have an account? <Text style={styles.loginStrong}>Log in</Text></Text>
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
