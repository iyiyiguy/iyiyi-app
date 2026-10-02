import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import Glass from '../Glass'
import { MODE_ACTIVE_COLOR } from './ModeSwitcher'
import {
  BURST_CHOICES, CUTOFF_CHOICES, DEFAULT_BURST_SHOTS, CUTOFF_RANGE, DEFAULT_CUTOFF_CUSTOM, DEFAULT_TIMER_CUSTOM, TIMER_CHOICES, TIMER_RANGE, clampSeconds,
} from '../../lib/cameraPrefs'
import { FILTERS, filterLabel, normalizeFilter } from '../../lib/cameraFilters'

const tap = () => Haptics.selectionAsync().catch(() => {})

// 0 -> Off, 45 -> 45s, 120 -> 2m, 90 -> 1m30s
const fmtSeconds = (s) => {
  const n = Number(s) || 0
  if (!n) return 'Off'
  if (n < 60) return `${n}s`
  const m = Math.floor(n / 60)
  const r = n % 60
  return r ? `${m}m${r}s` : `${m}m`
}
const fmtShots = (n) => (n ? `×${n}` : 'Off')
// Cut-off: 0 means no cut-off at all - record until you stop.
const fmtCutoff = (s) => (Number(s) ? fmtSeconds(s) : '∞')
const fmtCutoffLong = (s) => (Number(s) ? fmtSeconds(s) : 'Unlimited')

// `custom` options also take any length in `range` (a stepper behind the Custom chip),
// remembered in options[customKey].
const OPTION_DEFS = {
  timer: { icon: 'timer-outline', label: 'Countdown', choices: TIMER_CHOICES, fmt: fmtSeconds, range: TIMER_RANGE, customKey: 'timerCustom', customDefault: DEFAULT_TIMER_CUSTOM },
  burst: { icon: 'albums-outline', label: 'Burst', choices: BURST_CHOICES, fmt: fmtShots },
  cutoff: {
    icon: 'stopwatch-outline', label: 'Video cut-off', choices: CUTOFF_CHOICES, fmt: fmtCutoff, longFmt: fmtCutoffLong,
    range: CUTOFF_RANGE, customKey: 'cutoffCustom', customDefault: DEFAULT_CUTOFF_CUSTOM,
  },
}
const FILTER_DEF = { icon: 'sparkles-outline', label: 'Filter' }
const longOf = (def, v) => (def.longFmt ? def.longFmt(v) : def.fmt(v))

// Bigger jumps for the longer cut-off once you get past a minute.
const stepFor = (range, value, dir) => {
  if (range.max <= 60) return range.step
  if (dir > 0 ? value >= 60 : value > 60) return 15
  return range.step
}

