import { useEffect, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, StyleSheet, Alert } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import { colors, type } from '../theme'
import { apiJson } from '../lib/api'

export default function BlockedUsersScreen({ navigation }) {
  const [blocked, setBlocked] = useState([])

  const load = async () => {
    const json = await apiJson('/api/profiles/blocked/list')
    setBlocked(json?.blocked ?? [])
  }

  useEffect(() => {
    load().catch((e) => Alert.alert("Couldn't load blocked users", e?.message ?? 'Please try again.'))
  }, [])

  const unblock = async (id) => {
    try {
      await apiJson(`/api/profiles/block/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      Alert.alert("Couldn't unblock", e?.message ?? 'Please try again.')
    }
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title="Blocked Users" onBack={() => navigation.goBack()} />
      <FlatList
        data={blocked}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 20 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            <Text style={[type.body, { flex: 1 }]}>{item.username}</Text>
            <Pressable onPress={() => unblock(item.id)}>
              <Text style={{ color: colors.magenta }}>Unblock</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40 }}>No blocked users.</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  avatar: { width: 40, height: 40, borderRadius: 20 },
})
