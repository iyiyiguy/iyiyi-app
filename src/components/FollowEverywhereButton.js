import { useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, font, radii } from '../theme'
import Bounce from './Bounce'
import SocialIcon from './SocialIcon'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import { maybeOfferPushAfterFollow } from '../lib/pushPrompt'
import { followOnIyiyi, isActiveStatus, personId, platformsOf } from './FollowEverywhereSheet'
import { useT } from '../i18n'
import strings from '../i18n/strings/followEverywhere'

// "Follow ×N" on every person card. One tap follows on iYiYi straight away and opens Follow
// Everywhere for the person's other platforms (onOpen(user, { status, justFollowed })). When
// you already follow them it reads "Following" and opens the sheet to finish the rest.
// N counts iYiYi plus their linked platforms; when the card's data doesn't say which
// platforms they're on, it reads "Follow" and the sheet looks them up.
//   size: 'sm' (grid cards, rows) | 'md' (map card, sheets)
export default function FollowEverywhereButton({ user, status, onStatus, onOpen, size = 'sm', style, showIcons = true }) {
  const t = useT(strings)
  const [busy, setBusy] = useState(false)
  const id = personId(user)
  const platforms = platformsOf(user)
  const active = isActiveStatus(status)
  const n = platforms ? platforms.length + 1 : null
  const name = user?.username ?? ''
  const label = status === 'pending'
    ? t('requested')
    : active ? t('following') : n && n > 1 ? t('followN', { n }) : t('follow')

  const press = async () => {
    if (!id || busy) return
    Haptics.selectionAsync().catch(() => {})
    if (active) {
      onOpen?.(user, { status })
      return
    }
    setBusy(true)
    onStatus?.(id, 'accepted') // optimistic
    try {
      const s = await followOnIyiyi(id)
      onStatus?.(id, s)
      if (platforms && platforms.length === 0) maybeOfferPushAfterFollow()
      else onOpen?.(user, { status: s, justFollowed: true })
    } catch (e) {
      onStatus?.(id, status ?? null)
      Alert.alert(t('couldntFollow'), e?.message ?? undefined)
    } finally {
      setBusy(false)
    }
  }

  const icons = showIcons && platforms && platforms.length && !active ? platforms.slice(0, 3) : []
  const small = size === 'sm'
  return (
    <Bounce
      onPress={press}
      disabled={busy}
      hitSlop={6}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityState={{ busy, selected: active }}
      accessibilityLabel={active ? t('followingBtnA11y', { name }) : t('followBtnA11y', { name })}
      accessibilityHint={platforms && platforms.length ? t('onPlatforms', { list: platforms.map((p) => PLATFORM_LABELS[p]).join(', ') }) : undefined}
      style={[styles.button, small ? styles.sm : styles.md, active && styles.active, style]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={active ? colors.accent : colors.onBrand} />
      ) : (
        <View style={styles.inner}>
          {icons.length ? (
            <View style={styles.icons}>
              {icons.map((p, i) => (
                <View key={p} style={[styles.iconDot, small && styles.iconDotSm, i > 0 && { marginLeft: small ? -5 : -6 }]}>
                  <SocialIcon platform={p} size={small ? 9 : 11} color="#fff" />
                </View>
              ))}
            </View>
          ) : active ? (
            <Ionicons name={status === 'pending' ? 'time-outline' : 'checkmark'} size={small ? 13 : 15} color={colors.accent} />
          ) : null}
          <Text style={[styles.text, small && styles.textSm, active && styles.textActive]} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </Bounce>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill,
    backgroundColor: colors.magenta, borderWidth: 1, borderColor: colors.magenta,
  },
  sm: { minHeight: 32, paddingHorizontal: 10 },
  md: { minHeight: 44, paddingHorizontal: 18 },
  active: { backgroundColor: 'transparent', borderColor: colors.accent },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icons: { flexDirection: 'row', alignItems: 'center' },
  iconDot: {
    width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(12,15,26,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
  },
  iconDotSm: { width: 17, height: 17, borderRadius: 9 },
  text: { color: colors.onBrand, ...font.bold, fontSize: 15 },
  textSm: { fontSize: 12 },
  textActive: { color: colors.accent },
})
