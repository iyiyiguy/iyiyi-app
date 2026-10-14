// Laser Tag full-screen moments (studio style): the drawn minimap (legacy), the match
// countdown, the S&D round break and the end-of-match summary.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Easing, Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import GlassPanel from '../../components/GlassPanel'
import { Pill, PlayerTap } from '../MultiplayerUI'
import GameFollowButton from '../../components/GameFollowButton'
import { getFollowStatus, toggleFollow } from '../../lib/followCache'
import { buzz } from '../../lib/gamePrefs'
import { ScoreTable } from './HudExtras'
import { HUD, HudCta, relColor } from './HudPro'
import { ROUND_BREAK_MS } from './engine'
import { LASER_MODES, TEAMS, offsetMeters } from '../../lib/multiplayer'
import { FONT, ST, stShadow, stType, withAlpha } from '../studio'

export const hudShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }

// Heading-up radar. points: [{ id, pos, color, label?, ring? }], areas: [{ id, pos, r, color, label }]
export function Minimap({ size = 140, rangeM = 75, me, headingDeg = 0, points = [], areas = [] }) {
  const half = size / 2
  const scale = half / rangeM
  const rad = (-headingDeg * Math.PI) / 180
  const place = (pos) => {
    const { x, y } = offsetMeters(me, pos)
    let rx = (x * Math.cos(rad) - y * Math.sin(rad)) * scale
    let ry = (x * Math.sin(rad) + y * Math.cos(rad)) * scale
    const len = Math.hypot(rx, ry)
    const max = half - 7
    const clipped = len > max
    if (clipped) { rx = (rx / len) * max; ry = (ry / len) * max }
    return { left: half + rx, top: half - ry, clipped }
  }
  const nLeft = half + Math.sin(rad) * (half - 10)
  const nTop = half - Math.cos(rad) * (half - 10)
  return (
    <GlassPanel radius={ST.radius} style={{ width: size, height: size }} intensity={40} animateIn={false}>
      <View style={{ width: size, height: size }}>
        <View style={[styles.ring, { left: size / 4, top: size / 4, width: half, height: half, borderRadius: half / 2 }]} />
        <View style={[styles.fov, { left: half - 1, top: 8, height: half - 8 }]} />
        {me && areas.map((a) => {
          const p = place(a.pos)
          const r = Math.max(5, a.r * scale)
          return (
            <View key={a.id} style={{ position: 'absolute', left: p.left - r, top: p.top - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 1.5, borderColor: a.color, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[styles.areaLabel, { color: a.color }]}>{a.label}</Text>
            </View>
          )
        })}
        {me && points.map((pt) => {
          const p = place(pt.pos)
          return (
            <View key={pt.id} style={[styles.dot, { left: p.left - 5, top: p.top - 5, backgroundColor: pt.color, opacity: p.clipped ? 0.6 : 1 }, pt.ring && styles.dotRing]}>
              {!!pt.label && <Text style={styles.dotLabel}>{pt.label}</Text>}
            </View>
          )
        })}
        <View style={[styles.dot, styles.meDot, { left: half - 6, top: half - 6 }]} />
        <Text style={[styles.north, { left: nLeft - 6, top: nTop - 8 }]}>N</Text>
        <Text style={styles.scale}>{Math.round(rangeM * 3.28)} FT</Text>
      </View>
    </GlassPanel>
  )
}

export function CountdownOverlay({ state, now, meTeam }) {
  const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
  const mode = LASER_MODES[state.mode]
  const pop = useRef(new Animated.Value(1)).current
  useEffect(() => {
    pop.setValue(1.3)
    Animated.timing(pop, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [left, pop])
  const go = left === 0
  const side = state.mode === 'snd' ? state.snd.sides[meTeam] : null
  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.letterboxTop} />
      <View style={styles.letterboxBottom} />
      <Text style={[stType.kicker, stShadow]}>MATCH STARTING</Text>
      <Text style={[styles.overTitle, stShadow]}>{String(mode?.name || 'Laser Tag').toUpperCase()}</Text>
      <Animated.Text style={[styles.big, go && { color: ST.health }, { transform: [{ scale: pop }] }]}>{go ? 'GO' : left}</Animated.Text>
      {state.mode === 'snd' ? (
        <Text style={[styles.overSub, stShadow]}>
          ROUND {state.snd.roundNo}/{state.snd.totalRounds}  ·  <Text style={{ color: ST.friendly }}>{String(TEAMS[meTeam]?.name || '').toUpperCase()}</Text>  ·  <Text style={{ color: ST.objective }}>{side === 'attack' ? 'ATTACK' : 'DEFEND'}</Text>
        </Text>
      ) : state.mode === 'tdm' && meTeam ? (
        <Text style={[styles.overSub, stShadow]}>YOU ARE <Text style={{ color: ST.friendly }}>{String(TEAMS[meTeam].name).toUpperCase()}</Text></Text>
      ) : !!mode?.blurb && <Text style={[styles.overBody, stShadow]}>{mode.blurb}</Text>}
      {state.mode === 'snd' && side ? (
        <Text style={[styles.overBody, stShadow]}>{side === 'attack' ? 'Carry the bomb to site A or B and hold PLANT.' : 'Guard both sites. Stop the plant or defuse the bomb.'}</Text>
      ) : null}
      {state.mode === 'snd' && state.snd.swapped && state.snd.roundNo > 1 && <Text style={[styles.overSub, stShadow, { color: ST.objective }]}>SIDES SWAPPED</Text>}
    </View>
  )
}

const REASONS = {
  defused: 'Bomb defused',
  detonated: 'Bomb detonated',
  eliminated: 'Team eliminated',
  time: 'Time ran out',
}

export function RoundBreak({ state, now, meTeam }) {
  const r = state.snd.lastResult
  const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
  const mine = meTeam || 'A'
  const other = mine === 'A' ? 'B' : 'A'
  const won = r?.winner === mine
  const tone = won ? ST.friendly : ST.enemy
  const pct = Math.max(0, Math.min(1, (state.startsAt - now) / ROUND_BREAK_MS))
  const half = state.snd.roundNo === Math.ceil(state.snd.totalRounds / 2)
  return (
    <View style={styles.overlayDim} pointerEvents="none">
      <View style={[styles.breakCard, { borderTopColor: tone }]}>
        <Text style={[stType.label, { textAlign: 'center' }]}>ROUND {r?.roundNo} OF {state.snd.totalRounds}</Text>
        <Text style={[styles.breakTitle, { color: tone }]}>{won ? 'ROUND WON' : 'ROUND LOST'}</Text>
        <Text style={[stType.body, { textAlign: 'center', marginTop: 2 }]}>{REASONS[r?.reason] || ''}</Text>
        <View style={[styles.scoreRow, { marginTop: 14 }]}>
          <TeamScore name={`${TEAMS[mine]?.name || ''} · YOU`} color={ST.friendly} value={state.snd.wins[mine]} />
          <Text style={styles.dash}>–</Text>
          <TeamScore name={TEAMS[other]?.name || ''} color={ST.enemy} value={state.snd.wins[other]} />
        </View>
        {half && <Text style={[stType.label, { color: ST.objective, textAlign: 'center', marginTop: 10 }]}>HALF TIME · SIDES SWAP</Text>}
        <View style={styles.breakTrack}><View style={[styles.breakFill, { width: `${pct * 100}%` }]} /></View>
        <Text style={[stType.label, { textAlign: 'center', marginTop: 6 }]}>NEXT ROUND IN {left}S</Text>
      </View>
    </View>
  )
}

function TeamScore({ name, color, value }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 96 }}>
      <Text style={[stType.label, { color }]} numberOfLines={1}>{String(name).toUpperCase()}</Text>
      <Text style={[stType.num, { fontSize: 44, lineHeight: 48 }]}>{value}</Text>
    </View>
  )
}

