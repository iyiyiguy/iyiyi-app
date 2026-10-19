// iYiYi CHESS for XR glasses: tabletop (44 cm), floor (2 m) or life-size (7.6 m board, 1.8 m kings).
// Point at a piece and pinch to pick it up (legal squares green, captures red), point at a square
// and pinch to move. Full rules; CPU (easy / normal / hard) or a friend taking turns. Captured
// pieces burst into blocks and pile up beside the board.
import * as E from './chess-engine.js'

const SIZES = [{ id: 'table', name: 'TABLETOP', sq: 0.055 }, { id: 'floor', name: 'FLOOR', sq: 0.25 }, { id: 'life', name: 'LIFE-SIZE', sq: 0.95 }]
const LEVELS = [{ name: 'EASY', depth: 1, noise: 120 }, { name: 'NORMAL', depth: 2, noise: 15 }, { name: 'HARD', depth: 3, noise: 0 }]
const CREAM = 0xffedbd, CRIMSON = 0xff3352, GOLD = 0xffc733, CYAN = 0x39d5ff, GREEN = 0x5cf27f, RED = 0xff4033
let ctx, THREE, S

export default {
  title: 'CHESS',
  start(c) { ctx = c; THREE = c.THREE; S = { sizeI: 0, levelI: 1, vsCpu: true }; ask() },
  stop() { S = null },
  tick(dt, now) { if (S && S.st) tick(dt, now) },
  select(ray) { if (S && S.st) pick(ray) },
}
const V = (x, y, z) => new THREE.Vector3(x, y, z)

