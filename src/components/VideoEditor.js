// Video editor (after shooting): trim, crop, text and sound, then post. Edits are saved as data
// with the post (see lib/videoEdit) so this is instant and nothing is re-encoded.
import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView, PanResponder, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import EditedVideo from './EditedVideo'
import SoundPicker from './SoundPicker'
import {
  CAPTION_FONTS, CAPTION_COLORS, CAPTION_STYLES, CROP_ASPECTS, Caption, PlacedCaption, aspectRatioOf, cleanEdit, useCaptionFonts,
} from '../lib/videoEdit'
import { Fader } from '../studio/ui'

const C = { bg: '#000', panel: '#14171d', panel2: '#1c2029', line: 'rgba(255,255,255,0.1)', text: '#f2f4f7', muted: 'rgba(242,244,247,0.6)', accent: '#ff4fa3' }
const TOOLS = [
  { key: 'trim', icon: 'cut-outline', label: 'Trim' },
  { key: 'crop', icon: 'crop-outline', label: 'Crop' },
  { key: 'text', icon: 'text-outline', label: 'Text' },
  { key: 'sound', icon: 'musical-notes-outline', label: 'Sound' },
]
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export default function VideoEditor({ visible, item, initialSound, onCancel, onPost, onMakeBeat }) {
  useCaptionFonts()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [tool, setTool] = useState('trim')
  const [duration, setDuration] = useState(item?.duration || 0)
  const [edit, setEdit] = useState({ texts: [], crop: { aspect: null, zoom: 1, x: 0, y: 0 }, originalVolume: initialSound ? 0 : 1, soundVolume: 1 })
  const [sound, setSound] = useState(initialSound || null)
  const [playing, setPlaying] = useState(true)
  const [selText, setSelText] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!visible) return
    setTool('trim')
    setEdit({ texts: [], crop: { aspect: null, zoom: 1, x: 0, y: 0 }, originalVolume: initialSound ? 0 : 1, soundVolume: 1 })
    setSound(initialSound || null)
    setSelText(null)
    setPlaying(true)
    setDuration(item?.duration || 0)
  }, [visible, item?.uri, item?.id])

  // frame: the crop aspect, else the video's own shape, fitted into the preview area
  const natural = item?.width && item?.height ? item.width / item.height : 9 / 16
  const ar = aspectRatioOf(edit.crop?.aspect) || natural
  const areaW = Math.min(width, 720) - 32
  const areaH = Math.max(240, height * 0.5)
  let fw = areaW
  let fh = fw / ar
  if (fh > areaH) { fh = areaH; fw = fh * ar }

  const trim = edit.trim || { start: 0, end: duration || 0 }
  const set = (patch) => setEdit((e) => ({ ...e, ...patch }))
  const updateText = (id, patch) => setEdit((e) => ({ ...e, texts: e.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const addText = () => {
    const t = { id: newId(), text: 'Your text', x: 0.5, y: 0.45, size: 0.08, font: 'classic', color: '#ffffff', style: 'plain' }
    setEdit((e) => ({ ...e, texts: [...e.texts, t] }))
    setSelText(t.id)
    setTool('text')
  }
  const removeText = (id) => { setEdit((e) => ({ ...e, texts: e.texts.filter((t) => t.id !== id) })); setSelText(null) }
  const sel = edit.texts.find((t) => t.id === selText)

  // crop panning by dragging the frame
  const panStart = useRef({ x: 0, y: 0 })
  const cropRef = useRef(edit.crop)
  cropRef.current = edit.crop
  const framePan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { panStart.current = { x: cropRef.current.x || 0, y: cropRef.current.y || 0 } },
    onPanResponderMove: (_, g) => {
      const z = cropRef.current.zoom || 1
      if (z <= 1.001) return
      const k = 2 / ((z - 1) * Math.max(1, fw))
      const x = Math.max(-1, Math.min(1, panStart.current.x + g.dx * k))
      const y = Math.max(-1, Math.min(1, panStart.current.y + g.dy * k * (fw / Math.max(1, fh))))
      setEdit((e) => ({ ...e, crop: { ...e.crop, x, y } }))
    },
  }), [fw, fh])

  const post = () => {
    const final = cleanEdit({ ...edit, trim: edit.trim && (edit.trim.start > 0.05 || edit.trim.end < duration - 0.05) ? edit.trim : null })
    onPost?.({ edit: final, sound })
  }

  if (!item) return null
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView style={[st.screen, { paddingTop: insets.top + 6 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.top}>
          <Pressable onPress={onCancel} hitSlop={10} style={st.topBtn}><Text style={st.topText}>Cancel</Text></Pressable>
          <Text style={st.topTitle}>Edit video</Text>
          <Pressable onPress={post} style={st.postBtn} accessibilityRole="button"><Text style={st.postText}>Post</Text></Pressable>
        </View>

        <View style={{ height: areaH, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: fw, height: fh, borderRadius: 12, overflow: 'hidden' }} {...(tool === 'crop' ? framePan.panHandlers : {})}>
            <EditedVideo
              uri={item.postUri || item.uri}
              edit={{ ...edit, crop: { ...edit.crop, aspect: edit.crop?.aspect || null }, texts: [], trim: edit.trim }}
              sound={sound}
              active={visible && playing && !pickerOpen}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onDuration={(d) => setDuration((cur) => cur || d)}
            />
            {edit.texts.map((t) => (
              <DraggableCaption key={t.id} t={t} w={fw} h={fh} selected={selText === t.id} onSelect={() => { setSelText(t.id); setTool('text') }} onMove={(x, y) => updateText(t.id, { x, y })} />
            ))}
            <Pressable onPress={() => setPlaying((p) => !p)} style={st.playBadge} hitSlop={8} accessibilityLabel={playing ? 'Pause' : 'Play'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={16} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={st.tools}>
          {TOOLS.map((t) => (
            <Pressable key={t.key} onPress={() => setTool(t.key)} style={st.toolBtn} accessibilityRole="tab" accessibilityState={{ selected: tool === t.key }}>
              <Ionicons name={t.icon} size={20} color={tool === t.key ? C.accent : C.muted} />
              <Text style={[st.toolText, tool === t.key && { color: C.text }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.panelWrap, { paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
          {tool === 'trim' ? (
            <View style={st.panel}>
              <Text style={st.label}>Keep from {fmt(trim.start)} to {fmt(trim.end || duration)} · {fmt(Math.max(0, (trim.end || duration) - trim.start))}</Text>
              {duration ? (
                <TrimBar duration={duration} start={trim.start} end={trim.end || duration} onChange={(start, end) => set({ trim: { start, end } })} />
              ) : <Text style={st.muted}>Loading video…</Text>}
              <Pressable onPress={() => set({ trim: null })} style={st.linkBtn}><Text style={st.link}>Reset trim</Text></Pressable>
            </View>
          ) : tool === 'crop' ? (
            <View style={st.panel}>
              <Text style={st.label}>Shape</Text>
              <View style={st.chips}>
                {CROP_ASPECTS.map((a) => (
                  <Pressable key={String(a.key)} onPress={() => set({ crop: { ...edit.crop, aspect: a.key } })} style={[st.chip, (edit.crop?.aspect || null) === a.key && st.chipOn]}>
                    <Text style={[st.chipText, (edit.crop?.aspect || null) === a.key && { color: '#000' }]}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[st.label, { marginTop: 14 }]}>Zoom</Text>
              <Fader value={edit.crop?.zoom || 1} min={1} max={3} onChange={(z) => set({ crop: { ...edit.crop, zoom: z } })} color={C.accent} />
              <Text style={st.muted}>Zoom in, then drag the video to frame it.</Text>
            </View>
          ) : tool === 'text' ? (
            <View style={st.panel}>
              <Pressable onPress={addText} style={st.addBtn} accessibilityRole="button"><Ionicons name="add" size={18} color="#000" /><Text style={st.addText}>Add text</Text></Pressable>
              {sel ? (
                <View style={{ gap: 12, marginTop: 12 }}>
                  <TextInput value={sel.text} onChangeText={(text) => updateText(sel.id, { text })} style={st.input} placeholder="Type something" placeholderTextColor={C.muted} multiline maxLength={120} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {CAPTION_FONTS.map((f) => (
                      <Pressable key={f.id} onPress={() => updateText(sel.id, { font: f.id })} style={[st.fontChip, sel.font === f.id && st.chipOn]}>
                        <Text style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: 15, color: sel.font === f.id ? '#000' : C.text }}>{f.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={st.colors}>
                    {CAPTION_COLORS.map((c) => (
                      <Pressable key={c} onPress={() => updateText(sel.id, { color: c })} style={[st.swatch, { backgroundColor: c }, sel.color === c && st.swatchOn]} accessibilityLabel={`Color ${c}`} />
                    ))}
                  </View>
                  <View style={st.chips}>
                    {CAPTION_STYLES.map((s) => (
                      <Pressable key={s.id} onPress={() => updateText(sel.id, { style: s.id })} style={[st.chip, sel.style === s.id && st.chipOn]}>
                        <Text style={[st.chipText, sel.style === s.id && { color: '#000' }]}>{s.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={st.label}>Size</Text>
                  <Fader value={sel.size} min={0.04} max={0.16} onChange={(size) => updateText(sel.id, { size })} color={C.accent} />
                  <Pressable onPress={() => removeText(sel.id)} style={st.linkBtn}><Text style={[st.link, { color: '#ff3d52' }]}>Delete text</Text></Pressable>
                </View>
              ) : (
                <Text style={[st.muted, { marginTop: 10 }]}>{edit.texts.length ? 'Tap a text on the video to edit it. Drag to move.' : 'Add text, then drag it where you want.'}</Text>
              )}
            </View>
          ) : (
            <View style={st.panel}>
              {sound ? (
                <View style={st.soundRow}>
                  <View style={st.soundIcon}><Ionicons name="musical-notes" size={18} color={C.accent} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.soundTitle} numberOfLines={1}>{sound.title}</Text>
                    <Text style={st.muted}>{sound.profiles?.username ? `@${sound.profiles.username}` : 'iYiYi sound'}</Text>
                  </View>
                  <Pressable onPress={() => { setSound(null); set({ originalVolume: 1 }) }} hitSlop={8}><Ionicons name="close-circle" size={20} color={C.muted} /></Pressable>
                </View>
              ) : null}
              <Pressable onPress={() => setPickerOpen(true)} style={st.addBtn}><Ionicons name="musical-notes" size={16} color="#000" /><Text style={st.addText}>{sound ? 'Change sound' : 'Add sound'}</Text></Pressable>
              {sound ? (
                <>
                  <Text style={[st.label, { marginTop: 14 }]}>Sound volume</Text>
                  <Fader value={edit.soundVolume ?? 1} onChange={(v) => set({ soundVolume: v })} color={C.accent} />
                </>
              ) : null}
              <Text style={[st.label, { marginTop: 14 }]}>Original audio</Text>
              <Fader value={edit.originalVolume ?? 1} onChange={(v) => set({ originalVolume: v })} color="#39d5ff" />
            </View>
          )}
        </ScrollView>
        <SoundPicker
          visible={pickerOpen}
          selectedId={sound?.id}
          onClose={() => setPickerOpen(false)}
          onPick={(s) => { setSound(s); set({ originalVolume: Math.min(edit.originalVolume ?? 1, 0.2) }); setPickerOpen(false) }}
          onMakeBeat={onMakeBeat}
        />
      </KeyboardAvoidingView>
    </Modal>
  )
}

function DraggableCaption({ t, w, h, selected, onSelect, onMove }) {
  const start = useRef({ x: t.x, y: t.y })
  const cb = useRef({ onMove, onSelect, t })
  cb.current = { onMove, onSelect, t }
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = { x: cb.current.t.x, y: cb.current.t.y }; cb.current.onSelect() },
    onPanResponderMove: (_, g) => {
      const x = Math.max(0.05, Math.min(0.95, start.current.x + g.dx / w))
      const y = Math.max(0.05, Math.min(0.95, start.current.y + g.dy / h))
      cb.current.onMove(x, y)
    },
    onPanResponderTerminationRequest: () => false,
  }), [w, h])
  return (
    <PlacedCaption t={t} w={w} h={h}>
      <View {...pan.panHandlers} style={[selected && { borderWidth: 1.5, borderColor: '#fff', borderStyle: 'dashed', borderRadius: 6, padding: 2 }]}>
        <Caption t={t} frameW={w} />
      </View>
    </PlacedCaption>
  )
}

function TrimBar({ duration, start, end, onChange }) {
  const [w, setW] = useState(1)
  const val = useRef({ start, end })
  val.current = { start, end }
  const drag = useRef({ which: null, s0: 0, e0: 0 })
  const cb = useRef(onChange)
  cb.current = onChange
  const MIN = Math.min(1, duration / 2)
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const x = e.nativeEvent.locationX
      const sx = (val.current.start / duration) * w
      const ex = (val.current.end / duration) * w
      drag.current = { which: Math.abs(x - sx) < Math.abs(x - ex) ? 'start' : 'end', s0: val.current.start, e0: val.current.end }
    },
    onPanResponderMove: (_, g) => {
      const dt = (g.dx / w) * duration
      const d = drag.current
      if (d.which === 'start') cb.current(Math.max(0, Math.min(d.e0 - MIN, d.s0 + dt)), d.e0)
      else cb.current(d.s0, Math.min(duration, Math.max(d.s0 + MIN, d.e0 + dt)))
    },
  }), [w, duration])
  const sx = (start / duration) * w
  const ex = (end / duration) * w
  return (
    <View style={st.trim} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      <View style={[st.trimDim, { left: 0, width: sx }]} />
      <View style={[st.trimDim, { left: ex, right: 0 }]} />
      <View style={[st.trimSel, { left: sx, width: Math.max(0, ex - sx) }]} />
      <View style={[st.handle, { left: sx - 8 }]}><View style={st.grip} /></View>
      <View style={[st.handle, { left: ex - 8 }]}><View style={st.grip} /></View>
    </View>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  topBtn: { paddingVertical: 6 },
  topText: { color: C.text, fontSize: 16 },
  topTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  postBtn: { backgroundColor: C.accent, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
  postText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  playBadge: { position: 'absolute', left: 10, bottom: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, marginTop: 10 },
  toolBtn: { alignItems: 'center', gap: 3, minWidth: 64 },
  toolText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  panelWrap: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  panel: { gap: 8 },
  label: { color: C.text, fontWeight: '700', fontSize: 13 },
  muted: { color: C.muted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  fontChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  swatchOn: { borderColor: '#fff', transform: [{ scale: 1.15 }] },
  input: { backgroundColor: C.panel2, color: C.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: C.line, minHeight: 46 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 12, height: 44 },
  addText: { color: '#000', fontWeight: '800', fontSize: 15 },
  linkBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  link: { color: C.accent, fontWeight: '700' },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: C.panel2, marginBottom: 8 },
  soundIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,79,163,0.15)', alignItems: 'center', justifyContent: 'center' },
  soundTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  trim: { height: 52, borderRadius: 10, backgroundColor: '#2a2f3a', marginVertical: 8, overflow: 'visible' },
  trimDim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10 },
  trimSel: { position: 'absolute', top: 0, bottom: 0, borderWidth: 3, borderColor: C.accent, borderRadius: 8 },
  handle: { position: 'absolute', top: -4, bottom: -4, width: 16, borderRadius: 6, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
})
