import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Image, Platform, useWindowDimensions } from 'react-native'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { GAMES, ARCADE_CATEGORIES, playersLabel } from '../lib/games'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, rankFor } from '../lib/arcadeStats'
import { getMyProfile, useLiveCounts } from '../lib/multiplayer'
import { formatOnlineRating } from '../lib/chessMatchmaking'
import { ensureOwnerUnlocks } from '../lib/guns'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, ArcadePanel as Glass, Chip, CoinPill, CoverArt, IconCircle, LiveBadge, PlayButton, SectionHeader, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { useUavInventory } from '../lib/uav'
import { FONT, ST, StBar, stType, withAlpha } from '../games/studio'
import { avatarSource } from '../lib/avatarSource'

// The Arcade tab: a game hub. No back button — it's a bottom tab.
export default function GamesScreen({ navigation }) {
  const insets = useArcadeInsets()
  const uavInv = useUavInventory()
  const { width } = useWindowDimensions()
  const [headerH, setHeaderH] = useState(0)
  const focused = useIsFocused()
  const [stats, setStats] = useState(null)
  const [me, setMe] = useState(null)
  const [owner, setOwner] = useState(false)
  const [category, setCategory] = useState('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [slide, setSlide] = useState(0)
  const live = useLiveCounts(focused)
  useArcadeStatusBar()

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setStats(s) }).catch(() => {})
    ensureOwnerUnlocks().then((o) => { if (alive) setOwner(!!o) }).catch(() => {})
    getMyProfile().then((p) => { if (alive) setMe(p) }).catch(() => {})
    return () => { alive = false }
  }, []))
  useEffect(() => subscribeArcadeStats(setStats), [])

  const openGame = (game) => {
    if (Platform.OS === 'web' && game.mobileOnly) {
      const msg = `${game.name} uses your phone's camera and GPS, so it's only in the iYiYi mobile app.`
      if (typeof window !== 'undefined' && window.confirm(`${msg}\n\nOpen the App Store?`)) {
        window.open('https://apps.apple.com/app/id6445996160', '_blank')
      }
      return
    }
    buzz('select')
    if (game.route === 'GameLobby') navigation.navigate('GameLobby', { gameId: game.mpId })
    else navigation.navigate(game.route)
  }

  const liveFor = (g) => (g.mpId ? live[g.mpId] || 0 : 0)
  const statsFor = (id) => {
    if (!stats) return null
    const g = stats.games[id]
    if (id !== 'chess') return g
    // Two chess ratings: vs the computer, and online (Elo between people).
    const on = stats.chess.online || {}
    return { ...g, rating: stats.chess.rating, aiRated: stats.chess.ratedGames || 0, onlineRating: on.rating, onlineGames: on.games || 0 }
  }

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => GAMES.filter((g) =>
    (category === 'all' || g.categories.includes(category)) &&
    (!q || g.name.toLowerCase().includes(q) || (g.tagline || '').toLowerCase().includes(q) || g.categories.some((c) => c.includes(q))),
  ), [category, q])

  // Hero carousel: featured first, then most played right now.
  const heroes = useMemo(() => {
    const list = [...visible].sort((a, b) => (Number(!!b.featured) - Number(!!a.featured)) || (liveFor(b) - liveFor(a)))
    return list.slice(0, 4)
  }, [visible, live]) // eslint-disable-line react-hooks/exhaustive-deps

  const recent = useMemo(() => {
    if (!stats) return []
    return GAMES
      .filter((g) => stats.games[g.id]?.lastPlayed)
      .sort((a, b) => String(stats.games[b.id].lastPlayed).localeCompare(String(stats.games[a.id].lastPlayed)))
      .slice(0, 6)
  }, [stats])

  const rank = rankFor(stats?.lifetimePoints || 0)
  const totals = stats ? totalsFor(stats) : null
  const cardW = width - 40
  // Hero: badge row, then the whole (square) cover, then title / tagline / Play underneath.
  const heroArtH = Math.max(160, Math.min(280, Math.round(cardW * 0.72)))
  const heroH = HERO_BADGE_H + heroArtH + HERO_INFO_H
  const gridW = (width - 40 - 14) / 2
  const scrollRef = useRef(null)

  useEffect(() => { setSlide(0); scrollRef.current?.scrollTo?.({ x: 0, animated: false }) }, [category, q])

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: (headerH || insets.top + 72) + 4, paddingBottom: insets.bottom + 140 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.pad}>
          <Text style={styles.pageKicker}>iYiYi Games</Text>
          <Text style={[arcadeText.display, { marginTop: 2 }]}>Arcade</Text>
          <Text style={[arcadeText.caption, { fontVariant: ['tabular-nums'] }]}>
            {totals ? `${totals.played} played · ${totals.winRate != null ? `${totals.winRate}% wins · ` : ''}${rank.xp.toLocaleString()} XP` : 'Play together in the real world'}
          </Text>

          {searchOpen && (
            <Glass style={styles.search}>
              <Ionicons name="search" size={18} color={AC.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search games"
                placeholderTextColor={AC.faint}
                selectionColor={ST.friendly}
                keyboardAppearance="dark"
                style={styles.searchInput}
                autoFocus
                returnKeyType="search"
                autoCorrect={false}
              />
            </Glass>
          )}
        </View>

        {/* Categories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {ARCADE_CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.name} active={category === c.id} onPress={() => { buzz('select'); setCategory(c.id) }} />
          ))}
        </ScrollView>

        {/* Featured / trending hero carousel */}
        {heroes.length > 0 ? (
          <>
            <ScrollView
              ref={scrollRef}
              horizontal
              decelerationRate="fast"
              snapToInterval={cardW + 12}
              snapToAlignment="start"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              onMomentumScrollEnd={(e) => setSlide(Math.max(0, Math.round(e.nativeEvent.contentOffset.x / (cardW + 12))))}
            >
              {heroes.map((g, i) => (
                <HeroCard key={g.id} game={g} width={cardW} height={heroH} artH={heroArtH} badge={i === 0 ? 'FEATURED' : liveFor(g) > 0 ? 'TRENDING' : 'POPULAR'} live={liveFor(g)} onPress={() => openGame(g)} />
              ))}
            </ScrollView>
            {heroes.length > 1 && (
              <View style={styles.dots}>
                {heroes.map((g, i) => <View key={g.id} style={[styles.dot, i === slide && styles.dotOn]} />)}
              </View>
            )}
          </>
        ) : (
          <View style={[styles.pad, { alignItems: 'center', paddingVertical: 40 }]}>
            <Ionicons name="game-controller-outline" size={36} color={AC.faint} />
            <Text style={[arcadeText.caption, { marginTop: 8 }]}>No games match “{query}”.</Text>
          </View>
        )}

        <View style={styles.pad}>
          {/* Quick tiles */}
          <View style={styles.tiles}>
            <QuickTile icon="keypad" label="Join code" colors={[ST.friendly]} onPress={() => navigation.navigate('JoinGame')} />
            <QuickTile icon="trophy" label="Leaderboard" colors={[ST.objective]} onPress={() => navigation.navigate('GameLeaderboard')} />
            <QuickTile icon="bag-handle" label="Shop" colors={[ST.health]} onPress={() => navigation.navigate('GunShop')} />
          </View>

          {/* Continue */}
          {recent.length > 0 && !q && (
            <>
              <SectionHeader title="Continue playing" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} style={{ marginHorizontal: -20 }}>
                <View style={{ width: 8 }} />
                {recent.map((g) => (
                  <ContinueCard key={g.id} game={g} stats={statsFor(g.id)} onPress={() => openGame(g)} />
                ))}
                <View style={{ width: 8 }} />
              </ScrollView>
            </>
          )}

          {/* All games */}
          <SectionHeader title={category === 'all' ? 'All games' : ARCADE_CATEGORIES.find((c) => c.id === category)?.name} />
          <View style={styles.grid}>
            {visible.map((g) => (
              <GridCard key={g.id} game={g} width={gridW} live={liveFor(g)} stats={statsFor(g.id)} onPress={() => openGame(g)} />
            ))}
          </View>
          <Text style={styles.footer}>Get Laser Tag guns and UAVs in the Shop.</Text>
        </View>
      </ScrollView>

      {/* Player bar: pinned below the status bar / Dynamic Island, content scrolls under it. */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]} onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h && h !== headerH) setHeaderH(h) }}>
        <LinearGradient pointerEvents="none" colors={[withAlpha(ST.ground, 0.98), withAlpha(ST.ground, 0.92), withAlpha(ST.ground, 0)]} locations={[0, 0.78, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.topRow}>
          <Pressable onPress={() => navigation.navigate('PlayerProfile')} style={styles.player} accessibilityRole="button" accessibilityLabel="Your arcade profile">
            <View style={[styles.avatarRing, { borderColor: rank.color }]}>
              {me?.avatar ? (
                <Image source={avatarSource(me?.avatar)} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.center, { backgroundColor: '#3c434c' }]}>
                  <Text style={styles.avatarLetter}>{(me?.username || 'P').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={[styles.levelBadge, { backgroundColor: rank.color }]}>
                <Text style={styles.levelText}>{rank.level}</Text>
              </View>
            </View>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName} numberOfLines={1}>{me?.username || 'Player'}</Text>
              <View style={styles.rankRow}>
                <Text style={[styles.rankText, { color: rank.color }]} numberOfLines={1}>{rank.name}</Text>
                {owner ? <Text style={styles.ownerTag} numberOfLines={1}>OWNER</Text> : null}
              </View>
              <StBar value={rank.levelProgress} color={rank.color} height={3} style={styles.xpTrack} />
            </View>
          </Pressable>
          <View style={styles.topActions}>
            <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
            <Pressable onPress={() => navigation.navigate('GunShop')} style={styles.shopPill} accessibilityRole="button" accessibilityLabel="Open the shop">
              <Ionicons name="bag-handle" size={15} color={ST.ink} />
              <Text style={styles.shopPillText}>Shop</Text>
            </Pressable>
            <IconCircle icon={searchOpen ? 'close' : 'search'} label="Search games" onPress={() => { setSearchOpen((v) => !v); if (searchOpen) setQuery('') }} />
          </View>
        </View>
      </View>
    </View>
  )
}

