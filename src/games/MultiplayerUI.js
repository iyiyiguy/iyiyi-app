// Small shared building blocks for the multiplayer arcade screens, in the studio look
// (./studio.js): always dark, black glass, square corners, caps labels, role colours.
import React, { createContext, useContext } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GameFollowButton from '../components/GameFollowButton'
import { useMyUserId } from '../lib/profileNav'
import { FONT, ST, stType, withAlpha } from './studio'

// Kept for callers that still pass a tint; game surfaces are dark whatever the system theme.
export function useTint() {
  return useColorScheme() === 'light' ? 'light' : 'dark'
}

export function Btn({ title, onPress, disabled, variant = 'glass', size = 'md', style, busy }) {
  const small = size === 'sm'
  const filled = variant === 'primary' || variant === 'danger'
  const fill = variant === 'danger' ? ST.enemy : ST.friendly
  const fg = variant === 'danger' ? '#ffffff' : filled ? ST.ink : ST.text
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={typeof title === 'string' ? title : undefined}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSm,
        filled ? { backgroundColor: fill, borderColor: fill } : s.btnGhost,
        { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && s.smText, { color: fg }]} numberOfLines={1}>{title}</Text>}
    </Pressable>
  )
}

export function Card({ children, style, padding = 14 }) {
  return (
    <View style={[s.card, { padding }, style]}>
      {children}
    </View>
  )
}

// Square avatar (3 px corners). teamColor (optional) draws the team-colour bar underneath.
export function Avatar({ uri, name, size = 36, teamColor }) {
  const bar = teamColor ? { borderBottomWidth: Math.max(2, Math.round(size / 20)), borderBottomColor: teamColor } : null
  if (uri) return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: ST.radius, backgroundColor: '#2a3038' }, bar]} />
  return (
    <View style={[s.avatarFallback, { width: size, height: size }, bar]}>
      <Text style={{ fontFamily: FONT.display, color: ST.text, fontSize: size * 0.42, includeFontPadding: false }} allowFontScaling={false}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

// Screens that host players (lobby, game) provide a handler here; any PlayerRow /
// PlayerTap whose player has an `id` then becomes tappable and calls it with
// { id, username, avatar } (lobby opens the profile, in-game shows a preview sheet).
export const PlayerTapContext = createContext(null)

export function PlayerTap({ player, children, style }) {
  const onTap = useContext(PlayerTapContext)
  if (!onTap || !player?.id) return <View style={style}>{children}</View>
  return (
    <Pressable
      onPress={() => onTap(player)}
      style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`View ${player.username || 'player'}’s profile`}
      hitSlop={4}
    >
      {children}
    </Pressable>
  )
}

// Every player row in every game gets a compact Follow button (teammates and opponents
// alike) when the screen hosts players (PlayerTapContext) and the row isn't you.
// Pass follow={false} to hide it.
export function PlayerRow({ player, right, subtitle, dim, follow = true }) {
  const onTap = useContext(PlayerTapContext)
  const myId = useMyUserId()
  const showFollow = follow && !!onTap && !!player?.id && !!myId && player.id !== myId
  return (
    <View style={[s.row, dim && { opacity: 0.5 }]}>
      <PlayerTap player={player} style={s.rowTap}>
        <Avatar uri={player.avatar} name={player.username} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.rowName} numberOfLines={1}>{player.username}</Text>
          {!!subtitle && <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </PlayerTap>
      {right}
      {showFollow ? <GameFollowButton userId={player.id} name={player.username} size="sm" style={{ marginLeft: 8 }} /> : null}
    </View>
  )
}

// Connection status banner; renders nothing when connected.
export function ConnectionBanner({ status, error }) {
  if (status === 'connected' || status === 'closed') return null
  const isErr = status === 'error'
  const text = isErr
    ? (error || 'Connection failed.')
    : status === 'reconnecting'
      ? 'Connection lost — reconnecting…'
      : 'Connecting…'
  const tone = isErr ? ST.enemy : ST.objective
  return (
    <View style={[s.banner, { borderLeftColor: tone }]} accessibilityLiveRegion="polite">
      {isErr
        ? <Ionicons name="alert-circle" size={16} color={tone} style={{ marginRight: 8 }} />
        : <ActivityIndicator color={tone} size="small" style={{ marginRight: 8 }} />}
      <Text style={s.bannerText}>{text}</Text>
    </View>
  )
}

// Small caps tag. color is the role colour (fill); text picks ink or white to stay legible.
export function Pill({ text, color = ST.friendly }) {
  return (
    <View style={[s.pill, { backgroundColor: color }]}>
      <Text style={[s.pillText, { color: pillInk(color) }]} numberOfLines={1}>{text}</Text>
    </View>
  )
}

