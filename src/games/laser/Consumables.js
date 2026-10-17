// Sticky bomb and land mine HUD buttons for laser tag, plus the shared square equipment
// tile (studio kit: 38 px black-glass square, line icon, count underneath).
//
// Sticky bomb: tap to place one at your current position (as many as you carry); a separate
// DETONATE ALL tile appears once one is down and blows every one of them at once.
// Land mine: tap to drop at your current position. It triggers automatically when an
// enemy walks within range. No second press needed.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg'
import { FONT, ST, stShadow, withAlpha } from '../studio'
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'

const tr = (k, v) => translate(H, k, v)

/** Line icons from the HUD kit. kind: 'grenade' | 'c4' | 'mine' | 'uav' */
export function EquipIcon({ kind, color = ST.text, size = 18 }) {
  const p = { stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'grenade' ? <><Circle cx={12} cy={14} r={7} {...p} /><Path d="M9 7h6M12 4v3" {...p} /></> : null}
      {kind === 'c4' ? <><Rect x={4} y={7} width={16} height={11} rx={1} {...p} /><Path d="M8 7V5h8v2M8 12h3" {...p} /></> : null}
      {kind === 'mine' ? <><Ellipse cx={12} cy={15} rx={8} ry={3.5} {...p} /><Path d="M12 11.5V8" {...p} /></> : null}
      {kind === 'uav' ? <><Path d="M3 12h18M12 3v18" {...p} /><Circle cx={12} cy={12} r={4} {...p} /></> : null}
    </Svg>
  )
}

/**
 * The square tile itself (no behaviour). accent: border + icon colour when highlighted.
 * fill: optional 0..1 (or Animated height string) power bar drawn from the bottom.
 */
export function EquipTileFace({ kind, label, size = 38, accent = null, dim = false, children }) {
  const c = accent || ST.text
  return (
    <View style={[s.tile, { width: size, height: size }, accent && { borderColor: accent, backgroundColor: withAlpha(accent, 0.14) }, dim && { opacity: 0.45 }]}>
      {children}
      <EquipIcon kind={kind} color={c} size={Math.round(size * 0.46)} />
      <Text style={[s.count, accent && { color: accent }]} numberOfLines={1}>{label}</Text>
    </View>
  )
}

/** A label chip that floats above a tile (grenade distance, "TAP TO DETONATE"). */
export function TileHint({ text, color = ST.objective }) {
  return (
    <View style={[s.hint, { borderLeftColor: color }]} pointerEvents="none">
      <Text style={s.hintText} numberOfLines={1}>{text}</Text>
    </View>
  )
}

/**
 * StickyBombButton — every tap places ANOTHER sticky bomb where you stand (one from your
 * inventory each; place as many as you carry). The badge shows how many are down.
 *   count (inventory), placedCount, disabled, size, onPlace(), onEmpty()
 */
export function StickyBombButton({ count, placedCount = 0, disabled, size = 38, onPlace, onEmpty }) {
  const empty = !(count > 0)
  const handlePress = useCallback(() => {
    if (disabled) return
    if (empty) { onEmpty?.(); return }
    onPlace?.()
  }, [disabled, empty, onPlace, onEmpty])
  const label = count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      <Pressable
        onPress={handlePress}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={placedCount ? tr('sticky_a11y_placed', { n: label, p: placedCount }) : tr('sticky_a11y', { n: label })}
        style={({ pressed }) => pressed && { transform: [{ scale: 0.94 }] }}
      >
        <EquipTileFace kind="c4" label={label} size={size} accent={placedCount > 0 ? ST.objective : null} dim={disabled || empty} />
      </Pressable>
      {placedCount > 0 ? (
        <View style={s.badge} pointerEvents="none"><Text style={s.badgeText}>×{placedCount}</Text></View>
      ) : null}
    </View>
  )
}

/**
 * DetonateAllButton — a red pill that appears once a sticky bomb is down (above the
 * equipment row); one press blows all of them.
 *   count (placed), disabled, onDetonate(), style
 */
export function DetonateAllButton({ count, disabled, onDetonate, style }) {
  const handlePress = useCallback(() => { if (!disabled) onDetonate?.() }, [disabled, onDetonate])
  if (!(count > 0)) return null
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={count > 1 ? tr('det_all_a11y', { n: count }) : tr('det_one_a11y')}
      style={({ pressed }) => [s.det, disabled && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }, style]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <Path d="M13 2L4 14h7l-1 8 9-12h-7z" stroke="#fff" strokeWidth={2} fill="none" strokeLinejoin="round" />
      </Svg>
      <Text style={s.detText} numberOfLines={1}>{count > 1 ? tr('det_all', { n: count }) : tr('det')}</Text>
    </Pressable>
  )
}

/**
 * LandMineButton — single tap: drop a mine at your position. It triggers on its own.
 *   count, disabled, size, onDrop(), onEmpty()
 */
export function LandMineButton({ count, disabled, size = 38, onDrop, onEmpty }) {
  const [cooldown, setCooldown] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const empty = !(count > 0)

  const handlePress = useCallback(() => {
    if (disabled || cooldown) return
    if (empty) { onEmpty?.(); return }
    onDrop?.()
    setCooldown(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCooldown(false), 2000)
  }, [disabled, cooldown, empty, onDrop, onEmpty])

  const label = count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      <Pressable
        onPress={handlePress}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={tr('mine_a11y', { n: label })}
        style={({ pressed }) => pressed && { transform: [{ scale: 0.94 }] }}
      >
        <EquipTileFace kind="mine" label={label} size={size} dim={disabled || empty || cooldown} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  count: { fontFamily: FONT.display, fontSize: 10, lineHeight: 12, color: ST.text, marginTop: -1, includeFontPadding: false },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: ST.objective, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: FONT.display, fontSize: 10, color: ST.ink, includeFontPadding: false },
  det: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, paddingHorizontal: 10, borderRadius: ST.radius, backgroundColor: 'rgba(255,61,82,0.9)', borderWidth: 1, borderColor: '#ff8a96', alignSelf: 'stretch' },
  detText: { fontFamily: FONT.display, fontSize: 13, letterSpacing: 1.2, color: '#ffffff', includeFontPadding: false },
  hint: { position: 'absolute', bottom: '100%', marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.85)', borderLeftWidth: 2, minWidth: 120, alignItems: 'center' },
  hintText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.2, color: '#ffffff', ...stShadow },
})
