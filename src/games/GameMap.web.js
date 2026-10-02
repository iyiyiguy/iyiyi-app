// Map used by the arcade: bomb-site / play-area pickers in the lobby and the
// full "View map" sheet in game. Follows MapScreen's Fabric rule: never hand
// MapView/Marker/Circle a non-finite coordinate.
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { colors, radii, type } from '../theme'

export const isValidCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

export function withAlpha(hex, a) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// markers: [{ id, lat, lng, label, color }]
// circles: [{ id, lat, lng, radius, color }]
// Web build: react-native-maps has no web implementation. The arcade's map-based setup
// (bomb sites, play areas) is only available in the iOS app.
export const deltaForRadius = (r) => (r > 0 ? Math.min(60, Math.max(0.0025, (r * 2.6) / 111000)) : 0.003)

export function GameMap({ style, height = 280 }) {
  return (
    <View style={[{ height, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.12)' }, style]}>
      <Text style={{ color: colors.textMuted }}>Maps are available in the iYiYi iOS app.</Text>
    </View>
  )
}

export default GameMap
