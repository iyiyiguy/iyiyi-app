// iYiYi x SPECS — display-only 3D hologram dioramas. Drag to rotate, buttons to zoom.
import * as THREE from '../xr/three.module.min.js';

const C = { cyan: 0x39d5ff, red: 0xff3d52, amber: 0xffb21e, green: 0x5cf2a0, purple: 0xb06cff, white: 0xeef1f8, pink: 0xff5fc8, blue: 0x5b7cff };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- kit: per-scene helpers that track holo materials + animations ----------
function makeKit(root) {
  const k = { mats: [], ups: [], root };
  k.holo = (color, op = 0.26) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); m.userData.base = op; k.mats.push(m); return m; };
  k.lmat = (color, op = 0.9) => { const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }); m.userData.base = op; k.mats.push(m); return m; };
  k.solid = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  k.add = (o, parent = root) => { parent.add(o); return o; };
  // holographic mesh: translucent fill + bright edges
  k.hm = (geo, color, op = 0.22, parent = root) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, k.holo(color, op)));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), k.lmat(color, 0.85)));
    parent.add(g); return g;
  };
  k.sm = (geo, color, parent = root, rough, metal) => { const m = new THREE.Mesh(geo, k.solid(color, rough, metal)); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  k.at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };
  k.line = (pts, color, op = 0.9, parent = root) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), k.lmat(color, op)); parent.add(l); return l; };
  k.segs = (pairs, color, op = 0.9, y = 0.03, parent = root) => {
    const p = []; pairs.forEach(([a, b, c, d]) => p.push(V(a, y, b), V(c, y, d)));
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(p), k.lmat(color, op)); parent.add(l); return l;
  };
  k.rect = (w, d, color, cx = 0, cz = 0, y = 0.03) => { const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2; return k.segs([[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]], color, 0.95, y); };
  k.fillRect = (w, d, color, cx = 0, cz = 0, op = 0.12) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), k.holo(color, op)); m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.025, cz); root.add(m); return m; };
  k.arcPts = (a, b, h, n = 40) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y += Math.sin(Math.PI * t) * h; pts.push(p); } return pts; };
  // animated ball travelling along an arc, with a dotted trail
  k.flight = (a, b, h, color, ball, speed = 0.45, trail = true) => {
    const pts = k.arcPts(a, b, h);
    if (trail) { const l = k.line(pts, color, 0.55); l.computeLineDistances?.(); }
    k.ups.push(t => { const u = (t * speed) % 1; const i = u * (pts.length - 1), i0 = Math.floor(i), f = i - i0; ball.position.copy(pts[i0]).lerp(pts[Math.min(i0 + 1, pts.length - 1)], f); ball.rotation.x += 0.15; });
    return pts;
  };
  k.spin = (o, s = 1, axis = 'y') => k.ups.push(() => { o.rotation[axis] += 0.01 * s; });
  k.bob = (o, amp = 0.1, s = 2, ph = 0) => { const y0 = o.position.y; k.ups.push(t => { o.position.y = y0 + Math.sin(t * s + ph) * amp; }); };
  k.blink = (mat, s = 6, ph = 0) => k.ups.push(t => { mat.opacity = (mat.userData.base || 0.8) * (0.5 + 0.5 * Math.max(0, Math.sin(t * s + ph))); });

  // ---- floating label (sprite) ----
  k.label = (text, color = C.cyan, opts = {}) => {
    const { sub = '', w: w0 = 1.5, bar = null, big = false, parent = root } = opts;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = sub || bar !== null ? 168 : 128;
    const w = w0 * 1.3; const g = cv.getContext('2d'); const hex = '#' + color.toString(16).padStart(6, '0');
    g.fillStyle = 'rgba(8,12,24,0.78)'; rr(g, 6, 6, 500, cv.height - 12, 34); g.fill();
    g.strokeStyle = hex; g.lineWidth = 5; rr(g, 6, 6, 500, cv.height - 12, 34); g.stroke();
    let fs = big ? 66 : 56; const font = n => `700 ${n}px "Chakra Petch", "Barlow Semi Condensed", system-ui, sans-serif`;
    g.font = font(fs); while (fs > 20 && g.measureText(text).width > 450) { fs -= 2; g.font = font(fs); }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, sub || bar !== null ? 62 : 66);
    if (sub) { let ss = 36; g.font = `600 ${ss}px "Barlow Semi Condensed", system-ui, sans-serif`; while (ss > 16 && g.measureText(sub).width > 450) { ss -= 2; g.font = `600 ${ss}px "Barlow Semi Condensed", system-ui, sans-serif`; } g.fillStyle = hex; g.fillText(sub, 256, 124); }
    if (bar !== null) { g.fillStyle = 'rgba(255,255,255,0.15)'; rr(g, 70, 110, 372, 26, 13); g.fill(); g.fillStyle = hex; rr(g, 70, 110, 372 * bar, 26, 13); g.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w, w * cv.height / 512, 1); parent.add(sp); return sp;
  };

  // ---- people ----
  // real: solid person with Specs-style glasses. holo: translucent avatar.
  k.person = (o = {}) => {
    const { real = true, color = C.cyan, shirt = 0x2b2f3a, pants = 0x3b4457, skin = 0xc68c62, hair = 0x241811, pose = 'stand', gear = false, tag = null, tagColor, glasses = real, scale = 1, hood = false } = o;
    const g = new THREE.Group(); g.scale.setScalar(scale);
    const part = (geo, col, x, y, z, parent = g) => {
      if (real) { const m = k.sm(geo, col, parent); m.position.set(x, y, z); return m; }
      const h = k.hm(geo, color, 0.2, parent); h.position.set(x, y, z); return h;
    };
    const leg = new THREE.CapsuleGeometry(0.075, 0.62, 4, 10);
    const lp = pose === 'run' ? 0.5 : pose === 'squat' ? 0.25 : 0;
    const L1 = new THREE.Group(), L2 = new THREE.Group(); L1.position.set(-0.1, 0.82, 0); L2.position.set(0.1, 0.82, 0); g.add(L1, L2);
    part(leg, pants, 0, -0.4, 0, L1); part(leg, pants, 0, -0.4, 0, L2); L1.rotation.x = lp; L2.rotation.x = -lp;
    part(new THREE.BoxGeometry(0.14, 0.07, 0.24), real ? 0xf2f2f2 : color, 0, -0.8, 0.05, L1); part(new THREE.BoxGeometry(0.14, 0.07, 0.24), real ? 0xf2f2f2 : color, 0, -0.8, 0.05, L2);
    part(new THREE.CapsuleGeometry(0.18, 0.38, 4, 12), shirt, 0, 1.15, 0);
    if (gear) { part(new THREE.BoxGeometry(0.56, 0.14, 0.32), shirt, 0, 1.4, 0); }
    const arm = new THREE.CapsuleGeometry(0.058, 0.5, 4, 8);
    const A1 = new THREE.Group(), A2 = new THREE.Group(); A1.position.set(-0.26, 1.38, 0); A2.position.set(0.26, 1.38, 0); g.add(A1, A2);
    part(arm, shirt, 0, -0.3, 0, A1); part(arm, shirt, 0, -0.3, 0, A2);
    part(new THREE.SphereGeometry(0.06, 10, 8), skin, 0, -0.6, 0, A1); part(new THREE.SphereGeometry(0.06, 10, 8), skin, 0, -0.6, 0, A2);
    const poses = { stand: [0.12, -0.12, 0, 0], throw: [0.3, -2.7, 0, 0.2], run: [0.2, -0.2, -0.7, 0.7], shoot: [0.1, 0, -1.5, -1.5], cheer: [2.7, -2.7, 0, 0], point: [0.15, -0.3, 0, -1.5], squat: [0.4, -0.4, -0.9, -0.9], swing: [0.2, -1.2, 0, -0.9] };
    const [z1, z2, x1, x2] = poses[pose] || poses.stand; A1.rotation.z = -z1; A2.rotation.z = -z2; A1.rotation.x = x1; A2.rotation.x = x2;
    if (pose === 'squat') { g.position.y = -0.12; }
    part(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skin, 0, 1.48, 0);
    const head = part(new THREE.SphereGeometry(0.135, 18, 14), skin, 0, 1.63, 0);
    if (gear) part(new THREE.SphereGeometry(0.165, 18, 14), shirt, 0, 1.65, -0.01);
    else if (hood) part(new THREE.SphereGeometry(0.16, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), shirt, 0, 1.64, -0.03);
    else if (real) { const h = part(new THREE.SphereGeometry(0.145, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 1.66, -0.01); h.rotation.x = -0.25; }
    if (glasses) {
      const fr = k.solid(0x0b0b0e, 0.35, 0.2);
      const gl = new THREE.Group(); gl.position.set(0, 1.645, 0.118); g.add(gl);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.065, 0.035), fr); gl.add(bar);
      const lensM = new THREE.MeshStandardMaterial({ color: 0x0d1a2a, roughness: 0.05, metalness: 0.6, emissive: color, emissiveIntensity: 0.25 });
      [-0.072, 0.072].forEach(x => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.052, 0.012), lensM); l.position.set(x, 0, 0.02); gl.add(l); });
      [-0.15, 0.15].forEach(x => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.2), fr); t.position.set(x, 0.01, -0.09); gl.add(t); });
    }
    if (tag) { const s = k.label(tag, tagColor || (real ? C.cyan : color), { w: 1.2, parent: g }); s.position.set(0, 2.15, 0); k.bob(s, 0.04, 1.6, Math.random() * 6); }
    root.add(g); g.userData.head = head; return g;
  };

  // ---- grounds ----
  k.disc = (color, r = 9, tex = null) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, 0.35, 96), [k.solid(0x10141f, 0.9), tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }) : k.solid(color, 1), k.solid(0x10141f)]);
    m.position.y = -0.175; m.receiveShadow = true; root.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.08, 0.035, 8, 160), k.holo(C.cyan, 0.9)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.0; root.add(ring);
    return m;
  };
  k.stripes = (c1, c2, n = 14, dir = 'z') => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c1 : c2; if (dir === 'z') g.fillRect(0, i * 512 / n, 512, 512 / n); else g.fillRect(i * 512 / n, 0, 512 / n, 512); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  k.noise = (base, spread = 18) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) { const v = (Math.random() - 0.5) * spread; g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 100})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  k.grass = () => k.disc(0, 9, k.stripes('#3f7d3a', '#4a8b41', 12));
  k.panel = (text, color, x, y, z, w = 2.2, sub = '') => { const s = k.label(text, color, { w, sub, big: true }); s.position.set(x, y, z); k.bob(s, 0.06, 1.2); return s; };
  k.fence = (r = 8.7, a0 = 2.4, a1 = 3.9) => { for (let a = a0; a < a1; a += 0.09) { const p = k.sm(new THREE.BoxGeometry(0.5, 1.4, 0.06), 0x8a6a4a); p.position.set(Math.cos(a) * r, 0.7, Math.sin(a) * r); p.lookAt(0, 0.7, 0); } };
  k.tree = (x, z, s = 1) => { const t = k.sm(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.4 * s, 8), 0x5a3d26); t.position.set(x, 0.7 * s, z); const c = k.sm(new THREE.IcosahedronGeometry(0.9 * s, 0), 0x2f6a33); c.position.set(x, 1.9 * s, z); };
  k.ball = (r, color, holoBall = true) => { const geo = new THREE.SphereGeometry(r, 16, 12); if (holoBall) { const b = k.hm(geo, color, 0.55); return b; } return k.sm(geo, color); };
  k.net = (w, h, y0, color = C.white, z = 0, rotY = 0, cells = 0.25) => {
    const g = new THREE.Group(); g.position.z = z; g.rotation.y = rotY; root.add(g);
    const p = []; for (let x = -w / 2; x <= w / 2 + 1e-6; x += cells) p.push(V(x, y0, 0), V(x, y0 + h, 0)); for (let y = y0; y <= y0 + h + 1e-6; y += cells) p.push(V(-w / 2, y, 0), V(w / 2, y, 0));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(p), k.lmat(color, 0.45)));
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.02), k.holo(C.white, 0.9)); top.position.y = y0 + h; g.add(top);
    [-w / 2, w / 2].forEach(x => { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, y0 + h, 8), k.holo(color, 0.6)); pole.position.set(x, (y0 + h) / 2, 0); g.add(pole); });
    return g;
  };
  k.beam = (a, b, color, ph = 0) => {
    const len = a.distanceTo(b); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), k.holo(color, 0.95));
    m.position.copy(a).lerp(b, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()); root.add(m);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 6), k.holo(color, 0.25)); glow.position.copy(m.position); glow.quaternion.copy(m.quaternion); root.add(glow);
    k.blink(m.material, 5, ph); k.blink(glow.material, 5, ph); return m;
  };
  k.ringMark = (x, z, color, r = 0.6) => { const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 40), k.holo(color, 0.8)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); root.add(m); k.ups.push(t => { const s = 1 + 0.15 * Math.sin(t * 4); m.scale.set(s, s, s); }); return m; };
  return k;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ---------- scenes ----------
