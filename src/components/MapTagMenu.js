import { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import Glass from './Glass'
import { GlassButton } from './GlassButton'
import { colors, radii, type } from '../theme'
import { TAGS } from '../lib/tags'

// Glass dropdown of checkable tag rows for the Map (native + web). Changes apply on "Apply".
// Render it inside an absolutely-positioned container (it fills its parent with a backdrop).
export default function MapTagMenu({ initial = [], onApply, onClose }) {
  const [draft, setDraft] = useState(() => new Set(initial))
  const toggle = (t) => {
    Haptics.selectionAsync().catch(() => {})
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel="Close tag filter" />
      <Glass radius={radii.md} strong style={styles.menu}>
        <View style={styles.head}>
          <Text style={type.headline}>Show people tagged</Text>
          {draft.size ? (
            <Pressable onPress={() => setDraft(new Set())} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {TAGS.map((t) => {
            const on = draft.has(t)
            return (
              <Pressable
                key={t}
                onPress={() => toggle(t)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={[type.body, on && { fontWeight: '600' }]}>{t}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? colors.magenta : colors.textFaint} />
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={styles.foot}>
          <GlassButton size="sm" onPress={onClose} style={{ flex: 1 }}>Cancel</GlassButton>
          <GlassButton size="sm" variant="primary" onPress={() => onApply?.([...draft])} style={{ flex: 1 }}>
            {draft.size ? `Apply (${draft.size})` : 'Show everyone'}
          </GlassButton>
        </View>
      </Glass>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.12)' },
  menu: { position: 'absolute', top: 8, right: 12, width: 270, padding: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  clear: { fontSize: 13, fontWeight: '600', color: colors.magenta },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  foot: { flexDirection: 'row', gap: 10, marginTop: 12 },
})
