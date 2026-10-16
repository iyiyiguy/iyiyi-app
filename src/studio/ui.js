// Studio UI kit: hardware-style controls on the studio palette (games/studio.js).
import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native'
import Svg, { Rect, Line } from 'react-native-svg'
import { FONT, ST, withAlpha } from '../games/studio'

export const SX = {
  bg: '#08090c',
  panel: '#12151b',
  panel2: '#1a1e26',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
  text: '#f2f4f7',
  muted: 'rgba(242,244,247,0.56)',
  faint: 'rgba(242,244,247,0.32)',
  accent: '#ffb21e',
  hot: '#ff4fa3',
  cool: '#39d5ff',
  ok: '#5cf2a0',
  rec: '#ff3d52',
}

export const sxType = {
  label: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: SX.muted, textTransform: 'uppercase' },
  value: { fontFamily: FONT.display, fontSize: 18, color: SX.text, fontVariant: ['tabular-nums'], includeFontPadding: false },
  title: { fontFamily: FONT.display, fontSize: 17, color: SX.text, includeFontPadding: false },
  body: { fontFamily: FONT.uiSemi, fontSize: 14, color: 'rgba(242,244,247,0.82)' },
  small: { fontFamily: FONT.uiSemi, fontSize: 12, color: SX.muted },
}

export function Panel({ children, style }) {
  return <View style={[s.panel, style]}>{children}</View>
}

/** Small square-ish hardware button. */
export function HwButton({ label, icon, onPress, onLongPress, active, color = SX.accent, style, textStyle, disabled, accessibilityLabel, children }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={({ pressed }) => [
        s.hw,
        active && { backgroundColor: withAlpha(color, 0.18), borderColor: color },
        pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon}
      {children}
      {label ? <Text style={[s.hwText, active && { color }, textStyle]} numberOfLines={1}>{label}</Text> : null}
    </Pressable>
  )
}

/** Segmented control (tabs / options). */
export function Seg({ options, value, onChange, style, small }) {
  return (
    <View style={[s.seg, style]}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segItem, small && { paddingVertical: 6 }, on && s.segOn]}
          >
            <Text style={[s.segText, on && { color: SX.bg }]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Horizontal fader. value 0..1 (or [min,max] via props). */
export function Fader({ value, onChange, min = 0, max = 1, color = SX.accent, height = 30, style, onEnd }) {
  const [w, setW] = useState(1)
  const startRef = useRef(0)
  const wRef = useRef(1)
  wRef.current = w
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)))
  // The pan responder is created once, so it reads the latest props through a ref.
  const cb = useRef({})
  cb.current = { onChange, onEnd, min, max }
  const set = (x) => {
    const f = Math.max(0, Math.min(1, x / wRef.current))
    const c = cb.current
    c.onChange(c.min + f * (c.max - c.min))
  }
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { startRef.current = e.nativeEvent.locationX; set(startRef.current) },
      onPanResponderMove: (_, g) => set(startRef.current + g.dx),
      onPanResponderRelease: () => cb.current.onEnd?.(),
    }),
  ).current
  return (
    <View
      style={[s.fader, { height }, style]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}
    >
      <View style={[s.faderTrack]} />
      <View style={[s.faderFill, { width: `${frac * 100}%`, backgroundColor: color }]} />
      <View style={[s.faderKnob, { left: Math.max(0, Math.min(w - 14, frac * w - 7)), borderColor: color }]} />
    </View>
  )
}

/** − value + stepper with a label. */
export function Stepper({ label, value, onChange, step = 1, min, max, format = (v) => v, onPressValue, style }) {
  const clamp = (v) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v))
  return (
    <View style={[s.stepper, style]}>
      {label ? <Text style={sxType.label}>{label}</Text> : null}
      <View style={s.stepperRow}>
        <Pressable onPress={() => onChange(clamp(value - step))} onLongPress={() => onChange(clamp(value - step * 10))} hitSlop={6} style={s.stepBtn} accessibilityLabel={`Lower ${label}`}>
          <Text style={s.stepBtnText}>−</Text>
        </Pressable>
        <Pressable onPress={onPressValue} disabled={!onPressValue} style={{ minWidth: 44, alignItems: 'center' }}>
          <Text style={sxType.value}>{format(value)}</Text>
        </Pressable>
        <Pressable onPress={() => onChange(clamp(value + step))} onLongPress={() => onChange(clamp(value + step * 10))} hitSlop={6} style={s.stepBtn} accessibilityLabel={`Raise ${label}`}>
          <Text style={s.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Waveform with optional slice regions (seconds) and a selected slice. */
export function Waveform({ peaks = [], duration = 1, slices = [], selected = -1, height = 120, onTapTime, color = SX.cool }) {
  const [w, setW] = useState(300)
  const n = peaks.length || 1
  const bw = w / n
  return (
    <Pressable
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onPress={(e) => onTapTime?.((e.nativeEvent.locationX / w) * duration)}
      style={[s.wave, { height }]}
    >
      <Svg width={w} height={height}>
        {slices.map((sl, k) => (
          <Rect
            key={`r${k}`}
            x={(sl.start / duration) * w}
            y={0}
            width={Math.max(1, ((sl.end - sl.start) / duration) * w)}
            height={height}
            fill={k === selected ? withAlpha(SX.accent, 0.22) : k % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.0)'}
          />
        ))}
        {peaks.map((p, i) => {
          const h = Math.max(1, p * (height - 8))
          return <Rect key={i} x={i * bw} y={(height - h) / 2} width={Math.max(1, bw - 0.6)} height={h} fill={color} opacity={0.85} />
        })}
        {slices.map((sl, k) => (
          <Line key={`l${k}`} x1={(sl.start / duration) * w} x2={(sl.start / duration) * w} y1={0} y2={height} stroke={SX.accent} strokeWidth={1.5} />
        ))}
      </Svg>
    </Pressable>
  )
}

const s = StyleSheet.create({
  panel: { backgroundColor: SX.panel, borderRadius: 14, borderWidth: 1, borderColor: SX.line, padding: 12 },
  hw: {
    minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: SX.lineStrong, backgroundColor: SX.panel2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  hwText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.2, color: SX.text, textTransform: 'uppercase' },
  seg: { flexDirection: 'row', backgroundColor: SX.panel, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: SX.line },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9 },
  segOn: { backgroundColor: SX.text },
  segText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.4, color: SX.muted, textTransform: 'uppercase' },
  fader: { justifyContent: 'center' },
  faderTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
  faderFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  faderKnob: { position: 'absolute', width: 14, height: 22, borderRadius: 4, backgroundColor: '#e9ecf2', borderWidth: 2 },
  stepper: { gap: 4, alignItems: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: SX.panel2, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: SX.text, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  wave: { backgroundColor: '#0c0f14', borderRadius: 10, borderWidth: 1, borderColor: SX.line, overflow: 'hidden' },
})
