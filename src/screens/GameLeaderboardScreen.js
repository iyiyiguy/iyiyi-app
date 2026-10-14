import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { GAMES, getGame } from '../lib/games'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, winRateFor } from '../lib/arcadeStats'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../lib/chessAI'
import { formatOnlineRating } from '../lib/chessMatchmaking'
import {
  AC, ArcadeBackground, ArcadeCard, ArcadeHeader, StatTile, StatusBarScrim, arcadeText, gameIcon, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { FONT, ST, stType } from '../games/studio'

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
        {icon ? <View style={styles.cardIcon}><Ionicons name={icon} size={18} color={ST.friendly} /></View> : null}
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
            <View style={styles.overview}>
              <View style={styles.overviewRow}>
                <Big label="Lifetime points" value={stats.lifetimePoints} accent />
                <Big label="Games played" value={totals.played} />
                <Big label="Win rate" value={totals.winRate != null ? `${totals.winRate}%` : '—'} />
              </View>
              {totals.played === 0 && (
                <Text style={styles.hint}>Nothing here yet. Play a game from the Arcade and your records will show up here.</Text>
              )}
            </View>

            <Section title="Chess" />
            <RecordCard
              title="Online rating"
              icon={gameIcon('chess')}
              subtitle={stats.chess.online?.games > 0
                ? `${stats.chess.online.games} rated online game${stats.chess.online.games === 1 ? '' : 's'} · this device${stats.chess.online.games < 10 ? ' · ? = provisional' : ''}`
                : 'Unrated – play someone online to get a rating'}
              stats={[
                { label: 'Online', value: stats.chess.online?.games > 0 ? formatOnlineRating(stats.chess.online.rating, stats.chess.online.games) ?? '—' : '—' },
                { label: 'Peak', value: stats.chess.online?.games > 0 ? stats.chess.online.peakRating ?? '—' : '—' },
                { label: 'W-L-D', value: `${stats.chess.online?.w || 0}-${stats.chess.online?.l || 0}-${stats.chess.online?.d || 0}` },
              ]}
            />
            <RecordCard
              title="vs AI rating"
              subtitle={stats.chess.ratedGames > 0 ? `${stats.chess.ratedGames} rated games vs the computer` : 'Unrated – play the computer to get a rating'}
              stats={[
                { label: 'vs AI', value: stats.chess.ratedGames > 0 ? stats.chess.rating : '—' },
                { label: 'Peak', value: stats.chess.ratedGames > 0 ? stats.chess.peakRating : '—' },
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

            <Section title="What's The Word" />
            <RecordCard
              title="Personal bests"
              icon={gameIcon('word-race')}
              subtitle={`Last played ${formatWhen(stats.games['word-race'].lastPlayed)}`}
              stats={[
                { label: 'Best score', value: stats.games['word-race'].bestScore ?? '—' },
                { label: 'Most words', value: stats.wordRace.bestWords },
                { label: 'Best streak', value: stats.wordRace.bestStreak },
                { label: 'Runs', value: stats.games['word-race'].played },
              ]}
            />

            <Section title="Multiplayer" />
            {GAMES.filter((g) => g.kind === 'multiplayer').map((g) => {
              const s = stats.games[g.id] || { played: 0, wins: 0, losses: 0, draws: 0, bestScore: null, lastPlayed: null }
              const wr = winRateFor(s)
              return (
                <RecordCard
                  key={g.id}
                  title={g.name}
                  icon={gameIcon(g.id)}
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
                <Section title="Recent games" />
                <ArcadeCard padded={false} style={{ marginBottom: 4 }}>
                  <View style={styles.recent}>
                  {stats.recent.map((r, i) => (
                    <View key={`${r.at}-${i}`} style={[styles.recentRow, i > 0 && styles.recentDivider]}>
                      <Text style={styles.recentGame} numberOfLines={1}>
                        {getGame(r.gameId)?.name || r.gameId}
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

function Section({ title }) {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionTick} />
      <Text style={styles.section} numberOfLines={1}>{title}</Text>
    </View>
  )
}

function Big({ label, value, accent }) {
  return (
    <View style={styles.big}>
      <Text style={styles.bigLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.bigValue, accent && { color: ST.objective }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  empty: { ...stType.label, textAlign: 'center', marginTop: 60 },
  overview: { padding: 16, borderRadius: ST.radius, marginTop: 18, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.objective, overflow: 'hidden' },
  overviewRow: { flexDirection: 'row', gap: 6 },
  big: { flex: 1, padding: 10, backgroundColor: ST.cell, borderRadius: ST.radius, gap: 2 },
  bigValue: { fontFamily: FONT.display, fontSize: 26, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  bigLabel: { ...stType.label, fontSize: 9, letterSpacing: 1.4 },
  hint: { ...arcadeText.caption, textAlign: 'center', marginTop: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 12 },
  sectionTick: { width: 3, height: 14, backgroundColor: ST.friendly },
  section: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 1.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false, flexShrink: 1 },
  caption: { ...arcadeText.caption, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 36, height: 36, borderRadius: ST.radius, backgroundColor: ST.cell, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false, marginBottom: 2 },
  tiles: { flexDirection: 'row', gap: 6, marginTop: 14 },
  recent: { paddingHorizontal: 14, paddingVertical: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  recentDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ST.line },
  recentGame: { fontFamily: FONT.uiSemi, fontSize: 15, color: ST.text, flex: 1 },
  recentResult: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: ST.text },
  recentPoints: { fontFamily: FONT.display, fontSize: 13, color: ST.objective, minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'], includeFontPadding: false },
  footnote: { ...arcadeText.caption, textAlign: 'center', marginTop: 16, color: ST.faint },
})
