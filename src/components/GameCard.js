import { View, Text, Pressable, StyleSheet, ImageBackground } from 'react-native'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'
import { useT } from '../i18n'
import strings from '../i18n/strings/gamesScreen'
import { gameText, playersLabel } from '../lib/games'

function statLine(game, s, t) {
  if (!s || !s.played) return t('stat_not_played')
  if (game.id === 'chess') {
    // s.rating = vs AI; s.onlineRating / s.onlineGames = online (shown first once played).
    const n = Number(s.onlineGames) || 0
    const online = n > 0 && Number.isFinite(Number(s.onlineRating)) ? t('stat_online', { r: `${Math.round(s.onlineRating)}${n < 10 ? '?' : ''}` }) : null
    const ai = s.rating != null ? t('stat_vs_ai', { r: s.rating }) : null
    return [online, ai || (online ? null : t('stat_unrated')), t('stat_wld', { w: s.wins, l: s.losses, d: s.draws })].filter(Boolean).join(' · ')
  }
  if (game.id === 'word-race') return t(s.played === 1 ? 'stat_best_runs_one' : 'stat_best_runs', { best: s.bestScore ?? 0, n: s.played })
  return t('stat_played_won', { n: s.played, w: s.wins })
}

// Card for one arcade game. `userStats` is the player's real stats for it
// (from arcadeStats), or null.
export const GameCard = ({ game, onPress, userStats = null }) => {
  const t = useT(strings)
  const players = playersLabel(game)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, { transform: [{ scale: pressed ? 0.97 : 1 }] }]} accessibilityRole="button" accessibilityLabel={t('play_a11y', { name: gameText(game, 'name') })}>
      <GlassPanel style={styles.card} radius={radii.md} animateIn={false} lite>
        {game.cover ? (
          <ImageBackground source={game.cover} style={styles.cover} imageStyle={styles.coverImage}>
            <View style={styles.coverShade} />
          </ImageBackground>
        ) : (
          <View style={[styles.cover, { backgroundColor: `${game.color}22` }]}>
            <Text style={styles.coverIcon}>{game.icon}</Text>
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{gameText(game, 'name')}</Text>
          <Text style={styles.description} numberOfLines={2}>{gameText(game, 'description')}</Text>
          <Text style={styles.meta} numberOfLines={1}>👥 {players}</Text>
          <Text style={styles.stats} numberOfLines={1}>{statLine(game, userStats, t)}</Text>
          <View style={styles.playButton}>
            <Text style={styles.playButtonText}>{game.kind === 'multiplayer' ? t('host_or_join') : t('play')}</Text>
          </View>
        </View>
      </GlassPanel>
    </Pressable>
  )
}

export default GameCard

const styles = StyleSheet.create({
  wrap: { width: '48%', marginBottom: 12 },
  card: { overflow: 'hidden' },
  cover: { height: 104, alignItems: 'center', justifyContent: 'center' },
  coverImage: { resizeMode: 'cover' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.15)' },
  coverIcon: { fontSize: 44 },
  body: { padding: 12 },
  name: { ...type.title, fontSize: 16 },
  description: { ...type.caption, color: colors.textMuted, marginTop: 2, minHeight: 34 },
  meta: { ...type.caption, marginTop: 6 },
  stats: { ...type.caption, color: colors.text, fontWeight: '600', marginTop: 2 },
  playButton: { marginTop: 10, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.text },
  playButtonText: { ...type.body, fontSize: 13, color: colors.ink, fontWeight: '800' },
})
