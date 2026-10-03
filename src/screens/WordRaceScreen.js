import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { WordGame } from '../games/WordGame'
import { AC, ArcadeBackground, IconCircle, useArcadeInsets, useArcadeStatusBar } from '../games/arcadeUI'
import { loadArcadeStats } from '../lib/arcadeStats'
import { font } from '../theme'

export default function WordRaceScreen({ navigation }) {
  useArcadeStatusBar()
  const insets = useArcadeInsets()
  const [best, setBest] = useState(null)

  useFocusEffect(useCallback(() => {
    let alive = true
    loadArcadeStats().then((s) => { if (alive) setBest(s.games['word-race']?.bestScore ?? null) }).catch(() => {})
    return () => { alive = false }
  }, []))

  return (
    <View style={styles.screen}>
      <ArcadeBackground />
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
        <IconCircle icon="chevron-back" label="Back" onPress={() => navigation.goBack()} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.kicker} numberOfLines={1}>ARCADE · PUZZLE</Text>
          <Text style={styles.title} numberOfLines={1}>What's The Word</Text>
        </View>
        {best != null ? (
          <View style={styles.best} accessibilityLabel={`Best score ${best}`}>
            <Ionicons name="trophy" size={12} color={AC.gold} />
            <Text style={styles.bestText}>{best.toLocaleString()}</Text>
          </View>
        ) : null}
      </View>
      <WordGame
        onExit={() => navigation.goBack()}
        onRecorded={(r) => { if (r.isNewBest && r.score > 0) setBest(r.score) }}
        bottomInset={insets.bottom}
        withBackground={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#04050d' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 6 },
  kicker: { fontSize: 10, ...font.heavy, color: '#3ee596', letterSpacing: 1.6 },
  title: { fontSize: 20, ...font.heavy, color: AC.text, letterSpacing: -0.4 },
  best: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,201,77,0.12)', borderWidth: 1, borderColor: 'rgba(255,201,77,0.3)',
  },
  bestText: { fontSize: 13, ...font.heavy, color: AC.gold, fontVariant: ['tabular-nums'] },
})
