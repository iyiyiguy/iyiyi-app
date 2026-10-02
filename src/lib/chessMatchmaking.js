// Random online chess matchmaking over a shared Supabase Realtime channel ('chess:queue').
//
// Every searching player tracks presence { id, name, avatar, rating, ts, st } on the queue.
// Each client runs the same pairing over the same presence list: walk the waiting players
// oldest first and pair each with the closest-rated other waiter inside a rating window that
// widens the longer they wait. When a pair includes me and my user id is the smaller one, I
// create a private chess room (existing multiplayer room API, gameId 'chess') and broadcast
// { type: 'match', code, a, b }. The other player answers 'ack' and joins the code, or 'nack'
// if it is already busy with another proposal. Presence views can briefly disagree between
// phones, so a proposal is only binding once acked; a nack / timeout returns both players to
// the queue and keeps that opponent out of the next couple of pairings.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { supabase } from './supabase'
import { getMyProfile, makeCode, openRoom } from './multiplayer'
import { loadArcadeStats } from './arcadeStats'

const TOPIC = 'chess:queue'
const ACK_TIMEOUT_MS = 6000
const CONNECT_TIMEOUT_MS = 16000
const EXCLUDE_MS = 12000
const RECENT_MATCH_MS = 20000
export const SLOW_SEARCH_MS = 30000
const GIVE_UP_MS = 4 * 60 * 1000
const BASE_WINDOW = 150 // rating points
const WINDOW_PER_SEC = 15 // widens by this much per second waited; anyone after ~60 s

function windowFor(p, now) {
  const waited = Math.max(0, (now - (p.ts || now)) / 1000)
  if (waited > 60) return Infinity
  return BASE_WINDOW + waited * WINDOW_PER_SEC
}

// Pure + deterministic for a given waiting list and clock: returns my partner (or null).
export function pickPartner(waiting, myId, now = Date.now()) {
  const list = [...waiting].sort((x, y) => (x.ts - y.ts) || (x.id < y.id ? -1 : 1))
  const paired = new Set()
  for (const p of list) {
    if (paired.has(p.id)) continue
    let best = null
    let bestD = Infinity
    for (const q of list) {
      if (q.id === p.id || paired.has(q.id)) continue
      const d = Math.abs((p.rating || 1200) - (q.rating || 1200))
      if (d > Math.max(windowFor(p, now), windowFor(q, now))) continue
      if (d < bestD) { best = q; bestD = d } // list is oldest-first, so ties keep the older one
    }
    if (!best) continue
    paired.add(p.id)
    paired.add(best.id)
    if (p.id === myId) return best
    if (best.id === myId) return p
  }
  return null
}

class Matchmaker {
  constructor(onChange) {
    this.onChange = onChange
    this.status = 'idle' // idle | connecting | searching | proposing | joining | matched | error
    this.error = null
    this.notice = null
    this.me = null
    this.rating = 1200
    this.channel = null
    this.startedAt = 0
    this.joinedQueueAt = 0
    this.waitingCount = 0
    this.excluded = {} // id -> until
    this.recent = {} // id -> until (matched with someone else)
    this.pending = null // { code, partner, room, timer, role }
    this.room = null
    this.match = null // { code, opponent }
    this.tickTimer = null
    this.retryTimer = null
    this.stopped = true
  }

  _emit() {
    try { this.onChange?.(this.snapshot()) } catch { /* ignore */ }
  }

  snapshot() {
    return {
      status: this.status,
      error: this.error,
      notice: this.notice,
      startedAt: this.startedAt,
      waitingCount: this.waitingCount,
      match: this.match,
    }
  }

