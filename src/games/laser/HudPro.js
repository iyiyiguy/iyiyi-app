// Laser Tag HUD, studio style (src/games/studio.js). Everything here is a dumb, memoised
// view fed by LaserTagGame.js: the compass tape, the health panel, the team-score panel and
// clock, the kill feed, the weapon card, enemy nameplates placed from GPS + compass, score
// pops, the small HUD tiles and the FIRE button.
//
// Kit rules: colour means role (friendly #39d5ff = you / your team, enemy #ff3d52, objective
// #ffb21e, health #5cf2a0), black glass panels (55-72%) with square corners and accent
// edges, Chakra Petch for numbers / names / banners, Barlow Semi Condensed caps for labels.
// No emoji in HUD chrome. Every label over the camera gets a text shadow.
import React, { memo, useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Path } from 'react-native-svg'
import { angleDiff, formatDistance } from '../../lib/multiplayer'
import { gunArt } from '../../lib/gunArt'
import { FONT, ST, stGlow, stShadow, stType, withAlpha } from '../studio'

// Legacy token names (GamePlayScreen, the lobby and the menu import these) re-pointed at
// the studio palette so every Laser Tag surface shifts together.
export const HUD = {
  panel: 'rgba(8,10,14,0.62)',
  panelStrong: ST.panel,
  sheet: 'rgba(11,13,17,0.95)', // menus and sheets over the camera
  bg: ST.ground,
  border: 'rgba(255,255,255,0.16)',
  accent: ST.friendly,
  gold: ST.objective,
  red: ST.enemy,
  green: ST.health,
  text: ST.text,
  muted: ST.muted,
  faint: ST.faint,
  friendly: ST.friendly,
  enemy: ST.enemy,
  objective: ST.objective,
  health: ST.health,
  armor: ST.armor,
  ink: ST.ink,
}
export const hudShadow = stShadow
export const hudGlow = (color, px = 10) => stGlow(color, px)

// Type scale shared by every Laser Tag surface (HUD, menu, summary, lobby pieces).
export const hudType = {
  kicker: stType.kicker,
  label: stType.label,
  title: stType.title,
  display: stType.display,
  body: stType.body,
  small: stType.small,
  num: stType.num,
  name: stType.name,
}
export const hudPanel = { backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border, borderRadius: ST.radius }
export const hudSheet = { backgroundColor: HUD.sheet, borderWidth: 1, borderColor: ST.line, borderRadius: ST.radius, overflow: 'hidden' }

/** Role colour of player `id` as seen by me: friendly (me / my team) or enemy. */
export function relColor(state, meId, id) {
  if (!id) return ST.enemy
  if (id === meId) return ST.friendly
  if (!state || state.mode === 'ffa') return ST.enemy
  const mine = state.players?.[meId]?.team
  return mine && state.players?.[id]?.team === mine ? ST.friendly : ST.enemy
}

/** Kill-feed gun glyph (kit). */
export function GunGlyph({ color = ST.text, size = 16 }) {
  return (
    <Svg width={size} height={size * 0.62} viewBox="0 0 24 14" fill="none">
      <Path d="M1 7h14l3-4h5M15 7l2 5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** One call-to-action for menus and the summary. tone: 'accent' | 'danger' | 'gold' | 'ghost' | 'white' */
export function HudCta({ title, onPress, tone = 'accent', icon, disabled, busy, style, compact = false }) {
  const fill = tone === 'accent' ? ST.friendly : tone === 'danger' ? ST.enemy : tone === 'gold' ? ST.objective : tone === 'white' ? '#ffffff' : 'transparent'
  const fg = tone === 'ghost' || tone === 'danger' ? '#ffffff' : ST.ink
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={String(title)}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        s.cta, compact && s.ctaCompact,
        { backgroundColor: fill, borderColor: tone === 'ghost' ? ST.lineStrong : fill, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={16} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.ctaText, compact && { fontSize: 13 }, { color: fg }]} numberOfLines={1}>{String(title).toUpperCase()}</Text>
        </>
      )}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Compass tape (kit): a hairline with ticks, cardinals above, the bearing in the middle,
