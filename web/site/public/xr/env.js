// iYiYi environments for XR glasses. The glasses scan your surroundings (WebXR plane detection):
// the ground gets the theme (snow, lava, neon grid, wet Tokyo street) and every wall they find gets
// a light strip along its bottom edge (plus ceiling lines, outlines or signs, depending on the
// theme), with the glow reflecting on the floor. Without scanning (preview, older browsers) a
// stand-in street of glowing buildings is placed around you instead.
// Optical see-through glasses add light, so dark = clear: themes are drawn with glow, not paint.
let THREE, scene, root, theme = 'none'
const walls = new Map() // XRPlane -> { group, key }
let ground = null, particles = null, fallback = null, floorY = 0, t0 = Date.now(), lastView = null

export const THEMES = [
  { id: 'none', name: 'OFF', meta: 'REAL WORLD ONLY' },
  { id: 'snow', name: 'SNOW DAY', meta: 'SNOWY GROUND · FALLING FLAKES · ICE-BLUE UNDERGLOW' },
  { id: 'lava', name: 'LAVA', meta: 'GLOWING CRACKS · EMBERS · RED-HOT WALL LINES' },
  { id: 'hall', name: 'NEON HALLWAY', meta: 'PURPLE LIGHT STRIPS ON WALLS + CEILING' },
  { id: 'city', name: 'NEON CITY', meta: 'GLOWING GRID · BUILDINGS OUTLINED IN NEON' },
  { id: 'tokyo', name: 'TOKYO NEON', meta: 'SIGNS · LANTERNS · WET-STREET SHINE' },
]
const STRIP = { snow: [0x9be8ff], lava: [0xff4a1a, 0xffb21e], hall: [0xb070ff, 0xd9b3ff], city: [0xff2bd6, 0x39d5ff, 0x5cff7a, 0xffe633], tokyo: [0xff2b7a, 0x39d5ff, 0xff3d3d, 0xffb21e] }

export function initEnv(three, sc) { THREE = three; scene = sc; root = new THREE.Group(); root.name = 'env'; scene.add(root) }
export const currentTheme = () => theme
export function setTheme(id) {
  theme = id; t0 = Date.now()
  while (root.children.length) root.remove(root.children[0])
  walls.clear(); ground = particles = fallback = null
  if (id === 'none') return
  ground = makeGround(id); root.add(ground)
  particles = makeParticles(id); if (particles) root.add(particles)
}

