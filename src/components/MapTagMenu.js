import { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import Glass from './Glass'
import { GlassButton } from './GlassButton'
import { colors, radii, type } from '../theme'
import { TAGS } from '../lib/tags'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// Glass dropdown of checkable tag rows for the Map (native + web). Changes apply on "Apply".
// Render it inside an absolutely-positioned container (it fills its parent with a backdrop).
export default function MapTagMenu({ initial = [], onApply, onClose }) {
  const t = useT(strings)
  const [draft, setDraft] = useState(() => new Set(initial))
  const toggle = (tag) => {
    Haptics.selectionAsync().catch(() => {})
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('closeTagFilter')} />
      <Glass radius={radii.md} strong style={styles.menu}>
        <View style={styles.head}>
          <Text style={type.headline}>{t('showPeopleTagged')}</Text>
          {draft.size ? (
            <Pressable onPress={() => setDraft(new Set())} hitSlop={12} accessibilityRole="button">
              <Text style={styles.clear}>{t('clear')}</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {TAGS.map((tag) => {
            const on = draft.has(tag)
            return (
              <Pressable
                key={tag}
                onPress={() => toggle(tag)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={[type.body, on && { fontWeight: '600' }]}>{tag}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? colors.magenta : colors.textFaint} />
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={styles.foot}>
          <GlassButton size="sm" onPress={onClose} style={{ flex: 1 }}>{t('cancel')}</GlassButton>
          <GlassButton size="sm" variant="primary" onPress={() => onApply?.([...draft])} style={{ flex: 1 }}>
            {draft.size ? t('applyN', { n: draft.size }) : t('showEveryone')}
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