const RF = { shirt: 0x1f2a44, pants: 0x2d3446 };            // real friend outfits
const RQ = { shirt: 0x8a2b2b, pants: 0x3a4250, skin: 0xa8714c }; // real QB / hero

export const SCENES = {
  football(k) {
    k.grass(); k.fence(8.7, 3.6, 5.8);
    for (let z = -7.5; z <= 7.5; z += 1.5) k.segs([[-7.2, z, 7.2, z]], C.white, 0.5);
    k.segs([[-7.2, 0, 7.2, 0]], C.blue, 1); k.segs([[-7.2, -3, 7.2, -3]], C.amber, 1);
    // holo stadium ring (outside the yard)
    for (let tier = 0; tier < 3; tier++) { const r = 10 + tier * 1.1; const geo = new THREE.CylinderGeometry(r, r, 0.9, 64, 1, true, 0.3, Math.PI * 2 - 0.6); const s = k.hm(geo, C.cyan, 0.05); s.position.y = 0.6 + tier * 0.9; s.rotation.y = Math.PI; }
    [-1, 1].forEach(sx => { const tower = k.hm(new THREE.BoxGeometry(0.3, 6, 0.3), C.cyan, 0.15); tower.position.set(sx * 11, 3, -8); const l = k.hm(new THREE.BoxGeometry(1.6, 0.6, 0.2), C.white, 0.6); l.position.set(sx * 11, 6.2, -8); });
    // offense faces -z. Real QB in the pocket
    k.at(k.person({ ...RQ, pose: 'throw', tag: '@colin.iyiyi', sub: '' }), 0, 0, 3, Math.PI);
    [-1.6, -0.8, 0, 0.8, 1.6].forEach(x => k.at(k.person({ real: false, color: C.cyan, gear: true, pose: 'squat' }), x, 0, 0.7, Math.PI));
    k.at(k.person({ real: false, color: C.cyan, gear: true }), 0.6, 0, 4.2, Math.PI);             // RB
    k.at(k.person({ ...RF, pose: 'run', tag: '@jay.cruz', tagColor: C.green }), -6, 0, 0.6, Math.PI); // real friend at WR
    k.at(k.person({ real: false, color: C.cyan, gear: true, pose: 'run' }), 6, 0, 0.6, Math.PI);
    k.at(k.person({ real: false, color: C.cyan, gear: true, pose: 'run' }), 3.6, 0, 1.2, Math.PI);  // slot
    // defense faces +z
    [-1.2, -0.4, 0.4, 1.2].forEach(x => k.at(k.person({ real: false, color: C.red, gear: true, pose: 'squat' }), x, 0, -0.7));
    [-2.6, 0, 2.6].forEach(x => k.at(k.person({ real: false, color: C.red, gear: true }), x, 0, -2.6));
    [-6, 6, 3.6].forEach(x => k.at(k.person({ real: false, color: C.red, gear: true }), x, 0, x === 3.6 ? -1.6 : -1.4));
    [-2.8, 2.8].forEach(x => k.at(k.person({ real: false, color: C.red, gear: true }), x, 0, -6.4));
    // auto-assist: best open target
    k.ringMark(-6.5, -4.8, C.green, 0.7); const open = k.label('OPEN · 92%', C.green, { w: 1.4 }); open.position.set(-6.5, 1.0, -4.8); k.bob(open, 0.08);
    const ball = k.hm(new THREE.SphereGeometry(0.14, 12, 8).scale(1, 1, 1.7), C.amber, 0.7);
    k.flight(V(0.2, 2.1, 3), V(-6.5, 1.3, -4.8), 3.2, C.green, ball, 0.35);
    k.panel('HOME 14  ·  AWAY 10', C.white, 0, 6.2, -9, 4, '3RD & 4 · Q4 2:11');
    return { dist: 19, h: 9 };
  },

  'laser-tag'(k) {
    k.disc(0, 9, k.noise('#30333b', 30));
    k.segs([[-9, 2, 9, 2], [-9, -2, 9, -2]], 0xffffff, 0.15);
    const dome = k.hm(new THREE.SphereGeometry(8.6, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), C.purple, 0.03); dome.children[1].material.opacity = 0.25; dome.children[1].material.userData.base = 0.25;
    // holo cover
    [[-3, 0, 1.6, 1.2], [3, 0.8, 1.2, 1.6], [0, -4, 2.4, 1], [-5, -4, 1, 2], [5, 4, 1.4, 1.4]].forEach(([x, z, w, h]) => { const b = k.hm(new THREE.BoxGeometry(w, h, 0.5), C.cyan, 0.12); b.position.set(x, h / 2, z); });
    // real players on two teams
    const P = [
      [{ ...RQ, pose: 'shoot', tag: '@colin', }, -1.5, 4, Math.PI * 0.9, C.cyan, 0.9],
      [{ ...RF, pose: 'shoot', }, -5.5, 2.5, Math.PI * 0.75, C.cyan, 0.6],
      [{ shirt: 0x4b4b4b, pants: 0x222831, skin: 0xe0b08a, pose: 'shoot' }, 2, -5.5, -0.15, C.red, 0.35],
      [{ shirt: 0x6b4a2b, pants: 0x2b2f3a, skin: 0x7a4f35, pose: 'run' }, 5.5, -2, -0.6, C.red, 0.7],
    ];
    P.forEach(([o, x, z, r, col, hp], i) => {
      const p = k.at(k.person(o), x, 0, z, r);
      const hb = k.label(o.tag || ['', '@maya.v', '@rio.sky', '@kai.p'][i], col, { w: 1.2, bar: hp }); hb.position.set(x, 2.25, z); k.bob(hb, 0.04, 1.5, i);
      const blaster = k.hm(new THREE.BoxGeometry(0.08, 0.12, 0.5), col, 0.6, p); blaster.position.set(0, 1.25, 0.55);
    });
    k.beam(V(-1.5, 1.3, 3.4), V(2, 1.4, -5.2), C.cyan, 0); k.beam(V(5.4, 1.3, -1.6), V(-5.2, 1.2, 2.3), C.red, 1.8);
    k.beam(V(2, 1.3, -5.0), V(-1.2, 1.5, 3.8), C.red, 3.2);
    const boom = k.hm(new THREE.IcosahedronGeometry(0.9, 1), C.amber, 0.25); boom.position.set(-3, 1.4, 0.3);
    k.ups.push(t => { const s = 0.4 + ((t * 0.8) % 1) * 1.4; boom.scale.setScalar(s); boom.children.forEach(c => c.material.opacity = (1 - ((t * 0.8) % 1)) * 0.6); });
    k.panel('TEAM DEATHMATCH', C.red, 0, 5.2, 0, 3, 'ZONE · 1 MILE · 4:32 LEFT');
    return { dist: 18, h: 8 };
  },

  tennis(k) {
    k.disc(0, 9, k.stripes('#5c9e48', '#68aa52', 16));
    const W = 4.9, L = 14.2, S = 3.7; // scaled doubles court
    k.rect(W, L, C.white); k.segs([[-S / 2, -L / 2, -S / 2, L / 2], [S / 2, -L / 2, S / 2, L / 2], [-S / 2, -3.85, S / 2, -3.85], [-S / 2, 3.85, S / 2, 3.85], [0, -3.85, 0, 3.85]], C.white, 0.95);
    k.fillRect(W, L, C.green, 0, 0, 0.05);
    k.net(W + 0.6, 0.55, 0.0, C.white, 0, 0, 0.12);
    k.at(k.person({ ...RQ, shirt: 0xf3f3f3, pants: 0xf3f3f3, pose: 'swing', tag: '@colin' }), 1.2, 0, 7.2, Math.PI);
    k.at(k.person({ real: false, color: C.cyan, pose: 'swing', tag: 'CPU · PRO', tagColor: C.cyan }), -1, 0, -7.2);
    k.at(k.person({ ...RF, pose: 'cheer', tag: '@maya.v' }), 4.2, 0, 4, -2.2);
    const ball = k.ball(0.09, 0xdfff4f); k.flight(V(1.2, 1.1, 6.8), V(-1, 0.9, -6.8), 1.6, C.amber, ball, 0.5);
    k.panel('15 · 30', C.green, -4.5, 3.6, 0, 1.8, 'WIMBLEDON GRASS');
    const speed = k.label('118 MPH', C.amber, { w: 1.2 }); speed.position.set(1.2, 2.7, 4.6);
    return { dist: 17, h: 8 };
  },

  pickleball(k) {
    k.disc(0, 9, k.noise('#3b6fb0', 14));
    const W = 5.5, L = 12; k.fillRect(W, L, C.blue, 0, 0, 0.08); k.rect(W, L, C.white);
    k.fillRect(W, 1.9, C.amber, 0, -0.95, 0.22); k.fillRect(W, 1.9, C.amber, 0, 0.95, 0.22);
    k.segs([[-W / 2, -1.9, W / 2, -1.9], [-W / 2, 1.9, W / 2, 1.9], [0, -6, 0, -1.9], [0, 1.9, 0, 6]], C.white);
    const kz = k.label('KITCHEN · NO VOLLEY', C.amber, { w: 1.9 }); kz.position.set(0, 0.6, 1.4);
    k.net(W + 0.5, 0.86, 0, C.white, 0, 0, 0.14);
    k.at(k.person({ ...RQ, pose: 'swing', tag: '@colin' }), -1.3, 0, 4.4, Math.PI);
    k.at(k.person({ ...RF, pose: 'stand', tag: '@maya.v' }), 1.4, 0, 2.6, Math.PI);
    k.at(k.person({ real: false, color: C.pink, pose: 'swing' }), -1.2, 0, -3.8); k.at(k.person({ real: false, color: C.pink }), 1.4, 0, -2.4);
    const ball = k.ball(0.08, C.amber); k.flight(V(-1.3, 1, 4.1), V(1.2, 0.6, -2.4), 1.2, C.amber, ball, 0.55);
    k.panel('4 · 2 · 1', C.amber, 4.8, 3, 0, 1.6, 'DOUBLES');
    return { dist: 15, h: 7.5 };
  },

  'ping-pong'(k) {
    k.disc(0, 6, k.noise('#5a4a3c', 20));
    const T = new THREE.BoxGeometry(1.525, 0.05, 2.74); const top = k.hm(T, C.blue, 0.35); top.position.y = 0.76;
    k.segs([[0, -1.37, 0, 1.37]], C.white, 1, 0.79); [-0.6, 0.6].forEach(x => [-1.1, 1.1].forEach(z => { const l = k.hm(new THREE.BoxGeometry(0.05, 0.74, 0.05), C.cyan, 0.3); l.position.set(x, 0.37, z); }));
    const n = k.net(1.83, 0.15, 0.785, C.white, 0, 0, 0.05); n.rotation.y = 0;
    k.at(k.person({ ...RQ, pose: 'swing', tag: '@colin' }), 0.3, 0, 2.2, Math.PI);
    k.at(k.person({ real: false, color: C.purple, pose: 'swing', tag: '@kai.p · REMOTE', tagColor: C.purple }), -0.2, 0, -2.2);
    const ball = k.ball(0.03, 0xffffff, false);
    const a = V(0.3, 0.95, 1.6), m = V(-0.1, 0.8, -0.6), b = V(-0.2, 0.95, -1.7);
    const p1 = k.arcPts(a, m, 0.35, 20), p2 = k.arcPts(m, b, 0.25, 20); const pts = p1.concat(p2); k.line(pts, C.amber, 0.6);
    k.ups.push(t => { const u = (t * 0.7) % 1; const i = Math.floor(u * (pts.length - 1)); ball.position.copy(pts[i]); });
    k.panel('9 · 11', C.purple, 2.3, 2.4, 0, 1.3, 'GAME 3');
    return { dist: 7.5, h: 4, target: 0.9 };
  },

  volleyball(k) {
    k.disc(0, 9, k.noise('#d8c08e', 26));
    k.rect(6.4, 12.8, C.amber); k.segs([[-3.2, 0, 3.2, 0]], C.amber);
    k.net(7.2, 1, 1.43, C.white, 0, 0, 0.12);
    k.at(k.person({ ...RQ, shirt: 0xff8a3c, pants: 0x1c2a40, pose: 'cheer', tag: '@colin' }), -1, 0, 1.4, Math.PI);
    k.at(k.person({ ...RF, shirt: 0x2e9cdb, pose: 'squat', tag: '@maya.v' }), 1.6, 0, 4.5, Math.PI);
    k.at(k.person({ real: false, color: C.purple, pose: 'cheer' }), 0.6, 0, -1.3); k.at(k.person({ real: false, color: C.purple, pose: 'squat' }), -1.6, 0, -4.4);
    // tomato ball
    const tomato = new THREE.Group(); k.root.add(tomato);
    const tb = k.hm(new THREE.SphereGeometry(0.17, 16, 12), C.red, 0.7, tomato); tb.scale.y = 0.85;
    const leaf = k.hm(new THREE.ConeGeometry(0.08, 0.06, 5), C.green, 0.8, tomato); leaf.position.y = 0.15;
    k.flight(V(-1, 2.6, 1.2), V(-1.2, 0.3, -4.6), 1.6, C.red, tomato, 0.42);
    const tl = k.label('TOMATO BALL', C.red, { w: 1.3 }); tl.position.set(-2.8, 3.4, 0);
    const gv = k.label('GRAVITY 0.6×', C.purple, { w: 1.3 }); gv.position.set(3.4, 3.2, -2);
    k.panel('SET 2 · 18 · 16', C.amber, 0, 4.6, 0, 2.4);
    return { dist: 16, h: 7 };
  },

  basketball(k) {
    k.disc(0, 9, k.noise('#7d7f86', 22));
    const hz = -6.4;
    const pole = k.hm(new THREE.CylinderGeometry(0.08, 0.08, 3.05, 8), C.cyan, 0.35); pole.position.set(0, 1.52, hz - 0.9);
    const bb = k.hm(new THREE.BoxGeometry(1.8, 1.05, 0.04), C.white, 0.18); bb.position.set(0, 3.4, hz - 0.3);
    const sq = k.rect(0.6, 0.01, C.white); sq.position.set(0, 0, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 30), k.holo(C.amber, 1)); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, hz); k.root.add(rim);
    const netc = k.hm(new THREE.CylinderGeometry(0.23, 0.15, 0.4, 12, 3, true), C.white, 0.08); netc.position.set(0, 2.85, hz);
    // paint + arc
    k.fillRect(3.6, 4.6, C.cyan, 0, hz + 2.3, 0.1); k.rect(3.6, 4.6, C.white, 0, hz + 2.3);
    const arc = []; for (let a = -1.25; a <= 1.25; a += 0.05) arc.push(V(Math.sin(a) * 6.2, 0.03, hz + Math.cos(a) * 6.2)); k.line(arc, C.white, 0.9);
    k.at(k.person({ ...RQ, shirt: 0x2a2a2a, pose: 'throw', tag: '@colin' }), 1, 0, 1.2, Math.PI + 0.15);
    k.at(k.person({ ...RF, pose: 'cheer', tag: '@jay.cruz' }), -2.4, 0, -3.4, 0.5);
    k.at(k.person({ real: false, color: C.red, pose: 'cheer' }), 0.6, 0, -0.6, 0.1);
    const ball = k.ball(0.12, C.amber); k.flight(V(1.1, 2.3, 1.1), V(0, 3.1, hz), 2.4, C.amber, ball, 0.38);
    k.panel('3PT · 72%', C.green, 4.5, 3.6, -2, 1.6, 'SHOT METER');
    k.panel('21', C.amber, -4.5, 3.6, -3, 1.1, 'TO WIN');
    return { dist: 15, h: 7 };
  },

  bowling(k) {
    k.disc(0, 9, k.noise('#2a2e3a', 20));
    const lane = k.hm(new THREE.BoxGeometry(1.2, 0.03, 15), C.amber, 0.12); lane.position.set(0, 0.02, -0.5);
    [-1, 1].forEach(s => k.segs([[s * 0.68, -8, s * 0.68, 7]], C.cyan, 0.9));
    for (let i = -2; i <= 2; i++) { const ar = k.hm(new THREE.ConeGeometry(0.06, 0.18, 3), C.amber, 0.7); ar.rotation.x = -Math.PI / 2; ar.position.set(i * 0.2, 0.05, 2 - Math.abs(i) * 0.15); }
    const pinGeo = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.065, 0.1], [0.06, 0.2], [0.035, 0.27], [0.045, 0.34], [0, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
    let n = 0; for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) { const p = k.hm(pinGeo, C.white, 0.5); p.position.set((c - r / 2) * 0.3, 0.03, -6.8 - r * 0.26); n++; }
    const ball = k.hm(new THREE.SphereGeometry(0.11, 18, 14), C.purple, 0.8);
    k.ups.push(t => { const u = (t * 0.35) % 1; ball.position.set(Math.sin(u * 3) * 0.25 * (1 - u), 0.13, 5 - u * 11.6); ball.rotation.x -= 0.2; });
    k.at(k.person({ ...RQ, pose: 'swing', tag: '@colin' }), 0.25, 0, 6.2, Math.PI);
    k.at(k.person({ ...RF, pose: 'cheer', tag: '@rio.sky' }), -2.4, 0, 6.6, Math.PI * 0.75);
    k.panel('STRIKE!', C.amber, 0, 2.6, -7.5, 2.2, 'FRAME 7 · 168');
    return { dist: 17, h: 7.5, target: 0.4 };
  },

  cornhole(k) {
    k.grass(); k.tree(-6.5, -5, 1.1); k.tree(6.8, 4, 0.9);
    const boardGeo = new THREE.BoxGeometry(0.61, 0.05, 1.22);
    [-4.1, 4.1].forEach((z, i) => {
      const b = k.hm(boardGeo, i ? C.red : C.blue, 0.22); b.position.set(0, 0.2, z); b.rotation.x = (z > 0 ? 1 : -1) * 0.2;
      const hole = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.077, 24), k.holo(C.white, 1)); hole.rotation.x = -Math.PI / 2 + b.rotation.x; hole.position.set(0, 0.3, z + (z > 0 ? -0.3 : 0.3)); k.root.add(hole);
    });
    k.at(k.person({ ...RQ, pose: 'throw', tag: '@colin' }), 0.8, 0, 5.4, Math.PI);
    k.at(k.person({ ...RF, pose: 'cheer', tag: '@maya.v' }), -0.9, 0, -5.4, 0);
    const bag = k.hm(new THREE.BoxGeometry(0.15, 0.04, 0.15), C.red, 0.7); k.flight(V(0.8, 1.4, 5.2), V(0, 0.3, -4.4), 2.2, C.amber, bag, 0.4);
    [[0.15, -4.0], [-0.2, -3.8], [0.1, -4.6]].forEach(([x, z], i) => { const b2 = k.hm(new THREE.BoxGeometry(0.15, 0.04, 0.15), i ? C.blue : C.red, 0.7); b2.position.set(x, 0.32, z); });
    k.panel('RED 15 · BLUE 9', C.white, 3, 2.8, 0, 2.2, 'FIRST TO 21');
    return { dist: 14, h: 6.5 };
  },

  chess(k) {
    k.disc(0, 9, k.stripes('#4b8b44', '#4b8b44', 2));
    const sq = 0.9, o = -3.5 * sq;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) k.fillRect(sq * 0.96, sq * 0.96, (r + c) % 2 ? C.cyan : C.purple, o + c * sq, o + r * sq, (r + c) % 2 ? 0.28 : 0.14);
    k.rect(8 * sq, 8 * sq, C.white);
    const piece = (type, col) => {
      const g = new THREE.Group(); const H = k.hm.bind(k);
      const base = H(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16), col, 0.25, g); base.position.y = 0.06;
      const body = { p: 0.45, r: 0.7, n: 0.7, b: 0.85, q: 1.0, k: 1.1 }[type];
      const bd = H(new THREE.CylinderGeometry(0.13, 0.24, body, 14), col, 0.22, g); bd.position.y = 0.12 + body / 2;
      const top = 0.12 + body;
      if (type === 'p') H(new THREE.SphereGeometry(0.14, 14, 10), col, 0.3, g).position.y = top + 0.1;
      if (type === 'r') H(new THREE.CylinderGeometry(0.22, 0.2, 0.2, 8), col, 0.3, g).position.y = top + 0.1;
      if (type === 'n') { const h = H(new THREE.BoxGeometry(0.18, 0.4, 0.36), col, 0.3, g); h.position.set(0, top + 0.15, 0.06); h.rotation.x = 0.4; }
      if (type === 'b') { H(new THREE.SphereGeometry(0.15, 14, 10).scale(1, 1.4, 1), col, 0.3, g).position.y = top + 0.15; }
      if (type === 'q') { H(new THREE.TorusGeometry(0.17, 0.035, 8, 16), col, 0.4, g).position.y = top + 0.05; H(new THREE.SphereGeometry(0.08, 10, 8), col, 0.4, g).position.y = top + 0.18; g.children.at(-2).rotation.x = Math.PI / 2; }
      if (type === 'k') { H(new THREE.BoxGeometry(0.06, 0.32, 0.06), col, 0.5, g).position.y = top + 0.2; H(new THREE.BoxGeometry(0.22, 0.06, 0.06), col, 0.5, g).position.y = top + 0.24; }
      k.root.add(g); return g;
    };
    const back = 'rnbqkbnr';
    for (let c = 0; c < 8; c++) {
      k.at(piece(back[c], C.cyan), o + c * sq, 0, o + 7 * sq); if (c !== 4) k.at(piece('p', C.cyan), o + c * sq, 0, o + 6 * sq);
      k.at(piece(back[c], C.pink), o + c * sq, 0, o, Math.PI); if (c !== 4) k.at(piece('p', C.pink), o + c * sq, 0, o + 1 * sq);
    }
    k.at(piece('p', C.cyan), o + 4 * sq, 0, o + 4 * sq); k.at(piece('p', C.pink), o + 4 * sq, 0, o + 3 * sq);
    // knight hop g1 -> f3 loop
    const kn = piece('n', C.cyan); const A = V(o + 6 * sq, 0, o + 7 * sq + 0.0001), B = V(o + 5 * sq, 0, o + 5 * sq);
    k.ups.push(t => { const u = (Math.sin(t * 0.9) + 1) / 2; kn.position.copy(A).lerp(B, u); kn.position.y = Math.sin(Math.PI * u) * 0.9; });
    k.ringMark(B.x, B.z, C.green, 0.4);
    k.at(k.person({ ...RQ, pose: 'point', tag: '@colin' }), 0.6, 0, 5, Math.PI);
    k.at(k.person({ ...RF, pose: 'stand', tag: '@kai.p' }), -0.6, 0, -5, 0);
    k.panel('WHITE TO MOVE', C.cyan, 4.6, 3, 0, 2.2, '10:00 · 09:42');
    return { dist: 14, h: 8.5 };
  },

  mafia(k) {
    k.disc(0, 9, k.noise('#1d2230', 20));
    const fire = k.hm(new THREE.ConeGeometry(0.4, 0.9, 7), C.amber, 0.35); fire.position.y = 0.45; k.ups.push(t => { fire.scale.y = 1 + 0.2 * Math.sin(t * 9); });
    const moon = k.hm(new THREE.SphereGeometry(0.9, 24, 16), C.white, 0.25); moon.position.set(-4, 6.5, -6);
    const names = ['@colin', '@maya.v', '@jay.cruz', '@rio.sky', '@kai.p', '@zoe'];
    const looks = [RQ, RF, { shirt: 0x48335a, pants: 0x2b2f3a, skin: 0xe2b590 }, { shirt: 0x2f5c4b, pants: 0x2b2f3a, skin: 0x8e5b3d }, { shirt: 0x6a5a2e, pants: 0x222, skin: 0xd8a27c }, { shirt: 0x5a2e3a, pants: 0x2b2f3a, skin: 0xb07a55 }];
    names.forEach((n, i) => {
      const a = i / names.length * Math.PI * 2; const x = Math.sin(a) * 3.2, z = Math.cos(a) * 3.2;
      k.at(k.person({ ...looks[i], pose: i === 2 ? 'point' : 'stand', tag: n }), x, 0, z, a + Math.PI);
      const card = k.hm(new THREE.BoxGeometry(0.5, 0.72, 0.02), i === 3 ? C.red : C.purple, 0.35); card.position.set(x * 0.8, 2.75, z * 0.8);
      if (i === 3) k.ups.push(t => { card.rotation.y = t * 1.2; }); else card.rotation.y = a;
      k.bob(card, 0.06, 1.3, i);
    });
    const role = k.label('YOU ARE: MAFIA', C.red, { w: 1.6 }); role.position.set(Math.sin(3 / 6 * Math.PI * 2) * 2.6, 3.5, Math.cos(3 / 6 * Math.PI * 2) * 2.6);
    k.beam(V(Math.sin(2 / 6 * Math.PI * 2) * 3.2, 1.3, Math.cos(2 / 6 * Math.PI * 2) * 3.2), V(Math.sin(5 / 6 * Math.PI * 2) * 3.2, 1.3, Math.cos(5 / 6 * Math.PI * 2) * 3.2), C.amber, 0);
    k.panel('NIGHT 2 · VOTE', C.purple, 3.6, 5.6, -3, 2.4, '3 VOTES ON @zoe');
    return { dist: 14, h: 8 };
  },

  'beside-them'(k) {
    k.disc(0, 9, k.noise('#3a3f4c', 18));
    const stations = [[-5, -3, 'FIX WIRING'], [5, -2, 'UPLOAD DATA'], [0, -6, 'REACTOR'], [-4, 4.5, 'SCAN']];
    stations.forEach(([x, z, t], i) => { const s = k.hm(new THREE.BoxGeometry(1.2, 1.1, 0.6), i === 2 ? C.red : C.cyan, 0.18); s.position.set(x, 0.55, z); const l = k.label(t, i === 2 ? C.red : C.cyan, { w: 1.4 }); l.position.set(x, 1.6, z); k.bob(l, 0.05, 1.4, i); });
    const vent = k.hm(new THREE.BoxGeometry(0.9, 0.06, 0.6), C.green, 0.35); vent.position.set(3.5, 0.03, 3.5);
    const btn = k.hm(new THREE.CylinderGeometry(0.45, 0.5, 0.25, 24), C.red, 0.5); btn.position.set(0, 0.85, 0); const st = k.hm(new THREE.CylinderGeometry(0.15, 0.25, 0.75, 12), C.white, 0.2); st.position.set(0, 0.37, 0);
    k.blink(btn.children[0].material, 3);
    const eb = k.label('EMERGENCY MEETING', C.red, { w: 1.8 }); eb.position.set(0, 1.6, 0);
    k.at(k.person({ ...RQ, pose: 'point', tag: '@colin' }), -4.2, 0, -2, Math.PI * 1.2);
    k.at(k.person({ ...RF, pose: 'run', tag: '@maya.v' }), 2.4, 0, 1.5, -0.8);
    k.at(k.person({ shirt: 0x2f5c4b, pants: 0x2b2f3a, skin: 0x8e5b3d, tag: '@rio.sky', pose: 'stand' }), 4.2, 0, -1.2, -1.2);
    k.at(k.person({ shirt: 0x4b2b2b, pants: 0x222, skin: 0xd8a27c, tag: '@kai.p', tagColor: C.red, hood: true }), 3, 0, 3, 2.6); // impostor near vent
    const bar = k.label('TASKS', C.green, { w: 2.2, bar: 0.62 }); bar.position.set(0, 4.3, -3); k.bob(bar, 0.05);
    return { dist: 15, h: 8 };
  },

  'we-outside'(k) {
    k.disc(0, 9, k.noise('#262a33', 26));
    k.segs([[-9, 0, 9, 0]], C.amber, 0.7); k.segs([[-9, 3, 9, 3], [-9, -3, 9, -3]], 0xffffff, 0.3);
    // holo bank
    const bank = k.hm(new THREE.BoxGeometry(5, 3.4, 2.4), C.cyan, 0.12); bank.position.set(2.5, 1.7, -6);
    [0, 1, 2, 3].forEach(i => { const c = k.hm(new THREE.CylinderGeometry(0.15, 0.15, 2.6, 10), C.cyan, 0.3); c.position.set(0.6 + i * 1.25, 1.3, -4.7); });
    const bl = k.label('BANK', C.cyan, { w: 1.6, big: true }); bl.position.set(2.5, 3.9, -4.6);
    const beacon = k.hm(new THREE.CylinderGeometry(0.06, 0.06, 9, 8), C.amber, 0.5); beacon.position.set(2.5, 4.5, -6);
    // holo cop cars
    const car = (x, z, r) => { const g = new THREE.Group(); k.root.add(g); k.hm(new THREE.BoxGeometry(1.9, 0.5, 0.9), C.blue, 0.18, g).position.y = 0.45; k.hm(new THREE.BoxGeometry(1, 0.4, 0.8), C.blue, 0.18, g).position.set(-0.1, 0.9, 0); const lr = k.hm(new THREE.BoxGeometry(0.2, 0.1, 0.5), C.red, 0.8, g); lr.position.set(-0.1, 1.15, 0); k.blink(lr.children[0].material, 10); g.position.set(x, 0, z); g.rotation.y = r; return g; };
    car(-6, 1.5, 0.3); car(-5.5, -1.8, -0.2);
    const cop = k.at(k.person({ real: false, color: C.blue, pose: 'point' }), -4, 0, 0.5, Math.PI / 2);
    // real robber with holo money bag, real friend lookout
    const r = k.at(k.person({ ...RQ, shirt: 0x15171c, pants: 0x3a3f4a, hood: true, pose: 'run', tag: '@colin' }), 1, 0, 1.5, -1.2);
    const bag = k.hm(new THREE.SphereGeometry(0.4, 14, 10), C.cyan, 0.25, r); bag.position.set(0.45, 1.1, -0.2);
    k.at(k.person({ ...RF, shirt: 0x1d1f26, hood: true, pose: 'point', tag: '@jay.cruz' }), 5.5, 0, 2.5, -2.2);
    const stars = k.label('WANTED ★★★★', C.amber, { w: 1.8 }); stars.position.set(1, 3, 1.5); k.bob(stars, 0.08);
    k.ringMark(7, 5.5, C.green, 0.7); const safe = k.label('SAFEHOUSE · 0.4 MI', C.green, { w: 1.7 }); safe.position.set(7, 1.2, 5.5);
    k.panel('HEIST · $48,200', C.green, -4, 4.6, -5, 2.4, 'EVADE OR SURRENDER');
    return { dist: 17, h: 8 };
  },

  world(k) {
    k.grass(); k.fence(8.7, 3.4, 6.0);
    const candy = (x, z, len, rotY = 0) => { const g = new THREE.Group(); k.root.add(g); const p1 = k.hm(new THREE.BoxGeometry(0.4, 1.4, 0.4), C.purple, 0.3, g); p1.position.set(-len / 2, 0.7, 0); const p2 = k.hm(new THREE.BoxGeometry(0.4, 1.4, 0.4), C.purple, 0.3, g); p2.position.set(len / 2, 0.7, 0); const bar = k.hm(new THREE.CylinderGeometry(0.12, 0.12, len, 12), C.pink, 0.5, g); bar.rotation.z = Math.PI / 2; bar.position.y = 1.1; g.position.set(x, 0, z); g.rotation.y = rotY; return g; };
    candy(-3.5, 2, 3); candy(3.5, -3.8, 3, 0.4);
    // spinning sweeper
    const sweep = new THREE.Group(); sweep.position.set(0, 0, -1); k.root.add(sweep);
    k.hm(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 16), C.cyan, 0.3, sweep).position.y = 0.3;
    const arm = k.hm(new THREE.CylinderGeometry(0.1, 0.1, 5, 10), C.pink, 0.5, sweep); arm.rotation.z = Math.PI / 2; arm.position.y = 0.5; k.spin(sweep, 2.5);
    // floating platforms
    [[-5, 0.4, -3], [-6, 0.9, -5], [-3.5, 1.4, -6]].forEach(([x, y, z], i) => { const p = k.hm(new THREE.BoxGeometry(1.1, 0.2, 1.1), C.amber, 0.5); p.position.set(x, y, z); k.bob(p, 0.15, 1.5, i); });
    // finish arch
    const arch = k.hm(new THREE.TorusGeometry(1.6, 0.12, 10, 32, Math.PI), C.pink, 0.3); arch.position.set(4.5, 0, 4);  arch.rotation.y = -0.6;
    const fin = k.label('FINISH', C.pink, { w: 1.4, big: true }); fin.position.set(4.5, 2.4, 4);
    // stars
    [[-2, 2.2, -4], [2.8, 2, 0.5], [-6, 2.4, 1.5], [6, 2.4, -1]].forEach(([x, y, z], i) => { const s = k.hm(new THREE.OctahedronGeometry(0.28, 0), C.amber, 0.6); s.position.set(x, y, z); k.spin(s, 3); k.bob(s, 0.15, 2, i); });
    // holo characters (shop avatars)
    const buddy = (x, z, col) => { const g = new THREE.Group(); k.root.add(g); k.hm(new THREE.SphereGeometry(0.45, 16, 12).scale(1, 1.15, 1), col, 0.3, g).position.y = 0.55; k.hm(new THREE.SphereGeometry(0.32, 14, 10), C.white, 0.35, g).position.set(0, 0.5, 0.2); k.hm(new THREE.ConeGeometry(0.08, 0.16, 6), C.amber, 0.7, g).position.set(0, 0.7, 0.45); g.children.at(-1).rotation.x = Math.PI / 2; g.position.set(x, 0, z); k.bob(g, 0.15, 3, x); return g; };
    buddy(2, 2.5, C.blue); buddy(-1.5, -4, C.pink); buddy(5.5, 0.8, C.blue);
    k.at(k.person({ ...RQ, shirt: 0xf0f0f0, pants: 0x27324a, pose: 'run', tag: '@colin' }), -1.2, 0, 3.6, Math.PI * 0.85);
    k.at(k.person({ ...RF, shirt: 0xb48ad8, pose: 'squat', tag: '@maya.v' }), -4.6, 0, 4.4, Math.PI * 0.8);
    k.panel('ROUND 2 · 18 LEFT', C.pink, 0, 4.8, -6, 2.4, 'QUALIFY TOP 10');
    return { dist: 16, h: 7.5 };
  },

  // hero: name tags over real people, one profile opened
  tags(k) {
    k.disc(0, 7, k.noise('#2b2f3a', 22));
    const ppl = [
      [{ ...RF, tag: '@maya.v' }, -2.6, -1.2, 0.3, 'Creator · 40 ft'],
      [{ shirt: 0x2f5c4b, pants: 0x2b2f3a, skin: 0x8e5b3d, tag: '@jay.cruz' }, 1.2, -3, -0.2, 'Photographer'],
      [{ shirt: 0x6a5a2e, pants: 0x222, skin: 0xd8a27c, tag: '@cafe.luna', tagColor: C.amber }, 3.4, -0.6, -0.8, 'Business'],
      [{ shirt: 0x5a2e3a, pants: 0x2b2f3a, skin: 0xb07a55, tag: '@rio.sky' }, -0.4, 1.2, 2.6, 'DJ · 25 ft'],
    ];
    ppl.forEach(([o, x, z, r]) => k.at(k.person(o), x, 0, z, r));
    k.at(k.person({ ...RQ, glasses: true }), 0.4, 0, 4.4, Math.PI);
    // opened profile card above @maya.v
    const card = new THREE.Group(); card.position.set(-2.6, 2.9, -1.2); k.root.add(card);
    k.hm(new THREE.BoxGeometry(1.7, 1.05, 0.02), C.cyan, 0.12, card);
    const nm = k.label('@maya.v', C.cyan, { w: 1.3, sub: 'IG · TT · YT · SP', parent: card }); nm.position.set(0, 0.18, 0.03);
    const fl = k.label('FOLLOW', C.green, { w: 0.9, parent: card }); fl.position.set(0, -0.32, 0.03);
    k.bob(card, 0.06, 1.2);
    // gaze ray from wearer
    k.beam(V(0.4, 1.65, 4.3), V(-2.4, 2.3, -1.1), C.cyan, 0);
    return { dist: 11, h: 5, target: 1.4 };
  },
};

