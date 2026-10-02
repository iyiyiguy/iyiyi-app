import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

// Asks for permission and returns this device's Expo push token, or null if the
// user declined or a token couldn't be created.
export async function registerForPush() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('nearby', {
        name: 'Nearby',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }
    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return null
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    return token.data
  } catch (e) {
    console.warn('Push registration failed', e)
    return null
  }
}
