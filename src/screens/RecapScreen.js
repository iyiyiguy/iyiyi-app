import { useCallback, useRef, useState } from 'react'
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, Alert, Share, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect } from '@react-navigation/native'
import { captureRef } from 'react-native-view-shot'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { profileShareUrl } from '../lib/shareLinks'
import { fetchRecap } from '../lib/activityData'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/activity'

// Personality (lib/activityData personality.key) -> [title key, blurb key] in i18n/strings/activity.
const PERSONA = {
  creator: ['personaCreator', 'personaCreatorBlurb'],
  explorer: ['personaExplorer', 'personaExplorerBlurb'],
  magnet: ['personaMagnet', 'personaMagnetBlurb'],
  rising: ['personaRising', 'personaRisingBlurb'],
  original: ['personaOriginal', 'personaOriginalBlurb'],
}

// Labels are keys in i18n/strings/activity.
const RANGES = [
  { days: 7, label: 'thisWeekTab' },
  { days: 30, label: 'thisMonthTab' },
]

// A shareable recap card: "+N new followers" for creators and businesses, "you discovered N
// people" for everyone else, plus a personality based on how you used iYiYi. The card is a
// plain view that gets captured to an image and shared. (Visual style to be replaced by the redesign.)
export default function RecapScreen({ navigation }) {
  const t = useT(strings)
  const [days, setDays] = useState(7)
  const [recap, setRecap] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [metric, setMetric] = useState('views')
  const cardRef = useRef(null)
  const seq = useRef(0)

  // Built client-side from the tables/routes the app can read (lib/activityData); numbers
  // that aren't available come back null and show as "-", never as an error.
  const load = useCallback(async (d) => {
    const my = ++seq.current
    setLoading(true)
    try {
      const r = await fetchRecap(d)
      if (my === seq.current) setRecap(r)
    } catch (e) {
      console.warn('Recap load failed', e?.message ?? e)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load(days) }, [days, load]))

  const share = async () => {
    if (!recap) return
    setSharing(true)
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 })
      await Share.share({
        message: profileShareUrl(recap.username) ? t('shareMessageUrl', { url: profileShareUrl(recap.username) }) : t('shareMessage'),
        url: uri,
      })
    } catch (e) {
      Alert.alert(t('shareFailed'), e?.message ?? t('tryAgain'))
    } finally {
      setSharing(false)
    }
  }

  const grower = recap?.mode === 'grower' && recap?.new_followers != null
  const delta = recap && recap.new_followers != null && recap.previous_new_followers != null
    ? recap.new_followers - recap.previous_new_followers : 0
  const likesValue = recap?.likes_received ?? recap?.likes_all_time ?? null
  const likesLabel = recap?.likes_received != null ? t('likes') : t('totalLikes')
  const series = recap?.series ?? {}
  // lower: the word inside a sentence ("34 views this week").
  const METRICS = [
    { key: 'views', label: t('views'), lower: t('viewsLower'), data: series.views },
    { key: 'likes', label: t('likes'), lower: t('likesLower'), data: series.likes },
    { key: 'followers', label: t('followers'), lower: t('followersLower'), data: series.followers },
    { key: 'posts', label: t('posts'), lower: t('postsLower'), data: series.posts },
  ].filter((m) => Array.isArray(m.data) && m.data.length)
  const activeMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0]
  const rangeWord = days === 7 ? t('thisWeekWord') : t('thisMonthWord')
  const persona = PERSONA[recap?.personality?.key]
  const personaTitle = persona ? t(persona[0]) : recap?.personality?.title
  const personaBlurb = persona ? t(persona[1], { n: recap.personality.n ?? '', range: rangeWord }) : recap?.personality?.blurb

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('yourRecap')} onBack={() => navigation.goBack()} />
      <GlassPanel radius={999} style={styles.tabs}>
        {RANGES.map((r) => (
          <Pressable
            key={r.days}
            onPress={() => setDays(r.days)}
            style={[styles.tab, days === r.days && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: days === r.days }}
          >
            <Text style={[styles.tabText, days === r.days && styles.tabTextActive]}>{t(r.label)}</Text>
          </Pressable>
        ))}
      </GlassPanel>

      {loading && !recap ? (
        <ActivityIndicator color={colors.magenta} style={{ marginTop: 60 }} />
      ) : !recap ? (
        <View style={styles.emptyWrap}>
          <Text style={type.headline}>{t('recapOnWay')}</Text>
          <Text style={[type.caption, { textAlign: 'center', marginTop: 6 }]}>{t('recapOnWaySub')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }}>
          <View ref={cardRef} collapsable={false} style={styles.cardWrap}>
            <LinearGradient colors={['#ff2bd6', '#7a3cff', '#19e3ff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
              <Text style={styles.brand}>iYiYi ✦ recap</Text>
              <View style={styles.who}>
                {<Image source={avatarSource(recap?.avatar_url)} style={styles.avatar} />}
                <Text style={styles.name}>@{recap.username ?? t('youHandle')}</Text>
              </View>

              {grower ? (
                <>
                  <Text style={styles.big}>+{fmt(recap.new_followers)}</Text>
                  <Text style={styles.bigLabel}>{t('newFollowersRange', { range: rangeWord })}</Text>
                  {(recap.previous_new_followers ?? 0) > 0 || delta !== 0 ? (
                    <Text style={styles.delta}>{delta >= 0 ? '▲' : '▼'} {t('vsBefore', { n: Math.abs(delta) })}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.big}>{fmt(recap.people_discovered)}</Text>
                  <Text style={styles.bigLabel}>{t('discoveredRange', { range: rangeWord })}</Text>
                </>
              )}

              <View style={styles.statRow}>
                <Stat label={t('profileViews')} value={fmt(recap.profile_views)} />
                <Stat label={likesLabel} value={fmt(likesValue)} />
                <Stat label={t('followers')} value={fmt(recap.total_followers)} />
              </View>

              {recap.personality?.title ? (
                <View style={styles.persona}>
                  <Text style={styles.personaLabel}>{t('yourVibe')}</Text>
                  <Text style={styles.personaTitle}>{personaTitle}</Text>
                  {personaBlurb ? <Text style={styles.personaBlurb}>{personaBlurb}</Text> : null}
                </View>
              ) : null}
              <Text style={styles.foot}>{t('recapFoot')}</Text>
            </LinearGradient>
          </View>

          {activeMetric ? (
            <GlassPanel radius={radii.lg} style={styles.chartPanel}>
              <View style={styles.chartHead}>
                <Text style={type.headline}>{t('overTime')}</Text>
                <Text style={type.caption}>{t('metricTotal', { n: activeMetric.data.reduce((a, b) => a + b, 0), metric: activeMetric.lower, range: rangeWord })}</Text>
              </View>
              <View style={styles.metricRow}>
                {METRICS.map((m) => (
                  <Pressable
                    key={m.key}
                    onPress={() => setMetric(m.key)}
                    style={[styles.metric, activeMetric.key === m.key && styles.metricOn]}
                    hitSlop={{ top: 6, bottom: 6 }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeMetric.key === m.key }}
                  >
                    <Text style={[styles.metricText, activeMetric.key === m.key && styles.metricTextOn]}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Bars data={activeMetric.data} />
              <View style={styles.axis}>
                <Text style={type.caption}>{t('daysAgoAxis', { n: days })}</Text>
                <Text style={type.caption}>{t('todayAxis')}</Text>
              </View>
            </GlassPanel>
          ) : null}

          {sharing ? <ActivityIndicator color={colors.magenta} style={{ marginTop: 20 }} /> : (
            <Pressable style={styles.shareBtn} onPress={share} accessibilityRole="button"><Text style={styles.shareText}>{t('shareRecap')}</Text></Pressable>
          )}
          <Text style={[type.caption, styles.note]}>{t('shareNote')}</Text>
        </ScrollView>
      )}
    </View>
  )
}

const fmt = (v) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toLocaleString())

function Bars({ data }) {
  const max = Math.max(1, ...data)
  return (
    <View style={styles.bars}>
      {data.map((v, i) => (
        <View key={i} style={styles.barSlot}>
          <View style={[styles.bar, { height: `${Math.max(3, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }]} />
        </View>
      ))}
    </View>
  )
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  tabs: { flexDirection: 'row', margin: 16, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: colors.magenta },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: colors.onBrand },
  cardWrap: { width: 320, borderRadius: 28, overflow: 'hidden', borderWidth: 3, borderColor: '#ffffff', marginTop: 4 },
  card: { padding: 22, alignItems: 'center' },
  brand: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#fff' },
  name: { color: '#fff', fontWeight: '800', fontSize: 16 },
  big: { color: '#fff', fontSize: 78, fontWeight: '900', marginTop: 12, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6, fontStyle: 'italic' },
  bigLabel: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  delta: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 6, opacity: 0.95 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  statValue: { color: '#fff', fontWeight: '900', fontSize: 20 },
  statLabel: { color: '#fff', fontWeight: '700', fontSize: 10, marginTop: 2, textAlign: 'center' },
  persona: { marginTop: 18, width: '100%', backgroundColor: '#ffffff', borderRadius: 18, padding: 14, alignItems: 'center' },
  personaLabel: { color: '#7a3cff', fontWeight: '900', fontSize: 10, letterSpacing: 1.5 },
  personaTitle: { color: '#ff2bd6', fontWeight: '900', fontSize: 22, marginTop: 2, fontStyle: 'italic' },
  personaBlurb: { color: '#3a2d45', fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 2 },
  foot: { color: '#fff', fontWeight: '700', fontSize: 11, marginTop: 14, opacity: 0.9 },
  shareBtn: { marginTop: 22, backgroundColor: colors.magenta, paddingVertical: 15, paddingHorizontal: 40, borderRadius: radii.pill },
  shareText: { color: colors.onBrand, fontWeight: '800', fontSize: 16 },
  note: { marginTop: 10, textAlign: 'center', paddingHorizontal: 40 },
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  chartPanel: { width: 320, marginTop: 22, padding: 16 },
  chartHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  metricRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  metric: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.hairline },
  metricOn: { backgroundColor: colors.text },
  metricText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  metricTextOn: { color: colors.ink },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2, marginTop: 14 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3, backgroundColor: colors.magenta },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
})
