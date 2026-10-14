// Laser Tag land mines: a purchased balance (arcadeStats, per account) bought in packs of 5
// (LAND_MINE_PACK, a consumable In-App Purchase). Place on the ground, triggers on proximity.
// The arcade owner accounts have unlimited land mines. Every export is defensive: nothing throws into render.
// Fair play: use as many as you own, but at most LAND_MINES_PER_MATCH per match (matchLimits.js; the
// owner account too). Pass { matchKey } (`${code}:${round}`) to spendLandMine().
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats, _spendLandMine } from './arcadeStats'
import { isArcadeOwner } from './guns'
import { MATCH_LIMITS, matchCheck, returnMatchUse, takeMatchUse } from './matchLimits'
import { LAND_MINE_PACK, fetchLandMineProduct, isUserCancelled, purchaseLandMinePack, recoverLandMinePurchases } from './iap'

export { LAND_MINE_PACK }

export const LAND_MINES_PER_MATCH = MATCH_LIMITS.landMine

/** { ok, left, cap, text }: can another land mine be used in this match? Check before spending. */
export const landMineMatchCheck = (matchKey) => matchCheck('landMine', matchKey)

/**
 * Spend one land mine (counts toward the per-match limit). Resolves true on success, false when
 * none are left OR the match limit is reached (see landMineMatchCheck for the message). Never rejects.
 */
export async function spendLandMine({ matchKey } = {}) {
  if (!takeMatchUse('landMine', matchKey)) return false
  try {
    if (await isArcadeOwner()) return true
    const ok = !!(await _spendLandMine())
    if (!ok) returnMatchUse('landMine', matchKey)
    return ok
  } catch {
    returnMatchUse('landMine', matchKey)
    return false
  }
}

/** { balance, owner, loaded } — live land mine balance for the signed-in player. */
export function useLandMineInventory() {
  const [balance, setBalance] = useState(0)
  const [owner, setOwner] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, o] = await Promise.all([loadArcadeStats(), isArcadeOwner()])
        if (!alive) return
        setBalance(Number(s?.landMines) || 0)
        setOwner(!!o)
      } catch {
        // Zero is a safe default.
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    const off = subscribeArcadeStats((s) => { if (alive) setBalance(Number(s?.landMines) || 0) })
    return () => { alive = false; off() }
  }, [])
  return { balance, owner, loaded }
}

let priceCache = null

export function useLandMineStore() {
  const [info, setInfo] = useState(priceCache)
  const [loading, setLoading] = useState(!priceCache)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    recoverLandMinePurchases().catch(() => {})
    if (!priceCache) {
      fetchLandMineProduct()
        .then((p) => { if (p) priceCache = p; if (alive.current) { setInfo(p); setLoading(false) } })
        .catch(() => { if (alive.current) setLoading(false) })
    }
    return () => { alive.current = false }
  }, [])
  const buy = useCallback(async () => {
    if (busy) return { ok: false }
    setBusy(true)
    try {
      const res = await purchaseLandMinePack()
      if (res?.status === 'purchased') return { ok: true, count: res.count || LAND_MINE_PACK.count }
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
