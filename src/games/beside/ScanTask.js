// Doing a task at a station, then solving its puzzle. The first step depends on the
// station kind (see ./engine.js):
//   photo – point the camera at the real object (matching the reference photo)
//   qr    – scan the station's printed code (skipped when the code was already scanned)
//   auto  – nothing: arriving at the GPS waypoint opened the task
//   place – nothing: arriving (GPS + same floor) opened the task
// Dressed as a playful code-cracking terminal (see ./terminal.js). The screen is the same
// for every role (no "cover task" label: the host simply doesn't count the imposter's).
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../../components/CameraGate'
import { ST, StButton, stShadow, stType, withAlpha } from '../studio'
import { StationImage } from './StationImage'
import { PUZZLES, PUZZLE_MODULES, Puzzle } from './Puzzles'
import { buzz } from '../../lib/gamePrefs'
import {
  AccessStamp, Brackets, Cursor, Readout, SegBar, TERM, TermBackdrop, TermHeader, TermModule, pad2, termType, useReduceMotion, useTicker,
} from './terminal'
import { stationKind } from './engine'
import { QrCamera, QrFrame } from './QrScan'
import { Toy } from './toys'
import { useT } from '../../i18n'
import B from '../../i18n/strings/besideThem'
import { stationName } from './text'

const GRANTED_MS = 1100
const DENIED_MS = 750

