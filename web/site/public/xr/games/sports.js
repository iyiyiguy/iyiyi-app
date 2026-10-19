// iYiYi SPORTS for XR glasses. Courts at real sizes on your floor (or a backyard size), the computer
// plays the far side. Your hand is the racket/paddle: swing through the ball (no hand tracking or
// in the preview: pinch when the ball is near and it swings for you).
//   Tennis (78×27 ft, 15/30/40/deuce), Pickleball (44×20 ft, kitchen), Ping pong (9×5 ft table),
//   Volleyball (59×29.5 ft, 7 ft 11 in net, no bounces), Basketball (free throws), Bowling
//   (60 ft lane, 10 frames), Cornhole (27 ft boards, cancel scoring to 21).
// Throws (hoops, bowling, cornhole): hold a pinch, swing, let go. Pointing sets the aim.
import { ST, shuffle } from './kit.js'

const FT = 0.3048, G = 9.8
const SPORTS = {
  tennis: { name: 'TENNIS', len: 78, wid: 27, net: 3, ball: 0.067, speed: 15, scoring: 'tennis', color: 0xd9ff33, surface: 0x1f5a99 },
  pickleball: { name: 'PICKLEBALL', len: 44, wid: 20, net: 2.9, ball: 0.074, speed: 10.5, scoring: 'to11', color: 0xffe633, surface: 0x1a734d },
  pingpong: { name: 'PING PONG', len: 9, wid: 5, net: 0.5, ball: 0.04, speed: 5, scoring: 'to11', color: 0xff9933, surface: 0x0d4073, table: 0.76 },
  volleyball: { name: 'VOLLEYBALL', len: 59, wid: 29.5, net: 7.96, ball: 0.21, speed: 9, scoring: 'to25', color: 0xfff3d6, surface: 0x8a5a2b, nobounce: true },
}
let ctx, THREE, S
const st = {}

export default {
  title: 'SPORTS',
  start(c) { ctx = c; THREE = c.THREE; S = { backyard: false }; pickSport() },
  stop() { S = null },
  tick(dt, now) { if (!S || !S.mode) return; if (S.mode === 'racket') tickRacket(dt, now); else if (S.mode === 'hoops') tickHoops(dt); else if (S.mode === 'bowling') tickBowling(dt); else if (S.mode === 'cornhole') tickCornhole(dt, now) },
  select(ray) { if (!S) return; if (S.mode === 'racket') assistSwing() },
  release(ray) { if (!S) return; if (S.mode === 'hoops' || S.mode === 'bowling' || S.mode === 'cornhole') throwIt(ray) },
}
void st

function pickSport() {
  clear()
  ctx.choose('Pick a sport', [
    ['TENNIS', 'tennis', '78 × 27 FT'], ['PICKLEBALL', 'pickleball', '44 × 20 FT'], ['PING PONG', 'pingpong', 'TABLE'], ['VOLLEYBALL', 'volleyball', '59 × 29.5 FT'],
    ['BASKETBALL', 'hoops', 'FREE THROWS'], ['BOWLING', 'bowling', '10 FRAMES'], ['CORNHOLE', 'cornhole', 'TO 21'],
    ['SIZE: ' + (S.backyard ? 'BACKYARD' : 'FULL SIZE'), 'size', 'TAP TO CHANGE'],
  ], (v) => {
    if (v === 'size') { S.backyard = !S.backyard; pickSport(); return }
    if (SPORTS[v]) startRacket(v); else if (v === 'hoops') startHoops(); else if (v === 'bowling') startBowling(); else startCornhole()
  })
}
function clear() { while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0]); S.mode = null }
const V = (x, y, z) => new THREE.Vector3(x, y, z)
/** court frame: x across (+ = your right), z along (+ = toward the far side), y up */
function P(x, z, y) { return S.origin.clone().addScaledVector(S.side, x).addScaledVector(S.fwd, z).add(V(0, y, 0)) }
function toCourt(p) { const d = p.clone().sub(S.origin); return V(d.dot(S.side), d.y, d.dot(S.fwd)) }
function setupFrame(distAhead) {
  const v = ctx.viewPos()
  S.fwd = ctx.flatForward(); S.side = ctx.right(S.fwd)
  S.origin = V(v.x, 0, v.z).addScaledVector(S.fwd, distAhead)
  S.root = new THREE.Group(); ctx.group.add(S.root)
}
function block(pos, sx, sy, sz, color, rotY = true) { const m = ctx.box(pos, V(sx, sy, sz), color, S.root); if (rotY) m.quaternion.setFromUnitVectors(V(0, 0, 1), S.fwd); return m }
function score() { ctx.line(S.line1 || '', S.line2 || '') }

