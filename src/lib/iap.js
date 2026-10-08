import { Platform } from 'react-native'
import * as RNIap from 'react-native-iap'
import { _creditUavs, _creditGrenades, _grantItems } from './arcadeStats'

// These must match the product IDs you create in App Store Connect
// (Subscriptions) and Google Play Console (Monetize > Subscriptions).
export const SKUS = {
  premium: Platform.select({
    ios: 'com.iyiyi.app.premium.monthly',
    android: 'iyiyi_premium_monthly',
  }),
  creator: Platform.select({
    ios: 'com.iyiyi.app.creator.monthly',
    android: 'iyiyi_creator_monthly',
  }),
  pro: Platform.select({
    ios: 'com.iyiyi.app.pro.all.monthly',
    android: 'iyiyi_pro_monthly',
  }),
}

let connected = false

// Never let a store call hang the UI: resolves the call's result, or rejects after `ms`.
function withTimeout(promise, ms, message = 'The App Store is taking too long to answer. Please try again.') {
  let t
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms) }),
  ]).finally(() => clearTimeout(t))
}

const SLOW_STORE = 'The App Store is taking longer than usual. If you were charged, tap Restore Purchases and it will unlock.'

// Purchases this Apple ID / Google account already owns (empty if the store doesn't answer quickly).
async function ownedPurchases() {
  try {
    return (await withTimeout(RNIap.getAvailablePurchases(), 12000)) ?? []
  } catch {
    return []
  }
}

export async function initIAP() {
  if (connected) return
  await RNIap.initConnection()
  connected = true
}

export const isUserCancelled = (e) => e?.code === 'user-cancelled' || e?.code === 'E_USER_CANCELLED'

// Google Play requires the buyer's chosen offer to be passed explicitly. Prefer the offer
// with an introductory phase (the $1 for 3 months offer) and fall back to the first one.
async function androidOffers(sku) {
  const products = await RNIap.fetchProducts({ skus: [sku], type: 'subs' })
  const product = (products ?? []).find((p) => p.id === sku)
  const offers = product?.subscriptionOffers ?? []
  const withIntro = offers.find((o) => (o.pricingPhasesAndroid?.pricingPhaseList?.length ?? 0) > 1)
  const offer = withIntro ?? offers[0]
  if (!offer?.offerTokenAndroid) throw new Error('This subscription is not available yet. Please try again later.')
  return [{ sku, offerToken: offer.offerTokenAndroid }]
}

