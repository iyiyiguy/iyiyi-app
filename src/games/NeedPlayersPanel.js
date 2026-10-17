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
import { useT } from '../i18n'
import R from '../i18n/strings/gameRoom'
import { mpGameName } from '../lib/games'

/** Players still needed to start (0 when there are enough). */
export function playersNeeded(gameId, count) {
  const min = MP_GAMES[resolveGameId(gameId)]?.minPlayers ?? 2
  return Math.max(0, min - (Number(count) || 0))
}

// A line on what the game looks like at the minimum, so a small group knows it works.
const SMALL_GROUP = {
  'heads-up': 'small_headsup',
  mafia: 'small_mafia',
  'beside-them': 'small_beside',
  'spider-spider': 'small_spider',
  lasertag: 'small_laser',
  chess: 'small_chess',
}

export function NeedPlayersPanel({ gameId, count, code, gameName, onInvite, onShare, onText, style }) {
  const t = useT(R)
  const id = resolveGameId(gameId)
  const need = playersNeeded(id, count)
  if (!need) return null
  const name = gameName || (MP_GAMES[id] ? mpGameName(id, MP_GAMES[id].name) : t('this_game_lower'))
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
          <Text style={[stType.kicker, { color: ST.objective }]}>{t('need_n_more', { n: need })}</Text>
          <Text style={stType.body}>
            {t('starts_at', { game: name, total: need + (Number(count) || 0), n: Number(count) || 0 })}
          </Text>
        </View>
      </View>
      {SMALL_GROUP[id] ? <Text style={[stType.small, { marginTop: 8 }]}>{t(SMALL_GROUP[id])}</Text> : null}
      <View style={styles.row}>
        <StButton
          title={t('share_invite')}
          tone="objective"
          height={44}
          onPress={share}
          disabled={!onShare && !code}
          left={<Ionicons name="share-outline" size={16} color={ST.ink} />}
          style={{ flex: 1 }}
        />
        {onInvite ? <StButton title={t('invite')} tone="ghost" height={44} onPress={onInvite} style={{ flex: 1 }} /> : null}
      </View>
      {onText ? <StButton title={t('invite_text')} tone="ghost" height={40} onPress={onText} style={{ marginTop: 8 }} /> : null}
    </StPanel>
  )
}

export default NeedPlayersPanel

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 12, backgroundColor: withAlpha(ST.objective, 0.06) },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
})
