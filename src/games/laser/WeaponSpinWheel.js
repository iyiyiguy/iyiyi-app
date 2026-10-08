// Spin-wheel weapon picker for Laser Tag. Opened by tapping the weapon chip.
//
// Weapons sit on an arc; swipe left/right (or drag along the arc) to spin it, with
// momentum, snapping and a haptic tick on every slot. The centred weapon is larger and
// its stats are shown. Tap the centred weapon — or release slowly on one — to equip;
// tap outside or swipe down to close. All transforms run on the native driver: the only
// JS work while spinning is a slot-change tick.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, Image } from 'react-native'
import { buzz } from '../../lib/gamePrefs'
import { fireRateLabel, gunRatings } from '../../lib/guns'
import { gunArt } from '../../lib/gunArt'

const SLOT_PX = 92 // horizontal drag per slot
const STEP_DEG = 36 // arc angle between slots
const VISIBLE = 3 // slots shown each side
const GOLD = '#ffc94d'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const modeLabel = (w) => (w?.fireMode === 'automatic' ? 'AUTO' : (w?.shotsPerClick || 1) > 1 ? 'BURST' : 'SEMI')

export function WeaponSpinWheel({ visible, loadout, currentId, onPick, onClose }) {
  if (!visible || !Array.isArray(loadout) || loadout.length === 0) return null
  return <Wheel loadout={loadout} currentId={currentId} onPick={onPick} onClose={onClose} />
}

function Wheel({ loadout, currentId, onPick, onClose }) {
  const { width } = useWindowDimensions()
  const n = loadout.length
  const startIdx = Math.max(0, loadout.findIndex((w) => w.id === currentId))
  const R = clamp(width * 0.42, 130, 190)

  const pos = useRef(new Animated.Value(startIdx)).current
  const show = useRef(new Animated.Value(0)).current
  const posNow = useRef(startIdx)
  const lastTick = useRef(startIdx)
  const [centerIdx, setCenterIdx] = useState(startIdx)
  const closing = useRef(false)
  const cb = useRef({})
  cb.current = { onPick, onClose, loadout }

  useEffect(() => {
    Animated.spring(show, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 240 }).start()
    const id = pos.addListener(({ value }) => {
      posNow.current = value
      const slot = clamp(Math.round(value), 0, n - 1)
      if (slot !== lastTick.current) {
        lastTick.current = slot
        buzz('select')
        setCenterIdx(slot)
      }
    })
    return () => {
      pos.removeListener(id)
      pos.stopAnimation()
      show.stopAnimation()
    }
  }, [pos, show, n])

  const finish = (kind, idx) => {
    if (closing.current) return
    closing.current = true
    Animated.timing(show, { toValue: 0, duration: kind === 'pick' ? 170 : 140, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      const { onPick: pick, onClose: close, loadout: l } = cb.current
      if (kind === 'pick' && l[idx]) pick?.(l[idx].id)
      else close?.()
    })
  }

  const snapTo = (target, then) => {
    const t = clamp(Math.round(target), 0, n - 1)
    Animated.spring(pos, { toValue: t, useNativeDriver: true, damping: 18, stiffness: 180, mass: 0.9 }).start(({ finished }) => {
      if (finished) then?.(t)
    })
    return t
  }

  const pan = useMemo(() => {
    let start = 0
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        pos.stopAnimation((v) => { posNow.current = v })
        start = posNow.current
      },
      onPanResponderMove: (_, g) => {
        if (closing.current) return
        let v = start - g.dx / SLOT_PX
        if (v < 0) v = v / 3 // rubber band past the ends
        else if (v > n - 1) v = n - 1 + (v - (n - 1)) / 3
        pos.setValue(v)
      },
      onPanResponderRelease: (e, g) => {
        if (closing.current) return
        // Swipe down closes.
        if (g.dy > 70 && Math.abs(g.dy) > Math.abs(g.dx) * 1.3) { finish('close'); return }
        const moved = Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8
        if (!moved) {
          // Tap: the centre slot equips; either side steps the wheel toward that side.
          const x = e.nativeEvent.locationX
          const cx = width / 2
          const cur = clamp(Math.round(posNow.current), 0, n - 1)
          if (!Number.isFinite(x) || Math.abs(x - cx) < 62) { snapTo(cur); finish('pick', cur); return }
          snapTo(cur + (x > cx ? 1 : -1))
          return
        }
        // Momentum: project the fling, then snap. A slow release on a slot equips it.
        const slow = Math.abs(g.vx) < 0.25
        const projected = posNow.current - (g.vx * 260) / SLOT_PX
        snapTo(projected, slow ? (t) => finish('pick', t) : undefined)
      },
      onPanResponderTerminate: () => snapTo(posNow.current),
    })
  }, [n, width]) // eslint-disable-line react-hooks/exhaustive-deps

  const centred = loadout[clamp(centerIdx, 0, n - 1)]
  const ratings = (() => {
    try { return gunRatings(centred) } catch { return null }
  })()
  const opacity = show
  const lift = show.interpolate({ inputRange: [0, 1], outputRange: [60, 0] })
  const arcH = R * (1 - Math.cos((STEP_DEG * VISIBLE * Math.PI) / 180)) + 90

  return (
    <View style={[StyleSheet.absoluteFill, st.root]}>
      <Pressable style={st.backdrop} onPress={() => finish('close')} accessibilityLabel="Close weapon wheel" />
      <Animated.View style={[st.dock, { opacity, transform: [{ translateY: lift }] }]} pointerEvents="box-none">
        {/* Centred weapon details */}
        <View style={st.info} pointerEvents="none">
          <View style={st.infoHead}>
            <Text style={st.infoName} numberOfLines={1}>{centred?.name}</Text>
            <View style={[st.badge, centred?.fireMode === 'automatic' && st.badgeAuto]}><Text style={st.badgeText}>{modeLabel(centred)}</Text></View>
            <Text style={st.rate} numberOfLines={1}>{(() => { try { return fireRateLabel(centred) } catch { return '' } })()}</Text>
          </View>
          {ratings && (
            <View style={st.stats}>
              <Stat label="Power" v={ratings.power} />
              <Stat label="Rate" v={ratings.fireRate} />
              <Stat label="Accuracy" v={ratings.accuracy} />
              <Stat label="Range" v={ratings.range} />
            </View>
          )}
          <Text style={st.hint}>{n > 1 ? 'Swipe to spin · tap the centre to equip · swipe down to close' : 'Tap to equip · buy more weapons in the Shop'}</Text>
        </View>

        {/* The wheel */}
        <View style={[st.wheel, { height: arcH + 40 }]} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={`Weapon wheel. ${centred?.name}`}>
          <View style={[st.slotRing, { left: width / 2 - 50, top: -7 }]} pointerEvents="none" />
          {loadout.map((w, i) => {
            const input = []
            const tx = []
            const ty = []
            const sc = []
            const op = []
            for (let k = -VISIBLE; k <= VISIBLE; k++) {
              const off = -k // offset of item i from the centre when pos = i + k
              const a = (off * STEP_DEG * Math.PI) / 180
              input.push(i + k)
              tx.push(R * Math.sin(a))
              ty.push(R * (1 - Math.cos(a)))
              sc.push(off === 0 ? 1.25 : Math.abs(off) === 1 ? 0.88 : 0.72)
              op.push(Math.abs(off) === VISIBLE ? 0 : off === 0 ? 1 : Math.abs(off) === 1 ? 0.85 : 0.5)
            }
            const style = {
              opacity: pos.interpolate({ inputRange: input, outputRange: op, extrapolate: 'clamp' }),
              transform: [
                { translateX: pos.interpolate({ inputRange: input, outputRange: tx, extrapolate: 'clamp' }) },
                { translateY: pos.interpolate({ inputRange: input, outputRange: ty, extrapolate: 'clamp' }) },
                { scale: pos.interpolate({ inputRange: input, outputRange: sc, extrapolate: 'clamp' }) },
              ],
            }
            const on = i === centerIdx
            return (
              <Animated.View key={w.id} style={[st.item, { left: width / 2 - 44 }, style]} pointerEvents="none">
                <View style={[st.disc, on && st.discOn, w.id === currentId && st.discCurrent]}>
                  <Image source={gunArt(w.id)} style={st.img} resizeMode="contain" />
                </View>
                <Text style={[st.itemName, on && { color: '#fff' }]} numberOfLines={1}>{w.name}</Text>
              </Animated.View>
            )
          })}
        </View>
      </Animated.View>
    </View>
  )
}

