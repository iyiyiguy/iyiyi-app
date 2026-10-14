import { useCallback, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import UserCard from '../components/UserCard'
import { colors, type } from '../theme'
import { apiJson } from '../lib/api'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { openProfile } from '../lib/profileNav'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'

// Labels are keys in i18n/strings/people.
const SORTS = [
  { key: 'views', label: 'mostViewed' },
  { key: 'followers', label: 'mostFollowed' },
]

export default function TopProfilesScreen({ navigation }) {
  const t = useT(strings)
  const [sort, setSort] = useState('views')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const { statuses, setStatus } = useFollowStatuses(users)

  const load = useCallback(async (by) => {
    setLoading(true)
    try {
      const data = await apiJson(`/api/profiles/discover/top?by=${by}`)
      setUsers(data.users ?? [])
    } catch (e) {
      console.warn('Top profiles load failed', e)
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load(sort) }, [sort, load]))

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('topProfiles')} onBack={() => navigation.goBack()} />
      <GlassPanel radius={999} style={styles.tabs}>
        {SORTS.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setSort(s.key)}
            style={[styles.tab, sort === s.key && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: sort === s.key }}
          >
            <Text style={[styles.tabText, sort === s.key && styles.tabTextActive]}>{t(s.label)}</Text>
          </Pressable>
        ))}
      </GlassPanel>
      <FlatList
        data={users}
        keyExtractor={(u) => u.user_id}
        refreshing={loading}
        onRefresh={() => load(sort)}
        renderItem={({ item, index }) => (
          <UserCard
            user={item}
            layout="list"
            rank={index + 1}
            followStatus={statuses[item.user_id]}
            onFollowChange={setStatus}
            onPress={() => openProfile(navigation, item.user_id)}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? t('loading') : t('noRanked')}</Text>}
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
