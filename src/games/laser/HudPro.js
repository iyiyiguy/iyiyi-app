// Laser Tag HUD, shooter style. Everything here is a dumb, memoised view fed by
// LaserTagGame.js: a compass tape with enemy pips, the status panel (HP / score / K-D),
// the match bar (timer, team score, round), the kill feed, the weapon card, enemy
// nameplates placed from GPS + compass, and floating score pops.
//
// Design tokens (one dark glass language over the camera): PANEL / BORDER, ACCENT (cyan),
// GOLD, RED, plus the team colours from multiplayer.js. Glows use CSS boxShadow so they
// look the same on iOS and Android.
import React, { memo, useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TEAMS, angleDiff, formatDistance } from '../../lib/multiplayer'
import { gunArt } from '../../lib/gunArt'
import { glowFor } from './gunGlow'

export const HUD = {
  panel: 'rgba(8,10,18,0.58)',
  panelStrong: 'rgba(8,10,18,0.78)',
  sheet: 'rgba(8,10,18,0.93)', // menus and sheets over the camera
  bg: '#07080f',
  border: 'rgba(255,255,255,0.16)',
  accent: '#3ad1ff',
  gold: '#ffc94d',
  red: '#ff3346',
  green: '#4dff9a',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.66)',
}
export const hudShadow = { textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }
const glow = (color, px = 10) => ({ boxShadow: `0 0 ${px}px ${color}` })
export const hudGlow = glow

// Type scale shared by every Laser Tag surface (HUD, menu, summary, lobby pieces).
export const hudType = {
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 2.4, color: HUD.accent, textTransform: 'uppercase' },
  label: { fontSize: 9.5, fontWeight: '900', letterSpacing: 1.4, color: HUD.muted, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 1.6, color: '#fff', textTransform: 'uppercase' },
  display: { fontSize: 44, fontWeight: '900', letterSpacing: 3, color: '#fff', textTransform: 'uppercase', fontVariant: ['tabular-nums'], includeFontPadding: false },
  body: { fontSize: 14, fontWeight: '600', lineHeight: 20, color: 'rgba(255,255,255,0.85)' },
  num: { fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], includeFontPadding: false },
}
export const hudPanel = { backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border, borderRadius: 12 }
export const hudSheet = { backgroundColor: HUD.sheet, borderWidth: 1, borderColor: HUD.border, borderRadius: 16, overflow: 'hidden' }

/** One call-to-action for menus and the summary. tone: 'accent' | 'danger' | 'gold' | 'ghost' */
export function HudCta({ title, onPress, tone = 'accent', icon, disabled, busy, style, compact = false }) {
  const fill = tone === 'accent' ? HUD.accent : tone === 'danger' ? HUD.red : tone === 'gold' ? HUD.gold : 'transparent'
  const fg = tone === 'ghost' ? '#fff' : HUD.bg
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.cta, compact && s.ctaCompact,
        { backgroundColor: fill, borderColor: tone === 'ghost' ? HUD.border : fill, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        tone !== 'ghost' && !disabled && glow(fill, 14),
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={16} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.ctaText, { color: fg }]} numberOfLines={1}>{String(title).toUpperCase()}</Text>
        </>
      )}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Compass tape: bearings scroll under a fixed centre caret; enemies show as pips.
// ---------------------------------------------------------------------------
const TAPE_FOV = 120 // degrees of bearing visible across the tape
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }

