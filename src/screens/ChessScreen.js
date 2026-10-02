import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { ChessGame } from '../games/ChessGame'
import {
  AC, ArcadeBackground, Chip, GhostButton, IconCircle, PlayButton, SectionHeader, StatTile,
  useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { PlayerAvatar } from '../components/OpponentCard'
import { font } from '../theme'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../lib/chessAI'
import { loadArcadeStats, CHESS_AI_RATINGS } from '../lib/arcadeStats'
import { SLOW_SEARCH_MS, useChessMatchmaking } from '../lib/chessMatchmaking'
import { buzz } from '../lib/gamePrefs'

const COLOR_OPTIONS = [
  { key: 'w', label: 'White' },
  { key: 'b', label: 'Black' },
  { key: 'random', label: 'Random' },
]

const SEARCHING = ['connecting', 'searching', 'proposing', 'joining']

// Route params (all optional): { mode: 'ai'|'local'|'online', difficulty, color: 'w'|'b'|'random' }.
// With mode 'ai' / 'local' the game starts immediately; otherwise the lobby is shown.
export default function ChessScreen({ navigation, route }) {
  useArcadeStatusBar()
  const insets = useArcadeInsets()
  const params = route?.params || {}
  const [offlineMode, setOfflineMode] = useState(params.mode === 'local' ? 'local' : 'ai')
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.includes(params.difficulty) ? params.difficulty : 'medium')
  const [colorChoice, setColorChoice] = useState(params.color || 'w')
  const [config, setConfig] = useState(() => (params.mode === 'ai' || params.mode === 'local' ? makeConfig(params.mode, params.difficulty || 'medium', params.color || 'w') : null))
  const [stats, setStats] = useState(null)
  const mm = useChessMatchmaking()
  const handled = useRef(null)
  const searching = SEARCHING.includes(mm.status)

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setStats(s) }).catch(() => {})
    return () => { alive = false }
  }, []))

  // Back from a matched game: reset the online panel.
  const mmRef = useRef(mm)
  mmRef.current = mm
  useEffect(() => navigation.addListener('focus', () => {
    if (mmRef.current.status === 'matched' && handled.current) mmRef.current.cancel()
  }), [navigation])

  // Matched: show "opponent found" for a moment, then hand the room to the game screen.
  const code = mm.match?.code
  useEffect(() => {
    if (mm.status !== 'matched' || !code || handled.current === code) return undefined
    handled.current = code
    buzz('success')
    const t = setTimeout(() => {
      const room = mm.takeRoom()
      if (!room) return
      navigation.navigate('GamePlayScreen', { gameId: 'chess', gameName: 'Chess', code })
    }, 900)
    return () => clearTimeout(t)
  }, [mm.status, code]) // eslint-disable-line react-hooks/exhaustive-deps

  const findOpponent = () => {
    buzz('medium')
    mm.start()
  }

  const inviteFriends = () => {
    if (searching) mm.cancel()
    // Host an online room and open the invite sheet (nearby, following, followers).
    navigation.navigate('GameLobby', { gameId: 'chess', autoHost: true, autoInvite: true })
  }

  const joinWithCode = () => {
    if (searching) mm.cancel()
    navigation.navigate('GameLobby', { gameId: 'chess' })
  }

  const startOffline = () => {
    if (searching) mm.cancel()
    setConfig(makeConfig(offlineMode, difficulty, colorChoice))
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} size={40} />
      <Text style={styles.headerTitle} numberOfLines={1}>{config ? (config.mode === 'ai' ? `vs ${DIFFICULTY_LABELS[config.difficulty]} AI` : 'Pass & Play') : 'Chess'}</Text>
      {stats ? (
        <View style={styles.headerRating}>
          <Ionicons name="trophy" size={12} color={AC.gold} />
          <Text style={styles.headerRatingText}>{stats.chess.rating}</Text>
        </View>
      ) : <View style={{ width: 40 }} />}
    </View>
  )

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      {header}
      {config ? (
        <ChessGame
          key={config.id}
          mode={config.mode}
          difficulty={config.difficulty}
          playerColor={config.color}
          onExit={() => navigation.goBack()}
          onChangeSetup={() => setConfig(null)}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.setup, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {/* Online: random opponent */}
          <View style={styles.hero}>
            <LinearGradient colors={['rgba(124,140,255,0.28)', 'rgba(255,46,99,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={styles.heroGlyph} allowFontScaling={false}>♞</Text>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>ONLINE</Text>
            </View>
            <Text style={styles.heroTitle}>Play anyone, anywhere</Text>
            <Text style={styles.heroBody}>We’ll match you with a player near your rating. See their profile, chat and video call during the game.</Text>

            {searching ? (
              <SearchPanel mm={mm} rating={stats?.chess?.rating} onCancel={mm.cancel} onInvite={inviteFriends} />
            ) : mm.status === 'matched' && mm.match ? (
              <View style={styles.found}>
                <PlayerAvatar uri={mm.match.opponent?.avatar} name={mm.match.opponent?.name} size={52} ring={AC.live} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.foundLabel}>OPPONENT FOUND</Text>
                  <Text style={styles.foundName} numberOfLines={1}>{mm.match.opponent?.name || 'Opponent'}</Text>
                  <Text style={styles.caption}>Setting up the board…</Text>
                </View>
              </View>
            ) : (
              <>
                <PlayButton title="Play online — Find opponent" icon="flash" onPress={findOpponent} style={{ marginTop: 18 }} />
                {mm.status === 'error' && mm.error ? <Text style={styles.error}>{mm.error}</Text> : null}
                {mm.notice ? <Text style={styles.notice}>{mm.notice}</Text> : null}
              </>
            )}

            <View style={styles.heroLinks}>
              <GhostButton title="Invite friends" icon="person-add" small onPress={inviteFriends} style={{ flex: 1 }} />
              <GhostButton title="Join with code" icon="keypad" small onPress={joinWithCode} style={{ flex: 1 }} />
            </View>
          </View>

          {stats && (
            <View style={styles.statsRow}>
              <StatTile label="Rating" value={stats.chess.rating} accent={AC.gold} />
              <StatTile label="Peak" value={stats.chess.peakRating} />
              <StatTile label="Rated games" value={stats.chess.ratedGames} />
            </View>
          )}

          <SectionHeader title="Play offline" />
          <View style={styles.modeRow}>
            <ModeCard active={offlineMode === 'ai'} onPress={() => setOfflineMode('ai')} icon="hardware-chip" title="vs Computer" body="Rated games vs the engine" />
            <ModeCard active={offlineMode === 'local'} onPress={() => setOfflineMode('local')} icon="people" title="Pass & Play" body="Two players, one phone" />
          </View>

          {offlineMode === 'ai' ? (
            <View style={styles.options}>
              <Text style={styles.label}>Difficulty</Text>
              <View style={styles.segment}>
                {DIFFICULTIES.map((d) => (
                  <Segment key={d} on={difficulty === d} onPress={() => setDifficulty(d)} label={DIFFICULTY_LABELS[d]} sub={`~${CHESS_AI_RATINGS[d]}`} />
                ))}
              </View>
              {stats?.chess?.vsAI?.[difficulty] ? (
                <Text style={[styles.caption, { marginTop: 8 }]}>
                  Record vs {DIFFICULTY_LABELS[difficulty]}: {stats.chess.vsAI[difficulty].w}W · {stats.chess.vsAI[difficulty].l}L · {stats.chess.vsAI[difficulty].d}D
                </Text>
              ) : null}
              <Text style={[styles.label, { marginTop: 16 }]}>Play as</Text>
              <View style={styles.chips}>
                {COLOR_OPTIONS.map((o) => <Chip key={o.key} label={o.label} active={colorChoice === o.key} onPress={() => setColorChoice(o.key)} />)}
              </View>
            </View>
          ) : (
            <View style={styles.options}>
              <Text style={styles.caption}>White moves first. After each move, hand the phone to the other player.</Text>
            </View>
          )}

          <GhostButton title={offlineMode === 'ai' ? 'Start vs Computer' : 'Start Pass & Play'} icon="play" onPress={startOffline} style={{ marginTop: 12 }} />
        </ScrollView>
      )}
    </View>
  )
}