// ============================================================ racket sports + volleyball
function startRacket(id) {
  clear()
  const s = SPORTS[id]; S.sport = s; S.mode = 'racket'
  S.scale = S.backyard && !s.table ? Math.min(1, 12 / (s.len * FT)) : 1
  const L = s.len * FT * S.scale, W = s.wid * FT * S.scale
  S.L = L; S.W = W
  setupFrame(L / 2 + (s.table ? 0.4 : 0.6))
  S.top = s.table || 0
  const t = s.table ? 0.008 : 0.04
  block(P(0, 0, S.top - 0.005), W, 0.01, L, s.surface)
  for (const z of [-L / 2, L / 2]) block(P(0, z, S.top + 0.002), W, 0.004, t, 0xffffff)
  for (const x of [-W / 2, W / 2]) block(P(x, 0, S.top + 0.002), t, 0.004, L, 0xffffff)
  if (id === 'pickleball') { const k = 7 * FT * S.scale; for (const z of [-k, k]) block(P(0, z, 0.002), W, 0.004, t, 0xffffff); for (const zz of [-1, 1]) block(P(0, zz * (L / 2 + k) / 2, 0.002), t, 0.004, L / 2 - k, 0xffffff) }
  if (id === 'tennis') { const sv = 21 * FT * S.scale; for (const z of [-sv, sv]) block(P(0, z, 0.002), W, 0.004, t, 0xffffff); block(P(0, 0, 0.002), t, 0.004, 2 * sv, 0xffffff) }
  if (id === 'volleyball') { const a = 9.84 * FT * S.scale; for (const z of [-a, a]) block(P(0, z, 0.002), W, 0.004, t, 0xffffff) }
  if (s.table) { block(P(0, 0, S.top + 0.002), t, 0.004, L, 0xffffff); for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-L / 2 + 0.08, L / 2 - 0.08]) block(P(x, z, S.top / 2), 0.05, S.top, 0.05, 0x5a6075) }
  const netH = s.net * FT * (s.table ? 1 : id === 'volleyball' && S.backyard ? 0.8 : S.scale)
  S.netH = netH
  block(P(0, 0, S.top + netH / 2 + (id === 'volleyball' ? 0.45 : 0)), W + 0.2, id === 'volleyball' ? 0.9 : netH, 0.015, 0xd9dbe6)
  block(P(0, 0, S.top + netH), W + 0.2, 0.03, 0.03, 0xffffff)
  for (const x of [-(W / 2 + 0.1), W / 2 + 0.1]) block(P(x, 0, (S.top + netH + 0.1) / 2), 0.05, S.top + netH + 0.1, 0.05, 0x6b7590)
  S.ball = new THREE.Mesh(new THREE.SphereGeometry(s.ball / 2, 16, 12), ctx.mat(s.color)); ctx.group.add(S.ball)
  // your paddle follows your hand
  S.paddle = new THREE.Group(); const ps = s.table ? 0.6 : id === 'volleyball' ? 0 : 1
  if (ps) { ctx.part(S.paddle, 0, 0.14 * ps, 0, 0.22 * ps, 0.26 * ps, 0.02, id === 'tennis' ? 0xe63350 : 0x39d5ff); ctx.part(S.paddle, 0, 0, 0, 0.03, 0.14 * ps, 0.03, 0x333844) }
  ctx.group.add(S.paddle)
  S.cpu = makeCpu(); S.cpuPos = P(0, L / 2 + (s.table ? 0.5 : 0.8), 0)
  S.pts = { me: 0, cpu: 0 }; S.games = { me: 0, cpu: 0 }; S.server = 'me'
  newPoint()
  ctx.toast(s.name + (id === 'volleyball' ? ' · HIT THE BALL BEFORE IT LANDS' : ' · SWING THROUGH THE BALL'), 4000)
}
function makeCpu() {
  const g = new THREE.Group()
  ctx.part(g, 0, 1.6, 0, 0.28, 0.28, 0.28, 0xffdbb3); ctx.part(g, 0, 1.12, 0, 0.38, 0.52, 0.22, 0xff4fa3)
  ctx.part(g, -0.1, 0.52, 0, 0.14, 0.68, 0.14, 0x4d5875); ctx.part(g, 0.1, 0.52, 0, 0.14, 0.68, 0.14, 0x4d5875)
  ctx.part(g, 0.28, 1.2, 0.12, 0.2, 0.24, 0.02, 0x39d5ff)
  ctx.group.add(g); return g
}
function newPoint() { S.live = false; S.bounces = 0; S.serveAt = Date.now() + 1200; drawScore() }
function aim(to, from, speed) {
  const d = to.clone().sub(from), flat = V(d.x, 0, d.z), dist = flat.length()
  const t = Math.max(0.35, dist / speed)
  return flat.multiplyScalar(1 / t).add(V(0, (d.y + 0.5 * G * t * t) / t, 0))
}
function serve() {
  const s = S.sport
  if (S.server === 'me') {
    S.pos = P(0.15, -S.L / 2 - (s.table ? 0.1 : 0.3), S.top + (s.table ? 0.25 : 1.4)); S.vel = V(0, s.table ? 1.2 : 3.5, 0); S.last = 'cpu'
  } else {
    S.pos = S.cpuPos.clone().add(V(0, s.table ? S.top + 0.3 : 1.2, 0))
    S.vel = aimOver(P((Math.random() - 0.5) * S.W * 0.5, -S.L / 3, S.top), S.pos, s.speed * 0.8 * (s.table ? 1 : S.scale ** 0.3)); S.last = 'cpu'
  }
  S.live = true; S.bounces = 0; S.serveT = Date.now()
}
/** like aim, but high enough to clear the net */
function aimOver(to, from, speed) {
  let v = aim(to, from, speed)
  if (S.sport.nobounce || S.netH > 1) v = aim(to, from, speed * 0.55)
  return v
}
function myHit(vel) {
  const s = S.sport
  let v
  if (vel && vel.length() > 1.2) {
    // your swing: direction and power from your hand
    const pw = Math.min(1.6, vel.length() / 4)
    const fwdAmt = Math.max(0.3, vel.dot(S.fwd) / vel.length())
    const across = vel.dot(S.side) / vel.length()
    const target = P(across * S.W * 0.45, S.L * (0.15 + 0.25 * fwdAmt), S.top)
    v = aimOver(target, S.pos, s.speed * (0.7 + 0.5 * pw) * (s.table ? 1 : S.scale ** 0.3))
  } else {
    v = aimOver(P((Math.random() - 0.5) * S.W * 0.6, S.L * (0.2 + Math.random() * 0.2), S.top), S.pos, s.speed * (s.table ? 1 : S.scale ** 0.3))
  }
  S.vel = v; S.last = 'me'; S.bounces = 0
  ctx.burst(S.pos.clone(), 0xffffff, 6, 0.02); ctx.beep('tap')
}
function assistSwing() {
  if (!S.live || S.last === 'me') return
  const c = toCourt(S.pos), v = ctx.viewPos(), d = Math.hypot(S.pos.x - v.x, S.pos.z - v.z)
  if (c.z < 0.5 && d < (S.sport.table ? 1.6 : 3.5)) myHit(null)
}
function tickRacket(dt, now) {
  const s = S.sport
  // paddle on your hand (or low in front of you)
  const hp = ctx.hand.pos || ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 0.5).addScaledVector(ctx.right(ctx.flatForward()), 0.32).add(V(0, -0.62, 0))
  S.paddle.position.copy(hp); S.paddle.quaternion.setFromUnitVectors(V(0, 0, 1), S.fwd)
  if (!S.live && now > S.serveAt) serve()
  if (!S.live) { S.ball.position.copy(P(0, S.server === 'me' ? -S.L / 2 : S.L / 2, S.top + 1)); moveCpu(dt, P(0, S.L / 2 + 0.5, 0)); return }
  // auto-serve for you after 4 s
  if (S.server === 'me' && S.last === 'cpu' && S.bounces === 0 && now - S.serveT > 4000 && toCourt(S.pos).z < -S.L / 2 + 0.6) myHit(null)
  const prev = S.pos.clone()
  S.vel.y -= G * dt
  const p = S.pos.clone().addScaledVector(S.vel, dt)
  const lc = toCourt(p), pc = toCourt(prev)
  // net
  if ((pc.z < 0) !== (lc.z < 0) && lc.y < S.top + S.netH) return endRally(S.last === 'me' ? 'cpu' : 'me', 'NET!')
  // floor / table
  if (lc.y < S.top + s.ball / 2 && S.vel.y < 0) {
    const inX = Math.abs(lc.x) <= S.W / 2 + 0.05, inZ = Math.abs(lc.z) <= S.L / 2 + 0.05, mine = lc.z < 0
    if (s.nobounce) return endRally(inX && inZ ? (mine ? 'cpu' : 'me') : (S.last === 'me' ? 'cpu' : 'me'), inX && inZ ? 'KILL!' : 'OUT!')
    if (!inX || !inZ) return endRally(S.last === 'me' ? 'cpu' : 'me', 'OUT!')
    if ((mine && S.last === 'me') || (!mine && S.last === 'cpu')) return endRally(S.last === 'me' ? 'cpu' : 'me', 'FAULT')
    if (++S.bounces >= 2) return endRally(mine ? 'cpu' : 'me', 'DOUBLE BOUNCE')
    p.y = S.origin.y + S.top + s.ball / 2
    S.vel.set(S.vel.x * 0.85, -S.vel.y * (s.table ? 0.8 : 0.7), S.vel.z * 0.85)
  }
  if (lc.z < -S.L / 2 - 6 || lc.z > S.L / 2 + 6) return endRally(lc.z < 0 ? 'cpu' : 'me', 'MISSED')
  S.pos = p; S.ball.position.copy(p)
  // your hit: the ball comes through your hand
  if (S.last === 'cpu' && ctx.hand.pos && (s.nobounce || S.bounces >= (S.server === 'me' && now - S.serveT < 4000 ? 0 : 1) || lc.y > S.top + 0.3)) {
    if (p.distanceTo(ctx.hand.pos) < (s.table ? 0.18 : s.nobounce ? 0.45 : 0.35)) myHit(ctx.hand.vel)
  }
  // the computer: runs to where the ball will be and hits it back (misses now and then)
  const cpuSide = lc.z > 0
  if (cpuSide && S.last === 'me') {
    const land = predictLand(), goal = land ? P(Math.max(-S.W / 2, Math.min(S.W / 2, toCourt(land).x)), Math.min(S.L / 2 + 0.6, toCourt(land).z + 0.6), 0) : S.cpuPos
    moveCpu(dt, goal)
    const reach = Math.hypot(p.x - S.cpuPos.x, p.z - S.cpuPos.z)
    const ready = s.nobounce ? (lc.y < S.top + 2.6 && S.vel.y < 0) : S.bounces >= 1
    if (ready && reach < (s.table ? 0.5 : 1.3) && lc.y < S.top + 2.6) {
      if (Math.random() < (s.table ? 0.1 : 0.14)) { S.last = 'miss' } else {
        S.vel = aimOver(P((Math.random() - 0.5) * S.W * 0.8, -S.L * (0.15 + Math.random() * 0.3), S.top), p, s.speed * (s.table ? 1 : S.scale ** 0.3))
        S.last = 'cpu'; S.bounces = 0
      }
    }
  } else moveCpu(dt, P(0, S.L / 2 + 0.6, 0))
}
function predictLand() {
  let p = S.pos.clone(), v = S.vel.clone()
  for (let i = 0; i < 300; i++) { v.y -= G / 60; p.addScaledVector(v, 1 / 60); if (toCourt(p).y < S.top + (S.sport.nobounce ? 1 : 0.05)) return p }
  return null
}
function moveCpu(dt, goal) {
  const to = V(goal.x - S.cpuPos.x, 0, goal.z - S.cpuPos.z), sp = S.sport.table ? 1.5 : 4.2
  if (to.length() > 0.02) S.cpuPos.addScaledVector(to.normalize(), Math.min(to.length(), sp * dt))
  S.cpu.position.set(S.cpuPos.x, 0, S.cpuPos.z); S.cpu.lookAt(ctx.viewPos().x, 0, ctx.viewPos().z)
}
function endRally(winner, why) {
  S.live = false
  ctx.burst(S.pos.clone(), winner === 'me' ? ST.health : ST.enemy, 14, 0.04)
  S.pts[winner]++
  const s = S.sport
  let msg = why
  const a = S.pts.me, b = S.pts.cpu
  if (s.scoring === 'tennis') {
    if ((a >= 4 || b >= 4) && Math.abs(a - b) >= 2) { const w = a > b ? 'me' : 'cpu'; S.games[w]++; S.pts = { me: 0, cpu: 0 }; S.server = S.server === 'me' ? 'cpu' : 'me'; msg = w === 'me' ? 'GAME, YOU' : 'GAME, CPU'; if ((S.games.me >= 6 || S.games.cpu >= 6) && Math.abs(S.games.me - S.games.cpu) >= 2) { msg = S.games.me > S.games.cpu ? 'SET! YOU WIN' : 'SET TO THE CPU'; S.games = { me: 0, cpu: 0 } } }
  } else {
    const to = s.scoring === 'to25' ? 25 : 11
    if ((a >= to || b >= to) && Math.abs(a - b) >= 2) { msg = a > b ? 'YOU WIN THE GAME!' : 'CPU WINS THE GAME'; S.pts = { me: 0, cpu: 0 } }
    if (s.scoring === 'to25') S.server = winner
    else if ((S.pts.me + S.pts.cpu) % 2 === 0) S.server = S.server === 'me' ? 'cpu' : 'me'
  }
  ctx.toast((winner === 'me' ? 'POINT YOU · ' : 'POINT CPU · ') + msg, 2200)
  newPoint()
}
function drawScore() {
  const s = S.sport
  let l
  if (s.scoring === 'tennis') {
    const n = ['0', '15', '30', '40'], a = S.pts.me, b = S.pts.cpu
    l = 'GAMES ' + S.games.me + '–' + S.games.cpu + '   ' + (a >= 3 && b >= 3 ? (a === b ? 'DEUCE' : a > b ? 'AD YOU' : 'AD CPU') : n[Math.min(3, a)] + '–' + n[Math.min(3, b)])
  } else l = 'YOU ' + S.pts.me + ' – ' + S.pts.cpu + ' CPU'
  S.line1 = l; S.line2 = (S.server === 'me' ? 'YOUR SERVE' : 'THEIR SERVE') + (S.backyard ? ' · BACKYARD' : ''); score()
}

