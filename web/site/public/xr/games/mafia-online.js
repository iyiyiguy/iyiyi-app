// Online Mafia for the glasses: the same rooms as the iYiYi app (code M····), so friends on phones
// and friends on glasses play one game. Every real player is a penguin in a half circle with their
// @name; point + pinch on a penguin (or pinch off to the side for the list) to act. Room chat pops
// up as speech bubbles. If the glasses end up hosting, they referee with the app's own rules.
import { makePenguin, posePenguin, pointedAt, ST, hexStr } from './kit.js'
import { Room, TestRoom, makeCode } from './room.js'
import { E, T } from './mafia-engine.js'

const RN = { town: 'TOWNSPERSON', mafia: 'MAFIA', doctor: 'DOCTOR', detective: 'DETECTIVE' }
const OUT = { town: 'vest', mafia: 'mafia', doctor: 'doctor', detective: 'detective' }
const RC = { town: ST.friendly, mafia: ST.enemy, doctor: ST.health, detective: ST.objective }
const COLORS = [0xff4fa3, 0x39d5ff, 0xffb21e, 0x5cf2a0, 0xb06cff, 0xff7a1a]
const LINES = { n_own: "THAT'S ONE OF YOUR OWN", n_target_locked: 'TARGET LOCKED: {name}', n_wants: '{who} WANTS {name}', n_protected_last: 'YOU PROTECTED {name} LAST NIGHT · PICK SOMEONE ELSE', n_protecting: 'PROTECTING {name} TONIGHT', n_already_investigated: 'YOU ALREADY INVESTIGATED TONIGHT' }
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => String((v && v[k]) || '').toUpperCase())
const QUICK = ["I'M TOWN!", 'NOT ME!', 'SKIP THIS ONE', 'I TRUST YOU', 'SUS…']
let ctx, THREE, O = null
const V = (x, y, z) => new THREE.Vector3(x, y, z)

export async function startOnline(c, mode, code, onExit) {
  ctx = c; THREE = c.THREE
  const me = await ctx.me()
  if (!me) { ctx.toast('LINK YOUR iYiYi ACCOUNT FIRST', 4000); onExit(); return }
  const R = ctx.TEST ? TestRoom : Room
  const room = new R(ctx.sb, { gameId: 'mafia', code: code || makeCode('mafia'), me, mode })
  O = { room, me, onExit, offs: [], peng: {}, role: null, inv: [], notice: '', secret: null, claims: { round: null, roles: {}, since: 0 }, lastKey: '', sent: {}, center: null }
  const on = (e, f) => O.offs.push(room.on(e, f))
  const onMsg = (t, f) => O.offs.push(room.onMessage(t, f))
  on('change', () => { if (!O) return; if (room.status === 'error') { ctx.toast(String(room.error || 'ROOM CLOSED').toUpperCase(), 5000); stopOnline(); onExit(); return } if (!room.getState() || room.info.phase === 'lobby') lobby() })
  on('state', () => sync())
  on('chat', (m) => { const p = O && O.peng[m.from]; if (p) p.say(String(m.text).slice(0, 40), 6000); else if (m.from !== me.id) ctx.toast(String(m.text).slice(0, 50), 3500) })
  onMsg('role', (d) => { O.role = d; reveal() })
  onMsg('notice', (d) => ctx.toast(d && d.k && LINES[d.k] ? fill(LINES[d.k], d.v) : String((d && d.text) || '').toUpperCase(), 4500))
  onMsg('investigate', (d) => { if (!d) return; O.inv.push({ ...d, round: O.role && O.role.round }); ctx.toast(String(d.name).toUpperCase() + (d.isMafia ? ' IS THE MAFIA!' : ' IS NOT THE MAFIA'), 6500); const p = O.peng[d.target]; if (p) ctx.burst(p.pos.clone().add(V(0, 0.7, 0)), d.isMafia ? ST.enemy : ST.health, 18, 0.05) })
  onMsg('whois', (d, from) => { const s = room.getState(); if (O.role && s && d && d.round === s.round && O.role.round === s.round) room.send('iam', { round: s.round, role: O.role.role, team: O.role.team || null }, { to: from }) })
  // ---- host side (only runs while the glasses are the room's host)
  onMsg('role_req', (d, from) => { if (!room.isHost()) return; const sec = O.secret; const s = room.getState(); if (sec && d && d.round === sec.round && s && s.players[from]) room.notify(from, 'role', E.roleMessage(sec, from)) })
  onMsg('iam', (d, from) => { if (!room.isHost()) return; const s = room.getState(); if (!s || !d || d.round !== s.round || !RN[d.role]) return; if (O.claims.round !== s.round) O.claims = { round: s.round, roles: {}, since: room.now() }; O.claims.roles[from] = { role: d.role, team: Array.isArray(d.team) ? d.team : null } })
  on('action', (a, from) => { if (room.isHost()) hostAction(a, from) })
  O.hostT = setInterval(() => { if (O && room.isHost()) hostTick() }, 500)
  O.roleReqT = setInterval(() => { const s = O && room.getState(); if (s && s.game === 'mafia' && s.players[me.id] && (!O.role || O.role.round !== s.round) && room.hostId && !room.isHost()) room.send('role_req', { round: s.round }, { to: room.hostId }) }, 3000)
  lobby()
}
export function stopOnline() {
  if (!O) return
  O.offs.forEach((f) => f()); clearInterval(O.hostT); clearInterval(O.roleReqT)
  O.room.leave(); clearScene(); O = null
}
export const onlineActive = () => !!O
function clearScene() { while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0]); if (O) { O.peng = {}; O.signs = [] } }

