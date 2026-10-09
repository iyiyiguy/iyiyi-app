import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView, Linking, Image, Dimensions } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GlassPanel from '../components/GlassPanel'
import { HeaderButton } from '../components/BrandHeader'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { API_URL, supabase } from '../lib/supabase'
import { BACKEND_TIER, purchaseSubscription, restorePurchases, isUserCancelled, fetchSubscriptionInfo } from '../lib/iap'
import { logSubscriptionPurchase } from '../lib/attribution'
import { openLink } from '../lib/socialLinks'
import { markPro } from '../lib/useIsPro'
import { translate, useT } from '../i18n'
import strings from '../i18n/strings/subscription'

// iYiYi Pro paywall — two-tier layout.
//   Creator Pro  · $0.99 intro for 2 months → $9.99/mo
//   Business Pro · $9.99 intro for 1 month  → $29/mo
//
// App Review 3.1.2(c): the regular monthly price is largest/most-prominent on-screen and
// repeated on the button. Intro is smaller, underneath, with duration + what follows.
// Prices come from the store, localized; nothing is hard-coded.

const TERMS_URL = 'https://iyiyi.xyz/terms'
const PRIVACY_URL = 'https://iyiyi.xyz/privacy'
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const ICON = require('../../assets/icon.png')

const TIER_LABELS = {
  pro: 'Creator Pro', pro_local: 'Creator Pro', pro_national: 'Creator Pro', pro_all: 'Creator Pro',
  premium: 'Premium', creator: 'Creator', business: 'Business Pro', business_pro: 'Business Pro',
}
const PRICE_USD = { pro: 10, business: 29 }

// ---- Creator Pro benefits ----
const CREATOR_BENEFITS = [
  { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], title: 'Get seen first', text: 'Your profile is shown ahead of free profiles in Nearby and Discover.' },
  { icon: 'globe', colors: ['#4fd1c5', '#7fb3ff'], title: 'Extended discovery', text: 'Reach people beyond your block — local, regional, or international.' },
  { icon: 'star', colors: ['#ffb16b', '#ff7e9d'], title: 'Pro badge', text: 'A ⭐ next to your name everywhere people see you.' },
  { icon: 'game-controller', colors: ['#a78bfa', '#6366f1'], title: 'Premium arcade', text: 'Exclusive gun skins, premium weapons, and bonus loadouts in Laser Tag.' },
  { icon: 'trophy', colors: ['#f59e0b', '#ef4444'], title: 'Priority placement', text: 'Appear higher in search results and recommendation feeds.' },
  { icon: 'heart', colors: ['#ff6fb5', '#ff9fd0'], title: 'Support iYiYi', text: 'Help an independent team keep building new features and games.' },
]

// ---- Business Pro benefits ----
const BUSINESS_BENEFITS = [
  { icon: 'bar-chart', colors: ['#10b981', '#3b82f6'], title: 'Analytics dashboard', text: 'Track impressions, profile taps, and follow-throughs to your socials in real time.' },
  { icon: 'megaphone', colors: ['#f97316', '#ef4444'], title: 'Promoted placement', text: 'Pin your business to the top of the nearby feed within a radius you choose.' },
  { icon: 'gift', colors: ['#8b5cf6', '#ec4899'], title: 'Game sponsorship', text: 'Sponsor nearby arcade games with branded shoutout cards and prizes.' },
  { icon: 'qr-code', colors: ['#06b6d4', '#3b82f6'], title: 'QR code & tap link', text: 'Generate a QR code and tap-to-follow landing page for your storefront or events.' },
  { icon: 'people', colors: ['#6366f1', '#a78bfa'], title: 'Team members', text: 'Add up to 3 staff accounts so your team can manage the business profile together.' },
  { icon: 'mail', colors: ['#14b8a6', '#0ea5e9'], title: 'Weekly digest', text: 'Get a weekly email with your top stats — impressions, new followers, and engagement.' },
  { icon: 'download', colors: ['#64748b', '#475569'], title: 'Export history', text: 'Download your encounter history and analytics as CSV any time.' },
  { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], title: 'Everything in Creator Pro', text: 'Priority placement, Pro badge, premium arcade, extended discovery — all included.' },
]

