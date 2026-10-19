// iYiYi BESIDE THEM for XR glasses: task consoles stand around your room or yard, a crew of
// penguins in coloured jumpsuits walks between them, one is secretly the imposter (or you are).
// Crew: walk to your tasks (a beam marks the next one): WIRES / NAV = repeat the pad pattern by
// pointing + pinching, FUEL / REACTOR = point at the console and hold a pinch, MEDBAY = stand on
// the scanner. Bodies: point + pinch to REPORT (or press EMERGENCY once). Meetings: the penguins
// talk (witnesses say what they saw), then vote: point + pinch, or SKIP.
// Imposter (you): walk up to a penguin, point at it + pinch to eliminate it (25 s cooldown).
import { makePenguin, posePenguin, pointedAt, beacon, arrowTo, shuffle, ST, hexStr } from './kit.js'

const NAMES = ['PIP', 'WADDLES', 'TUX', 'NOOT', 'FLAPPY', 'ICEY', 'CHILLY', 'SLIDE', 'POPPY', 'BIRDIE', 'FROSTY']
const COLORS = [0x39d5ff, 0x5cf2a0, 0xffb21e, 0xb06cff, 0xff4fa3, 0xff7a1a]
const STATIONS = [['WIRES', 'seq'], ['FUEL', 'fuel'], ['MEDBAY', 'scan'], ['NAV', 'seq'], ['REACTOR', 'fuel']]
let ctx, THREE, S

