import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { GAMES, gameText, rankName } from '../lib/games'
import { GUNS, getGunById } from '../lib/guns'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, winRateFor, rankFor } from '../lib/arcadeStats'
import { useUavInventory } from '../lib/uav'
import { formatOnlineRating } from '../lib/chessMatchmaking'
import {
  AC, ArcadeBackground, ArcadeCard, ArcadeHeader, CoinPill, SectionHeader, StatTile, StatusBarScrim, arcadeText, gameIcon, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { FONT, ST, StBar } from '../games/studio'
import { avatarSource } from '../lib/avatarSource'
import { gunArt } from '../lib/gunArt'
import { useT } from '../i18n'
import A from '../i18n/strings/arcadeStats'

// The signed-in player's arcade profile: their account basics plus real local stats.
export default function PlayerProfileScreen({ navigation }) {
  const t = useT(A)
  const insets = useArcadeInsets()
  useArcadeStatusBar()
  const uav = useUavInventory()
  const [stats, setStats] = useState(null)
  const [profile, setProfile] = useState(null)

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setStats(s) })
    return () => { alive = false }
  }, []))
  useEffect(() => subscribeArcadeStats(setStats), [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        const uid = data?.user?.id
        if (!uid) return
        const { data: p } = await supabase.from('profiles').select('username, avatar_url').eq('id', uid).maybeSingle()
        if (alive) setProfile(p || { username: data.user.email?.split('@')[0] || null })
      } catch (e) {
        console.warn('PlayerProfile: profile load failed', e)
      }
    })()
    return () => { alive = false }
  }, [])

  const totals = stats ? totalsFor(stats) : null
  const gun = stats ? getGunById(stats.unlockedGuns.includes(stats.equippedGun) ? stats.equippedGun : 'pistol') : null
  const name = profile?.username || t('you')
  const rank = rankFor(stats?.lifetimePoints || 0)

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 60, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <ArcadeHeader
          kicker={t('arcade')}
          title={t('profile')}
          onBack={() => navigation.goBack()}
          right={<CoinPill value={stats ? stats.points : null} compact onPress={() => navigation.navigate('GunShop')} />}
        />

        {/* Hero */}
        <View style={[styles.hero, { borderTopColor: rank.color }]}>
          <View style={[styles.avatarRing, { borderBottomColor: rank.color }]}>
            <Image source={avatarSource(profile?.avatar_url)} style={styles.avatar} />
            <View style={[styles.levelBadge, { backgroundColor: rank.color }]}><Text style={styles.levelText}>{rank.level}</Text></View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={[styles.rankName, { color: rank.color }]}>{rankName(rank)} · {t('level_n', { n: rank.level })}</Text>
            <StBar value={rank.levelProgress} color={rank.color} height={4} style={styles.xpTrack} />
            <Text style={[arcadeText.caption, { fontVariant: ['tabular-nums'] }]}>{stats ? t('xp_to_level', { xp: rank.xpToNextLevel.toLocaleString(), n: rank.level + 1 }) : t('loading')}</Text>
          </View>
        </View>

        {stats && (
          <>
            <View style={styles.tiles}>
              <StatTile label={t('played')} value={totals.played} />
              <StatTile label={t('wins')} value={totals.wins} accent={AC.live} />
              <StatTile label={t('win_rate')} value={totals.winRate != null ? `${totals.winRate}%` : '—'} accent={AC.gold} />
              {/* Online rating once you've played people (that's what others see); else vs AI. */}
              {stats.chess.online?.games > 0
                ? <StatTile label={t('chess_online')} value={formatOnlineRating(stats.chess.online.rating, stats.chess.online.games) ?? '—'} accent={AC.accent} />
                : <StatTile label={t('chess_vs_ai')} value={stats.chess.ratedGames > 0 ? stats.chess.rating : '—'} accent={AC.accent} />}
            </View>

            <SectionHeader title={t('loadout')} />
            <ArcadeCard glow={AC.glowHot}>
              <View style={styles.row}>
                <View style={styles.gunIcon}><Image source={gunArt(gun)} style={{ width: '92%', height: '60%' }} resizeMode="contain" /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={arcadeText.label}>{t('equipped_laser')}</Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>{gun.name}</Text>
                  <Text style={arcadeText.caption}>{t('weapons_unlocked', { n: stats.unlockedGuns.filter((id) => GUNS.some((g) => g.id === id)).length, total: GUNS.length })}</Text>
                </View>
              </View>
              <View style={[styles.row, { marginTop: 14, justifyContent: 'space-between' }]}>
                <Text style={arcadeText.caption}>{t('uavs')}</Text>
                <UavBalancePill balance={uav.balance} owner={uav.owner} onPress={() => openArcadeStore(navigation)} />
              </View>
            </ArcadeCard>

            <SectionHeader title={t('games')} />
            {GAMES.map((g) => {
              const s = stats.games[g.id] || { played: 0, bestScore: null }
              const wr = winRateFor(s)
              return (
                <ArcadeCard key={g.id} style={{ marginBottom: 12 }}>
                  <View style={[styles.row, { marginBottom: 12 }]}>
                    <View style={styles.gameIcon}><Ionicons name={gameIcon(g.id)} size={18} color={ST.friendly} /></View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{gameText(g, 'name')}</Text>
                  </View>
                  <View style={[styles.tiles, { marginTop: 0 }]}>
                    <StatTile label={t('played')} value={s.played} />
                    {g.id === 'word-race'
                      ? <StatTile label={t('words')} value={stats.wordRace.totalWords} accent={AC.live} />
                      : <StatTile label={t('win_rate')} value={wr != null ? `${wr}%` : '—'} accent={AC.live} />}
                    {g.id === 'chess'
                      ? <StatTile label={t('vs_ai')} value={stats.chess.ratedGames > 0 ? stats.chess.rating : '—'} accent={AC.gold} />
                      : <StatTile label={t('best')} value={s.bestScore ?? '—'} accent={AC.gold} />}
                    {g.id === 'chess' && (
                      <StatTile label={t('online')} value={stats.chess.online?.games > 0 ? formatOnlineRating(stats.chess.online.rating, stats.chess.online.games) ?? '—' : '—'} accent={AC.accent} />
                    )}
                  </View>
                </ArcadeCard>
              )
            })}
          </>
        )}

        <View style={styles.links}>
          <LinkTile icon="trophy" label={t('my_records_lc')} onPress={() => navigation.navigate('GameLeaderboard')} />
          <LinkTile icon="bag-handle" label={t('shop')} onPress={() => navigation.navigate('GunShop')} />
          <LinkTile icon="shield-checkmark" label={t('my_equip')} onPress={() => navigation.navigate('MyEquip')} />
          <LinkTile icon="sparkles" label={t('store')} onPress={() => openArcadeStore(navigation)} />
        </View>
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

