import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Image, Platform, useWindowDimensions } from 'react-native'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import Glass from '../components/Glass'
import { GAMES, ARCADE_CATEGORIES, playersLabel } from '../lib/games'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, rankFor } from '../lib/arcadeStats'
import { getMyProfile, useLiveCounts } from '../lib/multiplayer'
import { ensureOwnerUnlocks } from '../lib/guns'
import { buzz } from '../lib/gamePrefs'
import {
  AC, ArcadeBackground, Chip, CoinPill, CoverArt, IconCircle, LiveBadge, PlayButton, SectionHeader, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { useUavInventory } from '../lib/uav'
import { font } from '../theme'

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
    return id === 'chess' ? { ...g, rating: stats.chess.rating } : g
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
          <Text style={[arcadeText.display, { marginTop: 8 }]}>Arcade</Text>
          <Text style={arcadeText.caption}>
            {totals ? `${totals.played} played · ${totals.winRate != null ? `${totals.winRate}% wins · ` : ''}${rank.xp.toLocaleString()} XP` : 'Play together in the real world'}
          </Text>

          {searchOpen && (
            <Glass scheme="dark" radius={18} shadow={false} style={styles.search}>
              <Ionicons name="search" size={18} color={AC.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search games"
                placeholderTextColor={AC.faint}
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
            <QuickTile icon="keypad" label="Join code" colors={['#3a4bd9', '#6b3ad9']} onPress={() => navigation.navigate('JoinGame')} />
            <QuickTile icon="trophy" label="Leaderboard" colors={['#d99a2b', '#d9512b']} onPress={() => navigation.navigate('GameLeaderboard')} />
            <QuickTile icon="bag-handle" label="Shop" colors={['#1fae84', '#1f7aae']} onPress={() => navigation.navigate('GunShop')} />
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
          <Text style={styles.footer}>Earn coins by playing. Spend them on Laser Tag gear in the Shop — no real money, ever.</Text>
        </View>
      </ScrollView>

      {/* Player bar: pinned below the status bar / Dynamic Island, content scrolls under it. */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]} onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h && h !== headerH) setHeaderH(h) }}>
        <LinearGradient pointerEvents="none" colors={['rgba(4,5,13,0.97)', 'rgba(4,5,13,0.9)', 'rgba(4,5,13,0)']} locations={[0, 0.78, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.topRow}>
          <Pressable onPress={() => navigation.navigate('PlayerProfile')} style={styles.player} accessibilityRole="button" accessibilityLabel="Your arcade profile">
            <View style={[styles.avatarRing, { borderColor: rank.color }]}>
              {me?.avatar ? (
                <Image source={{ uri: me.avatar }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={AC.play} style={[styles.avatar, styles.center]}>
                  <Text style={styles.avatarLetter}>{(me?.username || 'P').charAt(0).toUpperCase()}</Text>
                </LinearGradient>
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
              <View style={styles.xpTrack}>
                <LinearGradient colors={[rank.color, AC.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.xpFill, { width: `${Math.round(rank.levelProgress * 100)}%` }]} />
              </View>
            </View>
          </Pressable>
          <View style={styles.topActions}>
            <UavBalancePill balance={uavInv.balance} owner={uavInv.owner} onPress={() => openArcadeStore(navigation)} />
            <CoinPill value={stats ? stats.points : null} compact onPress={() => navigation.navigate('GunShop')} />
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
        <LinearGradient pointerEvents="none" colors={['rgba(4,5,13,0)', 'rgba(4,5,13,0.85)', 'rgba(4,5,13,0.97)']} locations={[0, 0.3, 1]} style={[styles.heroShade, { top: HERO_BADGE_H + artH - 8 }]} />
        <View style={styles.heroTop}>
          <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{badge}</Text></View>
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
  if (game.id === 'chess') return `Rating ${s.rating ?? '—'}`
  if (game.id === 'word-race') return `Best ${s.bestScore ?? 0}`
  return `${s.wins}W · ${s.played} played`
}

function ContinueCard({ game, stats, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }} accessibilityRole="button" accessibilityLabel={`Continue ${game.name}`}>
      <Glass scheme="dark" radius={22} shadow={false} style={styles.cont}>
        <CoverArt game={game} style={styles.contArt} glyphSize={30} />
        <View style={{ flex: 1 }}>
          <Text style={styles.contName} numberOfLines={1}>{game.name}</Text>
          <Text style={styles.contStat} numberOfLines={1}>{statLine(game, stats)}</Text>
        </View>
        <View style={styles.contPlay}><Ionicons name="play" size={14} color="#fff" /></View>
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
        <LinearGradient pointerEvents="none" colors={['rgba(4,5,13,0.7)', 'rgba(4,5,13,0.95)']} style={[styles.gridShade, { top: width }]} />
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
      <Glass scheme="dark" radius={22} shadow={false} style={styles.tile}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tileIcon}>
          <Ionicons name={icon} size={20} color="#fff" />
        </LinearGradient>
        <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      </Glass>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  pad: { paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // Name / rank / OWNER column takes the leftover width and truncates; the pills on the right
  // never shrink, so nothing overlaps even with a long username on a small iPhone.
  player: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerInfo: { flex: 1, minWidth: 0 },
  avatarRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, padding: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarLetter: { fontSize: 20, ...font.heavy, color: '#fff' },
  levelBadge: { position: 'absolute', right: -6, bottom: -4, minWidth: 22, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: AC.bg[0] },
  levelText: { fontSize: 10, ...font.heavy, color: '#10121f' },
  playerName: { fontSize: 16, ...font.bold, color: AC.text },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  rankText: { fontSize: 12, ...font.bold, letterSpacing: 0.4, flexShrink: 1 },
  ownerTag: { fontSize: 9, ...font.heavy, color: '#10121f', backgroundColor: AC.gold, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden', letterSpacing: 0.8, flexShrink: 0 },
  xpTrack: { width: '100%', maxWidth: 110, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 5, overflow: 'hidden' },
  xpFill: { height: 4, borderRadius: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 4, marginTop: 14 },
  searchInput: { flex: 1, fontSize: 16, color: AC.text, paddingVertical: 10 },
  chips: { paddingHorizontal: 20, gap: 8, paddingTop: 16, paddingBottom: 18 },
  hero: { borderRadius: 28 },
  heroTop: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: { backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  heroBadgeText: { fontSize: 11, ...font.heavy, color: '#10121f', letterSpacing: 1 },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroBottom: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  heroCat: { fontSize: 11, ...font.bold, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.2 },
  heroTitle: { fontSize: 28, ...font.heavy, color: '#fff', letterSpacing: -0.6, marginTop: 2 },
  heroTag: { fontSize: 14, lineHeight: 19, color: 'rgba(255,255,255,0.82)', marginTop: 2, minHeight: 38 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { width: 20, backgroundColor: AC.text },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 22 },
  tile: { alignItems: 'center', paddingVertical: 14, gap: 8 },
  tileIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 13, ...font.semibold, color: AC.text },
  cont: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingRight: 14, width: 250 },
  contArt: { width: 56, height: 56, borderRadius: 16 },
  contName: { fontSize: 15, ...font.bold, color: AC.text },
  contStat: { fontSize: 12, color: AC.muted, marginTop: 2 },
  contPlay: { width: 30, height: 30, borderRadius: 15, backgroundColor: AC.play[1], alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridCard: { borderRadius: 24 },
  gridShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  gridInfo: { paddingHorizontal: 12, paddingTop: 9 },
  gridLive: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  gridLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AC.live },
  gridName: { fontSize: 16, ...font.heavy, color: '#fff', letterSpacing: -0.3 },
  gridMeta: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 3 },
  footer: { fontSize: 12, color: AC.faint, textAlign: 'center', marginTop: 10 },
  mobileOnly: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(10,10,20,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  mobileOnlyText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
})