export default {
  title: 'BESIDE THEM',
  start(c) { ctx = c; THREE = c.THREE; S = { big: false, role: 'random' }; ask() },
  stop() { S = null },
  tick(dt, now) { if (S && S.bots) tick(dt, now) },
  select(ray) { if (S && S.bots) act(ray) },
}
const V = (x, y, z) => new THREE.Vector3(x, y, z)
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
function ask() {
  ctx.choose('Beside Them', [['PLAY BESIDE THEM', 'play', '5 PENGUINS'], ['AREA: ' + (S.big ? 'YARD' : 'ROOM'), 'area', S.big ? 'ABOUT 7 M AROUND YOU' : 'ABOUT 3 M AROUND YOU'], ['ROLE: ' + S.role.toUpperCase(), 'role', 'TAP TO CHANGE']], (v) => {
    if (v === 'area') { S.big = !S.big; ask(); return }
    if (v === 'role') { S.role = S.role === 'random' ? 'crew' : S.role === 'crew' ? 'imposter' : 'random'; ask(); return }
    newGame()
  })
}
function newGame() {
  while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0])
  const v = ctx.viewPos(), d = ctx.flatForward()
  S.start = V(v.x, 0, v.z)
  const near = S.big ? 3 : 1.3, far = S.big ? 7 : 2.8
  const order = shuffle([0, 1, 2, 3, 4])
  S.stations = STATIONS.map(([name, kind], i) => makeStation(name, kind, ctx.floorAt(S.start, d, -150 + order[i] * 72 + (Math.random() - 0.5) * 30, near + Math.random() * (far - near))))
  // emergency button
  S.emergency = new THREE.Group(); const ep = ctx.floorAt(S.start, d, 120, 0.7)
  ctx.part(S.emergency, 0, 0.4, 0, 0.26, 0.8, 0.26, ST.line); ctx.part(S.emergency, 0, 0.84, 0, 0.3, 0.08, 0.3, 0xf2f4f7); ctx.part(S.emergency, 0, 0.9, 0, 0.2, 0.06, 0.2, ST.enemy)
  const el = ctx.label('EMERGENCY', '#ff3d52', 0.5); el.mesh.position.y = 1.15; el.mesh.userData.billboard = true; S.emergency.add(el.mesh)
  S.emergency.position.copy(ep); ctx.group.add(S.emergency); S.emergencyUsed = false
  S.imImp = S.role === 'imposter' || (S.role === 'random' && Math.random() < 1 / 6)
  const impBot = S.imImp ? -1 : Math.floor(Math.random() * 5), names = shuffle(NAMES.slice())
  S.bots = []
  for (let i = 0; i < 5; i++) { const p = makePenguin(ctx, 'crew', COLORS[i], names[i], 0.8); p.pos.copy(ctx.floorAt(S.start, d, -60 + i * 30, 1.2)); S.bots.push({ peng: p, name: names[i], color: COLORS[i], alive: true, imp: i === impBot, goal: null, goalSt: -1, busy: 0, left: 3, saw: -1, hunt: -1 }) }
  S.myAlive = true; S.myTasks = S.imImp ? [] : order.slice(0, 3)
  S.total = S.bots.filter((b) => !b.imp).length * 3 + S.myTasks.length; S.done = 0
  S.killReady = Date.now() + 20000; S.phase = 'play'; S.bodies = []; S.task = null; S.signs = []; S.beacon = null; S.beaconFor = -1
  ctx.toast(S.imImp ? 'YOU ARE THE IMPOSTER' : 'YOU ARE CREW · ONE OF THEM IS THE IMPOSTER', 6000)
  ctx.burst(ctx.viewPos().clone().addScaledVector(d, 1.2), S.imImp ? ST.enemy : ST.friendly, 30, 0.05)
}
function makeStation(name, kind, pos) {
  const g = new THREE.Group()
  ctx.part(g, 0, 0.45, 0, 0.6, 0.9, 0.36, ST.line); ctx.part(g, 0, 0.92, 0.04, 0.64, 0.06, 0.44, 0x9ea4b3)
  ctx.part(g, 0, 0.7, 0.185, 0.46, 0.3, 0.01, ST.friendly); ctx.part(g, 0, 0.02, 0, 0.9, 0.03, 0.7, 0x1f4d66)
  if (kind === 'scan') { ctx.part(g, 0, 0.01, 0.7, 0.7, 0.02, 0.7, ST.health) }
  if (kind === 'fuel') ctx.part(g, 0.42, 0.4, 0, 0.2, 0.7, 0.2, ST.objective)
  const l = ctx.label(name, '#39d5ff', 0.5); l.mesh.position.y = 1.2; l.mesh.userData.billboard = true; g.add(l.mesh)
  g.position.copy(pos); g.lookAt(S.start.x, 0, S.start.z); ctx.group.add(g)
  return { name, kind, pos, g }
}
function sign(text, action, color) {
  const l = ctx.label(text, hexStr(color), 0.5, 520, 120); const v = ctx.viewPos(), f = ctx.flatForward()
  l.mesh.position.copy(v).addScaledVector(f, 1.1).add(V(0, -0.42, 0)); l.mesh.userData.action = action; l.mesh.userData.billboard = true
  ctx.group.add(l.mesh); S.signs.push(l)
}
function clearSigns() { S.signs.forEach((s) => ctx.group.remove(s.mesh)); S.signs = [] }
const camFloor = () => { const v = ctx.viewPos(); return V(v.x, 0, v.z) }
function nearStation() { let best = -1, bd = 1.5; S.stations.forEach((s, i) => { const d = flat(s.pos, camFloor()); if (d < bd) { bd = d; best = i } }); return best }

