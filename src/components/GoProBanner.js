import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../theme'
import { Press } from '../lib/motion'
import useIsPro from '../lib/useIsPro'
import { useT } from '../i18n'
import strings from '../i18n/strings/goPro'

// "Go Pro" entry point to the iYiYi Pro screen for free users. Hidden for paid users and
// while we don't know yet. `compact` is the pill used on My Profile; the default is the card
// used at the top of Nearby.
export default function GoProBanner({ navigation, compact = false, style, showWhenPro = false }) {
  const isPro = useIsPro()
  const t = useT(strings)
  const open = () => navigation.navigate('Subscription')
  if (isPro === true && showWhenPro) {
    return (
      <Press onPress={open} style={[styles.cardWrap, style]} accessibilityLabel={t('manage_a11y')} haptic="selection">
        <LinearGradient colors={['#ffd36b', '#e8b04b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <Text style={styles.emoji}>⭐</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.onGold }]}>{t('pro_title')}</Text>
            <Text style={[styles.cardText, { color: 'rgba(13,7,16,0.75)' }]}>{t('pro_text')}</Text>
          </View>
          <Text style={[styles.cardCta, { color: colors.onGold }]}>{t('manage')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.onGold} />
        </LinearGradient>
      </Press>
    )
  }
  if (isPro !== false) return null
  if (compact) {
    return (
      <Press onPress={open} style={[styles.pillWrap, style]} accessibilityLabel={t('pill_a11y')} haptic="light">
        <LinearGradient colors={['#ffd36b', '#e8b04b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
          <Text style={styles.pillEmoji}>⭐</Text>
          <Text style={styles.pillText}>{t('pill')}</Text>
        </LinearGradient>
      </Press>
    )
  }
  // Home (Nearby): a big button with a gold star sitting on top of it.
  return (
    <Press onPress={open} style={[styles.btnWrap, style]} accessibilityLabel={t('card_a11y')} haptic="light" scaleTo={0.97}>
      <LinearGradient colors={['#6b7cff', '#8f5bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
        <Text style={styles.btnTitle}>{t('go_pro')}</Text>
        <Text style={styles.btnText} numberOfLines={2}>{t('card_text')}</Text>
        <View style={styles.btnCta}>
          <Text style={styles.btnCtaText}>{t('card_title')}</Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </View>
      </LinearGradient>
      {/* Tapping the star opens the paywall too (it's part of the same button). */}
      <LinearGradient colors={['#ffe08a', '#e8b04b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.topStar} pointerEvents="none">
        <Ionicons name="star" size={22} color="#fff" />
      </LinearGradient>
    </Press>
  )
}

const styles = StyleSheet.create({
  pillWrap: { alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  pillEmoji: { fontSize: 15 },
  emoji: { fontSize: 18 },
  pillText: { color: colors.onGold, fontWeight: '800', fontSize: 13 },
  cardWrap: { marginHorizontal: 16, marginBottom: 10 },
  btnWrap: { marginHorizontal: 16, marginBottom: 12, paddingTop: 22 }, // room for the star, inside the tap area
  btn: { alignItems: 'center', paddingTop: 26, paddingBottom: 14, paddingHorizontal: 18, borderRadius: 22, shadowColor: '#7b6cff', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  btnTitle: { color: '#fff', fontWeight: '900', fontSize: 20, letterSpacing: 0.5 },
  btnText: { color: 'rgba(255,255,255,0.88)', fontSize: 12.5, textAlign: 'center', marginTop: 3 },
  btnCta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  btnCtaText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  topStar: { position: 'absolute', top: 0, alignSelf: 'center', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#0c0f1a', shadowColor: '#ffb800', shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  star: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cardText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  cardCta: { color: '#fff', fontWeight: '800', fontSize: 13 },
})
