import { useEffect, useState } from 'react'
import { Text, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, radii } from '../theme'
import { post, del } from '../lib/api'
import { maybeOfferPushAfterFollow } from '../lib/pushPrompt'
import Bounce from './Bounce'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// status: 'accepted' | 'pending' | null/undefined. onChange(userId, newStatus).
// name (optional) is read out by screen readers: "Follow {name}" / "Following {name}".
export default function FollowButton({ userId, status: statusProp, onChange, style, overPhoto, name }) {
  const t = useT(strings)
  const [busy, setBusy] = useState(false)
  // Flip to "Following" immediately even if the parent doesn't pass the new status back down.
  const [localStatus, setLocalStatus] = useState(undefined)
  useEffect(() => { setLocalStatus(undefined) }, [statusProp])
  const status = localStatus !== undefined ? localStatus : statusProp
  const active = status === 'accepted' || status === 'pending'
  const label = status === 'accepted' ? t('following') : status === 'pending' ? t('requested') : t('follow')
  const a11yLabel = name
    ? t(status === 'accepted' ? 'followingNameA11y' : status === 'pending' ? 'requestedNameA11y' : 'followNameA11y', { name })
    : label

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (active) {
        await del(`/api/profiles/follow/${userId}`)
        setLocalStatus(null)
        onChange?.(userId, null)
      } else {
        const res = await post(`/api/profiles/follow/${userId}`)
        setLocalStatus(res?.status ?? 'accepted')
        onChange?.(userId, res?.status ?? 'accepted')
        maybeOfferPushAfterFollow()
      }
    } catch {
      // leave the button as it was; the next list refresh will show the true state
    } finally {
      setBusy(false)
    }
  }

  return (
    <Bounce
      onPress={toggle}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={active ? t('unfollowHint') : undefined}
      accessibilityState={{ busy, selected: active }}
      style={[styles.button, active && styles.buttonActive, active && overPhoto && styles.buttonOverPhoto, style]}>
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
