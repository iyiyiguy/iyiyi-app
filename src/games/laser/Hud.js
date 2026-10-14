// Laser Tag heads-up display pieces: minimap, countdown, round-break and
// end-of-match summary.
import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import GlassPanel from '../../components/GlassPanel'
import { Avatar, Pill, PlayerTap } from '../MultiplayerUI'
import GameFollowButton from '../../components/GameFollowButton'
import { ScoreTable } from './HudExtras'
import { HUD, HudCta, hudGlow, hudPanel, hudSheet, hudType } from './HudPro'
import { ROUND_BREAK_MS } from './engine'
import { LASER_MODES, TEAMS, offsetMeters } from '../../lib/multiplayer'
import { withAlpha } from '../GameMap'
import { colors } from '../../theme'

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
  // North marker sits on the rim, rotated with the heading.
  const nRad = (-headingDeg * Math.PI) / 180
  const nLeft = half + Math.sin(nRad) * (half - 10)
  const nTop = half - Math.cos(nRad) * (half - 10)
  return (
    <GlassPanel radius={half} style={{ width: size, height: size }} intensity={40} animateIn={false}>
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
        <Text style={styles.scale}>{Math.round(rangeM * 3.28)} ft</Text>
      </View>
    </GlassPanel>
  )
}

export function CountdownOverlay({ state, now, meTeam }) {
  const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
  const mode = LASER_MODES[state.mode]
  const pop = useRef(new Animated.Value(1)).current
  useEffect(() => {
    pop.setValue(1.35)
    Animated.timing(pop, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [left, pop])
  const go = left === 0
  const side = state.mode === 'snd' ? state.snd.sides[meTeam] : null
  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.letterboxTop} />
      <View style={styles.letterboxBottom} />
      <Text style={[hudType.kicker, hudShadow]}>MATCH STARTING</Text>
      <Text style={[styles.overTitle, hudShadow]}>{mode?.name}</Text>
      <Animated.Text style={[styles.big, go && { color: HUD.green, textShadowColor: HUD.green }, { transform: [{ scale: pop }] }]}>{go ? 'GO' : left}</Animated.Text>
      {state.mode === 'snd' ? (
        <Text style={[styles.overSub, hudShadow]}>
          ROUND {state.snd.roundNo}/{state.snd.totalRounds}  ·  <Text style={{ color: TEAMS[meTeam]?.color }}>{TEAMS[meTeam]?.name}</Text>  ·  <Text style={{ color: side === 'attack' ? HUD.red : HUD.accent }}>{side === 'attack' ? 'ATTACK' : 'DEFEND'}</Text>
        </Text>
      ) : state.mode === 'tdm' && meTeam ? (
        <Text style={[styles.overSub, hudShadow]}>YOU ARE <Text style={{ color: TEAMS[meTeam].color }}>{TEAMS[meTeam].name}</Text></Text>
      ) : !!mode?.blurb && <Text style={[styles.overSub, hudShadow]}>{mode.blurb}</Text>}
      {state.mode === 'snd' && state.snd.swapped && state.snd.roundNo > 1 && <Text style={[styles.overSub, hudShadow, { color: HUD.gold }]}>SIDES SWAPPED</Text>}
    </View>
  )
}

const REASONS = {
  defused: 'Bomb defused',
  detonated: 'Bomb detonated',
  eliminated: 'Team eliminated',
  time: 'Time ran out',
}

export function RoundBreak({ state, now }) {
  const r = state.snd.lastResult
  const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
  const win = TEAMS[r?.winner]
  const pct = Math.max(0, Math.min(1, (state.startsAt - now) / ROUND_BREAK_MS))
  const half = state.snd.roundNo === Math.ceil(state.snd.totalRounds / 2)
  return (
    <View style={styles.overlayDim} pointerEvents="none">
      <View style={[styles.breakCard, { borderTopColor: win?.color || HUD.gold }]}>
        <Text style={[hudType.kicker, { textAlign: 'center' }]}>ROUND {r?.roundNo} OF {state.snd.totalRounds}</Text>
        <Text style={[styles.breakTitle, { color: win?.color || '#fff', textShadowColor: win?.color || HUD.accent }]}>{win?.name} WINS</Text>
        <Text style={[hudType.label, { textAlign: 'center', marginTop: 4 }]}>{REASONS[r?.reason]}</Text>
        <View style={[styles.scoreRow, { marginTop: 14 }]}>
          <TeamScore team="A" value={state.snd.wins.A} />
          <Text style={styles.dash}>–</Text>
          <TeamScore team="B" value={state.snd.wins.B} />
        </View>
        {half && <Text style={[hudType.label, { color: HUD.gold, textAlign: 'center', marginTop: 10 }]}>HALF TIME · SIDES SWAP</Text>}
        <View style={styles.breakTrack}><View style={[styles.breakFill, { width: `${pct * 100}%` }]} /></View>
        <Text style={[hudType.label, { textAlign: 'center', marginTop: 6 }]}>NEXT ROUND IN {left}S</Text>
      </View>
    </View>
  )
}

