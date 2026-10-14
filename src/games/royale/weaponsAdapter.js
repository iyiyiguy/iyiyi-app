// The ONLY place Battle Royale touches the weapon/sound/damage modules, so they can be
// repointed in one file. Everything here is defensive: a missing export or a sound that
// fails to load never crashes the match.
import { useEffect, useMemo, useRef } from 'react'
import * as Guns from '../../lib/guns'
import { zoneDamage as laserZoneDamage } from '../laser/vision'
import { minShotGapMs as laserMinShotGapMs } from '../laser/aimRules'
import { LOOT_RARITY, MELEE_ID, ROCKET_GAP_MS } from './constants'

const FALLBACK = {
  id: 'pistol', name: 'Starter Pistol', icon: '🔫', fireMode: 'single', shotsPerClick: 1, fireRate: 3,
  accuracy: 0, damage: 33, damageMultiplier: 1, range: 60, rarity: 'common',
}

// Battle Royale's melee weapon: everyone starts with only this. Very short reach (the camera
// or GPS must put the target within ~3-6 m, see melee.js), low flat damage, fast swings.
export const MELEE = {
  id: MELEE_ID, name: 'Fists', short: 'Fists', icon: '👊', melee: true, rarity: 'common', fireMode: 'single',
  automatic: false, shotsPerClick: 1, fireRate: 2.5, accuracy: 20, damageMultiplier: 1, range: 6, blastRadius: 0,
  damage: { head: 14, body: 10, limb: 7 }, sound: 'tap',
}

const list = () => {
  const w = Guns.WEAPONS || Guns.GUNS
  return Array.isArray(w) && w.length ? w : [FALLBACK]
}

/** What everyone starts a Battle Royale with: fists only (guns are all loot). */
export const START_WEAPON_IDS = [MELEE_ID]
export const isMelee = (w) => (typeof w === 'string' ? w === MELEE_ID : !!w?.melee)

const RARITIES = ['common', 'rare', 'epic', 'legendary']

/** Weapons that can appear as loot (every gun, starters included; fists aren't loot), with their rarity. */
export function lootTable() {
  return list()
    .filter((w) => w?.id && w.id !== MELEE_ID)
    .map((w) => ({ id: w.id, rarity: RARITIES.includes(w.rarity) ? w.rarity : 'common' }))
}

/**
 * A random loot weapon. Rarity first (LOOT_RARITY: ~50 / 30 / 15 / 5 %), then a weapon of that
 * rarity, so the mix doesn't depend on how many guns each rarity has. `tier` shifts the odds
 * up (0 = start scatter, +1 per zone phase); `minRarity` ('epic' for supply drops) floors it.
 */
export function rollLootWeapon(rand = Math.random, { tier = 0, minRarity = null } = {}) {
  const t = lootTable()
  if (!t.length) return FALLBACK.id
  const floor = Math.max(0, RARITIES.indexOf(minRarity))
  const boost = Math.max(0, Math.min(6, Number(tier) || 0))
  const avail = RARITIES.filter((r, i) => i >= floor && t.some((e) => e.rarity === r))
  const pool = avail.length ? avail : [...new Set(t.map((e) => e.rarity))]
  // Each phase moves weight from common toward the rarer tiers.
  const weights = pool.map((r) => {
    const base = LOOT_RARITY[r] || 1
    if (r === 'common') return Math.max(10, base - boost * 7)
    return base * (1 + boost * (r === 'rare' ? 0.1 : r === 'epic' ? 0.25 : 0.4))
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let x = rand() * total
  let rarity = pool[pool.length - 1]
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i]
    if (x <= 0) { rarity = pool[i]; break }
  }
  const ofRarity = t.filter((e) => e.rarity === rarity)
  return ofRarity[Math.min(ofRarity.length - 1, Math.floor(rand() * ofRarity.length))].id
}

export function isKnownWeapon(id) {
  return typeof id === 'string' && (id === MELEE_ID || list().some((w) => w.id === id))
}

export const rarityRank = (r) => Math.max(0, RARITIES.indexOf(r))

/** Normalised weapon definition (never null). */
export function getWeapon(id) {
  if (id === MELEE_ID) return MELEE
  let w = null
  try { w = typeof Guns.getWeapon === 'function' ? Guns.getWeapon(id) : null } catch { w = null }
  if (!w || w.id !== id) w = list().find((x) => x.id === id) || w || FALLBACK
  const automatic = w.fireMode === 'automatic'
  return {
    id: w.id,
    name: w.name || 'Weapon',
    short: shortName(w),
    icon: w.icon || '🔫',
    rarity: w.rarity || 'common',
    fireMode: w.fireMode || 'single',
    automatic,
    shotsPerClick: automatic ? 1 : Math.max(1, Math.min(5, w.shotsPerClick || 1)),
    fireRate: Math.max(0.25, Math.min(15, w.fireRate || 1)),
    autoRateScale: w.autoRateScale,
    fixedAutoRate: w.fixedAutoRate,
    accuracy: Math.max(-30, Math.min(40, w.accuracy || 0)),
    damageMultiplier: Math.max(0.3, Math.min(3, w.damageMultiplier || 1)),
    range: Math.max(10, Math.min(200, w.range || 60)),
    blastRadius: Math.max(0, Number(w.blastRadius) || 0),
    sound: w.sound,
  }
}

