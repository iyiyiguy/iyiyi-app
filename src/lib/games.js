// Arcade game catalogue. Ids match arcadeStats game ids; `mpId` is the multiplayer id
// GameLobby / MP_GAMES use ('lasertag' | 'spider-spider' | 'beside-them' | 'chess').
import { loadArcadeStats } from './arcadeStats'

export const ARCADE_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'action', name: 'Action' },
  { id: 'strategy', name: 'Strategy' },
  { id: 'party', name: 'Party' },
  { id: 'puzzle', name: 'Puzzle' },
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
    description: 'Real-world battle royale for up to 100 players with a shrinking zone and weapon pickups',
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
    description: 'Find the imposter walking among you',
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
    id: 'word-race',
    route: 'WordRace',
    name: "What's The Word",
    type: 'word',
    kind: 'solo',
    categories: ['puzzle'],
    icon: '📝',
    minPlayers: 1,
    maxPlayers: 1,
    tagline: 'Beat the clock. Crack the word.',
    description: 'Crack as many words as you can before time runs out',
    color: '#00c878',
    accent: ['#00c878', '#0a7b8c'],
    cover: require('../../assets/game-covers/whats-the-word.jpg'),
  },
]

export const GAME_CATEGORIES = ['all', 'solo', 'multiplayer']

export const getGame = (id) => GAMES.find((g) => g.id === id || g.mpId === id) || null

export const playersLabel = (game) =>
  !game ? '' : game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} player${game.minPlayers === 1 ? '' : 's'}`
    : `${game.minPlayers}–${game.maxPlayers} players`

/**
 * Real local stats for one game (from arcadeStats). `userId` is accepted for
 * backwards compatibility; stats are always the signed-in player's.
 * @returns {Promise<{ played, wins, losses, draws, bestScore, lastPlayed, rating? }>}
 */
export async function getUserGameStats(_userId, gameId) {
  const s = await loadArcadeStats()
  const g = s.games[gameId] || { played: 0, wins: 0, losses: 0, draws: 0, bestScore: null, lastPlayed: null }
  return gameId === 'chess' ? { ...g, rating: s.chess.rating } : { ...g }
}
