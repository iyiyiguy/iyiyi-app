import { Pressable, StyleSheet, View, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import Glass from './Glass'
import { colors } from '../theme'

const SIZES = {
  sm: { paddingHorizontal: 14, paddingVertical: 8, radius: 16, font: 13 },
  md: { paddingHorizontal: 18, paddingVertical: 12, radius: 20, font: 15 },
  lg: { paddingHorizontal: 22, paddingVertical: 15, radius: 24, font: 16 },
}

// Glass pill button. variant="primary" is the solid, high-contrast call to action
// (dark pill on light glass / light pill in dark mode) like the reference designs.
export const GlassButton = ({ onPress, children, style, tint, size = 'md', icon = null, disabled = false, variant = 'glass', textStyle }) => {
  const s = SIZES[size] ?? SIZES.md
  const primary = variant === 'primary'
  const press = () => {
    Haptics.selectionAsync().catch(() => {})
    onPress?.()
  }
  const content = (
    <View style={[styles.content, { paddingHorizontal: s.paddingHorizontal, paddingVertical: s.paddingVertical }]}>
      {icon ? <View style={{ marginRight: 8 }}>{icon}</View> : null}
      {typeof children === 'string'
        ? <Text style={[styles.text, { fontSize: s.font }, primary && styles.textPrimary, tint === 'dark' && !primary && styles.textOnDark, textStyle]}>{children}</Text>
        : children}
    </View>
  )
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }, style]}
    >
      {primary ? (
        <View style={[styles.primary, { borderRadius: s.radius }]}>{content}</View>
      ) : (
        <Glass radius={s.radius} scheme={tint === 'dark' ? 'dark' : 'auto'} interactive shadow={false}>
          {content}
        </Glass>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontWeight: '600' },
  textOnDark: { color: '#fff' },
  primary: { backgroundColor: colors.text },
  textPrimary: { color: colors.ink },
})

export default GlassButton
