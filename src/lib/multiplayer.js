// Real-time multiplayer for the arcade, built only on Supabase Realtime
// (presence + broadcast) so it needs no database tables.
//
// - A room is one Realtime channel: `arcade:<gameId>:<CODE>`.
//   Presence (keyed by user id) is the roster; the host is the earliest joiner,
//   so if the host drops, the next-earliest player takes over automatically.
//   The host also keeps the room's settings + phase in its presence meta, so
//   late joiners learn them on their first sync.
// - Broadcast carries everything else as one event ('msg') of shape
//   { type, from, to?, data, ts }: game state (host -> all, sequenced),
//   actions (player -> host), positions (player -> all) and chat.
// - Open lobbies advertise themselves on a shared discovery channel
//   (`arcade:lobbies`) with a coarse (~1 km) location, so nearby players can
//   find them; joining by 5-character code always works.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { apiJson } from './api'
import { recordGameResult } from './arcadeStats'

// ---------------------------------------------------------------------------
// Game catalogue (multiplayer games only)
// ---------------------------------------------------------------------------

export const LASER_MODES = {
  ffa: { id: 'ffa', name: 'Free-for-all', short: 'FFA', blurb: 'Everyone for themselves. Most points when time runs out wins.' },
  tdm: { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', blurb: 'Red vs Blue. The team with the most tag-outs when time runs out wins.' },
  snd: { id: 'snd', name: 'Search & Destroy', short: 'S&D', blurb: 'Attackers plant a bomb at a site, defenders stop them. No respawns. Sides swap at half time.' },
}

export const TEAMS = {
  A: { id: 'A', name: 'Red', color: '#b3123f' },
  B: { id: 'B', name: 'Blue', color: '#6c1fc9' },
}

const SAFETY = 'Play outside in an open area away from traffic, and watch where you are going.'

export const MP_GAMES = {
  lasertag: {
    id: 'lasertag',
    codePrefix: 'L',
    name: 'Laser Tag',
    icon: '🎯',
    minPlayers: 2,
    maxPlayers: 10,
    usesLocation: true,
    usesCamera: true,
    blurb: 'Real-world laser tag. Raise your phone and shoot — your camera sees who is under the crosshair, and GPS works out which player it is.',
    settings: {
      mode: { label: 'Mode', options: ['ffa', 'tdm', 'snd'], labels: { ffa: 'Free-for-all', tdm: 'Team Deathmatch', snd: 'Search & Destroy' }, default: 'ffa' },
      visibility: { label: 'Lobby', options: ['public', 'private'], labels: { public: 'Public', private: 'Private (code only)' }, default: 'public' },
      roundMinutes: { label: 'Match length', options: [5, 10, 15], default: 10, unit: 'min', when: (s) => s.mode !== 'snd' },
      sndRounds: { label: 'Rounds (best of)', options: [3, 5, 7], default: 5, when: (s) => s.mode === 'snd' },
      sndRoundMinutes: { label: 'Round time', options: [2, 3, 4], default: 3, unit: 'min', when: (s) => s.mode === 'snd' },
    },
  },
  'spider-spider': {
    id: 'spider-spider',
    codePrefix: 'S',
    name: 'Spider Spider 123',
    icon: '🕷️',
    minPlayers: 2,
    maxPlayers: 12,
    usesLocation: true,
    blurb: 'Real-world tag. One player starts as the spider; stay within about 10 m of someone for 3 seconds to tag them and turn them into a spider too. Last one free wins.',
    settings: { roundMinutes: { label: 'Round timer', options: [0, 3, 5, 10], labels: { 0: 'Off', 3: '3 min', 5: '5 min', 10: '10 min' }, default: 0 } },
  },
  'beside-them': {
    id: 'beside-them',
    codePrefix: 'B',
    name: 'Beside Them',
    icon: '🎭',
    minPlayers: 4,
    maxPlayers: 10,
    usesLocation: true,
    usesCamera: true,
    blurb: 'Social deduction in the real world. Crew walk to real task stations you scanned around you; a secret imposter eliminates people up close.',
    settings: {
      stationMode: { label: 'Who scans stations', options: ['host', 'all'], labels: { host: 'Host only', all: 'Everyone' }, default: 'host' },
      tasksPerPlayer: { label: 'Tasks per player', options: [3, 4, 5], default: 4 },
      killCooldown: { label: 'Elimination cooldown', options: [20, 30, 45], default: 30, unit: 's' },
      discussSeconds: { label: 'Discussion time', options: [30, 60, 90], default: 60, unit: 's' },
    },
  },
  royale: {
    id: 'royale',
    codePrefix: 'R',
    name: 'Battle Royale',
    icon: '🪂',
    minPlayers: 2,
    maxPlayers: 100,
    usesLocation: true,
    usesCamera: true,
    blurb: 'Real-world battle royale for up to 100 players. One life, a shrinking gas zone on the real map, loot dropped by the fallen. Last one standing wins.',
    settings: {
      visibility: { label: 'Lobby', options: ['public', 'private'], labels: { public: 'Public', private: 'Private (code only)' }, default: 'public' },
      areaId: { label: 'Starting area', options: ['1mi', '2mi', '3mi', '5mi'], labels: { '1mi': '1 mi', '2mi': '2 mi', '3mi': '3 mi', '5mi': '5 mi' }, default: '1mi' },
      pace: { label: 'Gas pace', options: ['fast', 'normal', 'long'], labels: { fast: 'Fast', normal: 'Normal', long: 'Long' }, default: 'normal' },
    },
  },
  chess: {
    id: 'chess',
    codePrefix: 'C',
    name: 'Chess',
    icon: '♟️',
    minPlayers: 2,
    maxPlayers: 2,
    usesLocation: false,
    blurb: 'Online chess against someone you follow, a follower or a player nearby. Every move syncs live and is checked by the rules engine.',
    settings: {
      hostColor: { label: 'Host plays', options: ['random', 'w', 'b'], labels: { random: 'Random', w: 'White', b: 'Black' }, default: 'random' },
    },
  },
  mafia: {
    id: 'mafia',
    codePrefix: 'M',
    name: 'Mafia',
    icon: '🔪',
    minPlayers: 5,
    maxPlayers: 15,
    usesLocation: false,
    blurb: 'Classic social deduction. The Town sleeps while the Mafia secretly eliminates someone each night. By day, discuss and vote — find the Mafia before they outnumber you.',
    settings: {
      nightSeconds: { label: 'Night length', options: [20, 30, 45], default: 30, unit: 's' },
      discussSeconds: { label: 'Discussion time', options: [30, 60, 90], default: 60, unit: 's' },
      voteSeconds: { label: 'Voting time', options: [20, 30, 45], default: 30, unit: 's' },
    },
  },
  'heads-up': {
    id: 'heads-up',
    codePrefix: 'H',
    name: 'Heads Up 7 Up',
    icon: '👆',
    minPlayers: 8,
    maxPlayers: 30,
    usesLocation: false,
    blurb: 'The classic classroom game. 7 pickers secretly tap a sitter each; then everyone guesses who tapped them. Correct guessers swap into the picker role.',
    settings: {
      pickSeconds: { label: 'Picking time', options: [20, 30, 45], default: 30, unit: 's' },
      guessSeconds: { label: 'Guessing time', options: [15, 20, 30], default: 20, unit: 's' },
    },
  },
}

// Laser Tag play-area presets (radius in metres) the host picks on the map.
export const AREA_PRESETS = {
  '150ft': { id: '150ft', label: '150 ft', r: 45.72 },
  '5mi': { id: '5mi', label: '5 miles', r: 8046.72 },
  city: { id: 'city', label: 'City', r: 16000 },
  state: { id: 'state', label: 'State', r: 250000 },
}

// Battle Royale starting areas (radius in metres around the centre the host picks).
export const ROYALE_AREAS = {
  '1mi': { id: '1mi', label: '1 mi', r: 1609.34 },
  '2mi': { id: '2mi', label: '2 mi', r: 3218.69 },
  '3mi': { id: '3mi', label: '3 mi', r: 4828.03 },
  '5mi': { id: '5mi', label: '5 mi', r: 8046.72 },
}

// The always-on public Laser Tag arena: an endless Free-for-all anyone can drop into.
// It is sharded so one channel never gets too crowded (positions are broadcast to
// everyone in the room about once a second).
export const ARENA_CODES = ['LWRLD', 'LWRL2', 'LWRL3', 'LWRL4', 'LWRL5', 'LWRL6']
export const ARENA_CAP = 24
export const isArenaCode = (code) => ARENA_CODES.includes(code)

// "How to play" content for a game (and its current mode).
export function howToPlay(gameId, settings = {}) {
  if (gameId === 'lasertag') {
    const mode = LASER_MODES[settings?.mode] ? settings.mode : 'ffa'
    const aim = [
      'Portrait (phone upright) = Trigger mode: raise your phone like a camera and put the crosshair on a player. The whole screen is the trigger — tap for one shot, hold to keep firing at your gun’s rate. Your phone checks what is actually under the crosshair; other players can keep their phones in their pockets.',
      'Head shots do double damage (about 50), body shots about 25, arms and legs about 15. Your gun changes these. Damage drops off past 20 m and camera aim reaches about 30 m.',
      'Landscape or flat = Top-edge mode: point the top of the phone at a player and tap anywhere to fire. It uses GPS and the compass only, so it is less precise.',
      'The mode switches automatically as you rotate the phone (shown at the top of the screen). You can force one — or the classic crosshair with a FIRE button — in the menu ☰. On phones without on-device detection, aiming uses the compass.',
    ]
    const byMode = {
      ffa: ['Every hit scores 10 points (+10 for a headshot) and a tag-out scores 100.', 'Tagged-out players are back in after 8 seconds, with 2 seconds of spawn protection.', 'Most points when time runs out wins.'],
      tdm: ['You are on Red or Blue. You can’t hit your own team.', 'Tagged-out players are back in after 8 seconds, with 2 seconds of spawn protection.', 'The team with the most tag-outs when time runs out wins.'],
      snd: [
        'Attackers: one of you carries the bomb. Inside a bomb site, tap PLANT BOMB and hit 6 targets within 5 seconds. Miss and you can retry.',
        'If the carrier is tagged out, the bomb drops where they were. A teammate can walk over and pick it up.',
        'Once planted, everyone is alerted and a 45-second countdown starts. Defenders go to the bomb, tap DEFUSE and hit 7 targets within 7 seconds.',
        'No respawns: tagged-out players sit out the rest of the round.',
        'A round ends when the bomb explodes or is defused, a team is wiped out, or time runs out (defenders win if nothing was planted).',
        'Sides swap at half time. First team to win the majority of rounds wins the match.',
      ],
    }
    if (settings?.endless) {
      return {
        title: 'Laser Tag · Public Arena',
        steps: [SAFETY, 'An endless Free-for-all. Players join and leave at any time — there is no setup and no final whistle.', ...aim, ...byMode.ffa.slice(0, 2), 'Your score is kept while you are in the arena. Leave whenever you like; points are added to your arcade balance.'],
      }
    }
    return { title: `Laser Tag · ${LASER_MODES[mode]?.name || ''}`, steps: [SAFETY, ...aim, ...byMode[mode]] }
  }
  if (gameId === 'royale') {
    return {
      title: 'Battle Royale',
      steps: [
        SAFETY,
        'Never play while driving. Above about 15 mph you go “In transit”: you can’t fire and can’t be hit until you’ve slowed to walking pace for a few seconds. The gas still hurts you.',
        'Everyone starts with the free Starter Pistol and Street SMG and one life. Aim and fire exactly like Laser Tag: raise your phone and put the crosshair on a player.',
        'The safe zone shrinks in phases on the real map. The next circle is shown (dashed) before the gas moves. Outside the zone you lose health every second — more in later phases.',
        'Weapon caches are scattered around the area and every eliminated player drops their weapon. Walk within about 30 ft of one and tap Pick up. Only go where it’s safe and legal to walk.',
        'When you’re eliminated you can spectate the players who are left, or leave.',
        'Last player standing wins. Results show your placement, kills and how long you survived.',
      ],
    }
  }
  if (gameId === 'chess') {
    return {
      title: 'Online Chess',
      steps: [
        'The host picks who plays White (or leaves it random). White moves first.',
        'Tap a piece to see its legal moves, then tap a highlighted square. Every move is checked by the rules engine on both phones.',
        'Checkmate, stalemate, threefold repetition, the 50-move rule and insufficient material all end the game automatically.',
        'You can offer a draw or resign at any time.',
        'If your opponent loses connection, the game waits about a minute for them to come back before you win by abandonment.',
        'After the game, tap Rematch — colours swap when you both accept.',
      ],
    }
  }
  if (gameId === 'spider-spider') {
    return {
      title: 'Spider Spider 123',
      steps: [
        SAFETY,
        'One random player starts as the spider. Everyone else is free.',
        'Spiders wait out a 15 second head start, then hunt.',
        'To tag, a spider gets within about 10 m (33 ft), presses Tag next to your name, and has to stay that close for 3 seconds. Both phones show the ring filling up.',
        'If you’re being tagged, run! Getting out of range breaks the tag.',
        'Tagged players become spiders too.',
        'Last one free wins. If the host turned on a round timer and it runs out, every free player wins.',
      ],
    }
  }
  if (gameId === 'mafia') {
    return {
      title: 'Mafia',
      steps: [
        'Everyone gets a secret role: Townsperson, Mafia, Doctor or Detective. Don't reveal it!',
        'Night: the Mafia secretly picks someone to eliminate. The Doctor chooses someone to protect. The Detective investigates one player to learn if they're Mafia.',
        'Day: if someone was eliminated, it's announced. Discuss who you suspect — then vote.',
        'The player with the most votes is eliminated and their role is revealed.',
        'Town wins when all Mafia are eliminated. Mafia wins when they equal or outnumber the Town.',
        '5–6 players: 1 Mafia. 7–9 players: 2 Mafia + Doctor + Detective. 10+: 3 Mafia.',
      ],
    }
  }
  if (gameId === 'heads-up') {
    return {
      title: 'Heads Up 7 Up',
      steps: [
        '7 players are chosen as pickers. Everyone else is a sitter.',
        'Sitters close their eyes (put your phone face-down). Each picker secretly taps one sitter.',
        'Once all pickers have chosen, it's "heads up!" — every tapped sitter tries to guess which picker tapped them.',
        'Correct guesses swap you into the picker role next round. Wrong guesses keep you sitting.',
        'Scores are tracked across rounds — the player with the most correct guesses leads the board.',
        'Play as many rounds as you like. The host starts each new round.',
      ],
    }
  }
  return {
    title: 'Beside Them',
    steps: [
      SAFETY,
      'Before the game, task stations are made by scanning real objects inside the play area — a bench, a door, a sign.',
      'Everyone gets a secret role. One player is the imposter; everyone else is crew.',
      'Crew: walk to your assigned stations, scan the object (match the reference photo), then solve the puzzle.',
      'The imposter can eliminate crew within about 10 m (with a cooldown) and can sabotage comms. Imposter tasks are fake.',
      'Found a body? Report it when you are close. Or use your one emergency meeting.',
      'Meetings have a discussion period, then a vote. More than half the living players must agree to eject someone.',
      'Crew win by finishing every task or ejecting the imposter. The imposter wins once crew are outnumbered.',
    ],
  }
}

// Other parts of the app (arcade stats) use slightly different ids.
const GAME_ID_ALIASES = { 'laser-tag': 'lasertag', spider: 'spider-spider', 'heads-up-7-up': 'heads-up' }
const STATS_IDS = { lasertag: 'laser-tag', 'spider-spider': 'spider', 'beside-them': 'beside-them', chess: 'chess', royale: 'battle-royale', mafia: 'mafia', 'heads-up': 'heads-up-7-up' }
export const statsIdFor = (gameId) => STATS_IDS[resolveGameId(gameId)] || gameId

export const resolveGameId = (gameId) => GAME_ID_ALIASES[gameId] || gameId
export const isMultiplayerGame = (gameId) => !!MP_GAMES[resolveGameId(gameId)]

// Record this player's result for a finished round once (arcade stats/points).
export function recordRoundResult(room, { result, score }) {
  if (!room) return
  if (!room.recordedRounds) room.recordedRounds = new Set()
  const key = String(room.info.round)
  if (room.recordedRounds.has(key)) return
  room.recordedRounds.add(key)
  Promise.resolve()
    .then(() => recordGameResult(STATS_IDS[room.gameId] || room.gameId, { result, score }))
    .catch((e) => console.warn('recordGameResult failed', e?.message ?? e))
}

export function defaultSettings(gameId) {
  const out = {}
  const s = MP_GAMES[gameId]?.settings || {}
  for (const k of Object.keys(s)) out[k] = s[k].default
  return out
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

let profileCache = null

export async function getMyProfile() {
  const { data } = await supabase.auth.getSession()
  const user = data?.session?.user
  if (!user) throw new Error('Please sign in to play.')
  if (profileCache?.id === user.id) return profileCache
  let username = null
  let avatar = null
  try {
    const p = await apiJson('/api/profiles/me')
    username = p?.username || p?.display_name || p?.name || null
    avatar = p?.avatar_url || null
  } catch {
    // Fall back to auth metadata below.
  }
  if (!username) username = user.user_metadata?.username || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Player'
  profileCache = { id: user.id, username: String(username).slice(0, 32), avatar }
  return profileCache
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const R = 6371000
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Compass bearing from a to b, 0-360 (0 = north).
export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Signed smallest difference a-b in degrees, -180..180.
export function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180
}

// Local east/north offset in metres of b relative to a (fine for < few km).
export function offsetMeters(a, b) {
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2)) * R
  const y = toRad(b.lat - a.lat) * R
  return { x, y }
}