function Stat({ label, v }) {
  const pct = Math.round(clamp(Number(v) || 0, 0, 1) * 100)
  return (
    <View style={st.stat}>
      <Text style={st.statLabel}>{label}</Text>
      <View style={st.track}><View style={[st.fill, { width: `${pct}%` }]} /></View>
    </View>
  )
}

const st = StyleSheet.create({
  root: { zIndex: 60, elevation: 60 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  info: { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 20, backgroundColor: 'rgba(12,14,26,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  infoName: { flexShrink: 1, fontSize: 18, fontWeight: '800', color: '#fff' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.16)' },
  badgeAuto: { backgroundColor: 'rgba(255,77,94,0.85)' },
  rate: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: GOLD },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, columnGap: 14 },
  stat: { width: '46%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { width: 58, fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.62)' },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: GOLD },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 10, textAlign: 'center' },
  wheel: { width: '100%', paddingBottom: 30 },
  slotRing: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(255,201,77,0.55)' },
  item: { position: 'absolute', top: 10, width: 88, alignItems: 'center' },
  disc: { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(12,14,26,0.9)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  discOn: { borderColor: GOLD, backgroundColor: 'rgba(255,201,77,0.18)' },
  discCurrent: { borderStyle: 'dashed' },
  icon: { fontSize: 32 },
  img: { width: '86%', height: '52%' },
  itemName: { marginTop: 4, fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.7)', maxWidth: 88, textAlign: 'center' },
})
