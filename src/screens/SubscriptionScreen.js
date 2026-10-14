import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView, Linking, Pressable } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GlassPanel from '../components/GlassPanel'
import { HeaderButton } from '../components/BrandHeader'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { API_URL, supabase } from '../lib/supabase'
import { apiJson } from '../lib/api'
import { BACKEND_TIER, SKUS, purchaseSubscription, restorePurchases, isUserCancelled, fetchSubscriptionInfo } from '../lib/iap'
import { logSubscriptionPurchase } from '../lib/attribution'
import { openLink } from '../lib/socialLinks'
import { markPro } from '../lib/useIsPro'
import { translate, useT } from '../i18n'
import strings from '../i18n/strings/subscription'

// iYiYi paywall: Creator Pro and Business Pro (one App Store subscription group, Business is the
// higher level, so Creator -> Business is an upgrade that StoreKit prorates).
//
// Honesty rules (App Review 3.1.2 / 2.3.1):
//  - Only perks the app delivers today are listed (checked in code: ranking + badge for Creator;
//    BusinessDashboard / BusinessQR / PromotedPlacement / BusinessTeam / History export for
//    Business). Arcade items are sold separately and the screen says so.
//  - Every price, intro offer and period comes from the store via react-native-iap
//    (fetchSubscriptionInfo); nothing is hard-coded. The regular price is the largest price on
//    screen and is repeated on the button; the intro offer is smaller, with its length and the
//    price that follows.
//  - Restore, Terms (EULA) and Privacy are always visible, with the auto-renew disclosure.
//
// TODO(owner): annual plans. No annual SKUs exist in scripts/asc_iaps.py, scripts/asc_pricing.py or
// scripts/play_products.py, so there is no Monthly/Annual toggle. Create the products in App
// Store Connect / Play Console first, add them to SKUS in lib/iap.js, then add the toggle here.

const TERMS_URL = 'https://iyiyi.xyz/terms'
const PRIVACY_URL = 'https://iyiyi.xyz/privacy'
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const PLAY_PACKAGE = 'com.iyiyi.app'
const playSubscriptionsUrl = (sku) =>
  `https://play.google.com/store/account/subscriptions?${sku ? `sku=${encodeURIComponent(sku)}&` : ''}package=${PLAY_PACKAGE}`

const BUSINESS_TIERS = ['business', 'business_pro']
const TIER_LABELS = {
  pro: 'Creator Pro', pro_local: 'Creator Pro', pro_national: 'Creator Pro', pro_all: 'Creator Pro',
  premium: 'Premium', creator: 'Creator', business: 'Business Pro', business_pro: 'Business Pro',
}
const PRICE_USD = { pro: 10, business: 29 }

const PERKS = {
  pro: [
    { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], key: 'perk_seen' },
    { icon: 'star', colors: ['#ffb16b', '#ff7e9d'], key: 'perk_badge' },
    { icon: 'heart', colors: ['#ff6fb5', '#ff9fd0'], key: 'perk_support' },
  ],
  business: [
    { icon: 'bar-chart', colors: ['#10b981', '#3b82f6'], key: 'perk_analytics' },
    { icon: 'qr-code', colors: ['#06b6d4', '#3b82f6'], key: 'perk_qr' },
    { icon: 'megaphone', colors: ['#f97316', '#ef4444'], key: 'perk_promoted' },
    { icon: 'people', colors: ['#6366f1', '#a78bfa'], key: 'perk_team' },
    { icon: 'download', colors: ['#64748b', '#475569'], key: 'perk_export' },
    { icon: 'rocket', colors: ['#6b7cff', '#9b8cff'], key: 'perk_all' },
  ],
}
const ACCENT = { pro: ['#6f7ff5', '#8b6cf0'], business: ['#10b981', '#059669'] }

function friendlyError(e, fallback) {
  if (e?.userFacing && e?.message) return e.message
  let msg = e?.message
  try { if (typeof msg === 'string' && msg.trim().startsWith('{')) msg = JSON.parse(msg).message } catch {}
  if (!msg || /verif|receipt|^[a-z-]+$/i.test(msg)) return fallback
  return msg
}

