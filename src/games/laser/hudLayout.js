// One place for the shooter HUD layout (Laser Tag + Battle Royale), so nothing is
// positioned with scattered magic numbers. The HUD is built from:
//   • a TOP column (rows in normal flow) starting inside the safe area, leaving room on the
//     right for GamePlayScreen's floating 👥 💬 ☰ buttons (immersive layout),
//   • a BOTTOM dock (one row: minimap on one side, UAV / weapon / FIRE stacked on the other),
//   • the space in between for the aim indicator, measured with onLayout.
import { useCallback, useState } from 'react'
import { useWindowDimensions } from 'react-native'

export const HUD_GUTTER = 12
// GamePlayScreen floating buttons: 3 × 40 px + 2 × 8 px gap, 12 px from the edge, + 8 px air.
export const TOP_BUTTONS_W = 3 * 40 + 2 * 8 + 12 + 8
export const TOP_BUTTONS_H = 46 // their height incl. the 6 px top offset
export const DOCK_GAP = 10

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Sizes and edges for the HUD on this screen. `insets` = safe-area insets.
 * Returns { width, height, landscape, side, top, bottom, mapSize, chipMaxW, compact }.
 */
export function useHudMetrics(insets, { minimap = true } = {}) {
  const { width, height } = useWindowDimensions()
  const landscape = width > height
  const side = HUD_GUTTER + Math.max(insets?.left || 0, insets?.right || 0)
  const top = (insets?.top || 0) + 6
  // Keep clear of the home indicator (and a little air on home-button phones).
  const bottom = Math.max(insets?.bottom || 0, 8) + 8
  const mapSize = Math.round(clamp(Math.min(width * 0.3, height * 0.3), 92, 140))
  const chipMaxW = Math.max(150, width - side * 2 - (minimap ? mapSize + DOCK_GAP : 0))
  const compact = width < 390 || height < 700
  return { width, height, landscape, side, top, bottom, mapSize, chipMaxW, compact }
}

/** [height, onLayout] — the measured height of a view (0 until laid out). */
export function useMeasuredHeight() {
  const [h, setH] = useState(0)
  const onLayout = useCallback((e) => {
    const v = Math.round(e?.nativeEvent?.layout?.height || 0)
    setH((old) => (Math.abs(old - v) >= 1 ? v : old))
  }, [])
  return [h, onLayout]
}
