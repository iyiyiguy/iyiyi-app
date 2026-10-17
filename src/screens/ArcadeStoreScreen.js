// Arcade Store: real-money UAV packs (consumable IAPs) for Laser Tag + Battle Royale.
// Weapons and explosives are in the Shop (GunShopScreen). The same store body is used
// in-match as a sheet (games/laser/Uav.js → UavSheet). UAV use is capped per match
// (lib/uav.js UAV_RULES_TEXT), and the copy says so.
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import {
  ArcadeBackground, ArcadeHeader, CoinPill, StatusBarScrim, useArcadeInsets, useArcadeStatusBar,
} from '../games/arcadeUI'
import { SatelliteArt, UavStorePanel } from '../games/UavStore'
import { UAV_DURATION_MS, useUavInventory } from '../lib/uav'
import { useEffect, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats } from '../lib/arcadeStats'
import { FONT, ST, stType } from '../games/studio'
import { useT } from '../i18n'
import strings from '../i18n/strings/arcadeMisc'

export default function ArcadeStoreScreen({ navigation }) {
  const t = useT(strings)
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
          kicker={t('store_kicker')}
          title={t('store_title')}
          onBack={() => (navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('Tabs'))}
          right={<CoinPill value={coins} compact onPress={() => navigation?.navigate?.('GunShop')} />}
        />

        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroKicker}>LASER TAG · BATTLE ROYALE</Text>
            <Text style={styles.heroTitle}>{t('uav_title')}</Text>
            <Text style={styles.heroSub}>{t('uav_sub', { n: Math.round(UAV_DURATION_MS / 1000) })}</Text>
          </View>
          <SatelliteArt size={108} accent={ST.enemy} glow="rgba(255,61,82,0.35)" />
        </View>

        <UavStorePanel variant="screen" balance={uav.balance} owner={uav.owner} />
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: ST.radius, marginTop: 18, marginBottom: 18, backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.enemy, overflow: 'hidden' },
  heroKicker: { ...stType.kicker, fontSize: 10, letterSpacing: 2, color: ST.enemy },
  heroTitle: { fontFamily: FONT.display, fontSize: 26, letterSpacing: 1.2, color: ST.text, textTransform: 'uppercase', marginTop: 4, includeFontPadding: false },
  heroSub: { ...stType.small, fontSize: 13, lineHeight: 18, marginTop: 6 },
})