  async start() {
    if (!this.stopped) return
    this.stopped = false
    this.error = null
    this.notice = null
    this.match = null
    this.room = null
    this.pending = null
    this.joinedQueueAt = 0
    this.status = 'connecting'
    this.startedAt = Date.now()
    this._emit()
    try {
      this.me = await getMyProfile()
    } catch (e) {
      this._fail(e?.message || 'Please sign in to play online.')
      return
    }
    try {
      const stats = await loadArcadeStats()
      const r = Number(stats?.chess?.rating)
      if (Number.isFinite(r)) this.rating = Math.round(r)
    } catch { /* default rating */ }
    if (this.stopped) return
    await this._openChannel()
    clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this._tick(), 2000)
  }

  _fail(message) {
    this.stop()
    this.status = 'error'
    this.error = message
    this._emit()
  }

  async _openChannel() {
    if (this.stopped) return
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${TOPIC}`)
    if (stale) {
      try { await supabase.removeChannel(stale) } catch { /* ignore */ }
    }
    if (this.stopped || this.channel) return
    let ch
    try {
      ch = supabase.channel(TOPIC, { config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } } })
    } catch (e) {
      this._retryChannel()
      return
    }
    this.channel = ch
    ch.on('presence', { event: 'sync' }, () => { if (this.channel === ch) this._evaluate() })
    ch.on('broadcast', { event: 'mm' }, ({ payload }) => { if (this.channel === ch) this._onMsg(payload) })
    ch.subscribe((status) => {
      if (this.channel !== ch || this.stopped) return
      if (status === 'SUBSCRIBED') {
        if (this.status === 'connecting') this.status = 'searching'
        this._trackWaiting()
        this._emit()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this._retryChannel()
      }
    })
  }

  _retryChannel() {
    const old = this.channel
    this.channel = null
    if (old) supabase.removeChannel(old).catch(() => {})
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      if (!this.stopped && !this.channel && (this.status === 'searching' || this.status === 'connecting')) this._openChannel()
    }, 3000)
  }

  _trackWaiting() {
    if (!this.channel || this.stopped) return
    if (!this.joinedQueueAt) this.joinedQueueAt = Date.now()
    const meta = { id: this.me.id, name: this.me.username, avatar: this.me.avatar || null, rating: this.rating, ts: this.joinedQueueAt, st: 'w' }
    this.channel.track(meta).catch(() => {})
  }

  _trackBusy() {
    if (!this.channel) return
    this.channel.track({ id: this.me.id, name: this.me.username, avatar: this.me.avatar || null, rating: this.rating, ts: this.joinedQueueAt, st: 'b' }).catch(() => {})
  }

  _send(payload) {
    if (!this.channel) return
    this.channel.send({ type: 'broadcast', event: 'mm', payload: { ...payload, from: this.me?.id, at: Date.now() } }).catch(() => {})
  }

  _waiting() {
    const state = this.channel?.presenceState?.() || {}
    const now = Date.now()
    const out = []
    for (const id of Object.keys(state)) {
      const meta = (state[id] || []).find((m) => m && m.st === 'w')
      if (!meta) continue
      if (id !== this.me.id && ((this.excluded[id] || 0) > now || (this.recent[id] || 0) > now)) continue
      out.push({ id, name: String(meta.name || 'Player').slice(0, 32), avatar: meta.avatar || null, rating: Number(meta.rating) || 1200, ts: Number(meta.ts) || now })
    }
    return out
  }

  _tick() {
    if (this.stopped) return
    if (this.status === 'searching' && Date.now() - this.startedAt > GIVE_UP_MS) {
      this.stop()
      this.status = 'idle'
      this.notice = 'No one is searching right now. Try again in a bit, or invite a friend.'
      this._emit()
      return
    }
    this._evaluate()
    this._emit() // refresh elapsed time / counts
  }

  _evaluate() {
    if (this.stopped || !this.me) return
    const waiting = this._waiting()
    const count = Math.max(0, waiting.filter((p) => p.id !== this.me.id).length)
    if (count !== this.waitingCount) { this.waitingCount = count; this._emit() }
    if (this.status !== 'searching') return
    if (!waiting.some((p) => p.id === this.me.id)) return // our own presence not in yet
    const partner = pickPartner(waiting, this.me.id)
    if (!partner) return
    // The smaller id creates the room; the other waits for the proposal.
    if (this.me.id < partner.id) this._propose(partner)
  }

  async _propose(partner) {
    this.status = 'proposing'
    this._trackBusy()
    this._emit()
    const code = makeCode('chess')
    let room
    try {
      room = await openRoom({ gameId: 'chess', code, mode: 'host' })
      // Private (never advertised in "nearby"), random colours.
      room.info = { ...room.info, settings: { ...(room.info.settings || {}), hostColor: 'random', visibility: 'private', matchmade: true } }
    } catch (e) {
      this._backToQueue(partner.id)
      return
    }
    if (this.stopped || this.status !== 'proposing') { try { room.leave() } catch { /* ignore */ } return }
    this.room = room
    this.pending = { code, partner, role: 'host', timer: setTimeout(() => this._abortPending('no-ack'), ACK_TIMEOUT_MS) }
    this._send({ type: 'match', code, a: this.me.id, b: partner.id })
  }

  _onMsg(msg) {
    if (!msg || typeof msg !== 'object' || this.stopped || !this.me) return
    const myId = this.me.id
    if (msg.type === 'match') {
      if (msg.b === myId && typeof msg.code === 'string') {
        if (this.status === 'searching') this._accept(msg)
        else this._send({ type: 'nack', code: msg.code, a: msg.a, b: myId })
        return
      }
      // Someone else's match: keep both out of our pairing for a while.
      const until = Date.now() + RECENT_MATCH_MS
      if (msg.a && msg.a !== myId) this.recent[msg.a] = until
      if (msg.b && msg.b !== myId) this.recent[msg.b] = until
      return
    }
    if (msg.type === 'ack' && this.pending?.role === 'host' && msg.code === this.pending.code && msg.b === this.pending.partner.id) {
      clearTimeout(this.pending.timer)
      this._waitForGuest()
      return
    }
    if (msg.type === 'nack' && this.pending?.role === 'host' && msg.code === this.pending.code) {
      this._abortPending('nack')
      return
    }
    if (msg.type === 'cancel' && this.pending?.role === 'guest' && msg.code === this.pending.code) {
      this._abortPending('cancelled')
    }
  }

  async _accept(msg) {
    const partnerId = msg.a
    this.status = 'joining'
    this._trackBusy()
    this._send({ type: 'ack', code: msg.code, a: partnerId, b: this.me.id })
    this._emit()
    let room
    try {
      room = await openRoom({ gameId: 'chess', code: msg.code, mode: 'join' })
    } catch {
      this._backToQueue(partnerId)
      return
    }
    if (this.stopped || this.status !== 'joining') { try { room.leave() } catch { /* ignore */ } return }
    this.room = room
    const partner = { id: partnerId }
    this.pending = { code: msg.code, partner, role: 'guest', timer: setTimeout(() => this._abortPending('timeout'), CONNECT_TIMEOUT_MS) }
    const check = () => {
      if (this.room !== room || this.stopped) return
      if (room.status === 'error') { this._abortPending('error'); return }
      if (room.info?.phase === 'playing') {
        const host = room.roster.find((p) => p.id === partnerId)
        this._matched({ code: msg.code, opponent: { id: partnerId, name: host?.username || 'Opponent', avatar: host?.avatar || null } })
      }
    }
    this.pending.off = room.subscribe(check)
    check()
  }

  _waitForGuest() {
    const room = this.room
    const pend = this.pending
    if (!room || !pend) return
    this.status = 'joining'
    this._emit()
    pend.timer = setTimeout(() => this._abortPending('timeout'), CONNECT_TIMEOUT_MS)
    const check = () => {
      if (this.room !== room || this.stopped) return
      if (room.status === 'error') { this._abortPending('error'); return }
      const guest = room.roster.find((p) => p.id === pend.partner.id)
      if (guest && room.isHost()) {
        try { room.setInfo({ phase: 'playing', round: (room.info.round || 0) + 1, startedAt: Date.now() }) } catch { /* ignore */ }
        this._matched({ code: pend.code, opponent: { id: guest.id, name: guest.username || pend.partner.name || 'Opponent', avatar: guest.avatar || pend.partner.avatar || null } })
      }
    }
    pend.off = room.subscribe(check)
    check()
  }

  _matched(match) {
    const pend = this.pending
    if (pend) { clearTimeout(pend.timer); try { pend.off?.() } catch { /* ignore */ } }
    this.pending = null
    this.match = match
    this.status = 'matched'
    // Leave the queue; the room now belongs to the game screen (caller sets handedOff).
    this._closeChannel()
    clearInterval(this.tickTimer)
    this.stopped = true
    this._emit()
  }

  _abortPending(reason) {
    const pend = this.pending
    if (!pend) return
    clearTimeout(pend.timer)
    try { pend.off?.() } catch { /* ignore */ }
    this.pending = null
    if (pend.role === 'host' && reason !== 'nack') this._send({ type: 'cancel', code: pend.code })
    this._backToQueue(pend.partner?.id)
  }

  _backToQueue(excludeId) {
    if (excludeId) this.excluded[excludeId] = Date.now() + EXCLUDE_MS
    if (this.room && !this.room.handedOff) { try { this.room.leave() } catch { /* ignore */ } }
    this.room = null
    if (this.stopped) return
    this.status = 'searching'
    this._trackWaiting()
    this._emit()
  }

  _closeChannel() {
    const ch = this.channel
    this.channel = null
    if (ch) {
      ch.untrack?.().catch?.(() => {})
      supabase.removeChannel(ch).catch(() => {})
    }
  }

  // Leave the queue and drop any half-made room (unless handed to the game screen).
  stop() {
    this.stopped = true
    clearInterval(this.tickTimer)
    clearTimeout(this.retryTimer)
    if (this.pending) {
      clearTimeout(this.pending.timer)
      try { this.pending.off?.() } catch { /* ignore */ }
      if (this.pending.role === 'host') this._send({ type: 'cancel', code: this.pending.code })
      this.pending = null
    }
    this._closeChannel()
    if (this.room && !this.room.handedOff) { try { this.room.leave() } catch { /* ignore */ } }
    this.room = null
    this.joinedQueueAt = 0
  }

  getRoom() {
    return this.room
  }
}

/**
 * React hook: { status, error, notice, elapsedMs, waitingCount, match, start, cancel, takeRoom }.
 * Leaves the queue on unmount, pauses while the app is in the background and resumes when it
 * comes back. Call takeRoom() once matched to hand the room to the game screen.
 */
export function useChessMatchmaking() {
  const [snap, setSnap] = useState({ status: 'idle', error: null, notice: null, startedAt: 0, waitingCount: 0, match: null })
  const mm = useRef(null)
  const alive = useRef(true)
  const resumeOnActive = useRef(false)

  const get = useCallback(() => {
    if (!mm.current) mm.current = new Matchmaker((s) => { if (alive.current) setSnap(s) })
    return mm.current
  }, [])

  const start = useCallback(() => {
    const m = get()
    m.start().catch((e) => { if (alive.current) setSnap((s) => ({ ...s, status: 'error', error: e?.message || 'Matchmaking failed.' })) })
  }, [get])

  const cancel = useCallback(() => {
    const m = mm.current
    if (!m) return
    resumeOnActive.current = false
    m.stop()
    m.status = 'idle'
    m.notice = null
    m._emit()
  }, [])

  const takeRoom = useCallback(() => {
    const room = mm.current?.getRoom() || null
    if (room) room.handedOff = true
    return room
  }, [])

  useEffect(() => {
    alive.current = true
    const sub = AppState.addEventListener('change', (state) => {
      const m = mm.current
      if (!m) return
      if (state === 'background') {
        if (['connecting', 'searching', 'proposing', 'joining'].includes(m.status)) {
          resumeOnActive.current = true
          m.stop()
          m.status = 'idle'
          m.notice = 'Search paused while the app was in the background.'
          m._emit()
        }
      } else if (state === 'active' && resumeOnActive.current) {
        resumeOnActive.current = false
        m.notice = null
        m.start().catch(() => {})
      }
    })
    return () => {
      alive.current = false
      sub?.remove?.()
      try { mm.current?.stop() } catch { /* ignore */ }
    }
  }, [])

  return { ...snap, start, cancel, takeRoom }
}
