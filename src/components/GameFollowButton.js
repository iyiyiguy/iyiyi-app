// Compact studio-style Follow button for game HUDs, scoreboards and results. Works for
// teammates and enemies alike; shares state with every other button for the same player.
import { memo } from 'react'
import { Pressable, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFollow } from '../lib/followCache'
import { ST, FONT } from '../games/studio'

const ACCENT = ST.friendly

function GameFollowButton({ userId, name, size = 'md', style }) {
  const { status, toggle } = useFollow(userId)
  if (!userId) return null
  const on = status === 'accepted'
  const pending = status === 'pending'
  const label = on ? 'FOLLOWING' : pending ? 'REQUESTED' : 'FOLLOW'
  const small = size === 'sm'
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${on ? 'Unfollow' : pending ? 'Cancel follow request for' : 'Follow'} ${name || 'player'}`}
      style={({ pressed }) => [
        s.btn, small && s.sm,
        on || pending ? s.on : s.off,
        pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      {small ? (
        <Ionicons name={on ? 'checkmark' : pending ? 'time-outline' : 'add'} size={16} color={on || pending ? ACCENT : ST.ink} />
      ) : (
        <>
          <Ionicons name={on ? 'checkmark' : pending ? 'time-outline' : 'person-add'} size={13} color={on || pending ? ACCENT : ST.ink} />
          <Text style={[s.txt, (on || pending) && { color: ACCENT }]}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

export default memo(GameFollowButton)

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, minWidth: 96, paddingHorizontal: 10, borderRadius: ST.radius, borderWidth: 1 },
  sm: { minWidth: 30, width: 30, height: 26, paddingHorizontal: 0 },
  off: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  on: { backgroundColor: 'transparent', borderColor: ACCENT },
  txt: { color: ST.ink, fontSize: 13, fontFamily: FONT.display, letterSpacing: 1.4, includeFontPadding: false },
})
