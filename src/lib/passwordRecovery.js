import { Alert, Platform } from 'react-native'
import { supabase } from './supabase'

// "Forgot password?" flow.
//
// requestPasswordReset() asks Supabase to email a recovery link. The link opens
// RESET_REDIRECT (the web app at app.iyiyi.xyz, the same Expo app built for web). The app has no
// associated domains, so the link always opens in the browser, where the Supabase client parses
// the recovery session out of the URL (detectSessionInUrl) and emits PASSWORD_RECOVERY. The
// listener below then asks for a new password and saves it with updateUser().
//
// OWNER: RESET_REDIRECT must be listed under Supabase > Authentication > URL Configuration >
// Redirect URLs, or Supabase falls back to the project's Site URL.
export const RESET_REDIRECT = 'https://app.iyiyi.xyz/'

export async function requestPasswordReset(email) {
  const clean = String(email ?? '').trim()
  if (!clean) {
    const e = new Error('missing-email')
    e.code = 'missing-email'
    throw e
  }
  const { error } = await supabase.auth.resetPasswordForEmail(clean, { redirectTo: RESET_REDIRECT })
  if (error) throw error
}

const MIN_LENGTH = 6

async function save(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

function askOnWeb() {
  // window.prompt is the only dialog react-native-web offers without a mounted component.
  const first = window.prompt(`Choose a new iYiYi password (at least ${MIN_LENGTH} characters):`)
  if (first == null) return
  if (first.length < MIN_LENGTH) {
    window.alert(`The password needs at least ${MIN_LENGTH} characters. Open the link from the email again to retry.`)
    return
  }
  save(first)
    .then(() => window.alert('Your password has been changed. You can now log in with it in the iYiYi app.'))
    .catch((e) => window.alert(`Couldn't change the password: ${e?.message ?? 'please try again.'}`))
}

function askOnNative() {
  if (Platform.OS !== 'ios' || typeof Alert.prompt !== 'function') {
    Alert.alert('Reset your password', 'Open the link from the email on this device to choose a new password.')
    return
  }
  Alert.prompt(
    'Choose a new password',
    `At least ${MIN_LENGTH} characters.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value) => {
          if (!value || value.length < MIN_LENGTH) {
            Alert.alert('Password too short', `Use at least ${MIN_LENGTH} characters.`)
            return
          }
          save(value)
            .then(() => Alert.alert('Password changed', 'Your new password is saved.'))
            .catch((e) => Alert.alert("Couldn't change the password", e?.message ?? 'Please try again.'))
        },
      },
    ],
    'secure-text',
  )
}

let installed = false
// Registered once when this module is first imported (AuthScreen imports it, and App.js imports
// AuthScreen eagerly), early enough to catch the PASSWORD_RECOVERY event from the URL.
function install() {
  if (installed) return
  installed = true
  try {
    supabase.auth.onAuthStateChange((event) => {
      if (event !== 'PASSWORD_RECOVERY') return
      setTimeout(() => (Platform.OS === 'web' ? askOnWeb() : askOnNative()), 400)
    })
  } catch {
    // Never break app start-up over this.
  }
}
install()
