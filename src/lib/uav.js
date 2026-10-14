// Laser Tag / Battle Royale UAVs — fair-play rules, inventory + purchase hooks.
//
//   • Every player gets FREE_UAVS_PER_MATCH free UAV per match.
//   • Streak reward: every UAV_STREAK_TAGS tags in a row (without being tagged out) earns a
//     UAV for this match (CoD-style scorestreak). Earned UAVs are used first.
//   • Bought UAVs are a persisted balance in arcadeStats (AsyncStorage, per account), but at
//     most UAVS_BOUGHT_PER_MATCH of them can be used in one match (matchLimits.js).
//   • Cooldown: UAV_COOLDOWN_MS between two UAV calls by the same player (any source), so
//     nobody can chain permanent radar. UAVs never stack.
//   • The arcade owner account (isArcadeOwner) has an unlimited balance; the per-match
//     rules above still apply.
//   • UAV packs (5 / 20 / 50 / 120) are consumable In-App Purchases (UAV_PACKS, see iap.js).
//
//   useUavControl({ room, matchKey, canUse, classify, alert, payload, onBeforeCall, teamLabel,
//                   kills, deaths })   — the whole in-match UAV flow (both shooters)
//   uavCallCheck(...)                  — the pure rule check behind it (tests / host)
//   nextStreak(...)                    — pure streak bookkeeping
//
// Every export here is defensive: nothing throws into render or effects.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadArcadeStats, subscribeArcadeStats, _spendUav } from './arcadeStats'
import { isArcadeOwner } from './guns'
import { buzz } from './gamePrefs'
import { playSfx } from './gunAudio'
import { MATCH_LIMITS, matchLeft, returnMatchUse, takeMatchUse } from './matchLimits'
import { UAV_PACKS, UAV_PACK_SIZE, fetchUavProducts, isUserCancelled, purchaseUavPack, recoverUavPurchases } from './iap'

export { UAV_PACKS, UAV_PACK_SIZE }
export const UAV_DURATION_MS = 15000
export const FREE_UAVS_PER_MATCH = 1
export const SHOT_PING_MS = 3000
export const UAV_COOLDOWN_MS = 90000
export const UAV_STREAK_TAGS = 3
export const UAVS_BOUGHT_PER_MATCH = MATCH_LIMITS.uav
export const UAV_RULES_TEXT = `1 free UAV every match, +1 for every ${UAV_STREAK_TAGS} tags in a row. Bought UAVs: up to ${MATCH_LIMITS.uav} per match, ${Math.round(UAV_COOLDOWN_MS / 1000)} s between UAVs.`

/**
 * Streak bookkeeping from the host's running totals. Call with the previous entry and the
 * latest kills / deaths; returns the next entry and how many UAVs were just earned.
 * The first sighting only sets the baseline (no reward for tags made before we looked).
 */
export function nextStreak(prev, kills, deaths) {
  const k = Math.max(0, Number(kills) || 0)
  const d = Math.max(0, Number(deaths) || 0)
  if (!prev || prev.kills == null) return { entry: { kills: k, deaths: d, streak: 0 }, earned: 0 }
  let streak = prev.streak || 0
  let earned = 0
  // Tagged out: the streak restarts (tags in the same update as the death don't count).
  if (d > prev.deaths) streak = 0
  else if (k > prev.kills) {
    const before = streak
    streak += k - prev.kills
    earned = Math.floor(streak / UAV_STREAK_TAGS) - Math.floor(before / UAV_STREAK_TAGS)
  }
  return { entry: { kills: k, deaths: d, streak }, earned: Math.max(0, earned) }
}

/**
 * Can this player call a UAV right now, and which one is used?
 * @returns {{ ok: boolean, source?: 'earned'|'free'|'bought', reason?: 'active'|'cooldown'|'cap'|'empty', msLeft?: number, text?: string }}
 */