// ---------------------------------------------------------------- textures (canvas, procedural)
let seed = 1
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  if (repeat > 1) { // tiles seamlessly: the same random picture is drawn at all 9 wrap offsets
    const s0 = 1 + Math.floor(Math.random() * 1e6)
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { seed = s0; g.save(); g.translate(dx, dy); draw(g, w, h); g.restore() }
  } else draw(g, w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); return t
}
const rnd = (a, b) => a + rand() * (b - a)
function groundTex(id) {
  if (id === 'snow') return canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i < 90; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(30, 90); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(235,245,255,0.55)'); gr.addColorStop(1, 'rgba(235,245,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r) }
    for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(255,255,255,' + rnd(0.3, 1) + ')'; g.fillRect(rnd(0, w), rnd(0, h), 2, 2) }
    g.strokeStyle = 'rgba(160,220,255,0.35)'; g.lineWidth = 3 // footprint trail
    for (let i = 0; i < 14; i++) { const x = 256 + Math.sin(i * 0.5) * 120 + (i % 2 ? 18 : -18), y = i * 36; g.beginPath(); g.ellipse(x, y, 7, 13, 0, 0, Math.PI * 2); g.stroke() }
  }, 6)
  if (id === 'lava') return canvasTex(512, 512, (g, w, h) => {
    const crack = (x, y, a, len, wd) => { for (let i = 0; i < len; i++) { const nx = x + Math.cos(a) * 9, ny = y + Math.sin(a) * 9; for (const [col, lw] of [['rgba(255,60,0,0.35)', wd * 5], ['rgba(255,120,0,0.8)', wd * 2], ['rgba(255,230,120,1)', wd * 0.7]]) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke() } x = nx; y = ny; a += rnd(-0.6, 0.6); if (rand() < 0.06 && wd > 1) crack(x, y, a + rnd(-1.4, 1.4), len / 2, wd * 0.6) } }
    for (let i = 0; i < 9; i++) crack(rnd(0, w), rnd(0, h), rnd(0, 6.3), 40, rnd(1.5, 3))
    for (let i = 0; i < 6; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(20, 50); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,200,60,0.9)'); gr.addColorStop(0.4, 'rgba(255,80,0,0.6)'); gr.addColorStop(1, 'rgba(255,40,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r) }
  }, 4)
  if (id === 'city') return canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i <= 8; i++) { const p = i * 64; for (const [col, lw] of [['rgba(57,213,255,0.25)', 9], ['rgba(57,213,255,0.9)', 2]]) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke() } for (const [col, lw] of [['rgba(255,43,214,0.25)', 9], ['rgba(255,43,214,0.9)', 2]]) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke() } }
  }, 10)
  if (id === 'hall') return canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i < 26; i++) { const x = rnd(0, w), wd = rnd(10, 40); const gr = g.createLinearGradient(x - wd, 0, x + wd, 0); gr.addColorStop(0, 'rgba(150,80,255,0)'); gr.addColorStop(0.5, 'rgba(170,110,255,' + rnd(0.15, 0.4) + ')'); gr.addColorStop(1, 'rgba(150,80,255,0)'); g.fillStyle = gr; g.fillRect(x - wd, 0, 2 * wd, h) }
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 140); gr.addColorStop(0, 'rgba(255,170,90,0.35)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h)
  }, 3)
  if (id === 'tokyo') return canvasTex(512, 512, (g, w, h) => {
    const cols = ['255,43,122', '57,213,255', '255,61,61', '255,178,30', '176,108,255']
    for (let i = 0; i < 34; i++) { const x = rnd(0, w), y = rnd(0, h), wd = rnd(6, 22), ln = rnd(60, 220), c = cols[i % cols.length]; const gr = g.createLinearGradient(0, y, 0, y + ln); gr.addColorStop(0, 'rgba(' + c + ',0.55)'); gr.addColorStop(1, 'rgba(' + c + ',0)'); g.fillStyle = gr; g.fillRect(x, y, wd, ln) }
    for (let i = 0; i < 12; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(25, 60); g.strokeStyle = 'rgba(200,230,255,0.1)'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2); g.stroke() }
  }, 4)
  return null
}
function glowTex() { // soft vertical falloff used for floor reflections and strip halos
  return canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h) })
}
let _glow = null
const glow = () => _glow || (_glow = glowTex())
const add = (hex, op = 1) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })

// ---------------------------------------------------------------- ground + particles
function makeGround(id) {
  const g = new THREE.Group()
  const tex = groundTex(id)
  const R = 14
  const fade = canvasTex(256, 256, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.6, '#fff'); gr.addColorStop(1, '#000'); c.fillStyle = gr; c.fillRect(0, 0, w, h) })
  const m = new THREE.MeshBasicMaterial({ map: tex, alphaMap: fade, transparent: true, opacity: id === 'snow' ? 0.85 : 1, blending: THREE.AdditiveBlending, depthWrite: false })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), m); plane.rotation.x = -Math.PI / 2; plane.position.y = 0.01
  g.add(plane); g.userData.plane = plane
  if (id === 'lava') { const m2 = m.clone(); m2.map = tex.clone(); m2.map.needsUpdate = true; m2.map.repeat.set(2.5, 2.5); m2.opacity = 0.6; const p2 = new THREE.Mesh(plane.geometry, m2); p2.rotation.x = -Math.PI / 2; p2.position.y = 0.012; g.add(p2); g.userData.plane2 = p2 }
  return g
}
function makeParticles(id) {
  const n = id === 'snow' ? 1400 : id === 'lava' ? 500 : id === 'tokyo' ? 600 : id === 'city' ? 300 : 200
  const pos = new Float32Array(n * 3), seed = new Float32Array(n)
  for (let i = 0; i < n; i++) { pos[i * 3] = rnd(-9, 9); pos[i * 3 + 1] = rnd(0, 6); pos[i * 3 + 2] = rnd(-9, 9); seed[i] = Math.random() }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const dot = canvasTex(32, 32, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w) })
  const col = { snow: 0xffffff, lava: 0xff7a1a, hall: 0xc9a6ff, city: 0x39d5ff, tokyo: 0xff8fc0 }[id]
  const m = new THREE.PointsMaterial({ color: col, size: id === 'snow' ? 0.05 : 0.04, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 })
  const p = new THREE.Points(geo, m); p.userData.seed = seed; p.frustumCulled = false
  return p
}

