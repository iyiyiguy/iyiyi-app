// Upload screen after editing a video (TikTok-style "Post" page): a looping preview, the
// description (#hashtags, @mentions), the sound, then Post.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Keyboard, Image } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import EditedVideo from './EditedVideo'
import { CaptionLayer } from '../lib/videoEdit'
import { useT } from '../i18n'
import strings from '../i18n/strings/editor'

const C = { bg: '#0d0f14', panel: '#161a22', line: 'rgba(255,255,255,0.1)', text: '#f2f4f7', muted: 'rgba(242,244,247,0.6)', faint: 'rgba(242,244,247,0.35)', accent: '#ff4fa3', gold: '#ffb21e' }
const MAX = 2200
const QUICK_TAGS = ['#iyiyi', '#nearby', '#fyp', '#vibes', '#music', '#dance', '#funny', '#local']

export default function PostDetails({ visible, item, edit, sound, location, onBack, onPost }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (visible) { setText(item?.caption || ''); setBusy(false) } }, [visible, item?.id])
  if (!item) return null

  const addTag = (t) => {
    if (text.toLowerCase().includes(t.toLowerCase())) return
    setText((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}${t} `.slice(0, MAX))
  }
  const post = () => {
    if (busy) return
    setBusy(true)
    Keyboard.dismiss()
    onPost?.(text.trim())
  }
  const w = 108
  const ar = item.width && item.height ? item.width / item.height : 9 / 16
  const h = Math.min(200, w / ar)

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack} statusBarTranslucent>
      <KeyboardAvoidingView style={[st.screen, { paddingTop: insets.top + 6 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.top}>
          <Pressable onPress={onBack} hitSlop={10} style={st.topBtn} accessibilityLabel={t('backToEditing')}><Ionicons name="chevron-back" size={24} color={C.text} /></Pressable>
          <Text style={st.topTitle}>{t('newPost')}</Text>
          <View style={st.topBtn} />
        </View>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <View style={st.row}>
            <TextInput
              value={text}
              onChangeText={(v) => setText(v.slice(0, MAX))}
              placeholder={item.type === 'photo' ? t('describePhoto') : t('describeVideo')}
              placeholderTextColor={C.faint}
              style={st.input}
              multiline
              autoFocus
              maxLength={MAX}
              textAlignVertical="top"
            />
            <View style={[st.thumb, { width: w, height: h }]}>
              {item.type === 'photo' ? (
                <Image source={{ uri: item.previewUri || item.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <EditedVideo uri={item.postUri || item.uri} edit={{ ...(edit || {}), texts: [] }} sound={null} active={visible} muted style={StyleSheet.absoluteFill} contentFit="cover" />
              )}
              {edit?.texts?.length ? <CaptionLayer texts={edit.texts} w={w} h={h} /> : null}
            </View>
          </View>
          <Text style={st.count}>{text.length}/{MAX}</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 10 }} keyboardShouldPersistTaps="handled">
            {QUICK_TAGS.map((t) => (
              <Pressable key={t} onPress={() => addTag(t)} style={st.chip}><Text style={st.chipText}>{t}</Text></Pressable>
            ))}
          </ScrollView>

          <View style={st.info}>
            <Ionicons name="musical-notes" size={18} color={C.gold} />
            <Text style={st.infoText} numberOfLines={1}>{sound ? sound.title : item.type === 'photo' ? t('photo') : t('originalSound')}</Text>
          </View>
          {location ? (
            <View style={st.info}>
              <Ionicons name="location-outline" size={18} color={C.text} />
              <Text style={st.infoText} numberOfLines={1}>{location}</Text>
            </View>
          ) : null}
          <View style={st.info}>
            <Ionicons name="people-outline" size={18} color={C.text} />
            <Text style={st.infoText}>{t('autoTag')}</Text>
          </View>
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={onBack} style={[st.btn, st.btnGhost]}><Text style={st.btnGhostText}>{item.type === 'photo' ? t('discard') : t('edit')}</Text></Pressable>
          <Pressable onPress={post} disabled={busy} style={[st.btn, st.btnMain, busy && { opacity: 0.6 }]} accessibilityRole="button">
            <Ionicons name="arrow-up-circle" size={20} color="#fff" />
            <Text style={st.btnMainText}>{busy ? t('posting') : t('post')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  topBtn: { width: 44, height: 36, justifyContent: 'center' },
  topTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  body: { paddingHorizontal: 16, paddingBottom: 30, width: '100%', maxWidth: 720, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  input: { flex: 1, minHeight: 150, color: C.text, fontSize: 16, lineHeight: 22, paddingTop: 4 },
  thumb: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' },
  count: { color: C.faint, fontSize: 11, textAlign: 'right', marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line },
  infoText: { color: C.text, fontSize: 14, flex: 1 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, width: '100%', maxWidth: 720, alignSelf: 'center' },
  btn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnGhost: { flex: 1, backgroundColor: C.panel },
  btnGhostText: { color: C.text, fontWeight: '800', fontSize: 15 },
  btnMain: { flex: 2, backgroundColor: C.accent },
  btnMainText: { color: '#fff', fontWeight: '800', fontSize: 16 },
})