const HERO_BADGE_H = 46
const HERO_INFO_H = 176

function HeroCard({ game, width, height, artH, badge, live, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]} accessibilityRole="button" accessibilityLabel={`Play ${game.name}`}>
      <CoverArt game={game} style={[styles.hero, { width, height }]} artStyle={{ height: artH, marginTop: HERO_BADGE_H }} glyphSize={130}>
        {/* Darkens only the strip under the art, never the art itself. */}
        <LinearGradient pointerEvents="none" colors={[withAlpha(ST.ground2, 0), withAlpha(ST.ground2, 0.9), ST.ground2]} locations={[0, 0.3, 1]} style={[styles.heroShade, { top: HERO_BADGE_H + artH - 8 }]} />
        <View style={styles.heroTop}>
          <View style={[styles.heroBadge, badge === 'TRENDING' && { backgroundColor: ST.enemy, borderColor: ST.enemy }]}><Text style={[styles.heroBadgeText, badge === 'TRENDING' && { color: '#fff' }]}>{badge}</Text></View>
          <LiveBadge count={live} />
        </View>
        <View style={styles.heroBottom}>
          <Text style={styles.heroCat} numberOfLines={1}>{game.categories.map((c) => c.toUpperCase()).join(' · ')} · {playersLabel(game).toUpperCase()}</Text>
          <Text style={styles.heroTitle} numberOfLines={1}>{game.name}</Text>
          <Text style={styles.heroTag} numberOfLines={2}>{game.tagline}</Text>
          <PlayButton title={Platform.OS === 'web' && game.mobileOnly ? 'Get the app' : game.id === 'laser-tag' ? 'Play Now' : 'Play'} onPress={onPress} style={{ marginTop: 12 }} small />
        </View>
      </CoverArt>
    </Pressable>
  )
}

