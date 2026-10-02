import { View, TextInput, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, font, radii } from '../theme'
import GlassPanel from './GlassPanel'

// Glass search pill with a magnifier and a clear button.
export default function SearchField({ value, onChangeText, placeholder = 'Search', onSubmitEditing, style, returnKeyType = 'search', autoCapitalize = 'none' }) {
  return (
    <GlassPanel radius={radii.pill} animateIn={false} style={style}>
      <View style={styles.row}>
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
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
          <Pressable onPress={() => onChangeText?.('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
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
