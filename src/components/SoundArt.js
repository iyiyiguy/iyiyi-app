// Cover art for a sound / song: the owner's cover image, or generated art (a gradient picked
// from the sound's id, with an icon for its kind) so every card looks finished.
import { Image, View, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'

const PALETTES = [
  ['#ff4fa3', '#7a1fff'], ['#ffb21e', '#ff4f4f'], ['#39d5ff', '#3b5bff'], ['#5cf2a0', '#0e8f7a'],
  ['#b06cff', '#ff4fa3'], ['#ff6b4a', '#ffb21e'], ['#7fb4ff', '#b06cff'], ['#1fd1c1', '#2a62ff'],
]
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
export const artColors = (key) => PALETTES[hash(String(key || 'x')) % PALETTES.length]

export default function SoundArt({ sound, size = 56, radius = 8, icon, colors, style }) {
  const r = { width: size, height: size, borderRadius: radius }
  if (sound?.cover_url) return <Image source={{ uri: sound.cover_url }} style={[r, st.img, style]} />
  const name = icon || (sound?.kind === 'beat' ? 'grid' : sound?.kind === 'song' ? 'musical-notes' : 'pulse')
  return (
    <LinearGradient colors={colors || artColors(sound?.id || sound?.title)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[r, st.gen, style]}>
      <Ionicons name={name} size={Math.round(size * 0.38)} color="rgba(255,255,255,0.92)" />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }]} />
    </LinearGradient>
  )
}

const st = StyleSheet.create({
  img: { backgroundColor: '#1d222c' },
  gen: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
})