function ask() {
  ctx.choose('Chess', [
    ['PLAY vs CPU', 'cpu', LEVELS[S.levelI].name], ['PLAY A FRIEND', 'friend', 'TAKE TURNS'],
    ['BOARD: ' + SIZES[S.sizeI].name, 'size', 'TAP TO CHANGE'], ['CPU: ' + LEVELS[S.levelI].name, 'level', 'TAP TO CHANGE'],
    ...(S.st && !S.over ? [['RESUME', 'resume', '']] : []),
  ], (v) => {
    if (v === 'size') { S.sizeI = (S.sizeI + 1) % 3; if (S.st) { build(); ask() } else ask(); return }
    if (v === 'level') { S.levelI = (S.levelI + 1) % 3; ask(); return }
    if (v === 'resume') { build(); return }
    S.vsCpu = v === 'cpu'; S.st = E.initial(); S.over = ''; S.last = null; S.piles = { w: 0, b: 0 }
    build()
    ctx.toast(S.vsCpu ? 'YOU ARE CREAM · POINT AT A PIECE + PINCH' : 'CREAM MOVES FIRST · TAKE TURNS', 4000)
  })
}
function S2(i, h = 0) { const f = i % 8, r = Math.floor(i / 8); return S.origin.clone().addScaledVector(S.right, (f - 3.5) * S.sq).addScaledVector(S.fwd, (r - 3.5) * S.sq).add(V(0, h, 0)) }
function build() {
  while (ctx.group.children.length) ctx.group.remove(ctx.group.children[0])
  const size = SIZES[S.sizeI]; S.sq = size.sq
  const v = ctx.viewPos()
  S.fwd = ctx.flatForward(); S.right = ctx.right(S.fwd)
  const L = S.sq * 8
  let top = 0.003, near = 0.6
  if (size.id === 'table') { top = v.y - 0.5; near = 0.22 }
  if (size.id === 'life') near = 1
  S.origin = V(v.x, top, v.z).addScaledVector(S.fwd, near + L / 2)
  S.root = new THREE.Group(); ctx.group.add(S.root)
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), S.fwd)
  const th = Math.max(0.004, S.sq * 0.06)
  for (let i = 0; i < 64; i++) { const f = i % 8, r = Math.floor(i / 8); const m = ctx.box(S2(i, -th / 2), V(S.sq * 0.98, th, S.sq * 0.98), (f + r) % 2 ? 0x56668f : 0x202638, S.root); m.quaternion.copy(q) }
  const fw = S.sq * 0.25
  for (const [a, c, la, lc] of [[L / 2 + fw / 2, 0, fw, L + 2 * fw], [-L / 2 - fw / 2, 0, fw, L + 2 * fw], [0, L / 2 + fw / 2, L, fw], [0, -L / 2 - fw / 2, L, fw]]) {
    const m = ctx.box(S.origin.clone().addScaledVector(S.fwd, a).addScaledVector(S.right, c).add(V(0, -th / 2, 0)), V(lc, th * 1.4, la), 0xb38026, S.root); m.quaternion.copy(q)
  }
  S.pieces = S.st.b.map((p, i) => (p ? piece(p, i) : null))
  for (let n = 0; n < S.piles.w; n++) pile(true, n, false)
  for (let n = 0; n < S.piles.b; n++) pile(false, n, false)
  S.markers = []; S.markKey = ''; S.sel = -1; S.selMoves = []; S.anims = []
  if (S.vsCpu && !S.st.w) S.cpuAt = Date.now() + 800
}
function piece(ch, i) {
  const s = S.sq, g = new THREE.Group()
  const main = E.isW(ch) ? CREAM : CRIMSON, acc = E.isW(ch) ? CYAN : GOLD
  const add = (x, y, z, w, h, d, c) => ctx.part(g, x * s, (y + h / 2) * s, z * s, w * s, h * s, d * s, c)
  const u = ch.toUpperCase()
  if (u === 'P') { add(0, 0, 0, 0.6, 0.12, 0.6, acc); add(0, 0.12, 0, 0.36, 0.4, 0.36, main); add(0, 0.52, 0, 0.42, 0.32, 0.42, main) }
  else if (u === 'R') { add(0, 0, 0, 0.7, 0.14, 0.7, acc); add(0, 0.14, 0, 0.5, 0.7, 0.5, main); add(0, 0.84, 0, 0.62, 0.12, 0.62, main); for (const cx of [-1, 1]) for (const cz of [-1, 1]) add(cx * 0.22, 0.96, cz * 0.22, 0.18, 0.16, 0.18, main) }
  else if (u === 'N') { add(0, 0, 0, 0.7, 0.14, 0.7, acc); add(0, 0.14, -0.04, 0.44, 0.55, 0.44, main); add(0, 0.62, 0.08, 0.4, 0.34, 0.56, main); add(0, 0.62, 0.38, 0.3, 0.2, 0.3, main); add(-0.11, 0.96, -0.08, 0.1, 0.18, 0.1, main); add(0.11, 0.96, -0.08, 0.1, 0.18, 0.1, main); add(0, 0.7, -0.2, 0.12, 0.3, 0.12, acc) }
  else if (u === 'B') { add(0, 0, 0, 0.66, 0.14, 0.66, acc); add(0, 0.14, 0, 0.34, 0.8, 0.34, main); add(0, 0.94, 0, 0.44, 0.32, 0.44, main); add(0, 1.06, 0, 0.47, 0.05, 0.47, acc); add(0, 1.26, 0, 0.14, 0.14, 0.14, main) }
  else if (u === 'Q') { add(0, 0, 0, 0.74, 0.14, 0.74, acc); add(0, 0.14, 0, 0.42, 0.9, 0.42, main); add(0, 1.04, 0, 0.6, 0.08, 0.6, acc); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; add(Math.cos(a) * 0.22, 1.12, Math.sin(a) * 0.22, 0.12, 0.2, 0.12, main) } add(0, 1.18, 0, 0.18, 0.18, 0.18, acc) }
  else { add(0, 0, 0, 0.76, 0.14, 0.76, acc); add(0, 0.14, 0, 0.46, 1.0, 0.46, main); add(0, 1.14, 0, 0.64, 0.1, 0.64, acc); add(0, 1.24, 0, 0.5, 0.24, 0.5, main); add(0, 1.48, 0, 0.1, 0.42, 0.1, acc); add(0, 1.66, 0, 0.34, 0.1, 0.1, acc) }
  g.position.copy(S2(i))
  g.quaternion.setFromUnitVectors(V(0, 0, 1), E.isW(ch) ? S.fwd : S.fwd.clone().negate())
  S.root.add(g); return g
}
function pile(victimWhite, n, drop) {
  const sign = victimWhite ? -1 : 1, s = S.sq
  const base = S.origin.clone().addScaledVector(S.right, sign * (s * 4.9 + Math.floor(n / 8) * s)).addScaledVector(S.fwd, (-3.5 + (n % 8)) * s)
  for (let k = 0; k < 6; k++) {
    const land = S.origin.y + s * 0.11 + Math.floor(k / 3) * s * 0.2
    const m = new THREE.Mesh(ctx.boxGeo, ctx.mat(k % 2 ? (victimWhite ? CREAM : CRIMSON) : ctx.PAL[(n + k) % 6])); m.scale.setScalar(s * 0.22)
    m.position.copy(base).addScaledVector(S.right, (k % 3 - 1) * s * 0.24).add(V(0, drop ? s * (1.5 + k * 0.4) : land - S.origin.y + S.origin.y, 0)); m.position.y = drop ? S.origin.y + s * (1.5 + k * 0.4) : land
    m.rotation.y = Math.random() * Math.PI; S.root.add(m)
    if (drop) { const t0 = Date.now(); const y0 = m.position.y; S.anims.push({ custom: (dt) => { const t = (Date.now() - t0) / 1000; m.position.y = Math.max(land, y0 - 4.9 * t * t); return m.position.y <= land } }) }
  }
}
function squareFromRay(ray) {
  const p = ctx.rayFloor(ray, S.origin.y); if (!p) return -1
  const d = p.sub(S.origin), f = Math.floor(d.dot(S.right) / S.sq + 4), r = Math.floor(d.dot(S.fwd) / S.sq + 4)
  return E.inB(f, r) ? r * 8 + f : -1
}
const humanTurn = () => !S.over && (!S.vsCpu || S.st.w)
function pick(ray) {
  if (S.anims.some((a) => !a.custom) || !humanTurn()) return
  const i = squareFromRay(ray)
  if (i < 0) { S.sel = -1; S.selMoves = []; return }
  const p = S.st.b[i]
  if (p && E.isW(p) === S.st.w) { S.sel = i; S.selMoves = E.legal(S.st).filter((m) => m.f === i); ctx.beep('tap'); if (!S.selMoves.length) ctx.toast("THAT " + E.NAMES[p.toUpperCase()].toUpperCase() + " CAN'T MOVE"); return }
  const m = S.selMoves.find((x) => x.t === i)
  if (m) play(m); else { S.sel = -1; S.selMoves = [] }
}
function play(m) {
  S.sel = -1; S.selMoves = []; S.last = m
  const obj = S.pieces[m.f]; S.pieces[m.f] = null
  const vSq = m.ep ? E.epVictim(m) : m.c ? m.t : -1
  if (vSq >= 0) { const v = S.pieces[vSq]; S.pieces[vSq] = null; setTimeout(() => { if (!S || !v) return; S.root.remove(v); ctx.burst(S2(vSq, S.sq * 0.5), 0xff3d52, 16, S.sq * 0.16); const n = E.isW(m.c) ? S.piles.w++ : S.piles.b++; pile(E.isW(m.c), n, true) }, 300) }
  const dist = Math.max(Math.abs((m.f % 8) - (m.t % 8)), Math.abs(Math.floor(m.f / 8) - Math.floor(m.t / 8)))
  S.anims.push({ obj, a: S2(m.f), b: S2(m.t), t: 0, dur: 0.3 + dist * 0.07, hop: m.p.toUpperCase() === 'N' ? S.sq * 0.9 : S.sq * 0.15, done: () => { if (m.promo && obj) { S.root.remove(obj); S.pieces[m.t] = piece(m.promo, m.t); ctx.toast('PROMOTED TO A QUEEN!') } } })
  S.pieces[m.t] = obj
  if (m.castle) { const rk = E.castleRook(m), ro = S.pieces[rk[0]]; S.pieces[rk[0]] = null; S.pieces[rk[1]] = ro; S.anims.push({ obj: ro, a: S2(rk[0]), b: S2(rk[1]), t: 0, dur: 0.45, hop: S.sq * 0.6 }) }
  S.st = E.make(S.st, m); S.markKey = ''
  ctx.beep('tap')
  const replies = E.legal(S.st), check = E.inCheck(S.st)
  const name = (w) => (S.vsCpu ? (w ? 'YOU' : 'CPU') : w ? 'CREAM' : 'RED')
  if (!replies.length) { S.over = check ? 'CHECKMATE! ' + name(!S.st.w) + (name(!S.st.w) === 'YOU' ? ' WIN' : ' WINS') : 'STALEMATE · DRAW'; ctx.toast(S.over, 9000); if (check) for (let k = 0; k < 4; k++) setTimeout(() => S && ctx.burst(S2(E.kingSq(S.st.b, S.st.w), S.sq * 2), 0xffb21e, 24, S.sq * 0.2), 400 + k * 500) }
  else if (S.st.half >= 100) { S.over = 'DRAW (50 MOVES)'; ctx.toast(S.over, 6000) }
  else if (E.insufficient(S.st.b)) { S.over = 'DRAW (ONLY KINGS)'; ctx.toast(S.over, 6000) }
  else if (check) ctx.toast('CHECK!', 2000)
  if (!S.over && S.vsCpu && !S.st.w) S.cpuAt = Date.now() + 700
}
function tick(dt, now) {
  // animations
  for (let i = S.anims.length - 1; i >= 0; i--) {
    const a = S.anims[i]
    if (a.custom) { if (a.custom(dt)) S.anims.splice(i, 1); continue }
    a.t += dt; const k = Math.min(1, a.t / a.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
    if (a.obj) a.obj.position.copy(a.a.clone().lerp(a.b, e)).add(V(0, Math.sin(Math.PI * k) * a.hop, 0))
    if (k >= 1) { S.anims.splice(i, 1); if (a.done) a.done() }
  }
  if (!S.over && S.vsCpu && !S.st.w && !S.anims.some((a) => !a.custom) && now > S.cpuAt) { const lv = LEVELS[S.levelI]; const m = E.bestMove(S.st, lv.depth, lv.noise); if (m) play(m) }
  // markers: where you point (gold), selected (cyan), legal moves (green), captures (red), last move
  const ray = { origin: ctx.viewPos(), dir: ctx.viewDir() }
  const hover = squareFromRay(ray)
  const key = hover + '|' + S.sel + '|' + S.selMoves.length + '|' + (S.last ? S.last.f + '-' + S.last.t : '')
  if (key !== S.markKey) {
    S.markKey = key
    S.markers.forEach((m) => S.root.remove(m)); S.markers = []
    const s = S.sq, h = Math.max(0.003, s * 0.03), q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), S.fwd)
    const frame = (i, c, thick) => { const p = S2(i, h / 2 + 0.001); for (const [x, z, w, d] of [[0, s * 0.45, s * 0.96, thick], [0, -s * 0.45, s * 0.96, thick], [s * 0.45, 0, thick, s * 0.96], [-s * 0.45, 0, thick, s * 0.96]]) { const m = ctx.box(p.clone().addScaledVector(S.right, x).addScaledVector(S.fwd, z), V(w, h, d), c, S.root); m.quaternion.copy(q); S.markers.push(m) } }
    if (S.last) { frame(S.last.f, 0x736633, s * 0.05); frame(S.last.t, 0x998033, s * 0.05) }
    for (const m of S.selMoves) { if (m.c) frame(m.t, RED, s * 0.08); else { const b = ctx.box(S2(m.t, h / 2 + 0.001), V(s * 0.26, h, s * 0.26), GREEN, S.root); b.quaternion.copy(q); S.markers.push(b) } }
    if (S.sel >= 0) frame(S.sel, CYAN, s * 0.1)
    if (hover >= 0 && hover !== S.sel && humanTurn()) frame(hover, GOLD, s * 0.06)
  }
  const turn = S.over || (S.vsCpu ? (S.st.w ? 'YOUR MOVE' : 'CPU THINKING…') : S.st.w ? "CREAM'S MOVE" : "RED'S MOVE")
  const sqName = (i) => 'abcdefgh'[i % 8] + (Math.floor(i / 8) + 1)
  ctx.line(turn + (E.inCheck(S.st) && !S.over ? ' · CHECK' : ''), SIZES[S.sizeI].name + ' · ' + (S.last ? 'LAST: ' + E.NAMES[S.last.p.toUpperCase()].toUpperCase() + ' ' + sqName(S.last.f) + '→' + sqName(S.last.t) : 'POINT + PINCH'))
}