/** heading: degrees. pips: [{ id, bearing, color, kind?: 'enemy'|'objective'|'team' }] */
export const CompassTape = memo(function CompassTape({ heading, pips, width = 260, compact = false }) {
  if (!Number.isFinite(heading)) return null
  const pxPerDeg = width / TAPE_FOV
  const half = TAPE_FOV / 2
  const ticks = []
  const start = Math.ceil((heading - half) / 15) * 15
  for (let b = start; b <= heading + half; b += 15) {
    const off = angleDiff(b, heading)
    const x = width / 2 + off * pxPerDeg
    const norm = ((b % 360) + 360) % 360
    const label = CARDINALS[norm]
    const major = norm % 45 === 0
    ticks.push(
      <View key={b} style={[s.tick, { left: x - 0.5, height: major ? (label ? 7 : 9) : 5, opacity: 1 - Math.abs(off) / (half + 6) }]} />,
    )
    if (label) {
      ticks.push(
        <Text key={`l${b}`} style={[s.tickLabel, { left: x - 14, opacity: 1 - Math.abs(off) / (half + 6) }, norm === 0 && { color: HUD.red }]}>{label}</Text>,
      )
    }
  }
  return (
    <View style={[s.tape, { width, height: compact ? 34 : 40 }]} pointerEvents="none">
      <View style={s.tapeInner}>
        {ticks}
        {(pips || []).map((p) => {
          const off = angleDiff(p.bearing, heading)
          if (!Number.isFinite(off)) return null
          const clamped = Math.max(-half, Math.min(half, off))
          const x = width / 2 + clamped * pxPerDeg
          const edge = Math.abs(off) > half
          const color = p.color || HUD.red
          // Objectives (S&D bomb sites, the bomb) get a lettered badge instead of a diamond.
          if (p.label) {
            return (
              <View key={p.id} style={[s.pipBadge, { left: x - 8, borderColor: color, backgroundColor: edge ? 'rgba(0,0,0,0.6)' : color }]}>
                <Text style={[s.pipBadgeText, edge && { color }]} numberOfLines={1}>{p.label}</Text>
              </View>
            )
          }
          return (
            <View key={p.id} style={[s.pip, { left: x - 5, backgroundColor: edge ? 'transparent' : color, borderColor: color, ...(edge ? {} : glow(color, 6)) }]} />
          )
        })}
      </View>
      <View style={s.caret} />
      <Text style={s.tapeDeg}>{String(Math.round(heading) % 360).padStart(3, '0')}°</Text>
    </View>
  )
})

