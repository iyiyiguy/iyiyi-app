// Laser Tag grenades: a purchased balance (arcadeStats, per account) bought in packs of 10
// (GRENADE_PACK, a consumable In-App Purchase). The arcade owner accounts have unlimited
// grenades. Every export is defensive: nothing throws into render.
// Fair play: use as many as you own, but at most GRENADES_PER_MATCH per match (matchLimits.js; the
// owner account too). Pass { matchKey } (`${code}:${round}`) to spendGrenade().
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats, _spendGrenade } from './arcadeStats'
import { isArcadeOwner } from './guns'
import { MATCH_LIMITS, matchCheck, returnMatchUse, takeMatchUse } from './matchLimits'
import { GRENADE_PACK, fetchGrenadeProduct, isUserCancelled, purchaseGrenadePack, recoverGrenadePurchases } from './iap'

export { GRENADE_PACK }

export const GRENADES_PER_MATCH = MATCH_LIMITS.grenade

/** { ok, left, cap, text }: can another grenade be used in this match? Check before spending. */
export const grenadeMatchCheck = (matchKey) => matchCheck('grenade', matchKey)

/**
 * Spend one grenade (counts toward the per-match limit). Resolves true on success, false when
 * none are left OR the match limit is reached (see grenadeMatchCheck for the message). Never rejects.
 */
export async function spendGrenade({ matchKey } = {}) {
  if (!takeMatchUse('grenade', matchKey)) return false
  try {
    if (await isArcadeOwner()) return true
    const ok = !!(await _spendGrenade())
    if (!ok) returnMatchUse('grenade', matchKey)
    return ok
  } catch {
    returnMatchUse('grenade', matchKey)
    return false
  }
}

/** { balance, owner, loaded } — live grenade balance for the signed-in player. */
export function useGrenadeInventory() {
  const [balance, setBalance] = useState(0)
  const [owner, setOwner] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, o] = await Promise.all([loadArcadeStats(), isArcadeOwner()])
        if (!alive) return
        setBalance(Number(s?.grenades) || 0)
        setOwner(!!o)
      } catch {
        // Zero is a safe default.
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    const off = subscribeArcadeStats((s) => { if (alive) setBalance(Number(s?.grenades) || 0) })
    return () => { alive = false; off() }
  }, [])
  return { balance, owner, loaded }
}

let priceCache = null

/**
 * Store state + buy action for the grenade pack.
 *   { status: 'loading'|'ready'|'unavailable', displayPrice, busy, buy() }
 *   buy() resolves { ok, count?, pending?, cancelled?, error? } and never rejects.
 */
export function useGrenadeStore() {
  const [info, setInfo] = useState(priceCache)
  const [loading, setLoading] = useState(!priceCache)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    recoverGrenadePurchases().catch(() => {})
    if (!priceCache) {
      fetchGrenadeProduct()
        .then((p) => { if (p) priceCache = p; if (alive.current) { setInfo(p); setLoading(false) } })
        .catch(() => { if (alive.current) setLoading(false) })
    }
    return () => { alive.current = false }
  }, [])
  const buy = useCallback(async () => {
    if (busy) return { ok: false }
    setBusy(true)
    try {
      const res = await purchaseGrenadePack()
      if (res?.status === 'purchased') return { ok: true, count: res.count || GRENADE_PACK.count }
      return { ok: false, pending: true }
    } catch (e) {
      if (isUserCancelled(e)) return { ok: false, cancelled: true }
      return { ok: false, error: String(e?.message || 'The purchase didn’t go through. You weren’t charged.') }
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [busy])
  return { status: loading ? 'loading' : info ? 'ready' : 'unavailable', displayPrice: info?.displayPrice || null, busy, buy }
}
