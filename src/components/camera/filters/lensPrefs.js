import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeLens, normalizeLook } from './lenses'

// The chosen lens, look and frame, remembered on this phone. Kept apart from the camera options
// (lib/cameraPrefs) because those only know the original three filters. Never throws.
const KEY = 'iyiyi.camera.lens.v1'
export const DEFAULT_LENS_PREFS = { lens: 'none', look: 'none', frame: false }

export async function loadLensPrefs(legacyFilter) {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) {
      const o = JSON.parse(raw) || {}
      return { lens: normalizeLens(o.lens), look: normalizeLook(o.look), frame: !!o.frame }
    }
  } catch {}
  // First run with the new lenses: carry over a filter picked before (logo / nametag / love).
  return { ...DEFAULT_LENS_PREFS, lens: normalizeLens(legacyFilter) }
}

export async function saveLensPrefs(p) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ lens: normalizeLens(p?.lens), look: normalizeLook(p?.look), frame: !!p?.frame }))
  } catch {}
}