// a white caret under the line. Enemies are red diamonds, objectives gold lettered diamonds.
// ---------------------------------------------------------------------------
const TAPE_FOV = 120 // degrees of bearing visible across the tape
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
const TAPE_LINE_Y = 18

/** heading: degrees. pips: [{ id, bearing, color, label? }] */
export const CompassTape = memo(function CompassTape({ heading, pips, width = 220, compact = false }) {
  if (!Number.isFinite(heading)) return null
  const pxPerDeg = width / TAPE_FOV
  const half = TAPE_FOV / 2
  const cx = width / 2
  const fade = (off) => Math.max(0, 1 - Math.abs(off) / (half + 4))
  const ticks = []
  const start = Math.ceil((heading - half) / 15) * 15
  for (let b = start; b <= heading + half; b += 15) {
    const off = angleDiff(b, heading)
    const x = cx + off * pxPerDeg
    const norm = ((b % 360) + 360) % 360
    const label = CARDINALS[norm]
    ticks.push(<View key={b} style={[s.tick, { left: x - 0.5, height: label ? 7 : 5, top: TAPE_LINE_Y - (label ? 7 : 5), opacity: 0.35 + 0.5 * fade(off) }]} />)
    // The bearing readout owns the middle: a cardinal right under it is skipped.
    if (label && Math.abs(x - cx) > 20) {
      ticks.push(
        <Text key={`l${b}`} style={[s.tickLabel, { left: x - 14, opacity: fade(off) }, norm === 0 && { color: ST.enemy }]}>{label}</Text>,
      )
    }
  }
  return (
    <View style={[s.tape, { width, height: compact ? 30 : 32 }]} pointerEvents="none">
      <View style={[s.tapeLine, { top: TAPE_LINE_Y }]} />
      {ticks}
      {(pips || []).map((p) => {
        const off = angleDiff(p.bearing, heading)
        if (!Number.isFinite(off)) return null
        const edge = Math.abs(off) > half
        const x = cx + Math.max(-half, Math.min(half, off)) * pxPerDeg
        const color = p.color || ST.enemy
        if (p.label) {
          return (
            <View key={p.id} style={[s.pipObj, { left: x - 7, top: TAPE_LINE_Y - 7 }]}>
              <View style={[s.pipObjDiamond, { backgroundColor: edge ? 'rgba(8,10,14,0.8)' : color, borderColor: color }]} />
              <Text style={[s.pipObjText, edge && { color }]} numberOfLines={1}>{p.label}</Text>
            </View>
          )
        }
        return <View key={p.id} style={[s.pip, { left: x - 4, top: TAPE_LINE_Y - 4, backgroundColor: edge ? 'transparent' : color, borderColor: color }]} />
      })}
      <View style={[s.caret, { left: cx - 5, top: TAPE_LINE_Y + 3 }]} />
      <Text style={[s.tapeDeg, { left: cx - 20 }]}>{String(((Math.round(heading) % 360) + 360) % 360).padStart(3, '0')}°</Text>
    </View>
  )
})

