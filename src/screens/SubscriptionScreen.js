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
import { markPro } from '../lib/useIsPro'
import { translate, useT } from '../i18n'
import strings from '../i18n/strings/subscription'

// iYiYi Pro paywall. Used two ways:
//  - as a screen (Settings → iYiYi Pro, the Pro button), with a back button;
//  - once during onboarding (`onClose` set), with a close button and "Not now".
//
// App Review 3.1.2(c): the amount that will be billed (the regular monthly price) is the largest,
// most prominent price on the screen and is repeated on the button. The introductory offer is
// shown smaller, underneath, and always says how long it lasts and what is charged afterwards.
// Prices come from the store, localized; nothing is hard-coded.

const TERMS_URL = 'https://iyiyi.xyz/terms'
const PRIVACY_URL = 'https://iyiyi.xyz/privacy'
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const ICON = require('../../assets/icon.png')

const TIER_LABELS = { pro: 'Pro', pro_local: 'Pro', pro_national: 'Pro', pro_all: 'Pro', premium: 'Premium', creator: 'Creator' }
const PRICE_USD = { pro: 10 }

// title/text are keys into strings/subscription.js, translated at render.
const BENEFITS = [
  { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], title: 'benefit_seen_title', text: 'benefit_seen_text' },
  { icon: 'globe', colors: ['#4fd1c5', '#7fb3ff'], title: 'benefit_reach_title', text: 'benefit_reach_text' },
  { icon: 'star', colors: ['#ffb16b', '#ff7e9d'], title: 'benefit_badge_title', text: 'benefit_badge_text' },
  { icon: 'heart', colors: ['#ff6fb5', '#ff9fd0'], title: 'benefit_support_title', text: 'benefit_support_text' },
]

export default function SubscriptionScreen({ navigation, onClose }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
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
    if (!session?.access_token) throw new Error(translate(strings, 'err_sign_in'))
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
    })
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
      .then((c) => { if (!cancelled && onboarding && c?.status === 'active') onClose() }) // already Pro: skip
      .catch(() => {})
    fetchSubscriptionInfo('pro')
      .then((i) => { if (!cancelled) { setInfo(i); if (!i) setInfoFailed(true) } })
      .catch(() => { if (!cancelled) setInfoFailed(true) })
    return () => { cancelled = true }
  }, [loadCurrent]) // eslint-disable-line react-hooks/exhaustive-deps

  const verifyWithBackend = async (payload) => {
    const res = await authedFetch('/api/subscription/activate', { method: 'POST', body: JSON.stringify(payload) })
    if (!res.ok) throw new Error(translate(strings, 'err_verify'))
    await loadCurrent()
    logSubscriptionPurchase(payload.tier, PRICE_USD[payload.tier] ?? 0)
  }

  const purchase = async () => {
    setError('')
    setPurchasing(true)
    try {
      await purchaseSubscription('pro', verifyWithBackend)
      markPro()
      if (onboarding) onClose()
      else Alert.alert(t('welcome_title'), t('welcome_msg'))
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
          : t('cancelled_msg_period')
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
        restored.length ? t('restored_msg', { items: restored.join(', ') }) : t('nothing_msg')
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
  // info.period is an English unit from the store helper ('month', 'year', ...): translate the word.
  const period = info ? (t(`period_${info.period}`) === `period_${info.period}` ? info.period : t(`period_${info.period}`)) : null
  const billed = info ? `${info.displayPrice}/${period}` : null
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
          <Text style={styles.title}>{active ? t('title_active') : t('title')}</Text>
          <Text style={styles.subtitle}>
            {active
              ? `${t('thanks')} ${current?.renews_at ? t('renews_on', { date: new Date(current.renews_at).toLocaleDateString() }) : ''}`
              : t('subtitle')}
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
                    <Text style={type.headline}>{t(b.title)}</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>{t(b.text)}</Text>
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
                  <Text style={type.headline}>{t('plan_name')}</Text>
                  <Ionicons name="checkmark-circle" size={22} color={colors.magenta} />
                </View>
                {info ? (
                  <>
                    {/* The billed amount: biggest price on the screen. */}
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
                colors={['#6b7cff', '#8f5bff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.cta, (busy || !info) && { opacity: 0.6 }]}
              >
                {purchasing ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.ctaText}>{billed ? t('subscribe_price', { billed }) : t('subscribe')}</Text>
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