export function compassLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—'
  const ft = m * 3.28084
  if (ft < 1000) return `${Math.round(ft)} ft`
  return `${(m / 1609.34).toFixed(1)} mi`
}

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5

// The first character identifies the game, so a code alone is enough to join.
export function makeCode(gameId) {
  for (;;) {
    let s = MP_GAMES[gameId]?.codePrefix || 'X'
    for (let i = 1; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (!isArenaCode(s)) return s
  }
}

export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
}

export function gameIdFromCode(code) {
  const c = normalizeCode(code)
  return Object.values(MP_GAMES).find((g) => g.codePrefix === c[0])?.id || null
}

export const isValidCode = (c) => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(c) && !!gameIdFromCode(c)

// ---------------------------------------------------------------------------
// Tiny emitter
// ---------------------------------------------------------------------------

class Emitter {
  constructor() { this._l = new Map() }
  on(evt, fn) {
    if (!this._l.has(evt)) this._l.set(evt, new Set())
    this._l.get(evt).add(fn)
    return () => this._l.get(evt)?.delete(fn)
  }
  emit(evt, ...args) {
    const set = this._l.get(evt)
    if (!set) return
    for (const fn of [...set]) {
      try { fn(...args) } catch (e) { console.warn(`multiplayer listener ${evt} failed`, e?.message ?? e) }
    }
  }
}

