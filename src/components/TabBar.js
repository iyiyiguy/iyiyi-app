import { View, Pressable, StyleSheet, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors } from '../theme'
import Glass from './Glass'
import Bounce from './Bounce'
import { useT } from '../i18n'
import strings from '../i18n/strings/tabs'

// Tabs shown in the floating glass pill (label = key in strings/tabs.js). Subscription is still a tab route (reachable from
// Settings → iYiYi Pro) but isn't in the bar. Settings lives under Profile (Edit Profile), to keep it uncluttered.
const TABS = [
  { name: 'Nearby', icon: 'home', label: 'home' },
  { name: 'Recommended', icon: 'sparkles', label: 'discover' },
  { name: 'Map', icon: 'map', label: 'map' },
  { name: 'Feed', icon: 'albums', label: 'feed' },
  { name: 'Games', icon: 'game-controller', label: 'arcade' },
  { name: 'MyProfile', icon: 'person-circle', label: 'profile' },
]

// A floating Liquid Glass pill like the iOS 26 tab bar, with the camera as its own round
// glass button beside it - one tap away from anywhere.
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
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 6, 12) }]} pointerEvents="box-none">
      <Glass radius={32} style={styles.bar} interactive>
        <View style={styles.row}>
          {TABS.filter((tab) => state.routes.some((r) => r.name === tab.name)).map((tab) => {
            const focused = current === tab.name
            return (
              <Bounce
                key={tab.name}
                scaleTo={0.86}
                accessibilityRole="tab"
                accessibilityLabel={t(tab.label)}
                accessibilityState={{ selected: focused }}
                hitSlop={4}
                onPress={() => {
                  if (!focused) Haptics.selectionAsync().catch(() => {})
                  navigation.navigate(tab.name)
                }}
                style={[styles.tab, focused && (dark ? styles.tabActiveDark : styles.tabActiveLight)]}
              >
                <Ionicons
                  name={focused ? tab.icon : `${tab.icon}-outline`}
                  size={22}
                  color={focused ? colors.text : colors.textMuted}
                />
              </Bounce>
            )
          })}
        </View>
      </Glass>
      <Pressable
        onPress={openCamera}
        accessibilityRole="button"
        accessibilityLabel={t('openCamera')}
        style={({ pressed }) => [pressed && { transform: [{ scale: 0.92 }] }]}
      >
        <Glass radius={30} style={styles.camera} interactive>
          <View style={styles.cameraInner}>
            <Ionicons name="camera" size={24} color={colors.text} />
          </View>
        </Glass>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 10 },
  bar: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 8 },
  tab: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tabActiveLight: { backgroundColor: 'rgba(255,255,255,0.75)' },
  tabActiveDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  camera: { width: 60, height: 60 },
  cameraInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
