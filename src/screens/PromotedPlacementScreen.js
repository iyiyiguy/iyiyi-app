import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Switch } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson, post } from '../lib/api'
import { useIsBusinessPro } from '../lib/useIsPro'

const RADIUS_OPTIONS = [
  { label: '500 ft', value: 500, unit: 'ft' },
  { label: '¼ mile', value: 1320, unit: 'ft' },
  { label: '1 mile', value: 5280, unit: 'ft' },
  { label: '5 miles', value: 26400, unit: 'ft' },
]

const DURATION_OPTIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

function PromotionCard({ promo, onToggle }) {
  const active = promo.status === 'active'
  const endDate = promo.ends_at ? new Date(promo.ends_at).toLocaleDateString() : null
  return (
    <GlassPanel radius={radii.lg} lite animateIn={false}>
      <View style={styles.promoCard}>
        <View style={styles.promoHeader}>
          <View style={{ flex: 1 }}>
            <Text style={type.headline} numberOfLines={1}>{promo.headline || 'Promoted placement'}</Text>
            <Text style={type.caption}>
              {RADIUS_OPTIONS.find((r) => r.value === promo.radius)?.label ?? `${promo.radius} ft`} radius
              {endDate ? ` · ends ${endDate}` : ''}
            </Text>
          </View>
          <View style={[styles.statusDot, active ? styles.statusActive : styles.statusPaused]} />
        </View>
        <View style={styles.promoStats}>
          <View style={styles.promoStat}>
            <Text style={styles.promoStatVal}>{promo.impressions?.toLocaleString() ?? '0'}</Text>
            <Text style={type.caption}>views</Text>
          </View>
          <View style={styles.promoStat}>
            <Text style={styles.promoStatVal}>{promo.taps?.toLocaleString() ?? '0'}</Text>
            <Text style={type.caption}>taps</Text>
          </View>
          <View style={styles.promoStat}>
            <Text style={styles.promoStatVal}>{promo.follows?.toLocaleString() ?? '0'}</Text>
            <Text style={type.caption}>follows</Text>
          </View>
        </View>
        <View style={styles.promoToggle}>
          <Text style={type.subhead}>{active ? 'Active' : 'Paused'}</Text>
          <Switch value={active} onValueChange={() => onToggle(promo.id, !active)} trackColor={{ true: '#10b981' }} />
        </View>
      </View>
    </GlassPanel>
  )
}

