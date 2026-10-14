import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import GlassPanel from '../GlassPanel'
import { colors, radii, type } from '../../theme'
import { Press } from '../../lib/motion'
import { useAccountTier } from '../../lib/useIsPro'
import { isBusinessTier } from '../../lib/useBusinessAccess'
import { useT } from '../../i18n'
import strings from '../../i18n/strings/business'
import { openBusinessPlan } from './BusinessStates'

export const TEAM_STAFF_SEATS = 3

const TOOLS = [
  { route: 'BusinessDashboard', icon: 'bar-chart', colors: ['#10b981', '#3b82f6'], title: 'tool_analytics', sub: 'tool_analytics_sub' },
  { route: 'BusinessQR', icon: 'qr-code', colors: ['#06b6d4', '#3b82f6'], title: 'tool_qr', sub: 'tool_qr_sub' },
  { route: 'PromotedPlacement', icon: 'megaphone', colors: ['#f97316', '#ef4444'], title: 'tool_promos', sub: 'tool_promos_sub' },
  { route: 'BusinessTeam', icon: 'people', colors: ['#6366f1', '#a78bfa'], title: 'tool_team', sub: 'tool_team_sub' },
]

function ToolRow({ icon, gradient, title, sub, onPress, last }) {
  return (
    <Press onPress={onPress} haptic="selection" scaleTo={0.98} accessibilityLabel={`${title}. ${sub}`}>
      <View style={[styles.row, !last && styles.rowDivider]}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.icon}>
          <Ionicons name={icon} size={16} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={type.caption} numberOfLines={2}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>
    </Press>
  )
}

/**
 * "Business tools" entry for My Profile and Settings.
 *  - Business Pro: the four tools.
 *  - Known not Business: one row that opens the Business tab of the paywall.
 *  - Plan unknown (offline): one row into Analytics, which checks the plan itself.
 * `variant="row"` renders a single compact row (for Settings lists).
 */
export default function BusinessToolsCard({ navigation, variant = 'card', style }) {
  const t = useT(strings)
  const tier = useAccountTier()
  const biz = isBusinessTier(tier)
  const known = tier != null
  const openHub = () => (known && !biz ? openBusinessPlan(navigation) : navigation.navigate('BusinessDashboard'))

  if (variant === 'row' || !biz) {
    return (
      <GlassPanel radius={radii.lg} lite animateIn={false} style={style}>
        {variant !== 'row' ? <View style={styles.label}><Text style={type.label}>{t('tools_title')}</Text></View> : null}
        <ToolRow
          icon="briefcase"
          gradient={['#10b981', '#059669']}
          title={t('tools_title')}
          sub={biz || !known ? t('tools_sub_biz') : t('tools_sub_upsell')}
          onPress={openHub}
          last
        />
      </GlassPanel>
    )
  }

  return (
    <GlassPanel radius={radii.lg} lite animateIn={false} style={style}>
      <View style={styles.label}><Text style={type.label}>{t('tools_title')}</Text></View>
      {TOOLS.map((tool, i) => (
        <ToolRow
          key={tool.route}
          icon={tool.icon}
          gradient={tool.colors}
          title={t(tool.title)}
          sub={t(tool.sub, { n: TEAM_STAFF_SEATS })}
          onPress={() => navigation.navigate(tool.route)}
          last={i === TOOLS.length - 1}
        />
      ))}
    </GlassPanel>
  )
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: 16, paddingTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  icon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontWeight: '700', fontSize: 15 },
})
