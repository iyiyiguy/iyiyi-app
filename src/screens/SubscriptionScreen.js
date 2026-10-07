import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView, Linking, Image } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GlassPanel from '../components/GlassPanel'
import { HeaderButton } from '../components/BrandHeader'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { API_URL, supabase } from '../lib/supabase'
import { purchaseSubscription, restorePurchases, isUserCancelled, fetchSubscriptionInfo } from '../lib/iap'
import { logSubscriptionPurchase } from '../lib/attribution'
import { openLink } from '../lib/socialLinks'

// iYiYi Pro paywall. Used two ways:
//  - as a screen (Settings → iYiYi Pro, the Pro button), with a back button;
//  - once during onboarding (`onClose` set), with a close button and "Not now".
//
// App Review 3.1.2(c): the amount that will be billed (the regular monthly price) is the largest,
// most prominent price on the screen and is repeated on the button. The introductory offer is
// shown smaller, underneath, and always says how long it lasts and what is charged afterwards.
// Prices come from the store, localized; nothing is hard-coded.

const TERMS_URL = 'https://iyiyi.xyz/terms'
const PRIVACY_URL = 'https://shop.iyiyi.xyz/policies/privacy-policy'
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const ICON = require('../../assets/icon.png')

const TIER_LABELS = { pro: 'Pro', pro_local: 'Pro', pro_national: 'Pro', pro_all: 'Pro', premium: 'Premium', creator: 'Creator' }
const PRICE_USD = { pro: 10 }

const BENEFITS = [
  { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], title: 'Get seen first', text: 'Your profile is shown ahead of free profiles in Nearby and Discover.' },
  { icon: 'globe', colors: ['#4fd1c5', '#7fb3ff'], title: 'Reach beyond your block', text: 'We match your reach to your profile, from local all the way to international.' },
  { icon: 'star', colors: ['#ffb16b', '#ff7e9d'], title: 'Pro badge', text: 'A ⭐ next to your name everywhere people see you.' },
  { icon: 'heart', colors: ['#ff6fb5', '#ff9fd0'], title: 'Support iYiYi', text: 'Help an independent team keep building new features and games.' },
]

