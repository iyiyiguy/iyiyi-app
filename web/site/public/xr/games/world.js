// iYiYi WORLD for XR glasses: a candy-coloured obstacle course built on the floor of your real
// space, raced against three penguin rivals. Walk the track, and use your body:
//   JUMP over the low spinning sweepers, DUCK under the high ones (the glasses watch your head),
//   time the swinging hammers, keep moving on the falling tiles, pick the door that breaks,
//   bounce on the pads and grab the stars. Bonks cost 3 seconds. Fastest finish wins coins.
// Preview / no tracking: pinch = jump, hold the pinch = duck.
import { makePenguin, posePenguin, ST, hexStr } from './kit.js'

const CANDY = [0xff4fa3, 0xffe633, 0x39d5ff, 0xb06cff, 0x5cf27f, 0xff8a33]
const AREAS = [{ name: 'ROOM', w: 2.6, d: 2.8, meta: 'ABOUT 3 × 3 M' }, { name: 'YARD', w: 7, d: 7, meta: 'ABOUT 8 × 8 M' }, { name: 'PARK', w: 12, d: 16, meta: 'UP TO 20 M' }]
const LANE = 1.3
let ctx, THREE, S
const V = (x, y, z) => new THREE.Vector3(x, y, z)
const BEST = 'iyx_world_best_'

export default {
  title: 'WORLD',
  start(c) { ctx = c; THREE = c.THREE; S = { area: 1 }; ask() },
  stop() { S = null },
  tick(dt, now) { if (S && S.path) tick(dt, now) },
  select() { if (S && S.path) { S.fakeJumpUntil = Date.now() + 650 } },
  release() {},
  _walk(sv) { const p = sAt(Math.min(S.total, sv)); return [p.pos.x, p.pos.z, S.total] },
}

function ask() {
  const best = localStorage.getItem(BEST + S.area)
  ctx.choose('iYiYi World', [
    ['START THE COURSE', 'go', best ? 'BEST ' + (+best).toFixed(1) + ' S' : 'RACE 3 PENGUINS'],
    ['SPACE: ' + AREAS[S.area].name, 'area', AREAS[S.area].meta],
    ['HOW TO PLAY', 'how', 'JUMP · DUCK · DODGE'],
  ], (v) => {
    if (v === 'area') { S.area = (S.area + 1) % 3; ask(); return }
    if (v === 'how') { ctx.toast('WALK THE TRACK · JUMP LOW BARS · DUCK HIGH BARS · DODGE HAMMERS · KEEP MOVING ON TILES', 7000); ask(); return }
    build()
  })
}

