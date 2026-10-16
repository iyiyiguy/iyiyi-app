// One sound / song in a list (music library, profiles, playlists, sound page lists).
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { formatCount } from '../lib/sounds'

export const MC = {
  bg: '#0d0f14', panel: '#161a22', panel2: '#1d222c', line: 'rgba(255,255,255,0.08)', text: '#f2f4f7', muted: 'rgba(242,244,247,0.6)', faint: 'rgba(242,244,247,0.35)', accent: '#ff4fa3', gold: '#ffb21e', ok: '#39d98a', bad: '#ff3d52',
}

const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`

export default function SoundRow({ sound: s, playing, onPlay, onPress, onMore, showOwner = true, right }) {
  const status = s.is_muted ? 'Muted (copyright review)' : s.status === 'private' ? 'Only you' : s.status === 'scanning' ? 'Checking…' : s.status === 'blocked' ? 'Copyright match' : null
  return (
    <Pressable onPress={onPress} style={st.row} accessibilityRole="button" accessibilityLabel={s.title}>
      <Pressable onPress={onPlay} style={[st.play, playing && { backgroundColor: MC.accent }]} hitSlop={4} accessibilityLabel={playing ? `Pause ${s.title}` : `Play ${s.title}`} disabled={s.is_muted}>
        <Ionicons name={playing ? 'pause' : s.kind === 'song' ? 'musical-note' : 'play'} size={17} color={s.is_muted ? MC.faint : MC.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={st.title} numberOfLines={1}>{s.title}</Text>
        <Text style={st.sub} numberOfLines={1}>
          {[showOwner && s.profiles?.username ? `@${s.profiles.username}` : null, s.duration_s ? mmss(s.duration_s) : (s.kind === 'song' ? 'Song' : 'Sound')].filter(Boolean).join(' · ')}
          {s.play_count ? ` · ${formatCount(s.play_count)} plays` : ''}{s.use_count ? ` · ${formatCount(s.use_count)} videos` : ''}
          {status ? ` · ${status}` : ''}
        </Text>
        {s.tags?.length ? <Text style={st.tags} numberOfLines={1}>{s.tags.map((t) => `#${t}`).join(' ')}</Text> : null}
      </View>
      {right}
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityLabel={`More for ${s.title}`}>
          <Ionicons name="ellipsis-horizontal" size={18} color={MC.muted} />
        </Pressable>
      ) : null}
    </Pressable>
  )
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: MC.panel, borderWidth: 1, borderColor: MC.line, marginBottom: 8 },
  play: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { color: MC.text, fontWeight: '700', fontSize: 15 },
  sub: { color: MC.muted, fontSize: 12, marginTop: 2 },
  tags: { color: MC.gold, fontSize: 11, marginTop: 2 },
})
