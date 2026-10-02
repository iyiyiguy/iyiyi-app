import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { GAMES, getGame } from '../lib/games'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, winRateFor } from '../lib/arcadeStats'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../lib/chessAI'
import {
  AC, ArcadeBackground, ArcadeCard, ArcadeHeader, StatTile, StatusBarScrim, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { font } from '../theme'

function formatWhen(iso) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const RESULT_LABEL = { win: 'Win', loss: 'Loss', draw: 'Draw', local: 'Played', score: 'Score', played: 'Played' }
const RESULT_COLOR = { win: AC.live, loss: AC.danger, draw: AC.gold }

// One stats card: title row + a row of stat tiles (+ optional children).
function RecordCard({ title, icon, subtitle, stats, children, glow }) {
  return (
    <ArcadeCard style={{ marginBottom: 12 }} glow={glow}>
      <View style={styles.cardHead}>
        {icon ? <Text style={{ fontSize: 22 }}>{icon}</Text> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={arcadeText.caption} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </View>
      {stats?.length ? (
        <View style={styles.tiles}>
          {stats.map((x) => <StatTile key={x.label} label={x.label} value={x.value} accent={x.accent} />)}
        </View>
      ) : null}
      {children}
    </ArcadeCard>
  )
}

// "My Records": the signed-in player's own real stats and personal bests.
// (Route params from older callers, e.g. { gameId }, are accepted and ignored.)
export default function GameLeaderboardScreen({ navigation }) {
  const insets = useArcadeInsets()
  useArcadeStatusBar()
  const [stats, setStats] = useState(null)

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setStats(s) })
    return () => { alive = false }
  }, []))
  useEffect(() => subscribeArcadeStats(setStats), [])

  const totals = stats ? totalsFor(stats) : null

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 60, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <ArcadeHeader kicker="Arcade" title="My Records" onBack={() => navigation.goBack()} />
        {!stats ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : (
          <>
            <LinearGradient colors={['#2a1a5e', '#141838', '#0b0d1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.overview}>
              <View style={styles.overviewGlow} />
              <View style={styles.overviewRow}>
                <Big label="Lifetime points" value={stats.lifetimePoints} accent />
                <Big label="Games played" value={totals.played} />
                <Big label="Win rate" value={totals.winRate != null ? `${totals.winRate}%` : '—'} />
              </View>
              {totals.played === 0 && (
                <Text style={styles.hint}>Nothing here yet. Play a game from the Arcade and your records will show up here.</Text>
              )}
            </LinearGradient>

            <Text style={styles.section}>Chess</Text>
            <RecordCard
              title="Chess rating"
              icon="♟️"
              subtitle={stats.chess.ratedGames > 0 ? `${stats.chess.ratedGames} rated games vs the computer` : 'Unrated – play the computer to get a rating'}
              stats={[
                { label: 'Rating', value: stats.chess.rating },
                { label: 'Peak', value: stats.chess.peakRating },
                { label: 'Pass & play', value: stats.chess.localGames },
              ]}
            />
            <RecordCard
              title="vs Computer"
              stats={DIFFICULTIES.map((d) => {
                const r = stats.chess.vsAI[d]
                return { label: DIFFICULTY_LABELS[d], value: `${r.w}-${r.l}-${r.d}` }
              })}
            >
              <Text style={styles.caption}>Wins-losses-draws per level</Text>
            </RecordCard>

            <Text style={styles.section}>What's The Word</Text>
            <RecordCard
              title="Personal bests"
              icon="📝"
              subtitle={`Last played ${formatWhen(stats.games['word-race'].lastPlayed)}`}
              stats={[
                { label: 'Best score', value: stats.games['word-race'].bestScore ?? '—' },
                { label: 'Most words', value: stats.wordRace.bestWords },
                { label: 'Best streak', value: stats.wordRace.bestStreak },
                { label: 'Runs', value: stats.games['word-race'].played },
              ]}
            />

            <Text style={styles.section}>Multiplayer</Text>
            {GAMES.filter((g) => g.kind === 'multiplayer').map((g) => {
              const s = stats.games[g.id] || { played: 0, wins: 0, losses: 0, draws: 0, bestScore: null, lastPlayed: null }
              const wr = winRateFor(s)
              return (
                <RecordCard
                  key={g.id}
                  title={g.name}
                  icon={g.icon}
                  subtitle={s.played ? `Last played ${formatWhen(s.lastPlayed)}` : 'Not played yet'}
                  stats={[
                    { label: 'Played', value: s.played },
                    { label: 'Wins', value: s.wins },
                    { label: 'Win rate', value: wr != null ? `${wr}%` : '—' },
                    { label: 'Best score', value: s.bestScore ?? '—' },
                  ]}
                />
              )
            })}

            {stats.recent.length > 0 && (
              <>
                <Text style={styles.section}>Recent games</Text>
                <ArcadeCard padded={false} style={{ marginBottom: 4 }}>
                  <View style={styles.recent}>
                  {stats.recent.map((r, i) => (
                    <View key={`${r.at}-${i}`} style={[styles.recentRow, i > 0 && styles.recentDivider]}>
                      <Text style={styles.recentGame} numberOfLines={1}>
                        {getGame(r.gameId)?.icon} {getGame(r.gameId)?.name || r.gameId}
                        {r.label ? <Text style={styles.caption}>  {r.label}</Text> : null}
                      </Text>
                      <Text style={[styles.recentResult, RESULT_COLOR[r.result] && { color: RESULT_COLOR[r.result] }]}>
                        {r.result === 'score' ? r.score : RESULT_LABEL[r.result] || r.result}
                      </Text>
                      <Text style={styles.recentPoints}>+{r.points}</Text>
                    </View>
                  ))}
                  </View>
                </ArcadeCard>
              </>
            )}
            <Text style={styles.footnote}>Records are saved on this device for your account.</Text>
          </>
        )}
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

function Big({ label, value, accent }) {
  return (
    <View style={styles.big}>
      <Text style={[styles.bigValue, accent && { color: AC.gold }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.bigLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  empty: { ...arcadeText.caption, textAlign: 'center', marginTop: 60 },
  overview: { padding: 18, borderRadius: 26, marginTop: 18, borderWidth: 1, borderColor: AC.border, overflow: 'hidden' },
  overviewGlow: { position: 'absolute', width: 240, height: 240, borderRadius: 120, right: -80, top: -100, backgroundColor: 'rgba(255,201,77,0.14)' },
  overviewRow: { flexDirection: 'row' },
  big: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  bigValue: { fontSize: 28, ...font.heavy, color: AC.text, letterSpacing: -0.6 },
  bigLabel: { ...arcadeText.label, fontSize: 10 },
  hint: { ...arcadeText.caption, textAlign: 'center', marginTop: 12 },
  section: { fontSize: 20, ...font.bold, color: AC.text, letterSpacing: -0.3, marginTop: 26, marginBottom: 12 },
  caption: { ...arcadeText.caption, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 17, ...font.heavy, color: AC.text },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 14 },
  recent: { paddingHorizontal: 16, paddingVertical: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  recentDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AC.border },
  recentGame: { fontSize: 15, color: AC.text, flex: 1 },
  recentResult: { fontSize: 15, ...font.bold, color: AC.text },
  recentPoints: { fontSize: 13, ...font.heavy, color: AC.live, minWidth: 40, textAlign: 'right' },
  footnote: { ...arcadeText.caption, textAlign: 'center', marginTop: 16, color: AC.faint },
})