function shortName(w) {
  const n = String(w?.name || '')
  if (/assault/i.test(n)) return 'AR'
  if (/sniper/i.test(n)) return 'Sniper'
  if (/marksman|dmr/i.test(n)) return 'DMR'
  if (/smg/i.test(n)) return 'SMG'
  if (/burst/i.test(n)) return 'Burst'
  if (/scatter|shotgun/i.test(n)) return 'Scatter'
  if (/minigun/i.test(n)) return 'Minigun'
  if (/rail/i.test(n)) return 'Railgun'
  if (/pistol/i.test(n)) return 'Pistol'
  if (/launcher|rocket/i.test(n)) return 'Rocket'
  return n.split(' ').pop() || 'Weapon'
}

// Studio HUD rarity colours (epic matches the studio epic token). Kept as plain hex here so
// this module stays free of UI imports.
export const RARITY_COLORS = {
  common: '#c9ced6',
  rare: '#4f8dff',
  epic: '#b06cff',
  legendary: '#ffb21e',
}
export const RARITY_LABEL = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' }

/** Beams per trigger pull (1 for automatic weapons). */
export const shotsPerPull = (w) => (w?.automatic ? 1 : Math.max(1, Math.min(5, w?.shotsPerClick || 1)))
/**
 * Minimum ms between two shots the host (and the shooter's phone) accepts from this weapon.
 * Same cycle rules as Laser Tag (laser/aimRules.minShotGapMs): explosive launchers their full
 * cycle (rocket: 1 per 3 s), other slow semi-autos (fireRate < 1/s) half of it, fast
 * semi-autos only the 80 ms spam guard; automatics 60 % of their nominal interval.
 */
export function minShotGapMs(w) {
  if (!w) return 80
  if (w.melee) return Math.max(80, Math.round((1000 / Math.max(0.25, w.fireRate || 2.5)) * 0.8))
  if (w.automatic) return Math.max(60, Math.round(1000 / Math.max(0.25, w.fireRate)) * 0.6)
  let gap = 0
  try { gap = Number(laserMinShotGapMs({ fireMode: w.fireMode, fireRate: w.fireRate, blastRadius: w.blastRadius })) || 0 } catch { gap = 0 }
  if (w.blastRadius > 0) gap = Math.max(gap, ROCKET_GAP_MS)
  return Math.max(80, gap)
}

/** Damage for one beam hitting `zone` ('head' | 'body' | 'limb') at `distance` metres. */
export function computeDamage(zone, weaponId, distance) {
  const w = getWeapon(weaponId)
  // Melee: flat, low damage (no falloff).
  if (w.melee) return Math.max(1, Math.round(w.damage?.[zone] ?? w.damage?.body ?? 10))
  try {
    return Math.max(1, Math.round(laserZoneDamage(zone, w, Number.isFinite(distance) ? distance : 30)))
  } catch {
    const base = zone === 'head' ? 50 : zone === 'limb' ? 15 : 25
    return Math.max(1, Math.round(base * w.damageMultiplier))
  }
}

// ---- trigger + sound --------------------------------------------------------------

// Minimal stand-in used only if guns.js ever stops exporting useTrigger.
function useFallbackTrigger(weapon, onShot, { enabled = true } = {}) {
  const ref = useRef({ weapon, onShot, enabled, timer: null })
  ref.current.weapon = weapon
  ref.current.onShot = onShot
  ref.current.enabled = enabled
  const t = useMemo(() => {
    const stop = () => { if (ref.current.timer) clearInterval(ref.current.timer); ref.current.timer = null }
    const fire = () => {
      if (!ref.current.enabled) { stop(); return }
      try { ref.current.onShot?.(ref.current.weapon) } catch { /* ignore */ }
    }
    return {
      onPressIn: () => {
        if (!ref.current.enabled) return
        stop()
        fire()
        const w = ref.current.weapon
        if (w?.fireMode === 'automatic') ref.current.timer = setInterval(fire, Math.max(60, Math.round(1000 / Math.max(0.25, w.fireRate || 1))))
      },
      onPressOut: stop,
      stop,
      isHeld: () => !!ref.current.timer,
    }
  }, [])
  useEffect(() => { t.stop() }, [weapon?.id, enabled, t])
  useEffect(() => () => t.stop(), [t])
  return t
}

const useTriggerImpl = typeof Guns.useTrigger === 'function' ? Guns.useTrigger : useFallbackTrigger

/** Hold/tap trigger for a weapon (guns.js useTrigger): { onPressIn, onPressOut, stop }. */
export function useWeaponTrigger(weapon, onShot, opts) {
  return useTriggerImpl(weapon, onShot, opts)
}

export function playShot(weapon) {
  if (isMelee(weapon)) { playSfx('tap'); return }
  try { Guns.playShot?.(weapon?.id ? weapon : String(weapon || 'pistol')) } catch { /* sound is optional */ }
}

export function playSfx(name, opts) {
  try { Guns.playSfx?.(name, opts) } catch { /* sound is optional */ }
}

export function preloadSounds(weaponIds = []) {
  try { Guns.preloadWeaponSounds?.(weaponIds, ['hit', 'empty', 'beep', 'planted', 'tap']) } catch { /* optional */ }
}

export function releaseSounds() {
  try { Guns.releaseWeaponSounds?.() } catch { /* optional */ }
}
