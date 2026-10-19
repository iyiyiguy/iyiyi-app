// iYiYi WE OUTSIDE (missions + cops & robbers) for XR glasses: GTA-style jobs in your room, yard or park with the laser tag guns.
// Places (bank, store, stash, drop-off, getaway car) stand around you; a beam marks where to go.
//   MISSIONS: deliver a package (point + pinch to grab it, walk it to the drop-off), take out a crew,
//   hold a spot for 30 s, beat the boss. Thugs fire slow red bolts: step out of the way.
//   COPS & ROBBERS: ROBBER: crack the bank vault (point at it, hold a pinch), carry the loot to the
//   getaway car while cops chase you. COP: dispatch calls a heist; tag the robbers before they
//   reach their car.
// Pinch to shoot where you point. Cash is saved in this browser.
import { beacon, arrowTo, ST, hexStr } from './kit.js'

const WEAPONS = [
  { id: 'pistol', name: 'LASER PISTOL', color: 0x33e6ff, gap: 260, speed: 32, damage: 1 },
  { id: 'rifle', name: 'PULSE RIFLE', color: 0xff4da6, gap: 140, speed: 38, damage: 1 },
  { id: 'shotgun', name: 'BLASTER', color: 0xffd133, gap: 700, speed: 30, pellets: 5, damage: 2 },
]
const CASH_KEY = 'iyx_missions_cash'
let ctx, THREE, S
export default {
  title: 'WE OUTSIDE',
  start(c) { ctx = c; THREE = c.THREE; S = { area: 1, cash: Number(localStorage.getItem(CASH_KEY) || 0), w: 0 }; ask() },
  stop() { S = null },
  tick(dt, now) { if (S && S.places) tick(dt, now) },
  select(ray) { if (S && S.places) act(ray) },
  release() {},
}
const V = (x, y, z) => new THREE.Vector3(x, y, z)
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const camFloor = () => { const v = ctx.viewPos(); return V(v.x, 0, v.z) }
const K = () => [1, 2.6, 6][S.area]
function ask() {
  ctx.choose('We Outside', [['MISSIONS', 'missions', 'JOBS FOR CASH'], ['COPS & ROBBERS: ROBBER', 'robber', 'ROB THE BANK'], ['COPS & ROBBERS: COP', 'cop', 'STOP THE HEISTS'], ['AREA: ' + ['ROOM', 'YARD', 'PARK'][S.area], 'area', ['ABOUT 3 M', 'ABOUT 8 M', 'UP TO 20 M'][S.area]], ['WEAPON: ' + WEAPONS[S.w].name, 'weapon', 'TAP TO CHANGE']], (v) => {
    if (v === 'area') { S.area = (S.area + 1) % 3; ask(); return }
    if (v === 'weapon') { S.w = (S.w + 1) % 3; ask(); return }
    newGame(v)
  })
}
function newGame(mode) {
  while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0])
  S.mode = mode; S.hp = 5; S.earned = 0; S.jobN = 0; S.npcs = []; S.shots = []; S.places = {}; S.carry = null; S.pkg = null; S.ring = null; S.beacon = null; S.beaconAt = null; S.signs = []
  S.start = camFloor(); const d = ctx.flatForward()
  const spot = (id, name, ang, min, max, color, build) => {
    const pos = ctx.floorAt(S.start, d, ang + (Math.random() - 0.5) * 30, (min + Math.random() * (max - min)) * K())
    const g = new THREE.Group(); build(g)
    const l = ctx.label(name, hexStr(color), 0.6); l.mesh.position.y = 1.5; l.mesh.userData.billboard = true; g.add(l.mesh)
    g.position.copy(pos); g.lookAt(S.start.x, 0, S.start.z); ctx.group.add(g)
    S.places[id] = { id, name, pos, g }
  }
  spot('bank', 'BANK', -40, 1.8, 3, ST.objective, (g) => { ctx.part(g, 0, 0.5, 0, 0.8, 1, 0.4, 0xc9a227); ctx.part(g, 0, 0.55, 0.205, 0.5, 0.5, 0.01, 0xf2f4f7); ctx.part(g, 0, 0.55, 0.215, 0.12, 0.12, 0.02, ST.objective); ctx.part(g, 0, 1.05, 0, 1, 0.1, 0.5, 0x9ea4b3) })
  spot('getaway', 'GETAWAY', 140, 2, 3.2, ST.objective, (g) => car(g, 0xffb21e, false))
  spot('store', 'STORE', 60, 1.5, 2.8, ST.health, (g) => { ctx.part(g, 0, 0.45, 0, 0.9, 0.9, 0.5, ST.line); ctx.part(g, 0, 0.95, 0, 1, 0.12, 0.6, ST.health); ctx.part(g, 0, 0.5, 0.255, 0.6, 0.4, 0.01, ST.friendly) })
  spot('stash', 'STASH', -110, 1.2, 2.6, ST.epic, (g) => { ctx.part(g, 0, 0.2, 0, 0.7, 0.4, 0.5, ST.epic); ctx.part(g, 0, 0.42, 0, 0.74, 0.04, 0.54, 0x9ea4b3) })
  spot('drop', 'DROP-OFF', 100, 1.6, 3, ST.health, (g) => { ctx.part(g, 0, 0.01, 0, 1.6, 0.02, 1.6, 0x1a6640) })
  S.gun = gunModel(); ctx.group.add(S.gun)
  if (mode === 'missions') nextJob(); else if (mode === 'robber') startHeist(); else { S.job = 'patrol'; S.dispatchAt = Date.now() + 5000; ctx.toast('COP ON PATROL · WAIT FOR DISPATCH', 4000) }
}
function car(g, color, cop) {
  ctx.part(g, 0, 0.35, 0, 0.9, 0.4, 1.9, cop ? 0xf2f4f7 : color); ctx.part(g, 0, 0.7, -0.1, 0.8, 0.34, 1, cop ? ST.armor : color)
  ctx.part(g, 0, 0.72, 0.405, 0.7, 0.26, 0.01, 0xbfe9ff)
  for (const x of [-0.46, 0.46]) for (const z of [-0.6, 0.6]) ctx.part(g, x, 0.16, z, 0.1, 0.32, 0.32, ST.line)
  ctx.part(g, -0.3, 0.38, 0.955, 0.16, 0.1, 0.01, 0xffffff); ctx.part(g, 0.3, 0.38, 0.955, 0.16, 0.1, 0.01, 0xffffff)
}
function gunModel() {
  const w = WEAPONS[S.w], g = new THREE.Group(), dark = 0x262b38
  if (w.id === 'shotgun') { ctx.part(g, 0, 0.02, -0.06, 0.06, 0.06, 0.2, w.color); ctx.part(g, 0, 0.02, -0.18, 0.07, 0.07, 0.06, dark); ctx.part(g, 0, -0.04, 0, 0.035, 0.08, 0.035, dark) }
  else if (w.id === 'rifle') { ctx.part(g, 0, 0.02, -0.06, 0.04, 0.06, 0.22, w.color); ctx.part(g, 0, 0.025, -0.19, 0.02, 0.02, 0.1, dark); ctx.part(g, 0, -0.04, 0, 0.03, 0.08, 0.03, dark) }
  else { ctx.part(g, 0, 0.02, -0.04, 0.04, 0.06, 0.14, w.color); ctx.part(g, 0, 0.025, -0.12, 0.02, 0.02, 0.05, dark); ctx.part(g, 0, -0.04, 0, 0.035, 0.08, 0.035, dark) }
  return g
}
function npc(kind, pos, hp) {
  const g = new THREE.Group(), s = kind === 'boss' ? 1.35 : 1
  const P = (x, y, z, sx, sy, sz, c) => ctx.part(g, x * s, y * s, z * s, sx * s, sy * s, sz * s, c)
  const col = kind === 'cop' ? 0x3b6dff : kind === 'robber' ? 0xf2f4f7 : kind === 'boss' ? ST.epic : 0xff7a1a
  const legs = kind === 'cop' ? 0x2a3f8f : ST.line
  P(0, 1.65, 0, 0.3, 0.3, 0.3, 0xffdbb3); P(-0.07, 1.7, 0.155, 0.05, 0.05, 0.01, 0x1a1a1a); P(0.07, 1.7, 0.155, 0.05, 0.05, 0.01, 0x1a1a1a)
  P(0, 1.15, 0, 0.4, 0.55, 0.24, col)
  if (kind === 'robber') { for (const y of [1, 1.15, 1.3]) P(0, y, 0, 0.41, 0.05, 0.25, ST.line); P(0, 1.68, 0.156, 0.31, 0.09, 0.01, ST.line) }
  if (kind === 'cop') { P(0, 1.82, 0.02, 0.33, 0.08, 0.36, 0x2a3f8f); P(-0.1, 1.28, 0.125, 0.07, 0.08, 0.01, ST.objective) }
  if (kind === 'thug' || kind === 'boss') { P(0, 1.58, 0.156, 0.31, 0.1, 0.01, ST.enemy); P(0, 1.82, 0, 0.32, 0.06, 0.32, kind === 'boss' ? ST.objective : ST.line) }
  P(-0.28, 1.18, 0, 0.12, 0.48, 0.12, col); P(0.28, 1.18, 0, 0.12, 0.48, 0.12, col)
  P(-0.11, 0.55, 0, 0.15, 0.7, 0.15, legs); P(0.11, 0.55, 0, 0.15, 0.7, 0.15, legs)
  P(0.28, 0.92, 0.14, 0.06, 0.06, 0.22, kind === 'cop' ? ST.friendly : ST.enemy)
  const l = ctx.label(kind.toUpperCase(), kind === 'cop' ? '#7fb4ff' : '#ff3d52', 0.55); l.mesh.position.y = 2.15 * s; l.mesh.userData.billboard = true; g.add(l.mesh)
  g.position.copy(pos); ctx.group.add(g)
  const n = { g, label: l, pos: pos.clone(), hp, kind, goal: null, next: Date.now() + 2000 + Math.random() * 2000, speed: kind === 'robber' ? 1.1 : 0.75, alive: true, ph: Math.random() * 6, s, loot: false }
  S.npcs.push(n); return n
}
function spawn(kind, hp, near) {
  const pos = near ? V(near.x + (Math.random() - 0.5) * 1.2, 0, near.z + (Math.random() - 0.5) * 1.2) : ctx.floorAt(camFloor(), ctx.flatForward(), (Math.random() - 0.5) * 160, (2.5 + Math.random() * 1.5) * K())
  return npc(kind, pos, hp)
}
function setBeacon(at, color, text) { if (S.beacon) ctx.group.remove(S.beacon); S.beacon = at ? beacon(ctx, at, color, text) : null; S.beaconAt = at }
function nextJob() {
  S.jobN++; S.job = ['deliver', 'takeout', 'hold', 'boss'][(S.jobN - 1) % 4]; const lvl = Math.floor((S.jobN - 1) / 4); S.jobT = 0
  if (S.job === 'deliver') { const st = S.places.stash; S.pkg = ctx.box(st.pos.clone().add(V(0, 0.62, 0)), V(0.3, 0.3, 0.3), ST.objective); setBeacon(st.pos, ST.epic, 'PACKAGE'); S.jobEnd = Date.now() + (40 + S.area * 25) * 1000; ctx.toast('JOB ' + S.jobN + ': GRAB THE PACKAGE FROM THE STASH', 4000) }
  else if (S.job === 'takeout') { for (let i = 0; i < 3 + lvl; i++) spawn('thug', 2); setBeacon(null); ctx.toast('JOB ' + S.jobN + ': TAKE OUT THE CREW', 4000) }
  else if (S.job === 'hold') {
    const st = S.places.store; S.ring = new THREE.Group()
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; ctx.part(S.ring, Math.cos(a) * 1.1, 0.02, Math.sin(a) * 1.1, 0.3, 0.04, 0.1, ST.health) }
    S.ring.position.copy(V(0, 0, 1.7).applyQuaternion(st.g.quaternion).add(st.pos)); ctx.group.add(S.ring)
    setBeacon(S.ring.position, ST.health, 'HOLD'); S.nextSpawn = Date.now() + 3000; ctx.toast('JOB ' + S.jobN + ': HOLD THE SPOT BY THE STORE FOR 30 S', 4000)
  } else { const b = spawn('boss', 10 + lvl * 4); b.label.set('BOSS'); spawn('thug', 2); setBeacon(null); ctx.toast('JOB ' + S.jobN + ': BEAT THE BOSS', 4000) }
}
function payout(n, why) { setTimeout(() => ctx.earn && ctx.earn(Math.max(5, Math.round(n / 10)), 'JOB'), 3600); S.cash += n; S.earned += n; try { localStorage.setItem(CASH_KEY, String(S.cash)) } catch (e) {} ctx.toast(why + '  +$' + n, 3500); for (let k = 0; k < 3; k++) ctx.burst(ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 1.5).add(V((k - 1) * 0.4, 0.2, 0)), ST.health, 16, 0.04) }
function jobDone(n, why) { payout(n, why); setBeacon(null); if (S.ring) { ctx.group.remove(S.ring); S.ring = null } S.job = 'between'; S.jobEnd = Date.now() + 3500 }
function startHeist() { S.job = 'heist'; S.crack = 0; S.wanted = 0; setBeacon(S.places.bank.pos, ST.objective, 'BANK'); ctx.toast('ROB THE BANK: POINT AT THE VAULT AND HOLD A PINCH', 4500) }
function dispatch() {
  const where = Math.random() < 0.5 ? 'bank' : 'store', p = S.places[where]
  S.job = 'chase'; S.escaped = 0; ctx.toast('DISPATCH: ' + (where === 'bank' ? 'HEIST IN PROGRESS AT THE BANK!' : 'ROBBERY AT THE STORE!'), 5000); ctx.beep('boom')
  setBeacon(p.pos, ST.enemy, 'ALERT: ' + p.name)
  const n = 2 + Math.floor(Math.random() * 2)
  for (let i = 0; i < n; i++) { const r = spawn('robber', 2, p.pos); r.loot = true; r.goal = S.places.getaway.pos; r.next = Date.now() + 4000 + Math.random() * 3000 }
}
// ---------------------------------------------------------------- input + guns
function act(ray) {
  if (S.job === 'dead') { const h = ctx.rayHit(ray, S.signs.map((s) => s.mesh)); if (h) { ctx.beep('tap'); newGame(S.mode) } return }
  if (S.pkg && !S.carry && flat(S.pkg.position, camFloor()) < 1.7 && ctx.rayHit(ray, [S.pkg])) {
    ctx.group.remove(S.pkg); S.pkg = null; S.carry = ctx.box(ctx.viewPos(), V(0.22, 0.22, 0.22), ST.objective); setBeacon(S.places.drop.pos, ST.health, 'DROP-OFF'); ctx.toast('GOT IT! TAKE IT TO THE DROP-OFF'); return
  }
  if (S.job === 'heist' && flat(S.places.bank.pos, camFloor()) < 2) { if (ctx.preview) S.crack += 0.25; return }
  fire(ray)
}
function fire(ray) {
  const now = Date.now(), w = WEAPONS[S.w]
  if (now - (S.lastFire || 0) < w.gap) return
  S.lastFire = now
  const muzzle = S.gun.position.clone().add(ray.dir.clone().multiplyScalar(0.2))
  let best = null, ba = 99
  for (const n of S.npcs) { if (!n.alive) continue; const c = n.pos.clone().add(V(0, 1.1 * n.s, 0)), to = c.clone().sub(ray.origin), d = to.length(); const a = Math.acos(Math.max(-1, Math.min(1, to.normalize().dot(ray.dir)))); if (a < Math.atan(0.5 * n.s / d) + (w.pellets ? 0.07 : 0) && a < ba) { ba = a; best = n } }
  for (let i = 0; i < (w.pellets || 1); i++) { let d = best ? best.pos.clone().add(V(0, 1.1 * best.s, 0)).sub(muzzle).normalize() : ray.dir.clone(); if (w.pellets) d.add(V((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08)).normalize(); ctx.bolt(muzzle, d, w.color) }
  ctx.beep('pew')
  if (!best) return
  const n = best, dist = n.pos.distanceTo(ray.origin)
  setTimeout(() => { if (!S || !n.alive) return; n.hp -= w.damage; ctx.burst(n.pos.clone().add(V(0, 1.1 * n.s, 0)), w.color, 8, 0.05); if (n.hp <= 0) down(n) }, Math.min(1200, dist / w.speed * 1000))
}
function down(n) {
  n.alive = false; ctx.blockPile(n.pos.clone()); ctx.group.remove(n.g); S.npcs = S.npcs.filter((x) => x !== n)
  if (n.kind === 'robber' && S.mode === 'cop') { S.arrests = (S.arrests || 0) + 1; payout(250, 'ROBBER TAGGED') }
}
// ---------------------------------------------------------------- per frame
function tickNpcs(dt) {
  const cam = ctx.viewPos(), me = camFloor(), now = Date.now()
  for (const n of S.npcs.slice()) {
    n.ph += dt
    let goal = n.goal
    if (n.kind !== 'robber') { const want = (2.2 + Math.random() * 0.01) * K(), to = me.clone().sub(n.pos), d = to.length(); const side = ctx.right(to.clone().normalize()).multiplyScalar(Math.sin(n.ph * 0.7) * 0.8); goal = d > want ? n.pos.clone().addScaledVector(to.normalize(), d - want).add(side) : n.pos.clone().add(side) }
    if (goal) {
      const to = V(goal.x - n.pos.x, 0, goal.z - n.pos.z); if (to.length() > 0.05) n.pos.addScaledVector(to.normalize(), Math.min(to.length(), n.speed * dt))
      if (n.kind === 'robber' && flat(n.pos, S.places.getaway.pos) < 0.9) { n.alive = false; ctx.group.remove(n.g); S.npcs = S.npcs.filter((x) => x !== n); S.escaped++; ctx.toast('A ROBBER GOT AWAY!', 3000); continue }
    }
    n.g.position.set(n.pos.x, Math.abs(Math.sin(n.ph * 6)) * 0.04, n.pos.z)
    if (n.kind === 'robber' && goal) n.g.lookAt(goal.x, 0, goal.z); else n.g.lookAt(me.x, 0, me.z)
    n.label.set(n.kind.toUpperCase() + '  ' + '♥'.repeat(Math.max(0, Math.min(10, n.hp))), n.kind === 'cop' ? '#7fb4ff' : '#ff3d52')
    if (now > n.next && S.job !== 'dead') {
      n.next = now + (n.kind === 'boss' ? 1400 : 2400) + Math.random() * 1500
      const from = n.pos.clone().add(V(0, 1.15 * n.s, 0)), aim = cam.clone().add(V((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3))
      const dir = aim.sub(from).normalize(), speed = 2.6 + S.area * 0.6
      const g = new THREE.Group(); ctx.part(g, 0, 0, 0, 0.07, 0.07, 0.4, 0xffffff); const glow = ctx.part(g, 0, 0, 0, 0.16, 0.16, 0.52, n.kind === 'cop' ? 0x3b6dff : ST.enemy); glow.material = ctx.mat(n.kind === 'cop' ? 0x3b6dff : ST.enemy, 0.7)
      g.position.copy(from); g.lookAt(from.clone().add(dir)); ctx.group.add(g)
      S.shots.push({ g, pos: from, vel: dir.multiplyScalar(speed), life: 6 })
    }
  }
  for (const s of S.shots.slice()) {
    s.life -= dt; s.pos.addScaledVector(s.vel, dt); s.g.position.copy(s.pos)
    if (s.pos.distanceTo(cam) < 0.28 && S.job !== 'dead') { gotHit(); s.life = 0 }
    if (s.life <= 0 || s.pos.y < 0) { ctx.group.remove(s.g); S.shots = S.shots.filter((x) => x !== s) }
  }
}
function gotHit() {
  S.hp--; ctx.beep('ouch'); ctx.burst(ctx.viewPos().clone().addScaledVector(ctx.viewDir(), 0.45), ST.enemy, 10, 0.03)
  if (S.hp <= 0) {
    S.job = 'dead'; ctx.toast('WASTED · YOU EARNED $' + S.earned, 15000); setBeacon(null)
    const l = ctx.label('PLAY AGAIN', '#ffb21e', 0.5, 520, 120); const v = ctx.viewPos(), f = ctx.flatForward(); l.mesh.position.copy(v).addScaledVector(f, 1.1).add(V(0, -0.42, 0)); l.mesh.userData.billboard = true; ctx.group.add(l.mesh); S.signs.push(l)
  } else ctx.toast('HIT!  ♥ ' + S.hp, 1200)
}
function tick(dt, now) {
  const cam = ctx.viewPos(), me = camFloor(), f = ctx.flatForward()
  tickNpcs(dt)
  // gun in your hand (or low right in your view)
  const hp = ctx.hand.pos || cam.clone().addScaledVector(ctx.viewDir(), 0.45).addScaledVector(ctx.right(f), 0.2).add(V(0, -0.28, 0))
  S.gun.position.copy(hp); S.gun.lookAt(hp.clone().sub(ctx.viewDir())); S.gun.visible = !S.carry
  if (S.carry) S.carry.position.copy(cam).addScaledVector(f, 0.45).addScaledVector(ctx.right(f), -0.18).add(V(0, -0.32, 0))
  if (S.pkg) S.pkg.rotation.y += dt * 1.5
  let line = ''
  if (S.job === 'deliver') {
    if (S.carry && flat(S.places.drop.pos, me) < 0.9) { ctx.group.remove(S.carry); S.carry = null; jobDone(300 + S.jobN * 50, 'DELIVERED') }
    else { const left = Math.max(0, Math.ceil((S.jobEnd - now) / 1000)); line = (S.carry ? 'DELIVER TO DROP-OFF ' : 'GRAB THE PACKAGE ') + arrowTo(ctx, S.beaconAt) + '  ' + left + 'S'
      if (left <= 0) { ctx.toast('TOO SLOW · JOB FAILED', 3000); if (S.carry) ctx.group.remove(S.carry); if (S.pkg) ctx.group.remove(S.pkg); S.carry = S.pkg = null; setBeacon(null); S.job = 'between'; S.jobEnd = now + 3000; S.jobN-- } }
  } else if (S.job === 'takeout' || S.job === 'boss') { const left = S.npcs.length; line = S.job === 'boss' ? 'BEAT THE BOSS' : 'THUGS LEFT: ' + left; if (!left) jobDone(S.job === 'boss' ? 1000 : 400, S.job === 'boss' ? 'BOSS DOWN' : 'CREW CLEARED') }
  else if (S.job === 'hold') {
    const inside = flat(S.ring.position, me) < 1.1; if (inside) S.jobT += dt
    if (now > S.nextSpawn && S.npcs.length < 4) { spawn('thug', 2); S.nextSpawn = now + 6000 }
    line = (inside ? 'HOLDING ' : 'GET IN THE RING ' + arrowTo(ctx, S.ring.position) + '  ') + Math.floor(S.jobT) + ' / 30S'
    if (S.jobT >= 30) { S.npcs.forEach((n) => { ctx.blockPile(n.pos.clone()); ctx.group.remove(n.g) }); S.npcs = []; jobDone(500, 'SPOT HELD') }
  } else if (S.job === 'between') { line = 'NEXT JOB…'; if (now > S.jobEnd) { if (S.mode === 'missions') nextJob(); else if (S.mode === 'robber') startHeist(); else { S.job = 'patrol'; S.dispatchAt = now + 7000 } } }
  else if (S.job === 'heist') {
    const bank = S.places.bank, near = flat(bank.pos, me) < 2
    if (near && ctx.holding && ctx.angle(bank.pos.clone().add(V(0, 0.55, 0))) < 25 * ctx.D2R) S.crack += dt / 4
    line = near ? 'CRACKING THE VAULT ' + Math.round(Math.min(1, S.crack) * 100) + '%  (POINT + HOLD PINCH)' : 'GO TO THE BANK ' + arrowTo(ctx, bank.pos)
    if (S.crack >= 1) { S.job = 'escape'; S.wanted = 3; S.carry = ctx.box(cam, V(0.26, 0.26, 0.26), ST.health); ctx.burst(bank.pos.clone().add(V(0, 0.6, 0)), ST.objective, 30, 0.05); setBeacon(S.places.getaway.pos, ST.objective, 'GETAWAY'); ctx.toast('ALARM! ★★★ GET TO THE GETAWAY CAR!', 4000); S.nextSpawn = now + 1500 }
  } else if (S.job === 'escape') {
    if (now > S.nextSpawn && S.npcs.length < 2 + S.wanted) { spawn('cop', 2); S.nextSpawn = now + 5000 }
    line = '★'.repeat(S.wanted) + '☆'.repeat(5 - S.wanted) + '  GETAWAY ' + arrowTo(ctx, S.places.getaway.pos)
    if (flat(S.places.getaway.pos, me) < 1.4) { if (S.carry) ctx.group.remove(S.carry); S.carry = null; S.npcs.forEach((n) => ctx.group.remove(n.g)); S.npcs = []; S.shots.forEach((s) => ctx.group.remove(s.g)); S.shots = []; S.wanted = 0; jobDone(1500, 'CLEAN GETAWAY') }
  } else if (S.job === 'patrol') { line = 'ON PATROL · WAITING FOR DISPATCH'; if (now > S.dispatchAt) dispatch() }
  else if (S.job === 'chase') { const left = S.npcs.filter((n) => n.kind === 'robber').length; line = 'ROBBERS: ' + left + '  ' + (S.beaconAt ? arrowTo(ctx, S.beaconAt) : ''); if (!left) { setBeacon(null); ctx.toast(S.escaped ? 'SOME GOT AWAY' : 'ALL ROBBERS TAGGED', 3500); S.job = 'between'; S.jobEnd = now + 3000 } }
  else if (S.job === 'dead') line = 'WASTED · POINT AT PLAY AGAIN + PINCH'
  const title = S.mode === 'missions' ? 'JOB ' + S.jobN : S.mode === 'robber' ? 'ROBBER' : 'COP'
  ctx.line(line, '♥'.repeat(Math.max(0, S.hp)) + '  $' + Math.round(S.cash) + '  ' + WEAPONS[S.w].name + '  · ' + title)
}
