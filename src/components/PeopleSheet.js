import { View, Text, Image, Modal, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import FollowButton from './FollowButton'
import { colors, radii, type } from '../theme'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { avatarSource } from '../lib/avatarSource'

// Bottom sheet listing people ({ id, username, avatar_url }): tap a row to open their
// profile (onOpenProfile(id)), or follow them right from the list.
export default function PeopleSheet({ visible, onClose, title, subtitle, people = [], onOpenProfile, emptyText = 'No one here yet.' }) {
  const list = people.filter((p) => p?.id)
  const { statuses, setStatus } = useFollowStatuses(visible ? list : [], 'id')
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false}>
          <View style={styles.inner}>
            <View style={styles.head}>
              <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
            <ScrollView style={{ maxHeight: 380, marginTop: 8 }}>
              {list.length === 0 ? <Text style={[type.caption, { marginVertical: 12 }]}>{emptyText}</Text> : null}
              {list.map((p) => (
                <View key={p.id} style={styles.row}>
                  <Pressable onPress={() => onOpenProfile?.(p.id)} style={styles.who} accessibilityRole="button">
                    {<Image source={avatarSource(p?.avatar_url)} style={styles.avatar} />}
                    <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{p.username ?? 'iYiYi user'}</Text>
                  </Pressable>
                  <FollowButton userId={p.id} status={statuses[p.id]} onChange={setStatus} />
                </View>
              ))}
            </ScrollView>
          </View>
        </GlassPanel>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: 34 },
  inner: { padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.inkSurfaceRaised },
})
