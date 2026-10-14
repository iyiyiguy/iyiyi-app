// Battle Royale tuning. Everything the host rules, the HUD and the lobby share.
import { ROYALE_AREAS as SHARED_AREAS } from '../../lib/multiplayer'

// Starting areas (radius around the centre). There is NO public cap: the host picks a preset
// or a custom radius (CUSTOM_MIN_M - CUSTOM_MAX_M) in any lobby. The zone schedule scales
// with the radius (zone.js): areas under 5 mi are played on foot and the gas always gives a
// walker time to reach the next circle; 5+ mile games assume players may travel as
// passengers while the circles are bigger than a mile (never while driving — the transit
// speed lock and the transit gas pause stay). zone.estimateMatch gives the expected length.
const mi = (id) => SHARED_AREAS?.[id]?.r
export const ROYALE_AREAS = {
  qtr: { id: 'qtr', label: '¼ mi', r: 402.34 },
  quick: { id: 'quick', label: '⅓ mi', r: 560 },
  '1mi': { id: '1mi', label: '1 mi', r: mi('1mi') || 1609.34 },
  '5mi': { id: '5mi', label: '5 mi', r: mi('5mi') || 8046.72 },
  '10mi': { id: '10mi', label: '10 mi', r: mi('10mi') || 16093.44 },
  // No longer offered; kept so a lobby set up by an older build still resolves its radius.
  '2mi': { id: '2mi', label: '2 mi', r: mi('2mi') || 3218.69, legacy: true },
  '3mi': { id: '3mi', label: '3 mi', r: mi('3mi') || 4828.03, legacy: true },
}
export const CUSTOM_AREA_ID = 'custom'
export const CUSTOM_MIN_M = 100
export const CUSTOM_MAX_M = 16000
export const CUSTOM_DEFAULT_M = 800
// Radius stops for the custom stepper (metres).
export const CUSTOM_STEPS_M = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 14000, 16000]
// The default "Quick" match: about 20-25 min on the Normal pace, ~1-2 km of walking.
export const DEFAULT_AREA_ID = 'quick'
// The presets the lobby offers, in order (then "Custom").
export const PRESET_AREA_IDS = ['qtr', 'quick', '1mi', '5mi', '10mi']
// From this starting radius the big early circles assume passengers (cars, buses) may move
// players; every circle of 1 mi or less still guarantees walkers make it (zone.js).
export const PASSENGER_AREA_M = 8000 // ≈ 5 mi
export const FOOT_RADIUS_M = 1609.34 // circles this size or smaller: always walkable
export const PASSENGER_MPS = 4 // ≈ 9 mph incl. stops: the travel speed the big circles allow for
export const BIG_AREA_TEXT = '5+ mile games assume players may travel as passengers — never play while driving. Firing locks at vehicle speed and the gas pauses for you in transit (up to 5 min per match).'
export const isBigArea = (r) => Number(r) >= PASSENGER_AREA_M
export const clampRadius = (r) => {
  const v = Number(r)
  if (!Number.isFinite(v)) return CUSTOM_DEFAULT_M
  return Math.round(Math.max(CUSTOM_MIN_M, Math.min(CUSTOM_MAX_M, v)))
}
/** The area id a lobby uses (any preset or 'custom' in any lobby; unknown → the default). */
export function allowedAreaId(id) {
  if (id === CUSTOM_AREA_ID || ROYALE_AREAS[id]) return id
  return DEFAULT_AREA_ID
}
/** Starting radius (m) for an area id; custom uses `customR`, clamped to sane bounds. */
export function areaRadius(id, customR) {
  if (id === CUSTOM_AREA_ID) return clampRadius(customR)
  return (ROYALE_AREAS[id] || ROYALE_AREAS[DEFAULT_AREA_ID]).r
}
/** { id, r } from lobby settings: settings.areaId (+ settings.radiusM / area.r for custom). */
export function resolveArea(settings) {
  const s = settings || {}
  const id = allowedAreaId(s.areaId || s.area?.preset)
  const r = areaRadius(id, s.radiusM ?? s.area?.r)
  return { id, r }
}
/** "0.5 mi" / "800 m" style radius text. */
export function radiusText(r) {
  const m = Number(r) || 0
  const miles = m / 1609.34
  if (miles >= 0.95) return `${miles >= 9.95 ? Math.round(miles) : Math.round(miles * 10) / 10} mi`
  if (m >= 1000) return `${Math.round(m / 100) / 10} km`
  return `${Math.round(m)} m`
}
/** Label for a match's area ({ id, r } as stored in state.area). */
export function areaLabelFor(area) {
  if (!area) return null
  if (ROYALE_AREAS[area.id]) return ROYALE_AREAS[area.id].label
  return Number.isFinite(area.r) ? radiusText(area.r) : null
}

export const MAX_HP = 100
export const COUNTDOWN_MS = 10000
export const FINAL_RADIUS_M = 50
export const ZONE_PHASES = 6 // shrinks before the final collapse
export const FINAL_HOLD_MS = 90000 // the final circle holds, then collapses
export const COLLAPSE_MS = 60000

// Gas damage per second outside the safe zone, by phase (index 0 = before the first shrink
// finishes, last = the final collapse).
export const GAS_DPS = [1, 2, 3, 4, 6, 8, 10, 15]

