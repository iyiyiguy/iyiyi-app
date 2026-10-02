import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'

// Step-by-step "How to play" overlay. Props: steps [{ icon, title, description }],
// onComplete(), gameTitle. Rendered absolutely over its parent.
export const GameTutorial = ({ steps, onComplete, gameTitle }) => {
  const [currentStep, setCurrentStep] = useState(0)
  const list = Array.isArray(steps) && steps.length > 0 ? steps : [{ icon: '🎮', title: gameTitle || 'How to play', description: '' }]
  const index = Math.min(currentStep, list.length - 1)
  const step = list[index]
  const isLast = index >= list.length - 1

  const next = () => (isLast ? onComplete() : setCurrentStep(index + 1))
  const back = () => setCurrentStep(Math.max(0, index - 1))

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <GlassPanel strong style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.gameTitle} numberOfLines={1}>{gameTitle} · How to play</Text>
          <Pressable onPress={onComplete} hitSlop={10} accessibilityRole="button">
            <Text style={styles.skipAll}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.stepContent}>
          <Text style={styles.stepIcon}>{step.icon}</Text>
          <Text style={styles.stepTitle}>{step.title}</Text>
          {!!step.description && <Text style={styles.stepDescription}>{step.description}</Text>}
        </View>

        <View style={styles.dots}>
          {list.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={back}
            disabled={index === 0}
            style={({ pressed }) => [styles.secondaryBtn, { opacity: index === 0 ? 0.4 : pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          <Pressable onPress={next} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryText}>{isLast ? 'Got it' : 'Next'}</Text>
          </Pressable>
        </View>
      </GlassPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: { width: '100%', maxWidth: 400, padding: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  gameTitle: { ...type.label, flex: 1 },
  skipAll: { ...type.body, color: colors.textMuted, fontWeight: '700' },
  stepContent: { alignItems: 'center', marginVertical: 12, minHeight: 150 },
  stepIcon: { fontSize: 52, marginBottom: 10 },
  stepTitle: { ...type.title, textAlign: 'center', marginBottom: 8 },
  stepDescription: { ...type.body, color: colors.textMuted, lineHeight: 21, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.magenta, width: 18 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  secondaryBtn: { flex: 1, paddingVertical: 13, borderRadius: radii.pill, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  secondaryText: { ...type.body, fontWeight: '700' },
  primaryBtn: { flex: 1, paddingVertical: 13, borderRadius: radii.pill, alignItems: 'center', backgroundColor: colors.magenta },
  primaryText: { ...type.body, color: colors.onBrand, fontWeight: '800' },
})
