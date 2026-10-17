// Music: trending sounds, your library (songs you uploaded + beats you exported), saved sounds and
// playlists, with an app-wide player. With params.userId it shows that member's public sounds
// and public playlists (their profile's Music section).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Platform, Alert, TextInput, ScrollView, Switch, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import {
  searchSounds, soundTags, mySounds, savedSounds, publicSoundsOf, myPlaylists, publicPlaylistsOf, playlistSounds,
  createPlaylist, updatePlaylist, deletePlaylist, removeFromPlaylist, uploadSong, setSoundVisibility, deleteSound, isSoundAdmin,
  pickSoundCover,
} from '../lib/sounds'
import { playQueue, toggle, useMusic, updateTrack } from '../lib/musicPlayer'
import SoundRow, { MC } from '../components/SoundRow'
import HScroll from '../components/HScroll'
import MiniPlayer from '../components/MiniPlayer'
import TagPicker from '../components/TagPicker'
import { PlaylistSheet, shareSound } from '../components/SoundSheets'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

const MY_TABS = [
  { key: 'trending', label: 'tabTrending' },
  { key: 'library', label: 'tabLibrary' },
  { key: 'saved', label: 'tabSaved' },
  { key: 'playlists', label: 'tabPlaylists' },
]
const THEIR_TABS = [
  { key: 'sounds', label: 'tabSounds' },
  { key: 'playlists', label: 'tabPlaylists' },
]

