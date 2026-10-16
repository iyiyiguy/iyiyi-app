// Admin: copyright reports on sounds. Listen, read the reports, then Dismiss (keep it up),
// Take down (mutes it for good), or Reinstate (brings a taken-down / auto-muted sound back).
// Only admin accounts get rows (sound_report_queue checks is_sound_admin in the database).
import { useCallback, useState } from 'react'
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Platform, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { reportQueue, resolveReport } from '../lib/sounds'
import { useSoundPreview } from '../lib/soundPreview'
import { MC } from '../components/SoundRow'

const when = (iso) => {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  const h = Math.round(Math.abs(ms) / 36e5)
  return ms > 0 ? `mutes in ${h}h` : `muted ${h}h ago`
}

export default function CopyrightReviewScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const preview = useSoundPreview()
  const load = useCallback(() => { reportQueue().then(setRows).catch((e) => { setRows([]); Alert.alert('Couldn’t load reports', e?.message) }) }, [])
  useFocusEffect(useCallback(() => { load(); return () => preview.stop() }, [load]))

  const act = (r, action) => {
    const labels = { dismiss: 'Dismiss reports', takedown: 'Take it down', reinstate: 'Reinstate' }
    Alert.alert(`${labels[action]}?`, `"${r.title}" by @${r.creator || 'member'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: labels[action], style: action === 'takedown' ? 'destructive' : 'default', onPress: async () => {
        setBusy(r.sound_id)
        try { await resolveReport(r.sound_id, action); load() } catch (e) { Alert.alert('Failed', e?.message) } finally { setBusy(null) }
      } },
    ])
  }

  return (
    <View style={[st.screen, { paddingTop: Platform.OS === 'web' ? 12 : insets.top + 4 }]}>
      <View style={st.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={MC.text} /></Pressable>
        <Text style={st.topTitle}>Copyright reports</Text>
        <Pressable onPress={load} hitSlop={10}><Ionicons name="refresh" size={20} color={MC.text} /></Pressable>
      </View>
      {rows == null ? <ActivityIndicator color={MC.accent} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.sound_id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, maxWidth: 820, width: '100%', alignSelf: 'center' }}
          ListEmptyComponent={<Text style={st.empty}>No copyright reports right now.</Text>}
          renderItem={({ item: r }) => {
            const playing = preview.playingId === r.sound_id
            const open = Number(r.open_reports) > 0
            return (
              <View style={[st.card, open && { borderColor: 'rgba(255,61,82,0.5)' }]}>
                <View style={st.row}>
                  <Pressable onPress={() => preview.toggle({ id: r.sound_id, audio_url: r.audio_url })} style={st.play}>
                    <Ionicons name={playing ? 'pause' : 'play'} size={18} color={MC.text} />
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => navigation.navigate('Sound', { soundId: r.sound_id })}>
                    <Text style={st.title} numberOfLines={1}>{r.title}</Text>
                    <Text style={st.sub}>@{r.creator || 'member'} · {r.status}{r.taken_down ? ' · taken down' : r.muted ? ' · muted' : ''}</Text>
                    <Text style={[st.sub, open && { color: MC.bad }]}>{open ? `${r.open_reports} open · ${when(r.mute_at)}` : 'Resolved'}</Text>
                  </Pressable>
                </View>
                {(r.reasons || []).filter(Boolean).map((x, i) => <Text key={i} style={st.reason}>“{x}”</Text>)}
                <View style={st.actions}>
                  {open ? <Btn label="Dismiss" onPress={() => act(r, 'dismiss')} disabled={busy === r.sound_id} /> : null}
                  {!r.taken_down ? <Btn label="Take down" danger onPress={() => act(r, 'takedown')} disabled={busy === r.sound_id} /> : null}
                  {r.taken_down || r.muted ? <Btn label="Reinstate" ok onPress={() => act(r, 'reinstate')} disabled={busy === r.sound_id} /> : null}
                </View>
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

function Btn({ label, onPress, danger, ok, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[st.btn, danger && { backgroundColor: 'rgba(255,61,82,0.18)' }, ok && { backgroundColor: 'rgba(57,217,138,0.18)' }, disabled && { opacity: 0.5 }]}>
      <Text style={[st.btnText, danger && { color: MC.bad }, ok && { color: MC.ok }]}>{label}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MC.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  topTitle: { color: MC.text, fontSize: 17, fontWeight: '800' },
  empty: { color: MC.muted, textAlign: 'center', marginTop: 40 },
  card: { padding: 12, borderRadius: 14, backgroundColor: MC.panel, borderWidth: 1, borderColor: MC.line, marginBottom: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { color: MC.text, fontWeight: '800', fontSize: 15 },
  sub: { color: MC.muted, fontSize: 12, marginTop: 2 },
  reason: { color: MC.text, fontSize: 13, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 14, height: 36, borderRadius: 10, backgroundColor: MC.panel2, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: MC.text, fontWeight: '800', fontSize: 13 },
})