function statLine(game, s) {
  if (!s || !s.played) return 'New'
  if (game.id === 'chess') {
    // Online is the rating that represents you against people; vs AI until you've played online.
    if (s.onlineGames > 0) return `Online ${formatOnlineRating(s.onlineRating, s.onlineGames) ?? '—'}`
    return s.aiRated > 0 ? `vs AI ${s.rating ?? '—'}` : 'Unrated'
  }
  if (game.id === 'word-race') return `Best ${s.bestScore ?? 0}`
  return `${s.wins}W · ${s.played} played`
}

function ContinueCard({ game, stats, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }} accessibilityRole="button" accessibilityLabel={`Continue ${game.name}`}>
      <Glass style={styles.cont}>
        <CoverArt game={game} style={styles.contArt} glyphSize={30} />
        <View style={{ flex: 1 }}>
          <Text style={styles.contName} numberOfLines={1}>{game.name}</Text>
          <Text style={styles.contStat} numberOfLines={1}>{statLine(game, stats)}</Text>
        </View>
        <View style={styles.contPlay}><Ionicons name="play" size={14} color={ST.ink} /></View>
      </Glass>
    </Pressable>
  )
}

// Square cover shown whole, name and stats underneath it.
// Web app: camera / GPS games are phone-only.
function MobileOnlyBadge() {
  return (
    <View style={styles.mobileOnly} pointerEvents="none">
      <Ionicons name="phone-portrait-outline" size={11} color="#fff" />
      <Text style={styles.mobileOnlyText}>Mobile app</Text>
    </View>
  )
}