// onDone({ code }) — code: the scanned QR code for 'qr' stations (the host checks it).
export function ScanTask({ visible, room, station, stationNo, assets, puzzle, scannedCode, onClose, onDone }) {
  const t = useT(B)
  const kind = stationKind(station)
  const [perm] = useCameraGate(visible && kind === 'photo')
  const [step, setStep] = useState('scan')
  const [code, setCode] = useState(null)
  const [qrError, setQrError] = useState(null)
  const [overlay, setOverlay] = useState(true)
  const [prog, setProg] = useState(0)
  const [denied, setDenied] = useState(0)
  const reduce = useReduceMotion()
  const last = useRef(null)
  const grantTimer = useRef(null)
  const denyTimer = useRef(null)
  if (station) last.current = { station, stationNo, puzzle }

  useEffect(() => () => { clearTimeout(grantTimer.current); clearTimeout(denyTimer.current) }, [])
  // A new task opening while the stamp is still up skips the rest of the stamp.
  useEffect(() => {
    if (visible && step === 'granted') { clearTimeout(grantTimer.current); setStep('scan') }
    if (visible) { setCode(scannedCode || null); setQrError(null); setProg(0) }
  }, [visible, station?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setStep('scan'); setCode(null); onClose() }
  const shown = step === 'granted' ? last.current : station ? { station, stationNo, puzzle } : null
  if (!shown) return null
  const st = shown.station
  const shownKind = stationKind(st)
  const haveCode = code || scannedCode
  // Auto / walk & place stations and already-scanned QR codes go straight to the puzzle.
  const eff = step === 'scan' && (shownKind === 'auto' || shownKind === 'place' || (shownKind === 'qr' && haveCode)) ? 'puzzle' : step
  const no = t('station_no', { n: pad2(shown.stationNo || 0) })
  const stName = stationName(st)
  const segs = [stName, t('seg_access'), t('seg_link')]

  const flashDenied = () => {
    clearTimeout(denyTimer.current)
    setDenied((n) => n + 1)
    denyTimer.current = setTimeout(() => setDenied(0), DENIED_MS)
  }
  const finished = () => {
    // Report the task straight away (same moment as before); the stamp is only a hold on
    // this screen, then it dismisses itself.
    setStep('granted')
    setProg(1)
    onDone({ code: haveCode || undefined })
    clearTimeout(grantTimer.current)
    grantTimer.current = setTimeout(() => setStep('scan'), GRANTED_MS)
  }

  const onQr = ({ id, code: c }) => {
    if (id === st.id && c === st.code) { buzz('medium'); setQrError(null); setCode(c); setProg(0); setStep('puzzle') }
    else { buzz('warning'); setQrError(t('qr_other_station')) }
  }

  let body
  if (eff === 'scan' && shownKind === 'qr') {
    body = (
      <View style={styles.fill}>
        <QrCamera active={visible} onScan={onQr} onOther={() => setQrError(t('qr_not_bt'))} />
        <TermBackdrop overCamera reduce={reduce} />
        <QrFrame label={t('code_n_name', { n: pad2(shown.stationNo || 0), name: stName })} />
        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View>
            <TermHeader left={no} segments={segs} reduce={reduce} style={{ marginBottom: 10 }} />
            <Text style={[stType.kicker, stShadow]}>{t('scan_the_code')}</Text>
            <Text style={[stType.title, stShadow]} numberOfLines={2}>{stName}</Text>
            <Text style={[termType.mono, { color: ST.text }, stShadow]}>&gt; {t('find_code_fill', { n: pad2(shown.stationNo || 0) })}</Text>
          </View>
          <View>
            {qrError ? <Text style={[stType.small, { color: ST.objective, marginBottom: 8, textAlign: 'center' }, stShadow]}>{qrError}</Text> : null}
            <StButton title={t('cancel')} tone="ghost" onPress={close} style={{ backgroundColor: ST.panelStrong }} />
          </View>
        </SafeAreaView>
      </View>
    )
  } else if (eff === 'scan') {
    body = (
      <View style={styles.fill}>
        {perm?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: TERM.ground }]}>
            {perm && !perm.granted && perm.status === 'denied' ? <CameraOff what={t('cam_what_stations')} compact /> : null}
          </View>
        )}
        <TermBackdrop overCamera reduce={reduce} />
        <View style={styles.reticleWrap} pointerEvents="none">
          <Reticle reduce={reduce} live={!!perm?.granted}>
            {overlay ? <StationImage room={room} station={st} assets={assets} style={styles.ghost} /> : null}
          </Reticle>
        </View>
        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View>
            <TermHeader left={no} segments={segs} reduce={reduce} style={{ marginBottom: 10 }} />
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={[stType.kicker, stShadow]}>{t('scan_station')}</Text>
                <Text style={[stType.title, stShadow]} numberOfLines={2}>{stName}</Text>
                <Text style={[termType.mono, { color: ST.text }, stShadow]}>&gt; {t('line_up_camera')}</Text>
              </View>
              <Pressable onPress={() => setOverlay((v) => !v)} style={styles.refCard} accessibilityRole="button" accessibilityLabel={t('toggle_overlay')}>
                <StationImage room={room} station={st} assets={assets} style={styles.refImg} />
                <Text style={styles.refText}>{overlay ? t('hide_overlay') : t('show_overlay')}</Text>
                <Brackets color={withAlpha(ST.friendly, 0.7)} size={8} inset={-1} />
              </Pressable>
            </View>
          </View>
          <View>
            <ScanReadouts reduce={reduce} live={!!perm?.granted} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StButton title={t('cancel')} tone="ghost" onPress={close} style={{ flex: 1, backgroundColor: ST.panelStrong }} />
              <StButton title={t('it_matches')} disabled={!perm?.granted} onPress={() => { buzz('medium'); setProg(0); setStep('puzzle') }} style={{ flex: 2 }} />
            </View>
          </View>
        </SafeAreaView>
      </View>
    )
  } else {
    const granted = step === 'granted'
    const pKind = shown.puzzle
    body = (
      <View style={[styles.fill, { backgroundColor: TERM.ground }]}>
        <TermBackdrop reduce={reduce} toys tone={granted ? TERM.granted : denied ? TERM.denied : TERM.scan} />
        <SafeAreaView style={{ flex: 1, padding: 16 }} edges={['top', 'bottom']}>
          <TermHeader left={no} segments={segs} reduce={reduce} color={granted ? TERM.granted : ST.friendly} style={{ marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 }}>
            {st.toy ? <Toy kind={st.toy} size={44} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stType.kicker, { color: ST.objective }]} numberOfLines={1}>{t('crack_code', { name: stName })}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[stType.title, { fontSize: 26, flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{PUZZLES[pKind]}</Text>
                <Cursor reduce={reduce} color={ST.friendly} w={10} h={20} />
              </View>
            </View>
          </View>
          <View style={styles.statRow}>
            <Readout label={t('ro_decrypt')} value={`${String(Math.round(prog * 100)).padStart(3, '0')}%`} color={granted ? TERM.granted : ST.friendly} />
            <Readout label={t('ro_cipher')} value={`AES-${pKind ? pKind.length * 32 : 256}`} />
            <Readout label={t('ro_status')} value={granted ? t('st_open') : denied ? t('st_retry') : t('st_locked')} color={granted ? TERM.granted : denied ? TERM.denied : ST.objective} />
          </View>
          <SegBar value={prog} color={granted ? TERM.granted : ST.friendly} style={{ marginBottom: 12 }} />
          {granted ? (
            <Pressable style={styles.stampArea} onPress={() => { clearTimeout(grantTimer.current); setStep('scan') }} accessibilityRole="button" accessibilityLabel={t('granted_a11y')}>
              <AccessStamp granted reduce={reduce} sub={t('task_logged', { no })} />
            </Pressable>
          ) : (
            <View>
              <TermModule title={t('module_name', { name: PUZZLE_MODULES[pKind] || PUZZLE_MODULES.pattern })} code={`${pad2(shown.stationNo || 0)}-${(pKind || 'pattern').slice(0, 3).toUpperCase()}`} color={ST.friendly} flash={!!denied}>
                <Puzzle key={`${st.id}-${pKind}`} kind={pKind} onDone={finished} onProgress={setProg} onError={flashDenied} />
              </TermModule>
              {denied ? (
                <View style={styles.deniedWrap} pointerEvents="none">
                  <AccessStamp key={denied} granted={false} reduce={reduce} sub={t('so_close')} />
                </View>
              ) : null}
              <StButton title={t('cancel_task')} tone="ghost" onPress={close} style={{ marginTop: 12 }} />
            </View>
          )}
        </SafeAreaView>
      </View>
    )
  }

  return (
    <Modal visible={!!visible || step === 'granted'} animationType="slide" presentationStyle="fullScreen" onRequestClose={step === 'granted' ? () => setStep('scan') : close}>
      {body}
    </Modal>
  )
}

