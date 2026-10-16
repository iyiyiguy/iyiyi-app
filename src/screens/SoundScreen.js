// Sound page (app.iyiyi.xyz/sound/<id>): play it, see who made it, plays and videos, use it on
// a video, save it, add to a playlist, share it, or report it for copyright.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Image, Platform, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { getSound, setSaved, savedSounds, videosWithSound, formatCount, soundPlayable } from '../lib/sounds'
import { playQueue, toggle, useMusic } from '../lib/musicPlayer'
import { avatarSource } from '../lib/avatarSource'
import { openProfile } from '../lib/profileNav'
import MasonryGrid from '../components/MasonryGrid'
import ContentViewer from '../components/ContentViewer'
import MiniPlayer from '../components/MiniPlayer'
import { MC } from '../components/SoundRow'
import { PlaylistSheet, ReportSheet, shareSound } from '../components/SoundSheets'

export default function SoundScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const id = route?.params?.soundId || route?.params?.sound?.id
  const [sound, setSound] = useState(route?.params?.sound || null)
  const [missing, setMissing] = useState(false)
  const [me, setMe] = useState(null)
  const [saved, setSavedState] = useState(false)
  const [videos, setVideos] = useState(null)
  const [viewer, setViewer] = useState({ open: false, index: 0 })
  const [plOpen, setPlOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const music = useMusic()
  const isPlaying = music.current?.id === sound?.id && music.playing

  const load = useCallback(async () => {
    if (!id) { setMissing(true); return }
    try {
      const s = await getSound(id)
      if (!s) { setMissing(true); return }
      setSound(s)
    } catch { if (!sound) setMissing(true) }
    videosWithSound(id).then(setVideos)
    const { data } = await supabase.auth.getSession()
    const uid = data?.session?.user?.id || null
    setMe(uid)
    if (uid) savedSounds().then((rows) => setSavedState(rows.some((r) => r.id === id))).catch(() => {})
  }, [id])
  useEffect(() => { load() }, [load])

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs'))
  const needSignIn = () => {
    if (me) return false
    Alert.alert('Sign in first', 'Make an account to save sounds and use them on videos.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
    ])
    return true
  }
  const play = () => {
    if (music.current?.id === sound.id) toggle()
    else playQueue([sound], 0)
  }
  const toggleSave = async () => {
    if (needSignIn()) return
    const on = !saved
    setSavedState(on)
    try { await setSaved(sound.id, on) } catch { setSavedState(!on) }
  }
  const useIt = () => {
    if (needSignIn()) return
    navigation.navigate('Camera', { sound })
  }

  if (missing) {
    return (
      <View style={[st.screen, st.center, { paddingTop: insets.top }]}>
        <Ionicons name="musical-notes-outline" size={36} color={MC.muted} />
        <Text style={st.h2}>This sound isn’t available</Text>
        <Text style={st.muted}>It may be private or was removed.</Text>
        <Pressable onPress={back} style={[st.btn, { marginTop: 16 }]}><Text style={st.btnText}>Go back</Text></Pressable>
      </View>
    )
  }
  if (!sound) return <View style={[st.screen, st.center]}><ActivityIndicator color={MC.accent} /></View>

  const playable = soundPlayable(sound)
  const mine = me && sound.user_id === me
  return (
    <View style={[st.screen, { paddingTop: Platform.OS === 'web' ? 12 : insets.top + 4 }]}>
      <View style={st.top}>
        <Pressable onPress={back} hitSlop={10} accessibilityLabel="Back"><Ionicons name="chevron-back" size={26} color={MC.text} /></Pressable>
        <Text style={st.topTitle}>Sound</Text>
        <Pressable onPress={() => shareSound(sound)} hitSlop={10} accessibilityLabel="Share"><Ionicons name="share-outline" size={22} color={MC.text} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
        <View style={st.hero}>
          <Pressable onPress={play} disabled={!playable} style={[st.cover, !playable && { opacity: 0.5 }]} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
            <Ionicons name={sound.kind === 'song' ? 'musical-note' : 'grid'} size={34} color={MC.gold} />
            <View style={st.coverPlay}><Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={MC.bg} /></View>
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={st.h1} numberOfLines={2}>{sound.title}</Text>
            <Pressable onPress={() => openProfile(navigation, sound.user_id, sound.profiles?.avatar_url)} style={st.owner}>
              <Image source={avatarSource(sound.profiles?.avatar_url)} style={st.avatar} />
              <Text style={st.ownerName}>@{sound.profiles?.username || 'member'}</Text>
            </Pressable>
            <Text style={st.muted}>
              {formatCount(sound.play_count || 0)} plays · {formatCount(sound.use_count || 0)} videos{sound.bpm ? ` · ${sound.bpm} BPM` : ''} · {sound.kind === 'song' ? 'Song' : sound.kind === 'beat' ? 'Beat' : 'Sound'}
            </Text>
          </View>
        </View>
        {sound.tags?.length ? (
          <View style={st.tags}>
            {sound.tags.map((t) => (
              <Pressable key={t} onPress={() => me && navigation.navigate('Music', { tab: 'trending', tag: t })} style={st.tag}><Text style={st.tagText}>#{t}</Text></Pressable>
            ))}
          </View>
        ) : null}
        {sound.is_muted ? <Text style={st.warn}>This sound is muted while a copyright report is reviewed.</Text> : null}
        {sound.status === 'private' && mine ? <Text style={st.note}>Only you can see this sound. Make it public from Studio → My sounds.</Text> : null}

        <View style={st.actions}>
          <Pressable onPress={useIt} disabled={!playable} style={[st.btn, st.btnMain, !playable && { opacity: 0.5 }]} accessibilityRole="button">
            <Ionicons name="videocam" size={18} color="#fff" />
            <Text style={[st.btnText, { color: '#fff' }]}>Use this sound</Text>
          </Pressable>
          <Pressable onPress={toggleSave} style={st.iconBtn} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? MC.gold : MC.text} />
          </Pressable>
          <Pressable onPress={() => { if (!needSignIn()) setPlOpen(true) }} style={st.iconBtn} accessibilityLabel="Add to playlist">
            <Ionicons name="add-circle-outline" size={21} color={MC.text} />
          </Pressable>
          <Pressable onPress={() => shareSound(sound)} style={st.iconBtn} accessibilityLabel="Send to someone">
            <Ionicons name="paper-plane-outline" size={20} color={MC.text} />
          </Pressable>
        </View>

        <Text style={st.section}>Videos with this sound</Text>
        {videos == null ? <ActivityIndicator color={MC.accent} /> : videos.length ? (
          <MasonryGrid items={videos} showOwner onOpen={(index) => setViewer({ open: true, index })} />
        ) : (
          <Text style={st.muted}>No videos yet. Be the first to use it.</Text>
        )}

        {!mine && me ? (
          <Pressable onPress={() => setReportOpen(true)} style={st.report}>
            <Ionicons name="flag-outline" size={14} color={MC.muted} />
            <Text style={st.reportText}>Report copyright</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <MiniPlayer style={[st.mini, { bottom: insets.bottom + 12 }]} />
      <PlaylistSheet visible={plOpen} sound={sound} onClose={() => setPlOpen(false)} />
      <ReportSheet visible={reportOpen} sound={sound} onClose={() => setReportOpen(false)} />
      <ContentViewer
        visible={viewer.open}
        items={videos || []}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
        onOpenProfile={(uid) => { setViewer({ open: false, index: 0 }); openProfile(navigation, uid) }}
      />
    </View>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  topTitle: { color: MC.text, fontSize: 17, fontWeight: '800' },
  hero: { flexDirection: 'row', gap: 16, alignItems: 'center', marginTop: 8 },
  cover: { width: 112, height: 112, borderRadius: 20, backgroundColor: '#211a10', borderWidth: 1, borderColor: 'rgba(255,178,30,0.35)', alignItems: 'center', justifyContent: 'center' },
  coverPlay: { position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: MC.text, alignItems: 'center', justifyContent: 'center' },
  h1: { color: MC.text, fontSize: 22, fontWeight: '900' },
  h2: { color: MC.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: MC.panel2 },
  ownerName: { color: MC.text, fontWeight: '700', fontSize: 14 },
  muted: { color: MC.muted, fontSize: 13 },
  note: { color: MC.muted, fontSize: 13, marginTop: 12 },
  warn: { color: MC.bad, fontSize: 13, marginTop: 12, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: MC.panel, borderWidth: 1, borderColor: MC.line },
  tagText: { color: MC.gold, fontWeight: '700', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, alignItems: 'center' },
  btn: { height: 46, paddingHorizontal: 18, borderRadius: 14, backgroundColor: MC.panel2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnMain: { flex: 1, backgroundColor: MC.accent },
  btnText: { color: MC.text, fontWeight: '800', fontSize: 15 },
  iconBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: MC.panel2, alignItems: 'center', justifyContent: 'center' },
  section: { color: MC.text, fontSize: 16, fontWeight: '800', marginTop: 26, marginBottom: 10 },
  report: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 28, padding: 8 },
  reportText: { color: MC.muted, fontSize: 13 },
  mini: { position: 'absolute', left: 12, right: 12, maxWidth: 720, alignSelf: 'center' },
})
