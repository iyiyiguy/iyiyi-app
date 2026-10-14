import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import MasonryGrid from '../components/MasonryGrid'
import ContentViewer from '../components/ContentViewer'
import { colors, type } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'

// Labels are keys in i18n/strings/people.
const TABS = [
  { key: 'saved', label: 'saved' },
  { key: 'liked', label: 'liked' },
]

export default function SavedContentScreen({ navigation }) {
  const t = useT(strings)
  const [tab, setTab] = useState('saved')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [viewer, setViewer] = useState({ open: false, index: 0 })

  const load = useCallback(async (which) => {
    setLoading(true)
    try {
      const data = await apiJson(`/api/content/${which}`)
      setItems(data.items ?? [])
    } catch (e) {
      console.warn('Saved content load failed', e)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load(tab) }, [tab, load]))

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('savedLiked')} onBack={() => navigation.goBack()} />
      <GlassPanel radius={999} style={styles.tabs}>
        {TABS.map((tb) => (
          <Pressable
            key={tb.key}
            onPress={() => setTab(tb.key)}
            style={[styles.tab, tab === tb.key && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb.key }}
          >
            <Text style={[styles.tabText, tab === tb.key && styles.tabTextActive]}>{t(tb.label)}</Text>
          </Pressable>
        ))}
      </GlassPanel>
      <ScrollView>
        {items.length > 0 ? (
          <MasonryGrid items={items} showOwner onOpen={(i) => setViewer({ open: true, index: i })} />
        ) : (
          <Text style={styles.empty}>
            {loading ? t('loading') : tab === 'saved' ? t('emptySaved') : t('emptyLiked')}
          </Text>
        )}
      </ScrollView>
      <ContentViewer
        visible={viewer.open}
        items={items}
        startIndex={viewer.index}
        onClose={() => {
          setViewer({ open: false, index: 0 })
          load(tab)
        }}
        onOpenProfile={(id) => {
          setViewer({ open: false, index: 0 })
          openProfile(navigation, id)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  tabs: { flexDirection: 'row', margin: 16, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: colors.magenta },
  tabText: { color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.onBrand },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