function pillInk(c) {
  const h = String(c || '').replace('#', '')
  if (h.length !== 6) return '#ffffff'
  const n = parseInt(h, 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.55 ? ST.ink : '#ffffff'
}

// Shown while a location-based game can't get the player's position.
export function LocationGate({ status, onExit, what = 'This game' }) {
  if (status === 'granted') return null
  if (status === 'pending') {
    return (
      <View style={s.gate}>
        <ActivityIndicator color={ST.friendly} />
        <Text style={[stType.label, { marginTop: 12 }]}>Getting your location…</Text>
      </View>
    )
  }
  return (
    <View style={s.gate}>
      <View style={s.gatePanel}>
        <View style={s.gateIcon}><Ionicons name="location" size={22} color={ST.objective} /></View>
        <Text style={[stType.kicker, { color: ST.objective, textAlign: 'center' }]}>GPS required</Text>
        <Text style={[stType.title, { textAlign: 'center', marginTop: 2 }]}>Location needed</Text>
        <Text style={[stType.body, { textAlign: 'center', marginVertical: 12 }]}>
          {what} is played in the real world, so it needs your location to know how close other players are. Your exact location is only shared with players in this match while you play.
        </Text>
        {status === 'denied' && <Btn title="Open Settings" variant="primary" onPress={() => Linking.openSettings().catch(() => {})} />}
        {status === 'error' && <Text style={[stType.small, { textAlign: 'center' }]}>Couldn’t read your location. Make sure Location Services are on.</Text>}
        <Btn title="Leave game" onPress={onExit} style={{ marginTop: 10 }} />
      </View>
    </View>
  )
}

// Late joiners watch until the next round.
export function Spectating({ text = 'A round is in progress. You’ll be in the next one.' }) {
  return (
    <View style={s.gate}>
      <View style={s.gatePanel}>
        <View style={s.gateIcon}><Ionicons name="eye" size={22} color={ST.friendly} /></View>
        <Text style={[stType.kicker, { textAlign: 'center' }]}>Spectating</Text>
        <Text style={[stType.title, { textAlign: 'center', marginTop: 2 }]}>Round in progress</Text>
        <Text style={[stType.body, { textAlign: 'center', marginTop: 10 }]}>{text}</Text>
      </View>
    </View>
  )
}

// Segmented progress ring (no SVG dependency): `segments` ticks around a
// circle, filled clockwise from the top as progress goes 0 → 1.
export function ProgressRing({ size = 80, progress = 0, color = ST.friendly, trackColor = 'rgba(255,255,255,0.14)', segments = 36, thickness = 6, children }) {
  const p = Math.max(0, Math.min(1, progress))
  const filled = Math.round(p * segments)
  const r = size / 2 - thickness / 2
  const segLen = Math.max(3, ((2 * Math.PI * r) / segments) * 0.62)
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}>
      {Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * 2 * Math.PI
        const cx = size / 2 + r * Math.sin(a)
        const cy = size / 2 - r * Math.cos(a)
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: cx - thickness / 2,
              top: cy - segLen / 2,
              width: thickness,
              height: segLen,
              borderRadius: 1,
              backgroundColor: i < filled ? color : trackColor,
              transform: [{ rotate: `${(i / segments) * 360}deg` }],
            }}
          />
        )
      })}
      {children}
    </View>
  )
}

export function formatClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(t / 60)
  const sec = t % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

const s = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: ST.ground },
  gatePanel: { width: '100%', maxWidth: 420, padding: 18, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  gateIcon: { alignSelf: 'center', width: 44, height: 44, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.cell, marginBottom: 10 },
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: ST.radius, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnSm: { minHeight: 32, paddingHorizontal: 12 },
  btnGhost: { backgroundColor: 'rgba(8,10,14,0.4)', borderColor: ST.lineStrong },
  btnText: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 1.8, textTransform: 'uppercase', includeFontPadding: false },
  smText: { fontSize: 11, letterSpacing: 1.2 },
  card: { borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, marginBottom: 12 },
  avatarFallback: { borderRadius: ST.radius, backgroundColor: '#3c434c', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rowName: { fontFamily: FONT.display, fontSize: 15, color: ST.text, includeFontPadding: false },
  rowSub: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.muted, marginTop: 2 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: ST.radius, marginBottom: 10, backgroundColor: ST.panelStrong, borderLeftWidth: 3 },
  bannerText: { fontFamily: FONT.uiSemi, fontSize: 13, color: ST.text, flex: 1 },
  pill: { paddingHorizontal: 6, height: 18, justifyContent: 'center', borderRadius: 2, marginLeft: 6, backgroundColor: withAlpha(ST.friendly, 1) },
  pillText: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
})