// ---------------------------------------------------------------------------
// Discovery channel (shared, ref-counted)
// ---------------------------------------------------------------------------

const DISCOVERY_TOPIC = 'arcade:lobbies'
export const NEARBY_RADIUS_M = 8000 // ~5 miles

const discovery = {
  channel: null,
  refs: 0,
  ready: false,
  status: 'idle', // idle | connecting | connected | error
  rooms: [],
  advert: null,
  emitter: new Emitter(),
  retryTimer: null,
  userId: null,
}

function discoverySnapshot() {
  return { rooms: discovery.rooms, status: discovery.status }
}

function readDiscoveryRooms() {
  if (!discovery.channel) return
  const state = discovery.channel.presenceState() || {}
  const rooms = []
  for (const key of Object.keys(state)) {
    const meta = state[key]?.[0]
    // Presence comes from other devices: coerce everything that gets rendered.
    if (meta?.code && meta?.gameId && typeof meta.code === 'string' && typeof meta.gameId === 'string') {
      rooms.push({
        ...meta,
        hostId: key,
        hostName: String(meta.hostName ?? 'Player').slice(0, 32),
        mode: typeof meta.mode === 'string' ? meta.mode : null,
        areaLabel: typeof meta.areaLabel === 'string' ? meta.areaLabel : null,
        players: Math.max(0, Number(meta.players) || 0),
        maxPlayers: Math.max(0, Number(meta.maxPlayers) || 0),
        lat: typeof meta.lat === 'number' ? meta.lat : null,
        lng: typeof meta.lng === 'number' ? meta.lng : null,
      })
    }
  }
  rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  discovery.rooms = rooms
  discovery.emitter.emit('change', discoverySnapshot())
}

