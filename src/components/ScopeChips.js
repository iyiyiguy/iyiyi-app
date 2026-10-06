import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { colors, font, radii } from '../theme'
import GlassPanel from './GlassPanel'
import ScrollArrows from './ScrollArrows'

// Distance ranges shared by Nearby / Recommended / Feed. Keys are what the API expects;
// 'global' is shown as "International".
export const SCOPES = [
  { key: 'local', label: '150 ft' },
  { key: 'regional', label: '5 mi' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'national', label: 'Nationwide' },
  { key: 'global', label: 'International' },
]

export const scopeLabel = (key) => SCOPES.find((s) => s.key === key)?.label ?? ''

// Horizontally scrolling chip row with left/right arrows when chips are offscreen. The
// selected chip is scrolled into view automatically.
//   options   [{ key, label }]  (defaults to SCOPES)
//   value     selected key
//   onChange  (key) => void
// An option may also carry `icon` (Ionicons name, shown before the label), `chevron: true`
// (a small down-arrow after it, for chips that open a menu) and `onPress` (runs instead of
// onChange, also when already selected).
function ChipLabel({ option, active }) {
  const color = active ? colors.ink : colors.textMuted
  return (
    <View style={styles.chipLabel}>
      {option.icon ? <Ionicons name={option.icon} size={14} color={color} /> : null}
      <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>{option.label}</Text>
      {option.chevron ? <Ionicons name="chevron-down" size={12} color={color} /> : null}
    </View>
  )
}

export default function ScopeChips({ options = SCOPES, value, onChange, style }) {
  const scrollRef = useRef(null)
  const positions = useRef({})

  useEffect(() => {
    const p = positions.current[value]
    if (p) scrollRef.current?.scrollTo?.({ x: Math.max(0, p.x - 48), animated: true })
  }, [value])

  return (
    <ScrollArrows scrollRef={scrollRef} style={style} contentContainerStyle={styles.bar}>
      {options.map((s) => {
        const active = value === s.key
        return (
          <Pressable
            key={s.key}
            onLayout={(e) => { positions.current[s.key] = e.nativeEvent?.layout }}
            onPress={() => {
              // An option with its own onPress (e.g. "Country", which opens a picker) runs it
              // even when already selected, so the user can change their pick.
              if (typeof s.onPress === 'function') {
                Haptics.selectionAsync().catch(() => {})
                s.onPress()
                return
              }
              if (active) return
              Haptics.selectionAsync().catch(() => {})
              onChange?.(s.key)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
          >
            {active ? (
              <View style={[styles.chip, styles.chipActive]}>
                <ChipLabel option={s} active />
              </View>
            ) : (
              <GlassPanel radius={radii.pill} animateIn={false} lite>
                <View style={styles.chip}>
                  <ChipLabel option={s} />
                </View>
              </GlassPanel>
            )}
          </Pressable>
        )
      })}
    </ScrollArrows>
  )
}

// Compact segmented control (e.g. For You / Recent / Popular).
export function Segmented({ options, value, onChange, style }) {
  return (
    <GlassPanel radius={radii.pill} animateIn={false} style={style}>
      <View style={styles.segTrack}>
        {options.map((o) => {
          const active = o.key === value
          return (
            <Pressable
              key={o.key}
              onPress={() => {
                if (active) return
                Haptics.selectionAsync().catch(() => {})
                onChange?.(o.key)
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.seg, active && styles.segActive]}
            >
              <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </GlassPanel>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: 'center' },
  chip: { height: 34, paddingHorizontal: 15, justifyContent: 'center', borderRadius: radii.pill },
  chipActive: { backgroundColor: colors.text },
  chipLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 200 },
  text: { fontSize: 14, ...font.semibold, color: colors.textMuted },
  textActive: { color: colors.ink },
  segTrack: { flexDirection: 'row', padding: 3 },
  seg: { flex: 1, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segActive: { backgroundColor: colors.text },
  segText: { fontSize: 13, ...font.semibold, color: colors.textMuted },
  segTextActive: { color: colors.ink },
})
