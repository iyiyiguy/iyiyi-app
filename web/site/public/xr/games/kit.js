// Shared pieces for the XR games: the app's penguins (Mafia / Beside Them characters, built from
// blocks like on the Specs) and small helpers. Units are meters, floor at y = 0.
// See-through glasses can't show black, so penguin "black" is a bright navy blue.
const PEN_DARK = 0x4d66d9, PEN_BELLY = 0xf7f7ff, PEN_ORANGE = 0xffa21e, WHITE = 0xffffff
export const ST = { friendly: 0x39d5ff, enemy: 0xff3d52, objective: 0xffb21e, health: 0x5cf2a0, armor: 0x7fb4ff, epic: 0xb06cff, night: 0xb9a6ff, text: 0xf2f4f7, line: 0x6b7590 }
export const hexStr = (h) => '#' + h.toString(16).padStart(6, '0')

/** outfit: vest | mafia | doctor | detective | crew. s = scale (1 ≈ 1.2 m tall). */
export function makePenguin(ctx, outfit, color, name, s = 1) {
  const { THREE } = ctx
  const group = new THREE.Group()
  const body = new THREE.Group(); group.add(body)
  const P = (par, x, y, z, sx, sy, sz, c) => ctx.part(par, x * s * 0.01, (y) * s * 0.01, z * s * 0.01, sx * s * 0.01, sy * s * 0.01, sz * s * 0.01, c)
  // parts are given in cm from the feet, like the Specs version (y = centre)
  P(body, 0, 42, 0, 50, 62, 40, PEN_DARK); P(body, 0, 38, 20.5, 34, 46, 2, PEN_BELLY)
  P(body, 0, 92, 0, 42, 38, 38, PEN_DARK); P(body, 0, 90, 19.5, 32, 24, 2, PEN_BELLY)
  P(body, -7, 95, 21, 6, 8, 1.5, 0x141a2e); P(body, 7, 95, 21, 6, 8, 1.5, 0x141a2e)
  P(body, -6, 97, 21.8, 2, 2, 1, WHITE); P(body, 8, 97, 21.8, 2, 2, 1, WHITE)
  P(body, 0, 85, 25, 12, 7, 10, PEN_ORANGE)
  P(body, -12, 2.5, 6, 16, 5, 22, PEN_ORANGE); P(body, 12, 2.5, 6, 16, 5, 22, PEN_ORANGE)
  P(body, -29, 50, 0, 8, 40, 22, PEN_DARK); P(body, 29, 50, 0, 8, 40, 22, PEN_DARK)
  const outfitG = new THREE.Group(); body.add(outfitG)
  const label = ctx.label(name, ctx.C.text, 0.55 * Math.max(0.7, s)); label.mesh.position.y = 1.4 * s; group.add(label.mesh)
  const bubble = ctx.label('', ctx.C.text, 0.9 * Math.max(0.7, s), 900, 140); bubble.mesh.position.y = 1.7 * s; group.add(bubble.mesh)
  const p = { group, body, outfit: outfitG, label, bubble, pos: new THREE.Vector3(), walk: 0, bubbleUntil: 0, s, name }
  p.dress = (o, col) => dress(ctx, p, o, col)
  p.say = (t, ms = 3500) => { bubble.set(t); p.bubbleUntil = Date.now() + ms }
  p.dress(outfit, color)
  ctx.group.add(group)
  return p
}
function dress(ctx, p, outfit, color) {
  const o = p.outfit, s = p.s
  while (o.children.length) o.remove(o.children[0])
  const P = (x, y, z, sx, sy, sz, c) => ctx.part(o, x * s * 0.01, y * s * 0.01, z * s * 0.01, sx * s * 0.01, sy * s * 0.01, sz * s * 0.01, c)
  if (outfit === 'vest') {
    P(-15, 46, 20.6, 14, 34, 2, color); P(15, 46, 20.6, 14, 34, 2, color); P(0, 46, -20.6, 50, 34, 2, color)
    P(-25.6, 46, 0, 2, 34, 40, color); P(25.6, 46, 0, 2, 34, 40, color)
    P(0, 50, 22, 3, 3, 1, ST.objective); P(0, 40, 22, 3, 3, 1, ST.objective)
    P(-5, 66, 22.5, 8, 6, 3, color); P(5, 66, 22.5, 8, 6, 3, color)
  } else if (outfit === 'mafia') {
    const suit = 0x80849e, stripe = 0xcdd1e6
    P(0, 40, 0, 54, 58, 44, suit)
    for (const x of [-18, -6, 6, 18]) P(x, 40, 22.2, 1.2, 56, 0.6, stripe)
    P(0, 58, 22.6, 12, 16, 1, PEN_BELLY); P(0, 50, 23.2, 5, 26, 1, ST.enemy)
    P(0, 112, 0, 58, 4, 54, suit); P(0, 122, 0, 40, 18, 38, suit); P(0, 115, 0, 41, 4, 39, ST.enemy)
    P(34, 52, 12, 6, 6, 6, ST.enemy); P(34, 42, 12, 2, 16, 2, ST.health)
  } else if (outfit === 'doctor') {
    P(0, 38, 0, 55, 54, 44, WHITE); P(0, 52, 23, 18, 22, 1, 0x2fd3c0)
    P(-9, 58, 23.4, 2, 18, 1, ST.armor); P(9, 58, 23.4, 2, 18, 1, ST.armor); P(0, 45, 23.6, 6, 6, 1, ST.armor)
    P(-38, 30, 10, 22, 16, 10, ST.enemy); P(-38, 30, 15.5, 10, 3, 1, WHITE); P(-38, 30, 15.5, 3, 10, 1, WHITE)
  } else if (outfit === 'detective') {
    const coat = 0xb07a3e, check = 0x8a5a2b
    P(0, 38, 0, 56, 58, 45, coat); P(0, 30, 23, 56, 4, 1, check)
    P(0, 114, 0, 46, 16, 42, coat); P(0, 109, 24, 40, 4, 12, check); P(0, 109, -24, 40, 4, 12, check); P(0, 123, 0, 8, 6, 8, check)
    P(36, 78, 18, 20, 20, 3, ST.objective); P(36, 78, 19.6, 14, 14, 1, 0xbfe9ff); P(36, 62, 18, 4, 14, 3, check)
  } else if (outfit === 'crew') {
    P(0, 44, 0, 54, 46, 44, color); P(0, 70, 22.6, 30, 6, 1, WHITE)
    P(0, 102, 21.5, 26, 12, 3, 0xbfe9ff); P(0, 114, 0, 44, 6, 40, color)
  }
}
/** stand at p.pos, turned toward `look` (default: you), waddling while it walks */
export function posePenguin(ctx, p, look, dt = 0, moving = false) {
  if (moving) p.walk += dt * 9
  const bob = moving ? Math.abs(Math.sin(p.walk)) * 0.04 : 0
  p.group.position.set(p.pos.x, bob, p.pos.z)
  const v = look || ctx.viewPos()
  p.group.lookAt(v.x, 0, v.z)
  p.body.rotation.z = moving ? Math.sin(p.walk) * 0.12 : 0
  if (Date.now() > p.bubbleUntil && p.bubble.key) p.bubble.set('')
}
/** index of the item you're pointing at (within a few degrees of `pt(i)`), or -1 */
export function pointedAt(ctx, ray, list, pt, ok = () => true, maxDeg = 7) {
  let best = -1, ba = 99
  list.forEach((it, i) => {
    if (!it || !ok(i)) return
    const c = pt(it), to = c.clone().sub(ray.origin), d = to.length()
    const a = Math.acos(Math.max(-1, Math.min(1, to.normalize().dot(ray.dir))))
    if (a < Math.max(maxDeg * ctx.D2R, Math.atan(0.35 / d)) && a < ba) { ba = a; best = i }
  })
  return best
}
export function beacon(ctx, at, color, text) {
  const { THREE } = ctx
  const g = new THREE.Group()
  ctx.part(g, 0, 1.2, 0, 0.04, 2.4, 0.04, color)
  ctx.part(g, 0, 0.01, 0, 0.7, 0.02, 0.7, color)
  const l = ctx.label(text, hexStr(color), 0.7); l.mesh.position.y = 2.6; g.add(l.mesh)
  g.position.copy(at); ctx.group.add(g)
  return g
}
export function arrowTo(ctx, p) {
  const v = ctx.viewPos(), to = new ctx.THREE.Vector3(p.x - v.x, 0, p.z - v.z), d = to.length()
  if (d < 0.6) return '● HERE'
  const f = ctx.flatForward(), r = ctx.right(f), n = to.normalize()
  const ang = Math.atan2(n.dot(r), n.dot(f)) / ctx.D2R, m = d.toFixed(1) + ' M'
  if (Math.abs(ang) < 20) return '▲ ' + m
  if (Math.abs(ang) > 150) return '▼ BEHIND YOU ' + m
  return ang < 0 ? '◀ ' + m : m + ' ▶'
}
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
