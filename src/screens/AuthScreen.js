import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Image, ScrollView, Alert, Platform, KeyboardAvoidingView, Animated, useWindowDimensions, Linking } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type, useIsDark } from '../theme'
import { FadeIn, Press, SPRING } from '../lib/motion'
import Surface from '../components/Surface'
import { HeaderButton } from '../components/BrandHeader'
import { API_URL, supabase } from '../lib/supabase'
import * as AppleAuthentication from 'expo-apple-authentication'
import { ensureProfile, neutralUsername, signInWithApple, signInWithProvider } from '../lib/oauth'
import SocialIcon from '../components/SocialIcon'
import { logSignup } from '../lib/attribution'
import GlassPanel from '../components/GlassPanel'
import { useT } from '../i18n'
import strings from '../i18n/strings/auth'

const METHOD = { EMAIL: 'email', PHONE: 'phone' }

const ICON = require('../../assets/icon.png')
export const TERMS_URL = 'https://iyiyi.xyz/terms'
export const PRIVACY_URL = 'https://shop.iyiyi.xyz/policies/privacy-policy'

const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
]

export default function AuthScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const isDark = useIsDark()
  const t = useT(strings)
  const { width } = useWindowDimensions()
  const [method, setMethod] = useState(METHOD.EMAIL)
  const [mode, setMode] = useState(route?.params?.mode === 'signup' ? 'signup' : 'login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrMode, setQrMode] = useState(false)
  const [qrToken, setQrToken] = useState(null)
  const [qrExpired, setQrExpired] = useState(false)
  const [totalUsers, setTotalUsers] = useState(null)
  const pollRef = useRef(null)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false))
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/public/total-users`).then((r) => r.json()).then((d) => setTotalUsers(d.total_users)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!qrMode) {
      clearInterval(pollRef.current)
      return
    }
    setQrExpired(false)
    let cancelled = false
    const start = async () => {
      try {
        const res = await fetch(`${API_URL}/api/login-sessions`, { method: 'POST' })
        if (!res.ok) throw new Error(t('qrCreateError'))
        const data = await res.json()
        if (cancelled) return
        const token = data.token
        if (!token) throw new Error(t('qrCreateError'))
        setQrToken(token)
        clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`${API_URL}/api/login-sessions/${token}`)
            const pollData = await pollRes.json()
            if (cancelled) return
            if (pollData.status === 'approved') {
              clearInterval(pollRef.current)
              const { error: verifyError } = await supabase.auth.verifyOtp({
                token_hash: pollData.token_hash, type: 'magiclink',
              })
              if (verifyError && !cancelled) setError(verifyError.message)
            } else if (pollData.status === 'expired') {
              clearInterval(pollRef.current)
              setQrExpired(true)
            }
          } catch {
            // Transient network error: keep polling until the code expires.
          }
        }, 2000)
      } catch (e) {
        if (!cancelled) setError(e?.message ?? t('qrCreateErrorShort'))
      }
    }
    start()
    return () => {
      cancelled = true
      clearInterval(pollRef.current)
    }
  }, [qrMode])

  const qrImageUrl = qrToken
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrToken)}`
    : null

  const withGuard = async (fn) => {
    setError('')
    if (!agreed) {
      setError(t('agreeRequired'))
      return
    }
    setLoading(true)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const submitEmail = () => withGuard(async () => {
    if (mode === 'signup') {
      // Check the name before creating the account, so a blocked name never leaves someone
      // signed in without a profile. (The database enforces this too.)
      const { data: clean } = await supabase.rpc('username_is_clean', { u: username })
      if (clean === false) throw new Error(t('usernameNotAllowed'))
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) throw signUpError
      if (!data.session) {
        // Email confirmation is on: there's no session yet, so the profile can't be written now.
        // It gets created on first sign-in (App.js -> ensureProfile).
        Alert.alert(t('checkEmailTitle'), t('checkEmailMsg'))
        setMode('login')
        return
      }
      if (data.user) {
        // App.js's SIGNED_IN handler may already have created the row with a fallback name;
        // upsert so the username they chose always wins.
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({ id: data.user.id, username }, { onConflict: 'id' })
        if (profileError) {
          Alert.alert(t('usernameNotSavedTitle'), t('usernameNotSavedMsg', { error: profileError.message }))
        }
        logSignup(data.user.id)
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
    }
  })

  const sendOtp = () => withGuard(async () => {
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone })
    if (otpError) throw otpError
    setOtpSent(true)
  })

  const verifyOtp = () => withGuard(async () => {
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' })
    if (verifyError) throw verifyError
    // Never use the phone number as a username: it would be published on the profile.
    const created = await ensureProfile(data.user, { username: neutralUsername(data.user.id) })
    if (created) logSignup(data.user.id)
  })

  const socialSignIn = (provider) => withGuard(() => signInWithProvider(provider))
  const appleSignIn = () => {
    if (loading) return
    withGuard(() => signInWithApple())
  }

  const signup = mode === 'signup'
  const formW = Math.min(width - 40, 440)

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          {navigation.canGoBack() ? <HeaderButton icon="chevron-back" onPress={() => navigation.goBack()} label={t('backToExplore')} /> : <View />}
        </View>

        {/* Hero: wordmark + headline. Nothing is absolutely positioned, so it can't overlap the form. */}
        <FadeIn style={styles.hero}>
          <View style={styles.brandRow}>
            <Image source={ICON} style={styles.brandIcon} />
            <Text style={styles.brandWord}>iYiYi</Text>
          </View>
          <Text style={styles.headline}>{t('headline')}</Text>
          <Text style={styles.subhead}>{t('subhead')}</Text>
          {totalUsers != null ? (
            <Surface style={styles.counter} radius={999} shadow={false}>
              <Ionicons name="people" size={14} color={colors.accent} />
              <Text style={styles.counterText}>{t('peopleCount', { n: Number(totalUsers).toLocaleString() })}</Text>
            </Surface>
          ) : null}
        </FadeIn>

        <FadeIn index={2} style={{ alignSelf: 'center', width: formW }}>
          <GlassPanel radius={30} strong animateIn={false}>
            <View style={styles.form}>
              {qrMode ? (
                <View style={styles.qrWrap}>
                  <Text style={styles.formTitle}>{t('qrTitle')}</Text>
                  {qrImageUrl && !qrExpired ? (
                    <Image source={{ uri: qrImageUrl }} style={styles.qrImage} />
                  ) : (
                    <Text style={type.body}>{qrExpired ? t('qrExpired') : t('qrLoading')}</Text>
                  )}
                  <Text style={[type.caption, styles.qrHint]}>
                    {t('qrHint')}
                  </Text>
                  {qrExpired && (
                    <TextLink onPress={() => { setQrToken(null); setQrExpired(false); setQrMode(false); setTimeout(() => setQrMode(true), 0) }}>{t('qrNewCode')}</TextLink>
                  )}
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <TextLink onPress={() => setQrMode(false)}>{t('qrUseOther')}</TextLink>
                </View>
              ) : (
                <>
                  <Text style={styles.formTitle}>{signup ? t('createTitle') : t('welcomeBack')}</Text>
                  <Segmented
                    options={[{ key: METHOD.EMAIL, label: t('email') }, { key: METHOD.PHONE, label: t('phone') }]}
                    value={method}
                    onChange={(k) => { setMethod(k); setError('') }}
                    isDark={isDark}
                  />

                  {method === METHOD.EMAIL ? (
                    <>
                      {signup && (
                        <Field icon="at" placeholder={t('username')} autoCapitalize="none" value={username} onChangeText={setUsername} />
                      )}
                      <Field icon="mail" placeholder={t('email')} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" value={email} onChangeText={setEmail} />
                      <Field icon="lock-closed" placeholder={t('password')} secureTextEntry textContentType={signup ? 'newPassword' : 'password'} value={password} onChangeText={setPassword} />
                      <TermsRow agreed={agreed} onToggle={() => { setAgreed((a) => !a); setError('') }} />
                      {error ? <Text style={styles.error}>{error}</Text> : null}
                      <PrimaryButton onPress={submitEmail} loading={loading} label={signup ? t('createAccount') : t('logIn')} />
                      <TextLink onPress={() => { setMode((m) => (m === 'signup' ? 'login' : 'signup')); setError('') }}>
                        {signup ? t('haveAccount') : t('newHere')}
                      </TextLink>
                    </>
                  ) : (
                    <>
                      <Field icon="call" placeholder="+1 555 555 5555" keyboardType="phone-pad" textContentType="telephoneNumber" editable={!otpSent} value={phone} onChangeText={setPhone} />
                      {otpSent && (
                        <Field icon="keypad" placeholder={t('otpPlaceholder')} keyboardType="number-pad" textContentType="oneTimeCode" value={otp} onChangeText={setOtp} />
                      )}
                      <TermsRow agreed={agreed} onToggle={() => { setAgreed((a) => !a); setError('') }} />
                      {error ? <Text style={styles.error}>{error}</Text> : null}
                      <PrimaryButton onPress={otpSent ? verifyOtp : sendOtp} loading={loading} label={otpSent ? t('verifyCode') : t('sendCode')} />
                      {otpSent ? <TextLink onPress={() => { setOtpSent(false); setOtp('') }}>{t('differentNumber')}</TextLink> : null}
                    </>
                  )}

                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>{t('orContinueWith')}</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {appleAvailable && (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                      cornerRadius={26}
                      style={styles.appleButton}
                      onPress={appleSignIn}
                    />
                  )}
                  {SOCIAL_PROVIDERS.map((p) => (
                    <Press key={p.key} onPress={() => socialSignIn(p.key)} disabled={loading} scaleTo={0.97} accessibilityLabel={t('continueWith', { provider: p.label })}>
                      <Surface style={styles.socialButton} radius={26} shadow={false} strong>
                        <SocialIcon platform={p.key} size={18} color={colors.text} />
                        <Text style={styles.socialText}>{t('continueWith', { provider: p.label })}</Text>
                      </Surface>
                    </Press>
                  ))}

                  <TextLink onPress={() => setQrMode(true)} muted>{t('qrSignIn')}</TextLink>
                </>
              )}
            </View>
          </GlassPanel>
        </FadeIn>

        <FadeIn index={4}>
          <Text style={styles.appBrief}>
            {t('appBrief')}
          </Text>
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// iOS-style segmented control with a sliding glass thumb.
function Segmented({ options, value, onChange, isDark }) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value))
  const pos = useRef(new Animated.Value(idx)).current
  const [w, setW] = useState(0)
  useEffect(() => { Animated.spring(pos, { toValue: idx, ...SPRING.snappy }).start() }, [idx, pos])
  const thumbW = w > 0 ? (w - 8) / options.length : 0
  return (
    <View style={[styles.segment, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,60,0.07)' }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {thumbW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentThumb, { width: thumbW, backgroundColor: isDark ? 'rgba(255,255,255,0.16)' : '#ffffff', transform: [{ translateX: pos.interpolate({ inputRange: [0, Math.max(1, options.length - 1)], outputRange: [0, thumbW * Math.max(1, options.length - 1)] }) }] }]}
        />
      ) : null}
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={styles.segmentTab} accessibilityRole="tab" accessibilityState={{ selected: o.key === value }}>
          <Text style={[styles.segmentText, o.key === value && styles.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

// Agreement to the Terms of Use (which spell out zero tolerance for objectionable content and
// abusive users) before registering or logging in, as App Review requires for user content.
function TermsRow({ agreed, onToggle }) {
  const t = useT(strings)
  return (
    <View style={styles.termsRow}>
      <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel={t('termsA11y')}>
        <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
          {agreed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      </Pressable>
      <Text style={styles.termsText}>
        {t('termsPre')}
        <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>{t('termsOfUse')}</Text>
        {t('termsAnd')}
        <Text style={styles.termsLink} onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>{t('privacyPolicy')}</Text>
        {t('termsPost')}
      </Text>
    </View>
  )
}

function Field({ icon, style, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <Surface style={[styles.field, focused && styles.fieldFocused, style]} radius={18} shadow={false}>
      <Ionicons name={`${icon}-outline`} size={18} color={focused ? colors.accent : colors.textFaint} />
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...props}
      />
    </Surface>
  )
}

function PrimaryButton({ onPress, label, loading }) {
  const t = useT(strings)
  return (
    <Press onPress={onPress} disabled={loading} scaleTo={0.97} haptic="light" accessibilityLabel={label}>
      <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
        <Text style={styles.buttonText}>{loading ? t('oneMoment') : label}</Text>
      </LinearGradient>
    </Press>
  )
}

function TextLink({ onPress, children, muted }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]} accessibilityRole="link">
      <Text style={[styles.linkText, muted && { color: colors.textFaint }]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 },
  hero: { alignItems: 'center', paddingTop: 18, paddingBottom: 22, paddingHorizontal: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  brandIcon: { width: 44, height: 44, borderRadius: 12 },
  brandWord: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.text },
  headline: { ...type.largeTitle, textAlign: 'center' },
  subhead: { ...type.subhead, fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 12, maxWidth: 340 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, marginTop: 16 },
  counterText: { ...type.caption, color: colors.text, fontWeight: '600' },
  form: { padding: 18, gap: 12 },
  formTitle: { ...type.title3, textAlign: 'center', marginBottom: 2 },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, position: 'relative' },
  segmentThumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segmentTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 999 },
  segmentText: { ...type.subhead, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.text },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 50 },
  fieldFocused: { borderColor: colors.accent },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text },
  error: { ...type.caption, color: colors.danger, textAlign: 'center' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 2, paddingTop: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  termsText: { ...type.caption, flex: 1, color: colors.textMuted },
  termsLink: { color: colors.accent, fontWeight: '600' },
  button: { paddingVertical: 15, borderRadius: 999, alignItems: 'center', marginTop: 2, shadowColor: '#6b7cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  linkText: { ...type.subhead, color: colors.accent, fontWeight: '600', textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.hairline },
  dividerText: { ...type.caption },
  appleButton: { width: '100%', height: 50 },
  socialButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 50 },
  socialText: { ...type.headline },
  appBrief: { ...type.caption, textAlign: 'center', marginTop: 22, paddingHorizontal: 20, maxWidth: 420, alignSelf: 'center' },
  qrWrap: { alignItems: 'center', gap: 14, paddingVertical: 6 },
  qrImage: { width: 220, height: 220, borderRadius: radii.md, backgroundColor: '#ffffff' },
  qrHint: { textAlign: 'center', maxWidth: 260 },
})
