// Laser Tag weapons — the shared weapon API for every arcade shooter (Laser Tag, Battle
// Royale, …). Weapons are sold in the Arcade Shop for arcade coins earned by playing (no
// money, no IAP). Ownership and the equipped weapon are persisted per player in
// arcadeStats. The arcade owner account (see isArcadeOwner) has every weapon, free.
//
// ── Public API ───────────────────────────────────────────────────────────────────────
//   WEAPONS / GUNS                 all weapon definitions (same array)
//   getWeapon(id) / getGunById(id) one definition (falls back to the pistol)
//   isAutomatic(weapon)            true → fires continuously while the trigger is held
//   shotIntervalMs(weapon)         ms between automatic shots (from fireRate)
//   shotsPerPull(weapon)           beams per trigger pull for semi/burst weapons (1–5)
//   FREE_GUN_IDS                   weapons everyone owns ('pistol', 'uzi')
//   getLoadout()                   Promise<weapon[]> the player's owned weapons
//   getEquippedGun() / setEquippedGun(id) / unlockGun(id)
//   useTrigger(weapon, onShot, { enabled })   (re-exported from ./weaponFire)
//   playShot(weaponId), playSfx(name), preloadWeaponSounds(ids) (re-exported from ./gunAudio)
//
// ── Fire rules ───────────────────────────────────────────────────────────────────────
//   Ammo is unlimited: there is no magazine and no reload.
//   Semi-automatic ('single' / 'burst'): exactly one trigger pull per tap, with NO rate cap
//     — every tap fires, however fast you tap. A burst pull fires `shotsPerClick` beams.
//   Automatic: fires on press, then every shotIntervalMs() while held.
import { supabase } from './supabase'
import { FREE_GUN_IDS, loadArcadeStats, _unlockItem, _equipItem, _grantItems } from './arcadeStats'

export { FREE_GUN_IDS }
export { useTrigger, autoFireRate, measuredTapRate, TAP_BASELINE_RATE } from './weaponFire'
import { autoFireRate as _autoRate, TAP_BASELINE_RATE as _TAP } from './weaponFire'
export { playShot, playSfx, preloadWeaponSounds, releaseWeaponSounds, SFX } from './gunAudio'

export const RARITIES = {
  common: { id: 'common', name: 'Common', color: '#9aa3c0' },
  rare: { id: 'rare', name: 'Rare', color: '#4fa3ff' },
  epic: { id: 'epic', name: 'Epic', color: '#b46cff' },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffb547' },
}

export const GUN_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'sidearm', name: 'Sidearms' },
  { id: 'rifle', name: 'Rifles' },
  { id: 'precision', name: 'Precision' },
  { id: 'heavy', name: 'Heavy' },
]

