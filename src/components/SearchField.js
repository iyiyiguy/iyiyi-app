import { View, TextInput, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, font, radii } from '../theme'
import GlassPanel from './GlassPanel'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// Glass search pill with a magnifier and a clear button.
export default function SearchField({ value, onChangeText, placeholder, onSubmitEditing, style, returnKeyType = 'search', autoCapitalize = 'none' }) {
  const t = useT(strings)
  return (
    <GlassPanel radius={radii.pill} animateIn={false} style={style}>
      <View style={styles.row}>
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          style={styles.input}
          placeholder={placeholder ?? t('search')}
          accessibilityLabel={placeholder ?? t('search')}
          placeholderTextColor={colors.textFaint}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          returnKeyType={returnKeyType}
          clearButtonMode="never"
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
        />
        {value ? (
          <Pressable onPress={() => onChangeText?.('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('clearSearch')}>
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
    </GlassPanel>
  )
}

const styles = StyleSheet.create({
  row: { height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, ...font.regular, color: colors.text, paddingVertical: 0 },
})