// ------------------------------------------------------------------ the course
function build() {
  while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0])
  const A = AREAS[S.area], v = ctx.viewPos(), f = ctx.flatForward(), r = ctx.right(f)
  // serpentine lanes inside the area, starting just in front of you
  const lanes = Math.max(2, Math.floor(A.w / LANE)), start = V(v.x, 0, v.z).addScaledVector(f, 0.6).addScaledVector(r, -((lanes - 1) * LANE) / 2)
  const pts = []
  for (let i = 0; i < lanes; i++) {
    const base = start.clone().addScaledVector(r, i * LANE)
    const a = base.clone(), b = base.clone().addScaledVector(f, A.d)
    if (i % 2) pts.push(b, a); else pts.push(a, b)
  }
  S.path = pts; S.segLen = []; S.total = 0
  for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); S.segLen.push(l); S.total += l }
  S.head0 = null; S.heads = []; S.obs = []; S.stars = []; S.rivals = []; S.t0 = 0; S.penalty = 0; S.stun = 0; S.done = false; S.prog = 0; S.got = 0
  // track: candy-striped floor tiles + rails
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dir = b.clone().sub(a).normalize(), len = S.segLen[i]
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir)
    for (let s = 0; s < len; s += 0.5) { const m = ctx.box(a.clone().addScaledVector(dir, s + 0.25).setY(0.004), V(LANE * 0.92, 0.008, 0.48), CANDY[(i + Math.floor(s * 2)) % CANDY.length]); m.quaternion.copy(q); m.material = ctx.mat(CANDY[(i + Math.floor(s * 2)) % CANDY.length], 0.35) }
    const side = ctx.right(dir)
    for (const sd of [-1, 1]) { const m = ctx.box(a.clone().addScaledVector(dir, len / 2).addScaledVector(side, sd * LANE * 0.5).setY(0.05), V(0.05, 0.1, len), sd < 0 ? 0xff4fa3 : 0x39d5ff); m.quaternion.copy(q) }
  }
  // start + finish arches
  arch(0, 'START', 0x39d5ff); S.finish = arch(S.total - 0.05, 'FINISH', 0xffe633)
  // obstacles every ~2.6 m along the track (not on the corners)
  const kinds = ['sweepLow', 'hammer', 'tiles', 'bounce', 'sweepHigh', 'doors', 'hammer', 'tiles', 'sweepLow', 'bounce', 'doors', 'sweepHigh']
  let k = Math.floor(Math.random() * 3)
  for (let s = 1.6; s < S.total - 1.2; s += 2.6) {
    const at = sAt(s); if (at.edge < 0.7) continue
    obstacle(kinds[k++ % kinds.length], s)
  }
  for (let s = 1.1; s < S.total - 0.6; s += 1.7) { const p = sAt(s); const st = ctx.box(p.pos.clone().addScaledVector(ctx.right(p.dir), (Math.random() - 0.5) * 0.7).setY(1.1 + Math.random() * 0.4), V(0.12, 0.12, 0.12), 0xffe633); st.userData.s = s; S.stars.push(st) }
  // rivals
  ;[['@BEANZ', 0xff4fa3], ['@WOBBLE', 0x5cf27f], ['@SPLAT', 0xb06cff]].forEach(([n, c], i) => {
    const p = makePenguin(ctx, 'crew', c, n, 0.6); S.rivals.push({ p, s: -0.3 - i * 0.3, lat: (i - 1) * 0.35, speed: 0.55 + Math.random() * 0.3, pause: 0, done: 0 })
  })
  S.countdown = Date.now() + 3200; S.calib = []
  ctx.toast('STAND STILL A SEC… 3', 1200)
}
function arch(s, text, col) {
  const p = sAt(s), r = ctx.right(p.dir), g = new THREE.Group()
  for (const sd of [-1, 1]) ctx.part(g, sd * LANE * 0.55, 1.1, 0, 0.12, 2.2, 0.12, col)
  ctx.part(g, 0, 2.2, 0, LANE * 1.22, 0.16, 0.12, col)
  const l = ctx.label(text, hexStr(col), 0.9); l.mesh.position.y = 2.5; g.add(l.mesh)
  g.position.copy(p.pos); g.lookAt(p.pos.clone().add(p.dir)); ctx.group.add(g); void r
  return g
}
/** position + direction at distance s along the track; edge = distance to the nearest corner */
function sAt(s) {
  let acc = 0
  for (let i = 0; i < S.segLen.length; i++) {
    const l = S.segLen[i]
    if (s <= acc + l || i === S.segLen.length - 1) { const a = S.path[i], b = S.path[i + 1], dir = b.clone().sub(a).normalize(), u = Math.max(0, Math.min(l, s - acc)); return { pos: a.clone().addScaledVector(dir, u), dir, seg: i, edge: Math.min(u, l - u) } }
    acc += l
  }
}
/** nearest track distance s for a world point (and the sideways offset) */
function project(p) {
  let best = { s: 0, d: 1e9, lat: 0 }, acc = 0
  for (let i = 0; i < S.segLen.length; i++) {
    const a = S.path[i], b = S.path[i + 1], dir = b.clone().sub(a).normalize(), l = S.segLen[i]
    const rel = V(p.x - a.x, 0, p.z - a.z), u = Math.max(0, Math.min(l, rel.dot(dir))), lat = rel.dot(ctx.right(dir)), q = a.clone().addScaledVector(dir, u), d = Math.hypot(p.x - q.x, p.z - q.z)
    if (d < best.d) best = { s: acc + u, d, lat }
    acc += l
  }
  return best
}
function obstacle(kind, s) {
  const p = sAt(s), r = ctx.right(p.dir), g = new THREE.Group(); g.position.copy(p.pos); g.lookAt(p.pos.clone().add(p.dir)); ctx.group.add(g)
  const o = { kind, s, g, col: CANDY[S.obs.length % CANDY.length], hitAt: 0 }
  if (kind === 'sweepLow' || kind === 'sweepHigh') {
    const h = kind === 'sweepLow' ? 0.28 : 1.25
    ctx.part(g, 0, h / 2, 0, 0.14, h, 0.14, 0xf2f4f7)
    o.arm = new THREE.Group(); o.arm.position.y = h; g.add(o.arm)
    ctx.part(o.arm, 0, 0, 0, LANE * 1.05, 0.09, 0.09, o.col); ctx.part(o.arm, LANE * 0.52, 0, 0, 0.14, 0.14, 0.14, 0xffe633); ctx.part(o.arm, -LANE * 0.52, 0, 0, 0.14, 0.14, 0.14, 0xffe633)
    o.speed = (kind === 'sweepLow' ? 1.6 : 1.3) * (Math.random() < 0.5 ? 1 : -1)
    const l = ctx.label(kind === 'sweepLow' ? 'JUMP!' : 'DUCK!', kind === 'sweepLow' ? '#ffe633' : '#39d5ff', 0.45); l.mesh.position.set(0, kind === 'sweepLow' ? 1.0 : 1.75, 0); g.add(l.mesh)
  } else if (kind === 'hammer') {
    ctx.part(g, -LANE * 0.62, 1.2, 0, 0.1, 2.4, 0.1, 0xf2f4f7); ctx.part(g, LANE * 0.62, 1.2, 0, 0.1, 2.4, 0.1, 0xf2f4f7); ctx.part(g, 0, 2.4, 0, LANE * 1.3, 0.1, 0.1, 0xf2f4f7)
    o.arm = new THREE.Group(); o.arm.position.y = 2.4; g.add(o.arm)
    ctx.part(o.arm, 0, -0.75, 0, 0.05, 1.5, 0.05, 0xd9dbe6); ctx.part(o.arm, 0, -1.55, 0, 0.42, 0.32, 0.32, o.col)
    o.speed = 1.9 + Math.random() * 0.6; o.phase = Math.random() * 6
  } else if (kind === 'tiles') {
    o.tiles = []
    for (let row = 0; row < 4; row++) for (let c = 0; c < 3; c++) {
      const t = ctx.part(g, (c - 1) * LANE / 3, 0.03, (row - 1.5) * 0.4, LANE / 3 - 0.04, 0.05, 0.36, CANDY[(row + c) % CANDY.length])
      t.userData = { row, c, stepped: 0, fallen: 0, home: t.position.y, col: CANDY[(row + c) % CANDY.length] }; o.tiles.push(t)
    }
  } else if (kind === 'bounce') {
    o.pad = ctx.part(g, 0, 0.04, 0, 0.7, 0.08, 0.7, 0x5cf27f); ctx.part(g, 0, 0.09, 0, 0.45, 0.02, 0.45, 0xffe633)
  } else if (kind === 'doors') {
    o.real = Math.floor(Math.random() * 3); o.doors = []
    for (let i = 0; i < 3; i++) { const d = ctx.part(g, (i - 1) * LANE / 3, 0.9, 0, LANE / 3 - 0.05, 1.8, 0.08, CANDY[(i * 2 + S.obs.length) % CANDY.length]); d.material = ctx.mat(d.material.color.getHex(), 0.7); o.doors.push(d) }
    ctx.part(g, 0, 1.85, 0, LANE * 1.05, 0.1, 0.12, 0xf2f4f7)
    const l = ctx.label('PICK A DOOR', '#f2f4f7', 0.5); l.mesh.position.y = 2.15; g.add(l.mesh)
  }
  void r
  S.obs.push(o)
}

