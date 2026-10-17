// Arcade game catalogue. Ids match arcadeStats game ids; `mpId` is the multiplayer id
// GameLobby / MP_GAMES use ('lasertag' | 'spider-spider' | 'beside-them' | 'chess').
import { loadArcadeStats } from './arcadeStats'
import { translate } from '../i18n'
import gameStrings from '../i18n/strings/games'
import mpStrings from '../i18n/strings/mpGames'
import { getLanguage } from '../i18n'
import { LASER_MODES, howToPlay } from './multiplayer'

export const ARCADE_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'action', name: 'Action' },
  { id: 'strategy', name: 'Strategy' },
  { id: 'party', name: 'Party' },
  { id: 'puzzle', name: 'Puzzle' },
  { id: 'music', name: 'Music' },
]

export const GAMES = [
  {
    id: 'laser-tag',
    mobileOnly: true, // camera / GPS game: phones only (hidden behind a prompt on the web app)
    mpId: 'lasertag',
    route: 'LaserTagLobby',
    name: 'Laser Tag',
    type: 'ar',
    kind: 'multiplayer',
    categories: ['action'],
    icon: '🎯',
    minPlayers: 2,
    maxPlayers: 10,
    tagline: 'Raise your phone. Tag them in the real world.',
    description: 'Real-world laser tag: Free-for-all, Team Deathmatch or Search & Destroy',
    color: '#ff2e63',
    accent: ['#ff2e63', '#7a1cff'],
    cover: require('../../assets/game-covers/laser-tag.jpg'),
    featured: true,
  },
  {
    id: 'battle-royale',
    mobileOnly: true, // camera / GPS game: phones only (hidden behind a prompt on the web app)
    mpId: 'royale',
    route: 'LaserTagLobby',
    name: 'Battle Royale',
    type: 'ar',
    kind: 'multiplayer',
    categories: ['action'],
    icon: '🪂',
    minPlayers: 2,
    maxPlayers: 100,
    tagline: 'The gas is closing in. Last one standing wins.',
    description: 'Real-world battle royale on foot for up to 100 players: a shrinking zone up to 1 mile across, weapon pickups, about 20-25 minutes',
    color: '#ff8a00',
    accent: ['#ff8a00', '#7a1cff'],
    cover: require('../../assets/game-covers/battle-royale.png'),
  },
  {
    id: 'spider',
    mobileOnly: true, // camera / GPS game: phones only (hidden behind a prompt on the web app)
    mpId: 'spider-spider',
    route: 'GameLobby',
    name: 'Spider Spider 123',
    type: 'ar',
    kind: 'multiplayer',
    categories: ['action', 'party'],
    icon: '🕷️',
    minPlayers: 2,
    maxPlayers: 12,
    tagline: 'Run. Hide. Don’t get webbed.',
    description: 'Real-world tag – run from the spider!',
    color: '#ff6a00',
    accent: ['#ff6a00', '#ff2e63'],
    cover: require('../../assets/game-covers/spider-spider-123.jpg'),
    featured: true,
  },
  {
    id: 'beside-them',
    mobileOnly: true, // camera / GPS game: phones only (hidden behind a prompt on the web app)
    mpId: 'beside-them',
    route: 'GameLobby',
    name: 'Beside Them',
    type: 'party',
    kind: 'multiplayer',
    categories: ['party', 'strategy'],
    icon: '🎭',
    minPlayers: 4,
    maxPlayers: 10,
    tagline: 'One of you is lying. Find them.',
    description: 'Find the imposter walking among you. Auto GPS stations, QR markers indoors or photo stations',
    color: '#ff1493',
    accent: ['#ff1493', '#5b6cf0'],
    cover: require('../../assets/game-covers/beside-them-penguins.png'),
    featured: true,
  },
  {
    id: 'chess',
    mpId: 'chess',
    route: 'Chess',
    name: 'Chess',
    type: 'board',
    kind: 'solo',
    categories: ['strategy'],
    icon: '♟️',
    minPlayers: 1,
    maxPlayers: 2,
    tagline: 'Online, vs computer or pass & play.',
    description: 'Play online, the computer or a friend on one phone',
    color: '#00d4ff',
    accent: ['#1b2a4a', '#3a5bd9'],
    cover: require('../../assets/game-covers/chess.png'),
  },
  {
    id: 'mafia',
    mobileOnly: true,
    mpId: 'mafia',
    route: 'GameLobby',
    name: 'Mafia',
    type: 'party',
    kind: 'multiplayer',
    categories: ['party', 'strategy'],
    icon: '🔪',
    minPlayers: 5,
    maxPlayers: 15,
    tagline: 'The town sleeps. The Mafia strikes.',
    description: 'Classic social deduction — find the Mafia before they outnumber you',
    color: '#ef4444',
    accent: ['#ef4444', '#7c3aed'],
    cover: require('../../assets/game-covers/mafia.png'),
    featured: true,
  },
  {
    id: 'heads-up-7-up',
    mobileOnly: true,
    mpId: 'heads-up',
    route: 'GameLobby',
    name: 'Heads Up 7 Up',
    type: 'party',
    kind: 'multiplayer',
    categories: ['party'],
    icon: '👆',
    minPlayers: 4,
    maxPlayers: 30,
    tagline: 'Heads down, thumbs up. Guess who tapped you.',
    description: 'The classic game from 4 players — up to 7 pickers, everyone guesses',
    color: '#8b5cf6',
    accent: ['#8b5cf6', '#3b82f6'],
    cover: require('../../assets/game-covers/heads-up-7-up.png'),
    featured: true,
  },
  {
    id: 'word-race',
    route: 'WordRace',
    name: "What's The Word",
    type: 'word',
    kind: 'solo',
    categories: ['puzzle'],
    icon: '📝',
    minPlayers: 1,
    maxPlayers: 1,
    tagline: 'One shared word a day, or race the clock.',
    description: 'Daily word with streaks and a share grid, plus a timed run: crack as many words as you can before time runs out',
    dailyRoute: { name: 'WordRace', params: { mode: 'daily' } },
    color: '#00c878',
    accent: ['#00c878', '#0a7b8c'],
    cover: require('../../assets/game-covers/whats-the-word.jpg'),
  },
  {
    id: 'studio',
    route: 'Studio',
    name: 'The Lab',
    type: 'music',
    kind: 'solo',
    categories: ['music'],
    icon: '🥁',
    minPlayers: 1,
    maxPlayers: 1,
    tagline: 'Drum machine & sampler. Make a beat in seconds.',
    description: '16 pads, 8 original kits, step sequencer, Auto beats and a sampler that chops any sound. Export your beat as a sound for videos.',
    color: '#ffb21e',
    accent: ['#ff4fa3', '#ffb21e'],
    cover: require('../../assets/game-covers/the-lab.jpg'),
    featured: true,
  },
]

