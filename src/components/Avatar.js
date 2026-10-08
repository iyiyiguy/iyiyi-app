import { useState } from 'react'
import { Image as RNImage, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'

// Profile picture with a proper fallback: when there's no photo (or it fails to load) show the
// iYiYi default picture instead of a blank dark box.
const DEFAULT_AVATAR = require('../../assets/default-avatar.jpg')
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
  // 0 = plain React Native Image (the loader that reliably shows these photos), 1 = expo-image
  // (retry), 2 = give up and show the default picture.
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
        <RNImage source={DEFAULT_AVATAR} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={letter} />
      ) : null}
      {showImage && stage === 0 ? (
        <RNImage source={{ uri }} style={StyleSheet.absoluteFill} resizeMode={contentFit === 'contain' ? 'contain' : 'cover'} onError={() => setStage(1)} />
      ) : null}
      {showImage && stage === 1 ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={transition}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ?? uri}
          onError={() => setStage(2)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: 'rgba(255,255,255,0.95)', fontWeight: '800', letterSpacing: -0.5 },
})
