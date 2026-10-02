// "Invite by text": a ready-made message with the lobby code, the App Store link and a deep
// link (iyiyi://join/CODE, handled by App.js LINKING -> JoinGame), sent through Messages
// (sms: URL) or the system share sheet. Never throws.
import { ActionSheetIOS, Alert, Linking, Platform, Share } from 'react-native'

export const APP_STORE_URL = 'https://apps.apple.com/app/id6445996160'

export const joinDeepLink = (code) => `iyiyi://join/${encodeURIComponent(String(code || '').toUpperCase())}`

export function inviteMessage({ gameName, code } = {}) {
  const c = String(code || '').toUpperCase()
  const game = gameName ? `${gameName} ` : ''
  if (!c) return `Play ${game || 'games '}with me on iYiYi! Get the app: ${APP_STORE_URL}`
  return `Join my iYiYi ${game}lobby! Code ${c}. Get the app: ${APP_STORE_URL} — then tap ${joinDeepLink(c)}`
}

export async function shareInvite(opts) {
  try {
    await Share.share({ message: inviteMessage(opts) })
    return true
  } catch {
    return false
  }
}

// Opens Messages with the text prefilled. iOS wants "sms:&body=", Android "sms:?body=".
export async function smsInvite(opts) {
  const body = encodeURIComponent(inviteMessage(opts))
  const url = Platform.OS === 'ios' ? `sms:&body=${body}` : `sms:?body=${body}`
  try {
    await Linking.openURL(url)
    return true
  } catch {
    // No Messages (simulator / iPad without SMS): fall back to the share sheet.
    return shareInvite(opts)
  }
}

// One button: on iOS offers Messages or the share sheet; elsewhere goes straight to share.
export function inviteByText(opts) {
  try {
    if (Platform.OS === 'ios' && ActionSheetIOS?.showActionSheetWithOptions) {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Invite by text',
          message: opts?.code ? `Lobby code ${String(opts.code).toUpperCase()}` : undefined,
          options: ['Messages', 'More options…', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) smsInvite(opts)
          else if (i === 1) shareInvite(opts)
        },
      )
      return
    }
    shareInvite(opts)
  } catch {
    Alert.alert('Couldn’t open sharing', 'Please try again.')
  }
}