// ---------- views: each card owns a scene; one shared WebGL renderer draws them all ----------
let R = null;
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.setPixelRatio(1);
  return R;
}
export class SceneView {
  constructor(name) {
    this.name = name;
    const sc = this.scene = new THREE.Scene(); sc.fog = new THREE.Fog(0x0b0f1c, 24, 50);
    this.camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 200);
    sc.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1f2e, 1.1));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(6, 12, 8); d.castShadow = true; d.shadow.mapSize.set(1024, 1024);
    Object.assign(d.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11 }); sc.add(d);
    const rim = new THREE.DirectionalLight(0x39d5ff, 0.6); rim.position.set(-8, 5, -8); sc.add(rim);
    this.root = new THREE.Group(); sc.add(this.root);
    this.k = makeKit(this.root); const cfg = SCENES[name](this.k) || {};
    this.base = this.dist = (cfg.dist || 16) * 1.12; this.target = V(0, cfg.target ?? 1, 0);
    this.pitch0 = this.pitch = Math.atan2(cfg.h || 7, this.base) * 0.9; this.yaw = 0.45 + Math.random() * 0.4; this.idle = 100; this.dragging = false;
  }
  zoom(f) { this.dist = Math.min(this.base * 1.8, Math.max(this.base * 0.35, this.dist * f)); this.idle = 0; }
  reset() { this.dist = this.base; this.pitch = this.pitch0; this.idle = 0; }
  draw(t, canvas, scale = 1) {
    const w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale); if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (!this.dragging) { this.idle++; if (this.idle > 90) this.yaw += 0.0025; }
    const cp = Math.cos(this.pitch); const c = this.camera; c.aspect = w / h; c.fov = w / h < 1 ? 55 : 40; c.updateProjectionMatrix();
    c.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist); c.lookAt(this.target);
    const k = this.k; for (let i = 0; i < k.mats.length; i++) { const m = k.mats[i]; m.opacity = m.userData.base * (0.82 + 0.18 * Math.sin(t * 2.2 + i * 0.37)); }
    for (const f of k.ups) f(t);
    const r = renderer(); const s = r.getSize(new THREE.Vector2()); if (s.x !== w || s.y !== h) r.setSize(w, h, false);
    r.render(this.scene, c);
    const g = canvas.getContext('2d'); g.clearRect(0, 0, w, h); g.drawImage(r.domElement, 0, 0, w, h);
  }
}
// drag to rotate; a tap (no drag) calls onTap
export function attachDrag(el, getView, onTap) {
  let down = null;
  el.addEventListener('pointerdown', e => { const v = getView(); if (!v) return; down = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: false }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    const v = getView(); if (!down || !v || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down.x = e.clientX; down.y = e.clientY;
    if (!down.moved && Math.hypot(e.clientX - down.x0, e.clientY - down.y0) > 6) { down.moved = true; v.dragging = true; el.classList.add('grab'); }
    if (down.moved) { v.yaw -= dx * 0.008; v.pitch = Math.min(1.35, Math.max(0.05, v.pitch + dy * 0.006)); v.idle = 0; }
  });
  const up = e => { const v = getView(); if (!down) return; const tap = !down.moved; down = null; el.classList.remove('grab'); if (v) { v.dragging = false; v.idle = 0; } if (tap && e.type === 'pointerup' && onTap) onTap(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { const v = getView(); if (!v || (!e.ctrlKey && !e.metaKey)) return; e.preventDefault(); v.zoom(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });
}
