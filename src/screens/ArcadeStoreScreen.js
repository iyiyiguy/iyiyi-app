// Arcade Store: real-money UAV packs (consumable IAPs) for Laser Tag + Battle Royale.
// Weapons stay in the Shop (coins only). The same store body is used in-match as a sheet
// (games/laser/Uav.js → UavSheet).
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import {
  AC, ArcadeBackground, ArcadeHeader, CoinPill, StatusBarScrim, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { SatelliteArt, UavStorePanel } from '../games/UavStore'
import { useUavInventory } from '../lib/uav'
import { useEffect, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { font } from '../theme'

export default function ArcadeStoreScreen({ navigation }) {
  const insets = useArcadeInsets()
  useArcadeStatusBar()
  const uav = useUavInventory()
  const [coins, setCoins] = useState(null)
  useEffect(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setCoins(s?.points ?? 0) }).catch(() => {})
    const off = subscribeArcadeStats((s) => { if (alive) setCoins(s?.points ?? 0) })
    return () => { alive = false; off() }
  }, [])

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <ArcadeHeader
          kicker="Arcade"
          title="Store"
          onBack={() => (navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('Tabs'))}
          right={<CoinPill value={coins} compact onPress={() => navigation?.navigate?.('GunShop')} />}
        />

        <LinearGradient colors={['#2a1650', '#14183a', '#0a0c1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroGlow} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroKicker}>LASER TAG · BATTLE ROYALE</Text>
            <Text style={styles.heroTitle}>UAV Recon</Text>
            <Text style={styles.heroSub}>See every enemy on your map for 15 seconds. Call one in when it counts.</Text>
          </View>
          <SatelliteArt size={108} accent="#ff5d8a" glow="rgba(255,46,99,0.5)" />
        </LinearGradient>

        <UavStorePanel variant="screen" balance={uav.balance} owner={uav.owner} />
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AC.bg[0] },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, borderRadius: 26, marginTop: 18, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  heroGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, right: -80, top: -90, backgroundColor: 'rgba(255,46,99,0.18)' },
  heroKicker: { fontSize: 10, ...font.heavy, color: AC.hot, letterSpacing: 1.6 },
  heroTitle: { fontSize: 28, ...font.heavy, color: AC.text, letterSpacing: -0.6, marginTop: 4 },
  heroSub: { fontSize: 13, color: AC.muted, marginTop: 6, lineHeight: 18 },
})