// − value + stepper. Holding a button keeps stepping (and speeds up).
function Stepper({ value, range, fmt, label, onChange }) {
  const valueRef = useRef(value)
  valueRef.current = value
  const timer = useRef(null)
  const ticks = useRef(0)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    ticks.current = 0
  }
  useEffect(() => stop, [])

  const step = (dir) => {
    const cur = valueRef.current
    let next = cur + dir * stepFor(range, cur, dir)
    // Snap onto the step grid when crossing into the coarse steps.
    const sz = stepFor(range, next, dir)
    if (sz > range.step) next = dir > 0 ? Math.ceil(next / sz) * sz : Math.floor(next / sz) * sz
    next = clampSeconds(next, range, cur) || range.min
    if (next !== cur) {
      valueRef.current = next
      tap()
      onChange(next)
      return true
    }
    return false
  }
  const startHold = (dir) => {
    stop()
    const loop = () => {
      ticks.current += 1
      if (!step(dir)) { stop(); return }
      timer.current = setTimeout(loop, ticks.current > 8 ? 60 : 140)
    }
    loop()
  }

  const atMin = value <= range.min
  const atMax = value >= range.max
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => step(-1)}
        onLongPress={() => startHold(-1)}
        delayLongPress={350}
        onPressOut={stop}
        disabled={atMin}
        hitSlop={6}
        style={({ pressed }) => [styles.stepBtn, (pressed || atMin) && { opacity: atMin ? 0.35 : 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`Shorter ${label}`}
      >
        <Ionicons name="remove" size={18} color="#fff" />
      </Pressable>
      <Text style={[styles.stepValue, styles.choiceTextActive]} numberOfLines={1} accessibilityLiveRegion="polite">{fmt(value)}</Text>
      <Pressable
        onPress={() => step(1)}
        onLongPress={() => startHold(1)}
        delayLongPress={350}
        onPressOut={stop}
        disabled={atMax}
        hitSlop={6}
        style={({ pressed }) => [styles.stepBtn, (pressed || atMax) && { opacity: atMax ? 0.35 : 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`Longer ${label}`}
      >
        <Ionicons name="add" size={18} color="#fff" />
      </Pressable>
    </View>
  )
}

function Chip({ icon, text, active, onPress, accessibilityLabel, badge }) {
  return (
    <Pressable
      onPress={() => { tap(); onPress?.() }}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {icon ? <Ionicons name={icon} size={16} color={active ? MODE_ACTIVE_COLOR : '#fff'} /> : null}
      {text ? <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text> : null}
      {badge ? <Ionicons name={badge} size={11} color={MODE_ACTIVE_COLOR} style={{ marginLeft: -1 }} /> : null}
    </Pressable>
  )
}

// One option in the closed bar: its icon with the current value written right under it,
// so every setting reads at a glance ("3s", "∞", "×10", "iY Logo"). Tap to see the choices.
function BarItem({ icon, value, active, badge, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => { tap(); onPress?.() }}
      hitSlop={4}
      style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View>
        <Ionicons name={icon} size={19} color={active ? MODE_ACTIVE_COLOR : '#fff'} />
        {badge ? (
          <View style={styles.badge}>
            <Ionicons name={badge} size={9} color="#000" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.itemValue, active && styles.chipTextActive]} numberOfLines={1}>{value}</Text>
    </Pressable>
  )
}

// Small caption over an open option's choices: "VIDEO CUT-OFF · UNLIMITED".
function Caption({ text }) {
  return <Text style={styles.caption} numberOfLines={1}>{String(text || '').toUpperCase()}</Text>
}

// One glass pill of camera options: icons with their current value under them; tap one and
// the pill turns into that option's choices (Off / 3s / 5s / 10s ...), tap the icon to go back.
export default function CameraOptionsBar({ mode, options, onChange, disabled, onOpenChange }) {
  const [open, setOpen] = useState(null)
  const [custom, setCustom] = useState(null) // option key whose custom stepper is showing
  const o = options || {}

  // The cut-off only exists in video mode, burst in photo mode; filters in both.
  useEffect(() => {
    if (open === 'cutoff' && mode !== 'video') setOpen(null)
    if (open === 'burst' && mode !== 'picture') setOpen(null)
  }, [mode, open])
  useEffect(() => {
    if (disabled) setOpen(null)
  }, [disabled])
  useEffect(() => {
    if (custom && custom !== open) setCustom(null)
  }, [open, custom])

  // Lets the screen tuck the "?" away while a row of choices needs the full width.
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  useEffect(() => {
    try { onOpenChangeRef.current?.(!!open) } catch {}
  }, [open])

  const change = (patch) => {
    try { onChange?.(patch) } catch {}
  }

  let content
  if (open && OPTION_DEFS[open] && custom === open && OPTION_DEFS[open].range) {
    // Custom length: − value + stepper, applied as you go and remembered.
    const def = OPTION_DEFS[open]
    const customValue = clampSeconds(o[def.customKey], def.range, def.customDefault) || def.customDefault
    const current = clampSeconds(o[open], def.range, 0)
    const value = current && !def.choices.includes(current) ? current : customValue
    content = (
      <>
        <Caption text={`${def.label} · custom`} />
        <View style={styles.row}>
          <Chip icon="chevron-back" onPress={() => setCustom(null)} accessibilityLabel={`Back to ${def.label} presets`} />
          <View style={styles.divider} />
          <Ionicons name={def.icon} size={16} color={MODE_ACTIVE_COLOR} style={{ marginHorizontal: 4 }} />
          <Stepper
            value={value}
            range={def.range}
            fmt={fmtSeconds}
            label={def.label}
            onChange={(v) => change({ [open]: v, [def.customKey]: v })}
          />
          <View style={styles.divider} />
          <Chip text="Done" onPress={() => { setCustom(null); setOpen(null) }} accessibilityLabel={`Done, ${def.label} ${fmtSeconds(value)}`} />
        </View>
      </>
    )
  } else if (open === 'filter') {
    const value = normalizeFilter(o.filter)
    content = (
      <>
        <Caption text={`${FILTER_DEF.label} · ${filterLabel(value)}`} />
        <View style={styles.row}>
          <Chip icon={FILTER_DEF.icon} active={value !== 'none'} onPress={() => setOpen(null)} accessibilityLabel="Close filter options" />
          <View style={styles.divider} />
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => { tap(); change({ filter: f.id }) }}
              hitSlop={4}
              style={[styles.choice, value === f.id && styles.choiceActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: value === f.id }}
              accessibilityLabel={`${f.label} filter`}
            >
              <Text style={[styles.choiceText, value === f.id && styles.choiceTextActive]} numberOfLines={1}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </>
    )
  } else if (open && OPTION_DEFS[open]) {
    const def = OPTION_DEFS[open]
    const value = o[open] ?? 0
    const isCustom = !!def.range && !!value && !def.choices.includes(value)
    const customValue = def.range ? (clampSeconds(o[def.customKey], def.range, def.customDefault) || def.customDefault) : 0
    content = (
      <>
        <Caption text={`${def.label} · ${longOf(def, value)}`} />
        <View style={styles.row}>
          <Chip icon={def.icon} active={!!value} onPress={() => setOpen(null)} accessibilityLabel={`Close ${def.label} options`} />
          <View style={styles.divider} />
          {def.choices.map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                tap()
                change(open === 'burst' && c ? { burst: c, burstShots: c } : { [open]: c })
              }}
              hitSlop={4}
              style={[styles.choice, value === c && styles.choiceActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: value === c }}
              accessibilityLabel={`${def.label} ${longOf(def, c)}`}
            >
              <Text style={[styles.choiceText, value === c && styles.choiceTextActive, !c && open === 'cutoff' && styles.infinity]}>
                {def.fmt(c)}
              </Text>
            </Pressable>
          ))}
          {def.range ? (
            <Pressable
              onPress={() => {
                tap()
                // Turn the remembered custom length on right away, then show the stepper.
                if (!isCustom) change({ [open]: customValue })
                setCustom(open)
              }}
              hitSlop={4}
              style={[styles.choice, styles.customChoice, isCustom && styles.choiceActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: isCustom }}
              accessibilityLabel={`${def.label} custom length${isCustom ? `, ${fmtSeconds(value)}` : ''}`}
            >
              <Ionicons name="options-outline" size={13} color={isCustom ? MODE_ACTIVE_COLOR : 'rgba(255,255,255,0.9)'} />
              <Text style={[styles.choiceText, isCustom && styles.choiceTextActive]}>{isCustom ? fmtSeconds(value) : 'Custom'}</Text>
            </Pressable>
          ) : null}
          {open === 'timer' && (
            <>
              <View style={styles.divider} />
              <Chip
                icon="albums-outline"
                text="Burst"
                active={!!o.burstAfterCountdown}
                onPress={() => change({ burstAfterCountdown: !o.burstAfterCountdown })}
                accessibilityLabel={`Burst after countdown ${o.burstAfterCountdown ? 'on' : 'off'}`}
              />
            </>
          )}
        </View>
      </>
    )
  } else {
    const timer = o.timer ?? 0
    const afterShots = o.burstAfterCountdown ? (o.burst || o.burstShots || DEFAULT_BURST_SHOTS) : 0
    const timerValue = timer && afterShots ? `${fmtSeconds(timer)}+×${afterShots}` : fmtSeconds(timer)
    const items = [
      {
        k: 'timer', icon: OPTION_DEFS.timer.icon, value: timerValue, active: !!timer,
        a11y: `Countdown: ${fmtSeconds(timer)}${timer && afterShots ? `, then a burst of ${afterShots}` : ''}. Tap to change.`,
      },
    ]
    if (mode === 'video') {
      const cutoff = o.cutoff ?? 0
      items.push({ k: 'cutoff', icon: OPTION_DEFS.cutoff.icon, value: fmtCutoff(cutoff), active: !!cutoff, a11y: `Video cut-off: ${fmtCutoffLong(cutoff)}. Tap to change.` })
    } else {
      const burst = o.burst ?? 0
      items.push({ k: 'burst', icon: OPTION_DEFS.burst.icon, value: fmtShots(burst), active: !!burst, a11y: `Burst: ${fmtShots(burst)}. Tap to change.` })
    }
    const f = normalizeFilter(o.filter)
    items.push({ k: 'filter', icon: FILTER_DEF.icon, value: f === 'none' ? 'None' : filterLabel(f), active: f !== 'none', a11y: `Filter: ${filterLabel(f)}. Tap to change.` })
    content = (
      <View style={styles.row}>
        {items.map((it, i) => (
          <React.Fragment key={it.k}>
            {i > 0 ? <View style={styles.itemDivider} /> : null}
            <BarItem
              icon={it.icon}
              value={it.value}
              active={it.active}
              badge={it.badge}
              onPress={() => setOpen(it.k)}
              accessibilityLabel={it.a11y}
            />
          </React.Fragment>
        ))}
      </View>
    )
  }

  return (
    <View style={[styles.wrap, disabled && { opacity: 0.4 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Glass scheme="dark" radius={20} shadow={false} style={styles.glass}>
        {content}
      </Glass>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', flexShrink: 1 },
  glass: { paddingHorizontal: 4, paddingVertical: 3, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  item: { minWidth: 54, maxWidth: 84, alignItems: 'center', paddingHorizontal: 8, paddingTop: 5, paddingBottom: 4, borderRadius: 16, gap: 2 },
  itemActive: { backgroundColor: 'rgba(255,214,10,0.12)' },
  itemValue: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  itemDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(255,255,255,0.22)', marginHorizontal: 2 },
  badge: {
    position: 'absolute', right: -7, top: -4, width: 14, height: 14, borderRadius: 7,
    backgroundColor: MODE_ACTIVE_COLOR, alignItems: 'center', justifyContent: 'center',
  },
  caption: {
    color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 3, marginBottom: 1,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16,
  },
  chipActive: { backgroundColor: 'rgba(255,214,10,0.14)' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: MODE_ACTIVE_COLOR },
  divider: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: 'rgba(255,255,255,0.35)', marginHorizontal: 3 },
  choice: { paddingHorizontal: 6, paddingVertical: 6, borderRadius: 14 },
  customChoice: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stepBtn: { width: 34, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  stepValue: { minWidth: 64, textAlign: 'center', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  choiceActive: { backgroundColor: 'rgba(255,214,10,0.18)' },
  choiceText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
  choiceTextActive: { color: MODE_ACTIVE_COLOR },
  infinity: { fontSize: 16, lineHeight: 17 },
})
