import { useCallback, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'

export default function ViewersScreen({ navigation }) {
  const t = useT(strings)
  const [viewers, setViewers] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson('/api/profiles/me/viewers')
      setViewers(data.viewers ?? [])
    } catch (e) {
      console.warn('Viewers load failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('whoViewed')} onBack={() => navigation.goBack()} />
      <FlatList
        data={viewers}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => openProfile(navigation, item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.username}, ${item.view_count > 1 ? t('viewedTimes', { n: item.view_count }) : t('viewed')}`}
          >
            <Image source={avatarSource(item?.avatar_url)} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{item.username}</Text>
              <Text style={type.caption}>
                {item.view_count > 1 ? t('viewedTimes', { n: item.view_count }) : t('viewed')}{' · '}
                {new Date(item.last_viewed_at).toLocaleDateString()}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? t('loading') : t('noViewers')}
          </Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  avatar: { width: 48, height: 48, borderRadius: radii.pill, backgroundColor: colors.inkSurfaceRaised },
  empty: { ...type.caption, textAlign: 'center', marginTop: 60, paddingHorizontal: 40 },
})
