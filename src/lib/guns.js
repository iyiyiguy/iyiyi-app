// Laser Tag weapons — the shared weapon API for every arcade shooter (Laser Tag, Battle
// Royale, …). The two starter weapons are free; every other gun is a one-time In-App
// Purchase (lib/iap.js PAID_GUN_IDS, prices in the stores). Ownership and the equipped
// weapon are persisted per player in arcadeStats. The arcade owner account (see
// isArcadeOwner) has every weapon, free.
//
// ── Balance: side-grades, not upgrades ───────────────────────────────────────────────
//   Paid guns change HOW you fight, not how strong you are. Every weapon sits inside the
//   same time-to-tag budget as the free Starter Pistol / Street SMG (≈0.5-1.2 s to tag out a
//   100 HP player with every hit landing, ≤20 m) and every paid gun has a clear weakness
//   (`weakness`): a forced cycle between shots, short range, poor hip-fire aim or low damage
//   per hit. One-hit weapons (sniper, rocket: headshot only) have the longest cycles
//   (2 s / 3 s). See tagStats() for the numbers the shop shows.
//
// ── Public API ───────────────────────────────────────────────────────────────────────
//   WEAPONS / GUNS                 all weapon definitions (same array)
//   getWeapon(id) / getGunById(id) one definition (falls back to the pistol)
//   isAutomatic(weapon)            true → fires continuously while the trigger is held
//   shotIntervalMs(weapon)         ms between automatic shots (from fireRate)
//   shotsPerPull(weapon)           beams per trigger pull for semi/burst weapons (1–5)
//   cycleMs(weapon)                forced gap between two pulls (0 = as fast as you tap)
//   tagStats(weapon)               { perPull, hitsBody, hitsHead, ttkBody, ttkHead, pullsPerSec }
//   FREE_GUN_IDS / isPaidGun(g)    weapons everyone owns ('pistol', 'uzi') / store-sold guns
//   SIDE_GRADE_TEXT                honest shop copy about the balance
//   getLoadout()                   Promise<weapon[]> the player's owned weapons
//   getEquippedGun() / setEquippedGun(id) / unlockGun(id)
//   useTrigger(weapon, onShot, { enabled })   (re-exported from ./weaponFire)
//   playShot(weaponId), playSfx(name), preloadWeaponSounds(ids) (re-exported from ./gunAudio)
//
// ── Fire rules ───────────────────────────────────────────────────────────────────────
//   Ammo is unlimited: there is no magazine and no reload.
//   Semi-automatic ('single' / 'burst'): one trigger pull per tap — every tap fires, however
//     fast you tap — EXCEPT slow weapons (fireRate < 1/s), which keep a cycle on the phone and
//     on the host (laser/aimRules.minShotGapMs): explosive launchers the full 1/fireRate
//     (rocket: 1 per 3 s), others half of it (sniper 2 s, marksman / burst / scatter ≈0.5-0.7 s).
//     A burst pull fires `shotsPerClick` beams.
//   blastRadius      explosive weapons: splash radius in metres (Laser Tag host: engine.ROCKET_RADIUS_M)
//   Automatic: fires on press, then every shotIntervalMs() while held.
import { supabase } from './supabase'
import { translate } from '../i18n'
import G from '../i18n/strings/gunShop'
import { FREE_GUN_IDS, loadArcadeStats, _unlockItem, _equipItem, _grantItems } from './arcadeStats'
import { minShotGapMs as _minShotGapMs } from '../games/laser/aimRules'

export { FREE_GUN_IDS }
export { useTrigger, autoFireRate, measuredTapRate, TAP_BASELINE_RATE } from './weaponFire'
import { autoFireRate as _autoRate, TAP_BASELINE_RATE as _TAP } from './weaponFire'
export { playShot, playSfx, preloadWeaponSounds, releaseWeaponSounds, SFX } from './gunAudio'

