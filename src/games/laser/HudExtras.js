// Laser Tag HUD extras: weapon switcher (+ wheel), scoreboard, the S&D hold-to-plant button,
// bomb alerts / countdown, and floating enemy markers. All overlays here are in-tree
// Views (never native Modals) so they can't get stuck, and every one of them swallows
// touches so a tap on the HUD never fires the gun.
import React, { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, Image, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Circle } from 'react-native-svg'
import { TEAMS } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import { playSfx } from '../../lib/gunAudio'
import { WeaponSpinWheel } from './WeaponSpinWheel'
import { gunArt } from '../../lib/gunArt'
import { HUD, hudSheet, hudType } from './HudPro'
import { PlayerTap } from '../MultiplayerUI'
import GameFollowButton from '../../components/GameFollowButton'

const hudShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }
const W = '#fff'
const PANEL = HUD.sheet
const BORDER = HUD.border
const MUTED = HUD.muted
const GOLD = HUD.gold
const RED = HUD.red

// ---------------------------------------------------------------------------
// Weapon switcher
// ---------------------------------------------------------------------------

/** Chip showing the current weapon. Tap = spin-wheel weapon picker. */
export const WeaponChip = memo(function WeaponChip({ weapon, count, onWheel, maxWidth }) {
  return (
    <Pressable
      onPress={onWheel}
      hitSlop={6}
      style={({ pressed }) => [s.chip, Number.isFinite(maxWidth) && { maxWidth }, pressed && { transform: [{ scale: 0.95 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Weapon: ${weapon?.name}. Tap to choose a weapon`}
    >
      <Image source={gunArt(weapon?.id)} style={s.chipImg} resizeMode="contain" />
      <View style={{ flexShrink: 1 }}>
        <Text style={s.chipName} numberOfLines={1}>{weapon?.name}</Text>
        <Text style={s.chipSub} numberOfLines={1}>{weapon?.automatic ? 'AUTO' : weapon?.shotsPerClick > 1 ? 'BURST' : 'SEMI'} · ∞{count > 1 ? `  ·  ${count} guns ◎` : ''}</Text>
      </View>
    </Pressable>
  )
})

/** Weapon picker: the spin wheel (kept under this name for existing importers). */
export const WeaponWheel = WeaponSpinWheel

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

function rankedPlayers(state) {
  return Object.entries(state?.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score - a.score) || (b.kills - a.kills) || (a.deaths - b.deaths))
}

/** Sorted K/D/score table; grouped by team in team modes. */
export function ScoreTable({ state, meId, shotsBy }) {
  const rows = rankedPlayers(state)
  const teamMode = state?.mode && state.mode !== 'ffa'
  const groups = teamMode
    ? ['A', 'B'].map((t) => ({ team: t, rows: rows.filter((r) => r.team === t) })).filter((g) => g.rows.length)
    : [{ team: null, rows }]
  const showBt = rows.some((r) => (r.bystanderTags || 0) > 0)
  const acc = (r) => {
    const shots = shotsBy?.[r.id]
    return shots ? `${Math.round((Math.min(r.hits, shots) / shots) * 100)}%` : '—'
  }
  return (
    <View>
      {groups.map((g) => {
        const color = g.team ? TEAMS[g.team]?.color : null
        const total = g.rows.reduce((n, r) => n + (r.kills || 0), 0)
        const teamScore = g.team && state.mode === 'tdm' ? state.teamScore?.[g.team] : g.team && state.mode === 'snd' ? state.snd?.wins?.[g.team] : null
        return (
          <View key={g.team || 'all'} style={{ marginBottom: 10 }}>
            {g.team && (
              <View style={[s.teamHead, { borderLeftColor: color }]}>
                <Text style={[s.teamName, { color }]}>{TEAMS[g.team]?.name}</Text>
                <Text style={s.teamTotal}>{teamScore != null ? `${teamScore} ${state.mode === 'snd' ? 'rounds' : 'tag-outs'}` : `${total} tag-outs`}</Text>
              </View>
            )}
            <View style={s.tHead}>
              <Text style={[s.th, { width: 22 }]}>#</Text>
              <Text style={[s.th, { flex: 1 }]}>PLAYER</Text>
              <Text style={[s.th, s.c]}>K</Text>
              <Text style={[s.th, s.c]}>D</Text>
              {showBt && <Text style={[s.th, s.c]}>BT</Text>}
              {shotsBy && <Text style={[s.th, s.cw]}>ACC</Text>}
              <Text style={[s.th, s.cw]}>SCORE</Text>
              <View style={s.fcol} />
            </View>
            {g.rows.map((r, i) => (
              <View key={r.id} style={[s.tRow, r.id === meId && s.tRowMe]}>
                <Text style={[s.td, { width: 22, color: MUTED }]}>{i + 1}</Text>
                <PlayerTap player={{ id: r.id, username: r.name }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                  {!r.alive && state.phase === 'playing' && <Text style={s.deadTag}>✕ </Text>}
                  <Text style={[s.td, { flexShrink: 1 }, r.id === meId && { fontWeight: '800' }]} numberOfLines={1}>{r.name}{r.id === meId ? ' (you)' : ''}</Text>
                </PlayerTap>
                <Text style={[s.td, s.c]}>{r.kills || 0}</Text>
                <Text style={[s.td, s.c]}>{r.deaths || 0}</Text>
                {showBt && <Text style={[s.td, s.c]}>{r.bystanderTags || 0}</Text>}
                {shotsBy && <Text style={[s.td, s.cw]}>{acc(r)}</Text>}
                <Text style={[s.td, s.cw, { fontWeight: '800' }]}>{r.score || 0}</Text>
                <View style={s.fcol}>{r.id !== meId ? <GameFollowButton userId={r.id} name={r.name} size="sm" /> : null}</View>
              </View>
            ))}
          </View>
        )
      })}
      {showBt && <Text style={[s.th, { marginTop: 2 }]}>BT = Bystander tags (iYiYi users outside the match, +25 each)</Text>}
    </View>
  )
}

/** In-match scoreboard overlay (X or tap outside to close). */
export function ScoreboardOverlay({ visible, state, meId, onClose, insets }) {
  const { height: winH } = useWindowDimensions()
  if (!visible || !state) return null
  const maxH = Math.max(160, Math.min(460, winH - (insets?.top || 0) - (insets?.bottom || 0) - 140))
  return (
    <View style={[StyleSheet.absoluteFill, s.overlayRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close scoreboard" />
      <View style={[s.centerWrap, { paddingTop: (insets?.top || 0) + 16, paddingBottom: (insets?.bottom || 0) + 16 }]} pointerEvents="box-none">
        <View style={s.panel}>
          <View style={s.panelHead}>
            <View>
              <Text style={hudType.kicker}>LIVE STANDINGS</Text>
              <Text style={s.panelTitle}>SCOREBOARD</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close scoreboard">
              <Ionicons name="close" size={20} color={W} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: maxH }}>
            <ScoreTable state={state} meId={meId} />
          </ScrollView>
        </View>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Search & Destroy: hold to plant / defuse
// ---------------------------------------------------------------------------

const RING = 46
const RING_W = 5
const RING_C = Math.PI * (RING - RING_W)

/**
 * CoD-style hold button: press and hold until the ring fills (holdMs). Calls onStart()
 * on press, onDone() when full and onCancel() when let go early. `activeKey` identifies the
 * plant/defuse the host is running for me (its start time; null when none). If the host
 * drops it (I was hit, walked out of the zone) or never confirms it, the hold stops and
 * must be pressed again.
 */
export function HoldActionButton({ kind, site, holdMs, activeKey = null, color = GOLD, onStart, onDone, onCancel }) {
  const [phase, setPhase] = useState('idle') // idle | holding | done | lost
  const [pct, setPct] = useState(0)
  const [lostText, setLostText] = useState('')
  const startAt = useRef(0)
  const sawActive = useRef(false)
  const ackKey = useRef(null) // the host's act for this press
  const staleKey = useRef(null) // an act still showing from an earlier press
  const phaseRef = useRef('idle')
  phaseRef.current = phase
  const cb = useRef({})
  cb.current = { onStart, onDone, onCancel }
  const scale = useRef(new Animated.Value(0.5)).current
  const plant = kind === 'plant'

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 200 }).start()
    buzz('warning')
  }, [scale])

  const lose = (text) => {
    setPhase('lost')
    setPct(0)
    setLostText(text)
    buzz('error')
    try { cb.current.onCancel?.() } catch { /* ignore */ }
  }

  // Progress while holding (+ a tick of haptics every second).
  useEffect(() => {
    if (phase !== 'holding') return undefined
    let lastSec = 0
    const t = setInterval(() => {
      const el = Date.now() - startAt.current
      const p = Math.min(1, el / holdMs)
      setPct(p)
      const sec = Math.floor(el / 1000)
      if (sec > lastSec && p < 1) { lastSec = sec; buzz('light') }
      if (!sawActive.current && el > 1800) { clearInterval(t); lose('Didn’t start — check the message and hold again'); return }
      if (p >= 1) {
        clearInterval(t)
        setPhase('done')
        buzz('success')
        try { cb.current.onDone?.() } catch { /* ignore */ }
      }
    }, 60)
    return () => clearInterval(t)
  }, [phase, holdMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // The host started / dropped my action.
  useEffect(() => {
    if (phaseRef.current !== 'holding') return
    if (!sawActive.current) {
      if (activeKey != null && activeKey !== staleKey.current) { sawActive.current = true; ackKey.current = activeKey }
    } else if (activeKey !== ackKey.current) {
      lose(plant ? 'Plant interrupted — hold again' : 'Defuse interrupted — hold again')
    }
  }, [activeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Finished but nothing happened (lag, or the host said no): let them try again.
  useEffect(() => {
    if (phase !== 'done' && phase !== 'lost') return undefined
    const t = setTimeout(() => { setPhase('idle'); setPct(0) }, phase === 'done' ? 3500 : 1800)
    return () => clearTimeout(t)
  }, [phase])

  // Unmounted mid-hold (walked out of the zone, died, round over): stop on the host too.
  useEffect(() => () => { if (phaseRef.current === 'holding') { try { cb.current.onCancel?.() } catch { /* ignore */ } } }, [])

  const pressIn = () => {
    if (phaseRef.current === 'holding' || phaseRef.current === 'done') return
    startAt.current = Date.now()
    sawActive.current = false
    ackKey.current = null
    staleKey.current = activeKey
    setPct(0)
    setPhase('holding')
    playSfx('tap')
    buzz('medium')
    try { cb.current.onStart?.() } catch { /* ignore */ }
  }
  const pressOut = () => {
    if (phaseRef.current !== 'holding') return
    setPhase('idle')
    setPct(0)
    buzz('select')
    try { cb.current.onCancel?.() } catch { /* ignore */ }
  }

  const verb = plant ? 'PLANT' : 'DEFUSE'
  const title = phase === 'holding'
    ? `${plant ? 'PLANTING' : 'DEFUSING'}… ${Math.round(pct * 100)}%`
    : phase === 'done'
      ? (plant ? 'ARMING…' : 'DISARMING…')
      : phase === 'lost' ? lostText : `HOLD TO ${verb}${plant && site ? ` · ${site}` : ''}`
  const sub = phase === 'holding' ? 'Keep holding · stay in the zone' : phase === 'idle' ? `Hold ${Math.round(holdMs / 1000)} s — a hit or leaving cancels it` : null
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={pressIn}
        onPressOut={pressOut}
        pressRetentionOffset={{ top: 80, bottom: 80, left: 80, right: 80 }}
        style={[s.holdBtn, { borderColor: phase === 'lost' ? RED : color, backgroundColor: phase === 'holding' ? withA(color, 0.32) : 'rgba(0,0,0,0.72)' }]}
        accessibilityRole="button"
        accessibilityLabel={`Hold to ${verb.toLowerCase()}${plant && site ? ` at site ${site}` : ''}`}
      >
        <View style={{ width: RING, height: RING }}>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={(RING - RING_W) / 2} stroke="rgba(255,255,255,0.22)" strokeWidth={RING_W} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={(RING - RING_W) / 2}
              stroke={color}
              strokeWidth={RING_W}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${RING_C} ${RING_C}`}
              strokeDashoffset={RING_C * (1 - (phase === 'done' ? 1 : pct))}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name={plant ? 'flame' : 'build'} size={20} color={color} />
          </View>
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={[s.holdTitle, phase === 'lost' && { color: RED, fontSize: 15 }]} numberOfLines={2}>{title}</Text>
          {!!sub && <Text style={s.holdSub} numberOfLines={1}>{sub}</Text>}
        </View>
      </Pressable>
    </Animated.View>
  )
}

function withA(hex, a) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return hex
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

/** Big pop-in action button (Plant bomb / Defuse). */
export function BigActionButton({ title, onPress, color = GOLD }) {
  const scale = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 200 }).start()
    buzz('warning')
  }, [scale])
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} style={({ pressed }) => [s.bigBtn, { backgroundColor: color, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" accessibilityLabel={title}>
        <Text style={s.bigBtnText}>{title}</Text>
      </Pressable>
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Bomb alerts
// ---------------------------------------------------------------------------

export function AlertBanner({ alert, top }) {
  const y = useRef(new Animated.Value(-120)).current
  useEffect(() => {
    if (!alert) return
    y.setValue(-120)
    Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 14 }).start()
  }, [alert?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!alert) return null
  return (
    <Animated.View pointerEvents="none" style={[s.alert, { top, backgroundColor: alert.color || RED, transform: [{ translateY: y }] }]}>
      <Text style={s.alertTitle}>{alert.title}</Text>
      {!!alert.sub && <Text style={s.alertSub}>{alert.sub}</Text>}
    </Animated.View>
  )
}

/** CoD-style bomb countdown shown to everyone while the bomb is planted. */
export function BombCountdown({ msLeft, top, inline }) {
  const secs = Math.max(0, Math.ceil(msLeft / 1000))
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    pulse.setValue(1.15)
    Animated.timing(pulse, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [secs, pulse])
  return (
    <Animated.View pointerEvents="none" style={[s.bomb, inline ? s.bombInline : { top }, { transform: [{ scale: pulse }] }]}>
      <Text style={s.bombLabel}>BOMB</Text>
      <Text style={[s.bombTime, secs <= 10 && { color: RED }]}>{secs}</Text>
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Enemy markers over heads (from the camera's body detection)
// ---------------------------------------------------------------------------

const EnemyMarker = memo(function EnemyMarker({ x, y, color, label }) {
  const pos = useRef(new Animated.ValueXY({ x, y })).current
  const fade = useRef(new Animated.Value(0)).current
  const bob = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: -5, duration: 450, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 450, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [fade, bob])
  useEffect(() => {
    Animated.spring(pos, { toValue: { x, y }, useNativeDriver: true, damping: 18, stiffness: 140 }).start()
  }, [x, y, pos])
  return (
    <Animated.View pointerEvents="none" style={[s.enemy, { opacity: fade, transform: [{ translateX: pos.x }, { translateY: Animated.add(pos.y, bob) }] }]}>
      {!!label && <Text style={[s.enemyLabel, { color }]} numberOfLines={1}>{label}</Text>}
      <View style={[s.enemyCross, { borderColor: color }]}>
        <View style={[s.enemyCrossH, { backgroundColor: color }]} />
        <View style={[s.enemyCrossV, { backgroundColor: color }]} />
      </View>
      <Ionicons name="chevron-down" size={30} color={color} style={s.enemyChevron} />
    </Animated.View>
  )
})

/** markers: [{ id, x, y, color, label }] — x/y = screen point just above the head. */
export const EnemyMarkers = memo(function EnemyMarkers({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => <EnemyMarker key={m.id} x={m.x - 30} y={m.y - 64} color={m.color} label={m.label} />)}
    </View>
  )
})

const s = StyleSheet.create({
  fcol: { width: 36, alignItems: 'flex-end' },
  overlayRoot: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  centerWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  panel: { ...hudSheet, padding: 16 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  panelTitle: { ...hudType.title },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', maxWidth: 210 },
  chipIcon: { fontSize: 24 },
  chipImg: { width: 44, height: 24 },
  chipName: { fontSize: 13, fontWeight: '800', color: W, maxWidth: 140 },
  chipSub: { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 0.5 },
  wheelCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wheelHub: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  wheelHubText: { fontSize: 11, fontWeight: '800', color: MUTED },
  wheelItem: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: PANEL, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', padding: 4 },
  wheelItemOn: { borderColor: GOLD, backgroundColor: 'rgba(255,201,77,0.18)' },
  wheelName: { fontSize: 9, fontWeight: '700', color: W, textAlign: 'center' },
  teamHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderLeftWidth: 4, paddingLeft: 8, marginBottom: 4 },
  teamName: { fontSize: 13, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  teamTotal: { fontSize: 12, fontWeight: '700', color: MUTED },
  tHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  th: { ...hudType.label, fontSize: 9.5 },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 6, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  tRowMe: { backgroundColor: 'rgba(58,209,255,0.10)', borderLeftColor: HUD.accent },
  td: { fontSize: 14, fontWeight: '700', color: W, fontVariant: ['tabular-nums'] },
  c: { width: 30, textAlign: 'center' },
  cw: { width: 52, textAlign: 'right' },
  deadTag: { fontSize: 12, color: RED, fontWeight: '900' },
  holdBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 20, paddingVertical: 10, borderRadius: 30, borderWidth: 3, minWidth: 260, maxWidth: 360 },
  holdTitle: { fontSize: 19, fontWeight: '900', color: W, letterSpacing: 0.8, ...hudShadow },
  holdSub: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  bigBtn: { paddingHorizontal: 34, paddingVertical: 18, borderRadius: 24, borderWidth: 3, borderColor: W, minWidth: 240, alignItems: 'center' },
  bigBtnText: { fontSize: 22, fontWeight: '900', color: '#1a1000', letterSpacing: 1 },
  alert: { position: 'absolute', left: 16, right: 16, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  alertTitle: { fontSize: 18, fontWeight: '900', color: W, textAlign: 'center' },
  alertSub: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginTop: 2, textAlign: 'center' },
  bomb: { position: 'absolute', alignSelf: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 6, borderWidth: 2, borderColor: RED },
  bombInline: { position: 'relative', paddingVertical: 2, paddingHorizontal: 14 },
  bombLabel: { fontSize: 11, fontWeight: '900', color: RED, letterSpacing: 2 },
  bombTime: { fontSize: 40, fontWeight: '900', color: W, fontVariant: ['tabular-nums'], ...hudShadow },
  enemy: { position: 'absolute', left: 0, top: 0, width: 60, alignItems: 'center' },
  enemyLabel: { fontSize: 11, fontWeight: '900', maxWidth: 110, ...hudShadow },
  enemyCross: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  enemyCrossH: { position: 'absolute', width: 12, height: 2 },
  enemyCrossV: { position: 'absolute', width: 2, height: 12 },
  enemyChevron: { marginTop: -6, ...hudShadow },
})