/** Targeting reticle: corner brackets, crosshair ticks, rotating ring and a sweep line. */
function Reticle({ reduce, live, children }) {
  const t = useT(B)
  const spin = useRef(new Animated.Value(0)).current
  const sweep = useRef(new Animated.Value(0)).current
  const [size, setSize] = useState(300)
  useEffect(() => {
    if (reduce || !live) { spin.setValue(0); sweep.setValue(0.5); return undefined }
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }))
    const b = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    a.start(); b.start()
    return () => { a.stop(); b.stop() }
  }, [reduce, live, spin, sweep])
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, size - 2] })
  const c = live ? ST.friendly : ST.faint
  return (
    <View style={styles.reticle} onLayout={(e) => setSize(e.nativeEvent.layout.height)}>
      {children}
      <Animated.View style={[styles.ring, { borderColor: withAlpha(c, 0.35), transform: [{ rotate }] }]} />
      <View style={[styles.tickH, { left: -14, backgroundColor: c }]} />
      <View style={[styles.tickH, { right: -14, backgroundColor: c }]} />
      <View style={[styles.tickV, { top: -14, backgroundColor: c }]} />
      <View style={[styles.tickV, { bottom: -14, backgroundColor: c }]} />
      <View style={[styles.cross, { backgroundColor: withAlpha(c, 0.8) }]} />
      <View style={[styles.cross, { transform: [{ rotate: '90deg' }], backgroundColor: withAlpha(c, 0.8) }]} />
      {live ? (
        <Animated.View style={[styles.sweepLine, { transform: [{ translateY }] }]}>
          <View style={{ height: 2, backgroundColor: withAlpha(ST.friendly, 0.85), boxShadow: `0 0 10px ${ST.friendly}` }} />
        </Animated.View>
      ) : null}
      <Brackets color={c} size={30} thick={3} />
      <Text style={[styles.retLabel, { color: c }]}>{live ? t('scanning_caps') : t('optics_offline')}</Text>
    </View>
  )
}

/** Cosmetic signal readouts. There is no automatic image match: the player confirms. */
function ScanReadouts({ reduce, live }) {
  const t = useT(B)
  const signal = useTicker(live && !reduce, 700, () => 84 + Math.floor(Math.random() * 14), 91)
  const dots = useTicker(live && !reduce, 450, (d) => (d + 1) % 4, 3)
  return (
    <View style={[styles.statRow, { marginBottom: 10 }]}>
      <Readout label={t('ro_signal')} value={live ? `${String(signal).padStart(3, '0')}%` : '---'} color={live ? ST.health : ST.faint} />
      <Readout label={t('ro_optics')} value={live ? `${t('scanning_caps')}${'.'.repeat(dots)}` : t('offline_caps')} color={live ? ST.friendly : ST.enemy} />
      <Readout label={t('ro_match')} value={t('confirm_caps')} color={ST.objective} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },
  topRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  reticleWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: '78%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  ghost: { ...StyleSheet.absoluteFill, opacity: 0.35, borderRadius: ST.radius },
  ring: { position: 'absolute', width: '62%', aspectRatio: 1, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed' },
  tickH: { position: 'absolute', top: '50%', width: 22, height: 2, marginTop: -1 },
  tickV: { position: 'absolute', left: '50%', width: 2, height: 22, marginLeft: -1 },
  cross: { position: 'absolute', width: 18, height: 1.5 },
  sweepLine: { position: 'absolute', top: 0, left: 0, right: 0 },
  retLabel: { position: 'absolute', bottom: -22, left: 0, ...termType.mono, fontSize: 10, letterSpacing: 2 },
  refCard: { width: 96, alignItems: 'center', backgroundColor: ST.panelStrong, borderRadius: ST.radius, padding: 6, borderTopWidth: 2, borderTopColor: ST.objective },
  refImg: { width: 84, height: 84 },
  refText: { ...stType.label, fontSize: 9, letterSpacing: 1, color: ST.text, marginTop: 4, textAlign: 'center' },
  statRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  stampArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deniedWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 60, alignItems: 'center', justifyContent: 'center' },
})
