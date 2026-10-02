import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'iyiyi_trim_hands_free'

// On by default: hands-free posts trim the last 5 seconds (see CameraScreen) so nobody has
// to edit themselves out walking up to hit stop. The full clip always still saves to the
// phone either way - this only affects what gets posted.
export async function loadTrimHandsFreePref() {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'off'
  } catch {
    return true
  }
}

export async function saveTrimHandsFreePref(on) {
  try {
    await AsyncStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not worth interrupting anyone over a preference failing to persist.
  }
}