function lobby() {
  const r = O.room
  const items = r.roster.slice(0, 6).map((p) => ['@' + p.username + (p.id === O.me.id ? ' (YOU)' : ''), 'noop', (p.id === r.hostId ? 'HOST · ' : '') + (p.glasses ? 'GLASSES' : 'PHONE')])
  if (r.roster.length > 6) items.push(['+' + (r.roster.length - 6) + ' MORE', 'noop', ''])
  const need = Math.max(0, 5 - r.roster.length)
  if (r.isHost()) items.push([need ? 'NEED ' + need + ' MORE TO START' : 'START GAME', 'start', r.roster.length + ' PLAYERS'])
  else items.push(['WAITING FOR THE HOST', 'noop', 'THEY PRESS START'])
  items.push(['LEAVE', 'leave', ''])
  ctx.choose('Mafia · code ' + r.code, items, (v) => {
    if (!O) return
    if (v === 'start' && r.roster.length >= 5) { r.setInfo({ phase: 'playing', round: (r.info.round || 0) + 1, startedAt: Date.now() }); return }
    if (v === 'leave') { const back = O.onExit; stopOnline(); back(); return }
    if (!r.getState() || r.info.phase === 'lobby') lobby()
  })
  ctx.line('MAFIA · CODE ' + r.code, r.roster.length + ' IN THE ROOM · 5 TO 15 PLAYERS')
}

