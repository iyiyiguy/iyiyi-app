import { useEffect, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, StyleSheet, Alert } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import { colors, type } from '../theme'
import { apiJson } from '../lib/api'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/people'

export default function BlockedUsersScreen({ navigation }) {
  const t = useT(strings)
  const [blocked, setBlocked] = useState([])

  const load = async () => {
    const json = await apiJson('/api/profiles/blocked/list')
    setBlocked(json?.blocked ?? [])
  }

  useEffect(() => {
    load().catch((e) => Alert.alert(t('blockedLoadFailed'), e?.message ?? t('tryAgain')))
  }, [])

  const unblock = async (id) => {
    try {
      await apiJson(`/api/profiles/block/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      Alert.alert(t('unblockFailed'), e?.message ?? t('tryAgain'))
    }
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('blockedUsers')} onBack={() => navigation.goBack()} />
      <FlatList
        data={blocked}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 20 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Image source={avatarSource(item?.avatar_url)} style={styles.avatar} />
            <Text style={[type.body, { flex: 1 }]}>{item.username}</Text>
            <Pressable
              onPress={() => unblock(item.id)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('unblockA11y', { name: item.username })}
            >
              <Text style={{ color: colors.magenta }}>{t('unblock')}</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40 }}>{t('noBlocked')}</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  avatar: { width: 40, height: 40, borderRadius: 20 },
})