// How fast the gas edge moves (m/s), from the size of the circle it is leaving: ~1.1 m/s up to
// a mile, faster for bigger circles (√ of the size, capped). Whatever the nominal speed, the
// schedule never moves the gas faster than a walker (or, for the big circles of a 5+ mile
// game, a passenger) from the far edge can make it (zone.js).
export const GAS_SPEED_MIN = 1.1
export const GAS_SPEED_MAX = 4
export const gasSpeedFor = (r) => Math.max(GAS_SPEED_MIN, Math.min(GAS_SPEED_MAX, GAS_SPEED_MIN * Math.sqrt(Math.max(0, Number(r) || 0) / 1609.34)))
// A steady walk (m/s): the pace the zone schedule guarantees is enough on every area.
export const WALK_MPS = 1.3
export const PACE = {
  fast: { id: 'fast', label: 'Fast', speed: 1.6, wait: 0.6 },
  normal: { id: 'normal', label: 'Normal', speed: 1, wait: 1 },
  long: { id: 'long', label: 'Long', speed: 0.7, wait: 1.4 },
}

// Loot: walk this close to pick a weapon up.
export const PICKUP_RANGE_M = 10
// Weapons on the ground at once (the state is re-broadcast to every phone, so it's capped).
export const MAX_LOOT = 220
// Fists + this many weapons.
export const MAX_GUN_SLOTS = 2
// Start scatter across the starting zone: per player + per km², within [min, max].
export const LOOT_PER_PLAYER = 3.5
export const LOOT_PER_KM2 = 4
export const LOOT_START_MIN = 8
export const LOOT_START_MAX = 160
// Dropped into the next circle each time a new zone is announced.
export const PHASE_DROPS_MIN = 2
export const PHASE_DROPS_MAX = 12
export const PHASE_DROPS_PER_ALIVE = 0.4
// Supply drop: one crate of top-tier weapons inside the next circle when the gas starts moving.
export const SUPPLY_ITEMS = 2
// Rarity mix for loot (later phases shift it up, supply drops are epic/legendary).
export const LOOT_RARITY = { common: 50, rare: 30, epic: 15, legendary: 5 }
// AR markers for loot on the camera view within this distance.
export const LOOT_AR_M = 50

// Melee (everyone starts with only their fists). The shooter's phone only swings at a person
// within ~MELEE_CAM_M: a tracked body box at least as tall as a person that close fills
// (melee.js), or — without the camera — a GPS distance under MELEE_GPS_M with both fixes
// better than MELEE_GPS_ACC_M. The host checks the GPS distance with the GPS error allowance.
export const MELEE_ID = 'fists'
export const MELEE_CAM_M = 3
export const MELEE_GPS_M = 6
export const MELEE_GPS_ACC_M = 12
export const MELEE_HOST_MAX_M = 20
export const PERSON_H_M = 1.7

// Combat validation (host).
export const HIT_RANGE_SLACK_M = 25 // GPS error allowance on top of a weapon's range
export const VISION_MAX_M = 55
export const HOST_HIT_MIN_MS = 80

// Disconnect / no-GPS handling (host).
export const ABSENT_ELIMINATE_MS = 60000
export const NO_GPS_ELIMINATE_MS = 75000

// Vehicle transit (safety). 15 mph ≈ 6.7 m/s, 4 mph ≈ 1.8 m/s.
export const TRANSIT_ENTER_MPS = 6.7
export const TRANSIT_ENTER_MS = 5000
export const TRANSIT_EXIT_MPS = 1.8
export const TRANSIT_EXIT_MS = 8000
// While a player is in a detected transit lock the gas doesn't hurt them (they can't fire,
// be hit or loot either), so being driven somewhere is never a death sentence and nobody is
// pushed to drive. The pause is capped per match so it can't be used to hide from the gas.
export const TRANSIT_GAS_GRACE_MS = 5 * 60000

// Position sharing: at most 1/s while moving, every 4 s while standing still.
export const POS_MOVING_MS = 1000
export const POS_IDLE_MS = 4000
export const POS_MOVED_M = 3

// Map rendering caps.
export const MAP_MAX_DOTS = 60
export const MAP_MAX_CLUSTERS = 40
export const MAP_MAX_LOOT = 80

// Studio HUD roles: zone = objective amber, you = friendly cyan, everyone else = enemy red.
export const ROYALE_COLORS = {
  zone: '#ffb21e',
  next: '#ffffff',
  gas: '#ffb21e',
  enemy: '#ff3d52',
  me: '#39d5ff',
  loot: '#ffb21e',
  follow: '#39d5ff',
  transit: '#8a93a3',
  cover: ['#ff8a00', '#ff2e63', '#5b1cff'],
}

// Lobby/game copy.
export const TRANSIT_TEXT = 'In transit — firing is off and the gas is paused while you move at vehicle speed (up to 5 min per match). Never play while driving; passengers can view the map.'

// Rockets follow the Laser Tag rules (laser/engine.js ROCKET_RADIUS_M / ROCKET_GAP_MS /
// ROCKET_SPLASH_*): 9 m blast (+ up to 3 m GPS slack), 70 → 20 splash damage, 1 per 3 s.
export const ROCKET_RADIUS_M = 9
export const ROCKET_SLACK_CAP_M = 3
export const ROCKET_SPLASH_MAX = 70
export const ROCKET_SPLASH_MIN = 20
export const ROCKET_GAP_MS = 3000
