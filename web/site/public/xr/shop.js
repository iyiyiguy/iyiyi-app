// iYiYi XR shop + looks. Coins are earned by playing on the glasses (wins, laser tag hits, jobs)
// and spent on gun skins, outfits, armor, avatars and ball colours. What you wear is shared live
// with other iYiYi glasses on a presence channel, so in laser tag they see your avatar, outfit
// and armor over your head (and you see theirs).
const KEY = 'iyx_wallet_v1'
export const CATALOG = {
  gun: [
    { id: 'blaster', name: 'BLASTER', price: 0, color: 0x39d5ff, w: 1 },
    { id: 'neon_smg', name: 'NEON SMG', price: 250, color: 0xff4fa3, w: 0.8 },
    { id: 'plasma', name: 'PLASMA RIFLE', price: 500, color: 0x5cf27f, w: 1.4 },
    { id: 'rail', name: 'RAILGUN', price: 800, color: 0xb06cff, w: 0.6, long: true },
    { id: 'sun', name: 'SOLAR CANNON', price: 1200, color: 0xffb21e, w: 2 },
    { id: 'rainbow', name: 'RAINBOW RAY', price: 1600, color: 'rainbow', w: 1.2 },
  ],
  outfit: [
    { id: 'vest', name: 'TEAM VEST', price: 0, color: 0x39d5ff },
    { id: 'hoodie', name: 'HOODIE', price: 150, color: 0xff4fa3 },
    { id: 'ninja', name: 'NINJA', price: 300, color: 0x2a2f45 },
    { id: 'astro', name: 'ASTRONAUT', price: 450, color: 0xf2f4f7 },
    { id: 'chef', name: 'CHEF', price: 300, color: 0xffffff },
    { id: 'cowboy', name: 'COWBOY', price: 400, color: 0xb07a3e },
    { id: 'king', name: 'ROYAL', price: 900, color: 0xb06cff },
  ],
  armor: [
    { id: 'none', name: 'NO ARMOR', price: 0, color: 0 },
    { id: 'light', name: 'LIGHT PLATES', price: 200, color: 0x7fb4ff, rings: 1 },
    { id: 'tactical', name: 'TACTICAL', price: 450, color: 0x5cf2a0, rings: 2 },
    { id: 'neon', name: 'NEON PLATE', price: 750, color: 0xff4fa3, rings: 2, glow: true },
    { id: 'gold', name: 'GOLD SET', price: 1400, color: 0xffc733, rings: 3, glow: true },
  ],
  avatar: [
    { id: 'penguin', name: 'PENGUIN', price: 0 },
    { id: 'robot', name: 'ROBOT', price: 200 },
    { id: 'cat', name: 'CAT', price: 200 },
    { id: 'alien', name: 'ALIEN', price: 350 },
    { id: 'skull', name: 'SKULL', price: 500 },
    { id: 'ghost', name: 'GHOST', price: 500 },
    { id: 'dragon', name: 'DRAGON', price: 1100 },
  ],
  ball: [
    { id: 'classic', name: 'CLASSIC', price: 0, color: null },
    { id: 'pink', name: 'NEON PINK', price: 100, color: 0xff4fa3 },
    { id: 'ice', name: 'ICE BLUE', price: 100, color: 0x9be8ff },
    { id: 'lava', name: 'LAVA', price: 250, color: 0xff5a1a },
    { id: 'toxic', name: 'TOXIC GREEN', price: 250, color: 0x7dff3a },
    { id: 'gold', name: 'GOLD', price: 600, color: 0xffc733 },
    { id: 'galaxy', name: 'GALAXY', price: 900, color: 'rainbow' },
  ],
}
export const CATS = [['gun', 'GUNS', 'LASER TAG BEAM + BLASTER'], ['outfit', 'OUTFITS', 'WHAT YOUR AVATAR WEARS'], ['armor', 'ARMOR', 'SHIELD RINGS OTHERS SEE'], ['avatar', 'AVATARS', 'OVER YOUR HEAD IN LASER TAG'], ['ball', 'BALLS', 'SPORTS BALL COLOURS']]
const DEFAULT = { coins: 300, owned: ['blaster', 'vest', 'none', 'penguin', 'classic'], equip: { gun: 'blaster', outfit: 'vest', armor: 'none', avatar: 'penguin', ball: 'classic' } }

let W = null
export function wallet() {
  if (W) return W
  try { W = JSON.parse(localStorage.getItem(KEY) || 'null') } catch (e) { W = null }
  if (!W || typeof W.coins !== 'number') W = JSON.parse(JSON.stringify(DEFAULT))
  for (const k of Object.keys(DEFAULT.equip)) if (!W.equip[k]) W.equip[k] = DEFAULT.equip[k]
  return W
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(W)) } catch (e) {} }
export const item = (cat, id) => CATALOG[cat].find((x) => x.id === id) || CATALOG[cat][0]
export const equipped = (cat) => item(cat, wallet().equip[cat])
export function earn(n) { wallet().coins += Math.max(0, Math.round(n)); save(); return W.coins }
export function buy(cat, id) {
  const w = wallet(), it = item(cat, id)
  if (w.owned.includes(id)) return 'owned'
  if (w.coins < it.price) return 'poor'
  w.coins -= it.price; w.owned.push(id); w.equip[cat] = id; save(); return 'ok'
}
export function equip(cat, id) { const w = wallet(); if (!w.owned.includes(id)) return false; w.equip[cat] = id; save(); return true }
export const rainbow = (t = Date.now()) => { const h = (t / 1000 * 0.25) % 1; const f = (n) => { const k = (n + h * 12) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }; return (f(0) << 16) | (f(8) << 8) | f(4) }
export const colorOf = (c) => (c === 'rainbow' ? rainbow() : c)

