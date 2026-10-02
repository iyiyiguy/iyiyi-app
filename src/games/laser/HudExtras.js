// Laser Tag HUD extras: weapon switcher (+ wheel), scoreboard, the S&D tap mini-game,
// bomb alerts / countdown, and floating enemy markers. All overlays here are in-tree
// Views (never native Modals) so they can't get stuck, and every one of them swallows
// touches so a tap on the HUD never fires the gun.
import React, { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TEAMS } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import { playSfx } from '../../lib/gunAudio'
import { WeaponSpinWheel } from './WeaponSpinWheel'

const hudShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }
const W = '#fff'
const PANEL = 'rgba(12,14,26,0.94)'
const BORDER = 'rgba(255,255,255,0.12)'
const MUTED = 'rgba(255,255,255,0.62)'
const GOLD = '#ffc94d'
const RED = '#ff4d5e'

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
      <Text style={s.chipIcon}>{weapon?.icon}</Text>
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
              <Text style={[s.th, { flex: 1 }]}>Player</Text>
              <Text style={[s.th, s.c]}>K</Text>
              <Text style={[s.th, s.c]}>D</Text>
              {showBt && <Text style={[s.th, s.c]}>BT</Text>}
              {shotsBy && <Text style={[s.th, s.cw]}>Acc</Text>}
              <Text style={[s.th, s.cw]}>Score</Text>
            </View>
            {g.rows.map((r, i) => (
              <View key={r.id} style={[s.tRow, r.id === meId && s.tRowMe]}>
                <Text style={[s.td, { width: 22, color: MUTED }]}>{i + 1}</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                  {!r.alive && state.phase === 'playing' && <Text style={s.deadTag}>✕ </Text>}
                  <Text style={[s.td, { flexShrink: 1 }, r.id === meId && { fontWeight: '800' }]} numberOfLines={1}>{r.name}{r.id === meId ? ' (you)' : ''}</Text>
                </View>
                <Text style={[s.td, s.c]}>{r.kills || 0}</Text>
                <Text style={[s.td, s.c]}>{r.deaths || 0}</Text>
                {showBt && <Text style={[s.td, s.c]}>{r.bystanderTags || 0}</Text>}
                {shotsBy && <Text style={[s.td, s.cw]}>{acc(r)}</Text>}
                <Text style={[s.td, s.cw, { fontWeight: '800' }]}>{r.score || 0}</Text>
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
  if (!visible || !state) return null
  return (
    <View style={[StyleSheet.absoluteFill, s.overlayRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close scoreboard" />
      <View style={[s.centerWrap, { paddingTop: (insets?.top || 0) + 16, paddingBottom: (insets?.bottom || 0) + 16 }]} pointerEvents="box-none">
        <View style={s.panel}>
          <View style={s.panelHead}>
            <Text style={s.panelTitle}>Scoreboard</Text>
            <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close scoreboard">
              <Ionicons name="close" size={20} color={W} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            <ScoreTable state={state} meId={meId} />
          </ScrollView>
        </View>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Search & Destroy: tap mini-game (plant / defuse)
// ---------------------------------------------------------------------------

/**
 * Whack-a-mole: targets pop up at random spots; hit `needed` of them within `durationMs`.
 * Calls onStart() when a run begins, onSuccess() when completed, onFail() when time runs
 * out. The player can retry after a fail, or close (onClose).
 */
export function TapMiniGame({ kind, durationMs, needed, onStart, onSuccess, onFail, onClose, insets, interruptedAt }) {
  const [phase, setPhase] = useState('running') // running | failed | done | interrupted
  const [hits, setHits] = useState(0)
  const [target, setTarget] = useState(null)
  const [left, setLeft] = useState(durationMs)
  const [box, setBox] = useState(null)
  const runRef = useRef(0)
  const deadline = useRef(0)
  const hitsRef = useRef(0)
  const pop = useRef(new Animated.Value(1)).current
  const label = kind === 'plant' ? 'PLANT' : 'DEFUSE'

  const spawn = (b = box) => {
    if (!b) return
    const size = 74
    const x = 16 + Math.random() * Math.max(10, b.width - size - 32)
    const y = 16 + Math.random() * Math.max(10, b.height - size - 32)
    setTarget({ x, y, key: Math.random().toString(36).slice(2) })
    pop.setValue(0.3)
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 10, stiffness: 260 }).start()
  }

  const start = () => {
    const run = ++runRef.current
    hitsRef.current = 0
    setHits(0)
    setPhase('running')
    deadline.current = Date.now() + durationMs
    setLeft(durationMs)
    spawn()
    try { onStart?.() } catch { /* ignore */ }
    return run
  }

  // First run once the play box is measured.
  useEffect(() => { if (box && runRef.current === 0) start() }, [box]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer + targets hop if not hit in time.
  useEffect(() => {
    if (phase !== 'running' || !box) return undefined
    const tick = setInterval(() => {
      const ms = deadline.current - Date.now()
      setLeft(Math.max(0, ms))
      if (ms <= 0) {
        clearInterval(tick)
        setPhase('failed')
        setTarget(null)
        buzz('error')
        try { onFail?.() } catch { /* ignore */ }
      }
    }, 100)
    const hop = setInterval(() => spawn(), kind === 'plant' ? 900 : 1050)
    return () => { clearInterval(tick); clearInterval(hop) }
  }, [phase, box]) // eslint-disable-line react-hooks/exhaustive-deps

  // Finished, but the host never confirmed (moved out of the zone, lag): let them retry.
  useEffect(() => {
    if (phase !== 'done') return undefined
    const t = setTimeout(() => setPhase('rejected'), 4000)
    return () => clearTimeout(t)
  }, [phase])

  // The host cancelled the action (e.g. we were hit).
  useEffect(() => {
    if (interruptedAt && phase === 'running') {
      setPhase('interrupted')
      setTarget(null)
      buzz('error')
    }
  }, [interruptedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const hit = () => {
    if (phase !== 'running') return
    hitsRef.current += 1
    setHits(hitsRef.current)
    playSfx('tap')
    buzz('light')
    if (hitsRef.current >= needed) {
      setPhase('done')
      setTarget(null)
      buzz('success')
      try { onSuccess?.() } catch { /* ignore */ }
    } else {
      spawn()
    }
  }

  const pct = Math.max(0, Math.min(1, left / durationMs))
  return (
    <View style={[StyleSheet.absoluteFill, s.overlayRoot, s.gameRoot, { paddingTop: (insets?.top || 0) + 14, paddingBottom: (insets?.bottom || 0) + 14 }]}>
      <View style={s.gameHead}>
        <Text style={s.gameTitle}>{kind === 'plant' ? '💣 Planting' : '🛠 Defusing'}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Cancel">
          <Ionicons name="close" size={20} color={W} />
        </Pressable>
      </View>
      <Text style={s.gameSub}>Tap the targets! {hits}/{needed}</Text>
      <View style={s.timeTrack}><View style={[s.timeFill, { width: `${pct * 100}%`, backgroundColor: pct < 0.3 ? RED : GOLD }]} /></View>
      {/* The play box swallows every touch (no accidental shots). */}
      <Pressable style={s.playBox} onLayout={(e) => setBox(e.nativeEvent.layout)} onPress={() => { if (phase === 'running') buzz('select') }}>
        {target && phase === 'running' && (
          <Animated.View key={target.key} style={[s.targetWrap, { left: target.x, top: target.y, transform: [{ scale: pop }] }]}>
            <Pressable onPressIn={hit} hitSlop={10} style={s.target} accessibilityRole="button" accessibilityLabel="Target">
              <View style={s.targetInner} />
            </Pressable>
          </Animated.View>
        )}
        {phase !== 'running' && (
          <View style={s.gameResult}>
            {phase === 'done' ? (
              <>
                <Text style={s.resultBig}>{kind === 'plant' ? 'Arming…' : 'Disarming…'}</Text>
                <Text style={s.resultSub}>Hold your position</Text>
              </>
            ) : (
              <>
                <Text style={[s.resultBig, { color: RED }]}>{phase === 'interrupted' ? 'Interrupted!' : phase === 'rejected' ? 'Didn’t go through' : 'Too slow!'}</Text>
                <Text style={s.resultSub}>{phase === 'interrupted' ? 'You took a hit.' : phase === 'rejected' ? 'Stay inside the zone and try again.' : `You hit ${hits} of ${needed}.`}</Text>
                <Pressable onPress={start} style={s.retry} accessibilityRole="button">
                  <Text style={s.retryText}>Retry {label}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </Pressable>
    </View>
  )
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
      <Text style={s.bombLabel}>💣 BOMB</Text>
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
  overlayRoot: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  centerWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  panel: { backgroundColor: PANEL, borderRadius: 24, padding: 16, borderWidth: 1, borderColor: BORDER },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  panelTitle: { fontSize: 20, fontWeight: '800', color: W },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', maxWidth: 210 },
  chipIcon: { fontSize: 24 },
  chipName: { fontSize: 13, fontWeight: '800', color: W, maxWidth: 140 },
  chipSub: { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 0.5 },
  wheelCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wheelHub: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  wheelHubText: { fontSize: 11, fontWeight: '800', color: MUTED },
  wheelItem: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: PANEL, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', padding: 4 },
  wheelItemOn: { borderColor: GOLD, backgroundColor: 'rgba(255,201,77,0.18)' },
  wheelName: { fontSize: 9, fontWeight: '700', color: W, textAlign: 'center' },
  teamHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderLeftWidth: 4, paddingLeft: 8, marginBottom: 4 },
  teamName: { fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  teamTotal: { fontSize: 12, fontWeight: '700', color: MUTED },
  tHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  th: { fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 0.8 },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: 8 },
  tRowMe: { backgroundColor: 'rgba(255,255,255,0.08)' },
  td: { fontSize: 14, color: W },
  c: { width: 30, textAlign: 'center' },
  cw: { width: 52, textAlign: 'right' },
  deadTag: { fontSize: 12, color: RED, fontWeight: '900' },
  gameRoot: { backgroundColor: 'rgba(6,8,16,0.82)', paddingHorizontal: 16 },
  gameHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameTitle: { fontSize: 24, fontWeight: '900', color: W },
  gameSub: { fontSize: 15, fontWeight: '700', color: GOLD, marginTop: 4 },
  timeTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 10, overflow: 'hidden' },
  timeFill: { height: 8, borderRadius: 4 },
  playBox: { flex: 1, marginTop: 14, borderRadius: 22, borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.04)' },
  targetWrap: { position: 'absolute', width: 74, height: 74 },
  target: { width: 74, height: 74, borderRadius: 37, backgroundColor: RED, borderWidth: 4, borderColor: W, alignItems: 'center', justifyContent: 'center' },
  targetInner: { width: 26, height: 26, borderRadius: 13, backgroundColor: W },
  gameResult: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  resultBig: { fontSize: 32, fontWeight: '900', color: GOLD },
  resultSub: { fontSize: 15, color: MUTED, marginTop: 6 },
  retry: { marginTop: 20, backgroundColor: GOLD, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 18 },
  retryText: { fontSize: 16, fontWeight: '900', color: '#2a1a00' },
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
