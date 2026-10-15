import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, radii, type } from '../theme'
import { useT } from '../i18n'
import strings from '../i18n/strings/onboarding'

// Progress bars for the first-run onboarding (Intent · Nametag · Socials · Location), so
// "Skip" doesn't feel like the only safe choice. step is 1-based; renders nothing when the
// person has a single step left (no point in "Step 1 of 1"). onSkip adds a Skip link on the right.
export default function OnboardingSteps({ step, total, onSkip, onSkipAll, style }) {
  const t = useT(strings)
  const links = <SkipLinks onSkip={onSkip} onSkipAll={onSkipAll} t={t} />
  if (!total || total < 2 || !step) return onSkip || onSkipAll ? <View style={[styles.wrap, styles.row, { justifyContent: 'flex-end' }, style]}>{links}</View> : null
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.bars} accessibilityRole="progressbar" accessibilityLabel={t('stepOf', { n: step, total })}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.bar, i < step && styles.barOn]} />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.count}>{t('stepOf', { n: step, total })}</Text>
        {links}
      </View>
    </View>
  )
}

// "Skip for now" skips this step; "Skip setup" skips the rest of onboarding and goes straight into the app.
function SkipLinks({ onSkip, onSkipAll, t }) {
  return (
    <View style={styles.links}>
      {onSkip ? (
        <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('skip')}>
          <Text style={styles.skip}>{t('skip')}</Text>
        </Pressable>
      ) : null}
      {onSkipAll ? (
        <Pressable onPress={onSkipAll} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('skipAll')}>
          <Text style={[styles.skip, styles.skipAll]}>{t('skipAll')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.hairline },
  barOn: { backgroundColor: colors.magenta },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  count: { ...type.caption },
  links: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1 },
  skip: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
  skipAll: { color: colors.text },
})