// ---------------------------------------------------------------------------
// Health panel (bottom-left): big HP number, 10 segments, points + K / D.
// ---------------------------------------------------------------------------
export const StatusPanel = memo(function StatusPanel({ hp = 100, score = 0, kills = 0, deaths = 0, protectedNow = false, compact = false, width = 172 }) {
  const segs = 10
  const v = Math.max(0, Math.min(100, hp))
  const lit = Math.ceil((v / 100) * segs)
  const color = v > 60 ? ST.health : v > 30 ? ST.objective : ST.enemy
  return (
    <View style={[s.health, { width }, protectedNow && { borderTopColor: ST.armor }]} pointerEvents="none" accessibilityLabel={`Health ${Math.round(v)}. ${score} points. ${kills} tag-outs, ${deaths} deaths`}>
      <View style={s.healthHead}>
        <Text style={[s.hpNum, compact && { fontSize: 26, lineHeight: 28 }, v <= 30 && { color: ST.enemy }]}>{Math.round(v)}</Text>
        <Text style={[stType.label, protectedNow && { color: ST.armor }]} numberOfLines={1}>{protectedNow ? 'SPAWN SHIELD' : 'HEALTH'}</Text>
      </View>
      <View style={s.segRow}>
        {Array.from({ length: segs }, (_, i) => (
          <View key={i} style={[s.seg, { backgroundColor: i < lit ? (protectedNow ? ST.armor : color) : 'rgba(255,255,255,0.16)' }]} />
        ))}
      </View>
      <View style={s.healthFoot}>
        <Text style={s.healthFootText} numberOfLines={1}>{score} PTS</Text>
        <Text style={[s.healthFootText, { color: 'rgba(242,244,247,0.75)' }]} numberOfLines={1}>K {kills} · D {deaths}</Text>
      </View>
    </View>
  )
})

// ---------------------------------------------------------------------------
// Score panel (top-left) + clock (top-centre). Tap the panel for the scoreboard.
// ---------------------------------------------------------------------------
const MODE_LABEL = { ffa: 'FREE-FOR-ALL', tdm: 'TEAM DEATHMATCH', snd: 'SEARCH & DESTROY' }

function ScoreRow({ value, max, color, label, pips }) {
  return (
    <View style={s.scoreRow}>
      <Text style={[s.scoreNum, { color }]} numberOfLines={1}>{value}</Text>
      {pips ? (
        <View style={s.pipsRow}>
          {Array.from({ length: pips }, (_, i) => <View key={i} style={[s.winPip, { backgroundColor: i < value ? color : 'rgba(255,255,255,0.14)' }]} />)}
        </View>
      ) : (
        <View style={s.scoreTrack}><View style={[s.scoreFill, { width: `${Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100}%`, backgroundColor: color }]} /></View>
      )}
      {label ? <Text style={s.scoreRowLabel} numberOfLines={1}>{label}</Text> : null}
    </View>
  )
}

/**
 * mode: 'ffa' | 'tdm' | 'snd'. teamScore {A,B}; snd state; myTeam; players (FFA standings);
 * rank / of for the endless arena (live = true).
 */
