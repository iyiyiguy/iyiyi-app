import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader from '../components/BrandHeader'
import { colors, type } from '../theme'

export default function AirdropScreen() {
  return (
    <View style={styles.screen}>
      <BrandHeader title="Airdrop" />
      <View style={styles.body}>
        <LinearGradient
          colors={['#ffd166', '#ef476f', '#e0158b']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.balloonWrap}
        >
          <Text style={styles.balloon}>🎈</Text>
          <Text style={styles.gift}>🎁</Text>
        </LinearGradient>

        <Text style={[type.display, styles.title]}>Airdrops are coming!</Text>
        <Text style={[type.caption, styles.subtitle]}>
          Soon you'll be able to meet up with people nearby and score weekly drops just for
          showing up. Stay tuned — we're figuring out the fun details.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  balloonWrap: {
    width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center',
    marginBottom: 28,
  },
  balloon: { fontSize: 72, position: 'absolute', top: 10 },
  gift: { fontSize: 40, position: 'absolute', bottom: 28 },
  title: { textAlign: 'center', marginBottom: 12 },
  subtitle: { textAlign: 'center', lineHeight: 20 },
})