function Initial({ uri, name, color, size = 36 }) {
  return (
    <View style={[styles.initial, { width: size, height: size, borderBottomColor: color }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} /> : <Text style={[styles.initialText, { fontSize: size * 0.42 }]}>{String(name || '?').slice(0, 1).toUpperCase()}</Text>}
    </View>
  )
}

// End-of-match results (studio "Summary" board): result banner, your stat tiles, the MVP,
// everyone you played with (Follow on each, plus Follow all), the full table, Rematch / Leave.
export function MatchSummary({ state, meId, roster, shotsBy, isHost, onPlayAgain, onExit, bottomInset = 0 }) {
  const avatarOf = (id) => roster.find((r) => r.id === id)?.avatar
  const me = state.players[meId] || {}
  const iWon = state.winners?.includes(meId)
  const ids = Object.keys(state.players)
  const myRank = 1 + Object.values(state.players).filter((p) => (p.score || 0) > (me.score || 0)).length
  let title = iWon ? 'Victory' : 'Defeat'
  let tone = iWon ? ST.friendly : ST.enemy
  if (state.mode !== 'ffa') {
    if (!state.winnerTeam) { title = 'Draw'; tone = ST.objective } else if (state.winnerTeam === me.team) { title = 'Victory'; tone = ST.friendly } else { title = 'Defeat'; tone = ST.enemy }
  }
  const mine = me.team || 'A'
  const other = mine === 'A' ? 'B' : 'A'
  const val = (t) => (state.mode === 'snd' ? state.snd?.wins?.[t] : state.teamScore?.[t]) ?? 0
  const modeName = String(LASER_MODES[state.mode]?.name || 'Laser Tag').toUpperCase()
  const kicker = state.mode === 'ffa' ? `${modeName} · #${myRank} OF ${ids.length}` : `${modeName} · ${val(mine)} – ${val(other)}`
  const sub = state.mode === 'ffa'
    ? `You placed #${myRank} of ${ids.length}`
    : state.winnerTeam
      ? `${TEAMS[state.winnerTeam].name} team wins${state.mode === 'snd' ? ` · ${(state.snd?.history || []).length} rounds played` : ''}`
      : 'Scores level'
  const shots = shotsBy?.[meId]
  const kd = (me.kills || 0) / Math.max(1, me.deaths || 0)
  const tiles = [
    ['TAGS', String(me.kills || 0)],
    ['K/D', kd.toFixed(1)],
    ['ACC', shots ? `${Math.round((Math.min(me.hits || 0, shots) / shots) * 100)}%` : '—'],
    ['SCORE', String(me.score || 0)],
  ]
  const mvp = state.mvp ? state.players[state.mvp] : null
  const mvpLine = mvp ? [mvp.name, `${mvp.kills || 0} tag${mvp.kills === 1 ? '' : 's'}`, `${mvp.score || 0}`].join(' · ') : ''
  const mvpExtra = mvp ? [mvp.headshots ? `${mvp.headshots} headshots` : null, mvp.plants ? `${mvp.plants} plants` : null, mvp.defuses ? `${mvp.defuses} defuses` : null].filter(Boolean).join(' · ') : ''
  const others = ids.filter((id) => id !== meId)
    .map((id) => ({ id, ...state.players[id] }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  const [followedAll, setFollowedAll] = useState(false)
  const followAll = () => {
    buzz('success')
    setFollowedAll(true)
    for (const p of others) {
      const st = getFollowStatus(p.id)
      if (st !== 'accepted' && st !== 'pending') toggleFollow(p.id).catch(() => {})
    }
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: ST.ground }} contentContainerStyle={[styles.summary, { paddingBottom: 40 + bottomInset }]}>
      <LinearGradient pointerEvents="none" colors={[withAlpha(tone, 0.22), withAlpha(tone, 0)]} style={styles.summaryWash} />
      <Text style={[stType.label, { color: tone, textAlign: 'center' }]}>{kicker}</Text>
      <Text style={styles.resultTitle} accessibilityRole="header">{title.toUpperCase()}</Text>
      <Text style={[stType.body, { textAlign: 'center', color: 'rgba(242,244,247,0.8)' }]}>{sub}</Text>

      <View style={styles.tiles}>
        {tiles.map(([l, v]) => (
          <View key={l} style={styles.tile}>
            <Text style={stType.label} numberOfLines={1}>{l}</Text>
            <Text style={styles.tileNum} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
          </View>
        ))}
      </View>

      {mvp && (
        <View style={styles.mvpCard}>
          <Ionicons name="star-outline" size={28} color={ST.objective} />
          <PlayerTap player={state.mvp === meId ? null : { id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }} style={{ flex: 1, minWidth: 0 }}>
            <Text style={[stType.label, { color: ST.objective }]}>MATCH MVP{state.mvp === meId ? ' · YOU' : ''}</Text>
            <Text style={styles.mvpName} numberOfLines={1}>{mvpLine}</Text>
            {mvpExtra ? <Text style={stType.small} numberOfLines={1}>{mvpExtra}</Text> : null}
          </PlayerTap>
          {state.mvp !== meId ? <GameFollowButton userId={state.mvp} name={mvp.name} /> : null}
        </View>
      )}

      {others.length > 0 && (
        <>
          <Text style={[stType.label, { marginTop: 22, marginBottom: 6 }]}>PLAYED WITH · FOLLOW ON IYIYI</Text>
          <View style={{ gap: 2 }}>
            {others.map((p) => {
              const c = relColor(state, meId, p.id)
              const rel = state.mode === 'ffa' ? null : c === ST.friendly ? 'Teammate' : 'Enemy'
              const line = [rel, `${p.kills || 0} tag${p.kills === 1 ? '' : 's'}`, `${p.score || 0} pts`].filter(Boolean).join(' · ')
              return (
                <View key={p.id} style={styles.withRow}>
                  <PlayerTap player={{ id: p.id, username: p.name, avatar: avatarOf(p.id) }} style={styles.withTap}>
                    <Initial uri={avatarOf(p.id)} name={p.name} color={c} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.withName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.withLine} numberOfLines={1}>{line}</Text>
                    </View>
                  </PlayerTap>
                  <GameFollowButton userId={p.id} name={p.name} />
                </View>
              )
            })}
          </View>
        </>
      )}

      <Text style={[stType.label, { marginTop: 22, marginBottom: 6 }]}>FULL RESULTS</Text>
      <View style={styles.tableCard}>
        <ScoreTable state={state} meId={meId} shotsBy={shotsBy} />
      </View>

      <View style={styles.ctaRow}>
        {isHost
          ? <HudCta title="Rematch" icon="refresh" onPress={onPlayAgain} style={{ flex: 1 }} />
          : (
            <View style={styles.waiting}>
              <ActivityIndicator color={HUD.muted} size="small" />
              <Text style={stType.label}>WAITING FOR THE HOST…</Text>
            </View>
          )}
        {others.length > 1 ? <HudCta tone="ghost" title={followedAll ? 'Followed' : 'Follow all'} icon={followedAll ? 'checkmark' : 'person-add'} disabled={followedAll} onPress={followAll} style={{ width: 150 }} /> : null}
      </View>
      <HudCta tone="ghost" title="Leave" icon="exit" onPress={onExit} style={{ marginTop: 10 }} />
    </ScrollView>
  )
}