export const RARITIES = {
  common: { id: 'common', get name() { return translate(G, 'rarity_common') }, color: '#9aa3c0' },
  rare: { id: 'rare', get name() { return translate(G, 'rarity_rare') }, color: '#4fa3ff' },
  epic: { id: 'epic', get name() { return translate(G, 'rarity_epic') }, color: '#b46cff' },
  legendary: { id: 'legendary', get name() { return translate(G, 'rarity_legendary') }, color: '#ffb547' },
}

export const GUN_CATEGORIES = [
  { id: 'all', get name() { return translate(G, 'cat_all') } },
  { id: 'sidearm', get name() { return translate(G, 'cat_sidearm') } },
  { id: 'rifle', get name() { return translate(G, 'cat_rifle') } },
  { id: 'precision', get name() { return translate(G, 'cat_precision') } },
  { id: 'heavy', get name() { return translate(G, 'cat_heavy') } },
]

// Field notes:
//   fireMode         single | burst | automatic
//   shotsPerClick    beams per trigger pull (single/burst); clamped to 1–5
//   fireRate         automatic: nominal shots/s while held (display + Royale spam guard);
//                    the live rate comes from weaponFire.autoFireRate (1.5× tap rate, 6–12/s)
//                    semi-auto: < 1 sets the cycle (see Fire rules); ≥ 1 = as fast as you tap
//   autoRateScale    automatic: per-weapon multiplier on that rate
//   fixedAutoRate    automatic: fixed shots/s instead (heavy, slow-firing weapons)
//   accuracy         hit-chance bonus/penalty in % for compass (hip-fire) aim; camera hits ignore it
//   damageMultiplier scales zone damage (head 50 / body 25 / limb 15, 100 HP)
//   damage           body damage per beam at ≤20 m (display; = 25 × damageMultiplier)
//   range            effective range, metres (compass aim is capped at 40 m)
//   strength / weakness  one-line trade-off shown in the shop
//   sound            sound effect id in gunAudio (assets/sounds/<sound>.wav)
//   unlockPoints     legacy arcade-coin price (unchanged); paid guns are sold as IAPs (iap.PAID_GUN_IDS)
export const GUNS = [
  { id: 'pistol', name: 'Starter Pistol', icon: '🔫', category: 'sidearm', rarity: 'common', free: true,
    description: 'Free semi-auto. Every tap fires, as fast as you can tap.', fireMode: 'single', shotsPerClick: 1, fireRate: 3,
    accuracy: 0, damage: 25, damageMultiplier: 1, range: 60, sound: 'pistol', unlockPoints: 0,
    strength: 'Fast tag-outs if your taps land', weakness: 'Only as fast as your thumb' },
  { id: 'uzi', name: 'Street SMG', icon: '🔫', category: 'sidearm', rarity: 'common', free: true,
    description: 'Free compact automatic. Hold to spray.', fireMode: 'automatic', shotsPerClick: null, fireRate: 9, autoRateScale: 1,
    accuracy: 0, damage: 10, damageMultiplier: 0.4, range: 50, sound: 'smg', unlockPoints: 0,
    strength: 'Easy hold-to-fire, good range for an SMG', weakness: 'Low damage per hit' },
  { id: 'burst', name: 'Burst Rifle', icon: '🎯', category: 'rifle', rarity: 'common',
    description: '3 beams per tap with a short pause between bursts.', fireMode: 'burst', shotsPerClick: 3, fireRate: 0.95,
    accuracy: 10, damage: 15, damageMultiplier: 0.6, range: 70, sound: 'rifle', unlockPoints: 100,
    strength: 'Two bursts to the head tag out', weakness: '0.5 s pause between bursts; misses cost a lot' },
  { id: 'smg', name: 'Pulse SMG', icon: '💠', category: 'sidearm', rarity: 'rare',
    description: 'Very fast automatic for close quarters.', fireMode: 'automatic', shotsPerClick: null, fireRate: 11, autoRateScale: 1.2,
    accuracy: -10, damage: 10, damageMultiplier: 0.4, range: 30, sound: 'smg', unlockPoints: 200,
    strength: 'Quickest automatic up close', weakness: 'Only 30 m range and loose hip-fire aim' },
  { id: 'sniper', name: 'Sniper Rifle', icon: '🔭', category: 'precision', rarity: 'epic',
    description: 'Headshots tag out in one hit. 2 s between shots.', fireMode: 'single', shotsPerClick: 1, fireRate: 0.25,
    accuracy: 15, damage: 50, damageMultiplier: 2, range: 120, sound: 'sniper', unlockPoints: 250,
    strength: 'One-hit headshots, longest scope', weakness: '2 s between shots; body shots need two' },
  { id: 'scatter', name: 'Scatter Blaster', icon: '💥', category: 'heavy', rarity: 'rare',
    description: 'Five-beam spread for very close range.', fireMode: 'burst', shotsPerClick: 5, fireRate: 0.7,
    accuracy: 15, damage: 10, damageMultiplier: 0.38, range: 20, sound: 'shotgun', unlockPoints: 350,
    strength: 'Two pumps tag out up close', weakness: 'Can’t reach past 20 m; 0.7 s pump' },
  { id: 'assault', name: 'Assault Rifle', icon: '🔥', category: 'rifle', rarity: 'rare',
    description: 'Automatic rifle. Hold to fire at mid range.', fireMode: 'automatic', shotsPerClick: null, fireRate: 8, autoRateScale: 0.9,
    accuracy: -10, damage: 13, damageMultiplier: 0.5, range: 65, sound: 'ar', unlockPoints: 450,
    strength: 'More damage per hit than the SMGs', weakness: 'Slower fire and recoil in hip fire' },
  { id: 'marksman', name: 'Marksman DMR', icon: '🎖️', category: 'precision', rarity: 'epic',
    description: 'Semi-auto precision at long range.', fireMode: 'single', shotsPerClick: 1, fireRate: 0.9,
    accuracy: 20, damage: 35, damageMultiplier: 1.4, range: 95, sound: 'dmr', unlockPoints: 600,
    strength: 'Accurate, hits hard at range', weakness: '0.6 s cycle: slower than the pistol up close' },
  { id: 'minigun', name: 'Minigun', icon: '⚡', category: 'heavy', rarity: 'epic',
    description: 'Highest fire rate. Hold and keep spraying.', fireMode: 'automatic', shotsPerClick: null, fireRate: 12, autoRateScale: 1.35,
    accuracy: -25, damage: 8, damageMultiplier: 0.3, range: 40, sound: 'minigun', unlockPoints: 800,
    strength: 'Never stops firing', weakness: 'Weakest hits, worst hip-fire aim, 40 m range' },
  { id: 'railgun', name: 'Ion Railgun', icon: '☄️', category: 'precision', rarity: 'legendary',
    description: 'Charged beams: hold for 2.5 accurate shots a second.', fireMode: 'automatic', shotsPerClick: null, fireRate: 2.5, fixedAutoRate: 2.5,
    accuracy: 25, damage: 25, damageMultiplier: 1, range: 140, sound: 'railgun', unlockPoints: 1200,
    strength: 'Accurate at any range', weakness: 'Slowest automatic: loses close fights' },
  { id: 'rocket', name: 'Rocket Launcher', icon: '🚀', category: 'heavy', rarity: 'legendary',
    description: 'Every rocket explodes: 9 m blast, one shot every 3 s.', fireMode: 'single', shotsPerClick: 1, fireRate: 1/3,
    accuracy: -30, damage: 50, damageMultiplier: 2, range: 80, blastRadius: 9, sound: 'rocket', unlockPoints: 0, iap: true,
    strength: 'Splash hits groups behind cover', weakness: '3 s reload, worst hip-fire aim, body hits don’t tag out' },
]

