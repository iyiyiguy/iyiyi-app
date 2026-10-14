import { useCallback, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import MasonryGrid from '../components/MasonryGrid'
import ContentViewer from '../components/ContentViewer'
import { colors } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'

// Labels are keys in i18n/strings/people.
const TABS = [
  { key: 'tagged', label: 'taggedIn' },
  { key: 'nearby', label: 'nearby' },
]

// Camera posts other people took while you were around. "Tagged in" is where the
// photographer picked you; "Nearby" is everything shot within 150ft of you.
export default function TaggedScreen({ navigation, route }) {
  const t = useT(strings)
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
      <BrandHeader title={title ? t('nameTags', { name: title }) : t('taggedNearby')} onBack={() => navigation.goBack()} />
      <View style={styles.tabs}>
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
      </View>
      <ScrollView>
        {items.length > 0 ? (
          <MasonryGrid items={items} showOwner onOpen={(i) => setViewer({ open: true, index: i })} />
        ) : (
          <Text style={styles.empty}>
            {loading
              ? t('loading')
              : tab === 'tagged'
                ? t('emptyTagged')
                : t('emptyNearby')}
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
