// Battle Royale tuning. Everything the host rules, the HUD and the lobby share.
import { ROYALE_AREAS } from '../../lib/multiplayer'

export { ROYALE_AREAS }
export const DEFAULT_AREA_ID = '1mi'
export const areaRadius = (id) => (ROYALE_AREAS[id] || ROYALE_AREAS[DEFAULT_AREA_ID]).r

export const MAX_HP = 100
export const COUNTDOWN_MS = 10000
export const FINAL_RADIUS_M = 50
export const ZONE_PHASES = 6 // shrinks before the final collapse
export const FINAL_HOLD_MS = 90000 // the final circle holds, then collapses
export const COLLAPSE_MS = 60000

// Gas damage per second outside the safe zone, by phase (index 0 = before the first shrink
// finishes, last = the final collapse).
export const GAS_DPS = [1, 2, 3, 4, 6, 8, 10, 15]

// How fast the gas edge moves (m/s). Small areas are on foot; big ones assume people will
// also travel (as passengers) between zones, so the edge moves faster.
export const GAS_SPEED = { '1mi': 1.1, '2mi': 1.8, '3mi': 2.6, '5mi': 4 }
export const PACE = {
  fast: { id: 'fast', label: 'Fast', speed: 1.6, wait: 0.6 },
  normal: { id: 'normal', label: 'Normal', speed: 1, wait: 1 },
  long: { id: 'long', label: 'Long', speed: 0.7, wait: 1.4 },
}

// Loot: walk this close to pick a weapon up.
export const PICKUP_RANGE_M = 10
export const MAX_LOOT = 150

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

// Position sharing: at most 1/s while moving, every 4 s while standing still.
export const POS_MOVING_MS = 1000
export const POS_IDLE_MS = 4000
export const POS_MOVED_M = 3

// Map rendering caps.
export const MAP_MAX_DOTS = 60
export const MAP_MAX_CLUSTERS = 40
export const MAP_MAX_LOOT = 80

export const ROYALE_COLORS = {
  zone: '#e8f1ff',
  next: '#ffffff',
  gas: '#a14dff',
  enemy: '#ff5d6c',
  me: '#3ad1ff',
  loot: '#ffc94d',
  follow: '#2fdc8f',
  cover: ['#ff8a00', '#ff2e63', '#5b1cff'],
}

// Lobby/game copy.
export const TRANSIT_TEXT = 'In transit — firing disabled while moving at vehicle speed. Passengers can view the map.'
