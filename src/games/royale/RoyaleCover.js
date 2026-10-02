// Original cover art for Battle Royale: a sunset gradient with shrinking zone rings and a
// parachute glyph. Drawn with plain views (no image asset, nothing copyrighted).
import React, { memo } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ROYALE_COLORS } from './constants'

const COVER = require('../../../assets/game-covers/battle-royale.png')

export const RoyaleCover = memo(function RoyaleCover({ height = 200, style, glyphSize, children }) {
  const h = Math.max(60, height)
  const ring = (k, opacity, dashed) => {
    const d = h * k
    return (
      <View
        key={k}
        style={{
          position: 'absolute',
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: dashed ? 2 : 3,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: `rgba(255,255,255,${opacity})`,
          left: '50%',
          top: h * 0.52 - d / 2,
          marginLeft: -d / 2,
        }}
      />
    )
  }
  return (
    <View style={[{ height: h, overflow: 'hidden' }, style]}>
      <LinearGradient colors={ROYALE_COLORS.cover} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(20,6,40,0.55)']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <Image source={COVER} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(20,6,40,0.7)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {children}
    </View>
  )
})

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})

export default RoyaleCover
