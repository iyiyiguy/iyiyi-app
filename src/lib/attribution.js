// Install attribution (AppsFlyer, react-native-appsflyer 7.x). It only runs when a dev key is
// configured: app.json expo.extra.appsflyerDevKey (the dev key is a client-side key that ships
// inside every app build anyway) or EXPO_PUBLIC_APPSFLYER_DEV_KEY. Every call is guarded so
// attribution can never take the app down (build 102 crashed on launch calling the removed v6
// `initSdk`).
//
// 7.x flow (see node_modules/react-native-appsflyer/MIGRATION.md):
//   registerDeepLinkListener (before init) -> init({devKey, appId}) -> register listeners
//   synchronously -> start() only from registerSessionReadyListener's callback.
// Every 7.x method takes ONE params object and returns a Promise.
//
// Events use AppsFlyer's standard names so they map to Meta / Google / TikTok ad events
// without extra setup: af_complete_registration (sign-up), af_subscribe (Pro purchase),
// af_purchase (arcade items), plus a few app-specific events for funnels.
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const DEV_KEY = Constants.expoConfig?.extra?.appsflyerDevKey || process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY || ''
const IOS_APP_ID = '6445996160' // App Store id (Android uses the package name automatically)

let sdk = null
let initialized = false
let started = false
let pendingUserId = null

export const attributionEnabled = !!DEV_KEY && Platform.OS !== 'web'

function getSdk() {
  if (!attributionEnabled) return null
  if (sdk) return sdk
  try {
    const mod = require('react-native-appsflyer')
    sdk = mod?.default ?? mod?.AppsFlyer ?? mod
  } catch {
    sdk = null
  }
  return sdk
}

// Calls sdk[name](params), swallowing sync throws and promise rejections.
function call(name, params) {
  try {
    const s = getSdk()
    const fn = s && s[name]
    if (typeof fn !== 'function') return undefined
    const r = params === undefined ? fn.call(s) : fn.call(s, params)
    if (r && typeof r.catch === 'function') r.catch((e) => console.warn(`AppsFlyer ${name} failed`, e))
    return r
  } catch (e) {
    console.warn(`AppsFlyer ${name} failed`, e)
  }
  return undefined
}

export function initAttribution() {
  if (initialized) return
  initialized = true
  const s = getSdk()
  if (!s || typeof s.init !== 'function') return
  try {
    // Deep links (from ad clicks / OneLink) must be registered before init on both platforms.
    call('registerDeepLinkListener', { onDeepLinking: () => {} })
    call('init', { devKey: DEV_KEY, appId: Platform.OS === 'ios' ? IOS_APP_ID : undefined })
    if (__DEV__) call('enableDebug', { enabled: true })
    call('registerConversionListener', { onConversionDataSuccess: () => {}, onConversionDataFail: () => {} })
    if (typeof s.registerSessionReadyListener === 'function') {
      s.registerSessionReadyListener(() => {
        const r = call('start')
        const done = () => {
          started = true
          if (pendingUserId) setUser(pendingUserId)
        }
        if (r && typeof r.then === 'function') r.then(done, () => {})
        else done()
      })
    }
  } catch (e) {
    console.warn('AppsFlyer init failed', e)
  }
}

// Ties installs and events to the signed-in member (the Supabase user id, never email/phone).
export function setUser(userId) {
  if (!userId || !attributionEnabled) return
  if (!started) {
    pendingUserId = userId
    return
  }
  call('setCustomerUserId', { customerId: String(userId) })
}

function logEvent(eventName, eventValues) {
  if (!attributionEnabled) return
  call('logEvent', { eventName, eventValues: eventValues || {} })
}

export function logSignup(userId) {
  setUser(userId)
  logEvent('af_complete_registration', { af_registration_method: 'iyiyi' })
}

export function logSubscriptionPurchase(tier, priceUsd) {
  logEvent('af_subscribe', { af_content_id: tier, af_revenue: priceUsd, af_currency: 'USD' })
}

export function logPurchase(productId, priceUsd) {
  logEvent('af_purchase', { af_content_id: productId, af_revenue: priceUsd, af_currency: 'USD', af_quantity: 1 })
}

// App-specific funnel events (show up as custom events in AppsFlyer and can be mapped to ads).
export function logOnboardingDone(intent) {
  logEvent('onboarding_complete', { intent: intent || 'skipped' })
}

export function logFollowEverywhere(platformCount) {
  logEvent('follow_everywhere', { platforms: platformCount || 0 })
}

export function logGameStarted(game) {
  logEvent('game_started', { game })
}
