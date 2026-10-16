// Web build: no install attribution (AppsFlyer / Meta SDK are native-only). Every export of
// attribution.js must exist here as a no-op, or the web app crashes calling it.
export const attributionEnabled = false
export function initAttribution() {}
export function setUser() {}
export function logSignup() {}
export function logSubscriptionPurchase() {}
export function logPurchase() {}
export function logOnboardingDone() {}
export function logFollowEverywhere() {}
export function logGameStarted() {}
