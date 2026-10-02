import { useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, Modal, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, font, radii, type } from '../theme'
import { searchCountries, countryByCode } from '../lib/countries'
import SearchField from './SearchField'

// Searchable country list with flags, as a bottom sheet. Shared by Feed and Map.
//
//   import CountryPicker from '../components/CountryPicker'
//   <CountryPicker
//     visible={open}
//     value={countryCode}               // ISO alpha-2 or null
//     onSelect={(country) => ...}       // { code, name, flag }, or null for "All countries"
//     onClose={() => setOpen(false)}
//     allowAll                          // optional: show an "All countries" row (selects null)
//     title="Choose a country"          // optional
//   />
export default function CountryPicker({ visible, value, onSelect, onClose, allowAll = false, title = 'Choose a country' }) {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  useEffect(() => { if (visible) setQuery('') }, [visible])

  const selected = value ? countryByCode(value) : null
  const data = useMemo(() => {
    const list = searchCountries(query)
    // Keep the current pick at the top when not searching.
    if (!query && selected) return [selected, ...list.filter((c) => c.code !== selected.code)]
    return list
  }, [query, selected])

  const pick = (c) => {
    Haptics.selectionAsync().catch(() => {})
    onSelect?.(c)
    onClose?.()
  }

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={type.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close-circle" size={26} color={colors.textFaint} />
            </Pressable>
          </View>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search countries" style={styles.search} autoCapitalize="words" />
          <FlatList
            data={data}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={20}
            ListHeaderComponent={allowAll && !query ? (
              <Row flag="🌐" name="All countries" selected={!selected} onPress={() => pick(null)} />
            ) : null}
            renderItem={({ item }) => (
              <Row flag={item.flag} name={item.name} code={item.code} selected={selected?.code === item.code} onPress={() => pick(item)} />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No country matches “{query}”.</Text>}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function Row({ flag, name, code, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hairline }]}
    >
      <Text style={styles.flag}>{flag || '🏳️'}</Text>
      <Text style={[styles.name, selected && { ...font.semibold }]} numberOfLines={1}>{name}</Text>
      {code ? <Text style={styles.code}>{code}</Text> : null}
      {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : <View style={{ width: 20 }} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    height: '78%', backgroundColor: colors.inkSurface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.hairline, marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  search: { marginHorizontal: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 50, paddingHorizontal: 20 },
  flag: { fontSize: 24, width: 32, textAlign: 'center' },
  name: { flex: 1, fontSize: 16, ...font.regular, color: colors.text },
  code: { fontSize: 12, ...font.semibold, color: colors.textFaint, letterSpacing: 0.5 },
  empty: { ...type.caption, textAlign: 'center', marginTop: 40 },
})