async function openDiscovery() {
  if (discovery.channel || discovery.opening) return
  discovery.opening = true
  try {
    await openDiscoveryInner()
  } catch (e) {
    // e.g. supabase.channel() handed back a stale channel that can't be re-subscribed.
    console.warn('discovery open failed', e?.message ?? e)
    const ch = discovery.channel
    discovery.channel = null
    discovery.ready = false
    discovery.status = 'error'
    discovery.emitter.emit('change', discoverySnapshot())
    if (ch) supabase.removeChannel(ch).catch(() => {})
    clearTimeout(discovery.retryTimer)
    discovery.retryTimer = setTimeout(() => { if (discovery.refs > 0) reopenDiscovery() }, 4000)
  } finally {
    discovery.opening = false
  }
}

async function openDiscoveryInner() {
  discovery.status = 'connecting'
  discovery.emitter.emit('change', discoverySnapshot())
  let me
  try {
    me = await getMyProfile()
  } catch {
    discovery.status = 'error'
    discovery.emitter.emit('change', discoverySnapshot())
    return
  }
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${DISCOVERY_TOPIC}`)
  if (stale) {
    try { await supabase.removeChannel(stale) } catch { /* ignore */ }
  }
  if (discovery.refs <= 0 || discovery.channel) return
  discovery.userId = me.id
  const ch = supabase.channel(DISCOVERY_TOPIC, { config: { presence: { key: me.id } } })
  discovery.channel = ch
  ch.on('presence', { event: 'sync' }, () => { if (discovery.channel === ch) readDiscoveryRooms() })
  ch.subscribe((status) => {
    if (discovery.channel !== ch) return
    if (status === 'SUBSCRIBED') {
      discovery.ready = true
      discovery.status = 'connected'
      if (discovery.advert) ch.track(discovery.advert).catch(() => {})
      readDiscoveryRooms()
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      discovery.ready = false
      discovery.status = status === 'CLOSED' ? 'connecting' : 'error'
      discovery.emitter.emit('change', discoverySnapshot())
      clearTimeout(discovery.retryTimer)
      discovery.retryTimer = setTimeout(() => { if (discovery.refs > 0) reopenDiscovery() }, 4000)
    }
  })
}

async function closeDiscovery() {
  clearTimeout(discovery.retryTimer)
  const ch = discovery.channel
  discovery.channel = null
  discovery.ready = false
  discovery.status = 'idle'
  discovery.rooms = []
  if (ch) {
    try { await supabase.removeChannel(ch) } catch { /* already gone */ }
  }
}

async function reopenDiscovery() {
  await closeDiscovery()
  if (discovery.refs > 0) openDiscovery()
}

function retainDiscovery() {
  discovery.refs += 1
  if (discovery.refs === 1) openDiscovery()
}

function releaseDiscovery() {
  discovery.refs = Math.max(0, discovery.refs - 1)
  if (discovery.refs === 0) closeDiscovery()
}

export function subscribeDiscovery(listener) {
  retainDiscovery()
  const off = discovery.emitter.on('change', listener)
  listener(discoverySnapshot())
  return () => {
    off()
    releaseDiscovery()
  }
}

export function refreshDiscovery() {
  if (discovery.refs > 0) reopenDiscovery()
}

function setAdvert(meta) {
  if (meta && discovery.advert && JSON.stringify(meta) === JSON.stringify(discovery.advert)) return
  const had = !!discovery.advert
  discovery.advert = meta
  if (meta && !had) retainDiscovery()
  if (!meta && had) {
    if (discovery.ready && discovery.channel) discovery.channel.untrack().catch(() => {})
    releaseDiscovery()
    return
  }
  if (meta && discovery.ready && discovery.channel) discovery.channel.track(meta).catch(() => {})
}

// Rounded to 2 decimals (~1 km) so we never publish anyone's exact location.
export const coarse = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : null)

// Shared hook for screens that list open rooms near the user.
export function useNearbyRooms(gameId = null) {
  return useDiscoveredRooms(gameId, { maxDistance: NEARBY_RADIUS_M, publicOnly: false })
}

// Public lobbies for one game anywhere (nearest first when location is available).
export function usePublicLobbies(gameId) {
  return useDiscoveredRooms(gameId, { maxDistance: Infinity, publicOnly: true })
}

// Live player counts per multiplayer game from everything advertised on the discovery
// channel (open lobbies + the public arena). Only connects while `enabled`.
export function useLiveCounts(enabled = true) {
  const [snap, setSnap] = useState(discoverySnapshot)
  useEffect(() => (enabled ? subscribeDiscovery(setSnap) : undefined), [enabled])
  const counts = {}
  for (const r of snap.rooms || []) {
    if (!r?.gameId || !MP_GAMES[r.gameId]) continue
    counts[r.gameId] = (counts[r.gameId] || 0) + Math.max(0, Number(r.players) || 0)
  }
  return counts
}

function useDiscoveredRooms(gameId, { maxDistance, publicOnly }) {
  const [snap, setSnap] = useState(discoverySnapshot)
  const [loc, setLoc] = useState({ status: 'pending', coords: null })

  useEffect(() => subscribeDiscovery(setSnap), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted') {
          if (!cancelled) setLoc({ status: 'denied', coords: null })
          return
        }
        const last = await Location.getLastKnownPositionAsync().catch(() => null)
        if (last && !cancelled) setLoc({ status: 'granted', coords: { lat: last.coords.latitude, lng: last.coords.longitude } })
        const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (!cancelled) setLoc({ status: 'granted', coords: { lat: cur.coords.latitude, lng: cur.coords.longitude } })
      } catch {
        if (!cancelled) setLoc((l) => (l.coords ? l : { status: 'error', coords: null }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const rooms = snap.rooms
    .filter((r) => r.hostId !== discovery.userId)
    .filter((r) => (gameId ? r.gameId === gameId : !!MP_GAMES[r.gameId]))
    .filter((r) => r.phase === 'lobby' && !r.arena && r.players < r.maxPlayers)
    .filter((r) => !publicOnly || r.visibility === 'public')
    .map((r) => ({
      ...r,
      distance: loc.coords && r.lat != null && r.lng != null ? distanceMeters(loc.coords, { lat: r.lat, lng: r.lng }) : Infinity,
    }))
    .filter((r) => r.distance <= maxDistance)
    .sort((a, b) => (a.distance - b.distance) || ((b.createdAt || 0) - (a.createdAt || 0)))

  return { rooms, status: snap.status, locationStatus: loc.status, refresh: refreshDiscovery }
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

const MAX_CHAT = 100
const POSITION_STALE_MS = 15000

export class Room {
  constructor({ gameId, code, me, mode }) {
    this.gameId = gameId
    this.code = code
    this.me = me
    this.mode = mode // 'host' | 'join' | 'public' (the always-on arena: whoever is first hosts)
    this.joinedAt = Date.now()
    this.emitter = new Emitter()
    this.channel = null
    this.left = false
    this.status = 'connecting' // connecting | connected | reconnecting | error | closed
    this.error = null
    this.errorCode = null
    this.roster = []
    this.hostId = null
    this.info = mode === 'public'
      ? { phase: 'playing', arena: true, settings: { ...defaultSettings(gameId), mode: 'ffa', endless: true, visibility: 'public' }, round: 1, startedAt: Date.now() }
      : { phase: 'lobby', settings: defaultSettings(gameId), round: 0 }
    this.infoVersion = 0
    this.state = null
    this.stateSeq = 0
    this.clockOffset = 0
    this.chat = []
    this.positions = {}
    this.advertLocation = null
    this.everSynced = false
    this.everSyncedWithOthers = false
    this.lastStateFrom = null
    this.lastSeen = {}
    this.assets = {}
    this.assetOwners = new Set()
    this._assetReqAt = {}
    this.joinCheckTimer = null
    this.reconnectTimer = null
    this.failures = 0
    this.handedOff = false
    this._snap = null
    this._posSnap = this.positions
    this._appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !this.left && this.status !== 'connected' && this.status !== 'error') this._rebuild(0)
    })
    this._safeOpen()
  }

  _safeOpen() {
    this._open().catch((e) => {
      console.warn('arcade channel open failed', e?.message ?? e)
      this.failures += 1
      this._setStatus('reconnecting')
      this._rebuild(3000)
    })
  }

  // ---- connection ----------------------------------------------------------

  async _open() {
    if (this.left) return
    const topic = `arcade:${this.gameId}:${this.code}`
    // supabase.channel() reuses a channel with the same topic, so make sure a
    // previous one (from a quick leave + rejoin) is fully removed first.
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
    if (stale) {
      try { await supabase.removeChannel(stale) } catch { /* ignore */ }
    }
    if (this.left || this.channel) return
    const ch = supabase.channel(topic, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } },
    })
    this.channel = ch
    ch.on('presence', { event: 'sync' }, () => { if (this.channel === ch) this._syncRoster() })
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => { if (this.channel === ch) this._onMsg(payload) })
    ch.subscribe((status, err) => {
      if (this.channel !== ch || this.left) return
      if (status === 'SUBSCRIBED') {
        // After a real drop, rejoin at the back of the line so whoever stayed
        // connected (and has the freshest game state) keeps the host role.
        if (this.failures > 0 && this.everSyncedWithOthers) this.joinedAt = Date.now()
        this.failures = 0
        this._setStatus('connected')
        this._track()
        if (this.mode === 'join' && !this.everSynced) {
          clearTimeout(this.joinCheckTimer)
          this.joinCheckTimer = setTimeout(() => this._checkJoined(), 6000)
        }
        // Ask the host for the latest game state after any (re)connect.
        if (this.hostId && this.hostId !== this.me.id) this.send('state_req', {})
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.warn('arcade channel', status, err?.message ?? err)
        this.failures += 1
        this._setStatus('reconnecting')
        this._rebuild(Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4)))
      }
    })
  }

  _rebuild(delay) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(async () => {
      if (this.left) return
      const old = this.channel
      this.channel = null
      if (old) {
        try { await supabase.removeChannel(old) } catch { /* ignore */ }
      }
      if (!this.left) this._safeOpen()
    }, delay)
  }

  _checkJoined() {
    if (this.left || this.everSyncedWithOthers) return
    this.fail('No open game with that code. Check the code and try again.')
  }

  fail(message, code = null) {
    this.error = message
    this.errorCode = code
    this._setStatus('error')
    this._teardown()
  }

  _setStatus(s) {
    if (this.status === s) return
    this.status = s
    this._changed()
  }

  _presenceMeta() {
    const meta = { username: this.me.username, avatar: this.me.avatar, joinedAt: this.joinedAt }
    if (this.isHost()) meta.room = { ...this.info, v: this.infoVersion }
    return meta
  }

  _track() {
    if (!this.channel || this.status !== 'connected') return
    this.channel.track(this._presenceMeta()).catch((e) => console.warn('presence track failed', e?.message ?? e))
  }

  // ---- roster / host ------------------------------------------------------

  _syncRoster() {
    const state = this.channel?.presenceState() || {}
    const roster = []
    const metas = {}
    for (const id of Object.keys(state)) {
      const meta = state[id]?.[0]
      if (!meta) continue
      metas[id] = meta
      roster.push({ id, username: meta.username || 'Player', avatar: meta.avatar || null, joinedAt: meta.joinedAt || 0 })
    }
    const others = roster.filter((p) => p.id !== this.me.id)
    if (others.length) {
      // Joining: make sure we sort after everyone already here, even if our
      // clock is behind theirs, so we never steal the host role on join.
      if (!this.everSyncedWithOthers && (this.mode === 'join' || this.mode === 'public')) {
        const maxOther = Math.max(...others.map((p) => p.joinedAt || 0))
        if (this.joinedAt <= maxOther) {
          this.joinedAt = maxOther + 1
          const mine = roster.find((p) => p.id === this.me.id)
          if (mine) mine.joinedAt = this.joinedAt
          this._track()
        }
      }
      this.everSyncedWithOthers = true
      clearTimeout(this.joinCheckTimer)
    }
    this.everSynced = true
    roster.sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))
    const prevHost = this.hostId
    this.roster = roster
    const seenAt = Date.now()
    for (const p of roster) this.lastSeen[p.id] = seenAt
    // A joiner never counts itself as host before it has seen the room's members.
    const eligible = this.mode === 'join' && !this.everSyncedWithOthers ? others : roster
    this.hostId = eligible[0]?.id || null

    // Adopt the host's room info (phase/settings) unless we are the host.
    const host = this.hostId
    const hostRoom = host ? metas[host]?.room : null
    if (host !== this.me.id && hostRoom) {
      const { v, ...info } = hostRoom
      if ((v ?? 0) !== this.infoVersion || JSON.stringify(info) !== JSON.stringify(this.info)) {
        this.info = info
        this.infoVersion = v ?? 0
      }
    }

    // Room full check (only for players who joined after it filled).
    const max = MP_GAMES[this.gameId]?.maxPlayers ?? 8
    const idx = roster.findIndex((p) => p.id === this.me.id)
    if (this.mode === 'public') {
      if (idx >= ARENA_CAP) {
        this.fail('This arena is full.', 'full')
        return
      }
    } else if (idx >= max && this.info.phase === 'lobby') {
      this.fail('That game is full.', 'full')
      return
    }

    if (prevHost !== this.hostId) {
      if (this.isHost()) {
        // Host migration (or first sync): publish room info with our presence.
        this.infoVersion += 1
        this._track()
      }
      this.emitter.emit('host', this.hostId, prevHost)
    }
    // Drop positions of people who left.
    const ids = new Set(roster.map((p) => p.id))
    if (Object.keys(this.positions).some((id) => !ids.has(id))) {
      const kept = {}
      for (const id of Object.keys(this.positions)) if (ids.has(id)) kept[id] = this.positions[id]
      this.positions = kept
      this._positionsChanged()
    }
    // Followers without game state (late join / reconnect) ask the host for it.
    if (this.hostId && !this.isHost() && this.status === 'connected' && (!this.state || prevHost !== this.hostId)) {
      const now = Date.now()
      if (!this._lastStateReq || now - this._lastStateReq > 2000) {
        this._lastStateReq = now
        this.send('state_req', {})
      }
    }
    this._updateAdvert()
    this._changed()
  }

  // Players in the room now, or seen within the grace period (so a brief
  // connection blip doesn't count as leaving the game).
  presentIds(graceMs = 20000) {
    const t = Date.now()
    const ids = new Set(this.roster.map((p) => p.id))
    for (const id of Object.keys(this.lastSeen)) if (t - this.lastSeen[id] < graceMs) ids.add(id)
    return ids
  }

  isHost() {
    return !!this.hostId && this.hostId === this.me.id
  }

  // Host only: change phase/settings; propagated via host presence meta.
  setInfo(patch) {
    if (!this.isHost()) return
    this.info = { ...this.info, ...patch }
    this.infoVersion += 1
    this._track()
    this._updateAdvert()
    this._changed()
  }

  setAdvertLocation(coords) {
    this.advertLocation = coords ? { lat: coarse(coords.lat), lng: coarse(coords.lng) } : null
    this._updateAdvert()
  }

  _updateAdvert() {
    if (this.left) return
    const visibility = this.info.settings?.visibility || null
    if (this.isHost() && this.info.arena && this.status !== 'error') {
      // The arena advertises only a live player count (no location, it's worldwide).
      setAdvert({
        gameId: this.gameId,
        code: this.code,
        arena: true,
        hostName: 'Public Arena',
        players: this.roster.length || 1,
        maxPlayers: ARENA_CAP,
        phase: 'playing',
        createdAt: this.joinedAt,
      })
    } else if (this.isHost() && this.info.phase === 'lobby' && this.status !== 'error' && visibility !== 'private') {
      const g = MP_GAMES[this.gameId]
      const area = this.info.settings?.area
      setAdvert({
        gameId: this.gameId,
        code: this.code,
        hostName: this.me.username,
        mode: this.gameId === 'lasertag' ? this.info.settings?.mode || 'ffa' : null,
        visibility,
        areaLabel: area?.preset ? AREA_PRESETS[area.preset]?.label || ROYALE_AREAS[area.preset]?.label || null : null,
        players: this.roster.length || 1,
        maxPlayers: g?.maxPlayers ?? 8,
        phase: 'lobby',
        lat: this.advertLocation?.lat ?? null,
        lng: this.advertLocation?.lng ?? null,
        createdAt: this.joinedAt,
      })
    } else if (discovery.advert?.code === this.code) {
      setAdvert(null)
    }
  }

  // ---- messaging ----------------------------------------------------------

  send(type, data, { to } = {}) {
    if (!this.channel || this.left) return
    const msg = { type, from: this.me.id, to: to || null, data, ts: Date.now() }
    if (this.status !== 'connected') return
    this.channel.send({ type: 'broadcast', event: 'msg', payload: msg }).catch(() => {})
  }

  _onMsg(msg) {
    if (!msg || typeof msg !== 'object' || !msg.type) return
    if (msg.to && msg.to !== this.me.id) return
    const fromIsHost = msg.from === this.hostId
    switch (msg.type) {
      case 'state':
        if (!fromIsHost) return
        this._applyState(msg.data, msg.from)
        return
      case 'state_req':
        if (this.isHost() && this.state) this.send('state', this._stateEnvelope(), { to: msg.from })
        this.emitter.emit('state_req', msg.from)
        return
      case 'action':
        if (this.isHost()) this.emitter.emit('action', msg.data, msg.from)
        return
      case 'pos':
        this._setPosition(msg.from, msg.data)
        return
      case 'req':
        if (this.isHost()) this.emitter.emit('request', msg.data?.kind, msg.data?.data, msg.from)
        return
      case 'asset':
        if (msg.data?.id && typeof msg.data.data === 'string' && !this.assets[msg.data.id]) {
          this.assets = { ...this.assets, [msg.data.id]: msg.data.data }
          this._changed()
        }
        return
      case 'asset_req': {
        const id = msg.data?.id
        if (id && this.assets[id] && (this.isHost() || this.assetOwners.has(id))) this.send('asset', { id, data: this.assets[id] }, { to: msg.from })
        return
      }
      case 'chat':
        this._addChat({ id: msg.data?.id || `${msg.from}-${msg.ts}`, from: msg.from, text: String(msg.data?.text || '').slice(0, 300), ts: Date.now() })
        return
      default:
        this.emitter.emit('msg', msg)
        this.emitter.emit(`msg:${msg.type}`, msg.data, msg.from)
    }
  }

  // ---- game state (host authoritative) ------------------------------------

  now() {
    return Date.now() + (this.isHost() ? 0 : this.clockOffset)
  }

  _stateEnvelope() {
    return { seq: this.stateSeq, hostNow: Date.now(), state: this.state }
  }

  _applyState(env, from) {
    if (!env || typeof env.seq !== 'number') return
    // Ignore reordered/stale messages from the same host; a different
    // (migrated) host's state always wins since only the host is accepted.
    if (from === this.lastStateFrom && env.seq <= this.stateSeq) return
    this.lastStateFrom = from
    this.stateSeq = env.seq
    this.state = env.state
    if (typeof env.hostNow === 'number') this.clockOffset = env.hostNow - Date.now()
    this.emitter.emit('state', this.state)
    this._changed()
  }

  // Host: replace the authoritative state and broadcast it.
  publishState(next) {
    if (!this.isHost()) return
    this.stateSeq += 1
    this.lastStateFrom = this.me.id
    this.state = next
    this.clockOffset = 0
    this.send('state', this._stateEnvelope())
    this.emitter.emit('state', this.state)
    this._changed()
  }

  getState() {
    return this.state
  }

  requestState() {
    this.send('state_req', {})
  }

  // Players send actions to the host; the host handles its own locally.
  sendAction(action) {
    if (this.isHost()) {
      this.emitter.emit('action', action, this.me.id)
    } else {
      this.send('action', action)
    }
  }

  onAction(fn) { return this.emitter.on('action', fn) }
  onMessage(type, fn) { return this.emitter.on(`msg:${type}`, fn) }
  onHostChange(fn) { return this.emitter.on('host', fn) }
  onStateRequest(fn) { return this.emitter.on('state_req', fn) }

  // ---- lobby requests (player -> host, outside of game state) -------------

  request(kind, data) {
    if (this.isHost()) this.emitter.emit('request', kind, data, this.me.id)
    else this.send('req', { kind, data })
  }

  onRequest(fn) { return this.emitter.on('request', fn) }

  // ---- small shared blobs (e.g. station photo thumbnails) -----------------

  putAsset(id, data, { broadcast = true, owner = false } = {}) {
    if (!id || typeof data !== 'string') return
    if (owner) this.assetOwners.add(id)
    this.assets = { ...this.assets, [id]: data }
    this._changed()
    if (broadcast) this.send('asset', { id, data })
  }

  requestAsset(id) {
    if (!id || this.assets[id]) return
    const t = Date.now()
    if (t - (this._assetReqAt[id] || 0) < 5000) return
    this._assetReqAt[id] = t
    this.send('asset_req', { id })
  }

  // ---- positions ----------------------------------------------------------

  sendPosition(p) {
    if (!p) return
    const data = { lat: p.lat, lng: p.lng, acc: p.acc ?? null }
    this._setPosition(this.me.id, data)
    this.send('pos', data)
  }

  _setPosition(id, data) {
    if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') return
    this.positions = { ...this.positions, [id]: { lat: data.lat, lng: data.lng, acc: data.acc ?? null, at: Date.now() } }
    this._positionsChanged()
  }

  _positionsChanged() {
    this._posSnap = this.positions
    this.emitter.emit('positions', this.positions)
  }

  freshPosition(id) {
    const p = this.positions[id]
    if (!p || Date.now() - p.at > POSITION_STALE_MS) return null
    return p
  }

  // ---- chat ----------------------------------------------------------------

  sendChat(text) {
    const t = String(text || '').trim().slice(0, 300)
    if (!t) return
    const id = `${this.me.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    this._addChat({ id, from: this.me.id, text: t, ts: Date.now() })
    this.send('chat', { id, text: t })
  }

  _addChat(m) {
    if (!m.text || this.chat.some((c) => c.id === m.id)) return
    this.chat = [...this.chat, m].slice(-MAX_CHAT)
    this.emitter.emit('chat', m)
    this._changed()
  }

  onChat(fn) { return this.emitter.on('chat', fn) }

  // ---- snapshots for React -------------------------------------------------

  _changed() {
    this._snap = null
    this.emitter.emit('change')
  }

  snapshot() {
    if (!this._snap) {
      this._snap = {
        status: this.status,
        error: this.error,
        roster: this.roster,
        hostId: this.hostId,
        isHost: this.isHost(),
        info: this.info,
        chat: this.chat,
        state: this.state,
        assets: this.assets,
        code: this.code,
        gameId: this.gameId,
        me: this.me,
      }
    }
    return this._snap
  }

  subscribe(fn) { return this.emitter.on('change', fn) }

  // ---- teardown ------------------------------------------------------------

  _teardown() {
    clearTimeout(this.joinCheckTimer)
    clearTimeout(this.reconnectTimer)
    if (discovery.advert?.code === this.code) setAdvert(null)
    const ch = this.channel
    this.channel = null
    if (ch) {
      ch.untrack().catch(() => {})
      supabase.removeChannel(ch).catch(() => {})
    }
  }

  leave() {
    if (this.left) return
    this.left = true
    this._appStateSub?.remove?.()
    this._teardown()
    if (this.status !== 'error') this.status = 'closed'
    this._changed()
    if (activeRoom === this) activeRoom = null
  }
}

