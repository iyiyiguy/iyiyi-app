// Shared look for the Arcade hub, Shop and game lobbies: a deep, always-dark game-hub
// style layered over the app's aura, built from the same Liquid Glass primitive.
import React, { useCallback, useContext } from 'react'
import { Dimensions, Image, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import Glass from '../components/Glass'
import { font } from '../theme'

// Fixed palette: the arcade is dark in both light and dark mode, like a game launcher.
export const AC = {
  bg: ['#04050d', '#0a0e24', '#140a28'],
  text: '#f4f6ff',
  muted: '#a3abc8',
  faint: '#6c7392',
  card: 'rgba(255,255,255,0.06)',
  cardStrong: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.10)',
  gold: '#ffc94d',
  accent: '#7c8cff',
  hot: '#ff2e63',
  live: '#2fdc8f',
  danger: '#ff5d6c',
  play: ['#8f7bff', '#5b6cf0'],
  // Card surfaces + glows shared by every arcade page.
  panel: ['rgba(30,36,72,0.85)', 'rgba(14,16,34,0.92)'],
  glowAccent: 'rgba(124,140,255,0.45)',
  glowHot: 'rgba(255,46,99,0.45)',
  glowGold: 'rgba(255,201,77,0.45)',
}

// Deep gradient + two soft glows behind arcade screens.
export function ArcadeBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={AC.bg} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[s.orb, { top: -120, right: -90, backgroundColor: 'rgba(124,140,255,0.22)' }]} />
      <View style={[s.orb, { top: 360, left: -140, backgroundColor: 'rgba(255,46,99,0.12)' }]} />
    </View>
  )
}

// Light status bar text while an arcade screen is focused.
export function useArcadeStatusBar() {
  useFocusEffect(useCallback(() => {
    let entry = null
    try { entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true }) } catch { /* web */ }
    return () => { try { if (entry) StatusBar.popStackEntry(entry) } catch { /* ignore */ } }
  }, []))
}

// Safe-area insets for arcade screens with their own header. Never throws (no provider ->
// launch insets) and never reports 0 on a notched / Dynamic Island iPhone, where a header
// at y=0 would sit under the clock and battery.
export function useArcadeInsets() {
  const ctx = useContext(SafeAreaInsetsContext)
  const init = initialWindowMetrics?.insets
  let top = Math.max(ctx?.top ?? 0, init?.top ?? 0)
  const bottom = Math.max(ctx?.bottom ?? 0, init?.bottom ?? 0)
  if (Platform.OS === 'ios' && top < 20) {
    let h = 0
    try { const d = Dimensions.get('window'); h = Math.max(d.width, d.height) } catch { /* ignore */ }
    top = h >= 812 ? 54 : 20 // Face ID phones vs. home-button phones
  } else if (Platform.OS === 'android' && !top) {
    top = StatusBar.currentHeight || 24
  }
  return { top, bottom, left: ctx?.left ?? 0, right: ctx?.right ?? 0 }
}

// A dark strip under the status bar so content scrolling up never collides with the clock.
export function StatusBarScrim({ height }) {
  if (!height) return null
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(4,5,13,0.94)', 'rgba(4,5,13,0.75)', 'rgba(4,5,13,0)']}
      locations={[0, 0.7, 1]}
      style={[s.scrim, { height: height + 14 }]}
    />
  )
}