function GridCard({ game, width, live, stats, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width, marginBottom: 14, transform: [{ scale: pressed ? 0.97 : 1 }] }]} accessibilityRole="button" accessibilityLabel={`Open ${game.name}`}>
      <CoverArt game={game} style={[styles.gridCard, { height: width + GRID_INFO_H }]} artStyle={{ height: width }} glyphSize={72}>
        <View pointerEvents="none" style={[styles.gridShade, { top: width }]} />
        {Platform.OS === 'web' && game.mobileOnly ? <MobileOnlyBadge /> : null}
        <View style={styles.gridInfo}>
          <Text style={styles.gridName} numberOfLines={1}>{game.name}</Text>
          {live > 0 ? (
            <View style={styles.gridLive}>
              <View style={styles.gridLiveDot} />
              <Text style={[styles.gridMeta, { marginTop: 0, color: AC.live }]} numberOfLines={1}>{live} playing</Text>
            </View>
          ) : (
            <Text style={styles.gridMeta} numberOfLines={1}>{playersLabel(game)} · {statLine(game, stats)}</Text>
          )}
        </View>
      </CoverArt>
    </Pressable>
  )
}

const GRID_INFO_H = 58

function QuickTile({ icon, label, colors, onPress }) {
  return (
    <Pressable onPress={() => { buzz('select'); onPress() }} style={({ pressed }) => [{ flex: 1, transform: [{ scale: pressed ? 0.95 : 1 }] }]} accessibilityRole="button" accessibilityLabel={label}>
      <Glass style={[styles.tile, { borderTopColor: colors[0] }]}>
        <View style={styles.tileIcon}>
          <Ionicons name={icon} size={20} color={colors[0]} />
        </View>
        <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      </Glass>
    </Pressable>
  )
}