// ============================================================ throws: hoops, bowling, cornhole
function throwVel(ray, target, flight, flatOnly) {
  const hv = ctx.hand.vel
  if (ctx.hand.pos && hv.length() > 1.4 && !ctx.preview) { const v = hv.clone().multiplyScalar(1.4); if (flatOnly) v.y = 0; return v }
  // assisted: aim where you're pointing, with a little error
  const from = S.throwFrom()
  let tgt = target.clone()
  const pt = ctx.rayFloor(ray, target.y)
  if (pt && pt.distanceTo(target) < 3) tgt = pt
  tgt.add(V((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25))
  if (flatOnly) { const d = V(tgt.x - from.x, 0, tgt.z - from.z); return d.normalize().multiplyScalar(6 + Math.random() * 2) }
  const d = tgt.clone().sub(from), flat = V(d.x, 0, d.z)
  return flat.multiplyScalar(1 / flight).add(V(0, (d.y + 0.5 * G * flight * flight) / flight, 0))
}
function throwIt(ray) {
  if (S.mode === 'hoops') { if (S.live) return; S.pos = S.throwFrom(); S.vel = throwVel(ray, S.hoop, 1.1); S.live = true; S.shots++; return }
  if (S.mode === 'cornhole') { if (S.flying || S.turn !== 'me' || S.left.me <= 0) return; launchBag('me', throwVel(ray, S.hole, 1.15)); return }
  if (S.mode === 'bowling') { if (S.rolling || S.over) return; S.pos = S.throwFrom(); S.vel = throwVel(ray, P(0, S.laneL - 0.6, 0.11), 1, true); S.vel.y = 0; S.rolling = true; ctx.beep('tap') }
}
// ---- basketball
function startHoops() {
  clear(); S.mode = 'hoops'; S.shots = 0; S.makes = 0
  const dist = S.backyard ? 3 : 4.57
  setupFrame(0)
  S.hoop = P(0, dist, 3.05)
  block(P(0, dist + 0.4, 3.4), 1.83, 1.07, 0.04, 0xf2f2ff); block(P(0, dist + 0.38, 3.25), 0.59, 0.45, 0.02, 0xff4d4d)
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; block(S.hoop.clone().addScaledVector(S.side, Math.cos(a) * 0.23).addScaledVector(S.fwd, Math.sin(a) * 0.23), 0.05, 0.03, 0.05, 0xff7319) }
  block(P(0, dist + 0.8, 1.7), 0.12, 3.4, 0.12, 0x6b7590); block(P(0, dist, 0.005), 3.6, 0.01, 0.04, 0xffffff)
  S.ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), ctx.mat(0xff8026)); ctx.group.add(S.ball)
  S.throwFrom = () => (ctx.hand.pos ? ctx.hand.pos.clone() : ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 0.55).addScaledVector(ctx.right(ctx.flatForward()), 0.2).add(V(0, -0.5, 0)))
  S.live = false
  ctx.toast('HOLD A PINCH, SWING UP AND LET GO', 4500)
}
function tickHoops(dt) {
  S.line1 = 'MADE ' + S.makes + ' / ' + S.shots + (S.shots ? '  (' + Math.round(100 * S.makes / S.shots) + '%)' : ''); S.line2 = 'FREE THROW LINE: ' + (S.backyard ? '10 FT' : '15 FT'); score()
  if (!S.live) { S.ball.position.copy(S.throwFrom()); return }
  const prev = S.pos.clone()
  S.vel.y -= G * dt; S.pos.addScaledVector(S.vel, dt)
  if (prev.y > S.hoop.y && S.pos.y <= S.hoop.y) {
    const f = Math.hypot(S.pos.x - S.hoop.x, S.pos.z - S.hoop.z)
    if (f < 0.18) { S.makes++; ctx.burst(S.hoop.clone(), ST.objective, 26, 0.06); ctx.toast(S.makes % 5 === 0 ? 'ON FIRE!' : 'SWISH!'); ctx.beep('hit') }
    else if (f < 0.3) S.vel.set(-S.vel.x * 0.4, Math.abs(S.vel.y) * 0.4, -S.vel.z * 0.4)
  }
  if (S.pos.y < 0.12) S.live = false
  S.ball.position.copy(S.pos)
}
// ---- bowling
function startBowling() {
  clear(); S.mode = 'bowling'
  S.laneL = S.backyard ? 8 : 18.29
  setupFrame(0.6)
  const w = 1.05
  block(P(0, S.laneL / 2, 0.003), w, 0.006, S.laneL, 0xc49a5c)
  for (const x of [-w / 2 - 0.12, w / 2 + 0.12]) block(P(x, S.laneL / 2, 0.003), 0.23, 0.006, S.laneL, 0x6b7590)
  for (let i = 1; i <= 7; i++) block(P((i - 4) * 0.12, 4.6 * (S.backyard ? 0.44 : 1), 0.008), 0.03, 0.004, 0.08, 0xff3d52) // arrows
  block(P(0, 0, 0.008), w, 0.004, 0.02, 0xffffff) // foul line
  S.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), ctx.mat(0x39d5ff)); ctx.group.add(S.ball)
  S.frames = []; S.frame = 0; S.roll = 0; S.over = false
  S.throwFrom = () => { const v = ctx.viewPos(); return P(Math.max(-0.45, Math.min(0.45, toCourt(V(v.x, 0, v.z)).x)), 0.1, 0.11) }
  rack(true)
  ctx.toast('HOLD A PINCH, SWING FORWARD, LET GO', 4500)
}
function rack(full) {
  if (full && S.pins) S.pins.forEach((p) => S.root.remove(p.mesh))
  if (full) {
    S.pins = []
    const rows = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]]
    rows.forEach((r, ri) => r.forEach((x) => {
      const pos = P(x * 0.305, S.laneL - 0.9 + ri * 0.264, 0)
      const g = new THREE.Group(); ctx.part(g, 0, 0.19, 0, 0.12, 0.3, 0.12, 0xffffff); ctx.part(g, 0, 0.34, 0, 0.07, 0.08, 0.07, 0xffffff); ctx.part(g, 0, 0.28, 0, 0.125, 0.025, 0.125, 0xff3d52)
      g.position.copy(pos); S.root.add(g)
      S.pins.push({ mesh: g, pos: pos.clone(), vel: V(0, 0, 0), down: false, tilt: 0, axis: V(1, 0, 0) })
    }))
  } else S.pins.forEach((p) => { if (p.down) { S.root.remove(p.mesh); p.gone = true } })
  S.ballPos = null
}
function tickBowling(dt) {
  const fr = S.frames
  S.line1 = 'FRAME ' + Math.min(10, S.frame + 1) + ' · ROLL ' + (S.roll + 1) + '   SCORE ' + bowlScore()
  S.line2 = fr.map((f, i) => (i + 1) + ':' + f.map((r, j) => (r === 10 && j === 0 && i < 9 ? 'X' : j > 0 && f[j - 1] + r === 10 && f[j - 1] !== 10 ? '/' : r)).join('')).slice(-5).join('  ')
  score()
  if (!S.rolling) { S.ball.position.copy(S.throwFrom()); return }
  S.pos.addScaledVector(S.vel, dt); S.vel.multiplyScalar(1 - 0.08 * dt)
  const bc = toCourt(S.pos)
  if (Math.abs(bc.x) > 0.53) { S.vel.multiplyScalar(0); S.gutter = true } // gutter: drops out
  S.ball.position.copy(S.pos); S.ball.rotation.x -= S.vel.length() * dt * 8
  // ball → pins, pins → pins
  for (const p of S.pins) {
    if (p.gone) continue
    if (!S.gutter && !p.hit && p.pos.distanceTo(V(S.pos.x, 0, S.pos.z)) < 0.17) { p.hit = true; p.vel.copy(S.vel).multiplyScalar(0.7).add(V((Math.random() - 0.5), 0, 0).multiplyScalar(1.5)); S.vel.multiplyScalar(0.93) }
  }
  for (const a of S.pins) if (a.hit && !a.gone) for (const b of S.pins) if (b !== a && !b.hit && !b.gone && a.pos.distanceTo(b.pos) < 0.13) { b.hit = true; b.vel.copy(a.vel).multiplyScalar(0.6).add(V((Math.random() - 0.5) * 1.2, 0, 0)) }
  let moving = S.vel.length() > 0.2 && bc.z < S.laneL + 0.4
  for (const p of S.pins) {
    if (!p.hit || p.gone) continue
    p.pos.addScaledVector(p.vel, dt); p.vel.multiplyScalar(1 - 2.5 * dt)
    if (!p.down) { p.down = true; p.axis = V(p.vel.z, 0, -p.vel.x).normalize(); if (p.axis.lengthSq() < 0.1) p.axis.set(1, 0, 0) }
    p.tilt = Math.min(Math.PI / 2, p.tilt + dt * 6)
    p.mesh.position.copy(p.pos); p.mesh.quaternion.setFromAxisAngle(p.axis, p.tilt)
    if (p.vel.length() > 0.15) moving = true
  }
  if (S.gutter && bc.z < S.laneL) { S.pos.addScaledVector(S.fwd, dt * 4); moving = true; if (bc.z > S.laneL) moving = false }
  if (!moving) endRoll()
}
function endRoll() {
  S.rolling = false; S.gutter = false
  const down = S.pins.filter((p) => p.down && !p.gone).length
  const f = S.frames[S.frame] || (S.frames[S.frame] = [])
  f.push(down)
  const total = f.reduce((a, b) => a + b, 0), last = S.frame === 9
  let next = false
  if (!last) { if (down === 10 && S.roll === 0) { ctx.toast('STRIKE!', 2500); ctx.burst(P(0, S.laneL - 0.6, 0.5), ST.objective, 40, 0.07); next = true } else if (S.roll === 1) { if (total === 10) ctx.toast('SPARE!'); next = true } }
  else { const r = f.length; if (r === 3 || (r === 2 && total < 10)) { S.over = true; ctx.toast('GAME OVER · ' + bowlScore() + ' · PINCH MENU FOR ANOTHER', 8000) } else if (down === 10 || (r === 2 && total >= 10)) { ctx.toast(down === 10 ? 'STRIKE!' : 'SPARE!'); rack(true); S.roll = r; return } }
  if (next) { S.frame++; S.roll = 0; rack(true) } else if (!S.over) { S.roll++; rack(false) }
}
function bowlScore() {
  const rolls = [].concat(...S.frames); let sc = 0, i = 0
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (rolls[i] === 10) { sc += 10 + (rolls[i + 1] || 0) + (rolls[i + 2] || 0); i += 1 }
    else if ((rolls[i] || 0) + (rolls[i + 1] || 0) === 10) { sc += 10 + (rolls[i + 2] || 0); i += 2 }
    else { sc += (rolls[i] || 0) + (rolls[i + 1] || 0); i += 2 }
  }
  return sc
}
// ---- cornhole
function startCornhole() {
  clear(); S.mode = 'cornhole'
  const dist = S.backyard ? 6 : 8.23
  setupFrame(0)
  S.board = P(0, dist, 0)
  // slanted board: 4×2 ft, front 3 in high, back 12 in, hole 6 in, 9 in from the top
  const g = new THREE.Group(); g.position.copy(S.board); g.quaternion.setFromUnitVectors(V(0, 0, 1), S.fwd); S.root.add(g)
  const tilt = Math.atan2(0.23, 1.22)
  const top = new THREE.Group(); top.position.set(0, 0.19, 0); top.rotation.x = -tilt; g.add(top)
  ctx.part(top, 0, 0, 0, 0.61, 0.02, 1.22, 0x39d5ff); ctx.part(top, 0, 0.012, 0, 0.5, 0.004, 1.1, 0x1f6fa8)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 8, 24), ctx.mat(0xffb21e)); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.015, 0.38); top.add(ring)
  S.boardTop = top; S.tilt = tilt
  g.updateMatrixWorld(true); S.hole = new THREE.Vector3(); ring.getWorldPosition(S.hole)
  S.bags = []; S.total = { me: 0, cpu: 0 }; S.round = { me: 0, cpu: 0 }; S.left = { me: 4, cpu: 4 }; S.turn = 'me'
  S.throwFrom = () => (ctx.hand.pos ? ctx.hand.pos.clone() : ctx.viewPos().clone().addScaledVector(ctx.flatForward(), 0.4).add(V(0.15, -0.35, 0)))
  ctx.toast('HOLD A PINCH, SWING UNDERHAND, LET GO', 4500)
}
function boardLocal(p) { const d = p.clone().sub(S.board); return V(d.dot(S.side), d.y, d.dot(S.fwd)) }
function launchBag(who, vel) {
  const from = who === 'me' ? S.throwFrom() : P(0.4, -0.2, 1.1)
  const m = new THREE.Mesh(ctx.boxGeo, ctx.mat(who === 'me' ? 0xff3d52 : 0xffb21e)); m.scale.set(0.15, 0.04, 0.15); m.position.copy(from); ctx.group.add(m)
  S.flying = { mesh: m, pos: from.clone(), vel, who }
  S.left[who]--; ctx.beep('tap')
}
function tickCornhole(dt, now) {
  S.line1 = 'YOU ' + S.total.me + ' – ' + S.total.cpu + ' CPU   (THIS ROUND ' + S.round.me + '–' + S.round.cpu + ')'
  S.line2 = 'BAGS LEFT · YOU ' + S.left.me + ' · CPU ' + S.left.cpu + (S.turn === 'cpu' ? ' · CPU THROWING' : ' · YOUR THROW'); score()
  const f = S.flying
  if (f) {
    f.vel.y -= G * dt; f.pos.addScaledVector(f.vel, dt); f.mesh.position.copy(f.pos); f.mesh.rotation.y += dt * 5
    const bl = boardLocal(f.pos)
    const onBoardXZ = Math.abs(bl.x) < 0.31 && bl.z > -0.61 && bl.z < 0.61
    const surfY = 0.19 + Math.tan(S.tilt) * bl.z
    if (onBoardXZ && bl.y <= surfY + 0.02 && f.vel.y < 0) {
      const holeD = Math.hypot(bl.x, bl.z - 0.38 / Math.cos(S.tilt))
      if (holeD < 0.085) { land(f, 3); ctx.burst(S.hole.clone(), ST.objective, 26, 0.05); ctx.toast(f.who === 'me' ? 'CORNHOLE! +3' : 'CPU CORNHOLE'); f.mesh.visible = false }
      else { f.pos.y = S.board.y + surfY + 0.02; land(f, 1); f.mesh.position.copy(f.pos) }
    } else if (f.pos.y < 0.02) { f.pos.y = 0.02; f.mesh.position.copy(f.pos); land(f, 0) }
  } else if (S.turn === 'cpu' && now > (S.cpuAt || 0)) {
    const tgt = S.hole.clone().add(V((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.9))
    const from = P(0.4, -0.2, 1.1), d = tgt.clone().sub(from), t = 1.15, flat = V(d.x, 0, d.z)
    launchBag('cpu', flat.multiplyScalar(1 / t).add(V(0, (d.y + 0.5 * G * t * t) / t, 0)))
  }
}
function land(f, pts) {
  S.round[f.who] += pts; S.bags.push(f.mesh); S.flying = null
  if (pts === 1) ctx.toast((f.who === 'me' ? 'ON THE BOARD' : 'CPU ON THE BOARD') + ' +1', 1500)
  // alternate throws; CPU waits a beat
  S.turn = f.who === 'me' ? (S.left.cpu > 0 ? 'cpu' : 'me') : (S.left.me > 0 ? 'me' : 'cpu')
  S.cpuAt = Date.now() + 1300
  if (S.left.me === 0 && S.left.cpu === 0) setTimeout(endRound, 1500)
}
function endRound() {
  if (!S || S.mode !== 'cornhole') return
  const diff = S.round.me - S.round.cpu
  if (diff > 0) S.total.me += diff; else S.total.cpu -= diff
  ctx.toast(diff === 0 ? 'ROUND CANCELS OUT' : (diff > 0 ? 'YOU SCORE ' + diff : 'CPU SCORES ' + -diff), 3000)
  S.bags.forEach((b) => ctx.group.remove(b)); S.bags = []
  S.round = { me: 0, cpu: 0 }; S.left = { me: 4, cpu: 4 }; S.turn = diff >= 0 ? 'me' : 'cpu'; S.cpuAt = Date.now() + 2500
  if (S.total.me >= 21 || S.total.cpu >= 21) { ctx.toast(S.total.me >= 21 ? 'YOU WIN 21!' : 'CPU WINS 21', 6000); S.total = { me: 0, cpu: 0 } }
}
void shuffle
