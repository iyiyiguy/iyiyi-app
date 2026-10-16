// Live green screen backgrounds (camera). The native side (modules/body-hit GreenScreen.swift)
// cuts the person out of every frame and draws them on one of these. iPhone only for now.
import { Platform } from 'react-native'
import { Asset } from 'expo-asset'
import { greenScreenSupported } from '../../modules/body-hit'

export const GREEN_BACKGROUNDS = [
  { id: 'blur', label: 'Blur', mode: 'blur' },
  { id: 'beach', label: 'Beach', mode: 'image', asset: require('../../assets/greenscreen/beach.jpg') },
  { id: 'neon', label: 'Neon', mode: 'image', asset: require('../../assets/greenscreen/neon.jpg') },
  { id: 'vegas', label: 'Vegas', mode: 'image', asset: require('../../assets/greenscreen/vegas.jpg') },
  { id: 'space', label: 'Space', mode: 'image', asset: require('../../assets/greenscreen/space.jpg') },
  { id: 'mountain', label: 'Peak', mode: 'image', asset: require('../../assets/greenscreen/mountain.jpg') },
  { id: 'studio', label: 'Studio', mode: 'image', asset: require('../../assets/greenscreen/studio.jpg') },
  { id: 'green', label: 'Green', mode: 'color', color: '#00c853' },
]

export const canGreenScreen = () => Platform.OS === 'ios' && greenScreenSupported()

/** -> { mode, uri?, color? } for the native module. bg: one of GREEN_BACKGROUNDS or { id: 'photo', uri }. */
export async function greenOptions(bg) {
  if (!bg) return null
  if (bg.id === 'photo') return { mode: 'image', uri: bg.uri }
  if (bg.mode !== 'image') return { mode: bg.mode, color: bg.color || null }
  const a = Asset.fromModule(bg.asset)
  if (!a.localUri) { try { await a.downloadAsync() } catch {} }
  return { mode: 'image', uri: a.localUri || a.uri }
}