// Shop text (description / strength / weakness) in the viewer's language
// (i18n/strings/gunShop.js, keys '<id>_description' etc.). Gun names stay as they are.
for (const g of GUNS) {
  for (const f of ['description', 'strength', 'weakness']) {
    if (typeof g[f] !== 'string') continue
    const key = `${g.id}_${f}`
    Object.defineProperty(g, f, { get: () => translate(G, key), enumerable: true, configurable: true })
  }
}

export const WEAPONS = GUNS

export const FEATURED_GUN_IDS = ['railgun', 'minigun', 'marksman']

export const DEFAULT_GUN_ID = 'pistol'

/** True for guns sold in the store (everything but the free starters). Never "Free" in the UI. */
export const isPaidGun = (g) => !!g && (!!g.iap || !FREE_GUN_IDS.includes(g.id))

export function getGunById(id) {
  return GUNS.find((g) => g.id === id) || GUNS[0]
}
export const getWeapon = getGunById

export const isAutomatic = (w) => w?.fireMode === 'automatic'
export const shotIntervalMs = (w) => Math.max(70, Math.round(1000 / (isAutomatic(w) ? _autoRate(w) : _TAP)))
export const shotsPerPull = (w) => (isAutomatic(w) ? 1 : Math.max(1, Math.min(5, w?.shotsPerClick || 1)))