// ---------------------------------------------------------------- walls (detected or stand-in)
/** Strip of light from a to b (world points on the floor line), with a halo and a floor reflection. */
function lightLine(group, a, b, hex, opts = {}) {
  const len = a.distanceTo(b); if (len < 0.15) return
  const mid = a.clone().add(b).multiplyScalar(0.5), dir = b.clone().sub(a).normalize()
  const yaw = Math.atan2(dir.x, dir.z)
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, len), add(0xffffff, 0.95)); tube.position.copy(mid); tube.rotation.y = yaw; group.add(tube)
  const halo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len + 0.05), add(hex, 0.55)); halo.position.copy(mid); halo.rotation.y = yaw; group.add(halo)
  if (opts.reflect !== false) {
    // glow spilling on the floor away from the wall, and up the wall
    const n = opts.normal || new THREE.Vector3(dir.z, 0, -dir.x)
    const glowPlane = (w, h, op, center, yAxis) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: glow(), color: hex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      const z = new THREE.Vector3().crossVectors(dir, yAxis).normalize()
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, yAxis, z)); m.position.copy(center); group.add(m); return m
    }
    // glow spilling across the floor away from the wall (bright edge at the wall)
    if (!opts.down) glowPlane(len, 1.1, 0.5, mid.clone().addScaledVector(n, 0.55).setY(floorY + 0.015), n.clone().negate())
    // and washing up (or down from a ceiling line) the wall itself
    glowPlane(len, 0.7, 0.35, mid.clone().add(new THREE.Vector3(0, opts.down ? -0.35 : 0.35, 0)).addScaledVector(n, 0.02), new THREE.Vector3(0, opts.down ? 1 : -1, 0))
  }
  group.userData.tubes = (group.userData.tubes || []).concat([halo])
}
function signTex(text, hex) {
  const vertical = text.length <= 4
  return canvasTex(vertical ? 128 : 512, vertical ? 512 : 128, (g, w, h) => {
    const col = '#' + hex.toString(16).padStart(6, '0')
    g.clearRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 6; g.shadowColor = col; g.shadowBlur = 18; g.strokeRect(8, 8, w - 16, h - 16)
    g.fillStyle = col; g.font = '700 ' + (vertical ? 92 : 80) + 'px "Noto Sans JP", "Hiragino Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    if (vertical) text.split('').forEach((ch, i) => g.fillText(ch, w / 2, 70 + i * (h - 120) / Math.max(1, text.length - 1)))
    else g.fillText(text, w / 2, h / 2 + 4)
  })
}
const SIGNS = ['ラーメン', '東京', 'カラオケ', '居酒屋', '寿司', '酒', 'iYiYi', 'ゲーム', '24H', '原宿']
/** Decorate one wall: base corner a→b (on the floor), wall height h, outward normal n (into the room). */
function decorateWall(group, a, b, h, n, idx) {
  const cols = STRIP[theme]
  const c1 = cols[idx % cols.length], c2 = cols[(idx + 1) % cols.length]
  lightLine(group, a, b, c1, { normal: n })
  const up = (p, y) => p.clone().setY(floorY + y)
  if (theme === 'hall') {
    lightLine(group, up(a, Math.min(h, 2.5)), up(b, Math.min(h, 2.5)), c2, { normal: n, down: true })
    for (const y of [0.9, 1.35]) lightLine(group, up(a, y).addScaledVector(n, 0.01), up(b, y).addScaledVector(n, 0.01), cols[0], { reflect: false })
  } else if (theme === 'city') {
    const hh = Math.max(2.2, h)
    lightLine(group, up(a, 0), up(a, hh), c2, { reflect: false }); lightLine(group, up(b, 0), up(b, hh), c2, { reflect: false })
    lightLine(group, up(a, hh), up(b, hh), c1, { reflect: false })
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize()
    for (let x = 0.4; x < len - 0.3; x += 0.6) for (let y = 0.7; y < hh - 0.3; y += 0.55) if (Math.random() < 0.45) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), add(cols[Math.floor(Math.random() * cols.length)], 0.35)); w.position.copy(a).addScaledVector(dir, x).addScaledVector(n, 0.02).setY(floorY + y); w.rotation.y = Math.atan2(n.x, n.z); group.add(w) }
  } else if (theme === 'tokyo') {
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize()
    for (let x = 0.5, k = 0; x < len - 0.3; x += 1.3, k++) {
      const txt = SIGNS[(idx * 3 + k) % SIGNS.length], vert = txt.length <= 4, hex = cols[(k + idx) % cols.length]
      const w = vert ? 0.5 : 1.4, hh = vert ? 1.9 : 0.36
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: signTex(txt, hex), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      // vertical signs stick out from the wall like a Tokyo side street; wide ones sit flat above doors
      s.position.copy(a).addScaledVector(dir, x).addScaledVector(n, vert && k % 3 === 2 ? 0.35 : 0.04).setY(floorY + (vert ? 2.6 + (k % 2) * 0.5 : 1.95 + (k % 3) * 0.6))
      s.rotation.y = Math.atan2(n.x, n.z) + (vert && k % 3 === 2 ? Math.PI / 2 : 0); group.add(s)
      group.userData.signs = (group.userData.signs || []).concat([s])
      const glowS = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, hh * 1.25), new THREE.MeshBasicMaterial({ map: glow(), color: hex, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      glowS.position.copy(s.position); glowS.rotation.copy(s.rotation); group.add(glowS)
    }
    for (let x = 0.3; x < len; x += 0.7) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), add(0xff3d3d, 0.8)); l.scale.y = 1.3; l.position.copy(a).addScaledVector(dir, x).addScaledVector(n, 0.15).setY(floorY + Math.min(h, 2.6) - 0.1); group.add(l) }
  } else if (theme === 'lava') {
    lightLine(group, up(a, 0.18).addScaledVector(n, 0.01), up(b, 0.18).addScaledVector(n, 0.01), c2, { reflect: false })
  }
}
function updateWalls(frame, ref) {
  const planes = frame && frame.detectedPlanes
  if (!planes || !planes.size) { if (!fallback && Date.now() - t0 > 2500) { fallback = makeFallback(lastView); root.add(fallback) } return }
  if (fallback) { root.remove(fallback); fallback = null }
  let idx = 0
  for (const plane of planes) {
    idx++
    const pose = frame.getPose(plane.planeSpace, ref); if (!pose) continue
    const M = new THREE.Matrix4().fromArray(pose.transform.matrix)
    if (plane.orientation === 'horizontal') { const y = new THREE.Vector3().setFromMatrixPosition(M).y; if (y < 0.3 && y > -0.5) floorY = floorY * 0.9 + y * 0.1; continue }
    const key = (plane.lastChangedTime || 0) + ':' + plane.polygon.length
    let w = walls.get(plane)
    if (w && w.key === key) continue
    if (w) root.remove(w.group)
    const pts = plane.polygon.map((p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(M))
    if (pts.length < 3) continue
    const ymin = Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y))
    const n = new THREE.Vector3(0, 1, 0).transformDirection(M); n.y = 0; if (n.lengthSq() < 0.01) continue; n.normalize() // plane normal points into the room
    const along = new THREE.Vector3(-n.z, 0, n.x)
    const s = pts.map((p) => p.dot(along)), lo = Math.min(...s), hi = Math.max(...s)
    const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length)
    const base = c.clone().addScaledVector(along, -c.dot(along)); base.y = floorY + 0.03
    const a = base.clone().addScaledVector(along, lo), b = base.clone().addScaledVector(along, hi)
    const group = new THREE.Group(); decorateWall(group, a, b, ymax - Math.max(floorY, ymin) + Math.max(0, ymin - floorY), n, idx)
    root.add(group); walls.set(plane, { group, key })
  }
  for (const [pl, w] of walls) if (!planes.has(pl)) { root.remove(w.group); walls.delete(pl) }
}
/** No scanning available: a ring of stand-in walls/buildings around where you're standing. */
function makeFallback(at) {
  const g = new THREE.Group(), cam = new THREE.Vector3(at ? at.x : 0, 0, at ? at.z : 0)
  const R = theme === 'hall' ? 1.6 : 6
  if (theme === 'hall') {
    for (const side of [-1, 1]) { const a = new THREE.Vector3(cam.x + side * R, floorY + 0.03, cam.z + 8), b = new THREE.Vector3(cam.x + side * R, floorY + 0.03, cam.z - 12); decorateWall(g, a, b, 2.6, new THREE.Vector3(-side, 0, 0), side + 2) }
    const end = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: glow(), color: 0xffa060, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); end.position.set(cam.x, 1.3, cam.z - 12); g.add(end)
  } else {
    const n = 8
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.7) / n) * Math.PI * 2, r = R + (i % 3) * 1.5
      const a = new THREE.Vector3(cam.x + Math.sin(a0) * r, floorY + 0.03, cam.z + Math.cos(a0) * r), b = new THREE.Vector3(cam.x + Math.sin(a1) * r, floorY + 0.03, cam.z + Math.cos(a1) * r)
      const mid = a.clone().add(b).multiplyScalar(0.5), nn = cam.clone().sub(mid).setY(0).normalize()
      decorateWall(g, a, b, theme === 'city' ? 3 + (i % 4) * 1.6 : 3, nn, i)
    }
  }
  return g
}

