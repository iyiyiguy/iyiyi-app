// Shared look for the Arcade hub, Shop and game lobbies: the "studio" game language from
// ./studio.js (dark ground in light AND dark mode, black glass panels, caps labels,
// Chakra Petch numbers and titles, square 3 px corners, colour = role, no emoji in chrome).
// Exports keep their old names and props so every screen and game keeps working.
import React, { useCallback, useContext } from 'react'
import { Dimensions, Image, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { FONT, ST, stType, useStudioFonts, withAlpha } from './studio'

// Fixed palette (same keys as before, studio values): dark in both light and dark mode.
export const AC = {
  bg: [ST.ground, ST.ground, ST.ground2],
  text: ST.text,
  muted: ST.muted,
  faint: ST.faint,
  card: ST.cell,
  cardStrong: 'rgba(255,255,255,0.09)',
  border: ST.line,
  gold: ST.objective,
  accent: ST.friendly,
  hot: ST.enemy,
  live: ST.health,
  danger: ST.enemy,
  play: [ST.friendly, ST.friendly],
  // Card surfaces + glows shared by every arcade page (flat black glass now; glows are off).
  panel: [ST.panelStrong, ST.panelStrong],
  glowAccent: 'transparent',
  glowHot: 'transparent',
  glowGold: 'transparent',
}

// Text colour that reads on a given solid fill (dark ink on bright fills, white on dark/red).
export function inkOn(fill) {
  const h = String(fill || '').replace('#', '')
  if (h.length !== 6) return ST.ink
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? ST.ink : '#ffffff'
}

// Flat studio ground with a faint grid-like top sheen. Also loads the studio fonts.
export function ArcadeBackground() {
  useStudioFonts()
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: ST.ground }]} />
      <LinearGradient colors={['rgba(57,213,255,0.06)', 'rgba(57,213,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.4 }} style={StyleSheet.absoluteFill} />
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
      colors={[withAlpha(ST.ground, 0.96), withAlpha(ST.ground, 0.8), withAlpha(ST.ground, 0)]}
      locations={[0, 0.7, 1]}
      style={[s.scrim, { height: height + 14 }]}
    />
  )
}

