// Now-playing bar for the app-wide music player (lib/musicPlayer). Renders nothing when idle.
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useMusic, toggle, next, prev, stopMusic } from '../lib/musicPlayer'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

export default function MiniPlayer({ onOpen, style }) {
  const m = useMusic()
  const t = useT(strings)
  if (!m.current) return null
  const pct = m.duration ? Math.min(1, m.position / m.duration) : 0
  return (
    <View style={[st.bar, style]}>
      <View style={[st.progress, { width: `${pct * 100}%` }]} />
      <Pressable onPress={() => onOpen?.(m.current)} style={st.info} accessibilityRole="button" accessibilityLabel={t('nowPlaying', { name: m.current.title })}>
        <View style={st.art}><Ionicons name={m.current.kind === 'song' ? 'musical-note' : 'grid'} size={16} color="#ffb21e" /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{m.current.title}</Text>
          <Text style={st.sub} numberOfLines={1}>{m.current.profiles?.username ? `@${m.current.profiles.username}` : 'iYiYi'} · {m.index + 1}/{m.queue.length}</Text>
        </View>
      </Pressable>
      <Pressable onPress={prev} hitSlop={8} accessibilityLabel={t('previous')}><Ionicons name="play-skip-back" size={20} color="#f2f4f7" /></Pressable>
      <Pressable onPress={toggle} hitSlop={8} style={st.play} accessibilityLabel={m.playing ? t('pause') : t('play')}>
        <Ionicons name={m.playing ? 'pause' : 'play'} size={20} color="#0d0f14" />
      </Pressable>
      <Pressable onPress={() => next()} hitSlop={8} accessibilityLabel={t('next')}><Ionicons name="play-skip-forward" size={20} color="#f2f4f7" /></Pressable>
      <Pressable onPress={stopMusic} hitSlop={8} accessibilityLabel={t('closePlayer')}><Ionicons name="close" size={18} color="rgba(242,244,247,0.6)" /></Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: '#1a1e27', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: '#ff4fa3' },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  art: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,178,30,0.15)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f2f4f7', fontWeight: '800', fontSize: 14 },
  sub: { color: 'rgba(242,244,247,0.6)', fontSize: 12, marginTop: 1 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f2f4f7', alignItems: 'center', justifyContent: 'center' },
})
