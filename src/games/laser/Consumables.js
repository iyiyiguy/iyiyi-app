// Sticky bomb and land mine HUD buttons for laser tag, plus the shared square equipment
// tile (studio kit: 38 px black-glass square, line icon, count underneath).
//
// Sticky bomb: tap to place at your current position. Tap again to detonate remotely.
// Land mine: tap to drop at your current position. It triggers automatically when an
// enemy walks within range. No second press needed.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg'
import { FONT, ST, stShadow, withAlpha } from '../studio'

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
 * StickyBombButton — two-tap flow: first tap places, second detonates.
 *   count, disabled, size, placed (controlled by the game: a bomb is down), onPlace(), onDetonate(), onEmpty()
 */
export function StickyBombButton({ count, disabled, size = 38, placed: placedProp, onPlace, onDetonate, onEmpty }) {
  // The game says whether a bomb is actually down (placing can fail: no GPS, none left).
  // Without that prop, fall back to remembering the last tap.
  const [placedLocal, setPlacedLocal] = useState(false)
  const placed = placedProp ?? placedLocal
  const empty = !(count > 0)

  const handlePress = useCallback(() => {
    if (disabled) return
    if (placed) {
      setPlacedLocal(false)
      onDetonate?.()
      return
    }
    if (empty) { onEmpty?.(); return }
    setPlacedLocal(true)
    onPlace?.()
  }, [disabled, placed, empty, onPlace, onDetonate, onEmpty])

  const label = placed ? 'DET' : count === Infinity ? '∞' : String(Math.max(0, count | 0))
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="box-none">
      {placed ? <TileHint text="TAP TO DETONATE" color={ST.enemy} /> : null}
      <Pressable
        onPress={handlePress}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={placed ? 'Detonate sticky bomb' : `Sticky bomb, ${label} left. Tap to place at your position.`}
        style={({ pressed }) => pressed && { transform: [{ scale: 0.94 }] }}
      >
        <EquipTileFace kind="c4" label={label} size={size} accent={placed ? ST.enemy : null} dim={(disabled || empty) && !placed} />
      </Pressable>
    </View>
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
        accessibilityLabel={`Land mine, ${label} left. Tap to drop at your position.`}
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
  hint: { position: 'absolute', bottom: '100%', marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.85)', borderLeftWidth: 2, minWidth: 120, alignItems: 'center' },
  hintText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.2, color: '#ffffff', ...stShadow },
})
