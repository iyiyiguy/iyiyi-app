// iYiYi MAFIA for XR glasses: the app's penguin town stands in a half circle in your room. You get a
// secret role (Town, Mafia, Doctor, Detective). Night: point at a penguin + pinch to pick (Mafia:
// who goes, Doctor: who to save, Detective: who to check). Day: the penguins argue in speech
// bubbles; point + pinch to accuse. Vote: point + pinch, or SKIP. Same rules as the app's Mafia.
import { makePenguin, posePenguin, pointedAt, shuffle, ST, hexStr } from './kit.js'

const NAMES = ['PIP', 'WADDLES', 'TUX', 'NOOT', 'FLAPPY', 'ICEY', 'CHILLY', 'SLIDE', 'POPPY', 'BIRDIE', 'FROSTY']
const RN = { town: 'TOWNSPERSON', mafia: 'MAFIA', doctor: 'DOCTOR', detective: 'DETECTIVE' }
const OUT = { town: 'vest', mafia: 'mafia', doctor: 'doctor', detective: 'detective' }
const RC = { town: ST.friendly, mafia: ST.enemy, doctor: ST.health, detective: ST.objective }
const COLORS = [0xff4fa3, 0x39d5ff, 0xffb21e, 0x5cf2a0, 0xb06cff, 0xff7a1a]
let ctx, THREE, S

export default {
  title: 'MAFIA',
  start(c) { ctx = c; THREE = c.THREE; S = { count: 8, big: false }; ask() },
  stop() { if (S) clearTimeout(S.timer); S = null },
  tick(dt, now) { if (S && S.pl) tick(dt, now) },
  select(ray) { if (S && S.pl) select(ray) },
}
const V = (x, y, z) => new THREE.Vector3(x, y, z)
function ask() {
  ctx.choose('Mafia', [['PLAY MAFIA', 'play', S.count + ' PLAYERS'], ['PLAYERS: ' + S.count, 'count', 'TAP TO CHANGE'], ['CIRCLE: ' + (S.big ? 'BIG ROOM' : 'SMALL ROOM'), 'circle', 'TAP TO CHANGE']], (v) => {
    if (v === 'count') { S.count = S.count === 6 ? 8 : S.count === 8 ? 10 : 6; ask(); return }
    if (v === 'circle') { S.big = !S.big; ask(); return }
    newGame()
  })
}
function newGame() {
  while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0])
  const n = S.count, mafiaN = n <= 6 ? 1 : n <= 9 ? 2 : 3
  const roles = []; for (let i = 0; i < mafiaN; i++) roles.push('mafia'); roles.push('doctor', 'detective'); while (roles.length < n) roles.push('town'); shuffle(roles)
  const names = shuffle(NAMES.slice()), v = ctx.viewPos(), d = ctx.flatForward(), R = S.big ? 4 : 2.9
  S.center = V(v.x, 0, v.z); S.winner = ''; S.day = 0; S.lastSaved = S.cpuLastSaved = -1; S.signs = []
  S.pl = []
  for (let i = 0; i < n; i++) {
    const sus = []; for (let j = 0; j < n; j++) sus.push(j === i ? -99 : Math.random() * 0.6)
    const p = { name: i === 0 ? 'YOU' : names[i - 1], role: roles[i], alive: true, peng: null, sus, color: COLORS[i % 6], checked: {}, claimed: false, vote: -1 }
    if (i > 0) { const ang = -100 + (200 * (i - 1)) / Math.max(1, n - 2); p.peng = makePenguin(ctx, 'vest', p.color, p.name, 1.05); p.peng.pos.copy(ctx.floorAt(S.center, d, ang, R)) }
    S.pl.push(p)
  }
  for (let i = 1; i < n; i++) if (S.pl[i].role === 'mafia') for (let j = 0; j < n; j++) if (S.pl[j].role === 'mafia' && j !== i) S.pl[i].sus[j] = -50
  phase('reveal')
}
const me = () => S.pl[0]
const alive = () => S.pl.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0)
const mafiaAlive = () => S.pl.filter((p) => p.alive && p.role === 'mafia').length
const townAlive = () => S.pl.filter((p) => p.alive && p.role !== 'mafia').length