const PERIOD_LABEL = { day: 'day', week: 'week', month: 'month', year: 'year' }
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`

// Localized store pricing for a tier, straight from App Store / Google Play, so
// the UI never hardcodes a price. Resolves null if the store can't be reached.
// { displayPrice: '$9.99', period: 'month', introText: '$0.99/month for 3 months' | null }
export async function fetchSubscriptionInfo(tier) {
  await initIAP()
  const sku = SKUS[tier]
  const products = (await RNIap.fetchProducts({ skus: [sku], type: 'subs' })) ?? []
  const product = products.find((p) => p.id === sku)
  if (!product) return null

  let period = 'month'
  let introText = null

  if (Platform.OS === 'ios') {
    period = PERIOD_LABEL[product.subscriptionPeriodUnitIOS] ?? 'month'
    const intro = (product.subscriptionOffers ?? []).find((o) => o.type === 'introductory')
    let eligible = true
    if (product.subscriptionGroupIdIOS) {
      eligible = await RNIap.isEligibleForIntroOfferIOS(product.subscriptionGroupIdIOS).catch(() => true)
    }
    if (intro && eligible) {
      const unit = PERIOD_LABEL[intro.period?.unit] ?? period
      const count = intro.periodCount ?? intro.numberOfPeriodsIOS ?? 1
      if (intro.paymentMode === 'free-trial') introText = `Free for ${plural(count * (intro.period?.value ?? 1), unit)}`
      else if (intro.paymentMode === 'pay-up-front') introText = `${intro.displayPrice} for ${plural(count * (intro.period?.value ?? 1), unit)}`
      else introText = `${intro.displayPrice}/${unit} for ${plural(count, unit)}`
    }
    return { displayPrice: product.displayPrice, period, introText }
  }

  // Android: base price is the last (recurring) pricing phase; an earlier finite phase is the intro.
  const offers = product.subscriptionOffers ?? []
  const withIntro = offers.find((o) => (o.pricingPhasesAndroid?.pricingPhaseList?.length ?? 0) > 1)
  const phases = (withIntro ?? offers[0])?.pricingPhasesAndroid?.pricingPhaseList ?? []
  const base = phases[phases.length - 1]
  const billingUnit = (iso) => ({ D: 'day', W: 'week', M: 'month', Y: 'year' })[iso?.slice(-1)] ?? 'month'
  if (base) period = billingUnit(base.billingPeriod)
  if (phases.length > 1) {
    const intro = phases[0]
    const unit = billingUnit(intro.billingPeriod)
    const perCycle = Number(/P(\d+)/.exec(intro.billingPeriod ?? '')?.[1] ?? 1)
    const total = perCycle * (intro.billingCycleCount || 1)
    introText = intro.priceAmountMicros === '0'
      ? `Free for ${plural(total, unit)}`
      : `${intro.formattedPrice}${perCycle === 1 ? `/${unit}` : ''} for ${plural(total, unit)}`
  }
  return { displayPrice: base?.formattedPrice ?? product.displayPrice, period, introText }
}

// iOS is verified server-side from the app receipt; Android from the purchase token.
// The receipt the backend verifies. On iOS the app receipt can be missing right after a
// StoreKit 2 purchase (common on TestFlight / sandbox, where it surfaced as
// "purchase-verification-failed"), so: try it, then refresh it once, then fall back to the
// purchase's own signed StoreKit transaction (JWS).
async function receiptFor(purchase) {
  if (Platform.OS !== 'ios') return purchase.purchaseToken || purchase.purchaseTokenAndroid
  // StoreKit 2: the purchase's own signed transaction (JWS). Our server verifies it directly,
  // and using it avoids the old-receipt refresh that makes iOS ask for the Apple ID password
  // a second time.
  const signed = purchase.purchaseToken || purchase.jwsRepresentationIOS
  if (typeof signed === 'string' && signed.split('.').length === 3) return signed
  // Each step is time-limited: a receipt refresh can sit waiting forever in the sandbox.
  try {
    const r = await withTimeout(RNIap.getReceiptDataIOS(), 8000)
    if (r) return r
  } catch {}
  try {
    const r = await withTimeout(RNIap.requestReceiptRefreshIOS(), 12000)
    if (r) return r
  } catch {}
  try {
    const r = await withTimeout(RNIap.getReceiptDataIOS(), 5000)
    if (r) return r
  } catch {}
  const jws = purchase.purchaseToken || purchase.jwsRepresentationIOS
  if (jws) return jws
  throw new Error('Could not read the App Store receipt. Please tap Restore Purchases.')
}

// Verifies with our backend; if Apple says the receipt doesn't show the purchase yet (a stale
// cached receipt is common right after buying in the sandbox), refresh it once and try again.
async function verifyFresh(purchase, payload, verifyWithBackend) {
  const receipt = await receiptFor(purchase)
  try {
    return await verifyWithBackend({ ...payload, receipt })
  } catch (e) {
    if (Platform.OS !== 'ios' || e?.code === 'expired') throw e
    let fresh = null
    try { fresh = await withTimeout(RNIap.requestReceiptRefreshIOS(), 15000) } catch {}
    if (!fresh || fresh === receipt) throw e
    return verifyWithBackend({ ...payload, receipt: fresh })
  }
}

// Our server knows the Pro plan as 'pro_all' (product com.iyiyi.app.pro.all.monthly).
export const BACKEND_TIER = { pro: 'pro_all' }

// Buys a subscription, then hands the platform receipt to our backend for verification.
// In react-native-iap v16 the purchase result arrives through listeners rather than the
// return value, so this wraps them in a promise that resolves once the backend has
// confirmed and activated the tier. The transaction is only finished after the backend
// accepts it, so a rejected receipt is never silently consumed.
export async function purchaseSubscription(tier, verifyWithBackend) {
  await withTimeout(initIAP(), 15000)
  const sku = SKUS[tier]

  // Already subscribed on this Apple ID (e.g. an earlier purchase whose activation failed)?
  // The store won't sell it again and just shows "You're already subscribed", which used to
  // leave the button spinning. Activate the existing subscription instead.
  const owned = (await ownedPurchases()).find((p) => p?.productId === sku)
  if (owned) {
    try {
      await verifyFresh(owned, { tier, platform: Platform.OS, productId: sku }, verifyWithBackend)
      try { await RNIap.finishTransaction({ purchase: owned, isConsumable: false }) } catch {}
      return
    } catch (e) {
      // Not active any more (e.g. it ran out): fall through and buy it again.
      if (e?.code !== 'expired') throw e
    }
  }

  const offers = Platform.OS === 'android' ? await withTimeout(androidOffers(sku), 15000) : undefined

  return new Promise((resolve, reject) => {
    let settled = false
    const subscriptions = []
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subscriptions.forEach((s) => s.remove())
      fn(value)
    }
    // Never spin forever: a late purchase is picked up by Restore Purchases.
    const timer = setTimeout(() => settle(reject, new Error(SLOW_STORE)), 120000)

    subscriptions.push(
      RNIap.purchaseUpdatedListener(async (purchase) => {
        if (purchase.productId !== sku) return
        if (purchase.purchaseState === 'pending') {
          settle(reject, new Error('Your purchase is waiting for approval. Pro turns on as soon as it goes through.'))
          return
        }
        try {
          await verifyFresh(purchase, { tier, platform: Platform.OS, productId: sku }, verifyWithBackend)
          await RNIap.finishTransaction({ purchase, isConsumable: false })
          settle(resolve)
        } catch (e) {
          settle(reject, e)
        }
      }),
    )
    subscriptions.push(RNIap.purchaseErrorListener((error) => settle(reject, error)))

    RNIap.requestPurchase({
      request: {
        apple: { sku },
        google: { skus: [sku], subscriptionOffers: offers },
      },
      type: 'subs',
    }).catch((e) => settle(reject, e))
  })
}

const SKU_TO_TIER = Object.fromEntries(Object.entries(SKUS).map(([tier, sku]) => [sku, tier]))

// Required by Apple for any app with subscriptions: re-checks the store for
// purchases already owned by this Apple/Google account and re-activates
// them server-side, without charging again.
export async function restorePurchases(verifyWithBackend) {
  await withTimeout(initIAP(), 15000)
  const purchases = (await withTimeout(RNIap.getAvailablePurchases(), 30000)) ?? []

  const restored = []
  let lastError = null
  for (const purchase of purchases) {
    const tier = SKU_TO_TIER[purchase.productId]
    if (!tier || restored.includes(tier)) continue
    try {
      await verifyFresh(purchase, { tier, platform: Platform.OS, productId: purchase.productId }, verifyWithBackend)
      restored.push(tier)
    } catch (e) {
      lastError = e
    }
  }
  if (!restored.length && lastError) throw lastError
  return restored
}

// ---------------------------------------------------------------------------
// Consumables: Laser Tag UAV packs. App Store Connect product type: Consumable.
// ---------------------------------------------------------------------------

// Display order = store order. `count` is what each product credits.
export const UAV_PACKS = [
  { id: 'uav5', count: 5, sku: Platform.select({ ios: 'com.iYiYi.uav5', android: 'iyiyi_uav5' }), refPrice: 0.99 },
  { id: 'uav20', count: 20, sku: Platform.select({ ios: 'com.iYiYi.uav20', android: 'iyiyi_uav20' }), refPrice: 1.99, ribbon: 'Most popular' },
  { id: 'uav50', count: 50, sku: Platform.select({ ios: 'com.iYiYi.uav50', android: 'iyiyi_uav50' }), refPrice: 3.99, ribbon: 'Best value' },
  { id: 'uav120', count: 120, sku: Platform.select({ ios: 'com.iYiYi.uav120', android: 'iyiyi_uav120' }), refPrice: 7.99 },
]
const PACK_BY_SKU = Object.fromEntries(UAV_PACKS.map((p) => [p.sku, p]))
export const UAV_SKUS = UAV_PACKS.map((p) => p.sku)
// Back-compat (single 20-pack API).
export const UAV_SKU = PACK_BY_SKU[UAV_PACKS[1].sku].sku
export const UAV_PACK_SIZE = 20
export const isUavSku = (sku) => !!PACK_BY_SKU[sku]

const uavWaiters = new Set() // { sku, done, pending, fail }
let uavSubs = null

// Credits the right pack once per store transaction, THEN finishes (consumes) it. If
// finishing fails the store redelivers the transaction and the id dedupe stops a double credit.
async function handleUavPurchase(purchase) {
  const pack = PACK_BY_SKU[purchase?.productId]
  if (!pack) return
  const waiters = [...uavWaiters].filter((w) => w.sku === pack.sku)
  if (purchase.purchaseState === 'pending') {
    waiters.forEach((w) => w.pending())
    return
  }
  try {
    const qty = Math.max(1, Math.min(10, Number(purchase.quantity) || 1))
    const txnId = purchase.id || purchase.purchaseToken || `${purchase.productId}:${purchase.transactionDate}`
    const res = await _creditUavs(pack.count * qty, txnId)
    try {
      await RNIap.finishTransaction({ purchase, isConsumable: true })
    } catch (e) {
      console.warn('iap: finishTransaction (uav) failed', e)
    }
    waiters.forEach((w) => w.done({ ...res, count: pack.count * qty }))
  } catch (e) {
    waiters.forEach((w) => w.fail(e))
  }
}

/**
 * Keeps one app-wide listener for UAV purchases so a purchase that completes outside
 * the buy flow (Ask to Buy approval, an interrupted transaction, app relaunch) is still
 * credited. Safe to call repeatedly. Never throws.
 */
export function ensureUavListener() {
  if (uavSubs) return
  try {
    uavSubs = [
      RNIap.purchaseUpdatedListener((purchase) => {
        if (!isUavSku(purchase?.productId)) return
        handleUavPurchase(purchase)
      }),
      RNIap.purchaseErrorListener((error) => {
        const sku = error?.productId
        if (sku && !isUavSku(sku)) return
        uavWaiters.forEach((w) => { if (!sku || w.sku === sku) w.fail(error) })
      }),
    ]
  } catch (e) {
    uavSubs = null
    console.warn('iap: could not attach UAV listener', e)
  }
}

let uavRecovered = false
/** Once per launch: credit + finish any unfinished UAV transactions. Never throws. */
export async function recoverUavPurchases() {
  if (uavRecovered) return
  uavRecovered = true
  try {
    await initIAP()
    ensureUavListener()
    const purchases = (await RNIap.getAvailablePurchases()) ?? []
    for (const p of purchases) {
      if (isUavSku(p?.productId) && p.purchaseState !== 'pending') await handleUavPurchase(p)
    }
  } catch {
    uavRecovered = false // try again next time
  }
}

/**
 * Localized store info for every UAV pack: { [sku]: { displayPrice, price? } }. A pack the
 * store doesn't return (not created yet / not approved) is simply missing. Never throws.
 */
export async function fetchUavProducts() {
  try {
    await initIAP()
    ensureUavListener()
    const products = (await RNIap.fetchProducts({ skus: UAV_SKUS, type: 'in-app' })) ?? []
    const out = {}
    for (const p of products) {
      if (!p?.id || !isUavSku(p.id) || !p.displayPrice) continue
      const price = p.price == null || p.price === '' ? NaN : Number(p.price) // Number(null) would be 0
      out[p.id] = { displayPrice: String(p.displayPrice), price: Number.isFinite(price) ? price : null, currency: p.currency || null }
    }
    return out
  } catch (e) {
    console.warn('iap: fetchUavProducts failed', e?.message || e)
    return {}
  }
}

/** Back-compat: the 20-pack's store info or null. */
export async function fetchUavProduct() {
  const all = await fetchUavProducts()
  return all[UAV_SKU] || null
}

/**
 * Buys one UAV pack. Resolves { status: 'purchased', balance, count } once credited,
 * { status: 'pending' } for Ask to Buy / deferred payments (credited later by the
 * app-wide listener), or { status: 'unknown' } if the store never answered.
 * Rejects on errors; a cancelled sheet rejects with a user-cancelled error.
 */
export async function purchaseUavPack(sku = UAV_SKU) {
  if (!isUavSku(sku)) throw new Error('Unknown pack.')
  await withTimeout(initIAP(), 15000)
  ensureUavListener()
  const products = (await withTimeout(RNIap.fetchProducts({ skus: [sku], type: 'in-app' }), 15000)) ?? []
  if (!products.some((p) => p?.id === sku)) throw new Error('This pack isn’t available in the store yet. Please try again later.')

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const waiter = {
      sku,
      done: (res) => settle(resolve, { status: 'purchased', balance: res?.balance, count: res?.count }),
      pending: () => settle(resolve, { status: 'pending' }),
      fail: (e) => settle(reject, e),
    }
    function settle(fn, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      uavWaiters.delete(waiter)
      fn(value)
    }
    uavWaiters.add(waiter)
    // Never leave the UI spinning forever; a late purchase is still credited by the listener.
    timer = setTimeout(() => settle(resolve, { status: 'unknown' }), 90000)

    RNIap.requestPurchase({
      request: {
        apple: { sku },
        google: { skus: [sku] },
      },
      type: 'in-app',
    }).catch((e) => settle(reject, e))
  })
}


// ---------------------------------------------------------------------------
// Non-consumables: Laser Tag guns. Each paid gun is its own In-App Purchase
// (App Store Connect type: Non-Consumable; Google Play: one-time product).
// Owning a gun is recorded in arcade stats, the same place coin unlocks go.
// ---------------------------------------------------------------------------
export const PAID_GUN_IDS = ['burst', 'smg', 'sniper', 'scatter', 'assault', 'marksman', 'minigun', 'railgun']
export const gunSku = (gunId) => Platform.select({ ios: `com.iYiYi.gun.${gunId}`, android: `iyiyi_gun_${gunId}` })
const GUN_BY_SKU = Object.fromEntries(PAID_GUN_IDS.map((id) => [gunSku(id), id]))
export const isGunSku = (sku) => !!GUN_BY_SKU[sku]

async function grantGunFromPurchase(purchase) {
  const gunId = GUN_BY_SKU[purchase?.productId]
  if (!gunId) return null
  await _grantItems([gunId])
  try {
    await RNIap.finishTransaction({ purchase, isConsumable: false })
  } catch (e) {
    console.warn('iap: finishTransaction (gun) failed', e)
  }
  return gunId
}

/** Localized prices for every paid gun: { [gunId]: '$2.99' }. Missing = not in the store yet. Never throws. */
export async function fetchGunProducts() {
  try {
    await initIAP()
    const products = (await RNIap.fetchProducts({ skus: PAID_GUN_IDS.map(gunSku), type: 'in-app' })) ?? []
    const out = {}
    for (const p of products) {
      const id = GUN_BY_SKU[p?.id]
      if (id && p.displayPrice) out[id] = String(p.displayPrice)
    }
    return out
  } catch (e) {
    console.warn('iap: fetchGunProducts failed', e?.message || e)
    return {}
  }
}

/** Buys one gun. Resolves { status: 'purchased' | 'pending' } ; rejects on error / cancel. */
export async function purchaseGun(gunId) {
  const sku = gunSku(gunId)
  if (!GUN_BY_SKU[sku]) throw new Error('This gun is not sold in the store.')
  await withTimeout(initIAP(), 15000)

  // Already bought on this Apple ID / Google account: unlock it straight away instead of
  // asking the store to sell it again (which only shows "already purchased").
  const owned = (await ownedPurchases()).find((p) => p?.productId === sku)
  if (owned) {
    await grantGunFromPurchase(owned)
    return { status: 'purchased' }
  }

  const products = (await withTimeout(RNIap.fetchProducts({ skus: [sku], type: 'in-app' }), 15000)) ?? []
  if (!products.some((p) => p?.id === sku)) throw new Error('This gun isn’t available in the store yet. Please try again later.')

  return new Promise((resolve, reject) => {
    let settled = false
    const subs = []
    const settle = (fn, v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subs.forEach((s) => s.remove())
      fn(v)
    }
    const timer = setTimeout(() => settle(resolve, { status: 'pending' }), 90000)
    subs.push(RNIap.purchaseUpdatedListener(async (purchase) => {
      if (purchase?.productId !== sku) return
      if (purchase.purchaseState === 'pending') { settle(resolve, { status: 'pending' }); return }
      try {
        await grantGunFromPurchase(purchase)
        settle(resolve, { status: 'purchased' })
      } catch (e) {
        settle(reject, e)
      }
    }))
    subs.push(RNIap.purchaseErrorListener((error) => {
      if (error?.productId && error.productId !== sku) return
      settle(reject, error)
    }))
    RNIap.requestPurchase({
      request: { apple: { sku }, google: { skus: [sku] } },
      type: 'in-app',
    }).catch((e) => settle(reject, e))
  })
}

/** Restores guns bought with real money on this Apple ID / Google account. Resolves the gun ids. Never throws. */
export async function restoreGunPurchases() {
  try {
    await initIAP()
    const purchases = (await RNIap.getAvailablePurchases()) ?? []
    const out = []
    for (const p of purchases) {
      if (!isGunSku(p?.productId)) continue
      const id = await grantGunFromPurchase(p)
      if (id) out.push(id)
    }
    return out
  } catch {
    return []
  }
}


// ---------------------------------------------------------------------------
// Consumable: Laser Tag grenade pack (10 grenades). App Store Connect type: Consumable.
// ---------------------------------------------------------------------------
export const GRENADE_PACK = {
  id: 'grenade10',
  count: 10,
  sku: Platform.select({ ios: 'com.iYiYi.grenade10', android: 'iyiyi_grenade10' }),
  refPrice: 4.99,
}
export const isGrenadeSku = (sku) => sku === GRENADE_PACK.sku

async function creditGrenadePurchase(purchase) {
  const qty = Math.max(1, Math.min(10, Number(purchase.quantity) || 1))
  const txnId = purchase.id || purchase.purchaseToken || `${purchase.productId}:${purchase.transactionDate}`
  const res = await _creditGrenades(GRENADE_PACK.count * qty, txnId)
  try {
    await RNIap.finishTransaction({ purchase, isConsumable: true })
  } catch (e) {
    console.warn('iap: finishTransaction (grenades) failed', e)
  }
  return { ...res, count: GRENADE_PACK.count * qty }
}

/** Store info for the grenade pack: { displayPrice } or null. Never throws. */
export async function fetchGrenadeProduct() {
  try {
    await withTimeout(initIAP(), 15000)
    const products = (await withTimeout(RNIap.fetchProducts({ skus: [GRENADE_PACK.sku], type: 'in-app' }), 15000)) ?? []
    const p = products.find((x) => x?.id === GRENADE_PACK.sku)
    return p?.displayPrice ? { displayPrice: String(p.displayPrice) } : null
  } catch {
    return null
  }
}

/** Credits + finishes any grenade purchase that completed outside the buy flow. Never throws. */
export async function recoverGrenadePurchases() {
  try {
    for (const p of await ownedPurchases()) {
      if (isGrenadeSku(p?.productId) && p.purchaseState !== 'pending') await creditGrenadePurchase(p)
    }
  } catch {
    // Next time.
  }
}

/** Buys one grenade pack. Resolves { status: 'purchased', balance, count } | { status: 'pending' }. */
export async function purchaseGrenadePack() {
  const sku = GRENADE_PACK.sku
  await withTimeout(initIAP(), 15000)
  const products = (await withTimeout(RNIap.fetchProducts({ skus: [sku], type: 'in-app' }), 15000)) ?? []
  if (!products.some((p) => p?.id === sku)) throw new Error('Grenades aren’t available in the store yet. Please try again later.')
  return new Promise((resolve, reject) => {
    let settled = false
    const subs = []
    const settle = (fn, v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subs.forEach((s) => s.remove())
      fn(v)
    }
    const timer = setTimeout(() => settle(resolve, { status: 'pending' }), 90000)
    subs.push(RNIap.purchaseUpdatedListener(async (purchase) => {
      if (purchase?.productId !== sku) return
      if (purchase.purchaseState === 'pending') { settle(resolve, { status: 'pending' }); return }
      try {
        const res = await creditGrenadePurchase(purchase)
        settle(resolve, { status: 'purchased', balance: res?.balance, count: res?.count })
      } catch (e) {
        settle(reject, e)
      }
    }))
    subs.push(RNIap.purchaseErrorListener((error) => {
      if (error?.productId && error.productId !== sku) return
      settle(reject, error)
    }))
    RNIap.requestPurchase({ request: { apple: { sku }, google: { skus: [sku] } }, type: 'in-app' }).catch((e) => settle(reject, e))
  })
}
