import { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radii } from '../theme'
import Glass from './Glass'
import { useT } from '../i18n'
import strings from '../i18n/strings/guest'

// Everything a logged-out visitor can't do yet (like, comment, follow, save, camera, arcade,
// live) funnels into one glass "Sign up to ..." prompt with a Sign up button and a Log in link.
// title / sub are keys in i18n/strings/guest (read them with useT(guestStrings)).
export const GUEST_PROMPTS = {
  like: { icon: 'heart', title: 'likeTitle', sub: 'likeSub' },
  comment: { icon: 'chatbubble-ellipses', title: 'commentTitle', sub: 'commentSub' },
  save: { icon: 'bookmark', title: 'saveTitle', sub: 'saveSub' },
  follow: { icon: 'person-add', title: 'followTitle', sub: 'followSub' },
  live: { icon: 'radio', title: 'liveTitle', sub: 'liveSub' },
  camera: { icon: 'camera', title: 'cameraTitle', sub: 'cameraSub' },
  arcade: { icon: 'game-controller', title: 'arcadeTitle', sub: 'arcadeSub' },
}

// Navigates to the sign-in screen from anywhere in the guest navigator (tab screens bubble up
// to the root stack).
export function useGuestAuth() {
  const navigation = useNavigation()
  const signUp = useCallback(() => navigation.navigate('SignIn', { mode: 'signup' }), [navigation])
  const logIn = useCallback(() => navigation.navigate('SignIn', { mode: 'login' }), [navigation])
  return { signUp, logIn }
}

// Gradient "Sign up" button used by the prompt and the locked screens.
export function SignUpButton({ onPress, label: labelProp, style }) {
  const t = useT(strings)
  const label = labelProp ?? t('signUpFree')
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [style, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}>
      <LinearGradient colors={['#ff4fa3', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.signup}>
        <Ionicons name="sparkles" size={16} color="#fff" />
        <Text style={styles.signupText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}

// Small glass "Log in" pill for guest headers.
export function GuestLoginButton() {
  const t = useT(strings)
  const { logIn } = useGuestAuth()
  return (
    <Pressable onPress={logIn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('logIn')} style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}>
      <Glass radius={radii.pill} shadow={false} interactive>
        <View style={styles.loginPill}>
          <Text style={styles.loginText}>{t('logIn')}</Text>
        </View>
      </Glass>
    </Pressable>
  )
}

// Bottom glass sheet. kind: a key of GUEST_PROMPTS (null hides it). onLeave runs before
// navigating away (e.g. so a full-screen viewer can close itself first).
export function GuestPromptSheet({ kind, onClose, onLeave }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { signUp, logIn } = useGuestAuth()
  const p = GUEST_PROMPTS[kind] ?? GUEST_PROMPTS.like
  const go = (fn) => () => {
    onClose?.()
    onLeave?.()
    fn()
  }
  return (
    <Modal visible={!!kind} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <Glass radius={30} strong scheme="dark" style={styles.sheet}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t('close')}>
            <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <LinearGradient colors={['rgba(255,79,163,0.35)', 'rgba(143,91,255,0.35)']} style={styles.iconRing}>
            <Ionicons name={p.icon} size={28} color="#fff" />
          </LinearGradient>
          <Text style={styles.title} accessibilityRole="header">{t(p.title)}</Text>
          <Text style={styles.sub}>{t(p.sub)}</Text>
          <SignUpButton onPress={go(signUp)} style={{ alignSelf: 'stretch', marginTop: 20 }} />
          <Pressable onPress={go(logIn)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t('haveAccount')} ${t('logIn')}`} style={{ marginTop: 14 }}>
            <Text style={styles.login}>{t('haveAccount')} <Text style={styles.loginStrong}>{t('logIn')}</Text></Text>
          </Pressable>
        </Glass>
      </View>
    </Modal>
  )
}

// [sheetElement, prompt(kind)] for screens that gate actions behind sign-up.
export function useGuestPrompt(onLeave) {
  const [kind, setKind] = useState(null)
  const prompt = useCallback((k) => setKind(k), [])
  const sheet = <GuestPromptSheet kind={kind} onClose={() => setKind(null)} onLeave={onLeave} />
  return [sheet, prompt]
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,4,10,0.55)' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 440, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 20, alignItems: 'center' },
  close: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  iconRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  title: { marginTop: 14, fontSize: 21, ...font.heavy, color: '#fff', letterSpacing: -0.4, textAlign: 'center' },
  sub: { marginTop: 6, fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 20 },
  login: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  loginStrong: { color: '#fff', ...font.bold },
  signup: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 28, height: 52, borderRadius: radii.pill,
    shadowColor: '#ff4fa3', shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  signupText: { color: '#fff', fontSize: 17, ...font.bold, letterSpacing: 0.2 },
  loginPill: { height: 36, paddingHorizontal: 16, justifyContent: 'center' },
  loginText: { color: colors.text, fontSize: 14, ...font.semibold },
})
