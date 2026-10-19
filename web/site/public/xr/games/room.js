// Friend rooms for the glasses. Speaks the iYiYi app's arcade room protocol exactly
// (src/lib/multiplayer.js), so glasses and phones can share one game:
//   channel `arcade:<gameId>:<CODE>`, presence keyed by user id { username, avatar, joinedAt, room? },
//   broadcast event 'msg' { type, from, to?, data, ts } — state (host → all, { seq, hostNow, state }),
//   state_req, action (player → host), batch, chat and game-specific messages.
// The earliest joiner hosts and referees; if the host leaves, the next one takes over.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PREFIX = { chess: 'C', mafia: 'M', 'beside-them': 'B', lasertag: 'L', xsports: 'X' }
export const MAX = { chess: 2, mafia: 15, 'beside-them': 10, lasertag: 10, xsports: 2 }
export const DEFAULTS = {
  chess: { hostColor: 'random', clock: '10+0' },
  mafia: { nightSeconds: 30, discussSeconds: 60 },
  xsports: {},
}
export function makeCode(gameId) {
  let s = PREFIX[gameId] || 'X'
  for (let i = 1; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return s
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
export function gameIdFromCode(code) { const c = normalizeCode(code)[0]; return Object.keys(PREFIX).find((k) => PREFIX[k] === c) || null }

const FLUSH_MS = 150

export class Room {
  /** sb: supabase client; me: { id, username, avatar }; mode: 'host' | 'join' */
  constructor(sb, { gameId, code, me, mode }) {
    Object.assign(this, { sb, gameId, code, me, mode })
    this.joinedAt = Date.now()
    this.roster = []; this.hostId = null
    this.info = { phase: 'lobby', settings: { ...(DEFAULTS[gameId] || {}) }, round: 0 }
    this.infoVersion = 0
    this.state = null; this.stateSeq = 0; this.lastStateFrom = null; this.clockOffset = 0
    this.status = 'connecting'; this.error = null
    this.lastSeen = {}; this.chat = []
    this.everSyncedWithOthers = false
    this.listeners = {}
    this._outbox = []; this._dirty = false; this._pub = null
    this.left = false
    this._open()
  }
  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || new Set()).add(fn); return () => this.listeners[evt].delete(fn) }
  emit(evt, ...a) { for (const fn of this.listeners[evt] || []) { try { fn(...a) } catch (e) { console.warn('room ' + evt, e) } } }
  onMessage(type, fn) { return this.on('msg:' + type, fn) }

  async _open() {
    try { await this.sb.realtime.setAuth() } catch (e) { /* offline */ }
    const topic = 'arcade:' + this.gameId + ':' + this.code
    const stale = this.sb.getChannels().find((c) => c.topic === 'realtime:' + topic)
    if (stale) { try { await this.sb.removeChannel(stale) } catch (e) {} }
    if (this.left) return
    const ch = this.sb.channel(topic, { config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } } })
    this.channel = ch
    ch.on('presence', { event: 'sync' }, () => this._sync())
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => this._onMsg(payload))
    ch.subscribe((status) => {
      if (this.left || this.channel !== ch) return
      if (status === 'SUBSCRIBED') {
        this.status = 'connected'; this._track()
        if (this.mode === 'join') { clearTimeout(this._joinT); this._joinT = setTimeout(() => { if (!this.everSyncedWithOthers) this.fail('No open game with that code.') }, 9000) }
        if (this.hostId && this.hostId !== this.me.id) this.send('state_req', {})
        if (this.isHost() && this.state) this._markDirty()
        this.emit('change')
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.status = 'reconnecting'; this.emit('change')
      }
    })
  }
  fail(msg) { this.error = msg; this.status = 'error'; this.emit('change'); this.leave() }
  leave() { this.left = true; clearTimeout(this._pub); clearTimeout(this._joinT); const ch = this.channel; this.channel = null; if (ch) { try { ch.untrack() } catch (e) {} this.sb.removeChannel(ch).catch(() => {}) } }
  _up() { return !!this.channel && this.channel.state === 'joined' }
  _meta() { const m = { username: this.me.username, avatar: this.me.avatar || null, joinedAt: this.joinedAt, device: 'glasses' }; if (this.isHost()) m.room = { ...this.info, v: this.infoVersion }; return m }
  _track() { if (this._up()) this.channel.track(this._meta()).catch(() => {}) }

  _sync() {
    const ps = this.channel ? this.channel.presenceState() : {}
    const roster = [], metas = {}
    for (const id of Object.keys(ps)) { const m = ps[id] && ps[id][0]; if (!m) continue; metas[id] = m; roster.push({ id, username: m.username || 'Player', avatar: m.avatar || null, joinedAt: m.joinedAt || 0, glasses: m.device === 'glasses' }) }
    const others = roster.filter((p) => p.id !== this.me.id)
    if (others.length) {
      if (!this.everSyncedWithOthers && this.mode === 'join') {
        const maxO = Math.max(...others.map((p) => p.joinedAt || 0))
        if (this.joinedAt <= maxO) { this.joinedAt = maxO + 1; const mine = roster.find((p) => p.id === this.me.id); if (mine) mine.joinedAt = this.joinedAt; this._track() }
      }
      this.everSyncedWithOthers = true; clearTimeout(this._joinT)
    }
    roster.sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))
    const prevHost = this.hostId
    this.roster = roster
    const t = Date.now(); for (const p of roster) this.lastSeen[p.id] = t
    const eligible = this.mode === 'join' && !this.everSyncedWithOthers ? others : roster
    this.hostId = eligible[0] ? eligible[0].id : null
    const hr = this.hostId ? metas[this.hostId] && metas[this.hostId].room : null
    if (this.hostId !== this.me.id && hr) { const { v, ...info } = hr; this.info = info; this.infoVersion = v || 0 }
    const idx = roster.findIndex((p) => p.id === this.me.id)
    if (idx >= (MAX[this.gameId] || 8) && this.info.phase === 'lobby') { this.fail('That game is full.'); return }
    if (prevHost !== this.hostId) { if (this.isHost()) { this.infoVersion += 1; this._track() } this.emit('host', this.hostId) }
    if (this.hostId && !this.isHost() && this.status === 'connected' && (!this.state || prevHost !== this.hostId)) {
      if (!this._lastReq || t - this._lastReq > 2000) { this._lastReq = t; this.send('state_req', {}) }
    }
    this.emit('change')
  }
  presentIds(grace = 20000) { const t = Date.now(), ids = new Set(this.roster.map((p) => p.id)); for (const id of Object.keys(this.lastSeen)) if (t - this.lastSeen[id] < grace) ids.add(id); return ids }
  isHost() { return !!this.hostId && this.hostId === this.me.id }
  setInfo(patch) { if (!this.isHost()) return; this.info = { ...this.info, ...patch }; this.infoVersion += 1; this._track(); this.emit('change') }
  now() { return Date.now() + (this.isHost() ? 0 : this.clockOffset) }
  getState() { return this.state }

  send(type, data, opts = {}) {
    if (this.left || !this._up()) return
    const msg = { type, from: this.me.id, data }
    if (opts.to) msg.to = opts.to
    if (type !== 'pos') msg.ts = Date.now()
    this.channel.send({ type: 'broadcast', event: 'msg', payload: msg }).catch(() => {})
  }
  /** host → one player, or to ourselves when we're the target */
  notify(to, type, data) { if (to === this.me.id) this.emit('msg:' + type, data, this.me.id); else this.send(type, data, { to }) }
  sendAction(action) { if (this.isHost()) this.emit('action', action, this.me.id, Date.now()); else this.send('action', action) }
  sendChat(text) { const id = this.me.id + '-' + Date.now(); this.send('chat', { id, text }); this._addChat({ id, from: this.me.id, text }) }
  _addChat(c) { this.chat = [...this.chat, { ...c, ts: Date.now() }].slice(-40); this.emit('chat', c) }

  publishState(next) { if (!this.isHost()) return; this.lastStateFrom = this.me.id; this.state = next; this.clockOffset = 0; this.emit('state', next); this._markDirty() }
  _markDirty() { this._dirty = true; if (!this._pub) this._flush() }
  _flush() {
    if (this.left) return
    if (!this._up()) { this._pub = setTimeout(() => { this._pub = null; this._flush() }, FLUSH_MS * 2); return }
    if (this._dirty && this.isHost() && this.state) { this._dirty = false; this.stateSeq += 1; this.send('state', { seq: this.stateSeq, hostNow: Date.now(), state: this.state }) }
    if (this._outbox.length) { const out = this._outbox; this._outbox = []; this.send('batch', out) }
    this._pub = setTimeout(() => { this._pub = null; if ((this._dirty || this._outbox.length) && !this.left) this._flush() }, FLUSH_MS)
  }
  _onMsg(msg) {
    if (!msg || typeof msg !== 'object' || !msg.type) return
    if (msg.to && msg.to !== this.me.id) return
    switch (msg.type) {
      case 'state': {
        if (msg.from !== this.hostId) return
        const env = msg.data
        if (!env || typeof env.seq !== 'number') return
        if (msg.from === this.lastStateFrom && env.seq <= this.stateSeq) return
        this.lastStateFrom = msg.from; this.stateSeq = env.seq; this.state = env.state
        if (typeof env.hostNow === 'number') this.clockOffset = env.hostNow - Date.now()
        this.emit('state', this.state); this.emit('change'); return
      }
      case 'state_req': if (this.isHost() && this.state) this.send('state', { seq: this.stateSeq, hostNow: Date.now(), state: this.state }, { to: msg.from }); this.emit('state_req', msg.from); return
      case 'action': if (this.isHost()) this.emit('action', msg.data, msg.from, msg.ts); return
      case 'batch': for (const it of Array.isArray(msg.data) ? msg.data : []) if (it && typeof it === 'object') this._onMsg({ type: it.t, to: it.to || null, data: it.d, from: msg.from, ts: msg.ts }); return
      case 'chat': this._addChat({ id: (msg.data && msg.data.id) || msg.from + msg.ts, from: msg.from, text: String((msg.data && msg.data.text) || '').slice(0, 300) }); return
      case 'pos': this.emit('pos', msg.from, msg.data); return
      default: this.emit('msg:' + msg.type, msg.data, msg.from)
    }
  }
}

/** Fake room for ?xrtest: a CPU friend joins after a moment and the glasses host. */
export class TestRoom extends Room {
  constructor(_sb, opts) { super({ realtime: { setAuth() {} }, getChannels: () => [], removeChannel: async () => {}, channel: () => null }, opts) }
  async _open() {
    this.status = 'connected'
    this.roster = [{ id: this.me.id, username: this.me.username, joinedAt: this.joinedAt }]
    this.hostId = this.me.id
    setTimeout(() => { if (this.left) return; const n = this.gameId === 'mafia' ? 5 : 1; for (let i = 1; i <= n; i++) this.roster.push({ id: 'friend' + i, username: ['Maya', 'Jay', 'Rio', 'Kai', 'Zoe'][i - 1], joinedAt: this.joinedAt + i }); this.everSyncedWithOthers = true; this.emit('change') }, 600)
  }
  _up() { return false }
  send() {}
  presentIds() { return new Set(this.roster.map((p) => p.id)) }
  _markDirty() {}
}
