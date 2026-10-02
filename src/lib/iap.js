import { Platform } from 'react-native'
import * as RNIap from 'react-native-iap'
import { _creditUavs } from './arcadeStats'

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
async function receiptFor(purchase) {
  if (Platform.OS === 'ios') return RNIap.getReceiptDataIOS()
  return purchase.purchaseToken
}

// Buys a subscription, then hands the platform receipt to our backend for verification.
// In react-native-iap v16 the purchase result arrives through listeners rather than the
// return value, so this wraps them in a promise that resolves once the backend has
// confirmed and activated the tier. The transaction is only finished after the backend
// accepts it, so a rejected receipt is never silently consumed.
export async function purchaseSubscription(tier, verifyWithBackend) {
  await initIAP()
  const sku = SKUS[tier]
  const offers = Platform.OS === 'android' ? await androidOffers(sku) : undefined

  return new Promise((resolve, reject) => {
    let settled = false
    const subscriptions = []
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      subscriptions.forEach((s) => s.remove())
      fn(value)
    }

    subscriptions.push(
      RNIap.purchaseUpdatedListener(async (purchase) => {
        if (purchase.productId !== sku) return
        try {
          const receipt = await receiptFor(purchase)
          await verifyWithBackend({ tier, platform: Platform.OS, productId: sku, receipt })
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
  await initIAP()
  const purchases = (await RNIap.getAvailablePurchases()) ?? []

  const restored = []
  for (const purchase of purchases) {
    const tier = SKU_TO_TIER[purchase.productId]
    if (!tier) continue
    const receipt = await receiptFor(purchase)
    await verifyWithBackend({ tier, platform: Platform.OS, productId: purchase.productId, receipt })
    restored.push(tier)
  }
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
  await initIAP()
  ensureUavListener()
  const products = (await RNIap.fetchProducts({ skus: [sku], type: 'in-app' })) ?? []
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
    timer = setTimeout(() => settle(resolve, { status: 'unknown' }), 180000)

    RNIap.requestPurchase({
      request: {
        apple: { sku },
        google: { skus: [sku] },
      },
      type: 'in-app',
    }).catch((e) => settle(reject, e))
  })
}
