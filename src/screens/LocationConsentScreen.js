import { View, Text, Pressable, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type } from '../theme'

export default function LocationConsentScreen({ onContinue }) {
  return (
    <View style={styles.screen}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={styles.pin}>📍</Text>
        <Text style={type.display}>Your location, used carefully</Text>
        <Text style={[type.caption, { marginTop: 12, lineHeight: 20 }]}>
          iYiYi uses your location only to detect other users nearby and show your nametag to
          them within your chosen range (150ft by default). Your exact coordinates are never
          shown to other users — only your profile and approximate distance.
        </Text>
        <Text style={[type.caption, { marginTop: 12, lineHeight: 20 }]}>
          You can hide yourself any time: go to My Profile → Profile Privacy, choose "Ghost" and
          tap Save Changes. You'll still be able to see people around you, but you won't show up
          in Nearby, Recommended or the Map.
        </Text>
      </View>

      <View style={{ padding: 24 }}>
        <Pressable onPress={onContinue}>
          <LinearGradient colors={gradients.brand} style={styles.button}>
            <Text style={styles.buttonText}>Continue</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  pin: { fontSize: 40, marginBottom: 16 },
  button: { paddingVertical: 16, borderRadius: radii.pill, alignItems: 'center' },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 16 },
})
