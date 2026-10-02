// Laser Tag heads-up display pieces: minimap, countdown, round-break and
// end-of-match summary.
import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import GlassPanel from '../../components/GlassPanel'
import { Avatar, Btn, Card, Pill, PlayerTap } from '../MultiplayerUI'
import { ScoreTable } from './HudExtras'
import { LASER_MODES, TEAMS, offsetMeters } from '../../lib/multiplayer'
import { colors, radii, type } from '../../theme'

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
  let sub = mode?.blurb
  if (state.mode === 'snd') {
    const side = state.snd.sides[meTeam]
    sub = `Round ${state.snd.roundNo} of ${state.snd.totalRounds} · ${TEAMS[meTeam]?.name} is ${side === 'attack' ? 'ATTACKING' : 'DEFENDING'}`
  } else if (state.mode === 'tdm' && meTeam) {
    sub = `You are on ${TEAMS[meTeam].name}`
  }
  return (
    <View style={styles.overlay} pointerEvents="none">
      <Text style={[styles.overTitle, hudShadow]}>{mode?.name}</Text>
      <Text style={[styles.big, hudShadow]}>{left > 0 ? left : 'GO'}</Text>
      {!!sub && <Text style={[styles.overSub, hudShadow]}>{sub}</Text>}
      {state.mode === 'snd' && state.snd.swapped && state.snd.roundNo > 1 && <Text style={[styles.overSub, hudShadow, { color: colors.gold }]}>Sides swapped</Text>}
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
  return (
    <View style={styles.overlayDim}>
      <Card style={{ width: '88%' }}>
        <Text style={[type.label, { textAlign: 'center' }]}>Round {r?.roundNo} of {state.snd.totalRounds}</Text>
        <Text style={[type.display, { textAlign: 'center', color: TEAMS[r?.winner]?.color }]}>{TEAMS[r?.winner]?.name} wins</Text>
        <Text style={[type.body, { textAlign: 'center', marginBottom: 10 }]}>{REASONS[r?.reason]}</Text>
        <View style={styles.scoreRow}>
          <TeamScore team="A" value={state.snd.wins.A} />
          <Text style={type.title}>–</Text>
          <TeamScore team="B" value={state.snd.wins.B} />
        </View>
        {state.snd.roundNo === Math.floor(state.snd.totalRounds / 2) && <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>Half time: sides swap next round.</Text>}
        <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>Next round in {left}s</Text>
      </Card>
    </View>
  )
}

function TeamScore({ team, value }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 80 }}>
      <Text style={[type.label, { color: TEAMS[team].color }]}>{TEAMS[team].name}</Text>
      <Text style={type.display}>{value}</Text>
    </View>
  )
}

// End-of-match results screen: result banner, team score, MVP, sorted (team-grouped)
// table, Rematch (host) / Leave.
export function MatchSummary({ state, meId, roster, shotsBy, isHost, onPlayAgain, onExit }) {
  const avatarOf = (id) => roster.find((r) => r.id === id)?.avatar
  const me = state.players[meId]
  const iWon = state.winners?.includes(meId)
  let title = iWon ? 'Victory' : 'Defeat'
  let tone = iWon ? '#2fdc8f' : '#ff4d5e'
  if (state.mode !== 'ffa') {
    if (!state.winnerTeam) { title = 'Draw'; tone = '#ffc94d' } else if (state.winnerTeam === me?.team) { title = 'Victory'; tone = '#2fdc8f' } else { title = 'Defeat'; tone = '#ff4d5e' }
  }
  const sub = state.mode === 'ffa'
    ? `${LASER_MODES.ffa.name} · you placed #${1 + Object.values(state.players).filter((p) => p.score > (me?.score || 0)).length} of ${Object.keys(state.players).length}`
    : state.winnerTeam ? `${TEAMS[state.winnerTeam].name} wins ${LASER_MODES[state.mode]?.name}` : LASER_MODES[state.mode]?.name
  const mvp = state.mvp ? state.players[state.mvp] : null
  const scoreA = state.mode === 'snd' ? state.snd?.wins?.A : state.teamScore?.A
  const scoreB = state.mode === 'snd' ? state.snd?.wins?.B : state.teamScore?.B
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#07080f' }} contentContainerStyle={styles.summary}>
      <Text style={[styles.resultTitle, { color: tone }]}>{title}</Text>
      <Text style={styles.resultSub}>{sub}</Text>
      {state.mode !== 'ffa' && (
        <View style={[styles.scoreRow, { marginTop: 12 }]}>
          <DarkTeamScore team="A" value={scoreA ?? 0} />
          <Text style={styles.dash}>–</Text>
          <DarkTeamScore team="B" value={scoreB ?? 0} />
        </View>
      )}
      {mvp && (
        <View style={styles.mvpCard}>
          <Text style={styles.mvpLabel}>⭐ MVP</Text>
          <PlayerTap player={{ id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }} style={styles.mvpRow}>
            <Avatar uri={avatarOf(state.mvp)} name={mvp.name} size={56} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.mvpName} numberOfLines={1}>{mvp.name}{state.mvp === meId ? ' (you)' : ''}</Text>
              <Text style={styles.mvpStats}>{mvp.score} pts · {mvp.kills} K / {mvp.deaths} D · {mvp.hits} hits{mvp.headshots ? ` · ${mvp.headshots} HS` : ''}{mvp.plants ? ` · ${mvp.plants} plants` : ''}{mvp.defuses ? ` · ${mvp.defuses} defuses` : ''}</Text>
            </View>
          </PlayerTap>
        </View>
      )}
      <View style={styles.tableCard}>
        <ScoreTable state={state} meId={meId} shotsBy={shotsBy} />
      </View>
      {isHost
        ? <Btn title="Rematch" variant="primary" onPress={onPlayAgain} />
        : <Text style={styles.waitText}>Waiting for the host to start a rematch…</Text>}
      <Btn title="Leave" onPress={onExit} style={{ marginTop: 12 }} />
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
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', padding: 24 },
  overlayDim: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  overTitle: { ...type.title, color: colors.onBrand },
  big: { fontSize: 110, fontWeight: '800', color: colors.onBrand },
  overSub: { ...type.body, color: colors.onBrand, textAlign: 'center', marginTop: 6 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  summary: { padding: 16, paddingBottom: 48 },
  resultTitle: { fontSize: 46, fontWeight: '900', textAlign: 'center', letterSpacing: -1 },
  resultSub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 2 },
  dash: { fontSize: 28, fontWeight: '800', color: 'rgba(255,255,255,0.5)' },
  teamLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  teamValue: { fontSize: 40, fontWeight: '900', color: '#fff' },
  mvpCard: { marginTop: 18, borderRadius: 22, padding: 14, backgroundColor: 'rgba(255,201,77,0.12)', borderWidth: 1, borderColor: 'rgba(255,201,77,0.45)' },
  mvpLabel: { fontSize: 12, fontWeight: '900', color: '#ffc94d', letterSpacing: 1 },
  mvpName: { fontSize: 20, fontWeight: '800', color: '#fff' },
  mvpStats: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  tableCard: { marginTop: 14, marginBottom: 16, borderRadius: 22, padding: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  waitText: { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },
  mvpRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  col: { width: 30, textAlign: 'center' },
  colW: { width: 46, textAlign: 'right' },
  teamDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  radii: { borderRadius: radii.md },
})
