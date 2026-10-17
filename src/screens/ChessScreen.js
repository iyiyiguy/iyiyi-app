import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { ChessGame } from '../games/ChessGame'
import {
  AC, ArcadeBackground, Chip, GhostButton, IconCircle, PlayButton, SectionHeader, StatTile,
  useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { PlayerAvatar } from '../components/OpponentCard'
import { FONT, ST, stType, withAlpha } from '../games/studio'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../lib/chessAI'
import { loadArcadeStats, CHESS_AI_RATINGS } from '../lib/arcadeStats'
import { SLOW_SEARCH_MS, useChessMatchmaking } from '../lib/chessMatchmaking'
import { buzz } from '../lib/gamePrefs'
import { translate, useT } from '../i18n'
import C from '../i18n/strings/chess'

const COLOR_OPTIONS = [
  { key: 'w', get label() { return translate(C, 'white') } },
  { key: 'b', get label() { return translate(C, 'black') } },
  { key: 'random', get label() { return translate(C, 'random') } },
]

const SEARCHING = ['connecting', 'searching', 'proposing', 'joining']
// Matchmaking notices arrive in English (lib/chessMatchmaking); show the known ones translated.
const MM_TEXT = {
  'No one is searching right now. Try again in a bit, or invite a friend.': 'mm_no_one',
  'Search paused while the app was in the background.': 'mm_paused',
  'Matchmaking failed.': 'mm_failed',
}
const mmText = (s) => (MM_TEXT[s] ? translate(C, MM_TEXT[s]) : s)

// Route params (all optional): { mode: 'ai'|'local'|'online', difficulty, color: 'w'|'b'|'random' }.
// With mode 'ai' / 'local' the game starts immediately; otherwise the lobby is shown.
export default function ChessScreen({ navigation, route }) {
  useArcadeStatusBar()
  const t = useT(C)
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
    const tm = setTimeout(() => {
      const room = mm.takeRoom()
      if (!room) return
      navigation.navigate('GamePlayScreen', { gameId: 'chess', gameName: translate(C, 'chess'), code })
    }, 900)
    return () => clearTimeout(tm)
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

  // Two separate ratings: vs the computer, and online (kept on this device).
  const online = stats?.chess?.online
  const onlineRating = online?.games > 0 ? `${online.rating}${online.games < 5 ? '?' : ''}` : '—'
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <IconCircle icon="chevron-back" label={t('back')} onPress={() => navigation.goBack()} size={40} />
      <Text style={styles.headerTitle} numberOfLines={1}>{config ? (config.mode === 'ai' ? t('vs_x_ai', { level: DIFFICULTY_LABELS[config.difficulty] }) : t('pass_play')) : t('chess')}</Text>
      {stats ? (
        <View style={styles.headerRating} accessibilityLabel={config ? `${t('rating_vs_ai')} ${stats.chess.rating}` : `${t('online_rating')} ${onlineRating}`}>
          <Ionicons name={config ? 'hardware-chip' : 'globe-outline'} size={12} color={AC.gold} />
          <Text style={styles.headerRatingText}>{config ? stats.chess.rating : onlineRating}</Text>
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
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{t('online_caps')}</Text>
            </View>
            <Text style={styles.heroTitle}>{t('play_anyone')}</Text>
            <Text style={styles.heroBody}>{t('match_body')}</Text>

            {searching ? (
              <SearchPanel mm={mm} rating={online?.games > 0 ? onlineRating : null} onCancel={mm.cancel} onInvite={inviteFriends} />
            ) : mm.status === 'matched' && mm.match ? (
              <View style={styles.found}>
                <PlayerAvatar uri={mm.match.opponent?.avatar} name={mm.match.opponent?.name} size={52} ring={ST.health} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.foundLabel}>{t('opp_found')}</Text>
                  <Text style={styles.foundName} numberOfLines={1}>{mm.match.opponent?.name || t('opponent')}</Text>
                  <Text style={styles.caption}>{t('setting_up_dots')}</Text>
                </View>
              </View>
            ) : (
              <>
                <PlayButton title={t('find_opponent')} icon="flash" onPress={findOpponent} style={{ marginTop: 18 }} />
                {mm.status === 'error' && mm.error ? <Text style={styles.error}>{mmText(mm.error)}</Text> : null}
                {mm.notice ? <Text style={styles.notice}>{mmText(mm.notice)}</Text> : null}
              </>
            )}

            <View style={styles.heroLinks}>
              <GhostButton title={t('invite_friends')} icon="person-add" small onPress={inviteFriends} style={{ flex: 1 }} />
              <GhostButton title={t('join_code')} icon="keypad" small onPress={joinWithCode} style={{ flex: 1 }} />
            </View>
          </View>

          {stats && (
            <>
              <View style={styles.statsRow}>
                <StatTile label={t('online')} value={onlineRating} accent={AC.gold} />
                <StatTile label={t('vs_ai')} value={stats.chess.rating} />
                <StatTile label={t('online_games')} value={online?.games || 0} />
              </View>
              <Text style={[styles.caption, { marginTop: 6 }]}>
                {online?.games > 0 ? t('online_summary', { w: online.w, l: online.l, d: online.d, peak: online.peakRating }) : t('online_summary_none')} {t('ai_summary', { peak: stats.chess.peakRating, n: stats.chess.ratedGames })}
              </Text>
            </>
          )}

          <SectionHeader title={t('play_offline')} />
          <View style={styles.modeRow}>
            <ModeCard active={offlineMode === 'ai'} onPress={() => setOfflineMode('ai')} icon="hardware-chip" title={t('vs_computer')} body={t('rated_vs_engine')} />
            <ModeCard active={offlineMode === 'local'} onPress={() => setOfflineMode('local')} icon="people" title={t('pass_play')} body={t('two_players_phone')} />
          </View>

          {offlineMode === 'ai' ? (
            <View style={styles.options}>
              <Text style={styles.label}>{t('difficulty')}</Text>
              <View style={styles.segment}>
                {DIFFICULTIES.map((d) => (
                  <Segment key={d} on={difficulty === d} onPress={() => setDifficulty(d)} label={DIFFICULTY_LABELS[d]} sub={`~${CHESS_AI_RATINGS[d]}`} />
                ))}
              </View>
              {stats?.chess?.vsAI?.[difficulty] ? (
                <Text style={[styles.caption, { marginTop: 8 }]}>
                  {t('record_vs', { level: DIFFICULTY_LABELS[difficulty], w: stats.chess.vsAI[difficulty].w, l: stats.chess.vsAI[difficulty].l, d: stats.chess.vsAI[difficulty].d })}
                </Text>
              ) : null}
              <Text style={[styles.label, { marginTop: 16 }]}>{t('play_as')}</Text>
              <View style={styles.chips}>
                {COLOR_OPTIONS.map((o) => <Chip key={o.key} label={o.label} active={colorChoice === o.key} onPress={() => setColorChoice(o.key)} />)}
              </View>
            </View>
          ) : (
            <View style={styles.options}>
              <Text style={styles.caption}>{t('pass_hint')}</Text>
            </View>
          )}

          <GhostButton title={offlineMode === 'ai' ? t('start_vs_computer') : t('start_pass_play')} icon="play" onPress={startOffline} style={{ marginTop: 12 }} />
        </ScrollView>
      )}
    </View>
  )
}

