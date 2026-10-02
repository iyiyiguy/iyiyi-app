import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { GAMES } from '../lib/games'
import { GUNS, getGunById } from '../lib/guns'
import { loadArcadeStats, subscribeArcadeStats, totalsFor, winRateFor, rankFor } from '../lib/arcadeStats'
import { useUavInventory } from '../lib/uav'
import {
  AC, ArcadeBackground, ArcadeCard, ArcadeHeader, CoinPill, SectionHeader, StatTile, StatusBarScrim, arcadeText, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { UavBalancePill, openArcadeStore } from '../games/UavStore'
import { font } from '../theme'

// The signed-in player's arcade profile: their account basics plus real local stats.
export default function PlayerProfileScreen({ navigation }) {
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
  const name = profile?.username || 'You'
  const rank = rankFor(stats?.lifetimePoints || 0)

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 60, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <ArcadeHeader
          kicker="Arcade"
          title="Profile"
          onBack={() => navigation.goBack()}
          right={<CoinPill value={stats ? stats.points : null} compact onPress={() => navigation.navigate('GunShop')} />}
        />

        {/* Hero */}
        <LinearGradient colors={['#2a1a5e', '#141838', '#0b0d1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={[styles.heroGlow, { backgroundColor: rank.color }]} />
          <View style={[styles.avatarRing, { borderColor: rank.color }]}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <LinearGradient colors={AC.play} style={[styles.avatar, styles.center]}>
                <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
              </LinearGradient>
            )}
            <View style={[styles.levelBadge, { backgroundColor: rank.color }]}><Text style={styles.levelText}>{rank.level}</Text></View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={[styles.rankName, { color: rank.color }]}>{rank.name} · Level {rank.level}</Text>
            <View style={styles.xpTrack}>
              <LinearGradient colors={[rank.color, AC.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.xpFill, { width: `${Math.round(rank.levelProgress * 100)}%` }]} />
            </View>
            <Text style={arcadeText.caption}>{stats ? `${rank.xpToNextLevel.toLocaleString()} XP to level ${rank.level + 1}` : 'Loading…'}</Text>
          </View>
        </LinearGradient>

        {stats && (
          <>
            <View style={styles.tiles}>
              <StatTile label="Played" value={totals.played} />
              <StatTile label="Wins" value={totals.wins} accent={AC.live} />
              <StatTile label="Win rate" value={totals.winRate != null ? `${totals.winRate}%` : '—'} accent={AC.gold} />
              <StatTile label="Chess" value={stats.chess.rating} accent={AC.accent} />
            </View>

            <SectionHeader title="Loadout" />
            <ArcadeCard glow={AC.glowHot}>
              <View style={styles.row}>
                <LinearGradient colors={['#ff5d6c', '#7a1430']} style={styles.gunIcon}><Text style={{ fontSize: 30 }}>{gun.icon}</Text></LinearGradient>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={arcadeText.label}>Equipped for Laser Tag</Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>{gun.name}</Text>
                  <Text style={arcadeText.caption}>{stats.unlockedGuns.filter((id) => GUNS.some((g) => g.id === id)).length} of {GUNS.length} weapons unlocked</Text>
                </View>
              </View>
              <View style={[styles.row, { marginTop: 14, justifyContent: 'space-between' }]}>
                <Text style={arcadeText.caption}>UAVs</Text>
                <UavBalancePill balance={uav.balance} owner={uav.owner} onPress={() => openArcadeStore(navigation)} />
              </View>
            </ArcadeCard>

            <SectionHeader title="Games" />
            {GAMES.map((g) => {
              const s = stats.games[g.id] || { played: 0, bestScore: null }
              const wr = winRateFor(s)
              return (
                <ArcadeCard key={g.id} style={{ marginBottom: 12 }}>
                  <View style={[styles.row, { marginBottom: 12 }]}>
                    <Text style={{ fontSize: 22 }}>{g.icon}</Text>
                    <Text style={styles.cardTitle} numberOfLines={1}>{g.name}</Text>
                  </View>
                  <View style={[styles.tiles, { marginTop: 0 }]}>
                    <StatTile label="Played" value={s.played} />
                    {g.id === 'word-race'
                      ? <StatTile label="Words" value={stats.wordRace.totalWords} accent={AC.live} />
                      : <StatTile label="Win rate" value={wr != null ? `${wr}%` : '—'} accent={AC.live} />}
                    {g.id === 'chess'
                      ? <StatTile label="Rating" value={stats.chess.rating} accent={AC.gold} />
                      : <StatTile label="Best" value={s.bestScore ?? '—'} accent={AC.gold} />}
                  </View>
                </ArcadeCard>
              )
            })}
          </>
        )}

        <View style={styles.links}>
          <LinkTile icon="trophy" label="My records" onPress={() => navigation.navigate('GameLeaderboard')} />
          <LinkTile icon="bag-handle" label="Shop" onPress={() => navigation.navigate('GunShop')} />
          <LinkTile icon="sparkles" label="Store" onPress={() => openArcadeStore(navigation)} />
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
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: 26, marginTop: 18, borderWidth: 1, borderColor: AC.border, overflow: 'hidden' },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, left: -70, top: -80, opacity: 0.18 },
  avatarRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 70, height: 70, borderRadius: 35 },
  avatarLetter: { fontSize: 30, ...font.heavy, color: '#fff' },
  levelBadge: { position: 'absolute', bottom: -6, alignSelf: 'center', minWidth: 26, paddingHorizontal: 6, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: AC.bg[0] },
  levelText: { fontSize: 11, ...font.heavy, color: '#10121f' },
  name: { fontSize: 24, ...font.heavy, color: AC.text, letterSpacing: -0.5 },
  rankName: { fontSize: 13, ...font.heavy, marginTop: 2 },
  xpTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginVertical: 8 },
  xpFill: { height: 6, borderRadius: 3 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gunIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, ...font.heavy, color: AC.text, flexShrink: 1 },
  links: { flexDirection: 'row', gap: 10, marginTop: 20 },
  link: { flex: 1, paddingVertical: 14, borderRadius: 18, alignItems: 'center', gap: 6, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  linkText: { fontSize: 13, ...font.bold, color: AC.text },
})
