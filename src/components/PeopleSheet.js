import { useState } from 'react'
import { View, Text, Image, Modal, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GlassPanel from './GlassPanel'
import FollowEverywhereButton from './FollowEverywhereButton'
import { formatDistance, useFollowEverywhere } from './FollowEverywhereSheet'
import { colors, font, radii, type } from '../theme'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { avatarSource } from '../lib/avatarSource'
import MyQRSheet from './MyQRSheet'
import { useT } from '../i18n'
import feStrings from '../i18n/strings/followEverywhere'
import strings from '../i18n/strings/social'

// Bottom sheet listing people ({ id, username, avatar_url, distance_m? }): tap a row to open
// their profile (onOpenProfile(id)), or "Follow ×N" to follow on iYiYi and step through their
// other platforms right here - this is the moment you're standing next to each other.
// onShareMine (optional) adds "Show my QR code" / "Share my iYiYi link" for people without the app.
export default function PeopleSheet({
  visible, onClose, title, subtitle, people = [], onOpenProfile, emptyText, onShareMine, shareLabel, qrLabel,
}) {
  const tf = useT(feStrings)
  const t = useT(strings)
  const [qrOpen, setQrOpen] = useState(false)
  const list = people.filter((p) => p?.id)
  const { statuses, setStatus } = useFollowStatuses(visible ? list : [], 'id')
  const fe = useFollowEverywhere({ onStatus: setStatus, people: list, getStatus: (id) => statuses[id] })
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={tf('close')} />
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassPanel radius={radii.lg} strong animateIn={false}>
          <View style={styles.inner}>
            <View style={styles.head}>
              <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={tf('close')}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
            <ScrollView style={{ maxHeight: 380, marginTop: 8 }}>
              {list.length === 0 ? <Text style={[type.caption, { marginVertical: 12 }]}>{emptyText ?? t('noOneHere')}</Text> : null}
              {list.map((p) => {
                const dist = formatDistance(p)
                return (
                  <View key={p.id} style={styles.row}>
                    <Pressable
                      onPress={() => onOpenProfile?.(p.id)}
                      style={styles.who}
                      accessibilityRole="button"
                      accessibilityLabel={[p.username ?? t('iyiyiUser'), dist].filter(Boolean).join(', ')}
                    >
                      <Image source={avatarSource(p?.avatar_url)} style={styles.avatar} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={type.body} numberOfLines={1}>{p.username ?? t('iyiyiUser')}</Text>
                        {dist ? <Text style={type.caption} numberOfLines={1}>{dist}</Text> : null}
                      </View>
                    </Pressable>
                    <FollowEverywhereButton user={p} status={statuses[p.id]} onStatus={setStatus} onOpen={fe.open} />
                  </View>
                )
              })}
            </ScrollView>
            {onShareMine ? (
              <View style={styles.shareRow}>
                {qrLabel ? (
                  <Pressable
                    onPress={() => setQrOpen(true)}
                    style={({ pressed }) => [styles.share, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={qrLabel}
                  >
                    <Ionicons name="qr-code-outline" size={18} color={colors.text} />
                    <Text style={styles.shareText} numberOfLines={1}>{qrLabel}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={onShareMine}
                  style={({ pressed }) => [styles.share, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={shareLabel}
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text style={styles.shareText} numberOfLines={1}>{shareLabel}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </GlassPanel>
      </View>
      {/* Rendered inside this Modal so iOS presents it on top of the sheet. */}
      {fe.element}
      <MyQRSheet visible={qrOpen} onClose={() => setQrOpen(false)} />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: 34 },
  inner: { padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.inkSurfaceRaised },
  shareRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  share: {
    flex: 1, minHeight: 46, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  shareText: { fontSize: 14, ...font.semibold, color: colors.text, flexShrink: 1 },
})
