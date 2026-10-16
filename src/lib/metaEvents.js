// Meta (Facebook) app events for Meta ads: install attribution, optimisation and lookalikes.
// Only active when the build included the Meta SDK (FACEBOOK_CLIENT_TOKEN at build time ->
// app.config.js sets extra.metaSdk and links react-native-fbsdk-next). Every call is guarded so
// analytics can never take the app down. Standard Meta event names are used where they exist so
// Ads Manager can optimise for them without custom conversions.
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const enabled = !!Constants.expoConfig?.extra?.metaSdk && Platform.OS !== 'web'
let mod = null
let initialized = false

function sdk() {
  if (!enabled) return null
  if (mod) return mod
  try {
    mod = require('react-native-fbsdk-next')
  } catch {
    mod = null
  }
  return mod
}

function safe(fn) {
  try {
    const m = sdk()
    if (m) fn(m)
  } catch (e) {
    console.warn('Meta SDK call failed', e)
  }
}

export function initMeta() {
  if (initialized) return
  initialized = true
  safe((m) => {
    m.Settings?.initializeSDK?.()
  })
}

export function metaSetUser(userId) {
  if (!userId) return
  safe((m) => m.AppEventsLogger?.setUserID?.(String(userId)))
}

export function metaLog(eventName, params) {
  safe((m) => m.AppEventsLogger?.logEvent?.(eventName, params || {}))
}

export function metaRegistration() {
  safe((m) => {
    const name = m.AppEventsLogger?.AppEvents?.CompletedRegistration || 'fb_mobile_complete_registration'
    m.AppEventsLogger?.logEvent?.(name, { fb_registration_method: 'iyiyi' })
  })
}

export function metaSubscribe(tier, priceUsd) {
  safe((m) => {
    const L = m.AppEventsLogger
    if (priceUsd > 0) L?.logPurchase?.(priceUsd, 'USD', { fb_content_id: tier, fb_content_type: 'subscription' })
    L?.logEvent?.('Subscribe', { fb_content_id: tier, fb_currency: 'USD', _valueToSum: priceUsd || 0 })
  })
}

export function metaPurchase(productId) {
  metaLog('arcade_purchase', { fb_content_id: productId })
}
