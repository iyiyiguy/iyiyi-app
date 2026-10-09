// Weapon + game sound effects (original synthesized WAVs from scripts/gen_gun_sounds.py).
//
// Each effect has a small pool of expo-audio players used round-robin, so rapid fire
// overlaps instead of cutting itself off or queueing. Players are created lazily on first
// use (or by preloadWeaponSounds) and freed by releaseWeaponSounds(). Everything respects
// the player's "Sound effects" setting (gamePrefs `sound`) and never throws.
//
//   playShot(weaponId)   the weapon's gunshot (falls back to the pistol)
//   playSfx(name)        any effect in SFX: 'hit' | 'empty' | 'planted' | 'beep' | 'defused' | 'explosion' | 'tap' | …
import { createAudioPlayer } from 'expo-audio'
import { getPrefs } from './gamePrefs'

export const SFX = {
  pistol: require('../../assets/sounds/pistol.wav'),
  smg: require('../../assets/sounds/smg.wav'),
  rifle: require('../../assets/sounds/rifle.wav'),
  ar: require('../../assets/sounds/ar.wav'),
  dmr: require('../../assets/sounds/dmr.wav'),
  sniper: require('../../assets/sounds/sniper.wav'),
  shotgun: require('../../assets/sounds/shotgun.wav'),
  minigun: require('../../assets/sounds/minigun.wav'),
  railgun: require('../../assets/sounds/railgun.wav'),
  rocket: require('../../assets/sounds/rocket.wav'),
  empty: require('../../assets/sounds/empty.wav'),
  hit: require('../../assets/sounds/hit.wav'),
  planted: require('../../assets/sounds/planted.wav'),
  beep: require('../../assets/sounds/beep.wav'),
  defused: require('../../assets/sounds/defused.wav'),
  explosion: require('../../assets/sounds/explosion.wav'),
  tap: require('../../assets/sounds/tap.wav'),
  // What's The Word (scripts/gen_word_sounds.py)
  wordKey: require('../../assets/sounds/word_key.wav'),
  wordFlip: require('../../assets/sounds/word_flip.wav'),
  wordCorrect: require('../../assets/sounds/word_correct.wav'),
  wordWrong: require('../../assets/sounds/word_wrong.wav'),
  wordFail: require('../../assets/sounds/word_fail.wav'),
  wordTick: require('../../assets/sounds/word_tick.wav'),
  wordGo: require('../../assets/sounds/word_go.wav'),
  wordCount: require('../../assets/sounds/word_count.wav'),
  wordWin: require('../../assets/sounds/word_win.wav'),
  wordCombo: require('../../assets/sounds/word_combo.wav'),
}

// Weapon id → effect (kept here too so this module has no dependency on guns.js).
const WEAPON_SOUND = {
  pistol: 'pistol', uzi: 'smg', burst: 'rifle', smg: 'smg', sniper: 'sniper', scatter: 'shotgun',
  assault: 'ar', marksman: 'dmr', minigun: 'minigun', railgun: 'railgun', rocket: 'rocket',
}
// Rapid-fire effects get more voices.
const POOL_SIZE = { smg: 5, minigun: 6, ar: 4, rifle: 4, railgun: 3, tap: 3, hit: 3, wordKey: 4, wordFlip: 5 }

const pools = {} // name -> { players: AudioPlayer[], next: number }

function poolFor(name) {
  if (pools[name]) return pools[name]
  const src = SFX[name]
  if (!src) return null
  const size = POOL_SIZE[name] || 2
  const players = []
  for (let i = 0; i < size; i++) {
    try {
      const p = createAudioPlayer(src)
      players.push(p)
    } catch {
      break
    }
  }
  if (!players.length) return null
  pools[name] = { players, next: 0 }
  return pools[name]
}

/** Play an effect from SFX (respects the Sound effects setting). */
export function playSfx(name, { volume = 1 } = {}) {
  if (!getPrefs().sound) return
  try {
    const pool = poolFor(name)
    if (!pool) return
    const p = pool.players[pool.next]
    pool.next = (pool.next + 1) % pool.players.length
    try { p.volume = volume } catch { /* ignore */ }
    const r = p.seekTo(0)
    if (r && typeof r.catch === 'function') r.catch(() => {})
    p.play()
  } catch {
    // Sound is a nice-to-have.
  }
}

/** The gunshot for a weapon id (or a weapon object). */
export function playShot(weapon) {
  const id = typeof weapon === 'string' ? weapon : weapon?.id
  const name = (typeof weapon === 'object' && weapon?.sound) || WEAPON_SOUND[id] || 'pistol'
  playSfx(name)
}

/** Create the players ahead of time so the first shot has no delay. */
export function preloadWeaponSounds(weaponIds = [], extra = ['hit', 'empty']) {
  const names = new Set(extra)
  for (const id of weaponIds) names.add(WEAPON_SOUND[id] || 'pistol')
  for (const n of names) poolFor(n)
}

/** Free every player (call when leaving a match). */
export function releaseWeaponSounds() {
  for (const name of Object.keys(pools)) {
    for (const p of pools[name].players) {
      try { p.remove() } catch { /* ignore */ }
    }
    delete pools[name]
  }
}