export const FIRE_MODE_LABELS = {
  get single() { return translate(G, 'fm_single') },
  get burst() { return translate(G, 'fm_burst') },
  get automatic() { return translate(G, 'fm_auto') },
}

/** Forced gap between two trigger pulls in ms (0 = as fast as you tap). Same rule as the host. */
export function cycleMs(gun) {
  try {
    return Math.max(0, Number(_minShotGapMs(gun)) || 0)
  } catch {
    return 0
  }
}

/** Trigger pulls per second: automatics at autoFireRate (≈9/s by default), semi-auto at the tap baseline or their cycle. */
export function pullsPerSecond(gun) {
  try {
    if (isAutomatic(gun)) return _autoRate(gun)
    const gap = cycleMs(gun)
    return gap > 0 ? Math.min(_TAP, 1000 / gap) : _TAP
  } catch {
    return _TAP
  }
}

/** Short fire-rate label for the shop and the weapon wheel, e.g. "≈9 shots/s held" or "tap · 3 beams · 0.5 s". */
export function fireRateLabel(gun) {
  if (isAutomatic(gun)) return translate(G, 'rate_held', { n: Math.round(pullsPerSecond(gun) * 10) / 10 })
  const beams = shotsPerPull(gun)
  const gap = cycleMs(gun)
  const s = Math.round(gap / 100) / 10
  if (beams > 1) return gap > 0 ? translate(G, 'rate_beams_cycle', { n: beams, s }) : translate(G, 'rate_beams', { n: beams })
  return gap > 0 ? translate(G, 'rate_every', { s }) : translate(G, 'rate_every_tap')
}

const HP = 100
const ZONE = { head: 50, body: 25 }

/**
 * Time-to-tag numbers at ≤20 m with every beam landing (camera aim, no falloff):
 *   perPull: body damage per trigger pull · hitsBody / hitsHead: pulls to tag out a 100 HP player
 *   ttkBody / ttkHead: seconds from the first pull to the tag-out · pullsPerSec
 */
export function tagStats(gun) {
  const mult = Math.max(0.3, Math.min(3, gun?.damageMultiplier || 1))
  const beams = shotsPerPull(gun)
  const pps = Math.max(0.1, pullsPerSecond(gun))
  const per = (zone) => Math.max(1, Math.round(ZONE[zone] * mult)) * beams
  const pulls = (zone) => Math.max(1, Math.ceil(HP / per(zone)))
  const ttk = (zone) => Math.round(((pulls(zone) - 1) / pps) * 100) / 100
  return { perPull: per('body'), hitsBody: pulls('body'), hitsHead: pulls('head'), ttkBody: ttk('body'), ttkHead: ttk('head'), pullsPerSec: Math.round(pps * 10) / 10 }
}

