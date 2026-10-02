// Per-device arcade preferences (sound, haptics, laser tag aim mode, HUD side,
// minimap). Stored locally; these are personal comfort settings, not game state.
import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'

const KEY = 'arcade_prefs_v1'

export const DEFAULT_PREFS = {
  sound: true, // "Sounds": firing and getting hit
  haptics: true, // "Vibration": rumble when you fire and when you're hit
  aimMode: 'auto', // auto | trigger | top | camera
  handed: 'right', // right | left
  minimap: true,
  targetLock: true, // Laser Tag: live person detection brackets (uses more battery)
}

let prefs = { ...DEFAULT_PREFS }
let loaded = false
const changedBeforeLoad = {} // settings changed before storage was read win over stored ones
const listeners = new Set()

async function load() {
  if (loaded) return
  loaded = true
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw), ...changedBeforeLoad }
    listeners.forEach((l) => l(prefs))
  } catch {
    // Defaults are fine.
  }
}

export function getPrefs() {
  return prefs
}

export function setPref(key, value) {
  changedBeforeLoad[key] = value
  prefs = { ...prefs, [key]: value }
  listeners.forEach((l) => l(prefs))
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {})
}

export function useGamePrefs() {
  const [p, setP] = useState(prefs)
  useEffect(() => {
    listeners.add(setP)
    load()
    setP(prefs)
    return () => { listeners.delete(setP) }
  }, [])
  return p
}

// Haptic feedback that respects the player's setting.
export function buzz(kind = 'light') {
  if (!prefs.haptics) return
  try {
    let p
    if (kind === 'success') p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    else if (kind === 'error') p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    else if (kind === 'warning') p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    else if (kind === 'heavy') p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    else if (kind === 'medium') p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    else if (kind === 'select') p = Haptics.selectionAsync()
    else p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    p?.catch?.(() => {})
  } catch {
    // No haptics engine.
  }
}

// Play an expo-audio player from the start, if sound is on.
export function playSound(player) {
  if (!prefs.sound || !player) return
  try {
    const r = player.seekTo(0)
    if (r && typeof r.catch === 'function') r.catch(() => {})
    player.play()
  } catch {
    // Sound is a nice-to-have.
  }
}
