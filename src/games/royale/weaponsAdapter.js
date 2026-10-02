// The ONLY place Battle Royale touches the weapon/sound/damage modules, so they can be
// repointed in one file. Everything here is defensive: a missing export or a sound that
// fails to load never crashes the match.
import { useEffect, useMemo, useRef } from 'react'
import * as Guns from '../../lib/guns'
import { zoneDamage as laserZoneDamage } from '../laser/vision'

const FALLBACK = {
  id: 'pistol', name: 'Starter Pistol', icon: '🔫', fireMode: 'single', shotsPerClick: 1, fireRate: 3,
  accuracy: 0, damage: 33, damageMultiplier: 1, range: 60, rarity: 'common',
}

const list = () => {
  const w = Guns.WEAPONS || Guns.GUNS
  return Array.isArray(w) && w.length ? w : [FALLBACK]
}

/** Every weapon id everyone starts a Battle Royale with (the free sidearm + SMG). */
export const START_WEAPON_IDS = (() => {
  const ids = Array.isArray(Guns.FREE_GUN_IDS) && Guns.FREE_GUN_IDS.length ? Guns.FREE_GUN_IDS : ['pistol', 'uzi']
  return ids.filter((id) => list().some((w) => w.id === id)).slice(0, 2)
})()

const RARITY_WEIGHT = { common: 6, rare: 4, epic: 2, legendary: 1 }

/** Weapons that can appear as loot (everything that isn't a starter), with spawn weights. */
export function lootTable() {
  return list()
    .filter((w) => !START_WEAPON_IDS.includes(w.id))
    .map((w) => ({ id: w.id, weight: RARITY_WEIGHT[w.rarity] || 2 }))
}

export function rollLootWeapon(rand = Math.random) {
  const t = lootTable()
  if (!t.length) return START_WEAPON_IDS[0] || 'pistol'
  const total = t.reduce((a, b) => a + b.weight, 0)
  let x = rand() * total
  for (const e of t) {
    x -= e.weight
    if (x <= 0) return e.id
  }
  return t[t.length - 1].id
}

export function isKnownWeapon(id) {
  return typeof id === 'string' && list().some((w) => w.id === id)
}

/** Normalised weapon definition (never null). */
export function getWeapon(id) {
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
  return n.split(' ').pop() || 'Weapon'
}

export const RARITY_COLORS = (() => {
  const r = Guns.RARITIES || {}
  return {
    common: r.common?.color || '#9aa3c0',
    rare: r.rare?.color || '#4fa3ff',
    epic: r.epic?.color || '#b46cff',
    legendary: r.legendary?.color || '#ffb547',
  }
})()

/** Beams per trigger pull (1 for automatic weapons). */
export const shotsPerPull = (w) => (w?.automatic ? 1 : Math.max(1, Math.min(5, w?.shotsPerClick || 1)))
/** Minimum ms between two shots the host accepts from this weapon. */
export const minShotGapMs = (w) => (w?.automatic ? Math.max(60, Math.round(1000 / Math.max(0.25, w.fireRate)) * 0.6) : 80)

/** Damage for one beam hitting `zone` ('head' | 'body' | 'limb') at `distance` metres. */
export function computeDamage(zone, weaponId, distance) {
  const w = getWeapon(weaponId)
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