function LinkTile({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.link, pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={AC.accent} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: ST.radius, marginTop: 18, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, overflow: 'hidden' },
  avatarRing: { width: 72, height: 72, borderRadius: ST.radius, borderBottomWidth: 3, backgroundColor: '#3c434c' },
  avatar: { width: 72, height: 69, borderTopLeftRadius: ST.radius, borderTopRightRadius: ST.radius },
  levelBadge: { position: 'absolute', bottom: -9, alignSelf: 'center', minWidth: 24, paddingHorizontal: 5, height: 18, borderRadius: 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ST.ground },
  levelText: { fontFamily: FONT.display, fontSize: 11, color: ST.ink, includeFontPadding: false },
  name: { fontFamily: FONT.display, fontSize: 22, letterSpacing: 0.6, color: ST.text, includeFontPadding: false },
  rankName: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 3 },
  xpTrack: { marginVertical: 8 },
  tiles: { flexDirection: 'row', gap: 6, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gunIcon: { width: 58, height: 58, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line, borderBottomWidth: 2, borderBottomColor: ST.enemy },
  gameIcon: { width: 34, height: 34, borderRadius: ST.radius, backgroundColor: ST.cell, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', flexShrink: 1, includeFontPadding: false },
  links: { flexDirection: 'row', gap: 8, marginTop: 20 },
  link: { flex: 1, paddingVertical: 14, borderRadius: ST.radius, alignItems: 'center', gap: 6, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  linkText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: ST.text, textAlign: 'center' },
})