function friendlyError(e, fallback) {
  if (e?.userFacing && e?.message) return e.message
  let msg = e?.message
  try { if (typeof msg === 'string' && msg.trim().startsWith('{')) msg = JSON.parse(msg).message } catch {}
  if (!msg || /verif|receipt|^[a-z-]+$/i.test(msg)) return fallback
  return msg
}

export default function SubscriptionScreen({ navigation, onClose }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  const onboarding = typeof onClose === 'function'
  const [selectedTier, setSelectedTier] = useState('pro') // 'pro' | 'business'
  const [purchasing, setPurchasing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState('')
  const [proInfo, setProInfo] = useState(null)
  const [bizInfo, setBizInfo] = useState(null)
  const [infoFailed, setInfoFailed] = useState(false)

  const authedFetch = async (path, options = {}) => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session?.access_token) throw new Error(translate(strings, 'err_sign_in'))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30000)
    try {
      return await fetch(`${API_URL}${path}`, {
        ...options,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('The server is taking too long. If you were charged, tap Restore Purchases.')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  const loadCurrent = useCallback(async () => {
    const res = await authedFetch('/api/subscription/me')
    if (!res.ok) throw new Error(translate(strings, 'err_load'))
    const json = await res.json()
    setCurrent(json)
    return json
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    loadCurrent()
      .then((c) => { if (!cancelled && onboarding && c?.status === 'active') onClose() })
      .catch(() => {})
    // Fetch pricing for both tiers in parallel.
    fetchSubscriptionInfo('pro')
      .then((i) => { if (!cancelled) { setProInfo(i); if (!i) setInfoFailed(true) } })
      .catch(() => { if (!cancelled) setInfoFailed(true) })
    fetchSubscriptionInfo('business')
      .then((i) => { if (!cancelled) setBizInfo(i) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [loadCurrent]) // eslint-disable-line react-hooks/exhaustive-deps

  const verifyWithBackend = async (payload) => {
    const body = { ...payload, tier: BACKEND_TIER[payload.tier] ?? payload.tier }
    const res = await authedFetch('/api/subscription/activate', { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      console.warn('subscription/activate failed', res.status, detail)
      const reason = String(detail?.error || detail?.message || `HTTP ${res.status}`)
      if (/no active subscription|not active/i.test(reason)) {
        const err = new Error(translate(strings, 'err_expired'))
        err.code = 'expired'
        err.userFacing = true
        throw err
      }
      const err = new Error(`${translate(strings, 'err_verify')} (${reason.replace(/^Receipt verification failed:\s*/i, '').slice(0, 80)})`)
      err.userFacing = true
      throw err
    }
    await loadCurrent()
    logSubscriptionPurchase(payload.tier, PRICE_USD[payload.tier] ?? 0)
  }

  const purchase = async () => {
    setError('')
    setPurchasing(true)
    try {
      await purchaseSubscription(selectedTier, verifyWithBackend)
      markPro()
      if (onboarding) onClose()
      else Alert.alert(
        selectedTier === 'business' ? 'Welcome to Business Pro' : t('welcome_title'),
        selectedTier === 'business' ? 'Your business tools are now active.' : t('welcome_msg'),
      )
    } catch (e) {
      if (!isUserCancelled(e)) setError(friendlyError(e, t('err_verify')))
    } finally {
      setPurchasing(false)
    }
  }

  const cancel = async () => {
    if (Platform.OS === 'ios') {
      Linking.openURL(APPLE_SUBSCRIPTIONS_URL).catch(() =>
        Alert.alert(t('manage_title'), t('manage_msg')))
      return
    }
    setCancelling(true)
    try {
      const res = await authedFetch('/api/subscription/cancel', { method: 'POST' })
      if (!res.ok) throw new Error(t('err_cancel'))
      await loadCurrent()
      Alert.alert(
        t('cancelled_title'),
        current?.renews_at
          ? t('cancelled_msg_date', { date: new Date(current.renews_at).toLocaleDateString() })
          : t('cancelled_msg_period'),
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
        restored.length ? t('restored_title') : t('nothing_title'),
        restored.length ? t('restored_msg', { items: restored.join(', ') }) : t('nothing_msg'),
      )
      if (restored.length && onboarding) onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  const active = current?.status === 'active'
  const info = selectedTier === 'business' ? bizInfo : proInfo
  const period = info ? (t(`period_${info.period}`) === `period_${info.period}` ? info.period : t(`period_${info.period}`)) : null
  const billed = info ? `${info.displayPrice}/${period}` : null
  const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play'
  const account = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'
  const goBack = !onboarding && navigation?.canGoBack?.() ? () => navigation.goBack() : null
  const busy = purchasing || restoring
  const benefits = selectedTier === 'business' ? BUSINESS_BENEFITS : CREATOR_BENEFITS
  const tierLabel = selectedTier === 'business' ? 'Business Pro' : 'Creator Pro'

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          {goBack ? <HeaderButton icon="chevron-back" onPress={goBack} label={t('back')} /> : <View style={{ width: 42 }} />}
          {onboarding ? <HeaderButton icon="close" onPress={onClose} label={t('close')} /> : null}
        </View>

        {/* ---- hero ---- */}
        <FadeIn style={styles.hero}>
          <View style={styles.iconWrap}>
            <Image source={ICON} style={styles.icon} />
            <LinearGradient colors={['#ffd36b', '#e8b04b']} style={styles.proPill}>
              <Text style={styles.proPillText}>PRO</Text>
            </LinearGradient>
          </View>
          <Text style={styles.title}>{active ? t('title_active') : 'Choose your plan'}</Text>
          <Text style={styles.subtitle}>
            {active
              ? `${t('thanks')} ${current?.renews_at ? t('renews_on', { date: new Date(current.renews_at).toLocaleDateString() }) : ''}`
              : 'Level up your profile or grow your business on iYiYi.'}
          </Text>
        </FadeIn>

        {/* ---- tier toggle ---- */}
        {!active && (
          <FadeIn index={1} style={{ marginTop: 18 }}>
            <View style={styles.tierToggle}>
              <Press
                onPress={() => setSelectedTier('pro')}
                style={[styles.tierTab, selectedTier === 'pro' && styles.tierTabActive]}
                haptic="selection"
              >
                <Text style={[styles.tierTabText, selectedTier === 'pro' && styles.tierTabTextActive]}>Creator Pro</Text>
              </Press>
              <Press
                onPress={() => setSelectedTier('business')}
                style={[styles.tierTab, selectedTier === 'business' && styles.tierTabActive]}
                haptic="selection"
              >
                <Text style={[styles.tierTabText, selectedTier === 'business' && styles.tierTabTextActive]}>Business Pro</Text>
                <View style={styles.popularBadge}><Text style={styles.popularText}>BEST</Text></View>
              </Press>
            </View>
          </FadeIn>
        )}

        {/* ---- benefits ---- */}
        <View style={{ gap: 10, marginTop: 18 }}>
          {benefits.map((b, i) => (
            <FadeIn key={`${selectedTier}-${b.title}`} index={i + 2}>
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
        <FadeIn index={benefits.length + 3} style={{ marginTop: 22 }}>
          {active ? (
            <GlassPanel radius={radii.lg} strong animateIn={false}>
              <View style={styles.planInner}>
                <Text style={type.headline}>{t('your_plan', { tier: TIER_LABELS[current.tier] ?? current.tier })}</Text>
                <Text style={[type.caption, { marginTop: 4 }]}>
                  {current.renews_at ? t('renews_on', { date: new Date(current.renews_at).toLocaleDateString() }) : t('renews_auto')}
                </Text>
                <Press onPress={cancel} disabled={cancelling} style={styles.secondaryBtn} accessibilityLabel={t('manage_a11y')}>
                  {cancelling ? <ActivityIndicator color={colors.danger} /> : (
                    <Text style={styles.manageText}>{Platform.OS === 'ios' ? t('manage_cancel') : t('cancel_sub')}</Text>
                  )}
                </Press>
              </View>
            </GlassPanel>
          ) : (
            <GlassPanel radius={radii.lg} strong animateIn={false}>
              <View style={styles.planInner}>
                <View style={styles.planHeader}>
                  <Text style={type.headline}>
                    {selectedTier === 'business' ? '💼 Business Pro · Monthly' : '⭐ Creator Pro · Monthly'}
                  </Text>
                  <Ionicons name="checkmark-circle" size={22} color={selectedTier === 'business' ? '#10b981' : colors.magenta} />
                </View>
                {info ? (
                  <>
                    <Text style={styles.price} accessibilityLabel={t('price_a11y', { price: info.displayPrice, period })}>
                      {info.displayPrice}
                      <Text style={styles.pricePer}> / {period}</Text>
                    </Text>
                    <Text style={styles.billedLine}>{t('billed_line', { price: info.displayPrice, period })}</Text>
                    {info.introText ? (
                      <Text style={styles.introLine}>
                        {t('intro_line', { intro: info.introText, price: info.displayPrice, period })}
                      </Text>
                    ) : null}
                  </>
                ) : infoFailed ? (
                  <Text style={[type.caption, { marginTop: 8 }]}>
                    {t('pricing_failed', { store })}
                  </Text>
                ) : (
                  <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 18 }} />
                )}
              </View>
            </GlassPanel>
          )}

          {!active ? (
            <Press onPress={purchase} disabled={busy || !info} scaleTo={0.97} haptic="light" accessibilityLabel={billed ? t('subscribe_a11y', { billed }) : t('subscribe')} style={{ marginTop: 16 }}>
              <LinearGradient
                colors={selectedTier === 'business' ? ['#10b981', '#059669'] : ['#6b7cff', '#8f5bff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.cta, (busy || !info) && { opacity: 0.6 }]}
              >
                {purchasing ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.ctaText}>
                    {billed ? `Subscribe to ${tierLabel} · ${billed}` : `Subscribe to ${tierLabel}`}
                  </Text>
                )}
              </LinearGradient>
            </Press>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.linksRow}>
            <Press onPress={restore} disabled={busy} accessibilityLabel={t('restore_a11y')} haptic="selection">
              {restoring ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.linkStrong}>{t('restore')}</Text>}
            </Press>
            {onboarding && !active ? (
              <Press onPress={onClose} accessibilityLabel={t('not_now')} haptic="selection">
                <Text style={styles.linkStrong}>{t('not_now')}</Text>
              </Press>
            ) : null}
          </View>

          <Text style={styles.disclosure}>
            {info
              ? (info.introText
                ? t('disclosure_lead_price_intro', { billed, intro: info.introText })
                : t('disclosure_lead_price', { billed }))
              : t('disclosure_lead')}
            {t('disclosure_body', { account, store })}
            {t('disclosure_see')}
            <Text style={styles.link} onPress={() => openLink(TERMS_URL)}>{t('link_terms')}</Text>
            {t('disclosure_and')}
            <Text style={styles.link} onPress={() => openLink(PRIVACY_URL)}>{t('link_privacy')}</Text>
            {t('disclosure_end')}
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
  // ---- tier toggle ----
  tierToggle: { flexDirection: 'row', backgroundColor: colors.inkSurface, borderRadius: radii.pill, padding: 4, gap: 4, borderWidth: 1, borderColor: colors.hairline },
  tierTab: { flex: 1, paddingVertical: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tierTabActive: { backgroundColor: colors.magenta },
  tierTabText: { fontWeight: '700', fontSize: 14, color: colors.textMuted },
  tierTabTextActive: { color: '#fff' },
  popularBadge: { backgroundColor: '#f59e0b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  popularText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  // ---- benefits ----
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  benefitIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // ---- plan card ----
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