const tierOf = (accountTier) => (BUSINESS_TIERS.includes(accountTier) ? 'business' : 'pro')

export default function SubscriptionScreen({ navigation, route, onClose }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  const onboarding = typeof onClose === 'function'
  const [selectedTier, setSelectedTier] = useState(route?.params?.tier === 'business' ? 'business' : 'pro')
  const [purchasing, setPurchasing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState('')
  // Per-tier store info: { status: 'loading' | 'ok' | 'failed', info }
  const [store, setStore] = useState({ pro: { status: 'loading', info: null }, business: { status: 'loading', info: null } })
  const [viewers, setViewers] = useState(null)

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

  // Store price for one tier. Never spins forever: a failure (or a 20 s timeout) shows Retry.
  const loadTier = useCallback((tier) => {
    setStore((s) => ({ ...s, [tier]: { status: 'loading', info: s[tier].info } }))
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000) })
    return Promise.race([fetchSubscriptionInfo(tier), timeout])
      .then((info) => setStore((s) => ({ ...s, [tier]: info ? { status: 'ok', info } : { status: 'failed', info: null } })))
      .catch(() => setStore((s) => ({ ...s, [tier]: { status: 'failed', info: null } })))
      .finally(() => clearTimeout(timer))
  }, [])

  useEffect(() => {
    let cancelled = false
    loadCurrent()
      .then((c) => {
        if (cancelled) return
        if (onboarding && c?.status === 'active') onClose()
        // Someone on Creator Pro who opens the paywall is shown the upgrade, not their own plan.
        if (c?.status === 'active' && tierOf(c.tier) === 'pro' && Platform.OS === 'ios') setSelectedTier('business')
      })
      .catch(() => {})
    loadTier('pro')
    loadTier('business')
    // Real numbers only: "N people viewed your profile" appears when the API answers with N > 0.
    apiJson('/api/profiles/me/viewers')
      .then((d) => { if (!cancelled && Array.isArray(d?.viewers)) setViewers(d.viewers.length) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [loadCurrent, loadTier]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const active = current?.status === 'active'
  const activeTier = active ? tierOf(current.tier) : null
  const tierName = (tier) => (tier === 'business' ? t('tier_biz') : t('tier_pro'))
  // Upgrade: iOS only. Both products share one App Store subscription group, so StoreKit swaps
  // Creator for Business and prorates. On Google Play, lib/iap.js doesn't pass the old purchase
  // token / replacement mode, so a second purchase would bill both; we explain how to switch.
  const canUpgrade = active && activeTier === 'pro' && Platform.OS === 'ios'
  const showPicker = !active || activeTier === 'pro'
  const shownTier = active && !showPicker ? activeTier : selectedTier
  const viewingOwnPlan = active && shownTier === activeTier
  const tierStore = store[shownTier]
  const info = tierStore.info
  const periodWord = (p) => (t(`period_${p}`) === `period_${p}` ? p : t(`period_${p}`))
  const period = info ? periodWord(info.period) : null
  const billed = info ? `${info.displayPrice}/${period}` : null
  const storeName = Platform.OS === 'ios' ? 'App Store' : 'Google Play'
  const account = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'
  const goBack = !onboarding && navigation?.canGoBack?.() ? () => navigation.goBack() : null
  const busy = purchasing || restoring
  const accent = ACCENT[shownTier]
  const buyDisabled = busy || !info || (active && !canUpgrade) || viewingOwnPlan

  const purchase = async () => {
    const tier = shownTier
    setError('')
    setPurchasing(true)
    try {
      await purchaseSubscription(tier, verifyWithBackend)
      markPro()
      if (onboarding) onClose()
      else if (tier === 'business') {
        Alert.alert(t('welcome_tier_title', { tier: tierName('business') }), t('welcome_biz_msg'), [
          { text: 'OK', style: 'cancel' },
          { text: t('open_tools'), onPress: () => navigation?.navigate?.('BusinessDashboard') },
        ])
      } else Alert.alert(t('welcome_tier_title', { tier: tierName('pro') }), t('welcome_msg'))
    } catch (e) {
      if (!isUserCancelled(e)) setError(friendlyError(e, t('err_verify')))
    } finally {
      setPurchasing(false)
    }
  }

  // Cancelling is done by the store on both platforms (Google expects a link to Play's own page).
  const manage = () => {
    const url = Platform.OS === 'ios' ? APPLE_SUBSCRIPTIONS_URL : playSubscriptionsUrl(SKUS[activeTier ?? 'pro'])
    Linking.openURL(url).catch(() => Alert.alert(t('manage_title'), t('manage_msg')))
  }

  const restore = async () => {
    setError('')
    setRestoring(true)
    try {
      const restored = await restorePurchases(verifyWithBackend)
      Alert.alert(
        restored.length ? t('restored_title') : t('nothing_title'),
        restored.length ? t('restored_msg', { items: restored.map((r) => TIER_LABELS[r] ?? r).join(', ') }) : t('nothing_msg'),
      )
      if (restored.length && onboarding) onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  const headline = shownTier === 'business' ? t('hero_biz') : t('hero_pro')

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          {goBack ? <HeaderButton icon="chevron-back" onPress={goBack} label={t('back')} />
            : onboarding ? <HeaderButton icon="close" onPress={onClose} label={t('close')} />
              : <View style={{ width: 42 }} />}
          <Pressable onPress={restore} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('restore_a11y')}>
            {restoring ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.topRestore}>{t('restore')}</Text>}
          </Pressable>
        </View>

        {/* ---- tier tabs ---- */}
        {showPicker ? (
          <FadeIn style={styles.tabs}>
            {['pro', 'business'].map((tier) => {
              const on = selectedTier === tier
              return (
                <Pressable
                  key={tier}
                  onPress={() => setSelectedTier(tier)}
                  style={[styles.tab, on && styles.tabOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={tierName(tier)}
                >
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{tierName(tier)}</Text>
                  {active && activeTier === tier ? <Ionicons name="checkmark-circle" size={14} color={colors.success} /> : null}
                </Pressable>
              )
            })}
          </FadeIn>
        ) : null}

        {/* ---- hero ---- */}
        <FadeIn index={1} style={styles.hero}>
          {viewers > 0 ? (
            <View style={styles.proof}>
              <Ionicons name="eye-outline" size={15} color={colors.accent} />
              <Text style={styles.proofText}>{t('proof_viewers', { n: viewers.toLocaleString() })}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>
            {viewingOwnPlan ? t('title_active_tier', { tier: tierName(activeTier) }) : canUpgrade && shownTier === 'business' ? t('upgrade_head') : headline}
          </Text>
          {viewingOwnPlan ? (
            <Text style={styles.subtitle}>
              {t('thanks')} {current?.renews_at ? t('renews_on', { date: new Date(current.renews_at).toLocaleDateString() }) : t('renews_auto')}
            </Text>
          ) : null}
        </FadeIn>

        {/* ---- perks: only what the app delivers ---- */}
        <FadeIn index={2} style={{ marginTop: 14 }}>
          <Text style={styles.checkHead}>{viewingOwnPlan ? t('your_benefits') : t('what_you_get', { tier: tierName(shownTier) })}</Text>
          <View style={styles.perks}>
            {PERKS[shownTier].map((b) => (
              <View key={`${shownTier}-${b.key}`} style={styles.checkRow}>
                <LinearGradient colors={b.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.checkIcon}>
                  <Ionicons name={b.icon} size={14} color="#fff" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkTitle}>{t(`${b.key}_title`)}</Text>
                  <Text style={styles.checkText}>{t(`${b.key}_text`)}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.notIncluded}>{shownTier === 'business' ? t('not_included_biz') : t('not_included_pro')}</Text>
          </View>
        </FadeIn>

        {/* ---- the plan: monthly only (see TODO at the top for annual) ---- */}
        <FadeIn index={3} style={{ marginTop: 18 }}>
          {viewingOwnPlan ? (
            <GlassPanel radius={radii.lg} strong animateIn={false}>
              <View style={styles.planInner}>
                <Text style={type.headline}>{t('your_plan', { tier: TIER_LABELS[current.tier] ?? current.tier })}</Text>
                <Text style={[type.caption, { marginTop: 4 }]}>
                  {current.renews_at ? t('renews_on', { date: new Date(current.renews_at).toLocaleDateString() }) : t('renews_auto')}
                </Text>
                <Press onPress={manage} style={styles.secondaryBtn} accessibilityLabel={t('manage_a11y')}>
                  <Text style={styles.manageText}>{Platform.OS === 'ios' ? t('manage_cancel') : t('manage_play')}</Text>
                </Press>
                {activeTier === 'business' ? (
                  <Press onPress={() => navigation?.navigate?.('BusinessDashboard')} style={styles.secondaryBtn} accessibilityLabel={t('open_tools')}>
                    <Text style={[styles.manageText, { color: colors.accent }]}>{t('open_tools')}</Text>
                  </Press>
                ) : null}
              </View>
            </GlassPanel>
          ) : (
            <>
              <View style={[styles.planCard, { borderColor: accent[0] }]} accessible accessibilityLabel={info ? `${tierName(shownTier)}, ${t('price_a11y', { price: info.displayPrice, period })}` : tierName(shownTier)}>
                <Text style={styles.planLabel}>{t('monthly')}</Text>
                {info ? (
                  <>
                    <Text style={styles.planPrice} numberOfLines={1} adjustsFontSizeToFit>
                      {info.displayPrice}<Text style={styles.planPer}>{` ${t('per_period', { period })}`}</Text>
                    </Text>
                    {info.introText ? <Text style={[styles.planIntro, { color: accent[0] }]}>{info.introText}</Text> : null}
                  </>
                ) : tierStore.status === 'failed' ? (
                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.planFail}>{t('price_unavailable', { tier: tierName(shownTier) })}</Text>
                    <Press onPress={() => loadTier(shownTier)} haptic="selection" style={styles.retryBtn} accessibilityLabel={t('retry')}>
                      <Text style={styles.retryText}>{t('retry')}</Text>
                    </Press>
                  </View>
                ) : (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.textMuted} />
                    <Text style={type.caption}>{t('loading_price')}</Text>
                  </View>
                )}
              </View>

              {active && activeTier === 'pro' && shownTier === 'business' ? (
                <Text style={styles.upgradeNote}>{Platform.OS === 'ios' ? t('upgrade_ios_note') : t('upgrade_android_note')}</Text>
              ) : null}

              {!active || canUpgrade ? (
                <Press onPress={purchase} disabled={buyDisabled} scaleTo={0.97} haptic="light" accessibilityLabel={billed ? t('subscribe_a11y', { billed }) : t('subscribe')} style={{ marginTop: 14 }}>
                  <LinearGradient colors={accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cta, buyDisabled && { opacity: 0.6 }]}>
                    {purchasing ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Text style={styles.ctaText}>{canUpgrade ? t('upgrade_tier', { tier: tierName(shownTier) }) : t('subscribe_tier', { tier: tierName(shownTier) })}</Text>
                        {billed ? <Text style={styles.ctaSub}>{billed}</Text> : null}
                      </>
                    )}
                  </LinearGradient>
                </Press>
              ) : null}

              {info ? (
                <Text style={styles.termsLine}>
                  {info.introText ? t('terms_intro', { intro: info.introText, billed }) : t('terms_plain', { billed, period })}
                  {info.introText ? ` ${t('intro_new_only')}` : ''}
                </Text>
              ) : null}
              {!active ? (
                <View style={styles.reassure}>
                  <Ionicons name="shield-checkmark" size={13} color={colors.textMuted} />
                  <Text style={styles.reassureText}>{t('cancel_anytime', { where: Platform.OS === 'ios' ? 'Settings' : 'Google Play', store: storeName })}</Text>
                </View>
              ) : null}
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.disclosure}>
            {info
              ? (info.introText
                ? t('disclosure_lead_price_intro', { tier: tierName(shownTier), billed, intro: info.introText })
                : t('disclosure_lead_price', { tier: tierName(shownTier), billed }))
              : t('disclosure_lead', { tier: tierName(shownTier) })}
            {t('disclosure_body', { account, store: storeName })}
          </Text>

          <View style={styles.linksRow}>
            <Press onPress={restore} disabled={busy} accessibilityLabel={t('restore_a11y')} haptic="selection">
              <Text style={styles.linkSmall}>{t('restore')}</Text>
            </Press>
            <Press onPress={() => openLink(TERMS_URL)} accessibilityLabel={t('link_terms')} haptic="selection">
              <Text style={styles.linkSmall}>{t('link_terms')}</Text>
            </Press>
            <Press onPress={() => openLink(PRIVACY_URL)} accessibilityLabel={t('link_privacy')} haptic="selection">
              <Text style={styles.linkSmall}>{t('link_privacy')}</Text>
            </Press>
          </View>
          {onboarding && !active ? (
            <Press onPress={onClose} accessibilityLabel={t('not_now')} haptic="selection" style={{ alignSelf: 'center' }}>
              <Text style={styles.notNow}>{t('not_now')}</Text>
            </Press>
          ) : null}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  topRestore: { ...type.subhead, fontWeight: '600', color: colors.accent, paddingVertical: 6 },
  // tabs (segmented, as in the design board)
  tabs: { flexDirection: 'row', gap: 4, padding: 4, marginTop: 10, borderRadius: 21, backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.hairline },
  tab: { flex: 1, minHeight: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  tabOn: { backgroundColor: colors.glassFillStrong },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  tabTextOn: { color: colors.text },
  // hero
  hero: { marginTop: 16, paddingHorizontal: 4 },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 28, paddingHorizontal: 11, borderRadius: 14, backgroundColor: 'rgba(143,162,255,0.14)', marginBottom: 10 },
  proofText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6, color: colors.text },
  subtitle: { ...type.subhead, marginTop: 8 },
  // perks
  checkHead: { ...type.label, paddingHorizontal: 4, marginBottom: 10 },
  perks: { gap: 11, paddingHorizontal: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  checkTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  checkText: { color: colors.textMuted, fontSize: 12.5, marginTop: 1, lineHeight: 16 },
  notIncluded: { fontSize: 12.5, lineHeight: 17, color: colors.textFaint, marginTop: 2 },
  // plan card
  planCard: { borderWidth: 2, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: 'rgba(91,108,240,0.12)', minHeight: 92, justifyContent: 'center' },
  planLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  planPrice: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6, color: colors.text, marginTop: 2 },
  planPer: { fontSize: 14, fontWeight: '600', color: colors.textMuted, letterSpacing: 0 },
  planIntro: { fontSize: 12.5, fontWeight: '600', marginTop: 4 },
  planFail: { ...type.caption, color: colors.textMuted },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  retryBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface },
  retryText: { ...type.subhead, color: colors.text, fontWeight: '700' },
  upgradeNote: { ...type.caption, marginTop: 10, textAlign: 'center' },
  // CTA + terms
  cta: { paddingVertical: 13, paddingHorizontal: 22, minHeight: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center', shadowColor: '#5b6cf0', shadowOpacity: 0.38, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 17, textAlign: 'center' },
  ctaSub: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13, marginTop: 2, textAlign: 'center' },
  termsLine: { fontSize: 13.5, fontWeight: '600', color: colors.text, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  reassure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  reassureText: { color: colors.textMuted, fontSize: 12.5 },
  planInner: { padding: 18 },
  secondaryBtn: { marginTop: 14, paddingVertical: 6 },
  manageText: { color: colors.danger, fontWeight: '600' },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  disclosure: { fontSize: 11, lineHeight: 15, color: colors.textFaint, textAlign: 'center', marginTop: 12 },
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 4, marginTop: 14 },
  linkSmall: { fontSize: 12.5, fontWeight: '600', color: colors.accent, paddingVertical: 6 },
  notNow: { fontSize: 14, fontWeight: '600', color: colors.textMuted, paddingVertical: 10, paddingHorizontal: 12, marginTop: 4 },
})