export default function MusicScreen({ navigation, route }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const userId = route?.params?.userId || null
  const username = route?.params?.username || null
  const tabs = userId ? THEIR_TABS : MY_TABS
  const [tab, setTab] = useState(route?.params?.tab && tabs.some((t) => t.key === route.params.tab) ? route.params.tab : tabs[0].key)
  const [tag, setTag] = useState(route?.params?.tag || null)
  const [q, setQ] = useState('')
  const [tags, setTags] = useState([])
  const [data, setData] = useState({})
  const [openList, setOpenList] = useState(route?.params?.openList || null) // playlist being viewed
  const [listSounds, setListSounds] = useState(null)
  const [menu, setMenu] = useState(null) // sound for the action menu
  const [plFor, setPlFor] = useState(null)
  const [upload, setUpload] = useState(null) // picked file awaiting details
  const [newList, setNewList] = useState(false)
  const music = useMusic()
  const [admin, setAdmin] = useState(false)
  useEffect(() => { if (!userId) isSoundAdmin().then(setAdmin, () => {}) }, [userId])

  const load = useCallback(async (which = tab, query = q, withTag = tag) => {
    try {
      let rows
      if (which === 'trending') rows = await searchSounds(query, 60, { tag: withTag, sort: 'trending' })
      else if (which === 'library') rows = await mySounds()
      else if (which === 'saved') rows = await savedSounds()
      else if (which === 'sounds') rows = await publicSoundsOf(userId)
      else if (which === 'playlists') rows = userId ? await publicPlaylistsOf(userId) : await myPlaylists()
      setData((d) => ({ ...d, [which]: rows }))
    } catch (e) {
      setData((d) => ({ ...d, [which]: [] , [`${which}Err`]: e?.message }))
    }
  }, [tab, q, tag, userId])

  useFocusEffect(useCallback(() => { load(tab) }, [tab, tag]))
  useEffect(() => { if (!userId) soundTags().then(setTags, () => {}) }, [userId])
  useEffect(() => {
    if (!openList) { setListSounds(null); return }
    playlistSounds(openList.id).then(setListSounds).catch(() => setListSounds([]))
  }, [openList?.id])

  const onSearch = (text) => { setQ(text); clearTimeout(onSearch.t); onSearch.t = setTimeout(() => load('trending', text), 300) }
  const back = () => {
    if (openList) { setOpenList(null); return }
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs')
  }

  const rows = openList ? listSounds : data[tab]
  const filtered = useMemo(() => {
    if (!rows || tab === 'trending' || openList || !q.trim()) return rows
    const n = q.trim().toLowerCase()
    return rows.filter((s) => `${s.title} ${s.profiles?.username || ''} ${(s.tags || []).join(' ')}`.toLowerCase().includes(n))
  }, [rows, q, tab, openList])

  const playFrom = (list, i) => {
    const s = list[i]
    if (music.current?.id === s.id) toggle()
    else playQueue(list, i)
  }

  // ---- upload a song ----
  const pickSong = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true, multiple: false })
      if (res.canceled || !res.assets?.[0]) return
      const a = res.assets[0]
      if (a.size && a.size > 40 * 1024 * 1024) { Alert.alert(t('fileTooBig'), t('fileTooBigMsg')); return }
      setUpload({ file: a, title: (a.name || 'Song').replace(/\.[^.]+$/, '').slice(0, 80), visibility: 'private', tags: [], busy: false })
    } catch (e) {
      Alert.alert(t('openFileFailed'), e?.message || t('tryAnother'))
    }
  }
  const doUpload = async () => {
    setUpload((u) => ({ ...u, busy: true }))
    try {
      const { file, title, visibility, tags: tg } = upload
      const s = await uploadSong({ uri: file.uri, name: file.name, mimeType: file.mimeType, title, visibility, tags: tg })
      setUpload(null)
      setTab('library')
      load('library')
      if (s?.status === 'blocked') Alert.alert(t('keptPrivate'), t('keptPrivateSong'))
      else if (s?.status === 'public') Alert.alert(t('uploaded'), t('uploadedMsg'))
    } catch (e) {
      setUpload((u) => (u ? { ...u, busy: false } : u))
      Alert.alert(t('uploadFailed'), e?.message || t('tryAgain'))
    }
  }

  // ---- sound menu ----
  // opened from Music home's "+" -> Upload a sound
  useEffect(() => { if (route?.params?.upload) setTimeout(() => pickSong(), 350) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isMine = (s) => !userId && tab === 'library' && !openList ? true : false
  const menuActions = (s) => {
    const acts = [
      { label: t('openSoundPage'), icon: 'open-outline', run: () => navigation.navigate('Sound', { soundId: s.id, sound: s }) },
      { label: t('addToPlaylist'), icon: 'add-circle-outline', run: () => setPlFor(s) },
      { label: t('sendToSomeone'), icon: 'paper-plane-outline', run: () => shareSound(s) },
    ]
    if (openList && !userId) acts.push({ label: t('removeFromPlaylist'), icon: 'remove-circle-outline', run: () => removeFromPlaylist(openList.id, s.id).then(() => setListSounds((l) => l.filter((x) => x.id !== s.id))) })
    if (isMine(s)) {
      acts.push({ label: t('editCover'), icon: 'image-outline', run: async () => {
        try {
          const url = await pickSoundCover(s)
          if (url) { updateTrack(s.id, { cover_url: url }); load('library') }
        } catch (e) { Alert.alert(t('coverFailed'), e?.message || t('tryAgain')) }
      } })
      if (s.status !== 'blocked') acts.push({ label: s.status === 'public' ? t('makePrivate') : t('makePublic'), icon: s.status === 'public' ? 'lock-closed-outline' : 'globe-outline', run: async () => {
        try {
          const next = await setSoundVisibility(s, s.status === 'public' ? 'private' : 'public')
          if (next?.status === 'blocked') Alert.alert(t('keptPrivate'), t('cantBePublic'))
        } catch (e) { Alert.alert(t('changeFailed'), e?.message) }
        load('library')
      } })
      acts.push({ label: t('delete'), icon: 'trash-outline', danger: true, run: () => Alert.alert(t('deleteQ', { name: s.title }), t('deleteSongMsg'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('delete'), style: 'destructive', onPress: () => deleteSound(s).then(() => load('library')).catch((e) => Alert.alert(t('deleteFailed'), e?.message)) },
      ]) })
    }
    return acts
  }

  const listHeader = (
    <View>
      {tab === 'trending' && !openList ? (
        <>
          <View style={st.search}>
            <Ionicons name="search" size={16} color={MC.muted} />
            <TextInput value={q} onChangeText={onSearch} placeholder={t('searchPlaceholder')} placeholderTextColor={MC.faint} style={st.searchInput} autoCorrect={false} autoCapitalize="none" />
          </View>
          {tags.length ? (
            <HScroll fadeColor={MC.bg} contentContainerStyle={{ gap: 6, paddingVertical: 10, paddingRight: 30 }}>
              {tags.map((t) => {
                const on = tag === t
                return (
                  <Pressable key={t} onPress={() => setTag(on ? null : t)} style={[st.chip, on && { backgroundColor: MC.accent, borderColor: MC.accent }]}>
                    <Text style={[st.chipText, on && { color: '#fff' }]}>#{t}</Text>
                  </Pressable>
                )
              })}
            </HScroll>
          ) : <View style={{ height: 10 }} />}
        </>
      ) : null}
      {tab === 'library' && !openList ? (
        <View style={st.libActions}>
          <Pressable onPress={pickSong} style={[st.action, { backgroundColor: MC.accent }]}><Ionicons name="cloud-upload-outline" size={17} color="#fff" /><Text style={[st.actionText, { color: '#fff' }]}>{t('uploadSong')}</Text></Pressable>
          <Pressable onPress={() => navigation.navigate('Studio')} style={st.action}><Ionicons name="grid-outline" size={17} color={MC.gold} /><Text style={st.actionText}>{t('makeABeat')}</Text></Pressable>
        </View>
      ) : null}
      {openList ? (
        <View style={st.plHead}>
          <Text style={st.h1} numberOfLines={2}>{openList.title}</Text>
          <Text style={st.muted}>{openList.visibility === 'public' ? t('onYourProfile') : t('private')} · {t('tracksN', { n: listSounds?.length ?? 0 })}{userId && username ? ` · @${username}` : ''}</Text>
          <View style={st.libActions}>
            <Pressable disabled={!listSounds?.length} onPress={() => playQueue(listSounds, 0)} style={[st.action, { backgroundColor: MC.accent }]}><Ionicons name="play" size={17} color="#fff" /><Text style={[st.actionText, { color: '#fff' }]}>{t('playAll')}</Text></Pressable>
            {!userId ? (
              <>
                <Pressable onPress={async () => { const v = openList.visibility === 'public' ? 'private' : 'public'; await updatePlaylist(openList.id, { visibility: v }).catch(() => {}); setOpenList({ ...openList, visibility: v }); load('playlists') }} style={st.action}>
                  <Ionicons name={openList.visibility === 'public' ? 'lock-closed-outline' : 'globe-outline'} size={17} color={MC.text} />
                  <Text style={st.actionText}>{openList.visibility === 'public' ? t('makePrivate') : t('showOnProfile')}</Text>
                </Pressable>
                <Pressable onPress={() => Alert.alert(t('deleteQ', { name: openList.title }), t('deletePlaylistMsg'), [
                  { text: t('cancel'), style: 'cancel' },
                  { text: t('delete'), style: 'destructive', onPress: () => deletePlaylist(openList.id).then(() => { setOpenList(null); load('playlists') }) },
                ])} style={st.iconAction}><Ionicons name="trash-outline" size={17} color={MC.bad} /></Pressable>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      {tab === 'playlists' && !openList && !userId ? (
        <Pressable onPress={() => setNewList(true)} style={[st.action, { alignSelf: 'flex-start', marginBottom: 10 }]}><Ionicons name="add" size={17} color={MC.text} /><Text style={st.actionText}>{t('newPlaylist')}</Text></Pressable>
      ) : null}
    </View>
  )

  const showingPlaylists = tab === 'playlists' && !openList
  const emptyText = data[`${tab}Err`] && !openList ? t('emptySetup')
    : openList ? t('emptyList')
      : tab === 'trending' ? (q || tag ? t('emptyNoMatch') : t('emptyTrending'))
        : tab === 'library' ? t('emptyLibrary')
          : tab === 'saved' ? t('emptySaved')
            : tab === 'sounds' ? t('emptySounds')
              : userId ? t('emptyTheirPlaylists') : t('emptyMyPlaylists')

  return (
    <View style={[st.screen, { paddingTop: Platform.OS === 'web' ? 12 : insets.top + 4 }]}>
      <View style={st.top}>
        <Pressable onPress={back} hitSlop={10} accessibilityLabel={t('back')}><Ionicons name="chevron-back" size={26} color={MC.text} /></Pressable>
        <Text style={st.topTitle}>{userId ? (username ? t('userMusic', { name: `@${username}` }) : t('theirMusic')) : t('music')}</Text>
        {admin ? (
          <Pressable onPress={() => navigation.navigate('CopyrightReview')} hitSlop={10} accessibilityLabel={t('copyrightReports')}><Ionicons name="shield-checkmark-outline" size={22} color={MC.text} /></Pressable>
        ) : <View style={{ width: 26 }} />}
      </View>
      {!openList ? (
        <View style={st.tabs}>
          {tabs.map((tb) => (
            <Pressable key={tb.key} onPress={() => setTab(tb.key)} style={[st.tab, tab === tb.key && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === tb.key }}>
              <Text style={[st.tabText, tab === tb.key && { color: MC.bg }]}>{t(tb.label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {filtered == null ? <ActivityIndicator color={MC.accent} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(x) => String(x.id)}
          ListHeaderComponent={listHeader}
          contentContainerStyle={st.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={st.empty}>{emptyText}</Text>}
          renderItem={({ item, index }) => showingPlaylists ? (
            <Pressable onPress={() => setOpenList(item)} style={st.plRow}>
              <View style={st.plArt}><Ionicons name="albums" size={20} color={MC.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.plTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={st.muted}>{t('tracksN', { n: item.playlist_items?.[0]?.count ?? 0 })} · {item.visibility === 'public' ? t('onProfile') : t('private')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MC.muted} />
            </Pressable>
          ) : (
            <SoundRow
              sound={item}
              showOwner={tab !== 'library' && tab !== 'sounds'}
              playing={music.current?.id === item.id && music.playing}
              onPlay={() => playFrom(filtered, index)}
              onPress={() => navigation.navigate('Sound', { soundId: item.id, sound: item })}
              onMore={() => setMenu(item)}
            />
          )}
        />
      )}
      <MiniPlayer style={[st.mini, { bottom: insets.bottom + 12 }]} onOpen={() => navigation.navigate('NowPlaying')} />

      <ActionMenu sound={menu} actions={menu ? menuActions(menu) : []} onClose={() => setMenu(null)} />
      <PlaylistSheet visible={!!plFor} sound={plFor} onClose={() => { setPlFor(null); if (tab === 'playlists') load('playlists') }} />
      <NewPlaylistSheet visible={newList} onClose={() => setNewList(false)} onCreate={async (title, vis) => { setNewList(false); try { await createPlaylist(title, vis); load('playlists') } catch (e) { Alert.alert(t('createFailed'), e?.message) } }} />
      <UploadSheet upload={upload} setUpload={setUpload} onSubmit={doUpload} />
    </View>
  )
}

function BottomSheet({ visible, onClose, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}><View style={st.grabber} />{children}</View>
    </Modal>
  )
}

function ActionMenu({ sound, actions, onClose }) {
  return (
    <BottomSheet visible={!!sound} onClose={onClose}>
      <Text style={st.sheetTitle} numberOfLines={1}>{sound?.title}</Text>
      {actions.map((a) => (
        <Pressable key={a.label} onPress={() => { onClose(); setTimeout(a.run, 250) }} style={st.menuItem}>
          <Ionicons name={a.icon} size={19} color={a.danger ? MC.bad : MC.text} />
          <Text style={[st.menuText, a.danger && { color: MC.bad }]}>{a.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  )
}

function NewPlaylistSheet({ visible, onClose, onCreate }) {
  const t = useT(strings)
  const [title, setTitle] = useState('')
  const [pub, setPub] = useState(false)
  useEffect(() => { if (visible) { setTitle(''); setPub(false) } }, [visible])
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={st.sheetTitle}>{t('newPlaylist')}</Text>
      <TextInput value={title} onChangeText={setTitle} placeholder={t('playlistName')} placeholderTextColor={MC.faint} style={st.input} maxLength={60} autoFocus />
      <View style={st.switchRow}><Text style={st.menuText}>{t('showOnMyProfile')}</Text><Switch value={pub} onValueChange={setPub} /></View>
      <Pressable onPress={() => onCreate(title.trim() || t('myPlaylist'), pub ? 'public' : 'private')} style={st.primary}><Text style={st.primaryText}>{t('create')}</Text></Pressable>
    </BottomSheet>
  )
}

function UploadSheet({ upload, setUpload, onSubmit }) {
  const t = useT(strings)
  const u = upload
  return (
    <BottomSheet visible={!!u} onClose={() => (u?.busy ? null : setUpload(null))}>
      {u ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
          <Text style={st.sheetTitle}>{t('uploadSong')}</Text>
          <Text style={st.label}>{t('title')}</Text>
          <TextInput value={u.title} onChangeText={(v) => setUpload({ ...u, title: v })} style={st.input} maxLength={80} />
          <Text style={st.label}>{t('whoCanHear')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[['private', t('onlyMe')], ['public', t('public')]].map(([k, l]) => (
              <Pressable key={k} onPress={() => setUpload({ ...u, visibility: k })} style={[st.tab, u.visibility === k && st.tabOn]}>
                <Text style={[st.tabText, u.visibility === k && { color: MC.bg }]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[st.muted, { marginTop: 6 }]}>{u.visibility === 'public' ? t('publicSongInfo') : t('privateSongInfo')}</Text>
          <Text style={st.label}>{t('tags')}</Text>
          <TagPicker value={u.tags} onChange={(tg) => setUpload({ ...u, tags: tg })} />
          <Pressable onPress={onSubmit} disabled={u.busy} style={[st.primary, u.busy && { opacity: 0.6 }]}>
            <Text style={st.primaryText}>{u.busy ? (u.visibility === 'public' ? t('uploadingChecking') : t('uploading')) : t('upload')}</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </BottomSheet>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  topTitle: { color: MC.text, fontSize: 17, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10, maxWidth: 820, width: '100%', alignSelf: 'center', flexWrap: 'wrap' },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: MC.panel, borderWidth: 1, borderColor: MC.line },
  tabOn: { backgroundColor: MC.text },
  tabText: { color: MC.muted, fontWeight: '700', fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 140, maxWidth: 820, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: MC.panel, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: MC.line },
  searchInput: { flex: 1, color: MC.text, fontSize: 16 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: MC.line, backgroundColor: MC.panel },
  chipText: { color: MC.muted, fontWeight: '700', fontSize: 12 },
  libActions: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: MC.panel2 },
  iconAction: { width: 40, height: 40, borderRadius: 12, backgroundColor: MC.panel2, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: MC.text, fontWeight: '800', fontSize: 14 },
  plHead: { gap: 4, marginBottom: 6 },
  h1: { color: MC.text, fontSize: 24, fontWeight: '900' },
  muted: { color: MC.muted, fontSize: 13 },
  plRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: MC.panel, borderWidth: 1, borderColor: MC.line, marginBottom: 8 },
  plArt: { width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,178,30,0.15)', alignItems: 'center', justifyContent: 'center' },
  plTitle: { color: MC.text, fontWeight: '800', fontSize: 15 },
  empty: { color: MC.muted, textAlign: 'center', marginTop: 36, paddingHorizontal: 20 },
  mini: { position: 'absolute', left: 12, right: 12, maxWidth: 720, alignSelf: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: MC.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, maxWidth: 720, alignSelf: 'center', width: '100%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: MC.line, marginBottom: 14 },
  sheetTitle: { color: MC.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  menuText: { color: MC.text, fontSize: 15, fontWeight: '600' },
  input: { backgroundColor: MC.panel2, borderRadius: 10, borderWidth: 1, borderColor: MC.line, color: MC.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  label: { color: MC.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  primary: { marginTop: 16, height: 48, borderRadius: 14, backgroundColor: MC.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
})
