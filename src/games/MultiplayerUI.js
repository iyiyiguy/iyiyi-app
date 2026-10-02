// Small shared building blocks for the multiplayer arcade screens.
import React, { createContext, useContext } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { GlassButton } from '../components/GlassButton'
import { GlassCard } from '../components/GlassCard'
import { colors, radii, type } from '../theme'

export function useTint() {
  return useColorScheme() === 'light' ? 'light' : 'dark'
}

export function Btn({ title, onPress, disabled, variant = 'glass', size = 'md', style, busy }) {
  const tint = useTint()
  if (variant === 'primary' || variant === 'danger') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        accessibilityRole="button"
        style={({ pressed }) => [
          s.primary,
          size === 'sm' && s.primarySm,
          { backgroundColor: variant === 'danger' ? colors.danger : colors.magenta, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
          style,
        ]}
      >
        {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={[s.primaryText, size === 'sm' && s.smText]}>{title}</Text>}
      </Pressable>
    )
  }
  return (
    <GlassButton onPress={onPress} disabled={disabled || busy} tint={tint} size={size} style={style}>
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={[s.glassText, size === 'sm' && s.smText]}>{title}</Text>}
    </GlassButton>
  )
}

export function Card({ children, style, padding = 14 }) {
  const tint = useTint()
  return (
    <GlassCard tint={tint} intensity={70} radius={radii.md} padding={padding} style={[{ marginBottom: 12 }, style]}>
      {children}
    </GlassCard>
  )
}

export function Avatar({ uri, name, size = 36 }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  return (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[type.body, { color: colors.onBrand, fontSize: size * 0.42 }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
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

export function PlayerRow({ player, right, subtitle, dim }) {
  return (
    <View style={[s.row, dim && { opacity: 0.5 }]}>
      <PlayerTap player={player} style={s.rowTap}>
        <Avatar uri={player.avatar} name={player.username} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={type.body} numberOfLines={1}>{player.username}</Text>
          {!!subtitle && <Text style={type.caption} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </PlayerTap>
      {right}
    </View>
  )
}

// Connection status banner; renders nothing when connected.
export function ConnectionBanner({ status, error }) {
  if (status === 'connected' || status === 'closed') return null
  const text = status === 'error'
    ? (error || 'Connection failed.')
    : status === 'reconnecting'
      ? 'Connection lost — reconnecting…'
      : 'Connecting…'
  return (
    <View style={[s.banner, { backgroundColor: status === 'error' ? colors.danger : colors.violet }]}>
      {status !== 'error' && <ActivityIndicator color={colors.onBrand} size="small" style={{ marginRight: 8 }} />}
      <Text style={s.bannerText}>{text}</Text>
    </View>
  )
}

export function Pill({ text, color = colors.violet }) {
  return (
    <View style={[s.pill, { backgroundColor: color }]}>
      <Text style={s.pillText}>{text}</Text>
    </View>
  )
}

// Shown while a location-based game can't get the player's position.
export function LocationGate({ status, onExit, what = 'This game' }) {
  if (status === 'granted') return null
  if (status === 'pending') {
    return (
      <View style={s.gate}>
        <ActivityIndicator color={colors.textMuted} />
        <Text style={[type.caption, { marginTop: 10 }]}>Getting your location…</Text>
      </View>
    )
  }
  return (
    <View style={s.gate}>
      <Text style={[type.title, { textAlign: 'center' }]}>Location needed</Text>
      <Text style={[type.body, { textAlign: 'center', marginVertical: 12 }]}>
        {what} is played in the real world, so it needs your location to know how close other players are. Your exact location is only shared with players in this match while you play.
      </Text>
      {status === 'denied' && <Btn title="Open Settings" variant="primary" onPress={() => Linking.openSettings().catch(() => {})} />}
      {status === 'error' && <Text style={[type.caption, { textAlign: 'center' }]}>Couldn’t read your location. Make sure Location Services are on.</Text>}
      <Btn title="Leave game" onPress={onExit} style={{ marginTop: 12 }} />
    </View>
  )
}

// Late joiners watch until the next round.
export function Spectating({ text = 'A round is in progress. You’ll be in the next one.' }) {
  return (
    <View style={s.gate}>
      <Text style={[type.title, { textAlign: 'center' }]}>Round in progress</Text>
      <Text style={[type.body, { textAlign: 'center', marginTop: 10 }]}>{text}</Text>
    </View>
  )
}

// Segmented progress ring (no SVG dependency): `segments` ticks around a
// circle, filled clockwise from the top as progress goes 0 → 1.
export function ProgressRing({ size = 80, progress = 0, color = colors.magenta, trackColor = colors.hairline, segments = 36, thickness = 6, children }) {
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
              borderRadius: thickness / 2,
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
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  primary: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  primarySm: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.sm },
  primaryText: { ...type.body, fontWeight: '700', color: colors.onBrand },
  glassText: { ...type.body, fontWeight: '700' },
  smText: { fontSize: 13 },
  avatarFallback: { backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.sm, marginBottom: 10 },
  bannerText: { ...type.caption, color: colors.onBrand, flex: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, marginLeft: 6 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.onBrand },
})