function SearchPanel({ mm, rating, onCancel, onInvite }) {
  const t = useT(C)
  const [now, setNow] = useState(Date.now())
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => { clearInterval(iv); loop.stop() }
  }, [pulse])
  const elapsed = Math.max(0, now - (mm.startedAt || now))
  const secs = Math.floor(elapsed / 1000)
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const slow = elapsed > SLOW_SEARCH_MS
  const label = mm.status === 'connecting' ? t('joining_queue')
    : mm.status === 'proposing' || mm.status === 'joining' ? t('found_connecting')
      : slow ? t('still_searching') : t('finding_opponent')
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] })

  return (
    <View style={styles.search}>
      <View style={styles.searchTop}>
        <View style={styles.radar}>
          <Animated.View style={[styles.radarRing, { transform: [{ scale }], opacity }]} />
          <View style={styles.radarCore}><Ionicons name="search" size={18} color={ST.ink} /></View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.searchTitle}>{label}</Text>
          <Text style={styles.caption}>
            {clock}
            {mm.waitingCount > 0 ? ` · ${t(mm.waitingCount === 1 ? 'others_searching_one' : 'others_searching', { n: mm.waitingCount })}` : ''}
            {rating ? ` · ${t('online_rating_lc', { r: rating })}` : ''}
          </Text>
        </View>
      </View>
      {slow ? (
        <View style={styles.slow}>
          <Text style={styles.slowText}>{t('not_many_online')}</Text>
          <GhostButton title={t('invite_instead')} icon="person-add" small onPress={onInvite} style={{ marginTop: 10 }} />
        </View>
      ) : null}
      <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]} accessibilityRole="button">
        <Text style={styles.cancelText}>{t('cancel_search')}</Text>
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
        <View style={[styles.modeIcon, active && { backgroundColor: ST.friendly }]}>
          <Ionicons name={icon} size={18} color={active ? ST.ink : ST.text} />
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
        <View style={[styles.segBtn, styles.segOn]}>
          <Text style={[styles.segText, { color: ST.ink }]}>{label}</Text>
          {sub ? <Text style={[styles.segSub, { color: 'rgba(7,9,12,0.7)' }]}>{sub}</Text> : null}
        </View>
      ) : (
        <View style={[styles.segBtn, styles.segIdle]}>
          <Text style={styles.segText}>{label}</Text>
          {sub ? <Text style={styles.segSub}>{sub}</Text> : null}
        </View>
      )}
    </Pressable>
  )
}

