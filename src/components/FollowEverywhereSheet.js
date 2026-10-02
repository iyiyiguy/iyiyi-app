import { useEffect, useState } from 'react'
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native'
import { colors, radii, type } from '../theme'
import { PLATFORM_LABELS, socialUrl, openLink } from '../lib/socialLinks'
import SocialIcon from './SocialIcon'
import { apiJson, post, del } from '../lib/api'

// One place to follow someone on every platform they've linked. Instagram, TikTok,
// Snapchat and most others don't let apps follow on your behalf, so each row opens that
// profile and you tap the check once you've followed. Each check is saved to your account
// (so it shows under "Profiles followed", and they can see you followed them there via
// iYiYi), and you can come back and finish later.
export default function FollowEverywhereSheet({
  visible, onClose, profile, iyiyiStatus, onToggleIyiyi,
}) {
  const [done, setDone] = useState({}) // platform -> true
  const [opened, setOpened] = useState({})

  const rows = (profile?.social_links ?? [])
    .filter((l) => l?.value && PLATFORM_LABELS[l.platform])
    .map((l) => ({ key: `${l.platform}:${l.value}`, platform: l.platform, value: l.value, url: socialUrl(l.platform, l.value) }))
    .filter((r) => r.url)

  useEffect(() => {
    if (!visible || !profile?.id) return
    setOpened({})
    apiJson(`/api/platform-follows/status/${profile.id}`)
      .then((d) => setDone(Object.fromEntries((d.platforms ?? []).map((p) => [p, true]))))
      .catch(() => setDone({}))
  }, [visible, profile?.id])

  const open = (row) => {
    setOpened((prev) => ({ ...prev, [row.key]: true }))
    openLink(row.url)
  }

  const toggleDone = async (row) => {
    const on = !done[row.platform]
    setDone((prev) => ({ ...prev, [row.platform]: on }))
    try {
      if (on) await post('/api/platform-follows', { followed_id: profile.id, platform: row.platform })
      else await del(`/api/platform-follows/${profile.id}/${row.platform}`)
    } catch {
      setDone((prev) => ({ ...prev, [row.platform]: !on }))
    }
  }

  const next = rows.find((r) => !done[r.platform])
  const doneCount = rows.filter((r) => done[r.platform]).length
  const iyiyiFollowing = iyiyiStatus === 'accepted' || iyiyiStatus === 'pending'

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Follow {profile?.username} everywhere</Text>
            <Text style={type.caption}>
              {rows.length === 0 ? 'No other accounts linked yet.' : `${doneCount} of ${rows.length} done`}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.row}>
            <View style={styles.iconWrap}><Text style={styles.iyiyiMark}>iY</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>iYiYi</Text>
              <Text style={type.caption}>{iyiyiStatus === 'pending' ? 'Request sent' : iyiyiStatus === 'accepted' ? 'Following' : 'Not following yet'}</Text>
            </View>
            <Pressable onPress={onToggleIyiyi} style={[styles.action, iyiyiFollowing && styles.actionDone]}>
              <Text style={[styles.actionText, iyiyiFollowing && styles.actionTextDone]}>
                {iyiyiStatus === 'accepted' ? 'Following' : iyiyiStatus === 'pending' ? 'Requested' : 'Follow'}
              </Text>
            </Pressable>
          </View>

          {next ? (
            <Pressable onPress={() => open(next)} style={styles.nextButton}>
              <Text style={styles.nextText}>Open next: {PLATFORM_LABELS[next.platform]}</Text>
            </Pressable>
          ) : rows.length > 0 ? (
            <Text style={styles.allDone}>All done. You're following them everywhere.</Text>
          ) : null}

          {rows.map((r) => {
            const isDone = !!done[r.platform]
            return (
              <View key={r.key} style={styles.row}>
                <View style={styles.iconWrap}><SocialIcon platform={r.platform} size={22} color={colors.text} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{PLATFORM_LABELS[r.platform]}</Text>
                  <Text style={type.caption} numberOfLines={1}>
                    {opened[r.key] && !isDone ? 'Followed them? Tap the check.' : r.value}
                  </Text>
                </View>
                <Pressable onPress={() => open(r)} style={styles.action}>
                  <Text style={styles.actionText}>Open</Text>
                </Pressable>
                <Pressable onPress={() => toggleDone(r)} hitSlop={8} style={[styles.check, isDone && styles.checkOn, opened[r.key] && !isDone && styles.checkPrompt]}>
                  {isDone ? <Text style={styles.checkMark}>✓</Text> : null}
                </Pressable>
              </View>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 24, gap: 12 },
  close: { color: colors.magenta, fontWeight: '700', fontSize: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  iconWrap: { width: 32, alignItems: 'center' },
  iyiyiMark: { color: colors.magenta, fontWeight: '800', fontSize: 18 },
  action: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill,
    backgroundColor: colors.magenta, borderWidth: 1, borderColor: colors.magenta,
  },
  actionDone: { backgroundColor: 'transparent' },
  actionText: { color: colors.onBrand, fontWeight: '700', fontSize: 12 },
  actionTextDone: { color: colors.magenta },
  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.textFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkPrompt: { borderColor: colors.gold },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 15 },
  nextButton: {
    margin: 20, paddingVertical: 14, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.magenta,
  },
  nextText: { color: colors.onBrand, fontWeight: '700', fontSize: 15 },
  allDone: { ...type.caption, textAlign: 'center', margin: 20, color: colors.success },
})
