// Per-match limits for arcade consumables (fair play: what you own is yours to keep, but how
// many you can use in ONE match is capped, so money can't turn into unlimited kills/radar).
//
//   MATCH_LIMITS            uses per match, by kind
//   matchUses(kind, key)    uses so far in that match
//   matchLeft(kind, key)    uses left in that match (Infinity for unknown kinds)
//   takeMatchUse(kind, key)   record one use; false (and nothing recorded) when the cap is hit
//   returnMatchUse(kind, key)  give one back (e.g. the purchase/spend failed afterwards)
//   matchLimitText(kind)    short, honest message for the HUD when the cap is reached
//   matchCheck(kind, key)   { ok, left, cap, text } for a pre-check before spending
//
// `key` identifies the match (Laser Tag / Royale: `${code}:${round}`). Without a key the
// limit applies to a rolling MATCH_WINDOW_MS window instead (a default Laser Tag round), so
// the cap still holds for callers that don't know the match. The ledger lives in memory for
// the app session; the host is the place to enforce it for real (see the report/hand-off).
// Pure JS: no React / native imports, safe in tests.

export const MATCH_LIMITS = {
  grenade: 3,
  landMine: 3,
  stickyBomb: 10,
  uav: 2, // bought UAVs per match (the free one and streak UAVs don't count)
}
export const MATCH_WINDOW_MS = 10 * 60000

const NAMES = { grenade: 'grenades', landMine: 'land mines', stickyBomb: 'sticky bombs', uav: 'bought UAVs' }

const ledger = new Map() // `${kind}|${key}` -> number of uses
const windowUses = new Map() // kind -> [timestamps] (no-key fallback)
const MAX_KEYS = 200

const capOf = (kind) => (Number.isFinite(MATCH_LIMITS[kind]) ? MATCH_LIMITS[kind] : Infinity)
const hasKey = (key) => key != null && key !== '' && !/undefined|null/.test(String(key))

function recent(kind, now) {
  const list = (windowUses.get(kind) || []).filter((t) => now - t < MATCH_WINDOW_MS)
  windowUses.set(kind, list)
  return list
}

export function matchUses(kind, key, now = Date.now()) {
  if (hasKey(key)) return ledger.get(`${kind}|${key}`) || 0
  return recent(kind, now).length
}

export function matchLeft(kind, key, now = Date.now()) {
  return Math.max(0, capOf(kind) - matchUses(kind, key, now))
}

export function takeMatchUse(kind, key, now = Date.now()) {
  if (matchLeft(kind, key, now) <= 0) return false
  if (hasKey(key)) {
    const k = `${kind}|${key}`
    ledger.set(k, (ledger.get(k) || 0) + 1)
    if (ledger.size > MAX_KEYS) ledger.delete(ledger.keys().next().value)
  } else {
    recent(kind, now).push(now)
  }
  return true
}

export function returnMatchUse(kind, key, now = Date.now()) {
  if (hasKey(key)) {
    const k = `${kind}|${key}`
    const n = ledger.get(k) || 0
    if (n > 0) ledger.set(k, n - 1)
    return
  }
  const list = recent(kind, now)
  list.pop()
}

export function matchLimitText(kind) {
  const cap = capOf(kind)
  const name = NAMES[kind] || 'of these'
  return Number.isFinite(cap) ? `Match limit reached: ${cap} ${name} per match. Yours are saved for the next one.` : ''
}

/** { ok, left, cap, text } — can one more `kind` be used in this match? (text set when not) */
export function matchCheck(kind, key, now = Date.now()) {
  const left = matchLeft(kind, key, now)
  return { ok: left > 0, left, cap: capOf(kind), text: left > 0 ? '' : matchLimitText(kind) }
}

/** Test helper: forget every recorded use. */
export function _resetMatchLimits() {
  ledger.clear()
  windowUses.clear()
}
