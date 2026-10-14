import { useEffect, useState } from 'react'
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, font, radii, type } from '../theme'
import QRCode from './business/QRCode'
import { fetchMyProfileCard } from '../lib/myContent'
import { profileShareUrl, shareProfileLink } from '../lib/shareLinks'
import { useT } from '../i18n'
import strings from '../i18n/strings/here'

// "Show my QR code": your profile link as a scannable code, for the person in front of you
// who doesn't have iYiYi yet (any phone camera opens app.iyiyi.xyz/u/<you>).
export default function MyQRSheet({ visible, onClose }) {
  const t = useT(strings)
  const [me, setMe] = useState(null)
  useEffect(() => {
    if (!visible || me) return undefined
    let alive = true
    fetchMyProfileCard().then((p) => { if (alive) setMe(p) })
    return () => { alive = false }
  }, [visible, me])
  const url = me?.username ? `${profileShareUrl(me.username)}?src=qr` : null
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>{t('qrTitle')}</Text>
          <View style={styles.qr}>
            {url ? <QRCode value={url} size={220} accessibilityLabel={`${t('qrTitle')}: ${url}`} /> : <ActivityIndicator color="#111" />}
          </View>
          {me?.username ? <Text style={styles.handle}>@{me.username}</Text> : null}
          <Text style={styles.hint}>{t('qrHint')}</Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => { if (me?.username) shareProfileLink(me.username, t('shareMessage')) }}
              style={({ pressed }) => [styles.btn, styles.primary, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={t('shareLink')}
            >
              <Ionicons name="share-outline" size={17} color={colors.onBrand} />
              <Text style={[styles.btnText, { color: colors.onBrand }]} numberOfLines={1}>{t('shareLink')}</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('close')}>
            <Text style={styles.btnText}>{t('close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: '100%', maxWidth: 360, alignItems: 'center', gap: 10, padding: 20, borderRadius: radii.lg,
    backgroundColor: colors.inkSurfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  title: { ...type.title, textAlign: 'center' },
  qr: { width: 236, height: 236, padding: 8, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  handle: { ...type.headline },
  hint: { ...type.caption, textAlign: 'center' },
  row: { alignSelf: 'stretch', marginTop: 4 },
  btn: {
    alignSelf: 'stretch', minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline,
  },
  primary: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  btnText: { fontSize: 15, ...font.semibold, color: colors.text },
})
