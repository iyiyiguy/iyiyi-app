import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Image, ScrollView, Alert, Platform, KeyboardAvoidingView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type, usePageInk } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import * as AppleAuthentication from 'expo-apple-authentication'
import { ensureProfile, neutralUsername, signInWithApple, signInWithProvider } from '../lib/oauth'
import SocialIcon from '../components/SocialIcon'
import { logSignup } from '../lib/attribution'
import GlassPanel from '../components/GlassPanel'

const METHOD = { EMAIL: 'email', PHONE: 'phone' }

const STROKE_OFFSETS = [
  [-2, -2], [0, -2], [2, -2],
  [-2, 0], [2, 0],
  [-2, 2], [0, 2], [2, 2],
]

const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
]

export default function AuthScreen({ navigation, route }) {
  const pageInk = usePageInk()
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
  const [showcase, setShowcase] = useState([])
  const pollRef = useRef(null)
  const [appleAvailable, setAppleAvailable] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false))
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/public/total-users`).then((r) => r.json()).then((d) => setTotalUsers(d.total_users)).catch(() => {})
    fetch(`${API_URL}/api/public/showcase`).then((r) => r.json()).then((d) => setShowcase(d.profiles ?? [])).catch(() => {})
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
        if (!res.ok) throw new Error('Could not create a sign-in code. Please try again.')
        const data = await res.json()
        if (cancelled) return
        const token = data.token
        if (!token) throw new Error('Could not create a sign-in code. Please try again.')
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
        if (!cancelled) setError(e?.message ?? 'Could not create a sign-in code.')
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
      if (clean === false) throw new Error('That username is not allowed. Please choose another.')
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) throw signUpError
      if (!data.session) {
        // Email confirmation is on: there's no session yet, so the profile can't be written now.
        // It gets created on first sign-in (App.js -> ensureProfile).
        Alert.alert('Check your email', 'We sent you a link to confirm your account. Open it, then log in here.')
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
          Alert.alert('Username not saved', `${profileError.message}\n\nYou can change your username from My Profile.`)
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

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        {/* Clean glass hero: soft gradient + light orbs (no photo collage). */}
        <LinearGradient
          colors={['#1b1440', '#10122a', pageInk.ink]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View pointerEvents="none" style={[styles.heroOrb, { backgroundColor: 'rgba(232,62,140,0.28)', top: -60, left: -70 }]} />
        <View pointerEvents="none" style={[styles.heroOrb, { backgroundColor: 'rgba(120,140,255,0.24)', top: 40, right: -90 }]} />
        {navigation.canGoBack() ? (
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back to explore">
            <Text style={styles.backText}>‹ Explore</Text>
          </Pressable>
        ) : null}

        <View style={styles.topBrandWrap}>
          <View style={styles.strokeAnchor}>
            {STROKE_OFFSETS.map(([dx, dy], i) => (
              <Text
                key={i}
                style={[styles.topLogoText, styles.topLogoStroke, { transform: [{ translateX: dx }, { translateY: dy }] }]}
                pointerEvents="none"
              >
                iYiYi
              </Text>
            ))}
            <Text style={styles.topLogoText}>iYiYi</Text>
          </View>
        </View>

        <View style={styles.heroTextWrap}>
          <Text style={styles.heroHeadline}>Grow your profile.{'\n'}Become a local celebrity.</Text>
          {totalUsers != null && (
            <Text style={styles.heroCounter}>{totalUsers.toLocaleString()} people already on iYiYi</Text>
          )}
        </View>
      </View>

      <View style={styles.overlapWrap}>
        <LinearGradient colors={['transparent', pageInk.inkFade, pageInk.ink]} style={styles.heroFade} />


      <View style={styles.formWrap}>
      <Text style={styles.tagline}>See who's within 150ft.</Text>

      {qrMode ? (
        <View style={styles.qrWrap}>
          {qrImageUrl && !qrExpired ? (
            <Image source={{ uri: qrImageUrl }} style={styles.qrImage} />
          ) : (
            <Text style={type.body}>{qrExpired ? 'This code expired.' : 'Loading code…'}</Text>
          )}
          <Text style={[type.caption, styles.qrHint]}>
            Open iYiYi on your phone, go to Settings → "Sign in on another device", and scan this code.
          </Text>
          {qrExpired && (
            <Pressable onPress={() => { setQrToken(null); setQrExpired(false); setQrMode(false); setTimeout(() => setQrMode(true), 0) }}>
              <Text style={styles.switchText}>Get a new code</Text>
            </Pressable>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => setQrMode(false)}>
            <Text style={styles.switchText}>Use email or phone instead</Text>
          </Pressable>
        </View>
      ) : (
        <>
      <GlassPanel radius={radii.pill} style={styles.methodSwitch}>
        <View style={{ flexDirection: 'row' }}>
          <MethodTab label="Email" active={method === METHOD.EMAIL} onPress={() => setMethod(METHOD.EMAIL)} />
          <MethodTab label="Phone" active={method === METHOD.PHONE} onPress={() => setMethod(METHOD.PHONE)} />
        </View>
      </GlassPanel>

      {method === METHOD.EMAIL ? (
        <>
          {mode === 'signup' && (
            <GlassPanel radius={radii.md} style={styles.inputWrap}>
              <TextInput
                placeholder="Username" placeholderTextColor={colors.textFaint}
                value={username} onChangeText={setUsername} style={styles.input}
              />
            </GlassPanel>
          )}
          <GlassPanel radius={radii.md} style={styles.inputWrap}>
            <TextInput
              placeholder="Email" placeholderTextColor={colors.textFaint}
              autoCapitalize="none" keyboardType="email-address"
              value={email} onChangeText={setEmail} style={styles.input}
            />
          </GlassPanel>
          <GlassPanel radius={radii.md} style={styles.inputWrap}>
            <TextInput
              placeholder="Password" placeholderTextColor={colors.textFaint}
              secureTextEntry value={password} onChangeText={setPassword} style={styles.input}
            />
          </GlassPanel>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={submitEmail} disabled={loading}>
            <LinearGradient colors={gradients.brand} style={styles.button}>
              <Text style={styles.buttonText}>{loading ? '…' : mode === 'signup' ? 'Create Account' : 'Log In'}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => setMode(m => (m === 'signup' ? 'login' : 'signup'))}>
            <Text style={styles.switchText}>
              {mode === 'signup' ? 'Already have an account? Log in' : "New here? Create an account"}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <GlassPanel radius={radii.md} style={styles.inputWrap}>
            <TextInput
              placeholder="+1 555 555 5555" placeholderTextColor={colors.textFaint}
              keyboardType="phone-pad" editable={!otpSent}
              value={phone} onChangeText={setPhone} style={styles.input}
            />
          </GlassPanel>
          {otpSent && (
            <GlassPanel radius={radii.md} style={styles.inputWrap}>
              <TextInput
                placeholder="6-digit code" placeholderTextColor={colors.textFaint}
                keyboardType="number-pad" value={otp} onChangeText={setOtp} style={styles.input}
              />
            </GlassPanel>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={otpSent ? verifyOtp : sendOtp} disabled={loading}>
            <LinearGradient colors={gradients.brand} style={styles.button}>
              <Text style={styles.buttonText}>{loading ? '…' : otpSent ? 'Verify Code' : 'Send Code'}</Text>
            </LinearGradient>
          </Pressable>
        </>
      )}

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.dividerLine} />
      </View>

      {appleAvailable && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
          cornerRadius={24}
          style={styles.appleButton}
          onPress={appleSignIn}
        />
      )}

      <View style={styles.socialRow}>
        {SOCIAL_PROVIDERS.map((p) => (
          <Pressable key={p.key} onPress={() => socialSignIn(p.key)} disabled={loading}>
            <GlassPanel radius={26}>
              <View style={styles.socialButton}>
                <SocialIcon platform={p.key} size={20} color={colors.text} />
              </View>
            </GlassPanel>
          </Pressable>
        ))}
      </View>

      <Text style={styles.appBrief}>
        iYiYi is a digital ID — it shows people within 150ft who you are and how to connect, no more awkward "what's your @".
      </Text>

      <Pressable onPress={() => setQrMode(true)}>
        <Text style={styles.switchText}>Sign in with QR code</Text>
      </Pressable>
        </>
      )}
      </View>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  )
}

function MethodTab({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  hero: Platform.select({
    web: { width: '100%', height: 340, position: 'relative', overflow: 'hidden' },
    default: { width: '100%', height: 380, position: 'relative', overflow: 'hidden' },
  }),
  heroOrb: { position: 'absolute', width: 300, height: 300, borderRadius: 150, ...(Platform.OS === 'web' ? { filter: 'blur(60px)' } : {}) },
  backBtn: {
    position: 'absolute', top: Platform.OS === 'web' ? 18 : 58, left: 16, zIndex: 5, paddingHorizontal: 14, height: 34, borderRadius: 17,
    justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  backText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  overlapWrap: Platform.select({ web: { marginTop: -40 }, default: { marginTop: -60 } }),
  heroFade: { position: 'absolute', left: 0, right: 0, top: 0, height: 420 },
  heroTextWrap: { position: 'absolute', top: '46%', left: 0, right: 0, paddingHorizontal: 24 },
  heroHeadline: {
    ...type.display, color: colors.onBrand, fontSize: 32, lineHeight: 38, fontWeight: '800', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  heroCounter: {
    ...type.caption, fontSize: 17, textAlign: 'center', marginTop: 10, color: colors.gold, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },
  wall: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  wallItem: { alignItems: 'center', width: 68 },
  wallAvatar: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.magenta,
    backgroundColor: colors.inkSurface,
  },
  wallName: { ...type.caption, marginTop: 6, textAlign: 'center' },
  formWrap: { padding: 24, backgroundColor: 'transparent' },
  topBrandWrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  strokeAnchor: { position: 'relative', alignItems: 'center' },
  topLogoText: {
    fontSize: 72, fontWeight: '800', color: colors.magenta, letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  topLogoStroke: {
    position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center',
    color: colors.onBrand, textShadowColor: 'transparent', textShadowRadius: 0,
  },
  appBrief: {
    ...type.caption, textAlign: 'center', color: colors.textMuted, marginTop: 18,
    paddingHorizontal: 12, lineHeight: 18,
  },
  tagline: { ...type.caption, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center', marginBottom: 24 },
  methodSwitch: { padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center' },
  tabActive: { backgroundColor: colors.magenta },
  tabText: { color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.onBrand },
  inputWrap: { marginBottom: 12 },
  input: { padding: 14, color: colors.text },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  button: { paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center', marginTop: 8 },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 16 },
  switchText: { color: colors.textMuted, textAlign: 'center', marginTop: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { color: colors.textFaint, fontSize: 12 },
  appleButton: { width: '100%', height: 48, marginBottom: 14 },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  socialButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  qrWrap: { alignItems: 'center', gap: 16, paddingVertical: 12 },
  qrImage: { width: 220, height: 220, borderRadius: radii.md, backgroundColor: '#ffffff' },
  qrHint: { textAlign: 'center', maxWidth: 260 },
})
