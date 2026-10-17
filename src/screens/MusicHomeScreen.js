// Music home (Spotify-style): greeting, quick tiles (Saved, Your music, The Lab, Trending,
// playlists), shelves of cover-art cards (Latest releases, Trending now, Made in The Lab, your
// playlists and sounds), a "+" menu (upload a sound / create in The Lab) and the mini player.
// Opened from the floating music button above the tab bar.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { latestSounds, searchSounds, savedSounds, mySounds, myPlaylists, soundPlayable } from '../lib/sounds'
import { playQueue, toggle, useMusic } from '../lib/musicPlayer'
import SoundArt from '../components/SoundArt'
import MiniPlayer from '../components/MiniPlayer'
import { MC } from '../components/SoundRow'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

const greetingKey = () => {
  const h = new Date().getHours()
  return h < 12 ? 'goodMorning' : h < 18 ? 'goodAfternoon' : 'goodEvening'
}

export default function MusicHomeScreen({ navigation }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const music = useMusic()
  const [data, setData] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [menu, setMenu] = useState(false)

  const load = useCallback(async () => {
    const safe = (p) => p.catch(() => null)
    const [latest, trending, saved, mine, playlists] = await Promise.all([
      safe(latestSounds(60)), safe(searchSounds('', 20, { sort: 'trending' })), safe(savedSounds()), safe(mySounds()), safe(myPlaylists()),
    ])
    setData({
      latest: (latest || []).slice(0, 20),
      lab: (latest || []).filter((s) => s.kind === 'beat').slice(0, 20),
      trending: trending || [],
      saved: saved || null, // null = signed out
      mine: (mine || []).filter(soundPlayable),
      playlists: playlists || [],
    })
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const play = (list, i) => {
    const s = list[i]
    if (music.current?.id === s.id) { toggle(); return }
    playQueue(list, i)
  }
  const openSound = (s) => navigation.navigate('Sound', { soundId: s.id, sound: s })
  const maxW = Math.min(width, 900)
  const tileW = (maxW - 32 - 8) / 2

  const tiles = data ? [
    data.saved ? { key: 'saved', title: t('quickSaved'), icon: 'heart', colors: ['#7a1fff', '#ff4fa3'], go: () => navigation.navigate('Music', { tab: 'saved' }) } : null,
    data.saved ? { key: 'mine', title: t('quickMine'), icon: 'person', colors: ['#2a62ff', '#39d5ff'], go: () => navigation.navigate('Music', { tab: 'library' }) } : null,
    { key: 'lab', title: t('quickLab'), icon: 'grid', colors: ['#ff4f4f', '#ffb21e'], go: () => navigation.navigate('Studio') },
    { key: 'trending', title: t('quickTrending'), icon: 'flame', colors: ['#0e8f7a', '#5cf2a0'], go: () => navigation.navigate('Music', { tab: 'trending' }) },
    ...data.playlists.slice(0, 2).map((pl) => ({ key: pl.id, title: pl.title, icon: 'albums', colors: null, art: pl, go: () => navigation.navigate('Music', { tab: 'playlists', openList: pl }) })),
  ].filter(Boolean) : []

  return (
    <View style={st.screen}>
      <LinearGradient colors={['#3a1a4a', '#14141c', MC.bg]} locations={[0, 0.32, 0.6]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 110, width: '100%', maxWidth: maxW, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={st.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={st.iconBtn} accessibilityLabel={t('back')}>
            <Ionicons name="chevron-down" size={24} color={MC.text} />
          </Pressable>
          <Text style={st.greeting} numberOfLines={1}>{t(greetingKey())}</Text>
          <Pressable onPress={() => navigation.navigate('Music', { tab: 'trending' })} hitSlop={8} style={st.iconBtn} accessibilityLabel={t('searchMusic')}>
            <Ionicons name="search" size={22} color={MC.text} />
          </Pressable>
          <Pressable onPress={() => setMenu(true)} hitSlop={8} style={st.iconBtn} accessibilityLabel={t('addMusic')}>
            <Ionicons name="add" size={28} color={MC.text} />
          </Pressable>
        </View>

        {!data ? <ActivityIndicator color={MC.text} style={{ marginTop: 60 }} /> : (
          <>
            <View style={st.tiles}>
              {tiles.map((tl) => (
                <Pressable key={tl.key} onPress={tl.go} style={({ pressed }) => [st.tile, { width: tileW }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={tl.title}>
                  <SoundArt sound={tl.art ? { id: tl.art.id, title: tl.title } : null} icon={tl.icon} colors={tl.colors || undefined} size={56} radius={6} style={st.tileArt} />
                  <Text style={st.tileText} numberOfLines={2}>{tl.title}</Text>
                </Pressable>
              ))}
            </View>

            {!data.latest.length && !data.trending.length ? (
              <LinearGradient colors={['#2a1840', '#1a1d29']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.empty}>
                <Ionicons name="musical-notes" size={28} color="#fff" />
                <Text style={st.emptyTitle}>{t('emptyHomeTitle')}</Text>
                <Text style={st.emptyBody}>{t('emptyHomeBody')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Pressable onPress={() => navigation.navigate('Studio')} style={[st.emptyBtn, { backgroundColor: '#fff' }]} accessibilityRole="button"><Text style={[st.emptyBtnText, { color: MC.bg }]}>{t('plusCreate')}</Text></Pressable>
                  <Pressable onPress={() => navigation.navigate('Music', { tab: 'library', upload: true })} style={st.emptyBtn} accessibilityRole="button"><Text style={st.emptyBtnText}>{t('plusUpload')}</Text></Pressable>
                </View>
              </LinearGradient>
            ) : null}
            <Shelf title={t('latestReleases')} list={data.latest} music={music} onPlay={play} onLong={openSound} onAll={() => navigation.navigate('Music', { tab: 'trending' })} t={t} />
            <Shelf title={t('trendingNow')} list={data.trending} music={music} onPlay={play} onLong={openSound} onAll={() => navigation.navigate('Music', { tab: 'trending' })} t={t} />
            <Shelf title={t('madeInLab')} list={data.lab} music={music} onPlay={play} onLong={openSound} t={t}
              lead={<LabCard onPress={() => navigation.navigate('Studio')} t={t} />} />
            {data.playlists.length ? (
              <View style={st.shelf}>
                <ShelfHead title={t('yourPlaylists')} onAll={() => navigation.navigate('Music', { tab: 'playlists' })} t={t} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
                  {data.playlists.map((pl) => (
                    <Pressable key={pl.id} onPress={() => navigation.navigate('Music', { tab: 'playlists', openList: pl })} style={st.card} accessibilityRole="button" accessibilityLabel={pl.title}>
                      <SoundArt sound={{ id: pl.id, title: pl.title }} icon="albums" size={140} radius={8} />
                      <Text style={st.cardTitle} numberOfLines={1}>{pl.title}</Text>
                      <Text style={st.cardSub} numberOfLines={1}>{t('playlistLabel')}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            {data.saved?.length ? <Shelf title={t('savedShelf')} list={data.saved.filter(soundPlayable)} music={music} onPlay={play} onLong={openSound} onAll={() => navigation.navigate('Music', { tab: 'saved' })} t={t} /> : null}
            {data.mine.length ? <Shelf title={t('yourSounds')} list={data.mine} music={music} onPlay={play} onLong={openSound} onAll={() => navigation.navigate('Music', { tab: 'library' })} t={t} /> : null}
          </>
        )}
      </ScrollView>

      <MiniPlayer style={[st.mini, { bottom: insets.bottom + 12 }]} onOpen={() => navigation.navigate('NowPlaying')} />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={st.backdrop} onPress={() => setMenu(false)} />
        <View style={[st.menu, { top: insets.top + 54 }]}>
          <MenuRow icon="cloud-upload-outline" title={t('plusUpload')} sub={t('plusUploadSub')} onPress={() => { setMenu(false); navigation.navigate('Music', { tab: 'library', upload: true }) }} />
          <View style={st.menuLine} />
          <MenuRow icon="grid-outline" title={t('plusCreate')} sub={t('plusCreateSub')} onPress={() => { setMenu(false); navigation.navigate('Studio') }} />
        </View>
      </Modal>
    </View>
  )
}

function ShelfHead({ title, onAll, t }) {
  return (
    <View style={st.shelfHead}>
      <Text style={st.shelfTitle} numberOfLines={1}>{title}</Text>
      {onAll ? <Pressable onPress={onAll} hitSlop={8}><Text style={st.showAll}>{t('showAll')}</Text></Pressable> : null}
    </View>
  )
}

function Shelf({ title, list, music, onPlay, onLong, onAll, lead, t }) {
  if (!list?.length && !lead) return null
  return (
    <View style={st.shelf}>
      <ShelfHead title={title} onAll={onAll} t={t} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
        {lead}
        {list.map((s, i) => {
          const on = music.current?.id === s.id
          return (
            <Pressable key={s.id} onPress={() => onPlay(list, i)} onLongPress={() => onLong(s)} delayLongPress={350} style={({ pressed }) => [st.card, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={s.title}>
              <View>
                <SoundArt sound={s} size={140} radius={8} />
                <View style={[st.playBadge, on && { backgroundColor: MC.accent }]}>
                  <Ionicons name={on && music.playing ? 'pause' : 'play'} size={16} color="#fff" style={!(on && music.playing) && { marginLeft: 2 }} />
                </View>
              </View>
              <Text style={[st.cardTitle, on && { color: MC.accent }]} numberOfLines={1}>{s.title}</Text>
              <Text style={st.cardSub} numberOfLines={1}>{[s.profiles?.username ? `@${s.profiles.username}` : null, t(s.kind === 'song' ? 'kindSong' : s.kind === 'beat' ? 'kindBeat' : 'kindSound')].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function LabCard({ onPress, t }) {
  return (
    <Pressable onPress={onPress} style={st.card} accessibilityRole="button" accessibilityLabel={t('plusCreate')}>
      <LinearGradient colors={['#ff4f4f', '#ffb21e']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.labArt}>
        <View style={st.labPads}>{[0, 1, 2, 3].map((k) => <View key={k} style={[st.labPad, k === 0 && { backgroundColor: '#fff' }]} />)}</View>
        <Ionicons name="add-circle" size={30} color="#fff" style={{ position: 'absolute', right: 10, bottom: 10 }} />
      </LinearGradient>
      <Text style={st.cardTitle} numberOfLines={1}>{t('plusCreate')}</Text>
      <Text style={st.cardSub} numberOfLines={1}>{t('quickLab')}</Text>
    </Pressable>
  )
}

function MenuRow({ icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: 'rgba(255,255,255,0.06)' }]} accessibilityRole="button" accessibilityLabel={title}>
      <View style={st.menuIcon}><Ionicons name={icon} size={20} color={MC.text} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.menuTitle}>{title}</Text>
        <Text style={st.menuSub}>{sub}</Text>
      </View>
    </Pressable>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 4, marginBottom: 14 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  greeting: { flex: 1, color: MC.text, fontSize: 24, fontWeight: '800', marginLeft: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', paddingRight: 8 },
  tileArt: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  tileText: { flex: 1, color: MC.text, fontWeight: '700', fontSize: 13 },
  shelf: { marginTop: 26 },
  shelfHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  shelfTitle: { flex: 1, color: MC.text, fontSize: 21, fontWeight: '800' },
  showAll: { color: MC.muted, fontWeight: '700', fontSize: 13 },
  row: { gap: 14, paddingHorizontal: 16 },
  card: { width: 140 },
  cardTitle: { color: MC.text, fontWeight: '700', fontSize: 13, marginTop: 8 },
  cardSub: { color: MC.muted, fontSize: 12, marginTop: 2 },
  playBadge: { position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  labArt: { width: 140, height: 140, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  labPads: { width: 64, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  labPad: { width: 29, height: 29, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.45)' },
  mini: { position: 'absolute', left: 12, right: 12 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  menu: { position: 'absolute', right: 12, width: 290, borderRadius: 16, backgroundColor: '#232733', borderWidth: 1, borderColor: MC.line, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  menuIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  menuTitle: { color: MC.text, fontWeight: '700', fontSize: 15 },
  menuSub: { color: MC.muted, fontSize: 12, marginTop: 2 },
  menuLine: { height: 1, backgroundColor: MC.line, marginLeft: 66 },
  empty: { marginHorizontal: 16, marginTop: 24, borderRadius: 16, padding: 20, gap: 6, borderWidth: 1, borderColor: MC.line },
  emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 4 },
  emptyBody: { color: MC.muted, fontSize: 14, lineHeight: 20 },
  emptyBtn: { paddingHorizontal: 16, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  emptyBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
})
