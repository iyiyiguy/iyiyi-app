import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { WordGame } from '../games/WordGame'
import { AC, ArcadeBackground, IconCircle, useArcadeInsets, useArcadeStatusBar } from '../games/arcadeUI'
import { loadArcadeStats } from '../lib/arcadeStats'
import { FONT, ST, stType } from '../games/studio'

// Route params (optional): { mode: 'daily' } opens straight into today's daily word.
export default function WordRaceScreen({ navigation, route }) {
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
        initialMode={route?.params?.mode === 'daily' ? 'daily' : undefined}
        withBackground={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ST.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8 },
  kicker: { ...stType.kicker, fontSize: 10, letterSpacing: 2, color: ST.health },
  title: { fontFamily: FONT.display, fontSize: 20, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', includeFontPadding: false },
  best: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 32, borderRadius: ST.radius,
    backgroundColor: ST.panelStrong, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.objective,
  },
  bestText: { fontFamily: FONT.display, fontSize: 14, color: ST.objective, fontVariant: ['tabular-nums'], includeFontPadding: false },
})