function SearchPanel({ mm, rating, onCancel, onInvite }) {
  const [now, setNow] = useState(Date.now())
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => { clearInterval(t); loop.stop() }
  }, [pulse])
  const elapsed = Math.max(0, now - (mm.startedAt || now))
  const secs = Math.floor(elapsed / 1000)
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const slow = elapsed > SLOW_SEARCH_MS
  const label = mm.status === 'connecting' ? 'Joining the queue…'
    : mm.status === 'proposing' || mm.status === 'joining' ? 'Opponent found — connecting…'
      : slow ? 'Still searching…' : 'Finding an opponent…'
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] })

  return (
    <View style={styles.search}>
      <View style={styles.searchTop}>
        <View style={styles.radar}>
          <Animated.View style={[styles.radarRing, { transform: [{ scale }], opacity }]} />
          <View style={styles.radarCore}><Ionicons name="search" size={18} color="#fff" /></View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.searchTitle}>{label}</Text>
          <Text style={styles.caption}>
            {clock}
            {mm.waitingCount > 0 ? ` · ${mm.waitingCount} other${mm.waitingCount === 1 ? '' : 's'} searching` : ''}
            {rating ? ` · your rating ${rating}` : ''}
          </Text>
        </View>
      </View>
      {slow ? (
        <View style={styles.slow}>
          <Text style={styles.slowText}>Not many players online right now. Keep waiting, or invite a friend to play.</Text>
          <GhostButton title="Invite friends instead" icon="person-add" small onPress={onInvite} style={{ marginTop: 10 }} />
        </View>
      ) : null}
      <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel search</Text>
      </Pressable>
    </View>
  )
}

