import { useCallback, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import MasonryGrid from '../components/MasonryGrid'
import ContentViewer from '../components/ContentViewer'
import { colors } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'

const TABS = [
  { key: 'tagged', label: 'Tagged in' },
  { key: 'nearby', label: 'Nearby' },
]

// Camera posts other people took while you were around. "Tagged in" is where the
// photographer picked you; "Nearby" is everything shot within 150ft of you.
export default function TaggedScreen({ navigation, route }) {
  const { userId, title } = route?.params ?? {}
  const [tab, setTab] = useState(route?.params?.tab ?? 'tagged')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [viewer, setViewer] = useState({ open: false, index: 0 })

  const load = useCallback(async (which) => {
    setLoading(true)
    try {
      const data = await apiJson(`/api/profiles/${userId ? `${userId}/tags` : 'me/tags'}?kind=${which}`)
      setItems((data.items ?? []).map((i) => ({ ...i, id: i.media_id })))
    } catch (e) {
      console.warn('Tagged load failed', e)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useFocusEffect(useCallback(() => { load(tab) }, [tab, load]))

  return (
    <View style={styles.screen}>
      <BrandHeader title={title ? `${title}'s tags` : 'Tagged & nearby'} onBack={() => navigation.goBack()} />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView>
        {items.length > 0 ? (
          <MasonryGrid items={items} showOwner onOpen={(i) => setViewer({ open: true, index: i })} />
        ) : (
          <Text style={styles.empty}>
            {loading
              ? 'Loading…'
              : tab === 'tagged'
                ? "Photos and videos where someone tagged you will show up here."
                : "Photos and videos shot within 150ft of you will show up here."}
          </Text>
        )}
      </ScrollView>
      <ContentViewer
        visible={viewer.open}
        items={items}
        startIndex={viewer.index}
        onClose={() => { setViewer({ open: false, index: 0 }); load(tab) }}
        onOpenProfile={(id) => { setViewer({ open: false, index: 0 }); openProfile(navigation, id) }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  tabs: {
    flexDirection: 'row', margin: 16, backgroundColor: colors.inkSurface, borderRadius: 999,
    padding: 4, borderWidth: 1, borderColor: colors.hairline,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: colors.magenta },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: colors.onBrand },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