export default function SubscriptionScreen({ navigation, onClose }) {
  const insets = useSafeAreaInsets()
  const onboarding = typeof onClose === 'function'
  const [purchasing, setPurchasing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null) // localized store pricing; null until loaded / unavailable
  const [infoFailed, setInfoFailed] = useState(false)

  const authedFetch = async (path, options = {}) => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error('Please sign in again')
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
    })
  }

  const loadCurrent = useCallback(async () => {
    const res = await authedFetch('/api/subscription/me')
    if (!res.ok) throw new Error('Could not load your subscription')
    const json = await res.json()
    setCurrent(json)
    return json
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    loadCurrent()
      .then((c) => { if (!cancelled && onboarding && c?.status === 'active') onClose() }) // already Pro: skip
      .catch(() => {})
    fetchSubscriptionInfo('pro')
      .then((i) => { if (!cancelled) { setInfo(i); if (!i) setInfoFailed(true) } })
      .catch(() => { if (!cancelled) setInfoFailed(true) })
    return () => { cancelled = true }
  }, [loadCurrent]) // eslint-disable-line react-hooks/exhaustive-deps

  const verifyWithBackend = async (payload) => {
    const res = await authedFetch('/api/subscription/activate', { method: 'POST', body: JSON.stringify(payload) })
    if (!res.ok) throw new Error('Purchase could not be verified')
    await loadCurrent()
    logSubscriptionPurchase(payload.tier, PRICE_USD[payload.tier] ?? 0)
  }

  const purchase = async () => {
    setError('')
    setPurchasing(true)
    try {
      await purchaseSubscription('pro', verifyWithBackend)
      if (onboarding) onClose()
      else Alert.alert('Welcome to iYiYi Pro', 'Your profile now gets seen first.')
    } catch (e) {
      if (!isUserCancelled(e)) setError(e.message)
    } finally {
      setPurchasing(false)
    }
  }

  const cancel = async () => {
    // Apple subscriptions can only be cancelled by the user in their Apple ID settings.
    if (Platform.OS === 'ios') {
      Linking.openURL(APPLE_SUBSCRIPTIONS_URL).catch(() =>
        Alert.alert('Manage subscription', 'Open Settings → your name → Subscriptions to cancel.'))
      return
    }
    setCancelling(true)
    try {
      const res = await authedFetch('/api/subscription/cancel', { method: 'POST' })
      if (!res.ok) throw new Error('Could not cancel your subscription. Please try again.')
      await loadCurrent()
      Alert.alert(
        'Subscription cancelled',
        `You'll keep your perks until ${current?.renews_at ? new Date(current.renews_at).toLocaleDateString() : 'the end of your billing period'}. Don't forget to also cancel it in your Google Play account to stop future charges.`
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setCancelling(false)
    }
  }

  const restore = async () => {
    setError('')
    setRestoring(true)
    try {
      const restored = await restorePurchases(verifyWithBackend)
      Alert.alert(
        restored.length ? 'Purchases restored' : 'Nothing to restore',
        restored.length ? `Restored: ${restored.join(', ')}` : "We couldn't find any previous purchases for this account."
      )
      if (restored.length && onboarding) onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  const active = current?.status === 'active'
  const busy = purchasing || restoring
  const billed = info ? `${info.displayPrice}/${info.period}` : null
  const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play'
  const account = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'
  const goBack = !onboarding && navigation?.canGoBack?.() ? () => navigation.goBack() : null

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          {goBack ? <HeaderButton icon="chevron-back" onPress={goBack} label="Back" /> : <View style={{ width: 42 }} />}
          {onboarding ? <HeaderButton icon="close" onPress={onClose} label="Close" /> : null}
        </View>

        {/* ---- hero ---- */}
        <FadeIn style={styles.hero}>
          <View style={styles.iconWrap}>
            <Image source={ICON} style={styles.icon} />
            <LinearGradient colors={['#ffd36b', '#e8b04b']} style={styles.proPill}>
              <Text style={styles.proPillText}>PRO</Text>
            </LinearGradient>
          </View>
          <Text style={styles.title}>{active ? "You're on iYiYi Pro" : 'Get seen by more people'}</Text>
          <Text style={styles.subtitle}>
            {active
              ? `Thanks for supporting iYiYi. ${current?.renews_at ? `Renews ${new Date(current.renews_at).toLocaleDateString()}.` : ''}`
              : 'iYiYi Pro puts your profile in front of more people nearby and beyond.'}
          </Text>
        </FadeIn>

        {/* ---- benefits ---- */}
        <View style={{ gap: 10, marginTop: 22 }}>
          {BENEFITS.map((b, i) => (
            <FadeIn key={b.title} index={i + 1}>
              <GlassPanel radius={radii.lg} lite animateIn={false}>
                <View style={styles.benefit}>
                  <LinearGradient colors={b.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.benefitIcon}>
                    <Ionicons name={b.icon} size={19} color="#fff" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={type.headline}>{b.title}</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>{b.text}</Text>
                  </View>
                </View>
              </GlassPanel>
            </FadeIn>
          ))}
        </View>

        {/* ---- plan + purchase ---- */}
        <FadeIn index={6} style={{ marginTop: 22 }}>
          {active ? (
            <GlassPanel radius={radii.lg} strong animateIn={false}>
              <View style={styles.planInner}>
                <Text style={type.headline}>Your plan: {TIER_LABELS[current.tier] ?? current.tier}</Text>
                <Text style={[type.caption, { marginTop: 4 }]}>
                  Renews {current.renews_at ? new Date(current.renews_at).toLocaleDateString() : 'automatically'}.
                </Text>
                <Press onPress={cancel} disabled={cancelling} style={styles.secondaryBtn} accessibilityLabel="Manage subscription">
                  {cancelling ? <ActivityIndicator color={colors.danger} /> : (
                    <Text style={styles.manageText}>{Platform.OS === 'ios' ? 'Manage / Cancel Subscription' : 'Cancel Subscription'}</Text>
                  )}
                </Press>
              </View>
            </GlassPanel>
          ) : (
            <GlassPanel radius={radii.lg} strong animateIn={false}>
              <View style={styles.planInner}>
                <View style={styles.planHeader}>
                  <Text style={type.headline}>iYiYi Pro · Monthly</Text>
                  <Ionicons name="checkmark-circle" size={22} color={colors.magenta} />
                </View>
                {info ? (
                  <>
                    {/* The billed amount: biggest price on the screen. */}
                    <Text style={styles.price} accessibilityLabel={`${info.displayPrice} per ${info.period}`}>
                      {info.displayPrice}
                      <Text style={styles.pricePer}> / {info.period}</Text>
                    </Text>
                    <Text style={styles.billedLine}>Billed {info.displayPrice} every {info.period}. Renews automatically. Cancel anytime.</Text>
                    {info.introText ? (
                      <Text style={styles.introLine}>
                        Introductory offer for new subscribers: {info.introText}, then {info.displayPrice}/{info.period}.
                      </Text>
                    ) : null}
                  </>
                ) : infoFailed ? (
                  <Text style={[type.caption, { marginTop: 8 }]}>
                    Pricing couldn't load right now. Check your connection, then come back. The price for your region is always shown by the {store} before you confirm.
                  </Text>
                ) : (
                  <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 18 }} />
                )}
              </View>
            </GlassPanel>
          )}

          {!active ? (
            <Press onPress={purchase} disabled={busy || !info} scaleTo={0.97} haptic="light" accessibilityLabel={billed ? `Subscribe for ${billed}` : 'Subscribe'} style={{ marginTop: 16 }}>
              <LinearGradient
                colors={['#6b7cff', '#8f5bff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.cta, (busy || !info) && { opacity: 0.6 }]}
              >
                {purchasing ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.ctaText}>{billed ? `Subscribe · ${billed}` : 'Subscribe'}</Text>
                )}
              </LinearGradient>
            </Press>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.linksRow}>
            <Press onPress={restore} disabled={busy} accessibilityLabel="Restore purchases" haptic="selection">
              {restoring ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.linkStrong}>Restore Purchases</Text>}
            </Press>
            {onboarding && !active ? (
              <Press onPress={onClose} accessibilityLabel="Not now" haptic="selection">
                <Text style={styles.linkStrong}>Not now</Text>
              </Press>
            ) : null}
          </View>

          <Text style={styles.disclosure}>
            {info
              ? `iYiYi Pro is an auto-renewing monthly subscription at ${billed}${info.introText ? ` after the introductory offer (${info.introText})` : ''}. `
              : 'iYiYi Pro is an auto-renewing monthly subscription. '}
            Payment is charged to your {account} account when you confirm the purchase. The subscription renews
            automatically unless it is cancelled at least 24 hours before the end of the current period, and your
            account is charged for renewal within 24 hours before the end of the current period. You can manage or
            cancel it any time in your {store} account settings. See our{' '}
            <Text style={styles.link} onPress={() => openLink(TERMS_URL)}>Terms of Use (EULA)</Text>
            {' '}and{' '}
            <Text style={styles.link} onPress={() => openLink(PRIVACY_URL)}>Privacy Policy</Text>.
          </Text>
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 560, width: '100%', alignSelf: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  hero: { alignItems: 'center', marginTop: 4 },
  iconWrap: { marginBottom: 16 },
  icon: { width: 84, height: 84, borderRadius: 22 },
  proPill: { position: 'absolute', right: -14, bottom: -6, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  proPillText: { color: colors.onGold, fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
  title: { ...type.display, textAlign: 'center' },
  subtitle: { ...type.subhead, textAlign: 'center', marginTop: 8, maxWidth: 380 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  benefitIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  planInner: { padding: 18 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { color: colors.text, fontWeight: '800', fontSize: 38, letterSpacing: -1, marginTop: 10 },
  pricePer: { fontSize: 18, fontWeight: '600', color: colors.text, letterSpacing: 0 },
  billedLine: { ...type.subhead, color: colors.text, marginTop: 4 },
  introLine: { ...type.caption, marginTop: 10 },
  cta: { paddingVertical: 17, borderRadius: 999, alignItems: 'center', shadowColor: '#6b7cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  secondaryBtn: { marginTop: 14, paddingVertical: 6 },
  manageText: { color: colors.danger, fontWeight: '600' },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  linksRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 16, marginBottom: 6 },
  linkStrong: { ...type.subhead, fontWeight: '600', color: colors.textMuted, paddingVertical: 6 },
  disclosure: { ...type.caption, marginTop: 12, lineHeight: 18, color: colors.textFaint },
  link: { color: colors.magenta },
})