// ---- scene: one penguin per player in a half circle in front of you
function seat(s) {
  if (!O.center) { const v = ctx.viewPos(); O.center = V(v.x, 0, v.z); O.fwd = ctx.flatForward() }
  const ids = Object.keys(s.players).filter((id) => id !== O.me.id)
  const R = ids.length > 8 ? 4 : 2.9
  ids.forEach((id, i) => {
    if (O.peng[id]) return
    const ang = -100 + (200 * i) / Math.max(1, ids.length - 1)
    const p = makePenguin(ctx, 'vest', COLORS[i % 6], '@' + s.players[id].name, 1.05)
    p.pos.copy(ctx.floorAt(O.center, O.fwd, ids.length === 1 ? 0 : ang, R)); p.id = id
    O.peng[id] = p
  })
}
function reveal() {
  const s = O.room.getState(); if (!s || !O.role) return
  const m = O.role, f = ctx.flatForward(), at = ctx.floorAt(ctx.viewPos(), f, 0, 2.3)
  if (O.revealP) ctx.group.remove(O.revealP.group)
  O.revealP = makePenguin(ctx, OUT[m.role], ST.friendly, RN[m.role], 1); O.revealP.pos.copy(at); O.revealP.label.set(RN[m.role], hexStr(RC[m.role]))
  O.revealUntil = Date.now() + 6000
  ctx.burst(at.clone().add(V(0, 0.8, 0)), RC[m.role], 30, 0.05)
  const mates = (m.team || []).filter((id) => id !== O.me.id).map((id) => '@' + ((s.players[id] && s.players[id].name) || '?'))
  ctx.toast(m.role === 'mafia' && mates.length ? 'YOU ARE THE MAFIA · PARTNER: ' + mates.join(', ') : 'YOU ARE THE ' + RN[m.role], 6500)
}
function sync() {
  const s = O.room.getState()
  if (!s || s.game !== 'mafia') return
  ctx.closePick()
  if (O.round !== s.round) { O.round = s.round; clearScene(); O.center = null; O.inv = []; O.sent = {}; O.lastKey = ''; ctx.toast('ROLES ARE BEING DEALT…', 3000) }
  seat(s)
  const key = s.phase + ':' + s.dayNumber
  if (key !== O.lastKey) {
    O.lastKey = key; O.pick = null
    const meP = s.players[O.me.id], role = O.role && O.role.round === s.round ? O.role.role : null
    if (s.phase === 'night') ctx.toast(!meP || !meP.alive ? 'NIGHT FALLS · YOU ARE WATCHING' : role === 'mafia' ? 'POINT AT WHO TO ELIMINATE + PINCH' : role === 'doctor' ? 'POINT AT WHO TO SAVE + PINCH' : role === 'detective' ? 'POINT AT WHO TO INVESTIGATE + PINCH' : 'THE TOWN SLEEPS…', 5000)
    if (s.phase === 'discuss') { const nr = s.nightResult; ctx.toast(nr && nr.killed ? '@' + String(s.players[nr.killed].name).toUpperCase() + ' WAS ELIMINATED LAST NIGHT' : 'NOBODY WAS ELIMINATED LAST NIGHT', 6000) }
    if (s.phase === 'vote') ctx.toast('VOTE · POINT + PINCH ON A PENGUIN · PINCH TO THE SIDE TO SKIP', 5000)
    if (s.phase === 'night' && s.voteResult) { const ve = s.voteResult.eliminated; if (ve) ctx.toast('@' + String(s.players[ve].name).toUpperCase() + ' WAS VOTED OUT', 5000) }
    if (s.phase === 'ended') {
      const won = s.winner && role ? (s.winner === 'mafia') === (role === 'mafia') : null
      if (won) setTimeout(() => ctx.earn && ctx.earn(50, 'MAFIA WIN'), 2600); 
      ctx.toast(s.reason === 'host_left' ? 'THE HOST LEFT · ROUND VOID' : (s.winner === 'town' ? 'TOWN WINS!' : 'THE MAFIA WINS!') + (won == null ? '' : won ? '  YOU WIN' : '  YOU LOSE'), 12000)
      for (let k = 0; k < 4; k++) ctx.burst(ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 2).add(V((k - 1.5) * 0.6, 0.4, 0)), s.winner === 'town' ? ST.friendly : ST.enemy, 24, 0.06)
    }
  }
  for (const id of Object.keys(O.peng)) {
    const p = O.peng[id], pl = s.players[id]
    if (!pl) continue
    const rr = s.roles && s.roles[id]
    if (rr && !p.shown) { p.shown = true; p.dress(OUT[rr], COLORS[0]); p.label.set('@' + pl.name + ' · ' + RN[rr], hexStr(RC[rr])) }
    if (!pl.alive && !p.dead) { p.dead = true; ctx.blockPile(p.pos.clone()); p.group.visible = false }
  }
}
export function select(ray) {
  if (!O) return
  const s = O.room.getState()
  if (!s || s.game !== 'mafia') { lobby(); return }
  if (O.revealP && Date.now() < O.revealUntil) { O.revealUntil = 0; return }
  const ids = Object.keys(O.peng).filter((id) => s.players[id] && s.players[id].alive)
  const i = pointedAt(ctx, ray, ids, (id) => O.peng[id].pos.clone().add(V(0, 0.7, 0)), () => true, 8)
  if (i >= 0) act(ids[i]); else menu()
}
function myRole() { const s = O.room.getState(); return O.role && s && O.role.round === s.round ? O.role : null }
function act(id) {
  const s = O.room.getState(), meP = s.players[O.me.id], r = myRole(), nm = '@' + String(s.players[id].name).toUpperCase()
  if (!meP || !meP.alive) { ctx.toast("YOU'RE OUT · WATCHING"); return }
  if (s.phase === 'night') {
    if (!r || r.role === 'town') { ctx.toast('YOU SUSPECT ' + nm, 2500); return }
    const k = 'n' + s.dayNumber
    if (O.sent[k]) { ctx.toast('YOU ALREADY CHOSE TONIGHT'); return }
    if (r.role === 'mafia' && (r.team || []).includes(id)) { ctx.toast("THAT'S YOUR PARTNER"); return }
    O.sent[k] = id; ctx.beep('tap')
    O.room.sendAction({ type: r.role === 'mafia' ? 'mafia_target' : r.role === 'doctor' ? 'doctor_save' : 'detective_investigate', target: id })
    return
  }
  if (s.phase === 'vote') { vote(id); return }
  if (s.phase === 'discuss') { O.room.sendChat("IT'S " + nm + '!'); ctx.toast('YOU ACCUSE ' + nm, 2500) }
}
function vote(target) {
  const s = O.room.getState(), k = 'v' + s.dayNumber
  if (s.votes && s.votes[O.me.id] !== undefined) { ctx.toast('YOU ALREADY VOTED'); return }
  O.sent[k] = target; ctx.beep('tap'); O.room.sendAction({ type: 'vote', target })
  ctx.toast(target === 'skip' ? 'YOU SKIPPED' : 'YOU VOTED @' + String(s.players[target].name).toUpperCase(), 3000)
}
function menu() {
  const s = O.room.getState(), r = myRole(), meP = s.players[O.me.id]
  const items = []
  const alive = Object.keys(s.players).filter((id) => id !== O.me.id && s.players[id].alive)
  if (meP && meP.alive && s.phase === 'vote') { items.push(['SKIP', 'skip', 'NOBODY GOES']); alive.slice(0, 5).forEach((id) => items.push(['VOTE @' + s.players[id].name, 'p:' + id, ''])) }
  else if (meP && meP.alive && s.phase === 'night' && r && r.role !== 'town') {
    if (r.role === 'doctor') items.push(['SAVE MYSELF', 'p:' + O.me.id, ''])
    alive.slice(0, 5).forEach((id) => items.push([(r.role === 'mafia' ? 'TARGET' : r.role === 'doctor' ? 'SAVE' : 'CHECK') + ' @' + s.players[id].name, 'p:' + id, '']))
  } else if (s.phase === 'ended') { if (O.room.isHost()) items.push(['PLAY AGAIN', 'again', 'SAME ROOM']) }
  if (s.phase === 'discuss' || s.phase === 'vote') QUICK.slice(0, 3).forEach((q) => items.push(['SAY "' + q + '"', 'say:' + q, '']))
  items.push(['MY ROLE', 'role', r ? RN[r.role] : '…'], ['LEAVE GAME', 'leave', 'CODE ' + O.room.code])
  ctx.choose('Mafia · ' + s.phase.toUpperCase(), items.slice(0, 9), (v) => {
    if (!O) return
    if (v === 'skip') vote('skip')
    else if (v.startsWith('p:')) { const id = v.slice(2); if (s.phase === 'vote') vote(id); else if (id === O.me.id) { O.sent['n' + s.dayNumber] = id; O.room.sendAction({ type: 'doctor_save', target: id }) } else act(id) }
    else if (v.startsWith('say:')) O.room.sendChat(v.slice(4))
    else if (v === 'role') reveal()
    else if (v === 'again') O.room.setInfo({ round: (O.room.info.round || 0) + 1 })
    else if (v === 'leave') { const back = O.onExit; stopOnline(); back() }
  })
}
export function tick(dt, now) {
  if (!O) return
  const s = O.room.getState()
  if (O.revealP) { posePenguin(ctx, O.revealP, null, dt, false); if (now > O.revealUntil) { ctx.group.remove(O.revealP.group); O.revealP = null } }
  if (!s || s.game !== 'mafia') return
  const ids = Object.keys(O.peng).filter((id) => s.players[id] && s.players[id].alive)
  const look = pointedAt(ctx, { origin: ctx.viewPos(), dir: ctx.viewDir() }, ids, (id) => O.peng[id].pos.clone().add(V(0, 0.7, 0)), () => true, 8)
  const r = myRole(), team = (r && r.team) || []
  const votesFor = {}; for (const v of Object.values(s.votes || {})) votesFor[v] = (votesFor[v] || 0) + 1
  for (const id of Object.keys(O.peng)) {
    const p = O.peng[id], pl = s.players[id]
    posePenguin(ctx, p, null, dt, false)
    if (!pl || !pl.alive || p.shown) continue
    const inv = O.inv.find((x) => x.target === id && x.round === s.round)
    const hot = ids[look] === id
    p.label.set((hot ? '◎ ' : '') + '@' + pl.name + (s.phase === 'vote' && votesFor[id] ? '  ×' + votesFor[id] : '') + (inv ? (inv.isMafia ? ' · MAFIA' : ' · CLEAR') : ''), hot ? '#ffb21e' : team.includes(id) ? '#ff3d52' : inv ? (inv.isMafia ? '#ff3d52' : '#5cf2a0') : '#f2f4f7')
  }
  const until = s.phase === 'night' ? s.nightUntil : s.phase === 'discuss' ? s.discussUntil : s.phase === 'vote' ? s.voteUntil : s.phase === 'countdown' ? s.startsAt : 0
  const left = until ? Math.max(0, Math.ceil((until - O.room.now()) / 1000)) : null
  const titles = { countdown: 'GET READY', night: 'NIGHT ' + s.dayNumber, discuss: 'DAY ' + s.dayNumber + ' · DISCUSS', vote: 'VOTE', ended: 'GAME OVER' }
  const meP = s.players[O.me.id]
  const al = Object.keys(s.players).filter((id) => s.players[id].alive).length
  ctx.line((titles[s.phase] || s.phase.toUpperCase()) + (left != null ? ' · ' + left + 'S' : ''), (meP && !meP.alive ? 'OUT · WATCHING' : r ? RN[r.role] : 'GETTING YOUR ROLE…') + ' · ' + al + ' ALIVE · CODE ' + O.room.code)
}