// 0–1 ratings used for the stat bars in the shop and the weapon wheel, scaled so the trade-offs
// show: Power = body damage per trigger pull, Fire rate = trigger pulls per second (semi-auto at
// ~6 taps/s or its cycle), Accuracy = hip-fire (compass) aim, Range = metres.
export function gunRatings(gun) {
  const clamp = (v) => Math.max(0.05, Math.min(1, v))
  const t = tagStats(gun)
  return {
    power: clamp(t.perPull / 60),
    fireRate: clamp(t.pullsPerSec / 12),
    accuracy: clamp(((gun.accuracy || 0) + 30) / 70),
    range: clamp((gun.range || 60) / 140),
  }
}

export const SIDE_GRADE_TEXT = 'No gun is strictly better. Paid guns change how you play and each one gives something up; the free Starter Pistol and Street SMG stay fully competitive.'

// ---------------------------------------------------------------------------
// Owner / admin unlock
// ---------------------------------------------------------------------------

// The arcade owner gets every gun, free. Matched ONLY on the signed-in account's email
// (usernames aren't unique, so they're never used for this).
const OWNER_EMAILS = ['iyiyiguy@gmail.com', 'hibernationprophet@gmail.com']

let ownerCache = null // { uid, owner }

/** True when the signed-in account's email is the arcade owner's. Never rejects. */
export async function isArcadeOwner() {
  try {
    const { data, error } = await supabase.auth.getUser()
    const user = data?.user
    if (error || !user) {
      // Offline: fall back to the cached answer for the same signed-in user.
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess?.session?.user?.id
      return !!uid && ownerCache?.uid === uid && ownerCache.owner
    }
    const owner = OWNER_EMAILS.includes(String(user.email || '').trim().toLowerCase())
    ownerCache = { uid: user.id, owner }
    return owner
  } catch {
    return false
  }
}

/** If this is the owner account, make sure every gun is unlocked. Resolves to isOwner. */
export async function ensureOwnerUnlocks() {
  const owner = await isArcadeOwner()
  if (!owner) return false
  try {
    const s = await loadArcadeStats()
    if (GUNS.some((g) => !s.unlockedGuns.includes(g.id))) await _grantItems(GUNS.map((g) => g.id))
  } catch {
    // Best effort; the shop retries on next open.
  }
  return true
}

/**
 * The player's loadout: every weapon they own (free weapons included; everything for the
 * owner), in catalogue order. Never rejects.
 * @returns {Promise<typeof GUNS[number][]>}
 */
export async function getLoadout() {
  try {
    const owner = await ensureOwnerUnlocks()
    const s = await loadArcadeStats()
    const owned = new Set([...FREE_GUN_IDS, ...(s.unlockedGuns || [])])
    return GUNS.filter((g) => owner || owned.has(g.id))
  } catch {
    return GUNS.filter((g) => FREE_GUN_IDS.includes(g.id))
  }
}

/**
 * The player's currently equipped Laser Tag gun (full gun object from GUNS).
 * Falls back to the Starter Pistol if nothing valid is equipped. Never rejects.
 * @returns {Promise<typeof GUNS[number]>}
 */
export async function getEquippedGun() {
  try {
    await ensureOwnerUnlocks()
    const s = await loadArcadeStats()
    const id = s.unlockedGuns.includes(s.equippedGun) ? s.equippedGun : DEFAULT_GUN_ID
    return getGunById(id)
  } catch {
    return GUNS[0]
  }
}

/** Equip an unlocked gun. Resolves true on success. */
export function setEquippedGun(gunId) {
  return _equipItem(gunId)
}

/**
 * Buy (unlock) a gun by spending arcade points (free for the owner account).
 * @returns {Promise<{ ok: boolean, already?: boolean, reason?: 'insufficient', needed?: number }>}
 */
export async function unlockGun(gunId) {
  const gun = GUNS.find((g) => g.id === gunId)
  if (!gun) return { ok: false }
  // The owner never pays.
  if (await isArcadeOwner()) {
    await _grantItems([gunId])
    return { ok: true, free: true }
  }
  return _unlockItem(gunId, gun.unlockPoints)
}