function TeamScore({ team, value }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 80 }}>
      <Text style={[hudType.label, { color: TEAMS[team].color, letterSpacing: 1.8 }]}>{TEAMS[team].name}</Text>
      <Text style={[hudType.num, { fontSize: 44 }]}>{value}</Text>
    </View>
  )
}

// End-of-match results screen: result banner, team score, MVP, sorted (team-grouped)
// table, Rematch (host) / Leave.
export function MatchSummary({ state, meId, roster, shotsBy, isHost, onPlayAgain, onExit, bottomInset = 0 }) {
  const avatarOf = (id) => roster.find((r) => r.id === id)?.avatar
  const me = state.players[meId]
  const iWon = state.winners?.includes(meId)
  let title = iWon ? 'Victory' : 'Defeat'
  let tone = iWon ? HUD.green : HUD.red
  if (state.mode !== 'ffa') {
    if (!state.winnerTeam) { title = 'Draw'; tone = HUD.gold } else if (state.winnerTeam === me?.team) { title = 'Victory'; tone = HUD.green } else { title = 'Defeat'; tone = HUD.red }
  }
  const sub = state.mode === 'ffa'
    ? `${LASER_MODES.ffa.name} · you placed #${1 + Object.values(state.players).filter((p) => p.score > (me?.score || 0)).length} of ${Object.keys(state.players).length}`
    : state.winnerTeam ? `${TEAMS[state.winnerTeam].name} wins ${LASER_MODES[state.mode]?.name}` : LASER_MODES[state.mode]?.name
  const mvp = state.mvp ? state.players[state.mvp] : null
  const scoreA = state.mode === 'snd' ? state.snd?.wins?.A : state.teamScore?.A
  const scoreB = state.mode === 'snd' ? state.snd?.wins?.B : state.teamScore?.B
  const mvpStats = [
    `${mvp?.score || 0} PTS`, `${mvp?.kills || 0} K / ${mvp?.deaths || 0} D`, `${mvp?.hits || 0} HITS`,
    mvp?.headshots ? `${mvp.headshots} HS` : null, mvp?.plants ? `${mvp.plants} PLANTS` : null, mvp?.defuses ? `${mvp.defuses} DEFUSES` : null,
  ].filter(Boolean).join('  ·  ')
  return (
    <ScrollView style={{ flex: 1, backgroundColor: HUD.bg }} contentContainerStyle={[styles.summary, { paddingBottom: 48 + bottomInset }]}>
      <LinearGradient pointerEvents="none" colors={[withAlpha(tone, 0.26), 'rgba(7,8,15,0)']} style={styles.summaryWash} />
      <Text style={[hudType.kicker, { textAlign: 'center' }]}>MATCH COMPLETE</Text>
      <Text style={[styles.resultTitle, { color: tone, textShadowColor: tone }]}>{title}</Text>
      <View style={[styles.rule, { backgroundColor: tone, ...hudGlow(tone, 10) }]} />
      <Text style={styles.resultSub}>{sub}</Text>
      {state.mode !== 'ffa' && (
        <View style={[hudPanel, styles.scorePanel]}>
          <DarkTeamScore team="A" value={scoreA ?? 0} />
          <Text style={styles.dash}>–</Text>
          <DarkTeamScore team="B" value={scoreB ?? 0} />
        </View>
      )}
      {mvp && (
        <View style={styles.mvpCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="trophy" size={12} color={HUD.gold} />
            <Text style={[hudType.kicker, { color: HUD.gold }]}>MATCH MVP</Text>
          </View>
          <PlayerTap player={{ id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }} style={styles.mvpRow}>
            <View style={styles.mvpAvatar}>
              <Avatar uri={avatarOf(state.mvp)} name={mvp.name} size={52} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.mvpName} numberOfLines={1}>{mvp.name}{state.mvp === meId ? ' (you)' : ''}</Text>
              <Text style={styles.mvpStats} numberOfLines={2}>{mvpStats}</Text>
            </View>
          </PlayerTap>
          {state.mvp !== meId ? <GameFollowButton userId={state.mvp} name={mvp.name} style={{ alignSelf: 'flex-start', marginTop: 10 }} /> : null}
        </View>
      )}
      <Text style={[hudType.label, { marginBottom: 6 }]}>PLAYED WITH · TAP A NAME FOR THEIR PROFILE, + TO FOLLOW</Text>
      <View style={styles.tableCard}>
        <ScoreTable state={state} meId={meId} shotsBy={shotsBy} />
      </View>
      {isHost
        ? <HudCta title="Rematch" icon="refresh" onPress={onPlayAgain} />
        : (
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={HUD.muted} size="small" />
            <Text style={styles.waitText}>WAITING FOR THE HOST…</Text>
          </View>
        )}
      <HudCta tone="ghost" title="Leave" icon="exit" onPress={onExit} style={{ marginTop: 12 }} />
    </ScrollView>
  )
}