export function CoinPill({ value, onPress, compact }) {
  const body = (
    <Glass scheme="dark" radius={18} shadow={false} style={[s.coin, compact && { paddingVertical: 6 }]}>
      <View style={s.coinIcon}><Text style={s.coinGlyph}>◆</Text></View>
      <Text style={s.coinText}>{value == null ? '—' : Number(value).toLocaleString()}</Text>
    </Glass>
  )
  if (!onPress) return body
  return <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${value} coins`}>{body}</Pressable>
}

export function IconCircle({ icon, onPress, label, size = 42, badge }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => pressed && { transform: [{ scale: 0.92 }] }}>
      <Glass scheme="dark" radius={size / 2} shadow={false} interactive style={{ width: size, height: size }}>
        <View style={s.center}><Ionicons name={icon} size={size * 0.46} color={AC.text} /></View>
      </Glass>
      {badge ? <View style={s.badge} /> : null}
    </Pressable>
  )
}

export function Chip({ label, active, onPress, icon }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {active ? (
        <LinearGradient colors={AC.play} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.chip}>
          {icon ? <Ionicons name={icon} size={14} color="#fff" style={{ marginRight: 6 }} /> : null}
          <Text style={[s.chipText, { color: '#fff' }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[s.chip, s.chipIdle]}>
          {icon ? <Ionicons name={icon} size={14} color={AC.muted} style={{ marginRight: 6 }} /> : null}
          <Text style={s.chipText}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

export function SectionHeader({ title, action, onAction, style }) {
  return (
    <View style={[s.section, style]}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={s.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function LiveBadge({ count, label = 'playing' }) {
  if (!count) return null
  return (
    <View style={s.live}>
      <View style={s.liveDot} />
      <Text style={s.liveText}>{count} {label}</Text>
    </View>
  )
}

// Cover art for a game: the cover image, or a gradient with the game's glyph.
// The whole cover is always shown ('contain'): a blurred, dimmed copy of the same image fills
// whatever the box has left over, so nothing of the art (logos!) gets cropped.
// artStyle: optional box for the sharp image (e.g. { height, marginTop }) laid out in normal
// flow, so children rendered after it (titles, buttons) sit BELOW the art instead of on it.
// Without artStyle the sharp image fills the whole box and children overlay as before.
export function CoverArt({ game, style, glyphSize = 96, artStyle, fit = 'contain', children }) {
  const cover = game?.cover
  const sharpStyle = artStyle ? [s.artBox, artStyle] : StyleSheet.absoluteFill
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#0d1022' }, style]}>
      {cover ? (
        <>
          {fit === 'contain' ? (
            <>
              <Image source={cover} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} fadeDuration={0} />
              <View style={[StyleSheet.absoluteFill, s.coverDim]} />
            </>
          ) : null}
          <View style={sharpStyle} pointerEvents="none">
            <Image source={cover} style={s.fill} resizeMode={fit === 'contain' ? 'contain' : 'cover'} fadeDuration={0} />
          </View>
        </>
      ) : (
        <>
          <LinearGradient colors={game?.accent || AC.play} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[sharpStyle, s.centerBox]} pointerEvents="none">
            <Text style={{ fontSize: glyphSize, color: 'rgba(255,255,255,0.92)' }} allowFontScaling={false}>{game?.id === 'chess' ? '♞' : game?.icon}</Text>
          </View>
        </>
      )}
      {children}
    </View>
  )
}

// Big gradient call-to-action.
export function PlayButton({ title = 'Play', icon = 'play', onPress, disabled, busy, style, colors = AC.play, small }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.play, small && s.playSmall]}>
        {icon ? <Ionicons name={busy ? 'hourglass' : icon} size={small ? 15 : 18} color="#fff" style={{ marginRight: 8 }} /> : null}
        <Text style={[s.playText, small && { fontSize: 14 }]}>{busy ? 'Please wait…' : title}</Text>
      </LinearGradient>
    </Pressable>
  )
}

// Secondary glass button for dark arcade surfaces.
export function GhostButton({ title, icon, onPress, disabled, style, small }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [{ opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      <Glass scheme="dark" radius={small ? 16 : 20} shadow={false} interactive>
        <View style={[s.ghost, small && s.playSmall]}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={AC.text} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.ghostText, small && { fontSize: 14 }]}>{title}</Text>
        </View>
      </Glass>
    </Pressable>
  )
}

// Standard arcade page header: back button, title (+ optional kicker) and right-side items.
// Place it inside a View with paddingTop = useArcadeInsets().top + 10.
export function ArcadeHeader({ title, kicker, onBack, right, style }) {
  return (
    <View style={[s.header, style]}>
      {onBack ? <IconCircle icon="chevron-back" label="Back" onPress={onBack} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {kicker ? <Text style={s.headerKicker} numberOfLines={1}>{kicker}</Text> : null}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      {right ? <View style={s.headerRight}>{right}</View> : null}
    </View>
  )
}

// Glowing gradient card for arcade pages.
export function ArcadeCard({ children, style, glow = AC.glowAccent, colors = AC.panel, padded = true }) {
  return (
    <View style={[s.cardOuter, { shadowColor: glow }, style]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={[s.card, padded && { padding: 16 }]}>
        {children}
      </LinearGradient>
    </View>
  )
}

// ---- Arcade drop-ins for the shared multiplayer kit (always dark, any system scheme) ----

// Same keys as theme `type`, with arcade colors.
export const arcadeType = {
  display: { fontSize: 30, ...font.heavy, letterSpacing: -0.6, color: AC.text },
  title: { fontSize: 20, ...font.bold, letterSpacing: -0.3, color: AC.text },
  body: { fontSize: 15, ...font.regular, color: AC.text },
  caption: { fontSize: 13, ...font.regular, color: AC.muted },
  label: { fontSize: 11, ...font.bold, color: AC.muted, letterSpacing: 1.2, textTransform: 'uppercase' },
}

// Card replacement (MultiplayerUI Card props).
export function ArcadeBox({ children, style, padding = 14 }) {
  return (
    <LinearGradient colors={AC.panel} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={[s.box, { padding }, style]}>
      {children}
    </LinearGradient>
  )
}

// Button replacement (MultiplayerUI Btn props).
export function ArcadeBtn({ title, onPress, disabled, variant = 'glass', size = 'md', style, busy }) {
  const small = size === 'sm'
  if (variant === 'primary' || variant === 'danger') {
    return <PlayButton title={title} icon={null} onPress={onPress} disabled={disabled} busy={busy} small={small} style={style} colors={variant === 'danger' ? ['#ff5d6c', '#c81e3a'] : AC.play} />
  }
  return <GhostButton title={busy ? 'Please wait…' : title} onPress={onPress} disabled={disabled || busy} small={small} style={style} />
}

export function StatTile({ label, value, accent }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, accent && { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

export const arcadeText = {
  display: { fontSize: 32, ...font.heavy, letterSpacing: -0.8, color: AC.text },
  title: { fontSize: 20, ...font.bold, letterSpacing: -0.3, color: AC.text },
  body: { fontSize: 15, ...font.regular, color: AC.text },
  caption: { fontSize: 13, ...font.regular, color: AC.muted },
  label: { fontSize: 11, ...font.bold, color: AC.muted, letterSpacing: 1.2, textTransform: 'uppercase' },
}

const s = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  fill: { width: '100%', height: '100%' },
  artBox: { width: '100%' },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  coverDim: { backgroundColor: 'rgba(4,5,13,0.45)' },
  orb: { position: 'absolute', width: 360, height: 360, borderRadius: 180, opacity: 0.9 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: AC.hot },
  coin: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 12, paddingVertical: 7, gap: 6 },
  coinIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: AC.gold, alignItems: 'center', justifyContent: 'center' },
  coinGlyph: { fontSize: 11, color: '#3a2600', ...font.heavy },
  coinText: { fontSize: 15, ...font.heavy, color: AC.text },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  chipIdle: { backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  chipText: { fontSize: 14, ...font.semibold, color: AC.muted },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitle: { fontSize: 20, ...font.bold, color: AC.text, letterSpacing: -0.3 },
  sectionAction: { fontSize: 14, ...font.semibold, color: AC.accent },
  live: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AC.live, marginRight: 6 },
  liveText: { fontSize: 12, ...font.bold, color: '#fff' },
  play: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 22, borderRadius: 20 },
  playSmall: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16 },
  playText: { fontSize: 16, ...font.heavy, color: '#fff', letterSpacing: 0.2 },
  ghost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 22 },
  ghostText: { fontSize: 16, ...font.bold, color: AC.text },
  box: { borderRadius: 20, borderWidth: 1, borderColor: AC.border, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  headerKicker: { fontSize: 11, ...font.heavy, color: AC.accent, letterSpacing: 1.6, textTransform: 'uppercase' },
  headerTitle: { fontSize: 24, ...font.heavy, color: AC.text, letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardOuter: { borderRadius: 24, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  card: { borderRadius: 24, borderWidth: 1, borderColor: AC.border, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  statValue: { fontSize: 20, ...font.heavy, color: AC.text },
  statLabel: { fontSize: 10, ...font.bold, color: AC.faint, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
})
