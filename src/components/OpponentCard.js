// Opponent strip for online games: avatar, username, rating, side, captured pieces, and
// quick actions (view profile, chat with unread badge, video call).
import React from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { AC } from '../games/arcadeUI'
import { font } from '../theme'

export function PlayerAvatar({ uri, name, size = 44, ring }) {
  const inner = uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1a1e33' }} />
    : (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.fallbackText, { fontSize: size * 0.42 }]}>{String(name || '?').slice(0, 1).toUpperCase()}</Text>
      </View>
    )
  return <View style={[styles.ring, { borderRadius: size, borderColor: ring || 'transparent' }]}>{inner}</View>
}

export default function OpponentCard({
  player, rating, sideLabel, captured, thinking, connected = true,
  onViewProfile, onChat, unread = 0, videoButton, bubble,
}) {
  const name = player?.name || 'Opponent'
  return (
    <View style={styles.card}>
      <Pressable onPress={onViewProfile} disabled={!onViewProfile} accessibilityRole="button" accessibilityLabel={`View ${name}’s profile`} style={({ pressed }) => [styles.who, pressed && { opacity: 0.75 }]}>
        <View>
          <PlayerAvatar uri={player?.avatar} name={name} size={46} ring={thinking ? AC.live : AC.border} />
          <View style={[styles.dot, { backgroundColor: connected ? AC.live : AC.faint }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.ratingPill}>
              <Ionicons name="trophy" size={10} color={AC.gold} />
              <Text style={styles.ratingText}>{rating != null ? rating : '—'}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={1}>{sideLabel}{!connected ? ' · offline' : thinking ? ' · thinking…' : ''}</Text>
          </View>
          {captured ? <Text style={styles.captured} numberOfLines={1}>{captured}</Text> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        {onViewProfile ? (
          <Pressable onPress={onViewProfile} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="View profile">
            <Ionicons name="person" size={17} color={AC.text} />
          </Pressable>
        ) : null}
        {onChat ? (
          <Pressable onPress={onChat} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={unread ? `Chat, ${unread} unread` : 'Chat'}>
            <Ionicons name="chatbubble-ellipses" size={17} color={AC.text} />
            {unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
          </Pressable>
        ) : null}
        {videoButton}
      </View>
      {bubble ? (
        <Pressable onPress={onChat} style={styles.bubbleWrap} accessibilityRole="button" accessibilityLabel={`New message: ${bubble}`}>
          <View style={styles.bubbleTail} />
          <View style={styles.bubble}><Text style={styles.bubbleText} numberOfLines={2}>{bubble}</Text></View>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingLeft: 10, paddingRight: 8, borderRadius: 20,
    backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  ring: { padding: 2, borderWidth: 2 },
  fallback: { backgroundColor: '#5b6cf0', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#fff', ...font.heavy },
  dot: { position: 'absolute', right: 1, bottom: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#0a0e24' },
  name: { fontSize: 16, ...font.bold, color: AC.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,201,77,0.14)' },
  ratingText: { fontSize: 11, ...font.heavy, color: AC.gold },
  meta: { fontSize: 12, ...font.medium, color: AC.muted, flexShrink: 1 },
  captured: { fontSize: 14, color: AC.muted, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: AC.cardStrong, borderWidth: 1, borderColor: AC.border },
  pressed: { transform: [{ scale: 0.92 }] },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: AC.hot, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, ...font.heavy, color: '#fff' },
  bubbleWrap: { position: 'absolute', left: 18, top: '100%', marginTop: 2, zIndex: 20, maxWidth: '75%' },
  bubbleTail: { marginLeft: 16, width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#f4f6ff' },
  bubble: { backgroundColor: '#f4f6ff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  bubbleText: { fontSize: 14, ...font.semibold, color: '#151a2b' },
})
