// Studio home: your saved beats (on this device) and your exported sounds (public/private).
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useStudioFonts, withAlpha, FONT } from '../games/studio'
import { SX, sxType, Panel, HwButton, Seg } from '../studio/ui'
import { listProjects, deleteProject } from '../studio/projects'
import { STYLES } from '../studio/generator'
import { KIT_BY_ID, KITS } from '../studio/kits'
import { mySounds, setSoundVisibility, deleteSound } from '../lib/sounds'
import { useSoundPreview } from '../lib/soundPreview'

const KIT_COLORS = ['#ff4fa3', '#ffb21e', '#39d5ff', '#5cf2a0', '#a879ff', '#ff6a3d', '#7cb7ff', '#f2f4f7']

const STATUS = {
  public: { label: 'Public', color: SX.ok },
  private: { label: 'Only me', color: SX.muted },
  scanning: { label: 'Checking…', color: SX.accent },
  blocked: { label: 'Copyright match', color: SX.rec },
}

export default function StudioHomeScreen({ navigation, route }) {
  useStudioFonts()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [tab, setTab] = useState(route?.params?.tab === 'sounds' ? 'sounds' : 'beats')
  const [projects, setProjects] = useState(null)
  const [sounds, setSounds] = useState(null)
  const [soundErr, setSoundErr] = useState(null)
  const preview = useSoundPreview()

  const load = useCallback(() => {
    listProjects().then(setProjects).catch(() => setProjects([]))
    mySounds().then((s) => { setSounds(s); setSoundErr(null) }).catch((e) => { setSounds([]); setSoundErr(e?.message || 'Couldn’t load sounds') })
  }, [])
  useFocusEffect(useCallback(() => { load(); return () => preview.stop() }, [load]))

  const open = (params) => { preview.stop(); navigation.navigate('StudioEditor', params) }

  const removeProject = (p) => Alert.alert(`Delete "${p.name}"?`, 'This beat is removed from this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => deleteProject(p.id).then(load) },
  ])

  const toggleVisibility = async (s) => {
    try {
      const next = await setSoundVisibility(s, s.status === 'public' ? 'private' : 'public')
      if (next?.status === 'blocked') Alert.alert('Kept private', 'It matched a copyrighted song, so it can’t be public.')
      load()
    } catch (e) {
      Alert.alert('Couldn’t change it', e?.message || 'Please try again.')
    }
  }

  const removeSound = (s) => Alert.alert(`Delete "${s.title}"?`, 'Videos already using it will lose this sound.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => deleteSound(s).then(load).catch((e) => Alert.alert('Couldn’t delete', e?.message)) },
  ])

  const maxW = Math.min(width, 720)
  return (
    <View style={st.screen}>
      <ScrollView contentContainerStyle={[st.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 40, maxWidth: maxW }]}>
        <View style={st.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={st.iconBtn} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={SX.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={sxType.label}>iYiYi</Text>
            <Text style={[sxType.title, { fontSize: 24 }]}>Studio</Text>
          </View>
        </View>

        <LinearGradient colors={['#2a1430', '#141a2a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
          <Text style={sxType.label}>Drum machine · Sampler</Text>
          <Text style={st.heroTitle}>Make a beat</Text>
          <Text style={[sxType.small, { color: 'rgba(242,244,247,0.75)' }]}>16 pads, 8 kits, step sequencer, sampler with auto-chop. Export it as a sound for your videos.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <HwButton label="New beat" active onPress={() => open({})} icon={<Ionicons name="add" size={16} color={SX.accent} />} style={{ height: 44 }} />
            <HwButton label="Auto beat" active color={SX.hot} onPress={() => open({ autoStyle: STYLES[Math.floor(Math.random() * STYLES.length)].id })} icon={<Ionicons name="sparkles" size={15} color={SX.hot} />} style={{ height: 44 }} />
          </View>
        </LinearGradient>

        <Text style={[sxType.label, { marginTop: 18, marginBottom: 8 }]}>Kits · tap to start a beat</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {KITS.map((k, i) => {
            const col = KIT_COLORS[i % KIT_COLORS.length]
            return (
              <Pressable key={k.id} onPress={() => open({ kit: k.id })} style={[st.kitCard, { borderColor: withAlpha(col, 0.4) }]} accessibilityRole="button" accessibilityLabel={`New beat with the ${k.name} kit`}>
                <LinearGradient colors={[withAlpha(col, 0.28), 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} />
                <View style={st.kitPads}>
                  {[0, 1, 2, 3].map((n) => <View key={n} style={[st.kitPad, { backgroundColor: withAlpha(col, n === 0 ? 0.9 : 0.35) }]} />)}
                </View>
                <Text style={sxType.title} numberOfLines={1}>{k.name}</Text>
                <Text style={sxType.small} numberOfLines={1}>{k.pads.slice(0, 3).map((p) => p.label).join(' · ')}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
        <Seg options={[{ key: 'beats', label: 'My beats' }, { key: 'sounds', label: 'My sounds' }]} value={tab} onChange={setTab} style={{ marginTop: 16 }} />

        {tab === 'beats' ? (
          projects == null ? <ActivityIndicator color={SX.accent} style={{ marginTop: 30 }} /> : projects.length ? (
            <View style={{ gap: 10, marginTop: 12 }}>
              {projects.map((p) => (
                <Pressable key={p.id} onPress={() => open({ projectId: p.id })} onLongPress={() => removeProject(p)} style={({ pressed }) => [st.row, pressed && { opacity: 0.85 }]}>
                  <View style={[st.rowIcon, { backgroundColor: withAlpha(SX.accent, 0.15) }]}><Ionicons name="grid" size={18} color={SX.accent} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={sxType.title} numberOfLines={1}>{p.name}</Text>
                    <Text style={sxType.small}>{KIT_BY_ID[p.kit]?.name || 'Kit'} · {p.bpm} BPM · {timeAgo(p.updatedAt)}</Text>
                  </View>
                  <Pressable onPress={() => removeProject(p)} hitSlop={10} accessibilityLabel={`Delete ${p.name}`}><Ionicons name="ellipsis-horizontal" size={18} color={SX.muted} /></Pressable>
                </Pressable>
              ))}
              <Text style={[sxType.small, { textAlign: 'center' }]}>Beats save on this phone. Export one to keep it in your account.</Text>
            </View>
          ) : (
            <Empty icon="grid-outline" title="No beats yet" body="Start a new beat or let Auto make one for you." />
          )
        ) : sounds == null ? <ActivityIndicator color={SX.accent} style={{ marginTop: 30 }} /> : sounds.length ? (
          <View style={{ gap: 10, marginTop: 12 }}>
            {sounds.map((s) => {
              const meta = STATUS[s.status] || STATUS.private
              const isPlaying = preview.playingId === s.id
              return (
                <View key={s.id} style={st.row}>
                  <Pressable onPress={() => preview.toggle(s)} style={[st.rowIcon, { backgroundColor: withAlpha(SX.cool, 0.15) }]} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={SX.cool} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={sxType.title} numberOfLines={1}>{s.title}</Text>
                    <Text style={sxType.small}>
                      <Text style={{ color: s.is_muted ? SX.rec : meta.color }}>{s.is_muted ? 'Muted (copyright report)' : meta.label}</Text>
                      {` · ${Math.round(s.duration_s || 0)}s · used ${s.use_count || 0}×`}
                    </Text>
                  </View>
                  {s.status !== 'blocked' && s.status !== 'scanning' ? (
                    <HwButton label={s.status === 'public' ? 'Make private' : 'Make public'} onPress={() => toggleVisibility(s)} style={{ minHeight: 32, paddingHorizontal: 8 }} textStyle={{ fontSize: 10 }} />
                  ) : null}
                  <Pressable onPress={() => removeSound(s)} hitSlop={10} accessibilityLabel={`Delete ${s.title}`}><Ionicons name="trash-outline" size={17} color={SX.muted} /></Pressable>
                </View>
              )
            })}
          </View>
        ) : (
          <Empty icon="musical-notes-outline" title={soundErr ? 'Sounds aren’t available yet' : 'No sounds yet'} body={soundErr ? 'The sound library is being set up. Your beats still save on this phone.' : 'Export a beat from the Studio and it shows up here, public or just for you.'} />
        )}
      </ScrollView>
    </View>
  )
}

function Empty({ icon, title, body }) {
  return (
    <Panel style={{ alignItems: 'center', gap: 8, paddingVertical: 28, marginTop: 12 }}>
      <Ionicons name={icon} size={30} color={SX.muted} />
      <Text style={sxType.body}>{title}</Text>
      <Text style={[sxType.small, { textAlign: 'center' }]}>{body}</Text>
    </Panel>
  )
}

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

const st = StyleSheet.create({
  kitCard: { width: 150, padding: 12, borderRadius: 16, borderWidth: 1, backgroundColor: SX.panel, overflow: 'hidden', gap: 4 },
  kitPads: { flexDirection: 'row', flexWrap: 'wrap', width: 44, gap: 4, marginBottom: 6 },
  kitPad: { width: 20, height: 20, borderRadius: 5 },
  screen: { flex: 1, backgroundColor: SX.bg },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: 18, padding: 18, borderWidth: 1, borderColor: SX.line, gap: 4 },
  heroTitle: { fontFamily: FONT.display, fontSize: 28, color: SX.text, includeFontPadding: false },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: SX.panel, borderWidth: 1, borderColor: SX.line },
  rowIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