export const ScorePanel = memo(function ScorePanel({ mode, teamScore, snd, myTeam, meId, players, live = false, rank = null, of = null, onPress, width = 138 }) {
  const enemyTeam = myTeam === 'A' ? 'B' : 'A'
  let body = null
  let foot = null
  if (live) {
    const me = players?.[meId]
    body = <ScoreRow value={me?.score || 0} max={1} color={ST.friendly} label="PTS" />
    foot = rank ? `ARENA · #${rank} OF ${of}` : 'ARENA'
  } else if (mode === 'tdm' && teamScore && myTeam) {
    const a = teamScore[myTeam] || 0
    const b = teamScore[enemyTeam] || 0
    const max = Math.max(10, a, b)
    body = <><ScoreRow value={a} max={max} color={ST.friendly} /><ScoreRow value={b} max={max} color={ST.enemy} /></>
    foot = a === b ? 'TIED' : a > b ? `LEADING BY ${a - b}` : `DOWN ${b - a}`
  } else if (mode === 'snd' && snd && myTeam) {
    const needed = Math.floor((snd.totalRounds || 5) / 2) + 1
    const a = snd.wins?.[myTeam] || 0
    const b = snd.wins?.[enemyTeam] || 0
    body = <><ScoreRow value={a} pips={needed} color={ST.friendly} /><ScoreRow value={b} pips={needed} color={ST.enemy} /></>
    foot = `ROUND ${snd.roundNo}/${snd.totalRounds} · ${snd.sides?.[myTeam] === 'attack' ? 'ATTACK' : 'DEFEND'}`
  } else {
    // FFA: you vs the leader (or vs second place when you lead).
    const ranked = Object.entries(players || {}).map(([id, p]) => ({ id, score: p.score || 0 })).sort((x, y) => y.score - x.score)
    const mine = players?.[meId]?.score || 0
    const myRank = 1 + ranked.filter((r) => r.score > mine).length
    const rival = ranked.find((r) => r.id !== meId)
    const max = Math.max(100, mine, rival?.score || 0)
    body = <><ScoreRow value={mine} max={max} color={ST.friendly} label="YOU" /><ScoreRow value={rival?.score || 0} max={max} color={ST.enemy} label={myRank === 1 ? '2ND' : 'LEAD'} /></>
    foot = `#${myRank} OF ${ranked.length || 1}`
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [s.scorePanel, { width }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel="Score. Tap for the scoreboard"
    >
      <View style={s.scoreHead}>
        <Text style={[stType.label, { flexShrink: 1, fontSize: 9.5, letterSpacing: 1.4 }]} numberOfLines={1}>{live ? 'LIVE ARENA' : MODE_LABEL[mode] || 'LASER TAG'}</Text>
        <Ionicons name="podium-outline" size={11} color={ST.muted} />
      </View>
      {body}
      {foot ? <Text style={s.scoreFoot} numberOfLines={1}>{foot}</Text> : null}
    </Pressable>
  )
})

/** The match clock (or LIVE for the endless arena). kicker: optional line above (HIP FIRE). */
export const MatchClock = memo(function MatchClock({ clock, live = false, kicker = null, compact = false }) {
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="none">
      {kicker ? <Text style={[stType.kicker, stShadow, { fontSize: 10 }]}>{kicker}</Text> : null}
      {live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={s.liveDot} />
          <Text style={[s.clock, compact && { fontSize: 22 }]}>LIVE</Text>
        </View>
      ) : (
        <Text style={[s.clock, compact && { fontSize: 22 }]}>{clock}</Text>
      )}
    </View>
  )
})

// Kept for older importers: clock + compact team score in one block.
export const MatchBar = memo(function MatchBar({ clock, live = false, compact = false }) {
  return <MatchClock clock={clock} live={live} compact={compact} />
})

// ---------------------------------------------------------------------------
// Kill feed: newest on top. "SHOOTER  [gun]  VICTIM", names in role colours; your own
// tag-outs are highlighted. Other lines (bomb planted, half time) are plain.
// ---------------------------------------------------------------------------
const KILL_RE = /^(.+?) (⟶|🎯|🚀💥|💥) (.+?)(?: \((headshot|land mine|sticky bomb)\))?$/
const LEAD_SYMBOLS = ['💣 ', '💥 ', '✅ ', '🔄 ']
const STRIP = ['💣', '💥', '✅', '🔄', '🎯', '⟶', '🚀', '⚠️', '🧨', '💀', '🎬']
/** Removes the engine's emoji from a line of text (HUD chrome stays emoji-free). */
export function stripSymbols(text) {
  let t = String(text || '')
  for (const sym of STRIP) t = t.split(sym).join('')
  return t.replace(/\s{2,}/g, ' ').trim()
}

/** Parses an engine feed line into { kind: 'kill', a, b, how } or { kind: 'text', text, icon }. */
export function parseFeedLine(text) {
  const t = String(text || '')
  const m = KILL_RE.exec(t)
  if (m) {
    const how = m[2] === '🎯' || m[4] === 'headshot' ? 'head' : m[2] === '⟶' ? 'gun' : 'blast'
    return { kind: 'kill', a: m[1], b: m[3], how }
  }
  let rest = t
  let icon = null
  for (const sym of LEAD_SYMBOLS) {
    if (rest.startsWith(sym)) {
      rest = rest.slice(sym.length)
      icon = sym === '💣 ' ? 'flag' : sym === '💥 ' ? 'flame' : sym === '✅ ' ? 'shield-checkmark' : 'swap-horizontal'
      break
    }
  }
  if (!icon && / joined the arena$/.test(rest)) icon = 'enter-outline'
  if (!icon && / dropped the bomb$/.test(rest)) icon = 'flag-outline'
  if (!icon && / picked up the bomb$/.test(rest)) icon = 'flag'
  return { kind: 'text', text: stripSymbols(rest), icon }
}