// ---- referee (copied from the app's MafiaGame host loop)
function hostTick() {
  const room = O.room, s = room.getState(), t = room.now(), roundNo = room.info.round || 0
  if (roundNo > 0 && (!s || s.game !== 'mafia' || s.round !== roundNo)) {
    const next = E.initialState(room.roster, room.info, t)
    O.secret = E.newSecret(roundNo, E.assignRoles(room.roster))
    room.publishState(next)
    for (const id of Object.keys(next.players)) room.notify(id, 'role', E.roleMessage(O.secret, id))
    return
  }
  if (!s || s.phase === 'ended') return
  if (!O.secret || O.secret.round !== s.round) {
    if (O.claims.round !== s.round) O.claims = { round: s.round, roles: {}, since: t }
    if (O.role && O.role.round === s.round) O.claims.roles[O.me.id] = { role: O.role.role, team: O.role.team || null }
    const sec = E.recoverSecret(s, O.claims.roles, room.presentIds())
    if (sec) { O.secret = sec; return }
    if (t - O.claims.since > T.RECOVER_MS) { room.publishState({ ...s, phase: 'ended', winner: null, reason: 'host_left', feed: [{ id: 'void-' + t, text: 'The host left and the roles couldn’t be recovered. This round doesn’t count.', k: 'f_void' }, ...s.feed].slice(0, 20) }); return }
    room.send('whois', { round: s.round })
    return
  }
  const sec = O.secret
  if (s.phase === 'countdown' && t >= s.startsAt) { room.publishState(E.startNight(s, sec, t, { dayNumber: 1 })); return }
  if (s.phase === 'night') {
    if (t >= s.nightUntil) { room.publishState(E.resolveNight(s, sec, t)); return }
    if (s.nightUntil - t > T.NIGHT_GRACE_MS && E.nightComplete(s, sec, room.presentIds())) room.publishState({ ...s, nightUntil: t + T.NIGHT_GRACE_MS })
    return
  }
  if (s.phase === 'discuss' && t >= s.discussUntil) { room.publishState({ ...s, phase: 'vote', voteUntil: t + T.VOTE_MS, votes: {} }); return }
  if (s.phase === 'vote' && (t >= s.voteUntil || E.allVoted(s, room.presentIds()))) room.publishState(E.resolveVote(s, sec, t))
}
function hostAction(action, from) {
  const room = O.room, s = room.getState(), sec = O.secret
  if (!s || s.game !== 'mafia' || !sec || sec.round !== s.round || !action) return
  const t = room.now()
  if (action.type === 'vote') { const next = E.castVote(s, action, from); if (!next) return; room.publishState(E.allVoted(next, room.presentIds()) ? E.resolveVote(next, sec, t) : next); return }
  for (const r of E.nightAction(s, sec, action, from)) room.notify(r.to, r.type, r.data)
}