const LABEL = { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' }

const styles = StyleSheet.create({
  shopPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 10, borderRadius: ST.radius,
    backgroundColor: ST.health, borderWidth: 1, borderColor: ST.health,
  },
  shopPillText: { fontFamily: FONT.display, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: ST.ink, includeFontPadding: false },
  screen: { flex: 1, backgroundColor: ST.ground },
  pad: { paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pageKicker: { ...stType.kicker, fontSize: 10, letterSpacing: 2, marginTop: 8 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // Name / rank / OWNER column takes the leftover width and truncates; the pills on the right
  // never shrink, so nothing overlaps even with a long username on a small iPhone.
  player: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerInfo: { flex: 1, minWidth: 0 },
  avatarRing: { width: 48, height: 48, borderRadius: ST.radius, borderBottomWidth: 3, overflow: 'visible' },
  avatar: { width: 48, height: 45, borderTopLeftRadius: ST.radius, borderTopRightRadius: ST.radius },
  avatarLetter: { fontFamily: FONT.display, fontSize: 20, color: ST.text, includeFontPadding: false },
  levelBadge: { position: 'absolute', right: -6, bottom: -6, minWidth: 20, height: 16, borderRadius: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ST.ground },
  levelText: { fontFamily: FONT.display, fontSize: 10, color: ST.ink, includeFontPadding: false },
  playerName: { fontFamily: FONT.display, fontSize: 15, color: ST.text, includeFontPadding: false },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rankText: { ...LABEL, flexShrink: 1 },
  ownerTag: { ...LABEL, fontSize: 9, letterSpacing: 1.2, color: ST.ink, backgroundColor: ST.objective, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, overflow: 'hidden', flexShrink: 0 },
  xpTrack: { width: '100%', maxWidth: 110, marginTop: 5 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 14 },
  searchInput: { flex: 1, fontFamily: FONT.uiSemi, fontSize: 16, color: ST.text, height: 46, paddingVertical: 0 },
  chips: { paddingHorizontal: 20, gap: 8, paddingTop: 16, paddingBottom: 18 },
  hero: { borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line },
  heroTop: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: { backgroundColor: '#ffffff', borderColor: '#ffffff', borderWidth: 1, paddingHorizontal: 8, height: 22, justifyContent: 'center', borderRadius: 2 },
  heroBadgeText: { ...LABEL, fontSize: 10, color: ST.ink },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroBottom: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  heroCat: { ...stType.kicker, fontSize: 10, letterSpacing: 1.8 },
  heroTitle: { fontFamily: FONT.display, fontSize: 26, letterSpacing: 1.2, color: ST.text, textTransform: 'uppercase', marginTop: 4, includeFontPadding: false },
  heroTag: { fontFamily: FONT.uiSemi, fontSize: 14, lineHeight: 19, color: 'rgba(242,244,247,0.8)', marginTop: 4, minHeight: 38 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 12 },
  dot: { width: 14, height: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotOn: { width: 24, backgroundColor: ST.friendly },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 22 },
  tile: { alignItems: 'center', paddingVertical: 12, gap: 6, borderTopWidth: 2 },
  tileIcon: { width: 38, height: 38, borderRadius: ST.radius, backgroundColor: ST.cell, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...LABEL, fontSize: 11, letterSpacing: 1.4, color: ST.text },
  cont: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, paddingRight: 12, width: 250 },
  contArt: { width: 56, height: 56, borderRadius: 2 },
  contName: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 0.4, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  contStat: { ...LABEL, color: ST.muted, marginTop: 4 },
  contPlay: { width: 30, height: 30, borderRadius: ST.radius, backgroundColor: ST.friendly, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridCard: { borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line },
  gridShade: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: ST.panelStrong },
  gridInfo: { paddingHorizontal: 10, paddingTop: 9 },
  gridLive: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  gridLiveDot: { width: 6, height: 6, backgroundColor: ST.health },
  gridName: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 0.4, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  gridMeta: { ...LABEL, color: ST.muted, marginTop: 4 },
  footer: { fontFamily: FONT.uiMedium, fontSize: 12, color: ST.faint, textAlign: 'center', marginTop: 10 },
  mobileOnly: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, height: 20, borderRadius: 2,
    backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line,
  },
  mobileOnlyText: { ...LABEL, fontSize: 9, letterSpacing: 1.2, color: ST.text },
})
