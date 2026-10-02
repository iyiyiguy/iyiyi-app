// Web build: react-native-maps has no web implementation, so the HUD falls back to the
// drawn radar minimap and the large map overlay is unavailable.
import React from 'react'
import { Minimap } from './Hud'

export const MAP_RANGES = [
  { id: '150ft', label: '150 ft', r: 45.72 },
  { id: '1mi', label: '1 mi', r: 1609.34 },
  { id: '2mi', label: '2 mi', r: 3218.69 },
  { id: '5mi', label: '5 mi', r: 8046.72 },
  { id: 'city', label: 'City', r: 16000 },
  { id: 'state', label: 'State', r: 250000 },
  { id: 'nation', label: 'Nation', r: 2500000 },
]
export const DEFAULT_MAP_RANGE = '150ft'
export function allowedRanges({ endless, areaR }) {
  if (endless || !(areaR > 0)) return MAP_RANGES.map((r) => r.id)
  const ok = MAP_RANGES.filter((r) => r.r <= areaR + 1).map((r) => r.id)
  return ok.length ? ok : [MAP_RANGES[0].id]
}
export const rangeById = (id) => MAP_RANGES.find((r) => r.id === id) || MAP_RANGES[0]

export function MapMinimap({ size = 140, me, headingDeg = 0, rangeM, points, areas }) {
  return <Minimap size={size} me={me} headingDeg={headingDeg} rangeM={rangeM} points={points} areas={areas} />
}

export function MapOverlay() {
  return null
}
