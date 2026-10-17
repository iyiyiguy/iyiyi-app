// Full-screen player: big cover art, title / creator, a seek bar, previous / play / next, repeat,
// save, "use in a video", the sound page, and "change cover" on your own sounds.
import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, PanResponder, Alert, ActivityIndicator, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useMusic, toggle, next, prev, seek, setRepeat, updateTrack } from '../lib/musicPlayer'
import { savedSounds, setSaved, pickSoundCover } from '../lib/sounds'
import { supabase } from '../lib/supabase'
import SoundArt, { artColors } from '../components/SoundArt'
import { MC } from '../components/SoundRow'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`

export default function NowPlayingScreen({ navigation }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const m = useMusic()
  const s = m.current
  const [myId, setMyId] = useState(null)
  const [saved, setSavedState] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMyId(data?.session?.user?.id || null)).catch(() => {}) }, [])
  useEffect(() => {
    if (!s?.id || !myId) return
    savedSounds().then((list) => setSavedState(list.some((x) => x.id === s.id))).catch(() => {})
  }, [s?.id, myId])
  useEffect(() => { if (!s) { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('MusicHome') } }, [!!s]) // eslint-disable-line react-hooks/exhaustive-deps

  // seek bar
  const [barW, setBarW] = useState(1)
  const [drag, setDrag] = useState(null) // seconds while dragging
  const ref = useRef({})
  ref.current = { barW, duration: m.duration || s?.duration_s || 0 }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { ref.current.x0 = e.nativeEvent.locationX; setDrag(Math.max(0, Math.min(1, ref.current.x0 / ref.current.barW)) * ref.current.duration) },
    onPanResponderMove: (_, g) => setDrag(Math.max(0, Math.min(1, (ref.current.x0 + g.dx) / ref.current.barW)) * ref.current.duration),
    onPanResponderRelease: (_, g) => { seek(Math.max(0, Math.min(1, (ref.current.x0 + g.dx) / ref.current.barW)) * ref.current.duration); setDrag(null) },
  })).current

  if (!s) return <View style={st.screen} />
  const duration = m.duration || s.duration_s || 0
  const pos = drag ?? m.position
  const frac = duration ? Math.min(1, pos / duration) : 0
  const mine = myId && s.user_id === myId
  const art = Math.min(width - 48, height * 0.42, 460)
  const c = artColors(s.id)

  const toggleSave = async () => {
    if (!myId) return
    const v = !saved
    setSavedState(v)
    try { await setSaved(s.id, v) } catch { setSavedState(!v) }
  }
  const changeCover = async () => {
    setBusy(true)
    try {
      const url = await pickSoundCover(s)
      if (url) { updateTrack(s.id, { cover_url: url }); Alert.alert(t('coverUpdated')) }
    } catch (e) {
      Alert.alert(t('coverFailed'), e?.message || t('tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={st.screen}>
      <LinearGradient colors={[c[0], '#15151d', MC.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={[st.wrap, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 18 }]}>
        <View style={st.top}>
          <Pressable onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MusicHome'))} hitSlop={10} style={st.iconBtn} accessibilityLabel={t('close')}>
            <Ionicons name="chevron-down" size={28} color={MC.text} />
          </Pressable>
          <Text style={st.topText} numberOfLines={1}>{t('nowPlayingTitle')}</Text>
          <Pressable onPress={() => navigation.navigate('Sound', { soundId: s.id, sound: s })} hitSlop={10} style={st.iconBtn} accessibilityLabel={t('openSoundPage')}>
            <Ionicons name="ellipsis-horizontal" size={22} color={MC.text} />
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <View style={st.artShadow}>
            <SoundArt sound={s} size={art} radius={10} />
            {busy ? <View style={[StyleSheet.absoluteFill, st.busy]}><ActivityIndicator color="#fff" /></View> : null}
          </View>
        </View>

        <View style={st.meta}>
          <View style={{ flex: 1 }}>
            <Text style={st.title} numberOfLines={1}>{s.title}</Text>
            <Text style={st.sub} numberOfLines={1}>{s.profiles?.username ? `@${s.profiles.username}` : 'iYiYi'}</Text>
          </View>
          {myId ? (
            <Pressable onPress={toggleSave} hitSlop={10} accessibilityLabel={saved ? t('unsave') : t('save')}>
              <Ionicons name={saved ? 'heart' : 'heart-outline'} size={28} color={saved ? MC.accent : MC.text} />
            </Pressable>
          ) : null}
        </View>

        <View style={st.barWrap} onLayout={(e) => setBarW(e.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(pos) }}>
          <View style={st.barTrack} />
          <View style={[st.barFill, { width: `${frac * 100}%` }]} />
          <View style={[st.barKnob, { left: Math.max(0, frac * barW - 7) }]} />
        </View>
        <View style={st.times}>
          <Text style={st.time}>{mmss(pos)}</Text>
          <Text style={st.time}>{mmss(duration)}</Text>
        </View>

        <View style={st.controls}>
          <Pressable onPress={() => setRepeat(!m.repeat)} hitSlop={10} accessibilityLabel={t('repeat')}>
            <Ionicons name="repeat" size={24} color={m.repeat ? MC.accent : MC.muted} />
          </Pressable>
          <Pressable onPress={prev} hitSlop={10} accessibilityLabel={t('previous')}><Ionicons name="play-skip-back" size={32} color={MC.text} /></Pressable>
          <Pressable onPress={toggle} style={st.playBtn} accessibilityLabel={m.playing ? t('pause') : t('play')}>
            <Ionicons name={m.playing ? 'pause' : 'play'} size={34} color={MC.bg} style={!m.playing && { marginLeft: 4 }} />
          </Pressable>
          <Pressable onPress={() => next()} hitSlop={10} accessibilityLabel={t('next')}><Ionicons name="play-skip-forward" size={32} color={MC.text} /></Pressable>
          <Text style={st.queueN}>{m.index + 1}/{m.queue.length}</Text>
        </View>

        <View style={st.actions}>
          {myId && (s.status === 'public' || mine) ? (
            <Action icon="videocam-outline" label={t('useInVideo')} onPress={() => navigation.navigate('Camera', { sound: s })} />
          ) : null}
          <Action icon="musical-notes-outline" label={t('openSoundPage')} onPress={() => navigation.navigate('Sound', { soundId: s.id, sound: s })} />
          {mine ? <Action icon="image-outline" label={t('editCover')} onPress={changeCover} disabled={busy} /> : null}
        </View>
      </View>
    </View>
  )
}

function Action({ icon, label, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.action, (pressed || disabled) && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={MC.text} />
      <Text style={st.actionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  wrap: { flex: 1, paddingHorizontal: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topText: { flex: 1, textAlign: 'center', color: MC.text, fontWeight: '700', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  artShadow: { borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14 },
  busy: { borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28 },
  title: { color: MC.text, fontSize: 22, fontWeight: '800' },
  sub: { color: MC.muted, fontSize: 15, marginTop: 4 },
  barWrap: { height: 30, justifyContent: 'center', marginTop: 18 },
  barTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  barFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: MC.text },
  barKnob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: MC.text },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: MC.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  playBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: MC.text, alignItems: 'center', justifyContent: 'center' },
  queueN: { color: MC.muted, fontSize: 12, width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 'auto' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)' },
  actionText: { color: MC.text, fontWeight: '700', fontSize: 13 },
})
