import { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import GlassPanel from './GlassPanel'

// Two separate categories on My Profile: "Tagged in" (the photographer picked you) and
// "Nearby" (shot within 150ft of you). Each opens the same screen on its own tab.
export default function TagLinks({ navigation, userId, title }) {
  const [counts, setCounts] = useState({ tagged: null, nearby: null })

  useFocusEffect(
    useCallback(() => {
      let live = true
      ;['tagged', 'nearby'].forEach((kind) => {
        apiJson(`/api/profiles/${userId ? `${userId}/tags` : 'me/tags'}?kind=${kind}`)
          .then((d) => live && setCounts((c) => ({ ...c, [kind]: (d.items ?? []).length })))
          .catch(() => {})
      })
      return () => { live = false }
    }, [userId]),
  )

  const Row = ({ kind, label, hint }) => (
    <Pressable style={styles.row} onPress={() => navigation.navigate('Tagged', { tab: kind, userId, title })}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        <Text style={type.caption}>{hint}</Text>
      </View>
      {counts[kind] !== null && <Text style={styles.count}>{counts[kind]}</Text>}
      <Text style={styles.chev}>›</Text>
    </Pressable>
  )

  return (
    <GlassPanel radius={radii.md} style={styles.wrap}>
      <Row kind="tagged" label="Tagged in" hint={userId ? "Posts where someone tagged them" : "Posts where someone tagged you"} />
      <Row kind="nearby" label="Nearby" hint={userId ? "Posts shot within 150ft of them" : "Posts shot within 150ft of you"} />
    </GlassPanel>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  count: { color: colors.magenta, fontWeight: '800', fontSize: 16 },
  chev: { color: colors.textFaint, fontSize: 22 },
})
