import { View, Text, Pressable, StyleSheet, ImageBackground } from 'react-native'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'

function statLine(game, s) {
  if (!s || !s.played) return 'Not played yet'
  if (game.id === 'chess') return `Rating ${s.rating ?? '—'} · ${s.wins}W ${s.losses}L ${s.draws}D`
  if (game.id === 'word-race') return `Best ${s.bestScore ?? 0} · ${s.played} run${s.played === 1 ? '' : 's'}`
  return `${s.played} played · ${s.wins} won`
}

// Card for one arcade game. `userStats` is the player's real stats for it
// (from arcadeStats), or null.
export const GameCard = ({ game, onPress, userStats = null }) => {
  const players = game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} player${game.minPlayers === 1 ? '' : 's'}`
    : `${game.minPlayers}–${game.maxPlayers} players`
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, { transform: [{ scale: pressed ? 0.97 : 1 }] }]} accessibilityRole="button" accessibilityLabel={`Play ${game.name}`}>
      <GlassPanel style={styles.card} radius={radii.md} animateIn={false}>
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
          <Text style={styles.name} numberOfLines={1}>{game.name}</Text>
          <Text style={styles.description} numberOfLines={2}>{game.description}</Text>
          <Text style={styles.meta} numberOfLines={1}>👥 {players}</Text>
          <Text style={styles.stats} numberOfLines={1}>{statLine(game, userStats)}</Text>
          <View style={styles.playButton}>
            <Text style={styles.playButtonText}>{game.kind === 'multiplayer' ? 'Host or join' : 'Play'}</Text>
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
  coverShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  coverIcon: { fontSize: 44 },
  body: { padding: 12 },
  name: { ...type.title, fontSize: 16 },
  description: { ...type.caption, color: colors.textMuted, marginTop: 2, minHeight: 34 },
  meta: { ...type.caption, marginTop: 6 },
  stats: { ...type.caption, color: colors.text, fontWeight: '600', marginTop: 2 },
  playButton: { marginTop: 10, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.text },
  playButtonText: { ...type.body, fontSize: 13, color: colors.ink, fontWeight: '800' },
})
