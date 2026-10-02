import { useState } from 'react'
import { View, Text, Modal, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native'
import { colors, radii, type } from '../theme'
import { parseDay } from '../lib/exportPeople'
import GlassPanel from './GlassPanel'

const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom dates' },
]

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function Chip({ active, label, onPress }) {
  if (active) {
    return (
      <Pressable onPress={onPress} style={styles.chipActive}>
        <Text style={styles.chipTextActive}>{label}</Text>
      </Pressable>
    )
  }
  return (
    <Pressable onPress={onPress}>
      <GlassPanel radius={radii.pill}>
        <View style={styles.chip}><Text style={styles.chipText}>{label}</Text></View>
      </GlassPanel>
    </Pressable>
  )
}

// Choose a date range, a format (PDF or Excel/CSV) and where it goes (email to yourself
// with the file attached, or the share sheet). onExport receives the ready options.
export default function ExportSheet({ visible, onClose, onExport, busy }) {
  const [range, setRange] = useState('all')
  const [format, setFormat] = useState('pdf')
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [error, setError] = useState('')

  const go = (method) => {
    let from = null
    let to = null
    if (range === 'today') from = daysAgo(0)
    else if (range === '7') from = daysAgo(7)
    else if (range === '30') from = daysAgo(30)
    else if (range === 'custom') {
      from = parseDay(fromText, false)
      to = parseDay(toText, true)
      if (from === undefined || to === undefined) return setError('Use dates like 2026-09-01.')
      if (!from && !to) return setError('Enter a start date, an end date, or both.')
      if (from && to && from > to) return setError('The start date must be before the end date.')
    }
    setError('')
    onExport({ format, from, to, method })
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={type.title}>Export contacts</Text>
        <Text style={[type.caption, { marginBottom: 14 }]}>People you crossed paths with, with their photo and social links.</Text>

        <Text style={styles.label}>Date range</Text>
        <View style={styles.row}>
          {RANGES.map((r) => <Chip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />)}
        </View>
        {range === 'custom' && (
          <View style={styles.dates}>
            <GlassPanel radius={12} style={{ flex: 1 }}>
              <TextInput style={styles.input} value={fromText} onChangeText={setFromText} placeholder="From 2026-09-01" placeholderTextColor={colors.textFaint} autoCapitalize="none" />
            </GlassPanel>
            <GlassPanel radius={12} style={{ flex: 1 }}>
              <TextInput style={styles.input} value={toText} onChangeText={setToText} placeholder="To 2026-09-30" placeholderTextColor={colors.textFaint} autoCapitalize="none" />
            </GlassPanel>
          </View>
        )}

        <Text style={styles.label}>Format</Text>
        <View style={styles.row}>
          <Chip label="PDF" active={format === 'pdf'} onPress={() => setFormat('pdf')} />
          <Chip label="Excel (CSV)" active={format === 'csv'} onPress={() => setFormat('csv')} />
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        {busy ? (
          <ActivityIndicator color={colors.magenta} style={{ marginTop: 20 }} />
        ) : (
          <View style={{ gap: 10, marginTop: 20 }}>
            <Pressable style={styles.primary} onPress={() => go('email')}>
              <Text style={styles.primaryText}>Email to myself</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={() => go('share')}>
              <Text style={styles.secondaryText}>Share or save…</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={8} style={{ alignItems: 'center', padding: 6 }}>
              <Text style={type.caption}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.ink, padding: 22, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.text },
  chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  dates: { flexDirection: 'row', gap: 10, marginTop: 10 },
  input: { padding: 12, color: colors.text },
  error: { color: '#e5484d', marginTop: 10, fontSize: 13 },
  primary: { backgroundColor: colors.magenta, paddingVertical: 14, borderRadius: radii.pill, alignItems: 'center' },
  primaryText: { color: colors.onBrand, fontWeight: '700', fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.magenta, paddingVertical: 13, borderRadius: radii.pill, alignItems: 'center' },
  secondaryText: { color: colors.magenta, fontWeight: '700', fontSize: 15 },
})
