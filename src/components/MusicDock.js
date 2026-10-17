// Floating music control above the tab bar (keeps the bar at five tabs): a round music-note
// button that opens Music, which becomes the now-playing bar while something plays (tap it for
// the full player). Lives in the tab layer, so it never covers the camera, Studio or players.
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useMusic, toggle, next } from '../lib/musicPlayer'
import SoundArt from './SoundArt'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

const TAB_BAR_H = 70 // the floating tab pill (TabBar) above the bottom inset

export default function MusicDock({ bottom: bottomOverride }) {
  const nav = useNavigation()
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const m = useMusic()
  const bottom = bottomOverride ?? Math.max(insets.bottom - 6, 10) + TAB_BAR_H + 8
  const s = m.current

  if (!s) {
    return (
      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); nav.navigate('MusicHome') }}
        style={({ pressed }) => [st.fab, { bottom }, pressed && { transform: [{ scale: 0.92 }] }]}
        accessibilityRole="button"
        accessibilityLabel={t('openMusicA11y')}
        hitSlop={6}
      >
        <LinearGradient colors={['#ff4fa3', '#7a1fff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.fabInner}>
          <Ionicons name="musical-notes" size={22} color="#fff" />
        </LinearGradient>
      </Pressable>
    )
  }

  const frac = m.duration ? Math.min(1, m.position / m.duration) : 0
  return (
    <View style={[st.barWrap, { bottom }]} pointerEvents="box-none">
      <Pressable onPress={() => nav.navigate('NowPlaying')} style={st.bar} accessibilityRole="button" accessibilityLabel={t('nowPlaying', { name: s.title })}>
        <SoundArt sound={s} size={40} radius={6} />
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{s.title}</Text>
          <Text style={st.sub} numberOfLines={1}>{s.profiles?.username ? `@${s.profiles.username}` : 'iYiYi'}</Text>
        </View>
        <Pressable onPress={() => nav.navigate('MusicHome')} hitSlop={8} accessibilityLabel={t('openMusicA11y')}>
          <Ionicons name="musical-notes-outline" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <Pressable onPress={toggle} hitSlop={8} accessibilityLabel={m.playing ? t('pause') : t('play')}>
          <Ionicons name={m.playing ? 'pause' : 'play'} size={26} color="#fff" />
        </Pressable>
        <Pressable onPress={() => next()} hitSlop={8} accessibilityLabel={t('next')}>
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </Pressable>
        <View style={st.track}><View style={[st.fill, { width: `${frac * 100}%` }]} /></View>
      </Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  fab: { position: 'absolute', right: 16, width: 50, height: 50, borderRadius: 25, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabInner: { flex: 1, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12 },
  bar: {
    width: '100%', maxWidth: 616, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14,
    backgroundColor: 'rgba(32,24,44,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 1 },
  track: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  fill: { height: 2, backgroundColor: '#fff' },
})