export function uavCallCheck({ now = Date.now(), activeUntil = 0, lastCallAt = 0, earnedLeft = 0, freeLeft = 0, balance = 0, owner = false, boughtLeft = 0 }) {
  if (activeUntil > now) return { ok: false, reason: 'active', msLeft: activeUntil - now, text: 'Your UAV is already up' }
  const cd = lastCallAt ? lastCallAt + UAV_COOLDOWN_MS - now : 0
  if (cd > 0) return { ok: false, reason: 'cooldown', msLeft: cd, text: `UAV recharging — ${Math.ceil(cd / 1000)} s` }
  if (earnedLeft > 0) return { ok: true, source: 'earned' }
  if (freeLeft > 0) return { ok: true, source: 'free' }
  const haveBought = owner || balance > 0
  if (haveBought && boughtLeft > 0) return { ok: true, source: 'bought' }
  if (haveBought) return { ok: false, reason: 'cap', text: `Match limit: ${MATCH_LIMITS.uav} bought UAVs per match. Earn more with a ${UAV_STREAK_TAGS}-tag streak.` }
  return { ok: false, reason: 'empty' }
}

// Per-match UAV ledger (module-level so leaving and re-opening the game screen doesn't reset
// the free UAV, the cooldown or the streak).
const matchState = new Map() // matchKey -> { freeUsed, earned, earnedUsed, lastCallAt, streak }
const ledgerFor = (key) => {
  const k = String(key ?? '')
  let e = matchState.get(k)
  if (!e) {
    e = { freeUsed: 0, earned: 0, earnedUsed: 0, lastCallAt: 0, streak: null }
    matchState.set(k, e)
    if (matchState.size > 50) matchState.delete(matchState.keys().next().value)
  }
  return e
}

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

/**
 * The in-match UAV flow shared by Laser Tag (every mode) and Battle Royale.
 *   kills / deaths: my running totals from the host state; they drive the streak reward.
 *   Calling broadcasts 'lt_uav' { ms, ...payload() }; receivers classify the sender with
 *   classify(fromId, data) → 'enemy' | 'team' | null. With nothing usable and no balance, the
 *   call opens the purchase sheet; a cooldown or the match limit only shows a message.
 * Returns { inv, count, freeLeft, earnedLeft, boughtLeft, streak, myMs, cooldownMs, uavActive,
 *           enemyMs, empty, callUav, sheetOpen, setSheetOpen, noteTags, noteDeath }.
 */
