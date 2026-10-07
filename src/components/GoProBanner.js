import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../theme'
import { Press } from '../lib/motion'
import useIsPro from '../lib/useIsPro'

// "Go Pro" entry point to the iYiYi Pro screen for free users. Hidden for paid users and
// while we don't know yet. `compact` is the pill used on My Profile; the default is the card
// used at the top of Nearby.
export default function GoProBanner({ navigation, compact = false, style }) {
  const isPro = useIsPro()
  if (isPro !== false) return null
  const open = () => navigation.navigate('Subscription')
  if (compact) {
    return (
      <Press onPress={open} style={[styles.pillWrap, style]} accessibilityLabel="Go Pro" haptic="light">
        <LinearGradient colors={['#ffd36b', '#e8b04b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
          <Ionicons name="star" size={15} color={colors.onGold} />
          <Text style={styles.pillText}>Go Pro · get seen first</Text>
        </LinearGradient>
      </Press>
    )
  }
  return (
    <Press onPress={open} style={[styles.cardWrap, style]} accessibilityLabel="Go Pro: get seen first" haptic="light">
      <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.star}>
          <Ionicons name="star" size={16} color={colors.onGold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Get seen first with iYiYi Pro</Text>
          <Text style={styles.cardText}>Show up ahead of free profiles nearby.</Text>
        </View>
        <Text style={styles.cardCta}>Go Pro</Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </LinearGradient>
    </Press>
  )
}

const styles = StyleSheet.create({
  pillWrap: { alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  pillText: { color: colors.onGold, fontWeight: '800', fontSize: 13 },
  cardWrap: { marginHorizontal: 16, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  star: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#ffd36b', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cardText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  cardCta: { color: '#fff', fontWeight: '800', fontSize: 13 },
})