export function TeamBadge({ team }) {
  if (!team) return null
  return <Pill text={TEAMS[team].name.toUpperCase()} color={TEAMS[team].color} />
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  fov: { position: 'absolute', width: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  dotRing: { borderWidth: 2, borderColor: ST.objective },
  dotLabel: { position: 'absolute', top: 10, fontSize: 9, color: '#fff', ...hudShadow },
  meDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: ST.friendly, borderWidth: 2, borderColor: '#fff' },
  areaLabel: { fontFamily: FONT.display, fontSize: 10 },
  north: { position: 'absolute', width: 12, textAlign: 'center', fontFamily: FONT.display, fontSize: 10, color: ST.enemy, ...hudShadow },
  scale: { position: 'absolute', bottom: 6, alignSelf: 'center', fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1, color: ST.muted, ...hudShadow },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)', padding: 24 },
  letterboxTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.55)', borderBottomWidth: 1, borderColor: ST.line },
  letterboxBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.55)', borderTopWidth: 1, borderColor: ST.line },
  overlayDim: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  overTitle: { ...stType.title, fontSize: 20, marginTop: 4 },
  big: { fontFamily: FONT.display, fontSize: 120, lineHeight: 128, color: '#fff', fontVariant: ['tabular-nums'], includeFontPadding: false, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 18, textShadowOffset: { width: 0, height: 2 } },
  overSub: { ...stType.label, fontSize: 12, letterSpacing: 2, color: 'rgba(242,244,247,0.95)', textAlign: 'center', marginTop: 8 },
  overBody: { ...stType.body, textAlign: 'center', marginTop: 8, maxWidth: 320 },
  breakCard: { width: '88%', maxWidth: 420, backgroundColor: 'rgba(11,13,17,0.94)', borderRadius: ST.radius, borderTopWidth: 3, padding: 18 },
  breakTitle: { ...stType.display, fontSize: 40, lineHeight: 44, letterSpacing: 3, textAlign: 'center', marginTop: 4 },
  breakTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 16, overflow: 'hidden' },
  breakFill: { height: 4, backgroundColor: '#ffffff' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  dash: { fontFamily: FONT.display, fontSize: 24, color: ST.muted },
  summary: { paddingHorizontal: 16, paddingTop: 26 },
  summaryWash: { position: 'absolute', top: -60, left: -16, right: -16, height: 360 },
  resultTitle: { ...stType.display, textAlign: 'center', marginTop: 4, marginBottom: 4 },
  tiles: { flexDirection: 'row', gap: 6, marginTop: 22 },
  tile: { flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: ST.panel, borderRadius: ST.radius, gap: 2 },
  tileNum: { fontFamily: FONT.display, fontSize: 22, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  mvpCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.objective, backgroundColor: 'rgba(255,178,30,0.08)' },
  mvpName: { fontFamily: FONT.display, fontSize: 17, color: ST.text },
  withRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: ST.radius },
  withTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  withName: { fontFamily: FONT.ui, fontSize: 15, color: ST.text },
  withLine: { fontFamily: FONT.uiSemi, fontSize: 11, color: ST.muted },
  initial: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a3038', borderBottomWidth: 3, overflow: 'hidden' },
  initialText: { fontFamily: FONT.display, color: ST.text },
  tableCard: { backgroundColor: ST.panel, borderRadius: ST.radius, paddingVertical: 10, paddingHorizontal: 4, marginBottom: 18 },
  ctaRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  waiting: { flex: 1, height: 50, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
})
