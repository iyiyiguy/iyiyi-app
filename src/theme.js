import { Appearance, DynamicColorIOS, Platform, useColorScheme } from 'react-native'

// Ethereal glass theme with animated mesh gradients and frosted glass panels
// Dark mode (#050505 base) with light leaks (cyan, purple, pink orbs)
// Light mode (#e8ecf8 base) with softer, transparent surfaces
// Silver-blue "silk & glass" palette (see AuraBackground + Glass). ink is the solid page
// color behind the aura image and on opaque sheets.
const dark = {
  ink: '#0c0f1a',
  inkSurface: '#141a2b',
  inkSurfaceRaised: '#1c2338',
  hairline: 'rgba(255,255,255,0.10)',
  text: '#eef1f8',
  textMuted: '#a4adc4',
  textFaint: '#6f7894',
  accent: '#8fa2ff',
}

const light = {
  ink: '#e6eaf3',
  inkSurface: '#f4f6fb',
  inkSurfaceRaised: '#ffffff',
  hairline: 'rgba(30,40,80,0.10)',
  text: '#151a2b',
  textMuted: '#5c6580',
  textFaint: '#8a92aa',
  accent: '#4f63e8',
}

// On iOS these are dynamic colors, so they follow the system appearance (or the
// in-app override set with Appearance.setColorScheme) live, even though they're
// read once when each screen's StyleSheet is created. Elsewhere the scheme is
// read once at startup, so Android/web pick up a change on next launch.
function surface(key) {
  if (Platform.OS === 'ios') return DynamicColorIOS({ dark: dark[key], light: light[key] })
  return (Appearance.getColorScheme() === 'light' ? light : dark)[key]
}

export const colors = {
  ink: surface('ink'),
  inkSurface: surface('inkSurface'),
  inkSurfaceRaised: surface('inkSurfaceRaised'),
  hairline: surface('hairline'),
  text: surface('text'),
  textMuted: surface('textMuted'),
  textFaint: surface('textFaint'),
  accent: surface('accent'),

  // Fixed in both modes: brand accent, and text/icons that sit on top of photos or
  // brand-colored fills, where they must stay light. The old magenta/violet gradient
  // header is gone; magenta now only marks a selected/active state (chips, tabs).
  // Selected / active state. Was hot magenta; now the periwinkle accent of the glass design.
  magenta: '#5b6cf0',
  violet: '#7d6cf0',
  crimson: '#4f63e8',
  onBrand: '#f5eef2',
  onBrandMuted: '#c9bccf',
  onGold: '#0d0710',

  gold: '#e8b04b',
  success: '#2fbf8f',
  danger: '#e04f4f',

  // Ethereal frosted glass: translucent fills over blurred backdrop
  // Dark mode: deep frosted glass with 0.1 opacity for frosted appearance
  // Light mode: 0.38 opacity for visible but transparent cards
  glassFill: Platform.OS === 'ios' ? DynamicColorIOS({ light: 'rgba(255,255,255,0.38)', dark: 'rgba(255,255,255,0.1)' }) : 'rgba(255,255,255,0.38)',
  glassFillStrong: Platform.OS === 'ios' ? DynamicColorIOS({ light: 'rgba(255,255,255,0.48)', dark: 'rgba(255,255,255,0.16)' }) : 'rgba(255,255,255,0.48)',
  glassBorderLight: Platform.OS === 'ios' ? DynamicColorIOS({ light: 'rgba(255,255,255,0.7)', dark: 'rgba(255,255,255,0.25)' }) : 'rgba(255,255,255,0.7)',
  glassBorderDark: Platform.OS === 'ios' ? DynamicColorIOS({ light: 'rgba(255,255,255,0.35)', dark: 'rgba(255,255,255,0.08)' }) : 'rgba(255,255,255,0.35)',
  glassShadow: 'rgba(0,0,0,0.2)',
}

export const gradients = {
  brand: [colors.crimson, colors.magenta, colors.violet],
  brandSubtle: ['rgba(179,18,63,0.25)', 'rgba(224,21,139,0.25)', 'rgba(108,31,201,0.25)'],
  // The raised camera button on the tab bar - the one place the old brand gradient stays.
  camera: ['#a9b8ff', '#c6a9ff', '#ffc4de'],
}

export const radii = { sm: 10, md: 16, lg: 26, pill: 999 }

export const spacing = (n) => n * 4

// Typeface: Apple's system font (SF Pro) at every weight - the same type iOS itself uses, so the
// app reads native and crisp next to Liquid Glass, with no font download at launch.
// `font` gives weight presets; use them instead of fontFamily strings.
export const font = {
  regular: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
  heavy: { fontWeight: '800' },
}

// Type scale follows Apple's Human Interface Guidelines sizes (Large Title 34, Title 1 28,
// Title 2 22, Headline 17, Body 17, Subhead 15, Footnote 13, Caption 12) with SF Pro's
// optical tracking, so screens line up with system UI.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40, color: colors.text },
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34, color: colors.text },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, lineHeight: 28, color: colors.text },
  title3: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, lineHeight: 25, color: colors.text },
  headline: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22, color: colors.text },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 21, color: colors.text },
  subhead: { fontSize: 15, fontWeight: '500', lineHeight: 20, color: colors.textMuted },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18, color: colors.textFaint },
}

// Soft diffuse shadows (iOS-style lift) for solid elements that aren't glass.
export const shadows = {
  soft: { shadowColor: '#1b2340', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  deep: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 6 },
}

export const useIsDark = () => useColorScheme() !== 'light'

// Text styles for use over photos / dark image overlays / brand fills.
export const onImageType = {
  display: { ...type.display, color: colors.onBrand },
  body: { ...type.body, color: colors.onBrand },
  caption: { ...type.caption, color: colors.onBrandMuted },
}

export const isLightScheme = () => Appearance.getColorScheme() === 'light'

// Gradients need plain strings (not dynamic colors), so resolve the page
// background for the current scheme with this hook.
export function usePageInk() {
  const scheme = useColorScheme()
  const hex = scheme === 'light' ? light.ink : dark.ink
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return { ink: hex, inkFade: `rgba(${r},${g},${b},0.85)`, inkSoft: `rgba(${r},${g},${b},0.5)` }
}
