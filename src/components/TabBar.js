import { View, Text, StyleSheet, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { colors, gradients } from '../theme'
import Glass from './Glass'
import Bounce from './Bounce'
import { useT } from '../i18n'
import strings from '../i18n/strings/memberTabs'

// Five labelled tabs in a floating Liquid Glass pill: Here · Feed · Camera · Arcade · Me.
// "Here" is the Nearby route; its Map mode is the Map route and the old Discover tab
// (Recommended) redirects into it, so all three light up Here. The camera is the raised
// centre slot: it opens the Camera screen on top of everything (one tap from anywhere).
const TABS = [
  { name: 'Nearby', icon: 'people', label: 'here', also: ['Map', 'Recommended'] },
  { name: 'Feed', icon: 'albums', label: 'feed' },
  { name: 'Camera', camera: true, label: 'camera' },
  { name: 'Games', icon: 'game-controller', label: 'arcade' },
  { name: 'MyProfile', icon: 'person-circle', label: 'me' },
]

export default function TabBar({ state, navigation }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const dark = useColorScheme() === 'dark'
  const current = state.routes[state.index]?.name
  const openCamera = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    ;(navigation.getParent() ?? navigation).navigate('Camera')
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 6, 10) }]} pointerEvents="box-none">
      <Glass radius={30} style={styles.bar} interactive>
        <View style={styles.row} accessibilityRole="tablist">
          {TABS.map((tab) => {
            if (tab.camera) {
              return (
                <View key="camera" style={styles.cell}>
                <Bounce
                  scaleTo={0.9}
                  onPress={openCamera}
                  accessibilityRole="button"
                  accessibilityLabel={t('openCamera')}
                  hitSlop={4}
                  style={styles.slot}
                >
                  <LinearGradient colors={gradients.camera} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cameraDisc}>
                    <Ionicons name="camera" size={22} color="#151a2b" />
                  </LinearGradient>
                  <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(tab.label)}</Text>
                </Bounce>
                </View>
              )
            }
            if (!state.routes.some((r) => r.name === tab.name)) return null
            const focused = current === tab.name || (tab.also ?? []).includes(current)
            return (
              <View key={tab.name} style={styles.cell}>
              <Bounce
                scaleTo={0.88}
                accessibilityRole="tab"
                accessibilityLabel={t(tab.label)}
                accessibilityState={{ selected: focused }}
                hitSlop={4}
                onPress={() => {
                  if (!focused) Haptics.selectionAsync().catch(() => {})
                  navigation.navigate(tab.name)
                }}
                style={styles.slot}
              >
                <View style={[styles.iconPill, focused && (dark ? styles.activeDark : styles.activeLight)]}>
                  <Ionicons name={focused ? tab.icon : `${tab.icon}-outline`} size={22} color={focused ? colors.text : colors.textMuted} />
                </View>
                <Text
                  style={[styles.label, focused && styles.labelActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {t(tab.label)}
                </Text>
              </Bounce>
              </View>
            )
          })}
        </View>
      </Glass>
    </View>
  )
}

const styles = StyleSheet.create({
  // maxWidth: on desktop web / tablets the bar stays a compact dock instead of spanning the screen.
  wrap: { paddingHorizontal: 12, paddingTop: 6, width: '100%', maxWidth: 640, alignSelf: 'center' },
  bar: {},
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4 },
  // flex: 1 slots: at 360 dp each gets ~65 dp, enough for the longest labels at 11 pt
  // (adjustsFontSizeToFit shrinks the rare longer translation instead of clipping it).
  cell: { flex: 1, minWidth: 0 },
  slot: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 2 },
  iconPill: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  activeLight: { backgroundColor: 'rgba(255,255,255,0.75)' },
  activeDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  cameraDisc: {
    width: 40, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
  },
  label: { marginTop: 2, fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center', maxWidth: '100%' },
  labelActive: { color: colors.text, fontWeight: '700' },
})
