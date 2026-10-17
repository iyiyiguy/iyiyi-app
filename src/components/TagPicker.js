// Tag chips for sounds/songs: suggested tags + your own. Up to 8 tags; they power search and the
// trending page so creators and listeners can find each other.
import { useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native'
import { SUGGESTED_TAGS, cleanTags } from '../lib/sounds'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

export default function TagPicker({ value = [], onChange, colors = {} }) {
  const c = { text: '#f2f4f7', muted: 'rgba(242,244,247,0.6)', line: 'rgba(255,255,255,0.14)', panel: 'rgba(255,255,255,0.06)', accent: '#ff4fa3', ...colors }
  const tr = useT(strings)
  const [draft, setDraft] = useState('')
  const set = new Set(value)
  const toggle = (t) => onChange?.(cleanTags(set.has(t) ? value.filter((x) => x !== t) : [...value, t]))
  const addDraft = () => {
    const next = cleanTags([...value, ...draft.split(/[,#]/)])
    setDraft('')
    onChange?.(next)
  }
  const chips = Array.from(new Set([...value, ...SUGGESTED_TAGS]))
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} keyboardShouldPersistTaps="handled">
        {chips.map((t) => {
          const on = set.has(t)
          return (
            <Pressable key={t} onPress={() => toggle(t)} style={[st.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : c.panel }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <Text style={[st.chipText, { color: on ? '#fff' : c.muted }]}>#{t}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <View style={[st.addRow, { borderColor: c.line, backgroundColor: c.panel }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={addDraft}
          placeholder={tr('addOwnTag')}
          placeholderTextColor={c.muted}
          style={[st.input, { color: c.text }]}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          returnKeyType="done"
        />
        {draft.trim() ? <Pressable onPress={addDraft} hitSlop={8}><Text style={[st.add, { color: c.accent }]}>{tr('add')}</Text></Pressable> : null}
      </View>
      <Text style={[st.hint, { color: c.muted }]}>{tr('tagCount', { n: value.length })}</Text>
    </View>
  )
}

const st = StyleSheet.create({
  row: { gap: 6, paddingVertical: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  addRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginTop: 4, height: 40 },
  input: { flex: 1, fontSize: 15 },
  add: { fontWeight: '800', fontSize: 14 },
  hint: { fontSize: 11, marginTop: 4 },
})
