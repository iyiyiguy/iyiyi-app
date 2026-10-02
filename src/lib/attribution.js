// Install attribution (AppsFlyer). Optional: it only runs when a dev key is configured
// (EXPO_PUBLIC_APPSFLYER_DEV_KEY), and every call is guarded so attribution can never take the
// app down. Build 102 crashed on launch because react-native-appsflyer v7 no longer exposes the
// v6 `initSdk` API ("undefined is not a function" inside a startup effect -> RCTFatal).
const DEV_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY
let sdk = null
let initialized = false

function getSdk() {
  if (!DEV_KEY) return null
  if (sdk) return sdk
  try {
    const mod = require('react-native-appsflyer')
    sdk = mod?.default ?? mod?.AppsFlyer ?? mod
  } catch {
    sdk = null
  }
  return sdk
}

function call(name, ...args) {
  try {
    const s = getSdk()
    const fn = s && s[name]
    if (typeof fn === 'function') return fn.apply(s, args)
  } catch (e) {
    console.warn(`AppsFlyer ${name} failed`, e)
  }
  return undefined
}

export function initAttribution() {
  if (initialized) return
  initialized = true
  const opts = {
    devKey: DEV_KEY,
    appId: '6445996160',
    isDebug: false,
    onInstallConversionDataListener: true,
    onDeepLinkListener: true,
    timeToWaitForATTUserAuthorization: 10,
  }
  const s = getSdk()
  if (!s) return
  // v6 API is initSdk(options, ok, err); newer releases renamed it. Use whichever exists.
  if (typeof s.initSdk === 'function') call('initSdk', opts, () => {}, (err) => console.warn('AppsFlyer init failed', err))
  else if (typeof s.init === 'function') call('init', opts)
  else if (typeof s.start === 'function') call('start', opts)
}

export function logSignup(userId) {
  call('logEvent', 'af_complete_registration', { af_customer_user_id: userId })
}

export function logSubscriptionPurchase(tier, priceUsd) {
  call('logEvent', 'af_subscribe', { af_content_id: tier, af_revenue: priceUsd, af_currency: 'USD' })
}