export default function PromotedPlacementScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const isBiz = useIsBusinessPro()
  const [tab, setTab] = useState('active') // 'active' | 'create'
  const [promotions, setPromotions] = useState([])
  const [loading, setLoading] = useState(true)

  // Create form
  const [headline, setHeadline] = useState('')
  const [description, setDescription] = useState('')
  const [radius, setRadius] = useState(1320)
  const [duration, setDuration] = useState(7)
  const [creating, setCreating] = useState(false)

  const loadPromos = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson('/api/business/promotions')
      setPromotions(data?.promotions ?? [])
    } catch {
      // Demo data for development
      setPromotions([
        { id: '1', headline: 'Grand Opening — 20% off all drinks!', radius: 1320, status: 'active', ends_at: new Date(Date.now() + 5 * 86400000).toISOString(), impressions: 2340, taps: 178, follows: 42 },
        { id: '2', headline: 'Live music every Friday', radius: 5280, status: 'paused', ends_at: new Date(Date.now() + 12 * 86400000).toISOString(), impressions: 890, taps: 56, follows: 11 },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPromos() }, [loadPromos])

  const togglePromo = async (id, active) => {
    try {
      await post(`/api/business/promotions/${id}/toggle`, { active })
      setPromotions((prev) => prev.map((p) => (p.id === id ? { ...p, status: active ? 'active' : 'paused' } : p)))
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not update promotion.')
    }
  }

  const createPromo = async () => {
    if (!headline.trim()) { Alert.alert('Missing headline', 'Add a headline for your promotion.'); return }
    setCreating(true)
    try {
      await post('/api/business/promotions', { headline: headline.trim(), description: description.trim(), radius, duration_days: duration })
      Alert.alert('Promotion created', 'Your promoted placement is now live!')
      setHeadline('')
      setDescription('')
      setTab('active')
      loadPromos()
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not create promotion.')
    } finally {
      setCreating(false)
    }
  }

  if (isBiz === false) {
    return (
      <View style={styles.screen}>
        <BrandHeader title="Promoted" onBack={() => navigation.goBack()} />
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={48} color={colors.textFaint} />
          <Text style={[type.title, { textAlign: 'center', marginTop: 16 }]}>Business Pro Only</Text>
          <Text style={[type.subhead, { textAlign: 'center', marginTop: 8, maxWidth: 300 }]}>
            Promote your business to the top of the nearby feed for everyone within your chosen radius.
          </Text>
          <Pressable onPress={() => navigation.navigate('Subscription')} style={{ marginTop: 24 }}>
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
      <BrandHeader title="Promoted" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Tab toggle */}
        <FadeIn>
          <View style={styles.tabRow}>
            <Pressable onPress={() => setTab('active')} style={[styles.tabBtn, tab === 'active' && styles.tabActive]}>
              <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>My promotions</Text>
            </Pressable>
            <Pressable onPress={() => setTab('create')} style={[styles.tabBtn, tab === 'create' && styles.tabActive]}>
              <Ionicons name="add-circle" size={16} color={tab === 'create' ? '#fff' : colors.textMuted} />
              <Text style={[styles.tabText, tab === 'create' && styles.tabTextActive]}>Create new</Text>
            </Pressable>
          </View>
        </FadeIn>

        {tab === 'active' ? (
          <>
            {loading ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
            ) : promotions.length === 0 ? (
              <FadeIn index={1} style={styles.emptyWrap}>
                <Ionicons name="megaphone-outline" size={48} color={colors.textFaint} />
                <Text style={[type.subhead, { textAlign: 'center', marginTop: 12 }]}>
                  No promotions yet. Create one to pin your business at the top of the nearby feed.
                </Text>
                <Press onPress={() => setTab('create')} haptic="light" style={{ marginTop: 16 }}>
                  <LinearGradient colors={['#f97316', '#ef4444']} style={styles.createBtn}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.createBtnText}>Create promotion</Text>
                  </LinearGradient>
                </Press>
              </FadeIn>
            ) : (
              <View style={{ gap: 12, marginTop: 4 }}>
                {promotions.map((p, i) => (
                  <FadeIn key={p.id} index={i + 1}>
                    <PromotionCard promo={p} onToggle={togglePromo} />
                  </FadeIn>
                ))}
              </View>
            )}
          </>
        ) : (
          /* ---- Create new promotion ---- */
          <FadeIn index={1}>
            <GlassPanel radius={radii.lg} lite animateIn={false} style={{ marginTop: 4 }}>
              <View style={styles.form}>
                <Text style={type.headline}>Create a promotion</Text>
                <Text style={[type.caption, { marginBottom: 16 }]}>
                  Your business will be pinned to the top of the nearby feed for everyone in your radius.
                </Text>

                <Text style={type.label}>Headline</Text>
                <TextInput
                  style={styles.input}
                  value={headline}
                  onChangeText={setHeadline}
                  placeholder="e.g. Grand Opening — 20% off!"
                  placeholderTextColor={colors.textFaint}
                  maxLength={80}
                />

                <Text style={[type.label, { marginTop: 14 }]}>Description (optional)</Text>
                <TextInput
                  style={[styles.input, styles.inputMulti]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Tell people what to expect..."
                  placeholderTextColor={colors.textFaint}
                  multiline
                  maxLength={280}
                />

                <Text style={[type.label, { marginTop: 14 }]}>Radius</Text>
                <View style={styles.optionRow}>
                  {RADIUS_OPTIONS.map((r) => (
                    <Pressable key={r.value} onPress={() => setRadius(r.value)} style={[styles.optionBtn, radius === r.value && styles.optionActive]}>
                      <Text style={[styles.optionText, radius === r.value && styles.optionTextActive]}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[type.label, { marginTop: 14 }]}>Duration</Text>
                <View style={styles.optionRow}>
                  {DURATION_OPTIONS.map((d) => (
                    <Pressable key={d.days} onPress={() => setDuration(d.days)} style={[styles.optionBtn, duration === d.days && styles.optionActive]}>
                      <Text style={[styles.optionText, duration === d.days && styles.optionTextActive]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[type.caption, { marginTop: 16, textAlign: 'center' }]}>
                  Included with your Business Pro subscription — no extra charge.
                </Text>

                <Press onPress={createPromo} disabled={creating} haptic="light" style={{ marginTop: 16 }}>
                  <LinearGradient colors={['#f97316', '#ef4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.submitBtn, creating && { opacity: 0.6 }]}>
                    {creating ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Ionicons name="megaphone" size={18} color="#fff" />
                        <Text style={styles.submitText}>Launch promotion</Text>
                      </>
                    )}
                  </LinearGradient>
                </Press>
              </View>
            </GlassPanel>
          </FadeIn>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  upgradeGrad: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  // Tabs
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tabBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  tabActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  tabText: { fontWeight: '700', fontSize: 14, color: colors.textMuted },
  tabTextActive: { color: '#fff' },
  // Promo card
  promoCard: { padding: 18 },
  promoHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  statusActive: { backgroundColor: '#10b981' },
  statusPaused: { backgroundColor: colors.textFaint },
  promoStats: { flexDirection: 'row', gap: 16, marginTop: 14 },
  promoStat: { alignItems: 'center' },
  promoStatVal: { ...type.headline, fontSize: 18 },
  promoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline },
  // Empty
  emptyWrap: { alignItems: 'center', padding: 32, marginTop: 40 },
  createBtn: { flexDirection: 'row', gap: 6, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, alignItems: 'center' },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // Form
  form: { padding: 20 },
  input: { ...type.body, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface, marginTop: 6, color: colors.text },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  optionBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  optionActive: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  optionText: { ...type.caption, fontWeight: '600' },
  optionTextActive: { color: '#fff' },
  submitBtn: { flexDirection: 'row', gap: 8, paddingVertical: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
