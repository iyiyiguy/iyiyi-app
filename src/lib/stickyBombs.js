// Laser Tag sticky bombs: a purchased balance (arcadeStats, per account) bought in packs of 5
// (STICKY_BOMB_PACK, a consumable In-App Purchase). Place at a location, detonate remotely.
// The arcade owner accounts have unlimited sticky bombs. Every export is defensive: nothing throws into render.
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats, _spendStickyBomb } from './arcadeStats'
import { isArcadeOwner } from './guns'
import { STICKY_BOMB_PACK, fetchStickyBombProduct, isUserCancelled, purchaseStickyBombPack, recoverStickyBombPurchases } from './iap'

export { STICKY_BOMB_PACK }

/** Spend one sticky bomb. Resolves true on success. Never rejects. */
export async function spendStickyBomb() {
  try {
    if (await isArcadeOwner()) return true
    return !!(await _spendStickyBomb())
  } catch {
    return false
  }
}

/** { balance, owner, loaded } — live sticky bomb balance for the signed-in player. */
export function useStickyBombInventory() {
  const [balance, setBalance] = useState(0)
  const [owner, setOwner] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, o] = await Promise.all([loadArcadeStats(), isArcadeOwner()])
        if (!alive) return
        setBalance(Number(s?.stickyBombs) || 0)
        setOwner(!!o)
      } catch {
        // Zero is a safe default.
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    const off = subscribeArcadeStats((s) => { if (alive) setBalance(Number(s?.stickyBombs) || 0) })
    return () => { alive = false; off() }
  }, [])
  return { balance, owner, loaded }
}

let priceCache = null

export function useStickyBombStore() {
  const [info, setInfo] = useState(priceCache)
  const [loading, setLoading] = useState(!priceCache)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    recoverStickyBombPurchases().catch(() => {})
    if (!priceCache) {
      fetchStickyBombProduct()
        .then((p) => { if (p) priceCache = p; if (alive.current) { setInfo(p); setLoading(false) } })
        .catch(() => { if (alive.current) setLoading(false) })
    }
    return () => { alive.current = false }
  }, [])
  const buy = useCallback(async () => {
    if (busy) return { ok: false }
    setBusy(true)
    try {
      const res = await purchaseStickyBombPack()
      if (res?.status === 'purchased') return { ok: true, count: res.count || STICKY_BOMB_PACK.count }
      return { ok: false, pending: true }
    } catch (e) {
      if (isUserCancelled(e)) return { ok: false, cancelled: true }
      return { ok: false, error: String(e?.message || 'The purchase didn\'t go through. You weren\'t charged.') }
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [busy])
  return { status: loading ? 'loading' : info ? 'ready' : 'unavailable', displayPrice: info?.displayPrice || null, busy, buy }
}
