import { ScrollView, View, Pressable, Text, StyleSheet } from 'react-native'
import { colors, radii } from '../theme'
import { TAGS } from '../lib/tags'
import GlassPanel from './GlassPanel'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

export default function TagFilterBar({ active, onChange }) {
  const t = useT(strings)
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.wrap}
      style={styles.scroll}
    >
      <Chip label={t('all')} selected={!active} onPress={() => onChange(null)} />
      {TAGS.map((tag) => (
        <Chip key={tag} label={tag} selected={active === tag} onPress={() => onChange(active === tag ? null : tag)} />
      ))}
    </ScrollView>
  )
}

function Chip({ label, selected, onPress }) {
  if (selected) {
    return (
      <Pressable onPress={onPress} style={styles.chipActive} accessibilityRole="button" accessibilityState={{ selected: true }}>
        <Text style={styles.textActive}>{label}</Text>
      </Pressable>
    )
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: false }}>
      <GlassPanel radius={radii.pill}>
        <View style={styles.chip}>
          <Text style={styles.text}>{label}</Text>
        </View>
      </GlassPanel>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  wrap: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, alignItems: 'flex-start' },
  chip: { paddingHorizontal: 14, paddingVertical: 6 },
  chipActive: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.text,
  },
  text: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  textActive: { color: colors.ink, fontSize: 13, fontWeight: '600' },
})
