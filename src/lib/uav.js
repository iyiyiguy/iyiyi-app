// Laser Tag UAVs — inventory + purchase hooks.
//
//   • Every player gets FREE_UAVS_PER_MATCH free UAV per match (tracked by the game).
//   • Purchased UAVs are a persisted balance in arcadeStats (AsyncStorage, per account).
//   • The arcade owner account (isArcadeOwner) has unlimited UAVs.
//   • UAV packs (5 / 20 / 50 / 120) are consumable In-App Purchases (UAV_PACKS, see iap.js).
//
// Every export here is defensive: nothing throws into render or effects.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats, _spendUav } from './arcadeStats'
import { isArcadeOwner } from './guns'
import { UAV_PACKS, UAV_PACK_SIZE, fetchUavProducts, isUserCancelled, purchaseUavPack, recoverUavPurchases } from './iap'

export { UAV_PACKS, UAV_PACK_SIZE }
export const UAV_DURATION_MS = 15000
export const FREE_UAVS_PER_MATCH = 1
export const SHOT_PING_MS = 3000

/** Spend one purchased UAV. Resolves true on success, false if none left. Never rejects. */
export async function spendPurchasedUav() {
  try {
    return !!(await _spendUav())
  } catch {
    return false
  }
}

/** { balance, owner, loaded } — live purchased-UAV balance for the signed-in player. */
export function useUavInventory() {
  const [balance, setBalance] = useState(0)
  const [owner, setOwner] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, o] = await Promise.all([loadArcadeStats(), isArcadeOwner()])
        if (!alive) return
        setBalance(Number(s?.uavs) || 0)
        setOwner(!!o)
      } catch {
        // Zero balance is a safe default.
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    const off = subscribeArcadeStats((s) => {
      if (alive) setBalance(Number(s?.uavs) || 0)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return { balance, owner, loaded }
}

// Store info is cached per launch once found; missing packs are retried on the next mount.
let productCache = null // { [sku]: { displayPrice, price, currency } }

/**
 * Store state + buy action for every UAV pack.
 *   packs:  UAV_PACKS with { status: 'loading'|'ready'|'unavailable', displayPrice, perUav, savePct }
 *   busySku: sku being bought (or null)
 *   buy(sku) resolves { ok, count?, pending?, cancelled?, unknown?, error? } and never rejects.
 */
export function useUavStore() {
  const [products, setProducts] = useState(productCache)
  const [busySku, setBusySku] = useState(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  useEffect(() => {
    alive.current = true
    // Credit any UAV purchase that finished while the app was closed / outside the flow.
    recoverUavPurchases().catch(() => {})
    const complete = productCache && UAV_PACKS.every((p) => productCache[p.sku])
    if (!complete) {
      fetchUavProducts()
        .then((found) => {
          productCache = { ...(productCache || {}), ...(found || {}) }
          if (alive.current) setProducts(productCache)
        })
        .catch(() => { if (alive.current) setProducts(productCache || {}) })
    }
    return () => { alive.current = false }
  }, [])

  const packs = useMemo(() => {
    const loading = products == null
    const unit = (p) => {
      const info = products?.[p.sku]
      const price = Number.isFinite(info?.price) ? info.price : p.refPrice
      return price / p.count
    }
    const base = unit(UAV_PACKS[0])
    return UAV_PACKS.map((p) => {
      const info = products?.[p.sku]
      const status = loading ? 'loading' : info ? 'ready' : 'unavailable'
      const per = unit(p)
      let perUav = null
      if (info && Number.isFinite(info.price)) {
        try {
          perUav = new Intl.NumberFormat(undefined, { style: 'currency', currency: info.currency || 'USD', maximumFractionDigits: 3 }).format(per)
        } catch {
          perUav = `${per.toFixed(3)}`
        }
      }
      const savePct = p === UAV_PACKS[0] || !(base > 0) ? 0 : Math.max(0, Math.round((1 - per / base) * 100))
      return { ...p, status, displayPrice: info?.displayPrice || null, perUav, savePct }
    })
  }, [products])

  const buy = useCallback(async (sku) => {
    const pack = packs.find((p) => p.sku === sku)
    if (busyRef.current || !pack || pack.status !== 'ready') return { ok: false }
    busyRef.current = true
    setBusySku(sku)
    try {
      const res = await purchaseUavPack(sku)
      if (res?.status === 'purchased') return { ok: true, count: res.count || pack.count, balance: res.balance }
      if (res?.status === 'pending') return { ok: false, pending: true }
      return { ok: false, unknown: true }
    } catch (e) {
      if (isUserCancelled(e)) return { ok: false, cancelled: true }
      return { ok: false, error: String(e?.message || 'The purchase didn’t go through. You weren’t charged.') }
    } finally {
      busyRef.current = false
      if (alive.current) setBusySku(null)
    }
  }, [packs])

  return { packs, busySku, buy, loading: products == null }
}
