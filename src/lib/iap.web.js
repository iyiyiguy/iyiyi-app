// react-native-iap has no web implementation. This stub keeps the web
// preview from crashing at import time; real purchases only happen in the
// native iOS/Android app.
export const SKUS = { premium: null, creator: null, pro: null }

export async function initIAP() {}

export const isUserCancelled = () => false

export async function purchaseSubscription() {
  throw new Error('In-app purchases are only available in the iOS/Android app.')
}

export async function restorePurchases() {
  return []
}

export async function fetchSubscriptionInfo() {
  return null
}

export const UAV_PACKS = [
  { id: 'uav5', count: 5, sku: 'com.iYiYi.uav5', refPrice: 0.99 },
  { id: 'uav20', count: 20, sku: 'com.iYiYi.uav20', refPrice: 1.99, ribbon: 'Most popular' },
  { id: 'uav50', count: 50, sku: 'com.iYiYi.uav50', refPrice: 3.99, ribbon: 'Best value' },
  { id: 'uav120', count: 120, sku: 'com.iYiYi.uav120', refPrice: 7.99 },
]
export const UAV_SKUS = UAV_PACKS.map((p) => p.sku)
export const UAV_SKU = 'com.iYiYi.uav20'
export const UAV_PACK_SIZE = 20
export const isUavSku = (sku) => UAV_SKUS.includes(sku)
export function ensureUavListener() {}
export async function recoverUavPurchases() {}
export async function fetchUavProducts() {
  return {}
}
export async function fetchUavProduct() {
  return null
}
export async function purchaseUavPack() {
  throw new Error('In-app purchases are only available in the iOS/Android app.')
}

// Grenades: in-app purchases only exist in the iOS / Android apps.
export const GRENADE_PACK = { id: 'grenade10', count: 10, sku: 'grenade10', refPrice: 4.99 }
export const isGrenadeSku = () => false
export async function fetchGrenadeProduct() { return null }
export async function recoverGrenadePurchases() {}
export async function purchaseGrenadePack() { throw new Error('Grenades can be bought in the iYiYi app.') }
