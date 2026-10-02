import { useState } from 'react'
import { Text, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, radii } from '../theme'
import { post, del } from '../lib/api'
import Bounce from './Bounce'

// status: 'accepted' | 'pending' | null/undefined. onChange(userId, newStatus).
export default function FollowButton({ userId, status, onChange, style, overPhoto }) {
  const [busy, setBusy] = useState(false)
  const active = status === 'accepted' || status === 'pending'
  const label = status === 'accepted' ? 'Following' : status === 'pending' ? 'Requested' : 'Follow'

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (active) {
        await del(`/api/profiles/follow/${userId}`)
        onChange?.(userId, null)
      } else {
        const res = await post(`/api/profiles/follow/${userId}`)
        onChange?.(userId, res.status ?? 'accepted')
      }
    } catch {
      // leave the button as it was; the next list refresh will show the true state
    } finally {
      setBusy(false)
    }
  }

  return (
    <Bounce onPress={toggle} disabled={busy} hitSlop={6} style={[styles.button, active && styles.buttonActive, active && overPhoto && styles.buttonOverPhoto, style]}>
      {busy ? (
        <ActivityIndicator size="small" color={active ? colors.magenta : colors.onBrand} />
      ) : (
        <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
      )}
    </Bounce>
  )
}

const styles = StyleSheet.create({
  button: {
    minWidth: 84, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: radii.pill, backgroundColor: colors.magenta, borderWidth: 1, borderColor: colors.magenta,
  },
  buttonActive: { backgroundColor: 'transparent' },
  buttonOverPhoto: { backgroundColor: 'rgba(13,7,16,0.6)' },
  text: { color: colors.onBrand, fontWeight: '700', fontSize: 12 },
  textActive: { color: colors.magenta },
})
