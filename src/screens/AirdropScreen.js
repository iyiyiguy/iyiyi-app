import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import BrandHeader from '../components/BrandHeader'
import { type } from '../theme'
import { useT } from '../i18n'
import strings from '../i18n/strings/arcadeMisc'

// Teaser only (nothing links here yet). Called "Weekly drops", not "Airdrop", to avoid crypto
// connotations in review; has a Back button so a deep link never strands anyone.
export default function AirdropScreen({ navigation }) {
  const t = useT(strings)
  const goBack = () => (navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('Tabs'))
  return (
    <View style={styles.screen}>
      <BrandHeader title={t('drops_title')} onBack={goBack} />
      <View style={styles.body}>
        <LinearGradient
          colors={['#ffd166', '#ef476f', '#e0158b']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.balloonWrap}
        >
          <Text style={styles.balloon}>🎈</Text>
          <Text style={styles.gift}>🎁</Text>
        </LinearGradient>

        <Text style={[type.display, styles.title]}>{t('drops_head')}</Text>
        <Text style={[type.caption, styles.subtitle]}>
          {t('drops_sub')}
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