// ---------------------------------------------------------------------------
// Active room registry (one room at a time; shared by lobby + game screens)
// ---------------------------------------------------------------------------

let activeRoom = null

export async function openRoom({ gameId, code, mode }) {
  const me = await getMyProfile()
  if (activeRoom && !activeRoom.left && activeRoom.gameId === gameId && activeRoom.code === code && activeRoom.status !== 'error') {
    return activeRoom
  }
  if (activeRoom) activeRoom.leave()
  activeRoom = new Room({ gameId, code: code || makeCode(gameId), me, mode })
  return activeRoom
}

// Resolves 'ok' once the room is connected and has seen its roster, 'full' if it
// turned out to be full, otherwise 'error' (incl. timeout).
function whenSettled(room, timeoutMs = 9000) {
  return new Promise((resolve) => {
    let done = false
    let settleTimer = null
    let off = null
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(settleTimer)
      off?.()
      resolve(v)
    }
    const check = () => {
      if (room.status === 'error') return finish(room.errorCode === 'full' ? 'full' : 'error')
      if (room.status === 'connected' && room.everSynced && !settleTimer) {
        // Give the presence state a moment to fill in, so a full arena is noticed.
        settleTimer = setTimeout(() => finish(room.status === 'error' ? (room.errorCode === 'full' ? 'full' : 'error') : 'ok'), 700)
      }
      return undefined
    }
    const timer = setTimeout(() => finish(room.status === 'connected' ? 'ok' : 'error'), timeoutMs)
    off = room.subscribe(check)
    check()
  })
}

