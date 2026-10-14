// Notifications are offered after the first follow (a moment where they're clearly useful),
// never on launch. One short explainer, then the phone's own prompt only if they say yes.
// Asked once per device; Settings > "notify nearby" stays the way to change it later.
import { Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { registerForPush } from './push'
import { patch } from './api'

const KEY = 'iyiyi_push_offer_shown_v1'
let busy = false

export async function maybeOfferPushAfterFollow() {
  if (busy) return
  busy = true
  try {
    if (await AsyncStorage.getItem(KEY)) return
    const cur = await Notifications.getPermissionsAsync()
    if (cur?.status !== 'undetermined') { await AsyncStorage.setItem(KEY, 'true'); return }
    await AsyncStorage.setItem(KEY, 'true')
    Alert.alert(
      'Know when they follow back?',
      'Turn on notifications to hear when people follow you back or someone you follow is nearby.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Turn on',
          onPress: async () => {
            const token = await registerForPush()
            if (token) patch('/api/profiles/me', { notify_nearby: true, push_token: token }).catch(() => {})
          },
        },
      ],
    )
  } catch {
    // Optional nicety; never block a follow on it.
  } finally {
    busy = false
  }
}
