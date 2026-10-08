import { useEffect, useState } from 'react'
import { View, Text, Image, FlatList, Pressable, StyleSheet, Alert } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { openProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'

const TITLES = { followers: 'Followers', following: 'Following', requests: 'Follow Requests' }

export default function FollowListScreen({ route, navigation }) {
  const { userId, mode } = route.params // mode: 'followers' | 'following' | 'requests'
  const [list, setList] = useState([])

  const load = async () => {
    if (mode === 'requests') {
      const json = await apiJson('/api/profiles/follow-requests')
      setList(json?.requests ?? [])
      return
    }
    const json = await apiJson(`/api/profiles/${userId}/${mode}`)
    setList(json?.[mode] ?? [])
  }

  useEffect(() => {
    load().catch((e) => console.warn('Follow list load failed', e?.message ?? e))
  }, [userId, mode])

  const respond = async (id, action) => {
    const before = list
    setList((l) => l.filter((item) => item.id !== id))
    try {
      await apiJson(`/api/profiles/follow-requests/${id}/${action}`, { method: 'POST' })
    } catch (e) {
      setList(before)
      Alert.alert('Something went wrong', e?.message ?? 'Please try again.')
    }
  }
  const accept = (id) => respond(id, 'accept')
  const decline = (id) => respond(id, 'decline')

  return (
    <View style={styles.screen}>
      <BrandHeader title={TITLES[mode]} onBack={() => navigation.goBack()} />
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable style={styles.rowInfo} onPress={() => openProfile(navigation, item.id)}>
              <Image source={avatarSource(item.avatar_url)} style={styles.avatar} />
              <Text style={type.body}>{item.username}</Text>
            </Pressable>
            {mode === 'requests' && (
              <View style={styles.requestActions}>
                <Pressable onPress={() => accept(item.id)} style={styles.acceptBtn}>
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
                <Pressable onPress={() => decline(item.id)}>
                  <GlassPanel radius={radii.pill}>
                    <View style={styles.declineBtn}><Text style={styles.declineText}>Decline</Text></View>
                  </GlassPanel>
                </Pressable>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>{mode === 'requests' ? 'No pending follow requests.' : 'Nobody here yet.'}</Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  rowInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 40 },
  requestActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.magenta },
  acceptText: { color: colors.onBrand, fontWeight: '700', fontSize: 13 },
  declineBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  declineText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
})