/**
 * Join the always-on public Laser Tag arena (endless Free-for-all). Tries each arena
 * shard until one has room. Resolves to the Room (already the active room).
 */
export async function openArena() {
  for (const code of ARENA_CODES) {
    const room = await openRoom({ gameId: 'lasertag', code, mode: 'public' })
    const outcome = await whenSettled(room)
    if (outcome === 'ok') return room
    const message = room.error
    room.leave()
    if (outcome !== 'full') throw new Error(message || 'Couldn’t reach the arena. Check your connection and try again.')
  }
  throw new Error('Every arena is full right now. Try again in a minute.')
}

export function getActiveRoom(gameId, code) {
  if (activeRoom && !activeRoom.left && activeRoom.gameId === gameId && (!code || activeRoom.code === code)) return activeRoom
  return null
}

// Whatever room this device is in right now (any game), or null.
export function getCurrentRoom() {
  return activeRoom && !activeRoom.left && activeRoom.status !== 'error' ? activeRoom : null
}

export function leaveActiveRoom() {
  if (activeRoom) activeRoom.leave()
  activeRoom = null
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

const noopSub = () => () => {}
const nullSnap = () => null

export function useRoomSnapshot(room) {
  return useSyncExternalStore(
    room ? (fn) => room.subscribe(fn) : noopSub,
    room ? () => room.snapshot() : nullSnap,
  )
}

export function useRoomPositions(room) {
  return useSyncExternalStore(
    room ? (fn) => room.emitter.on('positions', fn) : noopSub,
    room ? () => room._posSnap : nullSnap,
  )
}

// A 1s (or custom) ticking clock based on the host's clock.
export function useRoomClock(room, intervalMs = 1000) {
  const [now, setNow] = useState(() => (room ? room.now() : Date.now()))
  useEffect(() => {
    const t = setInterval(() => setNow(room ? room.now() : Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [room, intervalMs])
  return now
}

// Watches this device's GPS (and optionally compass heading) and shares the
// position with the room about once a second.
export function useSharedLocation(room, { heading = false, enabled = true } = {}) {
  const [status, setStatus] = useState('pending') // pending | granted | denied | error
  const [coords, setCoords] = useState(null)
  const [hdg, setHdg] = useState(null)

  useEffect(() => {
    if (!room || !enabled) return undefined
    let cancelled = false
    let posSub = null
    let headSub = null
    let last = null
    let lastSent = 0
    const share = (force) => {
      if (!last) return
      const now = Date.now()
      if (!force && now - lastSent < 900) return
      lastSent = now
      room.sendPosition(last)
    }
    const keepAlive = setInterval(() => share(true), 3000)
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (perm.status !== 'granted') { setStatus('denied'); return }
        setStatus('granted')
        posSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            last = { lat: loc.coords.latitude, lng: loc.coords.longitude, acc: loc.coords.accuracy ?? null }
            setCoords(last)
            share(false)
          },
          () => {},
        )
        if (cancelled) { posSub?.remove(); posSub = null; return }
        if (heading) {
          headSub = await Location.watchHeadingAsync((h) => {
            const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
            setHdg({ deg, accuracy: h.accuracy })
          })
          if (cancelled) { headSub?.remove(); headSub = null }
        }
      } catch (e) {
        console.warn('location watch failed', e?.message ?? e)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      clearInterval(keepAlive)
      posSub?.remove()
      headSub?.remove()
    }
  }, [room, heading, enabled])

  return { status, coords, heading: hdg }
}

// Host-side game loop: routes player actions and runs a periodic tick while
// this device is the host. Handlers can change between renders.
export function useHostLoop(room, isHost, handlers, tickMs = 1000) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    if (!room || !isHost) return undefined
    const run = (name, ...args) => {
      try { ref.current[name]?.(...args) } catch (e) { console.warn(`host ${name} failed`, e?.message ?? e) }
    }
    const off = room.onAction((action, from) => run('onAction', action, from))
    run('onTick')
    const t = setInterval(() => run('onTick'), tickMs)
    return () => { off(); clearInterval(t) }
  }, [room, isHost, tickMs])
}

// Utility for games: shuffle a copy.
export function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
