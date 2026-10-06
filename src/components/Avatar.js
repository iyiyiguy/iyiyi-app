import { useState } from 'react'
import { Image as RNImage, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'

// Profile picture with a proper fallback: when there's no photo (or it fails to load) show the
// first letter of the name on a soft brand gradient instead of a blank dark box.
const PALETTES = [
  ['#6b7cff', '#b39bff'],
  ['#ff6fb5', '#ff9fd0'],
  ['#4fd1c5', '#7fb3ff'],
  ['#ffb16b', '#ff7e9d'],
  ['#8f5bff', '#5b6cf0'],
]

export function paletteFor(seed = '') {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTES[h % PALETTES.length]
}

export default function Avatar({ uri, name = '', size = 48, radius, style, fill = false, recyclingKey, contentFit = 'cover', transition = 180 }) {
  // 0 = expo-image, 1 = plain React Native Image (retry), 2 = give up and show the initial.
  const [stage, setStage] = useState(0)
  const [lastUri, setLastUri] = useState(uri)
  if (uri !== lastUri) {
    setLastUri(uri)
    setStage(0)
  }
  const r = radius ?? size / 2
  const box = fill ? StyleSheet.absoluteFillObject : { width: size, height: size }
  const letter = (name || '?').replace(/^@/, '').trim().charAt(0).toUpperCase() || '?'
  const showImage = !!uri && stage < 2
  return (
    <View style={[box, { borderRadius: r, overflow: 'hidden', backgroundColor: 'rgba(127,140,180,0.18)' }, style]}>
      {!showImage ? (
        <LinearGradient colors={paletteFor(name)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={[styles.letter, { fontSize: fill ? 40 : Math.max(12, size * 0.42) }]}>{letter}</Text>
        </LinearGradient>
      ) : null}
      {showImage && stage === 1 ? (
        <RNImage source={{ uri }} style={StyleSheet.absoluteFill} resizeMode={contentFit === 'contain' ? 'contain' : 'cover'} onError={() => setStage(2)} />
      ) : null}
      {showImage && stage === 0 ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={transition}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ?? uri}
          onError={() => setStage(1)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: 'rgba(255,255,255,0.95)', fontWeight: '800', letterSpacing: -0.5 },
})