// ---------------------------------------------------------------------------
// Status panel: segmented HP bar, score, K/D, team.
// ---------------------------------------------------------------------------
export const StatusPanel = memo(function StatusPanel({ hp = 100, score = 0, kills = 0, deaths = 0, team = null, side = null, protectedNow = false, compact = false, width = 132 }) {
  const segs = 10
  const lit = Math.ceil((Math.max(0, Math.min(100, hp)) / 100) * segs)
  const hpColor = hp > 60 ? HUD.green : hp > 30 ? HUD.gold : HUD.red
  return (
    <View style={[s.panel, { width, paddingVertical: compact ? 6 : 8 }]} pointerEvents="none">
      <View style={s.rowBetween}>
        <Text style={s.label}>HP</Text>
        <Text style={[s.hpNum, { color: hpColor }]}>{Math.max(0, Math.round(hp))}</Text>
      </View>
      <View style={s.segRow}>
        {Array.from({ length: segs }, (_, i) => (
          <View key={i} style={[s.seg, i < lit ? { backgroundColor: hpColor, ...glow(hpColor, 4) } : s.segOff]} />
        ))}
      </View>
      <View style={[s.rowBetween, { marginTop: 5 }]}>
        <Text style={s.label}>SCORE</Text>
        <Text style={s.value}>{score}</Text>
      </View>
      <View style={s.rowBetween}>
        <Text style={s.label}>K / D</Text>
        <Text style={s.value}><Text style={{ color: HUD.green }}>{kills}</Text><Text style={{ color: HUD.muted }}> / </Text><Text style={{ color: HUD.red }}>{deaths}</Text></Text>
      </View>
      {team ? (
        <View style={[s.teamPill, { borderColor: TEAMS[team]?.color || HUD.accent }]}>
          <View style={[s.teamDot, { backgroundColor: TEAMS[team]?.color || HUD.accent }]} />
          <Text style={s.teamText} numberOfLines={1}>{TEAMS[team]?.name}{side ? ` · ${side === 'attack' ? 'ATK' : 'DEF'}` : ''}</Text>
        </View>
      ) : null}
      {protectedNow ? <Text style={[s.protect]}>SPAWN SHIELD</Text> : null}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Match bar: the clock (or LIVE), team score, round counter.
// ---------------------------------------------------------------------------
export const MatchBar = memo(function MatchBar({ clock, live = false, rank = null, of = null, mode, teamScore, snd, compact = false }) {
  return (
    <View style={[s.matchBar, compact && { paddingVertical: 3, paddingHorizontal: 9, minWidth: 72 }]} pointerEvents="none">
      {live ? (
        <View style={s.rowCenter}>
          <View style={[s.liveDot, glow(HUD.red, 6)]} />
          <Text style={[s.clock, compact && { fontSize: 18 }]}>LIVE</Text>
        </View>
      ) : (
        <Text style={[s.clock, compact && { fontSize: 19 }]}>{clock}</Text>
      )}
      {mode === 'tdm' && teamScore ? (
        <View style={s.rowCenter}>
          <Text style={[s.teamScore, { color: TEAMS.A.color }]}>{teamScore.A}</Text>
          <Text style={[s.teamScore, { color: HUD.muted, marginHorizontal: 6 }]}>–</Text>
          <Text style={[s.teamScore, { color: TEAMS.B.color }]}>{teamScore.B}</Text>
        </View>
      ) : null}
      {snd ? <Text style={s.sub}>ROUND {snd.roundNo}/{snd.totalRounds}  ·  <Text style={{ color: TEAMS.A.color }}>{snd.wins.A}</Text> – <Text style={{ color: TEAMS.B.color }}>{snd.wins.B}</Text></Text> : null}
      {live && rank ? <Text style={s.sub}>ARENA  ·  #{rank} OF {of}</Text> : null}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Kill feed: newest on top, each line fades in.
// ---------------------------------------------------------------------------
const FeedLine = memo(function FeedLine({ text }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 220, useNativeDriver: true }).start() }, [a])
  return (
    <Animated.View style={[s.feedLine, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
      <Text style={s.feedText} numberOfLines={1}>{text}</Text>
    </Animated.View>
  )
})

export const KillFeed = memo(function KillFeed({ feed, max = 3, align = 'flex-end' }) {
  if (!feed?.length) return null
  return (
    <View style={[s.feed, { alignItems: align }]} pointerEvents="none">
      {feed.slice(0, max).map((f) => <FeedLine key={f.id} text={f.text} />)}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Weapon card (tap = weapon wheel)
// ---------------------------------------------------------------------------
export const WeaponCard = memo(function WeaponCard({ weapon, count, onWheel, maxWidth, compact = false }) {
  const color = glowFor(weapon?.id)
  const mode = weapon?.automatic ? 'AUTO' : weapon?.shotsPerClick > 1 ? `BURST ${weapon.shotsPerClick}` : 'SEMI'
  return (
    <Pressable
      onPress={onWheel}
      hitSlop={6}
      style={({ pressed }) => [s.weapon, Number.isFinite(maxWidth) && { maxWidth }, pressed && { transform: [{ scale: 0.96 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Weapon: ${weapon?.name}. Tap to choose a weapon`}
    >
      <View style={[s.weaponAccent, { backgroundColor: color, ...glow(color, 8) }]} />
      <Image source={gunArt(weapon?.id)} style={[s.weaponImg, compact && { width: 46, height: 26 }]} resizeMode="contain" />
      <View style={{ flexShrink: 1 }}>
        <Text style={s.weaponName} numberOfLines={1}>{String(weapon?.name || '').toUpperCase()}</Text>
        <View style={s.rowCenter}>
          <Text style={[s.weaponMode, { color }]}>{mode}</Text>
          <Text style={s.weaponAmmo}>  ∞</Text>
          {count > 1 ? <Text style={s.weaponMore}>  ·  {count} ▾</Text> : null}
        </View>
      </View>
    </Pressable>
  )
})

// ---------------------------------------------------------------------------
// Enemy nameplates placed from GPS + compass (no camera lock needed).
// markers: binocularMarkers() output + { hp, close }
// ---------------------------------------------------------------------------
const Plate = memo(function Plate({ x, y, name, d, color, hp, close, inView, side }) {
  const pos = useRef(new Animated.ValueXY({ x, y })).current
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start() }, [fade])
  useEffect(() => {
    Animated.spring(pos, { toValue: { x, y }, useNativeDriver: true, damping: 20, stiffness: 160 }).start()
  }, [x, y, pos])
  if (!inView) {
    return (
      <Animated.View style={[s.plateEdge, side === 'right' ? { right: 6 } : { left: 6 }, { opacity: fade, transform: [{ translateY: pos.y }] }]}>
        {side === 'left' ? <Ionicons name="caret-back" size={14} color={color} /> : null}
        <Text style={s.plateEdgeText} numberOfLines={1}>{name} · {formatDistance(d)}</Text>
        {side === 'right' ? <Ionicons name="caret-forward" size={14} color={color} /> : null}
      </Animated.View>
    )
  }
  const hpW = Math.max(0, Math.min(1, (hp ?? 100) / 100))
  return (
    <Animated.View pointerEvents="none" style={[s.plate, { opacity: fade, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <View style={[s.plateBox, { borderColor: color }]}>
        <Text style={[s.plateName, { color }]} numberOfLines={1}>{name}</Text>
        <Text style={s.plateDist}>{close ? 'POINT BLANK' : formatDistance(d)}</Text>
        <View style={s.plateHp}><View style={[s.plateHpFill, { width: `${hpW * 100}%`, backgroundColor: hpW > 0.3 ? color : HUD.red }]} /></View>
      </View>
      <View style={[s.plateDiamond, { backgroundColor: color, ...glow(color, 8) }]} />
    </Animated.View>
  )
})

export const Nameplates = memo(function Nameplates({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => (
        <Plate key={m.id} x={m.x - 62} y={m.y - 64} name={m.name} d={m.d} color={m.color} hp={m.hp} close={m.close} inView={m.inView} side={m.side} />
      ))}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Score pops: "+10 HIT", "+100 TAGGED OUT" drifting up from the crosshair.
// ---------------------------------------------------------------------------
const POP_MS = 900
const Pop = memo(function Pop({ id, points, label, color, index, onDone }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: POP_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.pop, {
        opacity: a.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -56 - index * 10] }) },
          { translateX: 46 + index * 6 },
          { scale: a.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) },
        ],
      }]}
    >
      <Text style={[s.popPts, { color }]}>+{points}</Text>
      {label ? <Text style={s.popLabel}>{label}</Text> : null}
    </Animated.View>
  )
})

export const ScorePops = memo(function ScorePops({ pops, onDone }) {
  if (!pops?.length) return null
  return (
    <View style={s.popWrap} pointerEvents="none">
      {pops.map((p, i) => <Pop key={p.id} id={p.id} points={p.points} label={p.label} color={p.color || HUD.gold} index={i} onDone={onDone} />)}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Small round HUD buttons (optics row) and the fire button.
// ---------------------------------------------------------------------------
export function HudButton({ onPress, on = false, onColor = HUD.gold, icon, emoji, text, accessibilityLabel, children }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [s.hudBtn, on && { backgroundColor: onColor, borderColor: onColor, ...glow(onColor, 10) }, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {icon ? <Ionicons name={icon} size={14} color={on ? '#10121f' : '#fff'} /> : null}
      {emoji ? <Text style={{ fontSize: 14 }}>{emoji}</Text> : null}
      {children}
      {text ? <Text style={[s.hudBtnText, on && { color: '#10121f' }]}>{text}</Text> : null}
    </Pressable>
  )
}

export const FireButton = memo(function FireButton({ onPressIn, onPressOut, disabled, compact = false, locked = false, auto = false }) {
  const size = compact ? 92 : 108
  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={({ pressed }) => [s.fire, { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, locked && s.fireLocked, pressed && { transform: [{ scale: 0.95 }] }]}
      accessibilityRole="button"
      accessibilityLabel={auto ? 'Fire. Hold for continuous fire' : 'Fire'}
    >
      <View style={[s.fireRing, { width: size - 14, height: size - 14, borderRadius: (size - 14) / 2 }]} />
      <Text style={[s.fireText, compact && { fontSize: 16 }]}>FIRE</Text>
      <Text style={s.fireSub}>{auto ? 'HOLD' : 'TAP'}</Text>
    </Pressable>
  )
})

const s = StyleSheet.create({
  cta: { height: 50, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ctaCompact: { height: 42, paddingHorizontal: 14 },
  ctaText: { fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  // tape
  tape: { alignSelf: 'center', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 10, backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border },
  tapeInner: { position: 'absolute', left: 0, right: 0, top: 4, bottom: 14 },
  tick: { position: 'absolute', bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.75)' },
  tickLabel: { position: 'absolute', top: 0, width: 28, textAlign: 'center', fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.5, ...hudShadow },
  pip: { position: 'absolute', bottom: -2, width: 10, height: 10, borderRadius: 2, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  pipBadge: { position: 'absolute', bottom: -4, width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pipBadgeText: { fontSize: 9, fontWeight: '900', color: '#000' },
  caret: { position: 'absolute', top: -1, alignSelf: 'center', width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: HUD.accent },
  tapeDeg: { position: 'absolute', bottom: 1, alignSelf: 'center', fontSize: 10, fontWeight: '900', color: HUD.accent, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  // panel
  panel: { backgroundColor: HUD.panel, borderRadius: 12, borderWidth: 1, borderColor: HUD.border, paddingHorizontal: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1.4, color: HUD.muted },
  value: { fontSize: 13, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  hpNum: { fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  segRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  seg: { flex: 1, height: 6, borderRadius: 1.5 },
  segOff: { backgroundColor: 'rgba(255,255,255,0.14)' },
  teamPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  teamDot: { width: 7, height: 7, borderRadius: 4 },
  teamText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.6 },
  protect: { marginTop: 5, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: HUD.green },
  // match bar
  matchBar: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12, backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border, minWidth: 96 },
  clock: { fontSize: 24, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], letterSpacing: 0.5, ...hudShadow },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HUD.red, marginRight: 7 },
  teamScore: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 9.5, fontWeight: '900', letterSpacing: 1.2, color: HUD.muted, marginTop: 1 },
  // feed
  feed: { gap: 3, maxWidth: '72%' },
  feedLine: { backgroundColor: HUD.panel, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderLeftWidth: 3, borderLeftColor: HUD.red },
  feedText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  // weapon
  weapon: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: HUD.panelStrong, borderWidth: 1, borderColor: HUD.border, maxWidth: 230, overflow: 'hidden' },
  weaponAccent: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2 },
  weaponImg: { width: 54, height: 30, marginLeft: 4 },
  weaponName: { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 1, maxWidth: 140 },
  weaponMode: { fontSize: 9.5, fontWeight: '900', letterSpacing: 1 },
  weaponAmmo: { fontSize: 11, fontWeight: '900', color: '#fff' },
  weaponMore: { fontSize: 9.5, fontWeight: '800', color: HUD.muted },
  // plates
  plate: { position: 'absolute', left: 0, top: 0, width: 124, alignItems: 'center' },
  plateBox: { alignItems: 'center', backgroundColor: HUD.panelStrong, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 124 },
  plateName: { fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
  plateDist: { fontSize: 10, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  plateHp: { marginTop: 3, width: 70, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  plateHpFill: { height: 3, borderRadius: 2 },
  plateDiamond: { width: 9, height: 9, marginTop: 5, transform: [{ rotate: '45deg' }] },
  plateEdge: { position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: HUD.panelStrong, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, maxWidth: 170, borderWidth: 1, borderColor: HUD.border },
  plateEdgeText: { color: '#fff', fontSize: 11, fontWeight: '800', flexShrink: 1 },
  // pops
  popWrap: { position: 'absolute', left: 0, right: 0, top: '46%', alignItems: 'center' },
  pop: { position: 'absolute', alignItems: 'center' },
  popPts: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5, ...hudShadow },
  popLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.6, color: '#fff', marginTop: -2, ...hudShadow },
  // buttons
  hudBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 18, backgroundColor: HUD.panelStrong, borderWidth: 1, borderColor: HUD.border },
  hudBtnText: { color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.6 },
  fire: { backgroundColor: '#c2102a', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.92)', boxShadow: '0 0 18px rgba(255,51,70,0.75)' },
  fireLocked: { borderColor: '#ffd23f', boxShadow: '0 0 22px rgba(255,210,63,0.85)' },
  fireRing: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  fireText: { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 3, ...hudShadow },
  fireSub: { fontSize: 8, fontWeight: '900', color: 'rgba(255,255,255,0.8)', letterSpacing: 2, marginTop: -1 },
})
