import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, useWindowDimensions, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson } from '../lib/api'
import useBusinessAccess from '../lib/useBusinessAccess'
import { BusinessGate, StateCard } from '../components/business/BusinessStates'
import { useT } from '../i18n'
import strings from '../i18n/strings/business'

// Business Pro hub: analytics plus the way into QR & poster, Promotions and Team.
// Only real numbers from /api/business/analytics are shown. If the request fails the tiles stay
// empty with an error and Retry; a new account with no activity gets an honest empty state.

const PERIODS = ['7d', '30d', '90d']

// 90 days of daily bars don't fit on a phone (90 x 5 pt): sum them into weeks.
function bucket(data, period) {
  if (!Array.isArray(data)) return []
  const nums = data.map((v) => Number(v) || 0)
  if (period !== '90d') return nums
  const out = []
  for (let i = 0; i < nums.length; i += 7) out.push(nums.slice(i, i + 7).reduce((a, b) => a + b, 0))
  return out
}

function StatCard({ icon, iconColors, label, value, change, index, width }) {
  const hasChange = typeof change === 'number' && Number.isFinite(change)
  const positive = hasChange && change >= 0
  const shown = typeof value === 'number' ? value.toLocaleString() : '—'
  return (
    <FadeIn index={index}>
      <GlassPanel radius={radii.lg} lite animateIn={false}>
        <View style={[styles.statCard, { width }]} accessible accessibilityLabel={`${label}: ${shown}${hasChange ? `, ${positive ? 'up' : 'down'} ${Math.abs(change)}%` : ''}`}>
          <LinearGradient colors={iconColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statIcon}>
            <Ionicons name={icon} size={18} color="#fff" />
          </LinearGradient>
          <Text style={type.caption} numberOfLines={1}>{label}</Text>
          <Text style={styles.statValue}>{shown}</Text>
          {hasChange && (
            <View style={[styles.changePill, positive ? styles.changeUp : styles.changeDown]}>
              <Ionicons name={positive ? 'trending-up' : 'trending-down'} size={12} color={positive ? '#10b981' : '#ef4444'} />
              <Text style={[styles.changeText, { color: positive ? '#10b981' : '#ef4444' }]}>
                {positive ? '+' : ''}{change}%
              </Text>
            </View>
          )}
        </View>
      </GlassPanel>
    </FadeIn>
  )
}

function MiniBar({ data, color, width }) {
  if (!data?.length) return null
  const peak = Math.max(...data, 1)
  const gap = 3
  const barW = Math.max(2, Math.floor((width - gap * (data.length - 1)) / data.length))
  return (
    <View style={styles.barRow}>
      {data.map((v, i) => (
        <View key={i} style={[styles.bar, { width: barW, height: Math.max(4, (v / peak) * 80), backgroundColor: color }]} />
      ))}
    </View>
  )
}

function TopSourceRow({ source, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <View style={styles.sourceRow}>
      <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{source}</Text>
      <Text style={type.subhead}>{count}</Text>
      <View style={styles.sourceBarWrap}>
        <View style={[styles.sourceBar, { width: `${pct}%` }]} />
      </View>
      <Text style={[type.caption, { width: 36, textAlign: 'right' }]}>{pct}%</Text>
    </View>
  )
}

function ToolButton({ icon, label, onPress }) {
  return (
    <Press onPress={onPress} haptic="light" style={{ flex: 1 }} accessibilityLabel={label}>
      <View style={styles.toolBtn}>
        <Ionicons name={icon} size={18} color={colors.text} />
        <Text style={styles.toolText} numberOfLines={2}>{label}</Text>
      </View>
    </Press>
  )
}

export default function BusinessDashboardScreen({ navigation }) {
  const t = useT(strings)
  const access = useBusinessAccess()
  return (
    <BusinessGate access={access} title={t('analytics_title')} lockedText={t('locked_analytics')} navigation={navigation}>
      <Dashboard navigation={navigation} />
    </BusinessGate>
  )
}