const FeedLine = memo(function FeedLine({ line, colorOf, idOf, meId }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start() }, [a])
  const anim = { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }
  if (line.kind === 'kill') {
    const aId = idOf(line.a)
    const bId = idOf(line.b)
    const mine = aId && aId === meId
    const gotMe = bId && bId === meId
    return (
      <Animated.View style={[s.feedLine, mine && s.feedMine, gotMe && s.feedGotMe, anim]}>
        <Text style={[s.feedName, { color: colorOf(aId) }]} numberOfLines={1}>{mine ? 'YOU' : line.a.toUpperCase()}</Text>
        {line.how === 'blast'
          ? <Ionicons name="flame" size={12} color={ST.text} />
          : <GunGlyph color={ST.text} />}
        {line.how === 'head' ? <Ionicons name="locate" size={11} color={ST.objective} /> : null}
        <Text style={[s.feedName, { color: colorOf(bId) }]} numberOfLines={1}>{gotMe ? 'YOU' : line.b.toUpperCase()}</Text>
      </Animated.View>
    )
  }
  return (
    <Animated.View style={[s.feedLine, anim]}>
      {line.icon ? <Ionicons name={line.icon} size={12} color={ST.objective} /> : null}
      <Text style={s.feedText} numberOfLines={1}>{line.text}</Text>
    </Animated.View>
  )
})

