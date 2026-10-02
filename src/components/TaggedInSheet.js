import { useEffect, useState } from 'react'
import { View, Text, Image, Modal, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'

// One button on a post opens this: who was picked ("Tagged in") and who else was just
// nearby when it was shot ("Nearby"), each a tappable list into their profile.
export default function TaggedInSheet({ mediaId, visible, onClose, onOpenProfile }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ tagged: [], nearby: [] })

  useEffect(() => {
    if (!visible || !mediaId) return
    setLoading(true)
    apiJson(`/api/content/${mediaId}/tags`)
      .then((d) => setData({ tagged: d?.tagged ?? [], nearby: d?.nearby ?? [] }))
      .catch(() => setData({ tagged: [], nearby: [] }))
      .finally(() => setLoading(false))
  }, [visible, mediaId])

  const Section = ({ title, people }) =>
    people.length ? (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.sectionTitle}>{title} ({people.length})</Text>
        {people.map((p) => (
          <Pressable key={p.id} style={styles.row} onPress={() => onOpenProfile?.(p.id)}>
            <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
            <Text style={type.body}>{p.username ?? 'iYiYi user'}</Text>
          </Pressable>
        ))}
      </View>
    ) : null

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={type.title}>People in this post</Text>
        {loading ? (
          <ActivityIndicator color={colors.magenta} style={{ marginTop: 20 }} />
        ) : !data.tagged.length && !data.nearby.length ? (
          <Text style={[type.caption, { marginTop: 14 }]}>Nobody tagged in this post.</Text>
        ) : (
          <FlatList
            data={[1]}
            keyExtractor={() => 'x'}
            renderItem={() => (
              <>
                <Section title="Tagged in" people={data.tagged} />
                <Section title="Nearby" people={data.nearby} />
              </>
            )}
            style={{ marginTop: 10, maxHeight: 360 }}
          />
        )}
        <Pressable onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.ink, padding: 22, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.inkSurfaceRaised },
  close: { alignSelf: 'center', marginTop: 16, paddingVertical: 8, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.magenta },
  closeText: { color: colors.onBrand, fontWeight: '700' },
})
