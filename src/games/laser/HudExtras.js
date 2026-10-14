// Laser Tag HUD extras: weapon switcher (+ wheel), scoreboard, the S&D hold-to-plant button,
// bomb alerts / countdown, camera target brackets and enemy markers. All overlays here are
// in-tree Views (never native Modals) so they can't get stuck, and every one of them swallows
// touches so a tap on the HUD never fires the gun.
import React, { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Circle } from 'react-native-svg'
import { buzz } from '../../lib/gamePrefs'
import { playSfx } from '../../lib/gunAudio'
import { WeaponSpinWheel } from './WeaponSpinWheel'
import { gunArt } from '../../lib/gunArt'
import { HUD, NameTag, relColor } from './HudPro'
import { PlayerTap } from '../MultiplayerUI'
import GameFollowButton from '../../components/GameFollowButton'
import { FONT, ST, stShadow, stType, withAlpha } from '../studio'
import { LASER_MODES, TEAMS } from '../../lib/multiplayer'
import { pickAimTarget } from './aimAssist'

const W = '#fff'
const MUTED = ST.muted
const GOLD = ST.objective
const RED = ST.enemy

// ---------------------------------------------------------------------------
// Weapon switcher
// ---------------------------------------------------------------------------

/** Chip showing the current weapon. Tap = weapon wheel. */
export const WeaponChip = memo(function WeaponChip({ weapon, count, onWheel, maxWidth }) {
  return (
    <Pressable
      onPress={onWheel}
      hitSlop={6}
      style={({ pressed }) => [s.chip, Number.isFinite(maxWidth) && { maxWidth }, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`Weapon: ${weapon?.name}. Tap to choose a weapon`}
    >
      <Image source={gunArt(weapon?.id)} style={s.chipImg} resizeMode="contain" />
      <View style={{ flexShrink: 1 }}>
        <Text style={s.chipName} numberOfLines={1}>{String(weapon?.name || '').toUpperCase()}</Text>
        <Text style={s.chipSub} numberOfLines={1}>{weapon?.automatic ? 'AUTO' : weapon?.shotsPerClick > 1 ? 'BURST' : 'SEMI'} · ∞{count > 1 ? `  ·  ${count} GUNS` : ''}</Text>
      </View>
    </Pressable>
  )
})

/** Weapon picker: the radial wheel (kept under this name for existing importers). */
export const WeaponWheel = WeaponSpinWheel

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

function rankedPlayers(state) {
  return Object.entries(state?.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => ((b.score || 0) - (a.score || 0)) || ((b.kills || 0) - (a.kills || 0)) || ((a.deaths || 0) - (b.deaths || 0)))
}

/** Team totals: my team first (friendly), then the other (enemy). */
export function TeamTotals({ state, meId, style }) {
  if (!state || state.mode === 'ffa') return null
  const mine = state.players?.[meId]?.team || 'A'
  const other = mine === 'A' ? 'B' : 'A'
  const val = (t) => (state.mode === 'snd' ? state.snd?.wins?.[t] : state.teamScore?.[t]) ?? 0
  const unit = state.mode === 'snd' ? 'ROUNDS' : 'TAG-OUTS'
  return (
    <View style={[s.totals, style]}>
      {[[mine, ST.friendly, `${TEAMS[mine]?.name || ''} · YOUR TEAM`], [other, ST.enemy, TEAMS[other]?.name || '']].map(([t, c, label]) => (
        <View key={t} style={[s.totalTile, { backgroundColor: withAlpha(c, 0.12), borderTopColor: c }]}>
          <Text style={[stType.label, { color: c }]} numberOfLines={1}>{String(label).toUpperCase()}</Text>
          <Text style={s.totalNum}>{val(t)}</Text>
          <Text style={[stType.label, { fontSize: 9 }]}>{unit}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * Sorted K / D / score table (studio scoreboard). Team modes show a role-coloured square
 * next to each name. shotsBy (match summary) adds ACC; bystander tags add BT.
 */
export function ScoreTable({ state, meId, shotsBy }) {
  const rows = rankedPlayers(state)
  const teamMode = state?.mode && state.mode !== 'ffa'
  const showBt = rows.some((r) => (r.bystanderTags || 0) > 0)
  const acc = (r) => {
    const shots = shotsBy?.[r.id]
    return shots ? `${Math.round((Math.min(r.hits || 0, shots) / shots) * 100)}%` : '—'
  }
  return (
    <View>
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
      {rows.map((r, i) => {
        const me = r.id === meId
        const color = relColor(state, meId, r.id)
        return (
          <View key={r.id} style={[s.tRow, me && s.tRowMe]}>
            <Text style={[s.tdRank, { width: 22 }]}>{i + 1}</Text>
            <PlayerTap player={me ? null : { id: r.id, username: r.name }} style={s.nameCell}>
              {teamMode || me ? <View style={[s.teamSq, { backgroundColor: color }]} /> : null}
              {!r.alive && state.phase === 'playing' ? <Ionicons name="close" size={12} color={RED} /> : null}
              <Text style={[s.tdName, !r.alive && state.phase === 'playing' && { color: MUTED }]} numberOfLines={1}>{me ? 'YOU' : r.name}</Text>
            </PlayerTap>
            <Text style={[s.td, s.c]}>{r.kills || 0}</Text>
            <Text style={[s.td, s.c]}>{r.deaths || 0}</Text>
            {showBt && <Text style={[s.td, s.c]}>{r.bystanderTags || 0}</Text>}
            {shotsBy && <Text style={[s.td, s.cw]}>{acc(r)}</Text>}
            <Text style={[s.tdScore, s.cw]}>{r.score || 0}</Text>
            <View style={s.fcol}>{!me ? <GameFollowButton userId={r.id} name={r.name} size="sm" /> : null}</View>
          </View>
        )
      })}
      {showBt && <Text style={[s.th, { marginTop: 6 }]}>BT = BYSTANDER TAGS (IYIYI USERS OUTSIDE THE MATCH, +25 EACH)</Text>}
    </View>
  )
}

/** In-match scoreboard (full-screen black glass; X or the Android back button closes it). */
export function ScoreboardOverlay({ visible, state, meId, onClose, insets, clock }) {
  const { height: winH } = useWindowDimensions()
  if (!visible || !state) return null
  const teamMode = state.mode !== 'ffa'
  const maxH = Math.max(160, winH - (insets?.top || 0) - (insets?.bottom || 0) - (teamMode ? 250 : 160))
  const kicker = `${String(LASER_MODES[state.mode]?.name || 'Laser Tag').toUpperCase()}${clock ? ` · ${clock}` : ''}`
  return (
    <View style={[StyleSheet.absoluteFill, s.overlayRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close scoreboard" />
      <View style={[s.boardWrap, { paddingTop: (insets?.top || 0) + 12, paddingBottom: (insets?.bottom || 0) + 12, paddingLeft: 16 + (insets?.left || 0), paddingRight: 16 + (insets?.right || 0) }]} pointerEvents="box-none">
        <View style={s.panelHead}>
          <View style={{ flex: 1 }}>
            <Text style={stType.kicker} numberOfLines={1}>{kicker}</Text>
            <Text style={stType.title}>SCOREBOARD</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close scoreboard">
            <Ionicons name="close" size={20} color={W} />
          </Pressable>
        </View>
        <TeamTotals state={state} meId={meId} style={{ marginBottom: 14 }} />
        <ScrollView style={{ maxHeight: maxH, flexGrow: 0 }}>
          <ScoreTable state={state} meId={meId} />
        </ScrollView>
        <Text style={[stType.small, { marginTop: 12 }]}>Tap a name for their iYiYi profile. Follow works on teammates and enemies.</Text>
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
        <Text style={s.bigBtnText}>{String(title).toUpperCase()}</Text>
      </Pressable>
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Bomb alerts
// ---------------------------------------------------------------------------

/** alert: { title, sub?, color?, icon? (Ionicons name), key }. Slides in (kit: 180 ms). */
export function AlertBanner({ alert, top }) {
  const y = useRef(new Animated.Value(-40)).current
  const o = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!alert) return
    y.setValue(-40)
    o.setValue(0)
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start()
  }, [alert?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!alert) return null
  const c = alert.color || RED
  return (
    <Animated.View pointerEvents="none" style={[s.alert, { top, borderLeftColor: c, opacity: o, transform: [{ translateY: y }] }]}>
      {alert.icon ? <View style={[s.alertIcon, { borderColor: c }]}><Ionicons name={alert.icon} size={18} color={c} /></View> : null}
      <View style={{ flexShrink: 1 }}>
        <Text style={s.alertTitle} numberOfLines={2}>{String(alert.title || '').toUpperCase()}</Text>
        {!!alert.sub && <Text style={s.alertSub} numberOfLines={2}>{alert.sub}</Text>}
      </View>
    </Animated.View>
  )
}

/** CoD-style bomb countdown shown to everyone while the bomb is planted. */
export function BombCountdown({ msLeft, top, inline }) {
  const secs = Math.max(0, Math.ceil(msLeft / 1000))
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    pulse.setValue(1.12)
    Animated.timing(pulse, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [secs, pulse])
  return (
    <Animated.View pointerEvents="none" style={[s.bomb, inline ? s.bombInline : { top }, { transform: [{ scale: pulse }] }]}>
      <View style={s.bombHead}>
        <View style={s.bombDiamond} />
        <Text style={s.bombLabel}>BOMB</Text>
      </View>
      <Text style={[s.bombTime, secs <= 10 && { color: RED }]}>{secs}</Text>
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Camera target brackets (kit: corner brackets that stick to the person)
// ---------------------------------------------------------------------------

/** rects: [{ key, left, top, width, height, locked, head?: { left, top, width, height } }] */
export const TargetBrackets = memo(function TargetBrackets({ rects }) {
  if (!rects?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {rects.map((r) => {
        const c = r.locked ? RED : 'rgba(255,255,255,0.6)'
        const k = Math.max(8, Math.min(22, Math.min(r.width, r.height) * 0.18))
        const t = r.locked ? 2.5 : 2
        return (
          <View key={r.key} style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }}>
            <View style={[s.corner, { left: 0, top: 0, width: k, height: k, borderLeftWidth: t, borderTopWidth: t, borderColor: c }]} />
            <View style={[s.corner, { right: 0, top: 0, width: k, height: k, borderRightWidth: t, borderTopWidth: t, borderColor: c }]} />
            <View style={[s.corner, { left: 0, bottom: 0, width: k, height: k, borderLeftWidth: t, borderBottomWidth: t, borderColor: c }]} />
            <View style={[s.corner, { right: 0, bottom: 0, width: k, height: k, borderRightWidth: t, borderBottomWidth: t, borderColor: c }]} />
            {r.locked && r.head && r.head.width > 6 ? (
              <View style={[s.headZone, { left: r.head.left - r.left, top: r.head.top - r.top, width: r.head.width, height: r.head.height, borderRadius: Math.max(r.head.width, r.head.height) / 2 }]} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
})

/**
 * Brackets that follow the live tracker (laser/liveBodies.js) at its own update rate
 * (~10-15/s) without re-rendering the game screen. The body the crosshair would hit (aim
 * assist, aimAssist.js) is the red, locked one.
 *   store: useLiveBodies(), view: { width, height } of the preview, zoom + zoomRect(r, view)
 *   from useScopeZoom (identity when omitted), onLock(id | null) when the locked body changes.
 */
export const LiveTargetBrackets = memo(function LiveTargetBrackets({ store, view, zoom = 1, zoomRect, max = 6, onLock }) {
  const [, setTick] = useState(0)
  const lockRef = useRef(null)
  useEffect(() => {
    if (!store?.subscribe) return undefined
    return store.subscribe(() => setTick((n) => (n + 1) % 1000000))
  }, [store])
  const W = view?.width || 0
  const H = view?.height || 0
  let rects = []
  let lockedId = null
  if (store?.running?.() && W > 0 && H > 0) {
    try {
      const bodies = (store.get() || []).slice(0, max)
      const pick = pickAimTarget(bodies, { aspect: W / H, zoom })
      lockedId = pick ? pick.body.id : null
      const toScreen = (r) => {
        const sr = { left: r.x * W, top: r.y * H, width: r.w * W, height: r.h * H }
        return zoomRect ? zoomRect(sr, view) : sr
      }
      rects = bodies.map((b) => {
        const r = toScreen(b.box)
        if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
        const locked = b.id === lockedId
        let head = null
        if (locked && b.head) {
          const hr = toScreen(b.head)
          if (Number.isFinite(hr.left) && Number.isFinite(hr.top)) head = hr
        }
        return { key: `live-${b.id}`, left: r.left, top: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height), locked, head }
      }).filter(Boolean)
    } catch {
      rects = []
    }
  }
  useEffect(() => {
    if (lockRef.current === lockedId) return
    lockRef.current = lockedId
    try { onLock?.(lockedId) } catch {}
  })
  return <TargetBrackets rects={rects} />
})

// ---------------------------------------------------------------------------
// Enemy markers over heads (from the camera's body detection): the studio nameplate.
// ---------------------------------------------------------------------------

const MARKER_W = 132

const EnemyMarker = memo(function EnemyMarker({ x, y, color, label, d, hp }) {
  const pos = useRef(new Animated.ValueXY({ x, y })).current
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start()
  }, [fade])
  useEffect(() => {
    Animated.spring(pos, { toValue: { x, y }, useNativeDriver: true, damping: 18, stiffness: 140 }).start()
  }, [x, y, pos])
  return (
    <Animated.View pointerEvents="none" style={[s.enemy, { opacity: fade, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <NameTag name={label} d={d} hp={hp} color={color} />
      <View style={[s.enemyMark, { borderTopColor: color }]} />
    </Animated.View>
  )
})

/** markers: [{ id, x, y, color, label, d?, hp? }] — x/y = screen point just above the head. */
export const EnemyMarkers = memo(function EnemyMarkers({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => <EnemyMarker key={m.id} x={m.x - MARKER_W / 2} y={m.y - 58} color={m.color || RED} label={m.label} d={m.d} hp={m.hp} />)}
    </View>
  )
})

const s = StyleSheet.create({
  fcol: { width: 34, alignItems: 'flex-end' },
  overlayRoot: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,13,17,0.94)' },
  boardWrap: { flex: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  close: { width: 40, height: 40, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  totals: { flexDirection: 'row', gap: 8 },
  totalTile: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 3, borderRadius: ST.radius },
  totalNum: { fontFamily: FONT.display, fontSize: 34, lineHeight: 38, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: ST.radius, backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border, maxWidth: 210 },
  chipImg: { width: 44, height: 24, tintColor: ST.text },
  chipName: { fontFamily: FONT.display, fontSize: 13, color: W, maxWidth: 140 },
  chipSub: { fontFamily: FONT.ui, fontSize: 10, color: ST.friendly, letterSpacing: 1 },
  tHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: ST.line },
  th: { ...stType.label, letterSpacing: 1.4 },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', borderLeftWidth: 3, borderLeftColor: 'transparent' },
  tRowMe: { backgroundColor: 'rgba(57,213,255,0.12)', borderLeftColor: ST.friendly },
  nameCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamSq: { width: 8, height: 8 },
  tdRank: { fontFamily: FONT.displaySemi, fontSize: 13, color: MUTED, fontVariant: ['tabular-nums'] },
  tdName: { flexShrink: 1, fontFamily: FONT.ui, fontSize: 15, color: ST.text },
  td: { fontFamily: FONT.displaySemi, fontSize: 14, color: W, fontVariant: ['tabular-nums'] },
  tdScore: { fontFamily: FONT.display, fontSize: 14, color: W, fontVariant: ['tabular-nums'] },
  c: { width: 26, textAlign: 'center' },
  cw: { width: 46, textAlign: 'right' },
  holdBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 18, paddingVertical: 10, borderRadius: ST.radius, borderWidth: 2, minWidth: 260, maxWidth: 360 },
  holdTitle: { fontFamily: FONT.display, fontSize: 17, color: W, letterSpacing: 1, ...stShadow },
  holdSub: { fontFamily: FONT.uiSemi, fontSize: 11, color: 'rgba(242,244,247,0.8)', marginTop: 1 },
  bigBtn: { paddingHorizontal: 30, paddingVertical: 16, borderRadius: ST.radius, minWidth: 240, alignItems: 'center' },
  bigBtnText: { fontFamily: FONT.display, fontSize: 18, color: ST.ink, letterSpacing: 2 },
  alert: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: ST.radius, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(8,10,14,0.86)', borderLeftWidth: 3 },
  alertIcon: { width: 34, height: 34, borderWidth: 1, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 1, color: W },
  alertSub: { fontFamily: FONT.uiSemi, fontSize: 12.5, color: 'rgba(242,244,247,0.85)', marginTop: 1 },
  bomb: { position: 'absolute', alignSelf: 'center', alignItems: 'center', backgroundColor: 'rgba(8,10,14,0.72)', borderRadius: ST.radius, paddingHorizontal: 16, paddingVertical: 4, borderTopWidth: 2, borderTopColor: RED },
  bombInline: { position: 'relative', paddingVertical: 2, paddingHorizontal: 14 },
  bombHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bombDiamond: { width: 6, height: 6, backgroundColor: RED, transform: [{ rotate: '45deg' }] },
  bombLabel: { fontFamily: FONT.ui, fontSize: 10, color: RED, letterSpacing: 2 },
  bombTime: { fontFamily: FONT.display, fontSize: 30, lineHeight: 32, color: W, fontVariant: ['tabular-nums'], includeFontPadding: false, ...stShadow },
  corner: { position: 'absolute' },
  headZone: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,61,82,0.75)' },
  enemy: { position: 'absolute', left: 0, top: 0, width: MARKER_W, alignItems: 'center' },
  enemyMark: { marginTop: 5, width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
})
