// Doing a task at a station: point the camera at the real object (matching the
// reference photo), then solve the station's puzzle.
import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../../components/CameraGate'
import { Btn, Card } from '../MultiplayerUI'
import { hudShadow } from '../laser/Hud'
import { StationImage } from './StationImage'
import { PUZZLES, Puzzle } from './Puzzles'
import { buzz } from '../../lib/gamePrefs'
import { colors, radii, type } from '../../theme'

export function ScanTask({ visible, room, station, assets, puzzle, fake, onClose, onDone }) {
  const [perm] = useCameraGate(visible)
  const [step, setStep] = useState('scan')
  const [overlay, setOverlay] = useState(true)
  const close = () => { setStep('scan'); onClose() }
  if (!station) return null

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {step === 'scan' ? (
        <View style={styles.fill}>
          {perm?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              {perm && !perm.granted && perm.status === 'denied' ? <CameraOff what="scanning stations" compact /> : null}
            </View>
          )}
          {overlay && (
            <View style={styles.ghostWrap} pointerEvents="none">
              <StationImage room={room} station={station} assets={assets} style={styles.ghost} />
            </View>
          )}
          <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={[type.title, { color: colors.onBrand }, hudShadow]}>Scan: {station.name}</Text>
                <Text style={[type.caption, { color: colors.onBrand }, hudShadow]}>Line the camera up with the object in the photo.</Text>
              </View>
              <Pressable onPress={() => setOverlay((v) => !v)} style={styles.refCard} accessibilityRole="button" accessibilityLabel="Toggle reference overlay">
                <StationImage room={room} station={station} assets={assets} style={styles.refImg} />
                <Text style={styles.refText}>{overlay ? 'Hide overlay' : 'Show overlay'}</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Cancel" onPress={close} style={{ flex: 1 }} />
              <Btn title="It matches" variant="primary" disabled={!perm?.granted} onPress={() => { buzz('medium'); setStep('puzzle') }} style={{ flex: 2 }} />
            </View>
          </SafeAreaView>
        </View>
      ) : (
        <View style={[styles.fill, { backgroundColor: colors.ink }]}>
          <SafeAreaView style={{ flex: 1, padding: 16 }} edges={['top', 'bottom']}>
            <Text style={type.label}>{station.name}{fake ? ' · cover task' : ''}</Text>
            <Text style={[type.display, { marginBottom: 16 }]}>{PUZZLES[puzzle]}</Text>
            <Card>
              <Puzzle kind={puzzle} onDone={() => { setStep('scan'); onDone() }} />
            </Card>
            <Btn title="Cancel task" onPress={close} style={{ marginTop: 8 }} />
          </SafeAreaView>
        </View>
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },
  topRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  ghostWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ghost: { width: '86%', aspectRatio: 1, opacity: 0.35, borderRadius: radii.lg },
  refCard: { width: 96, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radii.sm, padding: 6 },
  refImg: { width: 84, height: 84 },
  refText: { fontSize: 10, color: colors.onBrand, marginTop: 4 },
})