// ------------------------------------------------------------------ play
function bonk(why, at) {
  if (Date.now() < S.stun) return
  S.penalty += 3; S.stun = Date.now() + 1200
  ctx.beep('ouch'); ctx.burst(at || ctx.viewPos().add(ctx.flatForward().multiplyScalar(0.4)), 0xff3d52, 18, 0.05)
  ctx.toast(why + ' · +3 S', 2000)
}
function tick(dt, now) {
  const v = ctx.viewPos()
  // countdown + head-height calibration (standing height)
  if (S.countdown) {
    S.calib.push(v.y)
    const left = Math.ceil((S.countdown - now) / 1000)
    ctx.line('GET READY · ' + Math.max(1, left), 'STAND TALL AT THE START ARCH')
    if (now >= S.countdown) { S.countdown = 0; const c = S.calib.slice().sort((a, b) => a - b); S.head0 = c[Math.floor(c.length / 2)] || v.y; S.t0 = now; ctx.toast('GO GO GO!', 1500); ctx.beep('hit') }
    animate(dt, now)
    return
  }
  const pr = project(v)
  const onTrack = pr.d < LANE * 0.9
  if (onTrack && pr.s > S.prog && pr.s - S.prog < 2.5) S.prog = pr.s
  const jumping = v.y > S.head0 + 0.1 || now < (S.fakeJumpUntil || 0)
  const ducking = v.y < S.head0 - 0.28 || (ctx.holding && (ctx.preview || ctx.TEST) && now > (S.fakeJumpUntil || 0))
  animate(dt, now)
  if (!S.done) {
    for (const o of S.obs) {
      const ds = pr.s - o.s
      if (o.kind === 'sweepLow' || o.kind === 'sweepHigh') {
        if (Math.abs(ds) > LANE * 0.55 || !onTrack) continue
        const local = o.g.worldToLocal(v.clone().setY(o.g.position.y)), ang = Math.atan2(local.z, local.x), rad = Math.hypot(local.x, local.z)
        const arm = o.arm.rotation.y, diff = Math.abs(Math.atan2(Math.sin(-ang - arm), Math.cos(-ang - arm)))
        const near = Math.min(diff, Math.PI - diff) < 0.22 && rad < LANE * 0.55 && rad > 0.05
        if (near && now - o.hitAt > 900) { o.hitAt = now; if (o.kind === 'sweepLow' ? !jumping : !ducking) bonk(o.kind === 'sweepLow' ? 'TRIPPED! JUMP NEXT TIME' : 'BONK! DUCK NEXT TIME'); else { ctx.beep('tap'); ctx.toast(o.kind === 'sweepLow' ? 'NICE JUMP!' : 'NICE DUCK!', 1000) } }
      } else if (o.kind === 'hammer') {
        if (Math.abs(ds) > 0.3 || !onTrack) continue
        const hx = Math.sin(o.arm.rotation.z) * 1.55
        const lat = o.g.worldToLocal(v.clone().setY(o.g.position.y)).x
        if (Math.abs(lat - hx) < 0.32 && now - o.hitAt > 1200) { o.hitAt = now; bonk('SMACKED BY THE HAMMER') }
      } else if (o.kind === 'tiles') {
        if (Math.abs(ds) > 0.85 || !onTrack) continue
        const local = o.g.worldToLocal(v.clone().setY(o.g.position.y)), row = Math.floor(local.z / 0.4 + 2), c = Math.floor(local.x / (LANE / 3) + 1.5)
        const t = o.tiles.find((x) => x.userData.row === row && x.userData.c === c)
        if (t) { const u = t.userData; if (u.fallen) { if (now - o.hitAt > 1500) { o.hitAt = now; bonk('YOU FELL THROUGH!') } } else if (!u.stepped) { u.stepped = now; t.material = ctx.mat(0xff3d52); ctx.beep('tap') } }
      } else if (o.kind === 'bounce') {
        if (Math.abs(ds) < 0.35 && Math.abs(pr.lat) < 0.35 && now - o.hitAt > 1500) { o.hitAt = now; ctx.beep('hit'); ctx.burst(o.g.position.clone().add(V(0, 0.3, 0)), 0x5cf27f, 26, 0.05); S.penalty -= 0.5; ctx.toast('BOING! −0.5 S', 1200) }
      } else if (o.kind === 'doors') {
        if (o.passed || ds < -0.05 || ds > 0.4 || !onTrack) continue
        o.passed = true
        const lat = o.g.worldToLocal(v.clone().setY(o.g.position.y)).x, i = Math.max(0, Math.min(2, Math.round(lat / (LANE / 3)) + 1))
        if (i === o.real) { const d = o.doors[i]; d.visible = false; ctx.burst(o.g.localToWorld(d.position.clone()), d.material.color.getHex(), 30, 0.07); ctx.beep('boom'); ctx.toast('SMASHED THROUGH!', 1200) }
        else { bonk('SOLID DOOR!'); const d = o.doors[o.real]; d.visible = false }
      }
    }
    for (const st of S.stars) { if (!st.visible) continue; const hp = ctx.hand && ctx.hand.pos; const d = Math.min(st.position.distanceTo(v.clone().setY(st.position.y)), hp ? hp.distanceTo(st.position) : 9); if (d < 0.35) { st.visible = false; S.got++; ctx.beep('tap'); ctx.burst(st.position.clone(), 0xffe633, 12, 0.03) } }
    if (S.prog > S.total - 0.25) finish(now)
  }
  const tNow = ((S.done ? S.doneAt : now) - S.t0) / 1000 + S.penalty
  const place = 1 + S.rivals.filter((r) => (r.done ? r.done : 1e9) < (S.done ? S.doneAt : now) || r.s > S.prog).length
  ctx.line(S.done ? 'FINISHED · ' + tNow.toFixed(1) + ' S · ' + ord(S.finalPlace) : tNow.toFixed(1) + ' S · ' + ord(place) + ' PLACE · ★ ' + S.got, S.done ? 'PINCH THE MENU TO RACE AGAIN' : Math.round((S.prog / S.total) * 100) + '% · ' + (jumping ? 'JUMPING' : ducking ? 'DUCKING' : 'JUMP LOW BARS · DUCK HIGH BARS'))
}
const ord = (n) => n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH')
function animate(dt, now) {
  const t = now / 1000
  for (const o of S.obs) {
    if (o.arm && (o.kind === 'sweepLow' || o.kind === 'sweepHigh')) o.arm.rotation.y += o.speed * dt
    if (o.kind === 'hammer') o.arm.rotation.z = Math.sin(t * o.speed + o.phase) * 0.95
    if (o.kind === 'bounce') o.pad.scale.y = 1 + Math.max(0, Math.sin(t * 6)) * 0.6
    if (o.kind === 'tiles') for (const tl of o.tiles) {
      const u = tl.userData
      if (u.stepped && !u.fallen && now - u.stepped > 900) u.fallen = now
      if (u.fallen) { tl.position.y = u.home - Math.min(3, ((now - u.fallen) / 1000) ** 2 * 4.9); if (now - u.fallen > 4000) { u.fallen = 0; u.stepped = 0; tl.position.y = u.home; tl.material = ctx.mat(u.col) } }
    }
  }
  for (const st of S.stars) st.rotation.y += dt * 3
  for (const r of S.rivals) {
    if (!S.countdown && !r.done) {
      if (now < r.pause) { /* bonked */ } else { r.s += r.speed * dt * (S.area === 0 ? 0.5 : 1); if (Math.random() < dt * 0.25) { r.pause = now + 900 + Math.random() * 1200; r.p.say(['oof!', 'BONK', 'wheee', 'nooo'][Math.floor(Math.random() * 4)], 900) } }
      if (r.s >= S.total - 0.1) { r.done = now; r.p.say('FINISHED!', 2000) }
    }
    const p = sAt(Math.max(0, Math.min(S.total - 0.1, r.s)))
    r.p.pos.copy(p.pos.addScaledVector(ctx.right(p.dir), r.lat))
    posePenguin(ctx, r.p, r.p.pos.clone().add(p.dir), dt, !S.countdown && !r.done && now >= r.pause)
  }
}
function finish(now) {
  S.done = true; S.doneAt = now
  const time = (now - S.t0) / 1000 + S.penalty
  const ahead = S.rivals.filter((r) => r.done && r.done < now).length
  S.finalPlace = ahead + 1
  const prev = Number(localStorage.getItem(BEST + S.area) || 0)
  const pb = !prev || time < prev
  if (pb) try { localStorage.setItem(BEST + S.area, String(time)) } catch (e) {}
  ctx.toast((S.finalPlace === 1 ? 'YOU WIN! ' : ord(S.finalPlace) + ' PLACE · ') + time.toFixed(1) + ' S' + (pb ? ' · NEW BEST!' : ''), 8000)
  for (let k = 0; k < 6; k++) setTimeout(() => S && ctx.burst(S.finish.position.clone().add(V((Math.random() - 0.5) * 1.4, 2 + Math.random() * 0.5, 0)), CANDY[k % 6], 30, 0.06), k * 250)
  ctx.beep('hit')
  setTimeout(() => ctx.earn && ctx.earn(30 + (S.finalPlace === 1 ? 40 : 0) + S.got * 5, 'WORLD'), 3000)
}
void ST
