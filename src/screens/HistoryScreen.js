import { useEffect, useState, useCallback } from 'react'
import { View, FlatList, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import UserCard from '../components/UserCard'
import TagFilterBar from '../components/TagFilterBar'
import { colors, type } from '../theme'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { apiJson } from '../lib/api'
import { exportHistory } from '../lib/exportPeople'
import ExportSheet from '../components/ExportSheet'
import { openProfile } from '../lib/profileNav'
import { useIsBusinessPro } from '../lib/useIsPro'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'
import socialStrings from '../i18n/strings/social'

export default function HistoryScreen({ navigation }) {
  const t = useT(strings)
  const tsoc = useT(socialStrings)
  const [layout, setLayout] = useState('grid')
  const [history, setHistory] = useState([])
  const [activeTag, setActiveTag] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const { statuses, setStatus } = useFollowStatuses(history, 'id')
  const isBiz = useIsBusinessPro()

  const runExport = async (opts) => {
    setExporting(true)
    try {
      await exportHistory(opts)
      setShowExport(false)
    } catch (e) {
      Alert.alert(t('exportFailed'), e?.message ?? t('tryAgain'))
    } finally {
      setExporting(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const json = await apiJson('/api/locations/history')
      setHistory(json?.history ?? [])
    } catch (e) {
      console.warn('History load failed', e?.message ?? e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsub = navigation.addListener('focus', load)
    load()
    return unsub
  }, [navigation, load])

  return (
    <View style={styles.screen}>
      <BrandHeader
        title={t('history')}
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
            <Pressable
              onPress={() => {
                if (isBiz === false) {
                  Alert.alert('Business Pro', t('exportPlanOnly'), [
                    { text: t('notNow'), style: 'cancel' },
                    { text: t('upgrade'), onPress: () => navigation.navigate('Subscription') },
                  ])
                } else {
                  setShowExport(true)
                }
              }}
              disabled={exporting}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={isBiz === false ? t('exportLockedA11y') : t('export')}
              accessibilityState={{ disabled: exporting, busy: exporting }}
            >
              {exporting ? <ActivityIndicator color={colors.text} /> : (
                <Text style={{ color: isBiz === false ? colors.textFaint : colors.text, fontSize: 15, fontWeight: '700' }}>
                  {isBiz === false ? `🔒 ${t('export')}` : t('export')}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setLayout(l => (l === 'grid' ? 'list' : 'grid'))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={layout === 'grid' ? tsoc('showAsList') : tsoc('showAsGrid')}
            >
              <Text style={{ color: colors.text, fontSize: 20 }}>{layout === 'grid' ? '☰' : '▦'}</Text>
            </Pressable>
          </View>
        }
      />
      <TagFilterBar active={activeTag} onChange={setActiveTag} />
      <FlatList
        key={layout}
        data={activeTag ? history.filter((u) => u.tags?.includes(activeTag)) : history}
        keyExtractor={(u) => u.id}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={layout === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <View style={layout === 'grid' ? styles.gridItem : undefined}>
            <UserCard
              user={item}
              layout={layout}
              followStatus={statuses[item.id]}
              onFollowChange={setStatus}
              onPress={() => openProfile(navigation, item.id)}
            />
            <Text style={[styles.lastSeen, layout === 'list' && styles.lastSeenList]}>
              {t('lastSeen', { time: formatRelative(item.last_seen_at, tsoc) })}
              {item.encounter_count > 1 ? ` · ${item.encounter_count}×` : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !loading && (
            <Text style={styles.empty}>
              {t('emptyHistory')}
            </Text>
          )
        }
      />
      <ExportSheet visible={showExport} busy={exporting} onClose={() => setShowExport(false)} onExport={runExport} />
    </View>
  )
}

// tsoc: useT(i18n/strings/social).
function formatRelative(iso, tsoc) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return tsoc('justNow')
  if (mins < 60) return tsoc('minsAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return tsoc('hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return tsoc('daysAgo', { n: days })
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  list: { padding: 16, paddingBottom: 20, gap: 14 },
  gridRow: { gap: 14 },
  gridItem: { flex: 1 },
  lastSeen: { ...type.caption, marginTop: 6, textAlign: 'center' },
  lastSeenList: { paddingLeft: 80, marginTop: -4, paddingBottom: 10, textAlign: 'left' },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