function DarkTeamScore({ team, value }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 90 }}>
      <Text style={[styles.teamLabel, { color: TEAMS[team].color }]}>{TEAMS[team].name.toUpperCase()}</Text>
      <Text style={styles.teamValue}>{value}</Text>
    </View>
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
  dotRing: { borderWidth: 2, borderColor: colors.gold },
  dotLabel: { position: 'absolute', top: 10, fontSize: 9, color: colors.onBrand, ...hudShadow },
  meDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.onBrand },
  areaLabel: { fontSize: 10, fontWeight: '800' },
  north: { position: 'absolute', width: 12, textAlign: 'center', fontSize: 10, fontWeight: '800', color: colors.gold, ...hudShadow },
  scale: { position: 'absolute', bottom: 6, alignSelf: 'center', fontSize: 9, color: colors.onBrandMuted, ...hudShadow },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)', padding: 24 },
  letterboxTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.55)', borderBottomWidth: 1, borderColor: HUD.border },
  letterboxBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.55)', borderTopWidth: 1, borderColor: HUD.border },
  overlayDim: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  overTitle: { ...hudType.title, fontSize: 16, color: 'rgba(255,255,255,0.92)', marginTop: 4 },
  big: { fontSize: 128, lineHeight: 136, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -2, textShadowColor: HUD.accent, textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } },
  overSub: { ...hudType.label, fontSize: 12, color: 'rgba(255,255,255,0.92)', textAlign: 'center', marginTop: 8 },
  breakCard: { width: '88%', maxWidth: 420, ...hudSheet, borderTopWidth: 3, padding: 18 },
  breakTitle: { ...hudType.display, fontSize: 36, textAlign: 'center', marginTop: 4, textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
  breakTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 14, overflow: 'hidden' },
  breakFill: { height: 4, borderRadius: 2, backgroundColor: HUD.accent },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  scorePanel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, alignSelf: 'center', paddingHorizontal: 22, paddingVertical: 10, marginTop: 14 },
  summary: { padding: 16, paddingTop: 20 },
  summaryWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },
  resultTitle: { fontSize: 56, fontWeight: '900', letterSpacing: 6, textAlign: 'center', textTransform: 'uppercase', includeFontPadding: false, textShadowRadius: 22, textShadowOffset: { width: 0, height: 0 }, marginTop: 2 },
  rule: { height: 2, width: 72, alignSelf: 'center', marginTop: 8, borderRadius: 1 },
  resultSub: { ...hudType.label, fontSize: 11, textAlign: 'center', marginTop: 10 },
  dash: { fontSize: 24, fontWeight: '900', color: HUD.muted },
  teamLabel: { ...hudType.label, letterSpacing: 1.8 },
  teamValue: { ...hudType.num, fontSize: 48, letterSpacing: -1 },
  mvpCard: { marginTop: 20, borderRadius: 14, padding: 14, backgroundColor: 'rgba(255,201,77,0.10)', borderWidth: 1, borderColor: 'rgba(255,201,77,0.45)', borderLeftWidth: 3, borderLeftColor: HUD.gold },
  mvpAvatar: { borderWidth: 2, borderColor: HUD.gold, borderRadius: 30, padding: 2 },
  mvpName: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  mvpStats: { ...hudType.label, letterSpacing: 1, marginTop: 3, fontVariant: ['tabular-nums'] },
  tableCard: { marginTop: 14, marginBottom: 16, ...hudPanel, borderRadius: 14, padding: 12 },
  waitText: { ...hudType.label, textAlign: 'center' },
  mvpRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
})
