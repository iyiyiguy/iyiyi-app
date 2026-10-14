// Compact studio-style Follow button for game HUDs, scoreboards and results. Works for
// teammates and enemies alike; shares state with every other button for the same player.
import { memo } from 'react'
import { Pressable, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFollow } from '../lib/followCache'

const ACCENT = '#3ad1ff'

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
        <Ionicons name={on ? 'checkmark' : pending ? 'time-outline' : 'add'} size={16} color={on || pending ? ACCENT : '#07090c'} />
      ) : (
        <>
          <Ionicons name={on ? 'checkmark' : pending ? 'time-outline' : 'person-add'} size={13} color={on || pending ? ACCENT : '#07090c'} />
          <Text style={[s.txt, (on || pending) && { color: ACCENT }]}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

export default memo(GameFollowButton)

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, minWidth: 96, paddingHorizontal: 10, borderRadius: 3, borderWidth: 1 },
  sm: { minWidth: 30, width: 30, height: 26, paddingHorizontal: 0 },
  off: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  on: { backgroundColor: 'transparent', borderColor: ACCENT },
  txt: { color: '#07090c', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
})
