// iYiYi "studio" game look: one HUD language for every game (Laser Tag, Battle Royale,
// Spider, Chess, What's the Word, Beside Them, Mafia, Heads Up 7 Up). Matches the Claude
// Design canvas "iYiYi Games — Studio HUD".
//
// Rules: colour means role (friendly / enemy / objective / health), never decoration.
// Black glass panels with square-ish corners, condensed caps labels, Chakra Petch for
// numbers, names and banners. No emoji in HUD chrome, no rounded pills, no gradient text.
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useFonts } from 'expo-font'
import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch'
import {
  BarlowSemiCondensed_500Medium, BarlowSemiCondensed_600SemiBold, BarlowSemiCondensed_700Bold,
} from '@expo-google-fonts/barlow-semi-condensed'

export const ST = {
  friendly: '#39d5ff',
  enemy: '#ff3d52',
  objective: '#ffb21e',
  health: '#5cf2a0',
  armor: '#7fb4ff',
  epic: '#b06cff',
  night: '#b9a6ff', // Mafia night phase
  text: '#f2f4f7',
  muted: 'rgba(242,244,247,0.62)',
  faint: 'rgba(242,244,247,0.38)',
  ground: '#0b0d11',
  ground2: '#101318',
  panel: 'rgba(8,10,14,0.72)',
  panelSoft: 'rgba(8,10,14,0.55)',
  panelStrong: 'rgba(8,10,14,0.88)',
  line: 'rgba(255,255,255,0.14)',
  lineStrong: 'rgba(255,255,255,0.24)',
  cell: 'rgba(255,255,255,0.05)',
  ink: '#07090c', // text on bright fills
  radius: 3,
}

// Font families (registered by useStudioFonts). Until they load, RN falls back to the system
// font, so text never disappears.
export const FONT = {
  display: 'ChakraPetch_700Bold',
  displaySemi: 'ChakraPetch_600SemiBold',
  ui: 'BarlowSemiCondensed_700Bold',
  uiSemi: 'BarlowSemiCondensed_600SemiBold',
  uiMedium: 'BarlowSemiCondensed_500Medium',
}

/** Load the studio fonts once (call in any game root; cheap after the first load). */
export function useStudioFonts() {
  const [loaded] = useFonts({
    ChakraPetch_600SemiBold, ChakraPetch_700Bold,
    BarlowSemiCondensed_500Medium, BarlowSemiCondensed_600SemiBold, BarlowSemiCondensed_700Bold,
  })
  return loaded
}

export const stType = {
  // small caps label: "TEAM DEATHMATCH · 4:32"
  label: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.8, color: ST.muted, textTransform: 'uppercase' },
  kicker: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 2.4, color: ST.friendly, textTransform: 'uppercase' },
  // big numbers, names, banners
  display: { fontFamily: FONT.display, fontSize: 54, lineHeight: 58, letterSpacing: 4, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  title: { fontFamily: FONT.display, fontSize: 22, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  name: { fontFamily: FONT.display, fontSize: 16, color: ST.text, includeFontPadding: false },
  num: { fontFamily: FONT.display, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  clock: { fontFamily: FONT.display, fontSize: 26, letterSpacing: 1, color: ST.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  // sentences and tips
  body: { fontFamily: FONT.uiSemi, fontSize: 14, lineHeight: 19, color: 'rgba(242,244,247,0.85)' },
  small: { fontFamily: FONT.uiSemi, fontSize: 12, lineHeight: 16, color: ST.muted },
  button: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase' },
}

export const stShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }
export const stGlow = (color, px = 12) => ({ boxShadow: `0 0 ${px}px ${color}` })

export function withAlpha(hex, a) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Black glass panel. accent draws a 2-3 px role-colour edge (side: 'top' | 'left'). */
export function StPanel({ children, style, accent, side = 'top', strong = false, soft = false }) {
  const edge = accent ? (side === 'left' ? { borderLeftWidth: 3, borderLeftColor: accent } : { borderTopWidth: 2, borderTopColor: accent }) : null
  return (
    <View style={[s.panel, { backgroundColor: strong ? ST.panelStrong : soft ? ST.panelSoft : ST.panel }, edge, style]}>
      {children}
    </View>
  )
}

/** Caps label + big value stat tile. */
export function StStat({ label, value, color, style, size = 22 }) {
  return (
    <View style={[s.stat, style]}>
      <Text style={stType.label} numberOfLines={1}>{label}</Text>
      <Text style={[stType.num, { fontSize: size, color: color || ST.text }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

/**
 * Studio button. tone: 'primary' (friendly fill) | 'white' | 'danger' | 'objective' | 'ghost' | 'outline'.
 * color overrides the fill for primary/outline.
 */
export function StButton({ title, onPress, tone = 'primary', color, disabled, style, textStyle, height = 50, left, accessibilityLabel }) {
  const fill = tone === 'primary' ? (color || ST.friendly) : tone === 'white' ? '#ffffff' : tone === 'danger' ? ST.enemy : tone === 'objective' ? ST.objective : 'transparent'
  const border = tone === 'ghost' ? ST.lineStrong : tone === 'outline' ? (color || ST.friendly) : fill
  const fg = tone === 'ghost' ? '#ffffff' : tone === 'outline' ? (color || ST.friendly) : tone === 'danger' ? '#ffffff' : ST.ink
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.btn, { height, backgroundColor: fill, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {left}
      <Text style={[stType.button, { color: fg, fontSize: height < 44 ? 13 : 15 }, textStyle]} numberOfLines={1}>{title}</Text>
    </Pressable>
  )
}

/** Thin progress bar (timer, tasks, HP). */
export function StBar({ value = 0, color = ST.friendly, height = 6, track = 'rgba(255,255,255,0.14)', style }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <View style={[{ height, backgroundColor: track, overflow: 'hidden' }, style]}>
      <View style={{ width: `${pct}%`, height, backgroundColor: color }} />
    </View>
  )
}

/** "LABEL · VALUE" header block used at the top of game screens. */
export function StHeader({ kicker, title, sub, color = ST.friendly, align = 'center', style }) {
  return (
    <View style={[{ alignItems: align === 'center' ? 'center' : 'flex-start', gap: 2 }, style]}>
      {kicker ? <Text style={[stType.kicker, { color, textAlign: align }]} numberOfLines={1}>{kicker}</Text> : null}
      {title ? <Text style={[stType.title, { textAlign: align }]} numberOfLines={2}>{title}</Text> : null}
      {sub ? <Text style={[stType.small, { textAlign: align, color: 'rgba(242,244,247,0.75)' }]} numberOfLines={2}>{sub}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  panel: { borderRadius: ST.radius, padding: 12 },
  stat: { flex: 1, padding: 10, backgroundColor: ST.cell, borderRadius: ST.radius, gap: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, borderRadius: ST.radius, borderWidth: 1 },
})