// ---- looks shared between glasses (presence on one channel, keyed by user id)
const looks = new Map() // userId -> equip
let looksCh = null
export function joinLooks(sb, userId) {
  if (looksCh || !userId) return
  looksCh = sb.channel('xr:looks', { config: { presence: { key: userId } } })
  looksCh.on('presence', { event: 'sync' }, () => { const ps = looksCh.presenceState(); looks.clear(); for (const id of Object.keys(ps)) { const m = ps[id] && ps[id][0]; if (m && m.equip) looks.set(id, m.equip) } })
  looksCh.subscribe((s) => { if (s === 'SUBSCRIBED') shareLook() })
}
export function shareLook() { if (looksCh && looksCh.state === 'joined') looksCh.track({ equip: wallet().equip, at: Date.now() }).catch(() => {}) }
export const lookOf = (userId) => looks.get(userId) || null
export function _testLook(userId, equip) { looks.set(userId, equip) }

// ---- 3D: avatar figure (head + outfit colour) and armor rings, ~0.5 m tall
export function buildAvatar(THREE, mat, look) {
  const g = new THREE.Group()
  const box = new THREE.BoxGeometry(1, 1, 1)
  const P = (x, y, z, sx, sy, sz, c) => { const m = new THREE.Mesh(box, mat(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m }
  const kind = (look && look.avatar) || 'penguin'
  const out = item('outfit', (look && look.outfit) || 'vest')
  const body = out.id === 'vest' ? 0x39d5ff : out.color
  // body in the outfit
  P(0, 0.1, 0, 0.26, 0.2, 0.18, body)
  if (out.id === 'hoodie') P(0, 0.3, -0.06, 0.3, 0.16, 0.1, body)
  if (out.id === 'ninja') P(0, 0.14, 0.095, 0.27, 0.03, 0.01, 0xff3d52)
  if (out.id === 'astro') P(0, 0.12, 0.1, 0.12, 0.08, 0.02, 0x39d5ff)
  if (out.id === 'chef') P(0, 0.5, 0, 0.18, 0.14, 0.18, 0xffffff)
  if (out.id === 'cowboy') { P(0, 0.44, 0, 0.36, 0.02, 0.36, 0x8a5a2b); P(0, 0.49, 0, 0.18, 0.1, 0.18, 0x8a5a2b) }
  if (out.id === 'king') { P(0, 0.45, 0, 0.2, 0.06, 0.2, 0xffc733); for (const x of [-0.07, 0, 0.07]) P(x, 0.5, 0.08, 0.03, 0.05, 0.03, 0xffc733) }
  // head
  const H = { penguin: 0x4d66d9, robot: 0xa9b3c9, cat: 0xffa21e, alien: 0x7dff3a, skull: 0xf2eeda, ghost: 0xeef3ff, dragon: 0x2fd37a }[kind] || 0x4d66d9
  P(0, 0.3, 0, 0.24, 0.2, 0.2, H)
  const eye = kind === 'alien' ? 0x101418 : kind === 'skull' ? 0x101418 : kind === 'robot' ? 0xff3d52 : 0x141a2e
  P(-0.05, 0.32, 0.101, 0.04, kind === 'alien' ? 0.06 : 0.04, 0.01, eye); P(0.05, 0.32, 0.101, 0.04, kind === 'alien' ? 0.06 : 0.04, 0.01, eye)
  if (kind === 'penguin') { P(0, 0.27, 0.11, 0.06, 0.03, 0.04, 0xffa21e); P(0, 0.08, 0.091, 0.14, 0.14, 0.01, 0xf7f7ff) }
  if (kind === 'robot') { P(0, 0.44, 0, 0.02, 0.08, 0.02, 0xa9b3c9); P(0, 0.49, 0, 0.05, 0.05, 0.05, 0xff3d52); P(0, 0.25, 0.101, 0.12, 0.02, 0.01, 0x39d5ff) }
  if (kind === 'cat') { P(-0.08, 0.43, 0, 0.05, 0.07, 0.04, H); P(0.08, 0.43, 0, 0.05, 0.07, 0.04, H); P(0, 0.28, 0.105, 0.03, 0.02, 0.01, 0xff4fa3) }
  if (kind === 'alien') { P(-0.06, 0.45, 0, 0.015, 0.1, 0.015, H); P(0.06, 0.45, 0, 0.015, 0.1, 0.015, H) }
  if (kind === 'skull') P(0, 0.24, 0.101, 0.1, 0.03, 0.01, 0x101418)
  if (kind === 'ghost') { P(0, 0.26, 0.101, 0.06, 0.04, 0.01, 0x141a2e); P(0, 0.06, 0, 0.26, 0.12, 0.18, 0xeef3ff) }
  if (kind === 'dragon') { P(-0.07, 0.43, -0.03, 0.03, 0.08, 0.03, 0xffb21e); P(0.07, 0.43, -0.03, 0.03, 0.08, 0.03, 0xffb21e); P(0, 0.28, 0.13, 0.12, 0.06, 0.08, H); P(-0.2, 0.15, -0.05, 0.12, 0.02, 0.14, 0xff5a1a); P(0.2, 0.15, -0.05, 0.12, 0.02, 0.14, 0xff5a1a) }
  // armor rings
  const ar = item('armor', (look && look.armor) || 'none')
  g.userData.rings = []
  for (let i = 0; i < (ar.rings || 0); i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.24 + i * 0.05, 0.012, 6, 28), mat(ar.color, ar.glow ? 0.9 : 1)); r.rotation.x = Math.PI / 2; r.position.y = 0.06 + i * 0.12
    g.add(r); g.userData.rings.push(r)
  }
  return g
}
