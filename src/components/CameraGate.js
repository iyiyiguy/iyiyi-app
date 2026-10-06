import { useEffect, useRef } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import { colors, type } from '../theme'
import Glass from './Glass'

// Camera permission the way App Review wants it (guideline 5.1.1): no custom "Allow / Not now"
// screen nudging people toward Allow. The system prompt is shown straight away the first time a
// camera feature opens, and if access is off we just say so and link to Settings.
//
// useCameraGate(): same tuple as useCameraPermissions, but it fires the system prompt itself
// once while the permission is still undetermined.
export function useCameraGate(active = true) {
  const [perm, request] = useCameraPermissions()
  const asked = useRef(false)
  useEffect(() => {
    if (!active || !perm || perm.granted || asked.current) return
    if (perm.status === 'undetermined' || perm.canAskAgain) {
      asked.current = true
      request().catch(() => {})
    }
  }, [active, perm, request])
  return [perm, request]
}

// What to render while the camera can't be used. Neutral copy, Settings link, and a way out.
export function CameraOff({ what = 'this feature', onBack, backLabel = 'Back', dark = true, compact = false }) {
  const fg = dark ? '#fff' : colors.text
  const muted = dark ? 'rgba(255,255,255,0.72)' : colors.textMuted
  const body = (
    <View style={[styles.inner, compact && { paddingVertical: 18 }]}>
      <View style={[styles.iconWrap, { backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(79,99,232,0.12)' }]}>
        <Ionicons name="camera-outline" size={26} color={fg} />
      </View>
      <Text style={[type.title, { color: fg, textAlign: 'center', marginTop: 12 }]}>Camera access is off</Text>
      <Text style={[type.body, { color: muted, textAlign: 'center', marginTop: 8, lineHeight: 21 }]}>
        iYiYi uses the camera for {what}. You can turn camera access on or off any time in Settings.
      </Text>
      <Pressable
        onPress={() => Linking.openSettings().catch(() => {})}
        accessibilityRole="button"
        style={({ pressed }) => [styles.settingsBtn, { backgroundColor: dark ? '#fff' : colors.text }, pressed && styles.pressed]}
      >
        <Text style={[styles.settingsText, { color: dark ? '#111' : colors.ink }]}>Open Settings</Text>
      </Pressable>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
          <Text style={[type.body, { color: muted, fontWeight: '600' }]}>{backLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
  if (compact) return body
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Glass radius={28} scheme={dark ? 'dark' : 'auto'} strong style={styles.card}>{body}</Glass>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360 },
  inner: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 26 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  settingsBtn: { marginTop: 18, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999, minWidth: 180, alignItems: 'center' },
  settingsText: { fontSize: 16, fontWeight: '700' },
  backBtn: { marginTop: 6, paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
})

export const isSettingsLinkSupported = Platform.OS !== 'web'