function makeConfig(mode, difficulty, color) {
  const resolved = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color === 'b' ? 'b' : 'w'
  return { id: `${Date.now()}`, mode: mode === 'local' ? 'local' : 'ai', difficulty, color: mode === 'local' ? 'w' : resolved }
}

function ModeCard({ active, onPress, title, body, icon }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.modeCard, active && styles.modeCardActive]}>
        {active ? <LinearGradient colors={['rgba(143,123,255,0.30)', 'rgba(91,108,240,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
        <View style={[styles.modeIcon, active && { backgroundColor: AC.accent }]}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
        <Text style={styles.modeTitle}>{title}</Text>
        <Text style={styles.caption} numberOfLines={2}>{body}</Text>
      </View>
    </Pressable>
  )
}

function Segment({ on, onPress, label, sub }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {on ? (
        <LinearGradient colors={AC.play} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.segBtn}>
          <Text style={[styles.segText, { color: '#fff' }]}>{label}</Text>
          {sub ? <Text style={[styles.segSub, { color: 'rgba(255,255,255,0.8)' }]}>{sub}</Text> : null}
        </LinearGradient>
      ) : (
        <View style={[styles.segBtn, styles.segIdle]}>
          <Text style={styles.segText}>{label}</Text>
          {sub ? <Text style={styles.segSub}>{sub}</Text> : null}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle: { flex: 1, fontSize: 22, ...font.heavy, color: AC.text, letterSpacing: -0.4 },
  headerRating: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,201,77,0.14)', borderWidth: 1, borderColor: 'rgba(255,201,77,0.3)' },
  headerRatingText: { fontSize: 14, ...font.heavy, color: AC.gold },
  setup: { paddingHorizontal: 16, paddingTop: 8 },
  hero: { borderRadius: 28, padding: 20, overflow: 'hidden', backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  heroGlyph: { position: 'absolute', right: -6, top: -18, fontSize: 150, color: 'rgba(255,255,255,0.07)' },
  liveRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AC.live },
  liveText: { fontSize: 11, ...font.heavy, color: '#fff', letterSpacing: 1 },
  heroTitle: { fontSize: 26, ...font.heavy, color: AC.text, letterSpacing: -0.6, marginTop: 12 },
  heroBody: { fontSize: 14, ...font.regular, color: AC.muted, marginTop: 6, lineHeight: 20 },
  heroLinks: { flexDirection: 'row', gap: 10, marginTop: 12 },
  error: { fontSize: 13, ...font.semibold, color: AC.danger, marginTop: 10, textAlign: 'center' },
  notice: { fontSize: 13, ...font.medium, color: AC.muted, marginTop: 10, textAlign: 'center' },
  search: { marginTop: 18, padding: 14, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: AC.border },
  searchTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  radar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  radarRing: { position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: AC.accent },
  radarCore: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#5b6cf0', alignItems: 'center', justifyContent: 'center' },
  searchTitle: { fontSize: 17, ...font.bold, color: AC.text },
  slow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AC.border },
  slowText: { fontSize: 13, ...font.regular, color: AC.muted, lineHeight: 18 },
  cancel: { alignSelf: 'center', marginTop: 12, paddingVertical: 6, paddingHorizontal: 12 },
  cancelText: { fontSize: 14, ...font.semibold, color: AC.muted },
  found: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, padding: 14, borderRadius: 20, backgroundColor: 'rgba(47,220,143,0.10)', borderWidth: 1, borderColor: 'rgba(47,220,143,0.35)' },
  foundLabel: { fontSize: 11, ...font.heavy, color: AC.live, letterSpacing: 1.2 },
  foundName: { fontSize: 19, ...font.bold, color: AC.text, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeCard: { padding: 14, borderRadius: 20, overflow: 'hidden', backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border, minHeight: 118 },
  modeCardActive: { borderColor: AC.accent },
  modeIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: AC.cardStrong, marginBottom: 10 },
  modeTitle: { fontSize: 16, ...font.bold, color: AC.text, marginBottom: 2 },
  caption: { fontSize: 13, ...font.regular, color: AC.muted },
  label: { fontSize: 11, ...font.bold, color: AC.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  options: { marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { paddingVertical: 10, borderRadius: 14, alignItems: 'center' },
  segIdle: { backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  segText: { fontSize: 15, ...font.bold, color: AC.text },
  segSub: { fontSize: 11, ...font.medium, color: AC.faint, marginTop: 1 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