/** feed: state.feed. state + meId give name colours (friendly / enemy). */
export const KillFeed = memo(function KillFeed({ feed, max = 3, align = 'flex-end', state, meId }) {
  if (!feed?.length) return null
  const byName = {}
  for (const [id, p] of Object.entries(state?.players || {})) if (p?.name && !byName[p.name]) byName[p.name] = id
  const idOf = (name) => byName[name] || null
  const colorOf = (id) => (id ? relColor(state, meId, id) : ST.text)
  return (
    <View style={[s.feed, { alignItems: align }]} pointerEvents="none">
      {feed.slice(0, max).map((f) => <FeedLine key={f.id} line={parseFeedLine(f.text)} colorOf={colorOf} idOf={idOf} meId={meId} />)}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Weapon card (bottom-right). Tap = weapon wheel.
// ---------------------------------------------------------------------------
export const fireModeLabel = (w) => (w?.automatic || w?.fireMode === 'automatic' ? 'AUTO' : (w?.shotsPerClick || 1) > 1 ? `BURST ${w.shotsPerClick}` : 'SEMI')

export const WeaponCard = memo(function WeaponCard({ weapon, count, onWheel, maxWidth, width = 170, compact = false }) {
  const mode = fireModeLabel(weapon)
  return (
    <Pressable
      onPress={onWheel}
      hitSlop={6}
      style={({ pressed }) => [s.weapon, { width }, Number.isFinite(maxWidth) && { maxWidth }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Weapon: ${weapon?.name}, ${mode}. Tap to change weapon`}
    >
      <View style={s.weaponTop}>
        <Image source={gunArt(weapon?.id)} style={[s.weaponImg, compact && { width: 60, height: 22 }]} resizeMode="contain" />
        <Text style={s.weaponAmmo}>∞</Text>
      </View>
      <View style={s.weaponBottom}>
        <Text style={s.weaponName} numberOfLines={1}>{String(weapon?.name || '').toUpperCase()}</Text>
        <View style={s.weaponModeRow}>
          <Text style={s.weaponMode}>{mode}</Text>
          {count > 1 ? <Ionicons name="swap-horizontal" size={12} color={ST.muted} /> : null}
        </View>
      </View>
    </Pressable>
  )
})

// ---------------------------------------------------------------------------
// Enemy nameplates placed from GPS + compass (no camera lock needed).
// markers: binocularMarkers() output + { hp, close }
// ---------------------------------------------------------------------------
const PLATE_W = 132

/** The nameplate itself (shared by GPS plates and camera-locked markers). */
export function NameTag({ name, d, hp, color = ST.enemy, close = false }) {
  const hpW = Math.max(0, Math.min(1, (hp ?? 100) / 100))
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      <View style={s.plateBox}>
        <View style={[s.plateDiamond, { backgroundColor: color }]} />
        <Text style={s.plateName} numberOfLines={1}>{String(name || 'Enemy').toUpperCase()}</Text>
        {close || Number.isFinite(d) ? <Text style={s.plateDist} numberOfLines={1}>{close ? 'CLOSE' : formatDistance(d).toUpperCase()}</Text> : null}
      </View>
      {hp != null ? <View style={s.plateHp}><View style={[s.plateHpFill, { width: `${hpW * 100}%`, backgroundColor: color }]} /></View> : null}
    </View>
  )
}

const Plate = memo(function Plate({ x, y, name, d, color, hp, close, inView, side }) {
  const pos = useRef(new Animated.ValueXY({ x, y })).current
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start() }, [fade])
  useEffect(() => {
    Animated.spring(pos, { toValue: { x, y }, useNativeDriver: true, damping: 20, stiffness: 160 }).start()
  }, [x, y, pos])
  if (!inView) {
    return (
      <Animated.View style={[s.plateEdge, side === 'right' ? { right: 6 } : { left: 6 }, { opacity: fade, transform: [{ translateY: pos.y }] }]}>
        {side === 'left' ? <Ionicons name="caret-back" size={13} color={color} /> : null}
        <Text style={s.plateEdgeText} numberOfLines={1}>{String(name || '').toUpperCase()} · {formatDistance(d).toUpperCase()}</Text>
        {side === 'right' ? <Ionicons name="caret-forward" size={13} color={color} /> : null}
      </Animated.View>
    )
  }
  return (
    <Animated.View pointerEvents="none" style={[s.plate, { opacity: fade, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <NameTag name={name} d={d} hp={hp} color={color} close={close} />
      <View style={[s.plateMark, { backgroundColor: color }]} />
    </Animated.View>
  )
})

export const Nameplates = memo(function Nameplates({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => (
        <Plate key={m.id} x={m.x - PLATE_W / 2} y={m.y - 56} name={m.name} d={m.d} color={m.color || ST.enemy} hp={m.hp} close={m.close} inView={m.inView} side={m.side} />
      ))}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Score pops: "+10 / BODY HIT" rising from beside the reticle (kit: 600 ms).
// ---------------------------------------------------------------------------
const POP_MS = 650
const Pop = memo(function Pop({ id, points, label, color, index, onDone }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: POP_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(id))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.pop, {
        opacity: a.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -44 - index * 8] }) },
          { translateX: 40 + index * 4 },
          { scale: a.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.7, 1.1, 1] }) },
        ],
      }]}
    >
      <Text style={[s.popPts, { color }]}>+{points}</Text>
      {label ? <Text style={s.popLabel}>{label}</Text> : null}
    </Animated.View>
  )
})

export const ScorePops = memo(function ScorePops({ pops, onDone, top = '46%' }) {
  if (!pops?.length) return null
  return (
    <View style={[s.popWrap, { top }]} pointerEvents="none">
      {pops.map((p, i) => <Pop key={p.id} id={p.id} points={p.points} label={p.label} color={p.color || '#ffffff'} index={i} onDone={onDone} />)}
    </View>
  )
})

// ---------------------------------------------------------------------------
// Square HUD tiles (optics row) and the FIRE button.
// ---------------------------------------------------------------------------
export function HudButton({ onPress, on = false, onColor = ST.objective, icon, text, accessibilityLabel, children, size = 38 }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [s.hudBtn, { minWidth: size, height: size }, on && { borderColor: onColor, backgroundColor: withAlpha(onColor, 0.22) }, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!on }}
    >
      {icon ? <Ionicons name={icon} size={16} color={on ? onColor : ST.text} /> : null}
      {children}
      {text ? <Text style={[s.hudBtnText, on && { color: onColor }]} numberOfLines={1}>{text}</Text> : null}
    </Pressable>
  )
}

export const FireButton = memo(function FireButton({ onPressIn, onPressOut, disabled, compact = false, locked = false, auto = false }) {
  const size = compact ? 84 : 98
  const c = locked ? ST.enemy : '#ffffff'
  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={({ pressed }) => [s.fire, { width: size, height: size, borderRadius: size / 2, borderColor: c, opacity: disabled ? 0.4 : 1 }, locked && { backgroundColor: 'rgba(255,61,82,0.28)' }, pressed && { transform: [{ scale: 0.94 }], backgroundColor: locked ? 'rgba(255,61,82,0.45)' : 'rgba(255,255,255,0.18)' }]}
      accessibilityRole="button"
      accessibilityLabel={auto ? 'Fire. Hold for continuous fire' : 'Fire'}
    >
      <View style={[s.fireRing, { width: size - 14, height: size - 14, borderRadius: (size - 14) / 2 }]} />
      <Svg width={24} height={24} viewBox="0 0 56 56" fill="none">
        <Path d="M28 6v12M28 38v12M6 28h12M38 28h12" stroke={c} strokeWidth={4} />
      </Svg>
      <Text style={[s.fireText, { color: c }]}>FIRE</Text>
      <Text style={s.fireSub}>{auto ? 'HOLD' : 'TAP'}</Text>
    </Pressable>
  )
})

const s = StyleSheet.create({
  cta: { height: 50, borderRadius: ST.radius, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ctaCompact: { height: 42, paddingHorizontal: 14 },
  ctaText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 2 },
  // tape
  tape: { alignSelf: 'center' },
  tapeLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  tick: { position: 'absolute', width: 1, backgroundColor: '#ffffff' },
  tickLabel: { position: 'absolute', top: -1, width: 28, textAlign: 'center', fontFamily: FONT.display, fontSize: 11, color: '#ffffff', ...stShadow },
  pip: { position: 'absolute', width: 8, height: 8, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  pipObj: { position: 'absolute', width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  pipObjDiamond: { position: 'absolute', width: 11, height: 11, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  pipObjText: { fontFamily: FONT.display, fontSize: 8, color: ST.ink, includeFontPadding: false },
  caret: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff' },
  tapeDeg: { position: 'absolute', top: -1, width: 40, textAlign: 'center', fontFamily: FONT.displaySemi, fontSize: 10, color: 'rgba(242,244,247,0.85)', fontVariant: ['tabular-nums'], ...stShadow },
  // health
  health: { backgroundColor: HUD.panel, borderRadius: ST.radius, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 8, borderTopWidth: 2, borderTopColor: 'transparent' },
  healthHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  hpNum: { fontFamily: FONT.display, fontSize: 30, lineHeight: 32, color: '#ffffff', fontVariant: ['tabular-nums'], includeFontPadding: false },
  segRow: { flexDirection: 'row', gap: 2, marginTop: 5 },
  seg: { flex: 1, height: 6 },
  healthFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 6 },
  healthFootText: { fontFamily: FONT.ui, fontSize: 11, color: '#ffffff', fontVariant: ['tabular-nums'] },
  // score panel
  scorePanel: { backgroundColor: HUD.panel, borderRadius: ST.radius, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 7, gap: 3, borderLeftWidth: 2, borderLeftColor: ST.friendly },
  scoreHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreNum: { fontFamily: FONT.display, fontSize: 19, lineHeight: 22, minWidth: 26, fontVariant: ['tabular-nums'], includeFontPadding: false },
  scoreTrack: { flex: 1, height: 5, backgroundColor: 'rgba(255,255,255,0.14)' },
  scoreFill: { height: 5 },
  scoreRowLabel: { fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1.2, color: ST.muted, minWidth: 22, textAlign: 'right' },
  pipsRow: { flex: 1, flexDirection: 'row', gap: 3 },
  winPip: { flex: 1, height: 5 },
  scoreFoot: { fontFamily: FONT.uiSemi, fontSize: 9.5, letterSpacing: 1.2, color: 'rgba(242,244,247,0.6)' },
  clock: { fontFamily: FONT.display, fontSize: 26, letterSpacing: 1, color: '#ffffff', fontVariant: ['tabular-nums'], includeFontPadding: false, ...stShadow },
  liveDot: { width: 8, height: 8, backgroundColor: ST.enemy, transform: [{ rotate: '45deg' }] },
  // feed
  feed: { gap: 4, maxWidth: '62%' },
  feedLine: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: HUD.panel, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' },
  feedMine: { backgroundColor: 'rgba(57,213,255,0.22)', borderLeftWidth: 2, borderLeftColor: ST.friendly },
  feedGotMe: { backgroundColor: 'rgba(255,61,82,0.2)', borderLeftWidth: 2, borderLeftColor: ST.enemy },
  feedName: { fontFamily: FONT.ui, fontSize: 12, flexShrink: 1, maxWidth: 96 },
  feedText: { fontFamily: FONT.uiSemi, fontSize: 12, color: '#ffffff', flexShrink: 1 },
  // weapon
  weapon: { backgroundColor: HUD.panel, borderRadius: ST.radius, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 9 },
  weaponTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weaponImg: { width: 70, height: 26, tintColor: ST.text },
  weaponAmmo: { fontFamily: FONT.display, fontSize: 22, lineHeight: 26, color: '#ffffff', includeFontPadding: false },
  weaponBottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4, gap: 6 },
  weaponName: { flexShrink: 1, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.8, color: '#ffffff' },
  weaponModeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weaponMode: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4, color: ST.friendly },
  // plates
  plate: { position: 'absolute', left: 0, top: 0, width: PLATE_W, alignItems: 'center' },
  plateBox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: ST.panel, borderRadius: ST.radius, maxWidth: PLATE_W },
  plateDiamond: { width: 7, height: 7, transform: [{ rotate: '45deg' }] },
  plateName: { flexShrink: 1, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.6, color: '#ffffff' },
  plateDist: { fontFamily: FONT.displaySemi, fontSize: 11, color: 'rgba(242,244,247,0.75)', fontVariant: ['tabular-nums'] },
  plateHp: { width: 88, height: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  plateHpFill: { height: 4 },
  plateMark: { width: 9, height: 9, marginTop: 6, transform: [{ rotate: '45deg' }] },
  plateEdge: { position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: ST.panel, borderRadius: ST.radius, paddingHorizontal: 7, paddingVertical: 4, maxWidth: 180 },
  plateEdgeText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 0.4, color: '#ffffff', flexShrink: 1 },
  // pops
  popWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pop: { position: 'absolute', alignItems: 'flex-start' },
  popPts: { fontFamily: FONT.display, fontSize: 22, includeFontPadding: false, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  popLabel: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: '#ffffff', marginTop: -2, ...stShadow },
  // tiles
  hudBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9, borderRadius: ST.radius, backgroundColor: HUD.panel, borderWidth: 1, borderColor: HUD.border },
  hudBtnText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1, color: '#ffffff' },
  fire: { backgroundColor: 'rgba(8,10,14,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  fireRing: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  fireText: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 2.4, marginTop: 1, ...stShadow },
  fireSub: { fontFamily: FONT.ui, fontSize: 8.5, color: 'rgba(242,244,247,0.75)', letterSpacing: 1.6, marginTop: -1 },
})