// ---- ?xrtest: the pretend friends play along (only when the glasses host the test room)
export function testBots(now) {
  if (!O || !ctx.TEST) return
  const room = O.room, s = room.getState(); if (!s || s.game !== 'mafia' || !O.secret) return
  if (O.botAt && now < O.botAt) return
  O.botAt = now + 1500
  const bots = Object.keys(s.players).filter((id) => id !== O.me.id && s.players[id].alive)
  const others = (id) => Object.keys(s.players).filter((x) => x !== id && s.players[x].alive)
  for (const b of bots) {
    const r = O.secret.roles[b], pick = others(b)[Math.floor(Math.random() * others(b).length)]
    if (s.phase === 'night' && r !== 'town' && Math.random() < 0.5) hostAction({ type: r === 'mafia' ? 'mafia_target' : r === 'doctor' ? 'doctor_save' : 'detective_investigate', target: pick }, b)
    if (s.phase === 'vote' && s.votes[b] === undefined && Math.random() < 0.5) hostAction({ type: 'vote', target: Math.random() < 0.2 ? 'skip' : pick }, b)
    if (s.phase === 'discuss' && Math.random() < 0.15) { const p = O.peng[b]; if (p) p.say(['Not me!', "It's @" + s.players[pick].name, 'Hmm…'][Math.floor(Math.random() * 3)], 4000) }
  }
}