export function CoinPill({ value, onPress, compact }) {
  const body = (
    <View style={[s.coin, compact && { height: 30 }]}>
      <View style={s.coinIcon}><Ionicons name="diamond" size={10} color={ST.ink} /></View>
      <Text style={s.coinText}>{value == null ? '—' : Number(value).toLocaleString()}</Text>
    </View>
  )
  if (!onPress) return body
  return <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${value} coins`} style={({ pressed }) => pressed && { opacity: 0.8 }}>{body}</Pressable>
}

export function IconCircle({ icon, onPress, label, size = 42, badge }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }}>
      <View style={[s.iconBtn, { width: size, height: size }]}>
        <Ionicons name={icon} size={size * 0.46} color={ST.text} />
      </View>
      {badge ? <View style={s.badge} /> : null}
    </Pressable>
  )
}

export function Chip({ label, active, onPress, icon }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      <View style={[s.chip, active ? s.chipOn : s.chipIdle]}>
        {icon ? <Ionicons name={icon} size={13} color={active ? ST.ink : ST.muted} style={{ marginRight: 6 }} /> : null}
        <Text style={[s.chipText, active && { color: ST.ink }]}>{label}</Text>
      </View>
    </Pressable>
  )
}

export function SectionHeader({ title, action, onAction, style }) {
  return (
    <View style={[s.section, style]}>
      <View style={s.sectionLeft}>
        <View style={s.sectionTick} />
        <Text style={s.sectionTitle} numberOfLines={1}>{title}</Text>
      </View>
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

// Cover art for a game: the cover image, or a flat panel with a game icon.
// The whole cover is always shown ('contain'): a blurred, dimmed copy of the same image fills
// whatever the box has left over, so nothing of the art (logos!) gets cropped.
// artStyle: optional box for the sharp image (e.g. { height, marginTop }) laid out in normal
// flow, so children rendered after it (titles, buttons) sit BELOW the art instead of on it.
// Without artStyle the sharp image fills the whole box and children overlay as before.
export function CoverArt({ game, style, glyphSize = 96, artStyle, fit = 'contain', children }) {
  const cover = game?.cover
  const sharpStyle = artStyle ? [s.artBox, artStyle] : StyleSheet.absoluteFill
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: ST.ground2, borderRadius: ST.radius }, style]}>
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
          <View style={[StyleSheet.absoluteFill, { backgroundColor: ST.ground2 }]} />
          <View style={[sharpStyle, s.centerBox]} pointerEvents="none">
            <Ionicons name={gameIcon(game?.id)} size={Math.round(glyphSize * 0.7)} color={ST.faint} />
          </View>
        </>
      )}
      {children}
    </View>
  )
}

// Ionicons for each game (multiplayer ids and catalogue ids) - used instead of emoji glyphs.
export const GAME_ICONS = {
  lasertag: 'locate', 'laser-tag': 'locate',
  royale: 'planet', 'battle-royale': 'planet',
  'spider-spider': 'bug', spider: 'bug',
  'beside-them': 'eye-off',
  chess: 'extension-puzzle',
  mafia: 'moon',
  'heads-up': 'hand-left', 'heads-up-7-up': 'hand-left',
  'word-race': 'text', 'word-game': 'text',
}
export const gameIcon = (id) => GAME_ICONS[id] || 'game-controller'

// Big call-to-action: flat role-colour fill, Chakra caps label. `colors` (an array, as
// before) picks the fill from its first stop.
export function PlayButton({ title = 'Play', icon = 'play', onPress, disabled, busy, style, colors = AC.play, small }) {
  const fill = (Array.isArray(colors) ? colors[0] : colors) || ST.friendly
  const fg = inkOn(fill)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      <View style={[s.play, small && s.playSmall, { backgroundColor: fill, borderColor: fill }]}>
        {icon ? <Ionicons name={busy ? 'hourglass' : icon} size={small ? 14 : 17} color={fg} style={{ marginRight: 8 }} /> : null}
        <Text style={[s.playText, small && { fontSize: 13 }, { color: fg }]} numberOfLines={1}>{busy ? 'Please wait…' : title}</Text>
      </View>
    </Pressable>
  )
}

// Secondary outline button for dark arcade surfaces.
export function GhostButton({ title, icon, onPress, disabled, style, small }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      <View style={[s.ghost, small && s.playSmall]}>
        {icon ? <Ionicons name={icon} size={small ? 14 : 17} color={ST.text} style={{ marginRight: 8 }} /> : null}
        <Text style={[s.ghostText, small && { fontSize: 13 }]} numberOfLines={1}>{title}</Text>
      </View>
    </Pressable>
  )
}

// Standard arcade page header: back button, title (+ optional kicker) and right-side items.
// Place it inside a View with paddingTop = useArcadeInsets().top + 10.
export function ArcadeHeader({ title, kicker, onBack, right, style }) {
  return (
    <View style={[s.header, style]}>
      {onBack ? <IconCircle icon="chevron-back" label="Back" onPress={onBack} size={40} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {kicker ? <Text style={s.headerKicker} numberOfLines={1}>{kicker}</Text> : null}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      {right ? <View style={s.headerRight}>{right}</View> : null}
    </View>
  )
}

// Glow colours from the old palette map to a role-colour top edge.
function edgeFor(glow) {
  if (!glow || glow === 'transparent') return null
  return glow
}

// Black glass card for arcade pages. glow (a colour) becomes a 2 px role-colour top edge.
export function ArcadeCard({ children, style, glow, colors, padded = true }) {
  const edge = edgeFor(glow)
  const bg = Array.isArray(colors) ? colors[0] : ST.panelStrong
  return (
    <View style={[s.card, { backgroundColor: bg }, edge && { borderTopWidth: 2, borderTopColor: edge }, padded && { padding: 16 }, style]}>
      {children}
    </View>
  )
}

// Drop-in for components/Glass on arcade pages (same props: scheme / radius / shadow /
// interactive are accepted and ignored): a flat black-glass studio panel. accent draws a
// 2 px role-colour top edge.
export function ArcadePanel({ children, style, accent, onLayout }) {
  return (
    <View style={[s.panelBox, accent && { borderTopWidth: 2, borderTopColor: accent }, style]} onLayout={onLayout}>
      {children}
    </View>
  )
}

// ---- Arcade drop-ins for the shared multiplayer kit (always dark, any system scheme) ----

// Same keys as theme `type`, with studio fonts and colours.
export const arcadeType = {
  display: { fontFamily: FONT.display, fontSize: 30, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  title: { fontFamily: FONT.display, fontSize: 19, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  body: { fontFamily: FONT.uiSemi, fontSize: 15, lineHeight: 20, color: ST.text },
  caption: { fontFamily: FONT.uiMedium, fontSize: 13, lineHeight: 17, color: ST.muted },
  label: { ...stType.label },
}

// Card replacement (MultiplayerUI Card props).
export function ArcadeBox({ children, style, padding = 14 }) {
  return (
    <View style={[s.box, { padding }, style]}>
      {children}
    </View>
  )
}

// Button replacement (MultiplayerUI Btn props).
export function ArcadeBtn({ title, onPress, disabled, variant = 'glass', size = 'md', style, busy }) {
  const small = size === 'sm'
  if (variant === 'primary' || variant === 'danger') {
    return <PlayButton title={title} icon={null} onPress={onPress} disabled={disabled} busy={busy} small={small} style={style} colors={variant === 'danger' ? [ST.enemy, ST.enemy] : AC.play} />
  }
  return <GhostButton title={busy ? 'Please wait…' : title} onPress={onPress} disabled={disabled || busy} small={small} style={style} />
}

export function StatTile({ label, value, accent }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={[s.statValue, accent && { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}

export const arcadeText = {
  display: { fontFamily: FONT.display, fontSize: 32, letterSpacing: 1.2, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  title: { fontFamily: FONT.display, fontSize: 19, letterSpacing: 0.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  body: { fontFamily: FONT.uiSemi, fontSize: 15, lineHeight: 20, color: ST.text },
  caption: { fontFamily: FONT.uiMedium, fontSize: 13, lineHeight: 17, color: ST.muted },
  label: { ...stType.label },
}

const s = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  fill: { width: '100%', height: '100%' },
  artBox: { width: '100%' },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  coverDim: { backgroundColor: 'rgba(11,13,17,0.55)' },
  iconBtn: { borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  badge: { position: 'absolute', top: 3, right: 3, width: 8, height: 8, backgroundColor: ST.enemy },
  coin: { flexDirection: 'row', alignItems: 'center', height: 34, paddingLeft: 6, paddingRight: 10, gap: 6, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line },
  coinIcon: { width: 18, height: 18, borderRadius: 2, backgroundColor: ST.objective, alignItems: 'center', justifyContent: 'center' },
  coinText: { fontFamily: FONT.display, fontSize: 15, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 34, borderRadius: ST.radius, borderWidth: 1 },
  chipOn: { backgroundColor: ST.friendly, borderColor: ST.friendly },
  chipIdle: { backgroundColor: ST.cell, borderColor: ST.line },
  chipText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.muted },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12, gap: 12 },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  sectionTick: { width: 3, height: 14, backgroundColor: ST.friendly },
  sectionTitle: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 1.6, color: ST.text, textTransform: 'uppercase', includeFontPadding: false, flexShrink: 1 },
  sectionAction: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.friendly },
  live: { flexDirection: 'row', alignItems: 'center', backgroundColor: ST.panelStrong, paddingHorizontal: 8, height: 24, borderRadius: ST.radius, borderWidth: 1, borderColor: withAlpha(ST.health, 0.5) },
  liveDot: { width: 6, height: 6, backgroundColor: ST.health, marginRight: 6 },
  liveText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: ST.health },
  play: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, paddingHorizontal: 20, borderRadius: ST.radius, borderWidth: 1 },
  playSmall: { height: 42, paddingHorizontal: 14 },
  playText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', color: ST.ink, includeFontPadding: false },
  ghost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 52, paddingHorizontal: 20, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, backgroundColor: 'rgba(8,10,14,0.4)' },
  ghostText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase', color: ST.text, includeFontPadding: false },
  panelBox: { borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, overflow: 'hidden' },
  box: { borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  headerKicker: { ...stType.kicker },
  headerTitle: { fontFamily: FONT.display, fontSize: 22, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { borderRadius: ST.radius, borderWidth: 1, borderColor: ST.line, overflow: 'hidden' },
  stat: { flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: ST.radius, backgroundColor: ST.cell, gap: 2 },
  statValue: { fontFamily: FONT.display, fontSize: 20, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  statLabel: { ...stType.label, color: ST.faint },
})
