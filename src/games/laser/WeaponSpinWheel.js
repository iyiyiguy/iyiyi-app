// Radial weapon wheel for Laser Tag (studio "Wheel" board). Opened by tapping the weapon
// card (or CHANGE WEAPON on the tagged-out screen).
//
// Every owned weapon sits on a ring around the selected one. Tap a slot, or drag a finger
// round the ring, to select it (haptic tick per slot); its stats show below as 10-cell bars.
// EQUIP (or tapping the centre) equips it; CLOSE, the backdrop or Android back closes.
// The match keeps running behind the wheel; firing is paused while it's open.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Image, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { buzz } from '../../lib/gamePrefs'
import { fireRateLabel, gunRatings } from '../../lib/guns'
import { gunArt } from '../../lib/gunArt'
import { FONT, ST, stType } from '../studio'
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'

const tr = (k, v) => translate(H, k, v)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const modeLabel = (w) => (w?.fireMode === 'automatic' ? tr('fire_auto') : (w?.shotsPerClick || 1) > 1 ? tr('fire_burst_n', { n: w.shotsPerClick }) : tr('fire_semi'))
const STATS = [['stat_damage', 'power'], ['stat_rate', 'fireRate'], ['stat_accuracy', 'accuracy'], ['stat_range', 'range']]

export function WeaponSpinWheel({ visible, loadout, currentId, onPick, onClose, insets }) {
  if (!visible || !Array.isArray(loadout) || loadout.length === 0) return null
  return <Wheel loadout={loadout} currentId={currentId} onPick={onPick} onClose={onClose} insets={insets || {}} />
}