function Dashboard({ navigation }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const contentW = Math.min(winW, 600) - 32
  const tileW = (contentW - 10) / 2
  const [period, setPeriod] = useState('7d')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson(`/api/business/analytics?period=${period}`)
      setStats(data ?? {})
    } catch (e) {
      setStats(null)
      setError(e?.message || t('err_analytics_msg'))
    } finally {
      setLoading(false)
    }
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const sources = useMemo(() => (Array.isArray(stats?.top_sources) ? stats.top_sources.filter((s) => s && s.count > 0) : []), [stats])
  const totalSources = useMemo(() => sources.reduce((s, r) => s + (Number(r.count) || 0), 0), [sources])
  const impressions = bucket(stats?.daily_impressions, period)
  const taps = bucket(stats?.daily_taps, period)
  const isEmpty = !!stats && !error &&
    !stats.impressions && !stats.profile_taps && !stats.follows && !stats.link_clicks &&
    !impressions.some(Boolean) && !taps.some(Boolean)
  const weekly = period === '90d'

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('analytics_title')} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!stats} onRefresh={load} tintColor={colors.textMuted} />}
      >
        <FadeIn>
          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.periodBtn, period === p && styles.periodActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: period === p }}
              >
                <Text style={[styles.periodText, period === p && styles.periodTextActive]}>{t(`period_${p}`)}</Text>
              </Pressable>
            ))}
          </View>
        </FadeIn>

        {error ? (
          <StateCard tone="error" title={t('err_analytics_title')} message={`${error}\n${t('err_analytics_msg')}`} actionLabel={t('retry')} onAction={load} />
        ) : loading && !stats ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} accessibilityLabel={t('loading')} />
        ) : isEmpty ? (
          <StateCard icon="analytics-outline" title={t('empty_title')} message={t('empty_msg')} actionLabel={t('cta_qr')} onAction={() => navigation.navigate('BusinessQR')} />
        ) : (
          <>
            <View style={styles.grid}>
              <StatCard icon="eye" iconColors={['#6b7cff', '#9b8cff']} label={t('kpi_impressions')} value={stats?.impressions} change={stats?.impressions_change} index={1} width={tileW} />
              <StatCard icon="hand-left" iconColors={['#f97316', '#ef4444']} label={t('kpi_taps')} value={stats?.profile_taps} change={stats?.profile_taps_change} index={2} width={tileW} />
              <StatCard icon="person-add" iconColors={['#10b981', '#3b82f6']} label={t('kpi_follows')} value={stats?.follows} change={stats?.follows_change} index={3} width={tileW} />
              <StatCard icon="link" iconColors={['#8b5cf6', '#ec4899']} label={t('kpi_clicks')} value={stats?.link_clicks} change={stats?.link_clicks_change} index={4} width={tileW} />
            </View>

            {impressions.length ? (
              <FadeIn index={5} style={{ marginTop: 16 }}>
                <GlassPanel radius={radii.lg} lite animateIn={false}>
                  <View style={styles.chartCard}>
                    <Text style={type.headline}>{weekly ? t('chart_weekly') : t('chart_daily')}</Text>
                    <MiniBar data={impressions} color="#6b7cff" width={contentW - 36} />
                  </View>
                </GlassPanel>
              </FadeIn>
            ) : null}

            {taps.length ? (
              <FadeIn index={6} style={{ marginTop: 10 }}>
                <GlassPanel radius={radii.lg} lite animateIn={false}>
                  <View style={styles.chartCard}>
                    <Text style={type.headline}>{weekly ? t('chart_taps_weekly') : t('chart_taps_daily')}</Text>
                    <MiniBar data={taps} color="#f97316" width={contentW - 36} />
                  </View>
                </GlassPanel>
              </FadeIn>
            ) : null}

            {sources.length ? (
              <FadeIn index={7} style={{ marginTop: 10 }}>
                <GlassPanel radius={radii.lg} lite animateIn={false}>
                  <View style={styles.chartCard}>
                    <Text style={type.headline}>{t('sources_title')}</Text>
                    <View style={{ marginTop: 12, gap: 10 }}>
                      {sources.map((s) => (
                        <TopSourceRow key={String(s.source)} source={String(s.source)} count={Number(s.count) || 0} total={totalSources} />
                      ))}
                    </View>
                  </View>
                </GlassPanel>
              </FadeIn>
            ) : null}
          </>
        )}

        {/* The other Business tools (also listed on My Profile and in Settings). */}
        <FadeIn index={8} style={{ marginTop: 16 }}>
          <View style={styles.toolRow}>
            <ToolButton icon="qr-code-outline" label={t('cta_qr')} onPress={() => navigation.navigate('BusinessQR')} />
            <ToolButton icon="megaphone-outline" label={t('cta_promote')} onPress={() => navigation.navigate('PromotedPlacement')} />
            <ToolButton icon="people-outline" label={t('tool_team')} onPress={() => navigation.navigate('BusinessTeam')} />
          </View>
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16, maxWidth: 600, width: '100%', alignSelf: 'center' },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  periodBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  periodActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  periodText: { ...type.caption, fontWeight: '600' },
  periodTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { padding: 16 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statValue: { ...type.display, fontSize: 28, marginTop: 4 },
  changePill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  changeUp: { backgroundColor: 'rgba(16,185,129,0.12)' },
  changeDown: { backgroundColor: 'rgba(239,68,68,0.12)' },
  changeText: { fontSize: 12, fontWeight: '700' },
  chartCard: { padding: 18 },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 14, height: 80, overflow: 'hidden' },
  bar: { borderRadius: 3 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceBarWrap: { width: 60, height: 6, borderRadius: 3, backgroundColor: colors.inkSurface, overflow: 'hidden' },
  sourceBar: { height: '100%', borderRadius: 3, backgroundColor: colors.magenta },
  toolRow: { flexDirection: 'row', gap: 8 },
  toolBtn: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface, minHeight: 76 },
  toolText: { ...type.caption, color: colors.text, fontWeight: '600', textAlign: 'center' },
})
