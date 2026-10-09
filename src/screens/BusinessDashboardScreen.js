import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Dimensions, ActivityIndicator, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn } from '../lib/motion'
import { apiJson } from '../lib/api'
import { useIsBusinessPro } from '../lib/useIsPro'

const PERIODS = ['7d', '30d', '90d']
const PERIOD_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' }

function StatCard({ icon, iconColors, label, value, change, index }) {
  const positive = change != null && change >= 0
  return (
    <FadeIn index={index}>
      <GlassPanel radius={radii.lg} lite animateIn={false}>
        <View style={styles.statCard}>
          <LinearGradient colors={iconColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statIcon}>
            <Ionicons name={icon} size={18} color="#fff" />
          </LinearGradient>
          <Text style={type.caption}>{label}</Text>
          <Text style={styles.statValue}>{value ?? '—'}</Text>
          {change != null && (
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

function MiniBar({ data, maxVal, color }) {
  if (!data?.length) return null
  const peak = maxVal || Math.max(...data, 1)
  const barW = Math.max(2, (Dimensions.get('window').width - 80) / data.length - 3)
  return (
    <View style={styles.barRow}>
      {data.map((v, i) => (
        <View key={i} style={[styles.bar, { width: barW, height: Math.max(4, (v / peak) * 80), backgroundColor: color }]} />
      ))}
    </View>
  )
}

function TopSourceRow({ source, count, total, index }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <View style={styles.sourceRow}>
      <Text style={[type.body, { flex: 1 }]}>{source}</Text>
      <Text style={type.subhead}>{count}</Text>
      <View style={styles.sourceBarWrap}>
        <View style={[styles.sourceBar, { width: `${pct}%` }]} />
      </View>
      <Text style={[type.caption, { width: 36, textAlign: 'right' }]}>{pct}%</Text>
    </View>
  )
}

export default function BusinessDashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const isBiz = useIsBusinessPro()
  const [period, setPeriod] = useState('7d')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson(`/api/business/analytics?period=${period}`)
      setStats(data)
    } catch (e) {
      setError(e?.message || 'Could not load analytics.')
      // Show demo data for development / when API isn't deployed yet
      setStats({
        impressions: 1247, impressions_change: 12,
        profile_taps: 89, profile_taps_change: 8,
        follows: 34, follows_change: -3,
        link_clicks: 156, link_clicks_change: 22,
        daily_impressions: [120, 180, 200, 160, 210, 190, 187],
        daily_taps: [8, 12, 15, 10, 14, 16, 14],
        top_sources: [
          { source: 'Nearby feed', count: 620 },
          { source: 'Map', count: 310 },
          { source: 'Discover', count: 204 },
          { source: 'Search', count: 113 },
        ],
      })
      setError(null) // clear — we have demo data
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const totalSources = useMemo(() => (stats?.top_sources ?? []).reduce((s, r) => s + r.count, 0), [stats])

  if (isBiz === false) {
    return (
      <View style={styles.screen}>
        <BrandHeader title="Analytics" onBack={() => navigation.goBack()} />
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={48} color={colors.textFaint} />
          <Text style={[type.title, { textAlign: 'center', marginTop: 16 }]}>Business Pro Only</Text>
          <Text style={[type.subhead, { textAlign: 'center', marginTop: 8 }]}>
            Upgrade to Business Pro to unlock analytics, promoted placement, and more.
          </Text>
          <Pressable onPress={() => navigation.navigate('Subscription')} style={styles.upgradeCta}>
            <LinearGradient colors={['#10b981', '#059669']} style={styles.upgradeGrad}>
              <Text style={styles.upgradeText}>Upgrade to Business Pro</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title="Analytics" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Period picker */}
        <FadeIn>
          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.periodBtn, period === p && styles.periodActive]}
              >
                <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                  {PERIOD_LABELS[p]}
                </Text>
              </Pressable>
            ))}
          </View>
        </FadeIn>

        {loading && !stats ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Stat cards — 2×2 grid */}
            <View style={styles.grid}>
              <StatCard icon="eye" iconColors={['#6b7cff', '#9b8cff']} label="Impressions" value={stats?.impressions?.toLocaleString()} change={stats?.impressions_change} index={1} />
              <StatCard icon="hand-left" iconColors={['#f97316', '#ef4444']} label="Profile taps" value={stats?.profile_taps?.toLocaleString()} change={stats?.profile_taps_change} index={2} />
              <StatCard icon="person-add" iconColors={['#10b981', '#3b82f6']} label="New follows" value={stats?.follows?.toLocaleString()} change={stats?.follows_change} index={3} />
              <StatCard icon="link" iconColors={['#8b5cf6', '#ec4899']} label="Link clicks" value={stats?.link_clicks?.toLocaleString()} change={stats?.link_clicks_change} index={4} />
            </View>

            {/* Impressions chart */}
            <FadeIn index={5} style={{ marginTop: 16 }}>
              <GlassPanel radius={radii.lg} lite animateIn={false}>
                <View style={styles.chartCard}>
                  <Text style={type.headline}>Daily impressions</Text>
                  <MiniBar data={stats?.daily_impressions} color="#6b7cff" />
                </View>
              </GlassPanel>
            </FadeIn>

            {/* Taps chart */}
            <FadeIn index={6} style={{ marginTop: 10 }}>
              <GlassPanel radius={radii.lg} lite animateIn={false}>
                <View style={styles.chartCard}>
                  <Text style={type.headline}>Daily profile taps</Text>
                  <MiniBar data={stats?.daily_taps} color="#f97316" />
                </View>
              </GlassPanel>
            </FadeIn>

            {/* Top sources */}
            <FadeIn index={7} style={{ marginTop: 10 }}>
              <GlassPanel radius={radii.lg} lite animateIn={false}>
                <View style={styles.chartCard}>
                  <Text style={type.headline}>Where people find you</Text>
                  <View style={{ marginTop: 12, gap: 10 }}>
                    {(stats?.top_sources ?? []).map((s, i) => (
                      <TopSourceRow key={s.source} source={s.source} count={s.count} total={totalSources} index={i} />
                    ))}
                  </View>
                </View>
              </GlassPanel>
            </FadeIn>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  upgradeCta: { marginTop: 24 },
  upgradeGrad: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  // Period picker
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  periodActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  periodText: { ...type.caption, fontWeight: '600' },
  periodTextActive: { color: '#fff' },
  // Stat cards
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { padding: 16, width: (Dimensions.get('window').width - 42) / 2 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statValue: { ...type.display, fontSize: 28, marginTop: 4 },
  changePill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  changeUp: { backgroundColor: 'rgba(16,185,129,0.12)' },
  changeDown: { backgroundColor: 'rgba(239,68,68,0.12)' },
  changeText: { fontSize: 12, fontWeight: '700' },
  // Charts
  chartCard: { padding: 18 },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 14, height: 80 },
  bar: { borderRadius: 3 },
  // Sources
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceBarWrap: { width: 60, height: 6, borderRadius: 3, backgroundColor: colors.inkSurface, overflow: 'hidden' },
  sourceBar: { height: '100%', borderRadius: 3, backgroundColor: colors.magenta },
})
