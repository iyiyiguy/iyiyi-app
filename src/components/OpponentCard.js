// Opponent strip for online games (studio look): square avatar with an enemy-colour edge,
// caps username, "Rated 1420 · Black · thinking…" line (or a caller's own ratingLabel, e.g.
// "1016? online", in place of "Rated N"), captured pieces, and quick actions
// (follow, view profile, chat with unread badge, video call). Chat / call can instead live in
// the game's own action row: pass actions={false} to show only Follow.
import React from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { FONT, ST } from '../games/studio'
import GameFollowButton from './GameFollowButton'

// Round avatar kept for screens that still use it (ChessScreen). square draws the studio tile.
export function PlayerAvatar({ uri, name, size = 44, ring, square = false, accent }) {
  if (square) {
    return (
      <View style={[styles.sq, { width: size, height: size, borderBottomColor: accent || ring || ST.enemy }]}>
        {uri
          ? <Image source={{ uri }} style={{ width: size, height: size - 3 }} />
          : <Text allowFontScaling={false} style={[styles.sqText, { fontSize: Math.round(size * 0.42) }]}>{String(name || '?').slice(0, 1).toUpperCase()}</Text>}
      </View>
    )
  }
  const inner = uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#2a3038' }} />
    : (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.fallbackText, { fontSize: size * 0.42 }]}>{String(name || '?').slice(0, 1).toUpperCase()}</Text>
      </View>
    )
  return <View style={[styles.ring, { borderRadius: size, borderColor: ring || 'transparent' }]}>{inner}</View>
}

export default function OpponentCard({
  player, rating, ratingLabel, sideLabel, captured, thinking, connected = true,
  onViewProfile, onChat, unread = 0, videoButton, bubble, actions = true, accent = ST.enemy,
}) {
  const name = player?.name || 'Opponent'
  const status = !connected ? 'Offline' : thinking ? 'Thinking…' : null
  const ratingText = typeof ratingLabel === 'string' && ratingLabel ? ratingLabel : rating != null ? `Rated ${rating}` : 'Unrated'
  const meta = [ratingText, sideLabel, status].filter(Boolean).join(' · ')
  return (
    <View style={[styles.card, thinking && connected && { borderLeftWidth: 3, borderLeftColor: accent }]}>
      <Pressable
        onPress={onViewProfile}
        disabled={!onViewProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${name}’s profile`}
        style={({ pressed }) => [styles.who, pressed && { opacity: 0.75 }]}
      >
        <View>
          <PlayerAvatar square uri={player?.avatar} name={name} size={40} accent={accent} />
          <View style={[styles.dot, { backgroundColor: connected ? ST.health : ST.faint }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={[styles.meta, !connected && { color: ST.objective }, thinking && connected && { color: accent }]} numberOfLines={1}>{meta}</Text>
          {captured ? <Text style={styles.captured} numberOfLines={1}>{captured}</Text> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        {player?.id ? <GameFollowButton userId={player.id} name={name} /> : null}
        {actions && onViewProfile ? (
          <Pressable onPress={onViewProfile} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="View profile">
            <Ionicons name="person" size={16} color={ST.text} />
          </Pressable>
        ) : null}
        {actions && onChat ? (
          <Pressable onPress={onChat} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={unread ? `Chat, ${unread} unread` : 'Chat'}>
            <Ionicons name="chatbubble-ellipses" size={16} color={ST.text} />
            {unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
          </Pressable>
        ) : null}
        {actions ? videoButton : null}
      </View>
      {bubble ? (
        <Pressable onPress={onChat} disabled={!onChat} style={styles.bubbleWrap} accessibilityRole="button" accessibilityLabel={`New message: ${bubble}`}>
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
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: ST.radius, backgroundColor: ST.panel,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  sq: { backgroundColor: '#2a3038', borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sqText: { fontFamily: FONT.display, color: ST.text, includeFontPadding: false },
  ring: { padding: 2, borderWidth: 2 },
  fallback: { backgroundColor: '#2a3038', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: ST.text, fontFamily: FONT.display },
  dot: { position: 'absolute', right: -3, top: -3, width: 10, height: 10, borderWidth: 2, borderColor: ST.ground },
  name: { fontFamily: FONT.display, fontSize: 16, color: ST.text, includeFontPadding: false },
  meta: { fontFamily: FONT.uiSemi, fontSize: 11, color: 'rgba(242,244,247,0.6)', marginTop: 1 },
  captured: { fontSize: 14, color: ST.muted, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { width: 36, height: 36, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.95 }] },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: ST.radius, paddingHorizontal: 4, backgroundColor: ST.enemy, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontFamily: FONT.display, color: '#fff' },
  bubbleWrap: { position: 'absolute', left: 18, top: '100%', marginTop: 2, zIndex: 20, maxWidth: '75%' },
  bubbleTail: { marginLeft: 16, width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#f2f4f7' },
  bubble: { backgroundColor: '#f2f4f7', borderRadius: ST.radius, paddingHorizontal: 12, paddingVertical: 7 },
  bubbleText: { fontSize: 14, fontFamily: FONT.uiSemi, color: ST.ink },
})