function Wheel({ loadout, currentId, onPick, onClose, insets }) {
  const { width, height } = useWindowDimensions()
  const n = loadout.length
  const startIdx = Math.max(0, loadout.findIndex((w) => w.id === currentId))
  const [sel, setSel] = useState(startIdx)
  const selRef = useRef(startIdx)
  selRef.current = sel
  const show = useRef(new Animated.Value(0)).current
  const closing = useRef(false)
  const cb = useRef({})
  cb.current = { onPick, onClose, loadout }

  // Ring size: whatever is left after the header, the stats panel and the buttons.
  const top = (insets.top || 0) + 14
  const bottom = (insets.bottom || 0) + 12
  const compact = height < 720
  const statsH = compact ? 132 : 150
  const avail = height - top - bottom - 50 - statsH - 48 - 3 * (compact ? 10 : 16)
  const ring = Math.round(clamp(Math.min(width - 32, avail), 210, 360))
  const slotW = Math.round(clamp((Math.PI * ring * 0.8) / Math.max(n, 1) - 8, 54, 80))
  const slotH = Math.round(slotW * 0.8)
  const R = ring / 2 - slotH / 2 - 2
  const half = ring / 2

  const slots = useMemo(() => loadout.map((w, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return { w, i, cx: half + Math.cos(a) * R, cy: half + Math.sin(a) * R }
  }), [loadout, n, half, R])

  useEffect(() => {
    Animated.timing(show, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    return () => show.stopAnimation()
  }, [show])

  const finish = (kind) => {
    if (closing.current) return
    closing.current = true
    Animated.timing(show, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      const { onPick: pick, onClose: close, loadout: l } = cb.current
      if (kind === 'pick' && l[selRef.current]) pick?.(l[selRef.current].id)
      else close?.()
    })
  }

  const choose = (i) => {
    const k = clamp(i, 0, n - 1)
    if (k !== selRef.current) {
      selRef.current = k
      setSel(k)
      buzz('select')
    }
  }

  // Which slot is under (x, y) in ring coordinates: 'centre', a slot index, or null.
  const hitTest = (x, y, dragging) => {
    const dx = x - half
    const dy = y - half
    const dist = Math.hypot(dx, dy)
    if (!dragging && dist < R - slotH * 0.6) return 'centre'
    if (dist < R * 0.45) return null
    const ang = Math.atan2(dy, dx) + Math.PI / 2 // 0 = 12 o'clock
    const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    return Math.round((norm / (Math.PI * 2)) * n) % n
  }

  const pan = useMemo(() => {
    let x0 = 0
    let y0 = 0
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        x0 = e.nativeEvent.locationX
        y0 = e.nativeEvent.locationY
      },
      onPanResponderMove: (_, g) => {
        try {
          if (closing.current || Math.hypot(g.dx, g.dy) < 10) return
          const hit = hitTest(x0 + g.dx, y0 + g.dy, true)
          if (typeof hit === 'number') choose(hit)
        } catch {}
      },
      onPanResponderRelease: (_, g) => {
        try {
          if (closing.current || Math.hypot(g.dx, g.dy) >= 10) return
          const hit = hitTest(x0, y0, false)
          if (hit === 'centre') finish('pick')
          else if (typeof hit === 'number') choose(hit)
        } catch {}
      },
    })
  }, [n, half, R, slotH]) // eslint-disable-line react-hooks/exhaustive-deps

  const w = loadout[clamp(sel, 0, n - 1)]
  const ratings = (() => { try { return gunRatings(w) } catch { return null } })()
  const rate = (() => { try { return fireRateLabel(w) } catch { return '' } })()
  const equipped = w?.id === currentId
  const scale = show.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })

  return (
    <View style={[StyleSheet.absoluteFill, st.root]}>
      <Pressable style={st.backdrop} onPress={() => finish('close')} accessibilityRole="button" accessibilityLabel={tr('close_wheel')} />
      <Animated.View style={[st.body, { paddingTop: top, paddingBottom: bottom, opacity: show, gap: compact ? 10 : 16 }]} pointerEvents="box-none">
        <View style={st.head}>
          <Text style={[stType.kicker, { letterSpacing: 2.6 }]}>{tr('loadout')}</Text>
          <Text style={st.title}>{tr('select_weapon')}</Text>
        </View>

        <Animated.View
          style={{ width: ring, height: ring, alignSelf: 'center', transform: [{ scale }] }}
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={tr(equipped ? 'wheel_a11y_eq' : 'wheel_a11y', { name: w?.name })}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName
            if (a === 'increment') choose((selRef.current + 1) % n)
            else if (a === 'decrement') choose((selRef.current - 1 + n) % n)
            else if (a === 'activate') finish('pick')
          }}
        >
          <View pointerEvents="none" style={[st.ringLine, { left: half - R, top: half - R, width: R * 2, height: R * 2, borderRadius: R }]} />
          {slots.map(({ w: g, i, cx, cy }) => {
            const on = i === sel
            return (
              <View key={g.id} pointerEvents="none" style={[st.slot, { left: cx - slotW / 2, top: cy - slotH / 2, width: slotW, height: slotH }, on && st.slotOn]}>
                <Image source={gunArt(g.id)} style={{ width: slotW * 0.72, height: slotH * 0.38, tintColor: on ? ST.friendly : ST.text }} resizeMode="contain" />
                <Text style={[st.slotName, slotW < 64 && { fontSize: 9 }]} numberOfLines={1}>{String(g.name || '').toUpperCase()}</Text>
                {g.id === currentId ? <View style={st.equippedDot} /> : null}
              </View>
            )
          })}
          <View pointerEvents="none" style={[st.centre, { left: half - 75, top: half - 52, width: 150, height: 104 }]}>
            <Text style={st.centreName} numberOfLines={2}>{String(w?.name || '').toUpperCase()}</Text>
            <Text style={st.centreMode}>{modeLabel(w)}</Text>
            <Text style={st.centreHint}>{tr(equipped ? 'equipped' : 'tap_equip')}</Text>
          </View>
        </Animated.View>

        <View style={[st.stats, compact && { paddingVertical: 10, gap: 8 }]}>
          {ratings ? STATS.map(([label, key]) => {
            const cells = Math.round(clamp(Number(ratings[key]) || 0, 0, 1) * 10)
            return (
              <View key={key} style={st.statRow}>
                <Text style={st.statLabel}>{tr(label)}</Text>
                <View style={st.cells}>
                  {Array.from({ length: 10 }, (_, j) => <View key={j} style={[st.cell, { backgroundColor: j < cells ? ST.friendly : 'rgba(255,255,255,0.14)' }]} />)}
                </View>
              </View>
            )
          }) : null}
          <Text style={st.blurb} numberOfLines={2}>{[w?.description, rate].filter(Boolean).join(' · ')}</Text>
        </View>

        <View style={st.buttons}>
          <Pressable onPress={() => finish('pick')} style={({ pressed }) => [st.equip, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={tr('equip_a11y', { name: w?.name })}>
            <Text style={st.equipText}>{tr(equipped ? 'keep' : 'equip')}</Text>
          </Pressable>
          <Pressable onPress={() => finish('close')} style={({ pressed }) => [st.closeBtn, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={tr('close_wheel')}>
            <Text style={st.closeText}>{tr('close_btn')}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  )
}

const st = StyleSheet.create({
  root: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6,8,12,0.82)' },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  head: { alignItems: 'center', gap: 2 },
  title: { fontFamily: FONT.display, fontSize: 20, letterSpacing: 1, color: ST.text },
  ringLine: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  slot: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  slotOn: { backgroundColor: 'rgba(57,213,255,0.18)', borderWidth: 2, borderColor: ST.friendly },
  slotName: { fontFamily: FONT.display, fontSize: 10, letterSpacing: 0.4, color: '#ffffff', maxWidth: '92%' },
  equippedDot: { position: 'absolute', top: 4, right: 4, width: 6, height: 6, backgroundColor: ST.friendly, transform: [{ rotate: '45deg' }] },
  centre: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 4 },
  centreName: { fontFamily: FONT.display, fontSize: 17, letterSpacing: 0.8, color: ST.text, textAlign: 'center' },
  centreMode: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: ST.friendly },
  centreHint: { fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1.6, color: ST.faint },
  stats: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.85)', borderWidth: 1, borderColor: ST.line, gap: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statLabel: { width: 70, fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: 'rgba(242,244,247,0.65)' },
  cells: { flex: 1, flexDirection: 'row', gap: 3 },
  cell: { flex: 1, height: 6 },
  blurb: { fontFamily: FONT.uiSemi, fontSize: 12, color: 'rgba(242,244,247,0.8)' },
  buttons: { flexDirection: 'row', gap: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  equip: { flex: 1, height: 48, borderRadius: ST.radius, backgroundColor: ST.friendly, alignItems: 'center', justifyContent: 'center' },
  equipText: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 2, color: ST.ink },
  closeBtn: { width: 100, height: 48, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1.4, color: '#ffffff' },
})
