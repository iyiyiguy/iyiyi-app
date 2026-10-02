import { useState, useEffect, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView, Linking } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import { colors, radii, type } from '../theme'
import { API_URL, supabase } from '../lib/supabase'
import { purchaseSubscription, restorePurchases, isUserCancelled, fetchSubscriptionInfo } from '../lib/iap'
import { logSubscriptionPurchase } from '../lib/attribution'
import { openLink } from '../lib/socialLinks'

const TERMS_URL = 'https://shop.iyiyi.xyz/policies/terms-of-service'
const PRIVACY_URL = 'https://shop.iyiyi.xyz/policies/privacy-policy'

const TIER_LABELS = { pro: 'Pro', pro_local: 'Pro', pro_national: 'Pro', pro_all: 'Pro', premium: 'Premium', creator: 'Creator' }

const PRICE_USD = { pro: 1 }
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'

export default function SubscriptionScreen() {
  const [purchasing, setPurchasing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null) // localized store pricing, null until loaded / unavailable

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
    setCurrent(await res.json())
  }, [])

  useEffect(() => {
    loadCurrent().catch(() => {})
    let cancelled = false
    fetchSubscriptionInfo('pro')
      .then((i) => { if (!cancelled) setInfo(i) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [loadCurrent])

  const verifyWithBackend = async (payload) => {
    const res = await authedFetch('/api/subscription/activate', { method: 'POST', body: JSON.stringify(payload) })
    if (!res.ok) throw new Error('Purchase could not be verified')
    await loadCurrent()
    logSubscriptionPurchase(payload.tier, PRICE_USD[payload.tier] ?? 0)
  }

  const purchase = async (tier = 'pro') => {
    setError('')
    setPurchasing(true)
    try {
      await purchaseSubscription(tier, verifyWithBackend)
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
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="profile" />
      <ScrollView>
      <BrandHeader title="Subscription" />

      {current?.status === 'active' && (
        <GlassPanel radius={radii.lg} style={styles.currentCard}>
          <Text style={type.body}>
            You're on {TIER_LABELS[current.tier] ?? current.tier}
          </Text>
          <Text style={type.caption}>
            Renews {current.renews_at ? new Date(current.renews_at).toLocaleDateString() : '—'}
          </Text>
          <Pressable onPress={cancel} disabled={cancelling} style={styles.cancelButton}>
            {cancelling ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.cancelText}>{Platform.OS === 'ios' ? 'Manage / Cancel Subscription' : 'Cancel Subscription'}</Text>}
          </Pressable>
        </GlassPanel>
      )}

      <GlassPanel radius={radii.lg} strong style={styles.promoCard}>
        {info?.introText ? <View style={styles.promoBadge}><Text style={styles.promoBadgeText}>INTRO OFFER</Text></View> : null}
        <Text style={type.body}>⭐ iYiYi Pro</Text>
        {info ? (
          <View style={styles.promoPriceRow}>
            <Text style={styles.promoPrice}>{info.introText ?? `${info.displayPrice}/${info.period}`}</Text>
          </View>
        ) : null}
        <Text style={type.caption}>
          {info
            ? info.introText
              ? `${info.introText}, then automatically continues at ${info.displayPrice}/${info.period}. Cancel anytime.`
              : `${info.displayPrice}/${info.period}, renews automatically. Cancel anytime.`
            : 'Auto-renewing monthly subscription. The price for your region is shown before you confirm. Cancel anytime.'}
        </Text>
        <Text style={[type.caption, { marginTop: 10 }]}>
          Free accounts still show up everywhere — Pro just gets seen more. We analyze your profile to
          determine what reach is best for you, from local to international.
        </Text>

        <Pressable
          onPress={() => purchase('pro')}
          disabled={purchasing || restoring}
          style={styles.promoButton}
        >
          {purchasing ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.promoButtonText}>Start Pro</Text>}
        </Pressable>
      </GlassPanel>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable onPress={restore} disabled={purchasing || restoring} style={styles.restoreButton}>
        {restoring ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.restoreText}>Restore Purchases</Text>}
      </Pressable>

      <Text style={styles.disclosure}>
        Payment will be charged to your {Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} account at
        confirmation of purchase. Subscriptions automatically renew monthly unless auto-renew is
        turned off at least 24 hours before the end of the current period. You can manage and
        cancel subscriptions in your {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} account
        settings. See our{' '}
        <Text style={styles.link} onPress={() => openLink(TERMS_URL)}>Terms of Service</Text>
        {' '}and{' '}
        <Text style={styles.link} onPress={() => openLink(PRIVACY_URL)}>Privacy Policy</Text>.
      </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  currentCard: { marginHorizontal: 20, marginTop: 20, padding: 16 },
  cancelButton: { marginTop: 10 },
  cancelText: { color: colors.danger, fontWeight: '600' },
  promoCard: { margin: 20, padding: 16, shadowColor: colors.gold, shadowOpacity: 0.25 },
  promoBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.gold, borderRadius: radii.pill,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: 8,
  },
  promoBadgeText: { fontSize: 10, fontWeight: '800', color: colors.onGold, letterSpacing: 0.5 },
  promoPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4, marginBottom: 4 },
  promoPrice: { color: colors.gold, fontWeight: '800', fontSize: 24 },
  promoStrike: { color: colors.textFaint, fontSize: 16, textDecorationLine: 'line-through' },
  promoButton: {
    marginTop: 14, backgroundColor: colors.gold, paddingVertical: 14,
    borderRadius: radii.pill, alignItems: 'center',
  },
  promoButtonText: { color: colors.onGold, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger, textAlign: 'center', marginHorizontal: 20 },
  restoreButton: { paddingVertical: 14, alignItems: 'center' },
  restoreText: { color: colors.textMuted, fontWeight: '600' },
  disclosure: { ...type.caption, marginHorizontal: 20, marginBottom: 24, lineHeight: 18 },
  link: { color: colors.magenta },
})