const LABEL = { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle: { flex: 1, fontFamily: FONT.display, fontSize: 20, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  headerRating: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 32, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.objective },
  headerRatingText: { fontFamily: FONT.display, fontSize: 14, color: ST.objective, fontVariant: ['tabular-nums'], includeFontPadding: false },
  setup: { paddingHorizontal: 16, paddingTop: 8 },
  hero: { borderRadius: ST.radius, padding: 18, overflow: 'hidden', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.friendly },
  liveRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 8, height: 22, borderRadius: 2, borderWidth: 1, borderColor: withAlpha(ST.health, 0.5) },
  liveDot: { width: 6, height: 6, backgroundColor: ST.health },
  liveText: { ...LABEL, color: ST.health },
  heroTitle: { fontFamily: FONT.display, fontSize: 24, letterSpacing: 0.8, color: ST.text, textTransform: 'uppercase', marginTop: 12, includeFontPadding: false },
  heroBody: { ...stType.body, color: ST.muted, marginTop: 6 },
  heroLinks: { flexDirection: 'row', gap: 10, marginTop: 12 },
  error: { fontFamily: FONT.uiSemi, fontSize: 13, color: ST.enemy, marginTop: 10, textAlign: 'center' },
  notice: { fontFamily: FONT.uiMedium, fontSize: 13, color: ST.muted, marginTop: 10, textAlign: 'center' },
  search: { marginTop: 18, padding: 14, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line },
  searchTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  radar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  radarRing: { position: 'absolute', width: 48, height: 48, borderRadius: ST.radius, borderWidth: 2, borderColor: ST.friendly },
  radarCore: { width: 40, height: 40, borderRadius: ST.radius, backgroundColor: ST.friendly, alignItems: 'center', justifyContent: 'center' },
  searchTitle: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  slow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: ST.line },
  slowText: { ...stType.small },
  cancel: { alignSelf: 'center', marginTop: 12, paddingVertical: 8, paddingHorizontal: 12 },
  cancelText: { ...LABEL, fontSize: 12, color: ST.muted },
  found: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, padding: 14, borderRadius: ST.radius, backgroundColor: withAlpha(ST.health, 0.08), borderWidth: 1, borderColor: withAlpha(ST.health, 0.4) },
  foundLabel: { ...LABEL, color: ST.health },
  foundName: { fontFamily: FONT.display, fontSize: 19, color: ST.text, marginTop: 2, includeFontPadding: false },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeCard: { padding: 14, borderRadius: ST.radius, overflow: 'hidden', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, minHeight: 118 },
  modeCardActive: { borderColor: ST.friendly, backgroundColor: withAlpha(ST.friendly, 0.08) },
  modeIcon: { width: 34, height: 34, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.cell, marginBottom: 10 },
  modeTitle: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', marginBottom: 2, includeFontPadding: false },
  caption: { fontFamily: FONT.uiMedium, fontSize: 13, lineHeight: 17, color: ST.muted },
  label: { ...LABEL, color: ST.muted, marginBottom: 8 },
  options: { marginTop: 12, padding: 16, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { paddingVertical: 9, borderRadius: ST.radius, alignItems: 'center', borderWidth: 1 },
  segOn: { backgroundColor: ST.friendly, borderColor: ST.friendly },
  segIdle: { backgroundColor: ST.cell, borderColor: ST.line },
  segText: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 0.8, textTransform: 'uppercase', color: ST.text, includeFontPadding: false },
  segSub: { fontFamily: FONT.uiSemi, fontSize: 11, color: ST.faint, marginTop: 1, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
