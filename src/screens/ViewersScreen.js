import { useCallback, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import BrandHeader from '../components/BrandHeader'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'

export default function ViewersScreen({ navigation }) {
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
      <BrandHeader title="Who viewed you" onBack={() => navigation.goBack()} />
      <FlatList
        data={viewers}
        keyExtractor={(v) => v.id}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openProfile(navigation, item.id)}>
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{item.username}</Text>
              <Text style={type.caption}>
                {item.view_count > 1 ? `Viewed ${item.view_count} times · ` : 'Viewed · '}
                {new Date(item.last_viewed_at).toLocaleDateString()}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? 'Loading…' : "Nobody has viewed your profile yet. People who turn on private viewing won't show up here."}
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
