import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { FONT, ST, StBar, stType, useStudioFonts, withAlpha } from '../games/studio'
import { useT } from '../i18n'
import strings from '../i18n/strings/arcadeMisc'

// Step-by-step "How to play" overlay in the studio look. Props: steps [{ icon, title,
// description }], onComplete(), gameTitle. Rendered absolutely over its parent.
// step.icon may be an Ionicons name, a chess piece glyph (drawn as a board piece) or one of
// the legacy emoji below (mapped to an Ionicon / colour tile), so no emoji reaches the UI.
const EMOJI_ICONS = {
  '⏱️': 'timer-outline', '⏱': 'timer-outline', '⚡': 'flash', '⚡️': 'flash', '🎮': 'game-controller',
  '🎯': 'locate', '🏆': 'trophy', '👆': 'hand-left', '🔪': 'moon', '🕷️': 'bug', '🎭': 'eye-off',
  '🪂': 'planet', '📝': 'text', '💬': 'chatbubble-ellipses', '🗳️': 'checkbox', '👀': 'eye',
}
// Wordle-style colour squares become flat colour tiles.
const SWATCHES = { '🟩': ST.health, '🟨': ST.objective, '⬛': '#3c434c', '⬜': '#d9dde3', '🟥': ST.enemy, '🟦': ST.friendly }
const CHESS = /^[♔-♟]/

function StepIcon({ icon }) {
  const raw = String(icon || '')
  const key = raw.replace(/︎/g, '')
  if (SWATCHES[key] || SWATCHES[raw]) {
    return <View style={[styles.swatch, { backgroundColor: SWATCHES[key] || SWATCHES[raw] }]} />
  }
  if (CHESS.test(key)) {
    // Text presentation (VS15) so iOS never swaps in the emoji pawn.
    return <Text style={styles.piece} allowFontScaling={false}>{`${key.replace(/️/g, '').charAt(0)}︎`}</Text>
  }
  const ion = EMOJI_ICONS[raw] || EMOJI_ICONS[key] || (/^[a-z][a-z0-9-]*$/.test(raw) ? raw : 'help-circle-outline')
  return <Ionicons name={ion} size={30} color={ST.friendly} />
}

export const GameTutorial = ({ steps, onComplete, gameTitle }) => {
  const t = useT(strings)
  useStudioFonts()
  const [currentStep, setCurrentStep] = useState(0)
  const list = Array.isArray(steps) && steps.length > 0 ? steps : [{ icon: 'game-controller', title: gameTitle || t('how_to_play'), description: '' }]
  const index = Math.min(currentStep, list.length - 1)
  const step = list[index]
  const isLast = index >= list.length - 1

  const next = () => (isLast ? onComplete() : setCurrentStep(index + 1))
  const back = () => setCurrentStep(Math.max(0, index - 1))

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop} />
      <View style={styles.card} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.gameTitle} numberOfLines={1}>{t('tut_header', { game: gameTitle })}</Text>
          <Pressable onPress={onComplete} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('skip_a11y')}>
            <Text style={styles.skipAll}>{t('skip')}</Text>
          </Pressable>
        </View>
        <StBar value={(index + 1) / list.length} height={3} />

        <View style={styles.stepContent}>
          <View style={styles.iconBox}><StepIcon icon={step.icon} /></View>
          <Text style={styles.stepNum}>{String(index + 1).padStart(2, '0')} / {String(list.length).padStart(2, '0')}</Text>
          <Text style={styles.stepTitle}>{step.title}</Text>
          {!!step.description && <Text style={styles.stepDescription}>{step.description}</Text>}
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={back}
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: index === 0 }}
            style={({ pressed }) => [styles.secondaryBtn, { opacity: index === 0 ? 0.4 : pressed ? 0.75 : 1 }]}
          >
            <Text style={styles.secondaryText}>{t('back')}</Text>
          </Pressable>
          <Pressable onPress={next} accessibilityRole="button" style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryText}>{isLast ? t('got_it') : t('next')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6,8,12,0.7)' },
  card: { width: '100%', maxWidth: 400, padding: 18, borderRadius: ST.radius, backgroundColor: ST.ground2, borderWidth: 1, borderColor: ST.line, borderTopWidth: 2, borderTopColor: ST.friendly },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 },
  gameTitle: { ...stType.kicker, fontSize: 10, letterSpacing: 2, flex: 1 },
  skipAll: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: ST.muted },
  stepContent: { alignItems: 'center', marginVertical: 16, minHeight: 170 },
  iconBox: { width: 64, height: 64, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: withAlpha(ST.friendly, 0.4), alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  swatch: { width: 30, height: 30, borderRadius: 2 },
  piece: { fontSize: 36, lineHeight: 42, color: ST.text },
  stepNum: { ...stType.label, fontVariant: ['tabular-nums'], marginBottom: 4 },
  stepTitle: { ...stType.title, fontSize: 20, textAlign: 'center', marginBottom: 8 },
  stepDescription: { ...stType.body, color: ST.muted, lineHeight: 20, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: { flex: 1, height: 48, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ST.lineStrong },
  secondaryText: { ...stType.button, fontSize: 14, color: ST.text },
  primaryBtn: { flex: 1.3, height: 48, borderRadius: ST.radius, alignItems: 'center', justifyContent: 'center', backgroundColor: ST.friendly },
  primaryText: { ...stType.button, fontSize: 14, color: ST.ink },
})
