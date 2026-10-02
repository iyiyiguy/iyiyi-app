import { Appearance } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'iyiyi_theme_pref'

export const THEME_OPTIONS = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

function apply(pref) {
  // null hands control back to the device's setting.
  Appearance.setColorScheme(pref === 'light' || pref === 'dark' ? pref : 'unspecified')
}

export async function loadThemePref() {
  try {
    const pref = (await AsyncStorage.getItem(KEY)) ?? 'system'
    apply(pref)
    return pref
  } catch {
    return 'system'
  }
}

export async function saveThemePref(pref) {
  apply(pref)
  try {
    await AsyncStorage.setItem(KEY, pref)
  } catch {}
}