// Field notes:
//   fireMode         single | burst | automatic
//   shotsPerClick    beams per trigger pull (single/burst); clamped to 1–5
//   fireRate         automatic: nominal shots/s while held at the ~6/s tap baseline (display);
//                    the live rate comes from weaponFire.autoFireRate (1.5× tap rate, 6–12/s)
//   autoRateScale    automatic: per-weapon multiplier on that rate
//   fixedAutoRate    automatic: fixed shots/s instead (heavy, slow-firing weapons)
//   accuracy         hit-chance bonus/penalty in % (compass aim)
//   damageMultiplier scales zone damage (head 50 / body 25 / limb 15)
//   range            effective range, metres
//   sound            sound effect id in gunAudio (assets/sounds/<sound>.wav)
//   unlockPoints     price in arcade coins (0 = free)
export const GUNS = [
  { id: 'pistol', name: 'Starter Pistol', icon: '🔫', category: 'sidearm', rarity: 'common', free: true,
    description: 'Semi-auto – every tap fires', fireMode: 'single', shotsPerClick: 1, fireRate: 3,
    accuracy: 0, damage: 33, damageMultiplier: 1, range: 60, sound: 'pistol', unlockPoints: 0 },
  { id: 'uzi', name: 'Street SMG', icon: '🔫', category: 'sidearm', rarity: 'common', free: true,
    description: 'Free compact automatic – hold to spray', fireMode: 'automatic', shotsPerClick: null, fireRate: 9, autoRateScale: 1,
    accuracy: 0, damage: 30, damageMultiplier: 0.4, range: 50, sound: 'smg', unlockPoints: 0 },
  { id: 'burst', name: 'Burst Rifle', icon: '🎯', category: 'rifle', rarity: 'common',
    description: '3 beams per tap – balanced power', fireMode: 'burst', shotsPerClick: 3, fireRate: 1.5,
    accuracy: 10, damage: 33, damageMultiplier: 0.8, range: 70, sound: 'rifle', unlockPoints: 100 },
  { id: 'smg', name: 'Pulse SMG', icon: '💠', category: 'sidearm', rarity: 'rare',
    description: 'Very fast automatic for close quarters', fireMode: 'automatic', shotsPerClick: null, fireRate: 10, autoRateScale: 1.1,
    accuracy: -5, damage: 25, damageMultiplier: 0.38, range: 40, sound: 'smg', unlockPoints: 200 },
  { id: 'sniper', name: 'Sniper Rifle', icon: '🔭', category: 'precision', rarity: 'epic',
    description: 'Powerful and precise – one-hit tag', fireMode: 'single', shotsPerClick: 1, fireRate: 0.5,
    accuracy: 30, damage: 100, damageMultiplier: 2, range: 120, sound: 'sniper', unlockPoints: 250 },
  { id: 'scatter', name: 'Scatter Blaster', icon: '💥', category: 'heavy', rarity: 'rare',
    description: 'Five-beam spread – devastating up close', fireMode: 'burst', shotsPerClick: 5, fireRate: 0.8,
    accuracy: 15, damage: 60, damageMultiplier: 0.6, range: 25, sound: 'shotgun', unlockPoints: 350 },
  { id: 'assault', name: 'Assault Rifle', icon: '🔥', category: 'rifle', rarity: 'rare',
    description: 'Automatic fire – hold to spray', fireMode: 'automatic', shotsPerClick: null, fireRate: 9, autoRateScale: 1,
    accuracy: 0, damage: 33, damageMultiplier: 0.6, range: 65, sound: 'ar', unlockPoints: 450 },
  { id: 'marksman', name: 'Marksman DMR', icon: '🎖️', category: 'precision', rarity: 'epic',
    description: 'Semi-auto precision at long range', fireMode: 'single', shotsPerClick: 1, fireRate: 1.2,
    accuracy: 20, damage: 50, damageMultiplier: 1.4, range: 95, sound: 'dmr', unlockPoints: 600 },
  { id: 'minigun', name: 'Minigun', icon: '⚡', category: 'heavy', rarity: 'epic',
    description: 'Maximum fire rate – hold and never stop', fireMode: 'automatic', shotsPerClick: null, fireRate: 11, autoRateScale: 1.25,
    accuracy: -20, damage: 50, damageMultiplier: 0.35, range: 45, sound: 'minigun', unlockPoints: 800 },
  { id: 'railgun', name: 'Ion Railgun', icon: '☄️', category: 'precision', rarity: 'legendary',
    description: 'Heavy charged beams – hold for 4 punchy shots a second', fireMode: 'automatic', shotsPerClick: null, fireRate: 4, fixedAutoRate: 4,
    accuracy: 40, damage: 100, damageMultiplier: 1.6, range: 140, sound: 'railgun', unlockPoints: 1200 },
]

export const WEAPONS = GUNS

export const FEATURED_GUN_IDS = ['railgun', 'minigun', 'marksman']

export const DEFAULT_GUN_ID = 'pistol'

export function getGunById(id) {
  return GUNS.find((g) => g.id === id) || GUNS[0]
}
export const getWeapon = getGunById

export const isAutomatic = (w) => w?.fireMode === 'automatic'
export const shotIntervalMs = (w) => Math.max(70, Math.round(1000 / (isAutomatic(w) ? _autoRate(w) : _TAP)))
export const shotsPerPull = (w) => (isAutomatic(w) ? 1 : Math.max(1, Math.min(5, w?.shotsPerClick || 1)))

export const FIRE_MODE_LABELS = { single: 'Semi-auto', burst: 'Burst', automatic: 'Full-auto' }

/** Trigger pulls per second: automatics at autoFireRate (≈9/s by default), semi-auto at the tap baseline. */
export function pullsPerSecond(gun) {
  try {
    return isAutomatic(gun) ? _autoRate(gun) : _TAP
  } catch {
    return _TAP
  }
}

/** Short fire-rate label for the shop and the weapon wheel, e.g. "≈9 shots/s held" or "tap · 3 beams". */
export function fireRateLabel(gun) {
  if (isAutomatic(gun)) return `≈${Math.round(pullsPerSecond(gun))} shots/s held`
  const beams = shotsPerPull(gun)
  return beams > 1 ? `tap · ${beams} beams` : 'every tap fires'
}

// 0–1 ratings used for the stat bars in the shop and the weapon wheel.
// Power = damage per beam; Fire rate = beams per second (semi-auto at ~6 taps/s).
export function gunRatings(gun) {
  const clamp = (v) => Math.max(0.05, Math.min(1, v))
  const beamsPerSec = pullsPerSecond(gun) * shotsPerPull(gun)
  return {
    power: clamp((gun.damageMultiplier || 1) / 2),
    fireRate: clamp(beamsPerSec / 14),
    accuracy: clamp(((gun.accuracy || 0) + 30) / 70),
    range: clamp((gun.range || 60) / 140),
  }
}

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
