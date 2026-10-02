// Game invites ("challenges") and event invites between users, over Supabase Realtime broadcast only.
// Every signed-in user listens on their own inbox channel `inbox:<userId>` while the
// app is in the foreground (see components/InviteListener). Sending = briefly join the
// recipient's inbox channel, broadcast one 'game-invite' event, leave.
import { supabase } from './supabase'
import { MP_GAMES, getMyProfile, isValidCode, gameIdFromCode } from './multiplayer'

export const INVITE_EVENT = 'game-invite'
export const inboxTopic = (userId) => `inbox:${userId}`

const SEND_TIMEOUT_MS = 8000
const chains = new Map() // userId -> last pending send (sends to one user go one at a time)

async function sendOnce(toUserId, payload) {
  const topic = inboxTopic(toUserId)
  // supabase.channel() hands back an existing channel with the same topic, so clear any
  // leftover first (we never keep a channel open on someone else's inbox).
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  if (stale) {
    try { await supabase.removeChannel(stale) } catch { /* ignore */ }
  }
  const ch = supabase.channel(topic, { config: { broadcast: { self: false, ack: true } } })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Couldn’t reach them. Check your connection and try again.')), SEND_TIMEOUT_MS)
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer)
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer)
          reject(new Error('Couldn’t send the invite. Try again.'))
        }
      })
    })
    const res = await ch.send({ type: 'broadcast', event: INVITE_EVENT, payload })
    if (res !== 'ok') throw new Error('Couldn’t send the invite. Try again.')
  } finally {
    supabase.removeChannel(ch).catch(() => {})
  }
}

// Sends { fromId, fromName, fromAvatar, gameId, code } to `toUserId`'s inbox.
export async function sendGameInvite(toUserId, { gameId, code }) {
  if (!toUserId) throw new Error('Missing player.')
  if (!MP_GAMES[gameId] || !isValidCode(code)) throw new Error('That game can’t be shared.')
  const me = await getMyProfile()
  if (me.id === toUserId) throw new Error('You can’t invite yourself.')
  const payload = { kind: 'game', fromId: me.id, fromName: me.username, fromAvatar: me.avatar || null, gameId, code, ts: Date.now() }
  return queueSend(toUserId, payload)
}

function queueSend(toUserId, payload) {
  const prev = chains.get(toUserId) || Promise.resolve()
  const next = prev.catch(() => {}).then(() => sendOnce(toUserId, payload))
  chains.set(toUserId, next)
  next.finally(() => { if (chains.get(toUserId) === next) chains.delete(toUserId) }).catch(() => {})
  return next
}

// Event invites ride the same inbox channel: { kind: 'event', eventId, title, startsAt }.
export async function sendEventInvite(toUserId, { eventId, title, startsAt }) {
  if (!toUserId) throw new Error('Missing person.')
  if (!eventId) throw new Error('That event can’t be shared.')
  const me = await getMyProfile()
  if (me.id === toUserId) throw new Error('You can’t invite yourself.')
  const payload = {
    kind: 'event', fromId: me.id, fromName: me.username, fromAvatar: me.avatar || null,
    eventId: String(eventId), title: String(title || 'an event').slice(0, 80), startsAt: startsAt || null, ts: Date.now(),
  }
  return queueSend(toUserId, payload)
}

// Laser Tag bystander tag: an opted-in user who isn't in the match got tagged.
// { kind: 'lt-tag', fromId, fromName, gameId, code, tagId? } — tagId is the
// laser_bystander_tags row, so the receiver can mark it seen.
export async function sendBystanderTag(toUserId, { fromName, gameId = 'lasertag', code, tagId } = {}) {
  if (!toUserId) throw new Error('Missing person.')
  const me = await getMyProfile()
  if (me.id === toUserId) return undefined
  const payload = {
    kind: 'lt-tag',
    fromId: me.id,
    fromName: String(fromName || me.username || 'Someone').slice(0, 32),
    fromAvatar: me.avatar || null,
    gameId: MP_GAMES[gameId] ? gameId : 'lasertag',
    code: isValidCode(code) ? code : null,
    tagId: typeof tagId === 'string' ? tagId : null,
    ts: Date.now(),
  }
  return queueSend(toUserId, payload)
}

// Validates an incoming payload; returns a clean invite or null.
// Game invites: { kind: 'game', gameId, code }. Event invites: { kind: 'event', eventId, title, startsAt }.
// Laser Tag bystander tags: { kind: 'lt-tag', gameId: 'lasertag', code|null, tagId|null }.
export function parseInvite(payload, myId) {
  if (!payload || typeof payload !== 'object') return null
  const { fromId, fromName, fromAvatar } = payload
  if (typeof fromId !== 'string' || !fromId || fromId === myId) return null
  const base = {
    fromId,
    fromName: typeof fromName === 'string' && fromName ? fromName.slice(0, 32) : 'Someone',
    fromAvatar: typeof fromAvatar === 'string' ? fromAvatar : null,
  }
  if (payload.kind === 'lt-tag') {
    const code = typeof payload.code === 'string' && isValidCode(payload.code) && gameIdFromCode(payload.code) === 'lasertag' ? payload.code : null
    return { ...base, kind: 'lt-tag', gameId: 'lasertag', code, tagId: typeof payload.tagId === 'string' ? payload.tagId : null }
  }
  if (payload.kind === 'event') {
    if (typeof payload.eventId !== 'string' || !payload.eventId) return null
    return { ...base, kind: 'event', eventId: payload.eventId, title: typeof payload.title === 'string' ? payload.title.slice(0, 80) : 'an event', startsAt: payload.startsAt || null }
  }
  const { gameId, code } = payload
  if (!MP_GAMES[gameId] || !isValidCode(code) || gameIdFromCode(code) !== gameId) return null
  return { ...base, kind: 'game', gameId, code }
}
