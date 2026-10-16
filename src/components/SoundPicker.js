// "Add sound" sheet for the camera and the video editor: search public sounds, your saved
// sounds and your own (public or private). Tap to preview, bookmark to save, Use to pick.
// Every sound here was made or uploaded by iYiYi members (Studio beats and samples).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, TextInput, FlatList, ActivityIndicator, Platform, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { searchSounds, savedSounds, mySounds, setSaved, soundTags, recordPlay, formatCount as fmt } from '../lib/sounds'
import { useSoundPreview } from '../lib/soundPreview'

const C = {
  bg: '#0d0f14', panel: '#161a22', line: 'rgba(255,255,255,0.08)', text: '#f2f4f7', muted: 'rgba(242,244,247,0.6)', faint: 'rgba(242,244,247,0.35)', accent: '#ff4fa3',
}
const TABS = [
  { key: 'trending', label: 'Trending' },
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
  { key: 'mine', label: 'My sounds' },
]

export default function SoundPicker({ visible, onClose, onPick, onMakeBeat, selectedId }) {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState('trending')
  const [tag, setTag] = useState(null)
  const [tags, setTags] = useState([])
  const [q, setQ] = useState('')
  const [lists, setLists] = useState({ trending: null, discover: null, saved: null, mine: null })
  const [savedIds, setSavedIds] = useState(new Set())
  const [error, setError] = useState(null)
  const preview = useSoundPreview()
  const searchTimer = useRef(null)

  const load = useCallback(async (which, query = q, withTag = tag) => {
    try {
      setError(null)
      if (which === 'discover' || which === 'trending') {
        const rows = await searchSounds(query, 40, { tag: withTag, sort: which === 'trending' ? 'trending' : 'popular' })
        setLists((l) => ({ ...l, [which]: rows }))
      } else if (which === 'saved') {
        const rows = await savedSounds()
        setLists((l) => ({ ...l, saved: rows }))
        setSavedIds(new Set(rows.map((r) => r.id)))
      } else {
        const rows = await mySounds()
        setLists((l) => ({ ...l, mine: rows.filter((s) => s.status === 'public' || s.status === 'private') }))
      }
    } catch (e) {
      setLists((l) => ({ ...l, [which]: [] }))
      setError(e?.message || 'Sounds aren’t available right now.')
    }
  }, [q, tag])

  useEffect(() => {
    if (!visible) { preview.stop(); return }
    load('trending', '', tag)
    load('discover', '', tag)
    soundTags().then(setTags, () => {})
    load('saved')
    load('mine')
  }, [visible])

  const onSearch = (text) => {
    setQ(text)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { load('discover', text); load('trending', text) }, 300)
  }

  const toggleSave = async (s) => {
    const on = !savedIds.has(s.id)
    setSavedIds((prev) => { const n = new Set(prev); on ? n.add(s.id) : n.delete(s.id); return n })
    try {
      await setSaved(s.id, on)
      load('saved')
    } catch {}
  }

  const data = useMemo(() => {
    const list = lists[tab] || []
    if (tab === 'discover' || tab === 'trending' || !q.trim()) return list
    const needle = q.trim().toLowerCase()
    return list.filter((s) => `${s.title} ${s.profiles?.username || ''}`.toLowerCase().includes(needle))
  }, [lists, tab, q])

  const close = () => { preview.stop(); onClose?.() }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}>
      <View style={[st.screen, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8 }]}>
        <View style={st.header}>
          <Text style={st.title}>Sounds</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={24} color={C.text} /></Pressable>
        </View>
        <View style={st.search}>
          <Ionicons name="search" size={16} color={C.muted} />
          <TextInput value={q} onChangeText={onSearch} placeholder="Search sounds or creators" placeholderTextColor={C.faint} style={st.searchInput} returnKeyType="search" autoCorrect={false} />
          {q ? <Pressable onPress={() => onSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={C.muted} /></Pressable> : null}
        </View>
        <View style={st.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[st.tab, tab === t.key && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
              <Text style={[st.tabText, tab === t.key && { color: C.bg }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {(tab === 'trending' || tab === 'discover') && tags.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
            {tags.map((t) => {
              const on = tag === t
              return (
                <Pressable key={t} onPress={() => { const next = on ? null : t; setTag(next); load('trending', q, next); load('discover', q, next) }} style={[st.tag, on && { backgroundColor: C.accent, borderColor: C.accent }]}>
                  <Text style={[st.tagText, on && { color: '#fff' }]}>#{t}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}
        {onMakeBeat ? (
          <Pressable onPress={() => { close(); onMakeBeat() }} style={st.make} accessibilityRole="button">
            <View style={st.makeIcon}><Ionicons name="grid" size={18} color="#ffb21e" /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>Make a beat in Studio</Text>
              <Text style={st.rowSub}>Drum machine & sampler. Export it and it shows up here.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ) : null}
        {lists[tab] == null ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(s) => String(s.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={st.empty}>
                {error ? 'Sounds are being set up, check back soon.' : tab === 'saved' ? 'Bookmark sounds to find them here.' : tab === 'mine' ? 'Export a beat from Studio to use it on your videos.' : q ? 'No sounds match that search.' : 'No public sounds yet. Make the first one in Studio!'}
              </Text>
            }
            renderItem={({ item: s }) => {
              const playing = preview.playingId === s.id
              const picked = selectedId === s.id
              return (
                <View style={[st.row, picked && { borderColor: C.accent }]}>
                  <Pressable onPress={() => { if (!playing) recordPlay(s.id); preview.toggle(s) }} style={st.play} accessibilityLabel={playing ? `Pause ${s.title}` : `Preview ${s.title}`}>
                    <Ionicons name={playing ? 'pause' : 'play'} size={18} color={C.text} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={st.rowSub} numberOfLines={1}>
                      {s.profiles?.username ? `@${s.profiles.username}` : 'iYiYi member'} · {Math.round(s.duration_s || 0)}s{s.play_count ? ` · ${fmt(s.play_count)} plays` : ''}{s.use_count ? ` · ${fmt(s.use_count)} videos` : ''}{s.status === 'private' ? ' · only you' : ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => toggleSave(s)} hitSlop={8} accessibilityLabel={savedIds.has(s.id) ? 'Unsave' : 'Save'}>
                    <Ionicons name={savedIds.has(s.id) ? 'bookmark' : 'bookmark-outline'} size={19} color={savedIds.has(s.id) ? '#ffb21e' : C.muted} />
                  </Pressable>
                  <Pressable onPress={() => { preview.stop(); onPick?.(s) }} style={st.use} accessibilityRole="button" accessibilityLabel={`Use ${s.title}`}>
                    <Text style={st.useText}>{picked ? 'Using' : 'Use'}</Text>
                  </Pressable>
                </View>
              )
            }}
          />
        )}
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: C.text, fontSize: 22, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.panel, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: C.line },
  searchInput: { flex: 1, color: C.text, fontSize: 16 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  tabOn: { backgroundColor: C.text },
  tabText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  make: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: '#1b1610', borderWidth: 1, borderColor: 'rgba(255,178,30,0.35)', marginBottom: 10 },
  makeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,178,30,0.15)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, marginBottom: 8 },
  play: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  rowSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  use: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.accent },
  useText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  tag: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel },
  tagText: { color: C.muted, fontWeight: '700', fontSize: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
})