// ---------------------------------------------------------------- per frame
export function tickEnv(dt, frame, ref, viewPos) {
  if (theme === 'none' || !root) return
  lastView = viewPos
  if (frame && ref) updateWalls(frame, ref); else if (!fallback && !walls.size) { fallback = makeFallback(viewPos); root.add(fallback) }
  const t = (Date.now() - t0) / 1000
  if (ground) {
    // the ground stays put in the world (it doesn't slide with you) and re-centres every few metres
    const pl = ground.userData.plane
    const cx = Math.round(viewPos.x / 4) * 4, cz = Math.round(viewPos.z / 4) * 4
    ground.position.set(cx, floorY, cz)
    const tex = pl.material.map, rep = tex.repeat.x, size = 28
    tex.offset.set((cx / size) * rep, (-cz / size) * rep)
    if (theme === 'lava') { pl.material.opacity = 0.75 + Math.sin(t * 1.7) * 0.25; const p2 = ground.userData.plane2; p2.material.map.offset.x = t * 0.01 + (cx / size) * 2.5; p2.material.map.offset.y = t * 0.006 - (cz / size) * 2.5 }
    if (theme === 'hall' || theme === 'tokyo') tex.offset.y += Math.sin(t * 0.5) * 0.002
  }
  if (particles) {
    const pos = particles.geometry.attributes.position, seed = particles.userData.seed, n = seed.length
    for (let i = 0; i < n; i++) {
      let x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2], s = seed[i]
      if (theme === 'snow') { y -= dt * (0.4 + s * 0.5); x += Math.sin(t + s * 10) * dt * 0.2 }
      else if (theme === 'lava') { y += dt * (0.3 + s * 0.8); x += Math.sin(t * 2 + s * 20) * dt * 0.15 }
      else { y += Math.sin(t * 0.8 + s * 30) * dt * 0.08; x += Math.cos(t * 0.5 + s * 9) * dt * 0.05 }
      if (y < floorY) y = floorY + 6; if (y > floorY + 6) y = floorY
      if (x - viewPos.x > 9) x -= 18; if (x - viewPos.x < -9) x += 18; if (z - viewPos.z > 9) z -= 18; if (z - viewPos.z < -9) z += 18
      pos.array[i * 3] = x; pos.array[i * 3 + 1] = y; pos.array[i * 3 + 2] = z
    }
    pos.needsUpdate = true
  }
  // flicker some lights so it feels alive
  const pulse = 0.45 + Math.sin(t * 3) * 0.1
  root.traverse((o) => { if (o.userData.tubes) o.userData.tubes.forEach((h, i) => (h.material.opacity = pulse + Math.sin(t * 2 + i) * 0.08)); if (o.userData.signs) o.userData.signs.forEach((s, i) => (s.material.opacity = Math.sin(t * 7 + i * 3) > -0.92 ? 1 : 0.25)) })
}
