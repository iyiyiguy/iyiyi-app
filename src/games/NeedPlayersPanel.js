// Cold start: "Need N more — share invite" panel for a multiplayer lobby that doesn't have
// enough players yet (studio look). Drop it into the lobby above the roster:
//
//   <NeedPlayersPanel gameId={gameId} count={roster.length} code={room.code}
//     onInvite={() => setInviteOpen(true)} onText={textInvite} />
//
// Share uses the lobby's existing invite text (lib/textInvite shareInvite) unless onShare is
// passed. Renders nothing once the lobby has enough players.
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { MP_GAMES, resolveGameId } from '../lib/multiplayer'
import { shareInvite } from '../lib/textInvite'
import { buzz } from '../lib/gamePrefs'
import { ST, StButton, StPanel, stType, withAlpha } from './studio'

/** Players still needed to start (0 when there are enough). */
export function playersNeeded(gameId, count) {
  const min = MP_GAMES[resolveGameId(gameId)]?.minPlayers ?? 2
  return Math.max(0, min - (Number(count) || 0))
}

// A line on what the game looks like at the minimum, so a small group knows it works.
const SMALL_GROUP = {
  'heads-up': 'Plays from 4: 2 pickers and 2 sitters. More players, more pickers (up to 7).',
  mafia: '5 is the classic minimum: 1 Mafia and a Doctor. From 6 a Detective joins, from 7 a second Mafia.',
  'beside-them': 'From 4: 1 imposter and 3 crew. Auto GPS stations mean no setup.',
  'spider-spider': 'Two is enough to start: one spider, one runner.',
  lasertag: 'Two is enough for a 1v1 Free-for-all.',
  chess: 'Invite one person you follow, or share the code.',
}

export function NeedPlayersPanel({ gameId, count, code, gameName, onInvite, onShare, onText, style }) {
  const id = resolveGameId(gameId)
  const need = playersNeeded(id, count)
  if (!need) return null
  const name = gameName || MP_GAMES[id]?.name || 'this game'
  const share = () => {
    buzz('select')
    if (onShare) onShare()
    else if (code) shareInvite({ gameName: name, code }).catch?.(() => {})
  }
  return (
    <StPanel strong accent={ST.objective} style={[styles.card, style]} accessibilityLiveRegion="polite">
      <View style={styles.top}>
        <Ionicons name="people-outline" size={22} color={ST.objective} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[stType.kicker, { color: ST.objective }]}>Need {need} more</Text>
          <Text style={stType.body}>
            {name} starts at {need + (Number(count) || 0)} players · {Number(count) || 0} here
          </Text>
        </View>
      </View>
      {SMALL_GROUP[id] ? <Text style={[stType.small, { marginTop: 8 }]}>{SMALL_GROUP[id]}</Text> : null}
      <View style={styles.row}>
        <StButton
          title="Share invite"
          tone="objective"
          height={44}
          onPress={share}
          disabled={!onShare && !code}
          left={<Ionicons name="share-outline" size={16} color={ST.ink} />}
          style={{ flex: 1 }}
        />
        {onInvite ? <StButton title="Invite" tone="ghost" height={44} onPress={onInvite} style={{ flex: 1 }} /> : null}
      </View>
      {onText ? <StButton title="Invite by text" tone="ghost" height={40} onPress={onText} style={{ marginTop: 8 }} /> : null}
    </StPanel>
  )
}

export default NeedPlayersPanel

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 12, backgroundColor: withAlpha(ST.objective, 0.06) },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
})
