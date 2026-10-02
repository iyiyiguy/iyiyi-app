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

const TABS = [
  { key: 'saved', label: 'Saved' },
  { key: 'liked', label: 'Liked' },
]

export default function SavedContentScreen({ navigation }) {
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
      <BrandHeader title="Saved & Liked" onBack={() => navigation.goBack()} />
      <GlassPanel radius={999} style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </GlassPanel>
      <ScrollView>
        {items.length > 0 ? (
          <MasonryGrid items={items} showOwner onOpen={(i) => setViewer({ open: true, index: i })} />
        ) : (
          <Text style={styles.empty}>
            {loading ? 'Loading…' : tab === 'saved' ? 'Content you save will show up here.' : 'Content you like will show up here.'}
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