export const GAME_CATEGORIES = ['all', 'solo', 'multiplayer']

export const getGame = (id) => GAMES.find((g) => g.id === id || g.mpId === id) || null

export const playersLabel = (game) =>
  !game ? '' : game.minPlayers === game.maxPlayers
    ? translate(gameStrings, game.minPlayers === 1 ? 'players_one' : 'players_many', { n: game.minPlayers })
    : translate(gameStrings, 'players_range', { min: game.minPlayers, max: game.maxPlayers })

// Translated text for a catalogue field ('name' | 'tagline' | 'description') in the current
// language; falls back to the English value in GAMES. Call at render time.
export const gameText = (game, field) => {
  if (!game) return ''
  const key = `${field}:${game.id}`
  const s = translate(gameStrings, key)
  return s === key ? game[field] : s
}

// Translated arcade rank name (rank from arcadeStats.rankFor / RANKS).
export const rankName = (rank) => {
  if (!rank) return ''
  const key = `rank:${rank.id}`
  const s = translate(gameStrings, key)
  return s === key ? rank.name : s
}

// Translated name for a multiplayer game id (MP_GAMES key such as 'chess', 'lasertag').
export const mpGameName = (mpId, fallback) => {
  const g = getGame(mpId)
  return g ? gameText(g, 'name') : (fallback ?? mpId)
}

// Translated category name ('action', 'party', ... and 'all').
export const categoryName = (id) => {
  const key = `cat:${id}`
  const s = translate(gameStrings, key)
  return s === key ? (ARCADE_CATEGORIES.find((c) => c.id === id)?.name ?? id) : s
}