function sign(text, action, color) {
  const l = ctx.label(text, hexStr(color), 0.45, 520, 120)
  const v = ctx.viewPos(), f = ctx.flatForward()
  l.mesh.position.copy(v).addScaledVector(f, 1.1).add(V(0, -0.42, 0)).addScaledVector(ctx.right(f), 0.5 * S.signs.length - 0.25 * (S.signs.length ? 0 : 0))
  l.mesh.userData.action = action; l.mesh.userData.billboard = true
  ctx.group.add(l.mesh); S.signs.push(l)
}
function clearSigns() { S.signs.forEach((s) => ctx.group.remove(s.mesh)); S.signs = [] }
function makeSky(on) {
  if (S.sky) { ctx.group.remove(S.sky); S.sky = null }
  if (!on) return
  S.sky = new THREE.Group(); ctx.group.add(S.sky)
  const v = ctx.viewPos(), f = ctx.flatForward()
  const moon = v.clone().addScaledVector(f, 6).add(V(0, 3.8, 0)).addScaledVector(ctx.right(f), 1.8)
  ctx.box(moon, V(0.7, 0.7, 0.7), 0xf2eeff, S.sky); ctx.box(moon.clone().add(V(-0.14, 0.1, 0.3)), V(0.14, 0.14, 0.14), ST.night, S.sky)
  for (let i = 0; i < 80; i++) { const dir = f.clone().applyAxisAngle(V(0, 1, 0), (Math.random() - 0.5) * 3.8); const p = v.clone().addScaledVector(dir, 5 + Math.random() * 3).add(V(0, 1.8 + Math.random() * 4, 0)); const s = 0.02 + Math.random() * 0.04; ctx.box(p, V(s, s, s), i % 5 ? 0xffffff : ST.night, S.sky) }
}
function phase(ph) {
  S.phase = ph; clearSigns()
  const now = Date.now(), m = me()
  if (ph === 'reveal') {
    S.end = now + 7000
    const f = ctx.flatForward(), at = ctx.floorAt(ctx.viewPos(), f, 0, 2.3)
    S.reveal = makePenguin(ctx, OUT[m.role], ST.friendly, RN[m.role], 1); S.reveal.pos.copy(at); S.reveal.label.set(RN[m.role], hexStr(RC[m.role]))
    ctx.burst(at.clone().add(V(0, 0.8, 0)), RC[m.role], 30, 0.05)
    const mates = S.pl.filter((p, i) => i > 0 && p.role === 'mafia').map((p) => p.name)
    ctx.toast(m.role === 'mafia' && mates.length ? 'YOU ARE THE MAFIA · PARTNER: ' + mates.join(', ') : 'YOU ARE THE ' + RN[m.role], 7000)
  } else if (ph === 'night') {
    S.day++; S.end = now + (m.alive && m.role !== 'town' ? 30000 : 7000); S.myPick = -1; makeSky(true)
    if (m.alive) ctx.toast(m.role === 'mafia' ? 'PICK WHO TO ELIMINATE' : m.role === 'doctor' ? 'PICK WHO TO SAVE' : m.role === 'detective' ? 'PICK WHO TO INVESTIGATE' : 'THE TOWN SLEEPS…', 5000)
    S.pl.forEach((p) => p.peng && p.alive && p.peng.say('z z z', 6000))
    if (m.alive && m.role === 'doctor' && S.lastSaved !== 0) sign('SAVE MYSELF', 'self', ST.health)
  } else if (ph === 'dawn') { S.end = now + 6500; makeSky(false); resolveNight() }
  else if (ph === 'day') { S.end = now + 30000; S.talkAt = now + 1200; if (m.alive) { ctx.toast('DISCUSS · POINT AT A PENGUIN + PINCH TO ACCUSE', 4500); sign('VOTE NOW', 'votenow', ST.objective) } }
  else if (ph === 'vote') {
    S.end = now + 20000; S.votes = S.pl.map(() => 0); S.pl.forEach((p) => (p.vote = -1))
    if (m.alive) { ctx.toast('VOTE · POINT + PINCH, OR SKIP', 4500); sign('SKIP', 'skip', 0xa0a6b4) }
    S.pl.forEach((p, i) => { if (i > 0 && p.alive) setTimeout(() => { if (S && S.phase === 'vote' && p.alive && p.vote === -1) castVote(i, cpuVote(i)) }, 2000 + Math.random() * 12000) })
  } else if (ph === 'verdict') { S.end = now + 7000; resolveVote() }
  else if (ph === 'end') { S.end = now + 1e9; sign('PLAY AGAIN', 'again', ST.objective) }
}
function select(ray) {
  const h = ctx.rayHit(ray, S.signs.map((s) => s.mesh))
  if (h) { const a = h.object.userData.action; ctx.beep('tap'); if (a === 'skip') pickSkip(); if (a === 'self') pickTarget(0); if (a === 'votenow' && S.phase === 'day') phase('vote'); if (a === 'again') newGame(); return }
  if (S.phase === 'reveal') { S.end = Date.now(); return }
  const i = pointedAt(ctx, ray, S.pl, (p) => (p.peng ? p.peng.pos.clone().add(V(0, 0.7, 0)) : V(0, -99, 0)), (k) => k > 0 && S.pl[k].alive, 8)
  if (i > 0) pickTarget(i)
}
function pickTarget(i) {
  const m = me(); if (!m.alive) { ctx.toast("YOU'RE OUT · WATCHING"); return }
  const t = S.pl[i]
  if (S.phase === 'night') {
    if (m.role === 'town' || S.myPick >= 0) return
    if (m.role === 'mafia' && (i === 0 || t.role === 'mafia')) { if (i) ctx.toast("THAT'S YOUR PARTNER"); return }
    if (m.role === 'doctor' && i === S.lastSaved) { ctx.toast("CAN'T SAVE THE SAME PLAYER TWICE IN A ROW"); return }
    S.myPick = i; ctx.beep('tap')
    if (m.role === 'detective') { const isM = t.role === 'mafia'; m.checked[i] = isM ? 'mafia' : 'clear'; ctx.toast(t.name + (isM ? ' IS THE MAFIA!' : ' IS NOT THE MAFIA'), 6000); ctx.burst(t.peng.pos.clone().add(V(0, 0.7, 0)), isM ? ST.enemy : ST.health, 18, 0.05) }
    else ctx.toast((m.role === 'mafia' ? 'TARGET: ' : 'SAVING: ') + (i === 0 ? 'YOURSELF' : t.name), 3000)
    S.end = Math.min(S.end, Date.now() + 3500); return
  }
  if (S.phase === 'day' && i > 0) {
    ctx.toast('YOU ACCUSE ' + t.name, 2500)
    S.pl.forEach((p, k) => { if (k > 0 && k !== i && p.alive && p.role !== 'mafia') p.sus[i] += 0.7 }); t.sus[0] += 1
    t.peng.say(['Me?! No way!', 'Why me?? I was asleep!', 'Look at YOU being sus.'][Math.floor(Math.random() * 3)])
    return
  }
  if (S.phase === 'vote' && i > 0) { if (m.vote !== -1) { ctx.toast('YOU ALREADY VOTED'); return } castVote(0, i); ctx.toast('YOU VOTED ' + t.name) }
}
function pickSkip() { if (S.phase === 'vote' && me().alive && me().vote === -1) { castVote(0, -2); ctx.toast('YOU SKIPPED') } }
function castVote(i, target) {
  const p = S.pl[i]; p.vote = target; if (target >= 0) S.votes[target]++
  if (p.peng) p.peng.say(target === -2 ? 'I SKIP' : 'VOTE: ' + S.pl[target].name, 8000)
  if (S.pl.every((q) => !q.alive || q.vote !== -1)) S.end = Math.min(S.end, Date.now() + 1500)
}
function cpuNight() {
  const al = alive(), m = me()
  const cpuMafia = S.pl.some((p, k) => k > 0 && p.alive && p.role === 'mafia')
  if (m.alive && m.role === 'mafia' && S.myPick > 0) S.kill = S.myPick
  else if (cpuMafia) {
    let best = -1, bs = -1e9
    for (const i of al.filter((i) => S.pl[i].role !== 'mafia')) { const p = S.pl[i]; let s = Math.random() * 0.8 + (p.claimed ? 5 : 0); S.pl.forEach((q, k) => { if (q.role === 'mafia' && q.alive) s += p.sus[k] }); if (s > bs) { bs = s; best = i } }
    S.kill = best
  } else S.kill = -1
  const doc = S.pl.findIndex((p) => p.role === 'doctor'); S.save = -1
  if (doc === 0 && m.alive) { S.save = S.myPick; S.lastSaved = S.myPick }
  else if (doc > 0 && S.pl[doc].alive) { let s = Math.random() < 0.35 ? doc : al[Math.floor(Math.random() * al.length)]; if (s === S.cpuLastSaved) s = doc !== S.cpuLastSaved ? doc : al[0]; S.save = s; S.cpuLastSaved = s }
  const det = S.pl.findIndex((p) => p.role === 'detective')
  if (det > 0 && S.pl[det].alive) { const o = al.filter((i) => i !== det && S.pl[det].checked[i] === undefined); if (o.length) { const t = o[Math.floor(Math.random() * o.length)]; S.pl[det].checked[t] = S.pl[t].role === 'mafia' ? 'mafia' : 'clear' } }
}
function resolveNight() {
  cpuNight()
  const k = S.kill
  if (k >= 0 && k === S.save) { ctx.toast('THE DOCTOR SAVED SOMEONE LAST NIGHT!', 6000); return }
  if (k < 0) { ctx.toast('A QUIET NIGHT. NOBODY WENT DOWN.', 5000); return }
  eliminate(k, (k === 0 ? 'YOU WERE ELIMINATED' : S.pl[k].name + ' WAS ELIMINATED') + ' · ' + RN[S.pl[k].role])
}
function eliminate(i, msg) {
  const p = S.pl[i]; p.alive = false; ctx.toast(msg, 6500)
  if (p.peng) {
    const pg = p.peng; pg.dress(OUT[p.role], p.color); pg.label.set(p.name + ' · ' + RN[p.role], hexStr(RC[p.role]))
    setTimeout(() => { if (!S) return; ctx.blockPile(pg.pos.clone()); pg.group.visible = false }, 2600)
  } else ctx.blockPile(ctx.floorAt(ctx.viewPos(), ctx.flatForward(), 0, 0.7))
}
function cpuTalk() {
  const sp = alive().filter((i) => i > 0); if (!sp.length) return
  const i = sp[Math.floor(Math.random() * sp.length)], p = S.pl[i], others = alive().filter((j) => j !== i)
  if (p.role === 'detective' && !p.claimed) {
    const found = Object.keys(p.checked).map(Number).find((x) => p.checked[x] === 'mafia' && S.pl[x].alive)
    if (found !== undefined && Math.random() < 0.8) { p.claimed = true; p.peng.say("I'm the Detective. " + S.pl[found].name + ' is MAFIA!', 5000); S.pl.forEach((q, k) => { if (k > 0 && q.role !== 'mafia') q.sus[found] += 3 }); return }
  }
  let tgt = -1, ts = -1e9
  for (const j of others) { const s = p.role === 'mafia' ? (S.pl[j].role === 'mafia' ? -99 : p.sus[j] + (S.pl[j].claimed ? 2 : 0)) : p.sus[j]; if (s > ts) { ts = s; tgt = j } }
  if (tgt < 0) return
  if (S.pl.some((q, k) => k !== i && q.alive && q.sus[i] > 1.2) && Math.random() < 0.4) { p.peng.say(["It's NOT me, I swear!", "I'm just a penguin!", 'Why is everyone looking at me?'][Math.floor(Math.random() * 3)]); S.pl.forEach((q) => (q.sus[i] -= 0.1)); return }
  const nm = tgt === 0 ? 'YOU' : S.pl[tgt].name
  p.peng.say([nm + ' is acting sus.', "I don't trust " + nm + '.', 'Where was ' + nm + ' last night?', "I think it's " + nm + '.', nm + ' is too quiet…'][Math.floor(Math.random() * 5)])
  S.pl.forEach((q, k) => { if (k > 0 && k !== i && q.alive && q.role !== 'mafia') q.sus[tgt] += 0.25 + Math.random() * 0.2 })
  if (tgt > 0) S.pl[tgt].sus[i] += 0.4
}
function cpuVote(i) {
  const p = S.pl[i], others = alive().filter((j) => j !== i)
  if (p.role === 'mafia') { let best = -2, bs = -1e9; for (const j of others) { if (S.pl[j].role === 'mafia') continue; let s = S.votes[j] * 0.8 + (S.pl[j].claimed ? 3 : 0); S.pl.forEach((q, k) => { if (k > 0 && q.alive && q.role !== 'mafia') s += q.sus[j] * 0.3 }); if (s > bs) { bs = s; best = j } } return best }
  let best = -2, bs = 0.55 + Math.random() * 0.4
  for (const j of others) { const s = p.sus[j] + S.votes[j] * 0.25; if (s > bs) { bs = s; best = j } }
  return best
}
function resolveVote() {
  const skips = S.pl.filter((p) => p.alive && p.vote === -2).length
  let top = -1, tv = 0, tie = false
  S.votes.forEach((v, i) => { if (v > tv) { tv = v; top = i; tie = false } else if (v === tv && v > 0) tie = true })
  if (top < 0 || tie || skips >= tv) { ctx.toast(tie ? 'A TIE. NOBODY IS VOTED OUT.' : 'SKIPPED. NOBODY IS VOTED OUT.', 6000); return }
  eliminate(top, (top === 0 ? 'YOU WERE VOTED OUT' : S.pl[top].name + ' WAS VOTED OUT') + ' · ' + RN[S.pl[top].role])
}
function checkWin() {
  if (mafiaAlive() === 0) S.winner = 'town'; else if (mafiaAlive() >= townAlive()) S.winner = 'mafia'
  if (!S.winner) return false
  const win = (S.winner === 'mafia') === (me().role === 'mafia')
  ctx.toast((S.winner === 'town' ? 'TOWN WINS!' : 'THE MAFIA WINS!') + (win ? '  YOU WIN' : '  YOU LOSE'), 15000)
  S.pl.forEach((p) => { if (p.peng && p.alive) { p.peng.dress(OUT[p.role], p.color); p.peng.label.set(p.name + ' · ' + RN[p.role], hexStr(RC[p.role])) } })
  for (let k = 0; k < 4; k++) ctx.burst(ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 2).add(V((k - 1.5) * 0.6, 0.4, 0)), S.winner === 'town' ? ST.friendly : ST.enemy, 24, 0.06)
  phase('end'); return true
}
function tick(dt, now) {
  const look = pointedAt(ctx, { origin: ctx.viewPos(), dir: ctx.viewDir() }, S.pl, (p) => (p.peng ? p.peng.pos.clone().add(V(0, 0.7, 0)) : V(0, -99, 0)), (k) => k > 0 && S.pl[k].alive, 8)
  S.pl.forEach((p, i) => {
    if (!p.peng) return
    posePenguin(ctx, p.peng, null, dt, false)
    if (!p.alive || S.phase === 'end') return
    const partner = me().role === 'mafia' && p.role === 'mafia'
    p.peng.label.set((i === look ? '◎ ' : '') + p.name + (S.phase === 'vote' && S.votes[i] ? '  ×' + S.votes[i] : ''), i === look ? '#ffb21e' : partner ? '#ff3d52' : '#f2f4f7')
  })
  if (S.reveal) posePenguin(ctx, S.reveal, null, dt, false)
  const left = Math.max(0, Math.ceil((S.end - now) / 1000))
  const titles = { reveal: 'YOUR ROLE', night: 'NIGHT ' + S.day, dawn: 'MORNING', day: 'DAY ' + S.day, vote: 'VOTE', verdict: 'VERDICT', end: 'GAME OVER' }
  ctx.line((titles[S.phase] || '') + (['reveal', 'night', 'day', 'vote'].includes(S.phase) ? ' · ' + left + 'S' : ''), (me().alive ? RN[me().role] : 'OUT · WATCHING') + ' · ' + mafiaAlive() + ' MAFIA · ' + townAlive() + ' TOWN')
  if (S.phase === 'day' && now > S.talkAt) { cpuTalk(); S.talkAt = now + 2600 + Math.random() * 1800 }
  if (now < S.end) return
  if (S.phase === 'reveal') { ctx.group.remove(S.reveal.group); S.reveal = null; phase('night') }
  else if (S.phase === 'night') phase('dawn')
  else if (S.phase === 'dawn') { if (!checkWin()) phase('day') }
  else if (S.phase === 'day') phase('vote')
  else if (S.phase === 'vote') phase('verdict')
  else if (S.phase === 'verdict') { if (!checkWin()) phase('night') }
}