// ---------------------------------------------------------------- input
function act(ray) {
  const h = ctx.rayHit(ray, S.signs.map((s) => s.mesh))
  if (h) { const a = h.object.userData.action; ctx.beep('tap'); if (a === 'skip') vote(-1); if (a === 'again') newGame(); return }
  if (S.phase === 'vote') { const i = pointedAt(ctx, ray, S.bots, (b) => b.peng.pos.clone().add(V(0, 0.5, 0)), (k) => S.bots[k].alive, 8); if (i >= 0) vote(i); return }
  if (S.phase !== 'play' || !S.myAlive) return
  for (const b of S.bodies) if (flat(b.pos, camFloor()) < 3.2 && pointedAt(ctx, ray, [b], (x) => x.pos.clone().add(V(0, 0.3, 0)), () => true, 14) === 0) { meeting(-1, b); return }
  if (!S.emergencyUsed && flat(S.emergency.position, camFloor()) < 1.6 && pointedAt(ctx, ray, [S.emergency], (x) => x.position.clone().add(V(0, 0.9, 0)), () => true, 14) === 0) { S.emergencyUsed = true; meeting(-1, null); return }
  if (S.imImp) {
    const i = pointedAt(ctx, ray, S.bots, (b) => b.peng.pos.clone().add(V(0, 0.5, 0)), (k) => S.bots[k].alive, 12)
    if (i >= 0 && flat(S.bots[i].peng.pos, camFloor()) < 1.5) { if (Date.now() < S.killReady) { ctx.toast('COOLDOWN ' + Math.ceil((S.killReady - Date.now()) / 1000) + 'S'); return } kill(i, -1); S.killReady = Date.now() + 25000; return }
  }
  if (S.task) { tapTask(ray); return }
  const st = nearStation(); if (st >= 0) beginTask(st)
}
// ---------------------------------------------------------------- tasks
function beginTask(i) {
  const s = S.stations[i]
  if (!S.imImp && !S.myTasks.includes(i)) { ctx.toast(s.name + " ISN'T ONE OF YOUR TASKS"); return }
  S.task = { st: i, kind: s.kind, t: 0, seq: [], step: 0, show: 0, pads: [] }
  if (s.kind === 'seq') {
    for (let k = 0; k < 4; k++) S.task.seq.push(Math.floor(Math.random() * 4))
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(ctx.boxGeo, ctx.mat(dim(ctx.PAL[k]))); m.scale.set(0.14, 0.14, 0.03); m.position.set((k % 2 ? 1 : -1) * 0.16, 1.35 + (k < 2 ? 0.18 : -0.02), 0.25); s.g.add(m); S.task.pads.push(m) }
    ctx.toast('WATCH THE PADS…', 2500)
  } else ctx.toast(s.kind === 'fuel' ? 'POINT AT THE CONSOLE AND HOLD A PINCH' : 'STAND ON THE SCANNER', 3000)
}
function dim(c) { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return ((r * 0.35) << 16) | ((g * 0.35) << 8) | (b * 0.35) }
function endTask() { if (S.task) { S.task.pads.forEach((p) => p.parent && p.parent.remove(p)); S.task = null } }
function lit(k, on) { const m = S.task && S.task.pads[k]; if (m) m.material = ctx.mat(on ? ctx.PAL[k] : dim(ctx.PAL[k])) }
function tapTask(ray) {
  const t = S.task; if (t.kind !== 'seq' || t.show < t.seq.length * 0.7 + 0.3) return
  let best = pointedAt(ctx, ray, t.pads, (m) => { const w = new THREE.Vector3(); m.getWorldPosition(w); return w }, () => true, 7)
  if (best < 0 && ctx.preview) best = t.seq[t.step]
  if (best < 0) return
  lit(best, true); setTimeout(() => S && S.task === t && lit(best, false), 250)
  if (best === t.seq[t.step]) { if (++t.step >= t.seq.length) finishTask() } else { ctx.toast('WRONG PAD · WATCH AGAIN'); t.step = 0; t.show = 0 }
}
function tickTask(dt) {
  const t = S.task, s = S.stations[t.st]
  if (flat(s.pos, camFloor()) > 2.2) { ctx.toast('TASK CANCELLED'); endTask(); return }
  if (t.kind === 'seq') {
    const before = t.show; t.show += dt; const len = t.seq.length * 0.7
    if (before < len + 0.3) { for (let k = 0; k < 4; k++) lit(k, false); if (t.show < len) { const i = Math.floor(t.show / 0.7); if (t.show - i * 0.7 < 0.45) lit(t.seq[i], true) } else if (before < len) ctx.toast('YOUR TURN: POINT + PINCH THE SAME ORDER', 3000) }
    ctx.line(s.name + '  ' + t.step + ' / ' + t.seq.length, 'REPEAT THE PATTERN')
  } else if (t.kind === 'fuel') {
    if ((ctx.holding || ctx.preview && ctx.holding) && ctx.angle(s.pos.clone().add(V(0, 0.6, 0))) < 25 * ctx.D2R) t.t += dt
    if (ctx.preview && ctx.holding) t.t += dt * 0.5
    const k = Math.min(1, t.t / 3.5); ctx.line(s.name + '  [' + '■'.repeat(Math.round(k * 10)) + '□'.repeat(10 - Math.round(k * 10)) + ']', 'POINT AT IT AND HOLD A PINCH')
    if (k >= 1) finishTask()
  } else {
    const pad = new THREE.Vector3(0, 0, 0.7).applyQuaternion(s.g.quaternion).add(s.pos)
    if (flat(pad, camFloor()) < 0.7 || ctx.preview) t.t += dt
    const k = Math.min(1, t.t / 4); ctx.line(s.name + ' SCAN  ' + Math.round(k * 100) + '%', 'STAND ON THE GREEN PAD')
    if (Math.random() < 0.5) { const m = new THREE.Mesh(ctx.boxGeo, ctx.mat(ST.health)); m.scale.setScalar(0.03); m.position.set(pad.x + (Math.random() - 0.5) * 0.5, 0.05, pad.z + (Math.random() - 0.5) * 0.5); ctx.group.add(m); setTimeout(() => ctx.group.remove(m), 1200); const v0 = m.position.y; const t0 = Date.now(); const ev = () => { if (!m.parent) return; m.position.y = v0 + (Date.now() - t0) / 1000 * 1.2; requestAnimationFrame(ev) }; ev() }
    if (k >= 1) finishTask()
  }
}
function finishTask() {
  const t = S.task, s = S.stations[t.st]
  ctx.burst(s.pos.clone().add(V(0, 1, 0)), ST.health, 20, 0.04)
  if (!S.imImp) { S.myTasks = S.myTasks.filter((x) => x !== t.st); S.done++; ctx.toast(s.name + ' DONE!' + (S.myTasks.length ? '' : ' ALL YOUR TASKS ARE DONE'), 3000) } else ctx.toast('FAKED ' + s.name, 2000)
  endTask(); checkWin()
}
// ---------------------------------------------------------------- bots
function tickBots(dt) {
  const now = Date.now(), me = camFloor()
  S.bots.forEach((b, i) => {
    if (!b.alive) return
    let moving = false
    if (S.phase === 'play') {
      if (b.imp && now > S.killReady && b.hunt === -1) b.hunt = pickVictim(i)
      if (b.imp && b.hunt !== -1) {
        const vp = b.hunt === 99 ? me : S.bots[b.hunt] && S.bots[b.hunt].alive ? S.bots[b.hunt].peng.pos : null
        if (!vp) b.hunt = -1
        else { b.goal = vp; if (flat(b.peng.pos, vp) < 0.75) { if (unseen(vp, i, b.hunt)) { kill(b.hunt === 99 ? -2 : b.hunt, i); S.killReady = now + 28000 + Math.random() * 10000 } b.hunt = -1; b.goal = null } }
      }
      if (!b.goal && b.busy <= 0) { b.goalSt = Math.floor(Math.random() * S.stations.length); const s = S.stations[b.goalSt]; b.goal = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0.55).applyQuaternion(s.g.quaternion).add(s.pos) }
      if (b.goal) {
        const to = V(b.goal.x - b.peng.pos.x, 0, b.goal.z - b.peng.pos.z), sp = (S.big ? 0.7 : 0.45) * (b.hunt !== -1 ? 1.4 : 1)
        if (to.length() < 0.08) { if (b.hunt === -1) { b.goal = null; b.busy = 5 + Math.random() * 5 } }
        else { b.peng.pos.addScaledVector(to.normalize(), Math.min(to.length(), sp * dt)); moving = true }
      } else if (b.busy > 0) { b.busy -= dt; if (b.busy <= 0 && !b.imp && b.left > 0 && b.goalSt >= 0) { b.left--; S.done++; checkWin() } }
      for (const body of S.bodies) if (!b.imp && flat(body.pos, b.peng.pos) < 1.1) { meeting(i, body); return }
    }
    const look = moving && b.goal ? b.goal : b.busy > 0 && b.goalSt >= 0 ? S.stations[b.goalSt].pos : null
    posePenguin(ctx, b.peng, look, dt, moving)
  })
}
function pickVictim(imp) {
  const me = camFloor(), crew = S.bots.map((b, k) => k).filter((k) => k !== imp && S.bots[k].alive)
  if (S.myAlive && S.bots.every((b, k) => k === imp || !b.alive || flat(b.peng.pos, me) > 2.5) && Math.random() < 0.3) return 99
  return crew.length ? crew[Math.floor(Math.random() * crew.length)] : -1
}
function unseen(at, imp, victim) {
  if (victim !== 99 && flat(at, camFloor()) < 6.5 && ctx.angle(at.clone().add(V(0, 0.5, 0))) < 40 * ctx.D2R && Math.random() < 0.85) return false
  return S.bots.filter((b, k) => k !== imp && k !== victim && b.alive && flat(b.peng.pos, at) < 2.3).length === 0 || Math.random() < 0.12
}
function kill(victim, killer) {
  if (victim === -2) { S.myAlive = false; ctx.blockPile(camFloor()); ctx.toast('YOU WERE ELIMINATED BY ' + S.bots[killer].name, 8000); endTask(); finish('imposter', 'THE IMPOSTER GOT YOU'); return }
  const v = S.bots[victim]; v.alive = false; v.peng.group.visible = false
  ctx.blockPile(v.peng.pos.clone())
  const mk = ctx.label('!', '#ff3d52', 0.25, 160, 160); mk.mesh.position.copy(v.peng.pos).add(V(0, 0.7, 0)); mk.mesh.userData.billboard = true; ctx.group.add(mk.mesh)
  S.bodies.push({ pos: v.peng.pos.clone(), name: v.name, marker: mk.mesh, who: killer })
  S.lastBodyAt = S.stations.reduce((a, s) => (flat(s.pos, v.peng.pos) < flat(a.pos, v.peng.pos) ? s : a), S.stations[0]).name
  S.bots.forEach((b, k) => { if (b.alive && k !== killer && flat(b.peng.pos, v.peng.pos) < 4) b.saw = killer })
  if (killer >= 0) { if (flat(v.peng.pos, camFloor()) < 6.5 && ctx.angle(v.peng.pos.clone().add(V(0, 0.5, 0))) < 40 * ctx.D2R) ctx.toast('YOU SAW ' + S.bots[killer].name + ' DO IT! REPORT THE BODY', 5000) }
  else { const w = S.bots.findIndex((b) => b.alive && b.saw === -1 && flat(b.peng.pos, v.peng.pos) < 4); if (w >= 0) { S.bots[w].peng.say('I SAW YOU!!', 3000); const body = S.bodies[S.bodies.length - 1]; setTimeout(() => S && S.phase === 'play' && meeting(w, body), 1500) } }
  checkWin()
}
// ---------------------------------------------------------------- meetings
function meeting(reporter, body) {
  if (S.phase !== 'play') return
  endTask(); S.phase = 'meeting'; S.end = Date.now() + 14000
  ctx.toast(body ? (reporter >= 0 ? S.bots[reporter].name : 'YOU') + ' FOUND ' + body.name + "'S BODY!" : 'EMERGENCY MEETING!', 4000)
  const me = camFloor(), d = ctx.flatForward(), al = S.bots.filter((b) => b.alive)
  al.forEach((b, k) => { b.peng.pos.copy(ctx.floorAt(me, d, al.length === 1 ? 0 : -70 + (140 * k) / (al.length - 1), 1.6)); b.goal = null; b.hunt = -1; b.busy = 0 })
  S.bodies.forEach((x) => ctx.group.remove(x.marker)); S.bodies = []
  S.talk = []
  const idx = (b) => S.bots.indexOf(b)
  if (reporter >= 0 && body) S.talk.push([reporter, 'Found ' + body.name + ' near ' + S.lastBodyAt + '!'])
  if (S.imImp) { const w = S.bots.findIndex((b) => b.alive && b.saw === -1); if (w >= 0) S.talk.unshift([w, 'It was YOU! I saw you!']) }
  al.forEach((b) => { if (b.saw >= 0 && S.bots[b.saw] && S.bots[b.saw].alive && !b.imp) S.talk.push([idx(b), 'I SAW ' + S.bots[b.saw].name + ' DO IT!']) })
  al.forEach((b) => {
    if (b.imp) { const o = al.filter((x) => x !== b), t = o[Math.floor(Math.random() * o.length)]; S.talk.push([idx(b), Math.random() < 0.5 && t ? "I think it's " + t.name + '.' : 'I was doing ' + S.stations[Math.floor(Math.random() * 5)].name + '.']) }
    else if (Math.random() < 0.7) S.talk.push([idx(b), ['Where was everyone?', 'I was at ' + S.stations[Math.floor(Math.random() * 5)].name + '.', 'Not me, I was doing tasks!', 'Who was alone?'][Math.floor(Math.random() * 4)]])
  })
  S.talkAt = Date.now() + 800
}
function startVote() {
  S.phase = 'vote'; S.end = Date.now() + 16000; S.votes = S.bots.map(() => 0); S.myVote = S.myAlive ? -9 : -1; S.botVote = S.bots.map(() => -9)
  ctx.toast(S.myAlive ? 'VOTE · POINT AT A PENGUIN + PINCH, OR SKIP' : 'VOTING…', 4000)
  if (S.myAlive) sign('SKIP VOTE', 'skip', 0xa0a6b4)
  S.bots.forEach((b, i) => { if (b.alive) setTimeout(() => S && S.phase === 'vote' && botCast(i), 2000 + Math.random() * 10000) })
}
function botCast(i) {
  if (S.botVote[i] !== -9) return
  const b = S.bots[i], al = S.bots.map((x, k) => k).filter((k) => S.bots[k].alive && k !== i)
  let t = -1
  if (b.saw === -1 && S.imImp) t = -2
  else if (b.saw >= 0 && S.bots[b.saw].alive) t = b.saw
  else if (b.imp) t = al.length ? al[Math.floor(Math.random() * al.length)] : -1
  else { const acc = S.bots.find((x) => x.alive && x.saw >= 0 && !x.imp); if (acc && S.bots[acc.saw].alive) t = acc.saw; else if (Math.random() < 0.35 && al.length) t = al[Math.floor(Math.random() * al.length)] }
  S.botVote[i] = t; if (t >= 0) S.votes[t]++
  b.peng.say(t === -1 ? 'SKIP' : t === -2 ? 'VOTE: YOU' : 'VOTE: ' + S.bots[t].name, 9000)
  if (S.myVote !== -9 && S.bots.every((x, k) => !x.alive || S.botVote[k] !== -9)) S.end = Math.min(S.end, Date.now() + 1500)
}
function vote(i) {
  if (S.phase !== 'vote' || !S.myAlive || S.myVote !== -9) return
  S.myVote = i; if (i >= 0) S.votes[i]++; ctx.toast(i >= 0 ? 'YOU VOTED ' + S.bots[i].name : 'YOU SKIPPED'); clearSigns()
  if (S.bots.every((x, k) => !x.alive || S.botVote[k] !== -9)) S.end = Math.min(S.end, Date.now() + 1500)
}
function resolveVote() {
  clearSigns()
  const youVotes = S.botVote.filter((v) => v === -2).length, skips = S.botVote.filter((v) => v === -1).length + (S.myVote === -1 ? 1 : 0)
  let top = -1, tv = 0, tie = false
  S.votes.forEach((v, i) => { if (v > tv) { tv = v; top = i; tie = false } else if (v === tv && v > 0) tie = true })
  if (youVotes > tv && youVotes > skips) { S.myAlive = false; ctx.toast('YOU WERE VOTED OUT · YOU WERE THE IMPOSTER', 6000); ctx.blockPile(camFloor()); finish('crew', 'THE CREW CAUGHT YOU'); return }
  if (top < 0 || tie || skips >= tv) { ctx.toast(tie ? 'TIE · NOBODY WAS EJECTED' : 'SKIPPED · NOBODY WAS EJECTED', 4000); resume(); return }
  const b = S.bots[top]; b.alive = false; S.phase = 'eject'; S.end = Date.now() + 4500
  ctx.toast(b.name + (b.imp ? ' WAS THE IMPOSTER!' : ' WAS NOT THE IMPOSTER'), 5000)
  const g = b.peng.group, y0 = Date.now()
  S.eject = () => { const t = (Date.now() - y0) / 1000; g.position.y = t * 1.6; g.rotation.y += 0.15; if (t > 2.2 && g.visible) { g.visible = false; ctx.burst(g.position.clone().add(V(0, 0.5, 0)), b.color, 40, 0.1) } }
}
function resume() { S.phase = 'play'; S.eject = null; S.bots.forEach((b) => b.alive && b.peng.label.set(b.name)); S.bots.forEach((b) => { if (!b.imp && !(b.saw === -1 && S.imImp)) b.saw = -3 }); if (!checkWin()) S.killReady = Math.max(S.killReady, Date.now() + 15000) }
function checkWin() {
  if (S.phase === 'end') return true
  const crew = S.bots.filter((b) => b.alive && !b.imp).length + (S.myAlive && !S.imImp ? 1 : 0)
  const imps = S.bots.filter((b) => b.alive && b.imp).length + (S.myAlive && S.imImp ? 1 : 0)
  if (imps === 0) { finish('crew', 'THE IMPOSTER IS GONE'); return true }
  if (imps >= crew) { finish('imposter', 'TOO FEW CREW LEFT'); return true }
  if (S.done >= S.total) { finish('crew', 'ALL TASKS DONE'); return true }
  return false
}
function finish(winner, why) {
  S.phase = 'end'; endTask()
  const win = (winner === 'imposter') === S.imImp
  ctx.toast((winner === 'crew' ? 'CREW WINS' : 'IMPOSTER WINS') + ' · ' + why + (win ? ' · YOU WIN' : ' · YOU LOSE'), 20000)
  S.bots.forEach((b) => { if (b.alive && b.imp) b.peng.label.set(b.name + ' · IMPOSTER', '#ff3d52') })
  for (let k = 0; k < 4; k++) ctx.burst(ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 2).add(V((k - 1.5) * 0.6, 0.4, 0)), winner === 'crew' ? ST.friendly : ST.enemy, 24, 0.06)
  sign('PLAY AGAIN', 'again', ST.objective)
}
// ---------------------------------------------------------------- per frame
function tick(dt, now) {
  tickBots(dt)
  if (S.eject) S.eject()
  // beacon over your next task
  let next = -1
  if (S.phase === 'play' && S.myAlive && !S.imImp && S.myTasks.length) { let bd = 1e9; for (const i of S.myTasks) { const d = flat(S.stations[i].pos, camFloor()); if (d < bd) { bd = d; next = i } } }
  if (next !== S.beaconFor) { if (S.beacon) ctx.group.remove(S.beacon); S.beacon = next >= 0 ? beacon(ctx, S.stations[next].pos, ST.objective, 'TASK') : null; S.beaconFor = next }
  const pct = Math.round(100 * S.done / Math.max(1, S.total)), role = S.imImp ? 'IMPOSTER' : 'CREW'
  if (S.phase === 'play') {
    if (S.task) tickTask(dt)
    else {
      let l = 'TASKS ' + pct + '%'
      if (S.imImp) l += '   KILL ' + (now >= S.killReady ? 'READY' : Math.ceil((S.killReady - now) / 1000) + 'S')
      else if (next >= 0) l += '   NEXT: ' + S.stations[next].name + ' ' + arrowTo(ctx, S.stations[next].pos)
      const ns = nearStation()
      const hint = S.bodies.some((b) => flat(b.pos, camFloor()) < 3.2) ? 'POINT AT THE BODY + PINCH TO REPORT' : ns >= 0 && (S.imImp || S.myTasks.includes(ns)) ? 'PINCH TO START ' + S.stations[ns].name : role + (S.myAlive ? '' : ' · OUT')
      ctx.line(l, hint)
    }
  } else if (S.phase === 'meeting') {
    ctx.line('MEETING · DISCUSS  ' + Math.max(0, Math.ceil((S.end - now) / 1000)) + 'S', role)
    if (now > S.talkAt && S.talk.length) { const [i, s] = S.talk.shift(); if (S.bots[i] && S.bots[i].alive) S.bots[i].peng.say(s, 4000); S.talkAt = now + 2200 }
    if (now > S.end) startVote()
  } else if (S.phase === 'vote') {
    const look = pointedAt(ctx, { origin: ctx.viewPos(), dir: ctx.viewDir() }, S.bots, (b) => b.peng.pos.clone().add(V(0, 0.5, 0)), (k) => S.bots[k].alive, 8)
    S.bots.forEach((b, i) => { if (b.alive) b.peng.label.set((i === look ? '◎ ' : '') + b.name + (S.votes[i] ? '  ×' + S.votes[i] : ''), i === look ? '#ffb21e' : '#f2f4f7') })
    ctx.line('VOTE  ' + Math.max(0, Math.ceil((S.end - now) / 1000)) + 'S', role)
    if (now > S.end) { S.bots.forEach((b, i) => { if (b.alive && S.botVote[i] === -9) botCast(i) }); if (S.myVote === -9) S.myVote = -1; resolveVote() }
  } else if (S.phase === 'eject') { if (now > S.end) resume() }
  else if (S.phase === 'end') ctx.line('GAME OVER', role)
}
