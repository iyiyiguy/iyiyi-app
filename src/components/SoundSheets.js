// Sheets shared by the sound page, music library and profiles:
// add to playlist, copyright report, and sharing a sound link.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView, Alert, Share, ActivityIndicator, Switch } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { myPlaylists, createPlaylist, addToPlaylist, reportSound, soundLink } from '../lib/sounds'
import { MC } from './SoundRow'

export async function shareSound(sound) {
  const by = sound.profiles?.username ? ` by @${sound.profiles.username}` : ''
  try { await Share.share({ message: `Listen to "${sound.title}"${by} on iYiYi ${soundLink(sound.id)}` }) } catch {}
}

function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <Text style={st.title}>{title}</Text>
        {children}
      </View>
    </Modal>
  )
}

export function PlaylistSheet({ visible, sound, onClose }) {
  const [lists, setLists] = useState(null)
  const [name, setName] = useState('')
  const [pub, setPub] = useState(false)
  useEffect(() => {
    if (!visible) return
    setName('')
    myPlaylists().then(setLists).catch(() => setLists([]))
  }, [visible])
  const add = async (pl) => {
    try {
      await addToPlaylist(pl.id, sound.id)
      onClose()
      Alert.alert('Added', `"${sound.title}" is in ${pl.title}.`)
    } catch (e) {
      Alert.alert('Couldn’t add it', e?.message || 'Please try again.')
    }
  }
  const create = async () => {
    try {
      const pl = await createPlaylist(name.trim() || 'My playlist', pub ? 'public' : 'private')
      await add(pl)
    } catch (e) {
      Alert.alert('Couldn’t create it', e?.message || 'Please try again.')
    }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="Add to playlist">
      {lists == null ? <ActivityIndicator color={MC.accent} /> : (
        <ScrollView style={{ maxHeight: 260 }}>
          {lists.map((pl) => (
            <Pressable key={pl.id} onPress={() => add(pl)} style={st.item}>
              <Ionicons name={pl.visibility === 'public' ? 'albums' : 'lock-closed'} size={16} color={MC.gold} />
              <Text style={st.itemText} numberOfLines={1}>{pl.title}</Text>
              <Text style={st.muted}>{pl.playlist_items?.[0]?.count ?? 0}</Text>
            </Pressable>
          ))}
          {!lists.length ? <Text style={[st.note, { marginBottom: 8 }]}>No playlists yet. Make one:</Text> : null}
        </ScrollView>
      )}
      <View style={st.newRow}>
        <TextInput value={name} onChangeText={setName} placeholder="New playlist name" placeholderTextColor={MC.faint} style={st.input} maxLength={60} />
      </View>
      <View style={st.switchRow}>
        <Text style={st.itemText}>Show on my profile</Text>
        <Switch value={pub} onValueChange={setPub} />
      </View>
      <Pressable onPress={create} style={st.primary}><Text style={st.primaryText}>Create & add</Text></Pressable>
    </Sheet>
  )
}

export function ReportSheet({ visible, sound, onClose }) {
  const [reason, setReason] = useState('')
  const [email, setEmail] = useState('')
  const [owns, setOwns] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (visible) { setReason(''); setBusy(false) } }, [visible])
  const send = async () => {
    if (reason.trim().length < 10) { Alert.alert('Add a little more', 'Tell us which song or work this copies.'); return }
    setBusy(true)
    try {
      await reportSound({ soundId: sound.id, reason: reason.trim(), contactEmail: email.trim(), ownsWork: owns })
      onClose()
      Alert.alert('Report sent', 'Thanks. We review copyright reports within 12 hours; the sound is muted after that until it’s resolved.')
    } catch (e) {
      setBusy(false)
      Alert.alert('Couldn’t send', e?.message || 'Please sign in and try again.')
    }
  }
  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose} title="Report copyright">
      <Text style={st.note}>Which song, beat or recording does "{sound?.title}" copy?</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="Song title, artist, link…" placeholderTextColor={MC.faint} style={[st.input, { minHeight: 80, textAlignVertical: 'top', marginTop: 8 }]} multiline maxLength={1000} />
      <TextInput value={email} onChangeText={setEmail} placeholder="Your email (so we can follow up)" placeholderTextColor={MC.faint} style={[st.input, { marginTop: 8 }]} keyboardType="email-address" autoCapitalize="none" maxLength={120} />
      <View style={st.switchRow}>
        <Text style={[st.itemText, { flex: 1 }]}>I own this work or represent the owner</Text>
        <Switch value={owns} onValueChange={setOwns} />
      </View>
      <Pressable onPress={send} disabled={busy} style={[st.primary, busy && { opacity: 0.6 }]}><Text style={st.primaryText}>{busy ? 'Sending…' : 'Send report'}</Text></Pressable>
    </Sheet>
  )
}

const st = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: MC.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, maxWidth: 720, alignSelf: 'center', width: '100%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: MC.line, marginBottom: 14 },
  title: { color: MC.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: MC.line },
  itemText: { color: MC.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  muted: { color: MC.muted, fontSize: 13, marginLeft: 'auto' },
  note: { color: MC.muted, fontSize: 13 },
  newRow: { marginTop: 12 },
  input: { backgroundColor: MC.panel2, borderRadius: 10, borderWidth: 1, borderColor: MC.line, color: MC.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  primary: { marginTop: 14, height: 48, borderRadius: 14, backgroundColor: MC.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
})
