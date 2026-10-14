import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader from '../BrandHeader'
import GlassPanel from '../GlassPanel'
import { colors, radii, type } from '../../theme'
import { Press } from '../../lib/motion'
import { useT } from '../../i18n'
import strings from '../../i18n/strings/business'

// Opens the paywall on its Business Pro tab.
export const openBusinessPlan = (navigation) => navigation.navigate('Subscription', { tier: 'business' })

/** Error or empty card with an optional action (Retry, or a next step). */
export function StateCard({ icon = 'alert-circle-outline', title, message, actionLabel, onAction, tone = 'neutral', style }) {
  return (
    <GlassPanel radius={radii.lg} lite animateIn={false} style={style}>
      <View style={styles.card} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
        <Ionicons name={icon} size={30} color={tone === 'error' ? colors.danger : colors.textFaint} />
        {title ? <Text style={[type.headline, styles.center, { marginTop: 10 }]}>{title}</Text> : null}
        {message ? <Text style={[type.caption, styles.center, { marginTop: 6, maxWidth: 320 }]}>{message}</Text> : null}
        {actionLabel && onAction ? (
          <Press onPress={onAction} haptic="light" style={{ marginTop: 14 }} accessibilityLabel={actionLabel}>
            <View style={styles.outlineBtn}>
              <Text style={styles.outlineText}>{actionLabel}</Text>
            </View>
          </Press>
        ) : null}
      </View>
    </GlassPanel>
  )
}

/**
 * Wraps a Business Pro screen: spinner while the plan is unknown, error + Retry if it can't be
 * checked, an upsell to the Business tab of the paywall for everyone else, else the screen.
 * `access` is the result of useBusinessAccess().
 */
export function BusinessGate({ access, title, lockedText, navigation, children }) {
  const t = useT(strings)
  if (access.status === 'business') return children
  return (
    <View style={styles.screen}>
      <BrandHeader title={title} onBack={() => navigation.goBack()} />
      <View style={styles.locked}>
        {access.status === 'loading' ? (
          <ActivityIndicator color={colors.textMuted} accessibilityLabel={t('loading')} />
        ) : access.status === 'error' ? (
          <StateCard tone="error" title={t('err_access_title')} message={access.error || t('err_access_msg')} actionLabel={t('retry')} onAction={access.retry} />
        ) : (
          <>
            <Ionicons name="briefcase-outline" size={48} color={colors.textFaint} />
            <Text style={[type.title, styles.center, { marginTop: 16 }]}>{t('locked_title')}</Text>
            <Text style={[type.subhead, styles.center, { marginTop: 8, maxWidth: 300 }]}>{lockedText}</Text>
            <Press onPress={() => openBusinessPlan(navigation)} haptic="light" style={{ marginTop: 24 }} accessibilityLabel={t('locked_cta')}>
              <LinearGradient colors={['#10b981', '#059669']} style={styles.upgradeGrad}>
                <Text style={styles.upgradeText}>{t('locked_cta')}</Text>
              </LinearGradient>
            </Press>
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  center: { textAlign: 'center' },
  card: { padding: 20, alignItems: 'center' },
  outlineBtn: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 999, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface },
  outlineText: { ...type.subhead, color: colors.text, fontWeight: '700' },
  upgradeGrad: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
