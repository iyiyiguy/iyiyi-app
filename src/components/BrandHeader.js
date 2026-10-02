import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type } from '../theme'
import Glass from './Glass'

// Open, airy header in the style of the glass redesign: no bar, just a large title (and an
// optional lighter subtitle) sitting on the aura, with round glass buttons.
// onBack renders a glass back button wired to navigation.goBack(). Every stack screen (not
// just tabs) should pass this - web has no OS back gesture, so without it a screen is a dead end.
export default function BrandHeader({ title, subtitle, onBack, right }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {onBack ? <HeaderButton icon="chevron-back" onPress={onBack} label="Back" /> : null}
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  )
}

// Round glass icon button (Ionicons name) for header actions.
export function HeaderButton({ icon, onPress, label, badge, size = 42 }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.92 }] }]}
    >
      <Glass radius={size / 2} style={{ width: size, height: size }} interactive shadow={false}>
        <View style={styles.iconCenter}>
          <Ionicons name={icon} size={size * 0.48} color={colors.text} />
        </View>
      </Glass>
      {badge ? <View style={styles.badge} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 10, paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...type.display, fontSize: 30, letterSpacing: -0.6, color: colors.text },
  subtitle: { fontSize: 17, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  iconCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
})