export function useUavControl({ room, matchKey, canUse, classify, alert, payload, onBeforeCall, teamLabel = 'A teammate', kills, deaths }) {
  const inv = useUavInventory()
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((n) => (n + 1) % 1e6), [])
  const [myUntil, setMyUntil] = useState(0)
  const [teamUntil, setTeamUntil] = useState(0)
  const [enemyUntil, setEnemyUntil] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const busy = useRef(false)
  const ctx = useRef({})
  ctx.current = { classify, alert, payload, onBeforeCall, teamLabel }
  const led = ledgerFor(matchKey)

  useEffect(() => {
    setMyUntil(0)
    setTeamUntil(0)
    setEnemyUntil(0)
    setSheetOpen(false)
  }, [matchKey])

  // Streak reward from the host's totals.
  const award = useCallback((n) => {
    if (!(n > 0)) return
    const e = ledgerFor(matchKey)
    e.earned += n
    bump()
    buzz('success')
    try { ctx.current.alert?.({ title: 'UAV earned', sub: `${UAV_STREAK_TAGS}-tag streak — call it in from the UAV button`, color: '#1f7a9d' }, 3000) } catch {}
  }, [matchKey, bump])
  useEffect(() => {
    if (kills == null && deaths == null) return
    const e = ledgerFor(matchKey)
    const r = nextStreak(e.streak, kills, deaths)
    e.streak = r.entry
    award(r.earned)
  }, [kills, deaths, matchKey, award])

  // Manual hooks for games that track tags themselves (instead of kills/deaths).
  const noteTags = useCallback((n = 1) => {
    const e = ledgerFor(matchKey)
    const base = e.streak || { kills: 0, deaths: 0, streak: 0 }
    const r = nextStreak(base, base.kills + Math.max(0, Number(n) || 0), base.deaths)
    e.streak = r.entry
    award(r.earned)
  }, [matchKey, award])
  const noteDeath = useCallback(() => {
    const e = ledgerFor(matchKey)
    const base = e.streak || { kills: 0, deaths: 0, streak: 0 }
    e.streak = { ...base, deaths: base.deaths + 1, streak: 0 }
    bump()
  }, [matchKey, bump])

  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('lt_uav', (d, from) => {
      try {
        const c = ctx.current
        const kind = c.classify?.(from, d)
        if (!kind) return
        const ms = Math.max(1000, Math.min(UAV_DURATION_MS, Number(d?.ms) || UAV_DURATION_MS))
        const until = Date.now() + ms
        if (kind === 'enemy') {
          setEnemyUntil(until)
          buzz('warning')
          c.alert?.({ title: 'Enemy UAV overhead', sub: 'They can see you on their map — keep moving', color: '#d4202f' }, 3000)
        } else if (kind === 'team') {
          setTeamUntil(until)
          c.alert?.({ title: `UAV online — ${Math.round(ms / 1000)}s`, sub: `${d?.name || c.teamLabel} called in a UAV`, color: '#1f7a9d' }, 3000)
        }
      } catch {
        // Ignore malformed messages.
      }
    })
  }, [room])

  // Re-render once the cooldown runs out so the button wakes up.
  const t = Date.now()
  const cooldownMs = led.lastCallAt ? Math.max(0, led.lastCallAt + UAV_COOLDOWN_MS - t) : 0
  useEffect(() => {
    if (!(cooldownMs > 0)) return undefined
    const id = setTimeout(bump, Math.min(cooldownMs + 50, 1000))
    return () => clearTimeout(id)
  }, [cooldownMs, bump])

  const myMs = Math.max(0, myUntil - t)
  const uavActive = myMs > 0 || teamUntil > t
  const enemyMs = Math.max(0, enemyUntil - t)
  const freeLeft = Math.max(0, FREE_UAVS_PER_MATCH - led.freeUsed)
  const earnedLeft = Math.max(0, led.earned - led.earnedUsed)
  const boughtLeft = matchLeft('uav', matchKey)
  const boughtUsable = inv.owner ? boughtLeft : Math.min(inv.balance, boughtLeft)
  const empty = !inv.owner && freeLeft <= 0 && earnedLeft <= 0 && inv.balance <= 0
  const count = earnedLeft + freeLeft + boughtUsable
  const streak = led.streak?.streak || 0

  const callUav = useCallback(async () => {
    if (busy.current) return
    try { ctx.current.onBeforeCall?.() } catch {}
    if (empty) { buzz('select'); setSheetOpen(true); return }
    if (!canUse) return
    const e = ledgerFor(matchKey)
    const check = uavCallCheck({
      now: Date.now(),
      activeUntil: myUntil,
      lastCallAt: e.lastCallAt,
      earnedLeft: Math.max(0, e.earned - e.earnedUsed),
      freeLeft: Math.max(0, FREE_UAVS_PER_MATCH - e.freeUsed),
      balance: inv.balance,
      owner: inv.owner,
      boughtLeft: matchLeft('uav', matchKey),
    })
    if (!check.ok) {
      if (check.reason === 'empty') { buzz('select'); setSheetOpen(true); return }
      if (check.text) {
        buzz('warning')
        try { ctx.current.alert?.({ title: check.reason === 'cooldown' ? 'UAV recharging' : 'UAV limit', sub: check.text, color: '#5a6170' }, 2500) } catch {}
      }
      return
    }
    busy.current = true
    try {
      if (check.source === 'earned') e.earnedUsed += 1
      else if (check.source === 'free') e.freeUsed += 1
      else {
        if (!takeMatchUse('uav', matchKey)) return
        if (!inv.owner && !(await spendPurchasedUav())) {
          returnMatchUse('uav', matchKey)
          setSheetOpen(true)
          return
        }
      }
      e.lastCallAt = Date.now()
      setMyUntil(Date.now() + UAV_DURATION_MS)
      let extra = {}
      try { extra = ctx.current.payload?.() || {} } catch { extra = {} }
      try { room?.send('lt_uav', { ...extra, ms: UAV_DURATION_MS }) } catch {}
      playSfx('beep')
      buzz('success')
      ctx.current.alert?.({ title: `UAV online — ${Math.round(UAV_DURATION_MS / 1000)}s`, sub: 'Enemies are on your map', color: '#1f7a9d' }, 3000)
    } finally {
      busy.current = false
      bump()
    }
  }, [myUntil, empty, canUse, inv.owner, inv.balance, room, matchKey, bump])

  return { inv, count, freeLeft, earnedLeft, boughtLeft, streak, myMs, cooldownMs, uavActive, enemyMs, empty, callUav, sheetOpen, setSheetOpen, noteTags, noteDeath }
}
