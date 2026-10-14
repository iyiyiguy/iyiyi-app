// Doing a task at a station: point the camera at the real object (matching the
// reference photo), then solve the station's puzzle.
import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../../components/CameraGate'
import { ST, StButton, StPanel, stShadow, stType } from '../studio'
import { StationImage } from './StationImage'
import { PUZZLES, Puzzle } from './Puzzles'
import { buzz } from '../../lib/gamePrefs'

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
                <Text style={[stType.kicker, stShadow]}>Scan station</Text>
                <Text style={[stType.title, stShadow]} numberOfLines={2}>{station.name}</Text>
                <Text style={[stType.small, { color: ST.text }, stShadow]}>Line the camera up with the object in the photo.</Text>
              </View>
              <Pressable onPress={() => setOverlay((v) => !v)} style={styles.refCard} accessibilityRole="button" accessibilityLabel="Toggle reference overlay">
                <StationImage room={room} station={station} assets={assets} style={styles.refImg} />
                <Text style={styles.refText}>{overlay ? 'Hide overlay' : 'Show overlay'}</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StButton title="Cancel" tone="ghost" onPress={close} style={{ flex: 1, backgroundColor: ST.panelStrong }} />
              <StButton title="It matches" disabled={!perm?.granted} onPress={() => { buzz('medium'); setStep('puzzle') }} style={{ flex: 2 }} />
            </View>
          </SafeAreaView>
        </View>
      ) : (
        <View style={[styles.fill, { backgroundColor: ST.ground }]}>
          <SafeAreaView style={{ flex: 1, padding: 16 }} edges={['top', 'bottom']}>
            <Text style={[stType.kicker, { color: ST.objective }]}>{station.name}{fake ? ' · cover task' : ''}</Text>
            <Text style={[stType.title, { fontSize: 26, marginBottom: 16 }]}>{PUZZLES[puzzle]}</Text>
            <StPanel accent={ST.objective} style={{ marginBottom: 10, paddingVertical: 16 }}>
              <Puzzle kind={puzzle} onDone={() => { setStep('scan'); onDone() }} />
            </StPanel>
            <StButton title="Cancel task" tone="ghost" onPress={close} />
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
  ghostWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ghost: { width: '86%', aspectRatio: 1, opacity: 0.35, borderRadius: ST.radius },
  refCard: { width: 96, alignItems: 'center', backgroundColor: ST.panelStrong, borderRadius: ST.radius, padding: 6, borderTopWidth: 2, borderTopColor: ST.objective },
  refImg: { width: 84, height: 84 },
  refText: { ...stType.label, fontSize: 9, letterSpacing: 1, color: ST.text, marginTop: 4, textAlign: 'center' },
})