/**
 * Real local stats for one game (from arcadeStats). `userId` is accepted for
 * backwards compatibility; stats are always the signed-in player's.
 * Chess: `rating` is the vs-computer rating, `onlineRating` the online one (null until a
 * rated online game has been played on this device).
 * @returns {Promise<{ played, wins, losses, draws, bestScore, lastPlayed, rating?, onlineRating? }>}
 */
export async function getUserGameStats(_userId, gameId) {
  const s = await loadArcadeStats()
  const g = s.games[gameId] || { played: 0, wins: 0, losses: 0, draws: 0, bestScore: null, lastPlayed: null }
  return gameId === 'chess'
    ? { ...g, rating: s.chess.rating, onlineRating: s.chess.online?.games > 0 ? s.chess.online.rating : null }
    : { ...g }
}

// ---- Multiplayer texts (lib/multiplayer.js) in the current language; call at render time ----
const mpT = (key, fallback, vars) => {
  const s = translate(mpStrings, key, vars)
  return s === key ? fallback : s
}

// Lobby blurb for an MP_GAMES entry.
export const mpBlurb = (game) => (game ? mpT(`blurb:${game.id}`, game.blurb) : '')

// Label of a lobby setting (MP_GAMES[id].settings[key]).
export const settingLabel = (gameId, key, def) =>
  mpT(`set:${gameId}:${key}`, null) ?? mpT(`set:${key}`, def?.label ?? key)

// Label of one option of a lobby setting.
export const optionLabel = (key, def, o) => {
  const t = mpT(`opt:${key}:${o}`, null)
  if (t != null) return t
  const label = def?.labels?.[o]
  // '5 min' style labels and plain minute / second units use the translated unit.
  const mins = typeof label === 'string' ? /^(\d+) min$/.exec(label) : null
  if (mins) return mpT('unit_min', label, { n: mins[1] })
  if (label != null) return label
  if (def?.unit === 'min') return mpT('unit_min', `${o} min`, { n: o })
  if (def?.unit === 's') return mpT('unit_s', `${o} s`, { n: o })
  return `${o}${def?.unit ? ` ${def.unit}` : ''}`
}

// Laser Tag mode texts: field 'name' | 'short' | 'blurb'.
export const laserMode = (id, field = 'name') => {
  const m = LASER_MODES[id]
  if (!m) return ''
  const key = field === 'name' ? `mode:${id}` : field === 'short' ? `modeshort:${id}` : `modeblurb:${id}`
  return mpT(key, m[field])
}

// Team name ('A' Red / 'B' Blue).
export const teamName = (team) => (team ? mpT(`team:${team.id ?? team}`, team.name ?? team) : '')

// howToPlay(gameId, settings) from lib/multiplayer, translated: { title, steps }.
export function howToPlayText(gameId, settings = {}) {
  const base = howToPlay(gameId, settings)
  if (getLanguage() === 'en') return base
  const lines = (key) => {
    const s = translate(mpStrings, key)
    return s === key ? null : s.split('\n')
  }
  const safety = mpT('safety', null)
  let steps = null
  let title = base.title
  if (gameId === 'lasertag') {
    const mode = LASER_MODES[settings?.mode] ? settings.mode : 'ffa'
    const aim = lines('how_lt_aim')
    const gear = lines('how_lt_gear')
    const by = lines(`how_lt_${mode}`)
    const ffa = lines('how_lt_ffa')
    if (aim && gear && by && ffa && safety) {
      if (settings?.endless) {
        title = mpT('how_lt_arena_title', base.title)
        steps = [safety, mpT('how_lt_arena_intro', ''), ...aim, ...gear, ...ffa.slice(0, 2), mpT('how_lt_arena_outro', '')]
      } else {
        title = `Laser Tag · ${laserMode(mode)}`
        steps = [safety, ...aim, ...gear, ...by]
      }
    }
  } else {
    const KEY = { royale: 'how_royale', chess: 'how_chess', 'spider-spider': 'how_spider', mafia: 'how_mafia', 'heads-up': 'how_headsup' }[gameId] || 'how_beside'
    const own = lines(KEY)
    const withSafety = gameId === 'royale' || gameId === 'spider-spider' || KEY === 'how_beside'
    if (own && (!withSafety || safety)) steps = withSafety ? [safety, ...own] : own
    if (gameId === 'chess') title = mpT('how_chess_title', base.title)
  }
  // Only use the translation when it lines up with the English steps.
  return steps && steps.length === base.steps.length ? { title, steps } : base
}
