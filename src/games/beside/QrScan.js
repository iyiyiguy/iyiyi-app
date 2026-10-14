// Camera QR scanning for Beside Them marker stations (expo-camera's built-in barcode
// scanner, QR only). QrCamera is the bare camera layer; QrScanSheet is a full-screen
// "scan any station code" sheet used from the game screen.
import React, { useRef } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../../components/CameraGate'
import { ST, StButton, stShadow, stType } from '../studio'
import { Brackets, TERM, TermBackdrop, termType, useReduceMotion } from './terminal'
import { parseQrPayload } from './engine'

const SCANNER = { barcodeTypes: ['qr'] }

/**
 * Camera that reports Beside Them station codes. onScan({ id, code }) fires for valid
 * payloads (the same code is ignored for 1.5 s); onOther(text) for any other QR.
 */
export function QrCamera({ active, onScan, onOther }) {
  const [perm] = useCameraGate(active)
  const last = useRef({ text: null, at: 0 })
  const handle = (res) => {
    const text = res?.data
    if (!active || typeof text !== 'string') return
    const t = Date.now()
    if (last.current.text === text && t - last.current.at < 1500) return
    last.current = { text, at: t }
    const parsed = parseQrPayload(text)
    if (parsed) onScan?.(parsed)
    else onOther?.(text)
  }
  if (!perm?.granted) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: TERM.ground }]}>
        {perm && perm.status === 'denied' ? <CameraOff what="scanning station codes" compact /> : null}
      </View>
    )
  }
  return <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={SCANNER} onBarcodeScanned={active ? handle : undefined} />
}

/** Square viewfinder frame drawn over the camera. */
export function QrFrame({ label = 'Point at a station code' }) {
  return (
    <View style={styles.frameWrap} pointerEvents="none">
      <View style={styles.frame}>
        <Brackets color={ST.friendly} size={34} thick={4} />
      </View>
      <Text style={[termType.mono, styles.frameLabel, stShadow]}>{label}</Text>
    </View>
  )
}

export function QrScanSheet({ visible, onClose, onScan, title = 'Scan a station', hint, error }) {
  const reduce = useReduceMotion()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.fill}>
        <QrCamera active={visible} onScan={onScan} />
        <TermBackdrop overCamera reduce={reduce} />
        <QrFrame />
        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View>
            <Text style={[stType.kicker, stShadow]}>Station codes</Text>
            <Text style={[stType.title, stShadow]}>{title}</Text>
            <Text style={[termType.mono, { color: ST.text }, stShadow]}>&gt; {hint || 'Find a printed code and fill the square with it.'}</Text>
          </View>
          <View>
            {error ? <Text style={[stType.small, styles.error, stShadow]}>{error}</Text> : null}
            <StButton title="Close" tone="ghost" onPress={onClose} style={{ backgroundColor: ST.panelStrong }} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '68%', aspectRatio: 1 },
  frameLabel: { color: ST.text, marginTop: 14, letterSpacing: 1.5 },
  error: { color: ST.objective, marginBottom: 10, textAlign: 'center' },
})
