// iYiYi x SPECS — display-only 3D hologram dioramas. Drag to rotate, buttons to zoom.
import * as THREE from '../xr/three.module.min.js';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import * as SkeletonUtils from './lib/utils/SkeletonUtils.js';

// ---------- realistic humans (Mixamo-rigged model + shared animation clips) ----------
let HUMAN = null;
// six realistic people generated on Higgsfield (image -> rigged 3D), all wearing Specs-style glasses
const CHARS = [['char0', 1.8], ['char1', 1.65], ['char2', 1.76], ['char3', 1.68], ['char4', 1.77], ['char5', 1.7]];
const BONE = { Hips: 'Hips', Spine: 'Spine', Spine01: 'Spine1', Spine02: 'Spine2', neck: 'Neck', Head: 'Head' };
['Left', 'Right'].forEach(s => { ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].forEach(b => { BONE[s + b] = s + b; }); });
export async function loadHumans() {
  const L = new GLTFLoader(); const Q = THREE.Quaternion;
  const [a, ...cs] = await Promise.all([L.loadAsync('models/anims.glb'), ...CHARS.map(([f]) => L.loadAsync(`models/${f}.glb`))]);
  a.scene.updateMatrixWorld(true);
  const srcBy = new Map(); a.scene.traverse(o => { if (/^mixamorig/.test(o.name)) srcBy.set(o.name, o); });
  const firstChild = (o, re) => o.children.find(c => re.test(c.name));
  const dirOf = (o, re) => { const c = firstChild(o, re); if (!c) return null; const p0 = o.getWorldPosition(V()), p1 = c.getWorldPosition(V()); const d = p1.sub(p0); return d.lengthSq() > 1e-10 ? d.normalize() : null; };
  const srcRest = new Map(), srcDir = new Map();
  srcBy.forEach((o, n) => { srcRest.set(n, o.getWorldQuaternion(new Q()).invert()); srcDir.set(n, dirOf(o, /^mixamorig/)); });
  const mixer = new THREE.AnimationMixer(a.scene); const want = ['run', 'walk', 'agree', 'headShake'];
  const list = cs.map((g, ci) => {
    const scene = g.scene; scene.updateMatrixWorld(true);
    let mesh = null; scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } if (!mesh && o.isSkinnedMesh) mesh = o; });
    const box = new THREE.Box3().setFromObject(scene); const h = box.max.y - box.min.y;
    const bones = mesh.skeleton.bones.slice(); const depth = b => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; }; bones.sort((x, y) => depth(x) - depth(y));
    const bindW = new Map(), restL = new Map(), fixedP = new Map(), align = new Map();
    const isBone = new Set(bones);
    bones.forEach(b => {
      bindW.set(b, b.getWorldQuaternion(new Q())); restL.set(b, b.quaternion.clone()); if (!isBone.has(b.parent)) fixedP.set(b, b.parent.getWorldQuaternion(new Q()));
      const sn = BONE[b.name] && 'mixamorig' + BONE[b.name]; const td = dirOf(b, { test: n => isBone.has(scene.getObjectByName(n)) }), sd = sn && srcDir.get(sn);
      align.set(b, td && sd ? new Q().setFromUnitVectors(td, sd) : (align.get(b.parent) || new Q()).clone());
    });
    const clips = {};
    const idle = g.animations[0]; if (idle) { idle.tracks = idle.tracks.filter(t => !t.name.endsWith('.position') || /^Hips/.test(t.name) === false); idle.name = 'idle'; clips.idle = idle; }
    for (const c of a.animations) {
      if (!want.includes(c.name)) continue;
      mixer.stopAllAction(); mixer.clipAction(c).play();
      const fps = 24, n = Math.max(2, Math.round(c.duration * fps)), times = new Float32Array(n), vals = new Map(bones.map(b => [b, new Float32Array(n * 4)]));
      for (let f = 0; f < n; f++) {
        const t = Math.min(c.duration, f / fps); times[f] = t; mixer.setTime(t); a.scene.updateMatrixWorld(true);
        const D = new Map();
        for (const b of bones) {
          const sn = BONE[b.name] && 'mixamorig' + BONE[b.name], s = sn && srcBy.get(sn); let d;
          if (s) d = s.getWorldQuaternion(new Q()).multiply(srcRest.get(sn)).multiply(align.get(b)).multiply(bindW.get(b));
          else d = (D.get(b.parent) || fixedP.get(b) || new Q()).clone().multiply(restL.get(b));
          D.set(b, d);
          const pw = isBone.has(b.parent) ? D.get(b.parent) : fixedP.get(b);
          pw.clone().invert().multiply(d).toArray(vals.get(b), f * 4);
        }
      }
      clips[c.name] = new THREE.AnimationClip(c.name, c.duration, bones.map(b => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals.get(b))));
    }
    return { scene, clips, scale: CHARS[ci][1] / h, minY: box.min.y };
  });
  HUMAN = { list };
  return HUMAN;
}

const C = { cyan: 0x39d5ff, red: 0xff3d52, amber: 0xffb21e, green: 0x5cf2a0, purple: 0xb06cff, white: 0xeef1f8, pink: 0xff5fc8, blue: 0x5b7cff };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- kit: per-scene helpers that track holo materials + animations ----------
function makeKit(root, fp = false) {
  const k = { mats: [], ups: [], mixers: [], root, ground: null, fp };
  k.holo = (color, op = 0.26) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); m.userData.base = op; k.mats.push(m); return m; };
  k.lmat = (color, op = 0.9) => { const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); m.userData.base = op; k.mats.push(m); return m; };
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
    const { sub = '', w: w0 = 1.5, bar = null, big = false, parent = root, style = 'hud' } = opts;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = sub || bar !== null ? 168 : 128;
    const w = w0 * (k.fp ? 0.85 : 1.3); const g = cv.getContext('2d'); const hex = '#' + color.toString(16).padStart(6, '0');
    if (style === 'glass') { g.fillStyle = 'rgba(28,36,52,0.42)'; rr(g, 6, 6, 500, cv.height - 12, 40); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4; rr(g, 6, 6, 500, cv.height - 12, 40); g.stroke(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8; }
    else if (style === 'neon') { g.shadowColor = hex; g.shadowBlur = 22; }
    else { g.fillStyle = 'rgba(8,12,24,0.78)'; rr(g, 6, 6, 500, cv.height - 12, 34); g.fill(); g.strokeStyle = hex; g.lineWidth = 5; rr(g, 6, 6, 500, cv.height - 12, 34); g.stroke(); }
    let fs = big ? 66 : 56; const font = n => `700 ${n}px "Chakra Petch", "Barlow Semi Condensed", system-ui, sans-serif`;
    g.font = font(fs); while (fs > 20 && g.measureText(text).width > 450) { fs -= 2; g.font = font(fs); }
    g.fillStyle = style === 'neon' ? '#e6fbff' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, sub || bar !== null ? 62 : 66); if (style === 'neon') g.fillText(text, 256, sub || bar !== null ? 62 : 66);
    if (sub) { let ss = 36; g.font = `600 ${ss}px "Barlow Semi Condensed", system-ui, sans-serif`; while (ss > 16 && g.measureText(sub).width > 450) { ss -= 2; g.font = `600 ${ss}px "Barlow Semi Condensed", system-ui, sans-serif`; } g.fillStyle = style === 'glass' ? '#ffffff' : hex; g.fillText(sub, 256, 124); }
    if (bar !== null) { g.fillStyle = 'rgba(255,255,255,0.15)'; rr(g, 70, 110, 372, 26, 13); g.fill(); g.fillStyle = hex; rr(g, 70, 110, 372 * bar, 26, 13); g.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(w, w * cv.height / 512, 1); parent.add(sp); return sp;
  };

  // ---- glasses (Specs-style) ----
  k.glasses = (color = C.cyan) => {
    const fr = k.solid(0x0b0b0e, 0.35, 0.2); const gl = new THREE.Group();
    gl.add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.065, 0.035), fr));
    const lensM = new THREE.MeshStandardMaterial({ color: 0x0d1a2a, roughness: 0.05, metalness: 0.6, emissive: color, emissiveIntensity: 0.25 });
    [-0.072, 0.072].forEach(x => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.052, 0.012), lensM); l.position.set(x, 0, 0.02); gl.add(l); });
    [-0.15, 0.15].forEach(x => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.2), fr); t.position.set(x, 0.01, -0.09); gl.add(t); });
    return gl;
  };
  // ---- realistic human ----
  const CLIP = { run: 'run', walk: 'walk', cheer: 'agree', point: 'headShake', squat: 'sneak_pose' };
  k.human = (o) => {
    const { pose = 'stand', tag = null, tagColor, scale = 1 } = o;
    const TAGCHAR = { '@maya.v': 1, '@jay.cruz': 0, '@rio.sky': 5, '@kai.p': 2, '@zoe': 3, '@colin': 4, '@colin.iyiyi': 4, '@cafe.luna': 3 };
    let ci = o.char ?? (tag ? TAGCHAR[tag.split(' ')[0]] : undefined); if (ci == null) { if (tag) { let hsh = 0; for (const ch of tag) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0; ci = Math.abs(hsh) % HUMAN.list.length; } else ci = (k._ped = ((k._ped ?? (Math.random() * 4) | 0) + 1)) % HUMAN.list.length; }
    const H = HUMAN.list[ci];
    const g = new THREE.Group(); const c = SkeletonUtils.clone(H.scene);
    c.scale.multiplyScalar(H.scale * scale); c.position.y = -H.minY * H.scale * scale; g.add(c);
    const clip = H.clips[CLIP[pose]] || H.clips.idle;
    if (clip) { const mx = new THREE.AnimationMixer(c); mx.clipAction(clip).play(); mx.update(Math.random() * 3); k.mixers.push(mx); }
    if (tag) { const s = k.label(tag, tagColor || C.cyan, { w: 1.2, parent: g }); s.position.set(0, 2.12 * scale, 0); k.bob(s, 0.04, 1.6, Math.random() * 6); }
    if (o.me || (tag && tag.startsWith('@colin'))) g.userData.me = true;
    root.add(g); return g;
  };

  // ---- people ----
  // real: solid person with Specs-style glasses. holo: translucent avatar.
  k.person = (o = {}) => {
    if (o.real !== false && HUMAN && !o.proc) return k.human(o);
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
    if (o.me || (tag && tag.startsWith('@colin'))) g.userData.me = true;
    root.add(g); g.userData.head = head; return g;
  };

  // ---- grounds ----
  k.disc = (color, r = 9, tex = null) => {
    if (k.ar) { k.ground = null; return null; }
    k.ground = { color, tex, r };
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
  k.fence = (r = 8.7, a0 = 2.4, a1 = 3.9) => {
    if (k.ar) return; for (let a = a0; a < a1; a += 0.09) { const p = k.sm(new THREE.BoxGeometry(0.5, 1.4, 0.06), 0x8a6a4a); p.position.set(Math.cos(a) * r, 0.7, Math.sin(a) * r); p.lookAt(0, 0.7, 0); } };
  k.tree = (x, z, s = 1) => { if (k.ar) return; const t = k.sm(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.4 * s, 8), 0x5a3d26); t.position.set(x, 0.7 * s, z); const c = k.sm(new THREE.IcosahedronGeometry(0.9 * s, 0), 0x2f6a33); c.position.set(x, 1.9 * s, z); };
  // a person walking back and forth along z (or x when axis = 'x')
  k.walker = (o, x, z0, z1, speed, ph = 0, axis = 'z') => {
    const p = k.person({ ...o, pose: o.pose || 'walk' }); const len = Math.abs(z1 - z0) || 1;
    k.ups.push(t => { const u = ((t * speed / len) + ph) % 2, f = u < 1 ? u : 2 - u, v = z0 + (z1 - z0) * f, fwd = (u < 1) === (z1 > z0);
      if (axis === 'z') { p.position.set(x, 0, v); p.rotation.y = fwd ? 0 : Math.PI; } else { p.position.set(v, 0, x); p.rotation.y = fwd ? Math.PI / 2 : -Math.PI / 2; } });
    return p;
  };
  // live jumbotron: score, clock and a play-by-play ticker that keep updating
  k.jumbotron = (x, y, z, w, o = {}) => {
    const { title = 'iYiYi LIVE', home = 'HOME', away = 'AWAY', hs = 0, as = 0, period = 'Q1', clock = 720, points = [1], ticker = 'iYiYi × SPECS  ·  PLAYED IN THE REAL WORLD  ·  ', face = null } = o;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 576; const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const h = w * 576 / 1024, grp = new THREE.Group(); grp.position.set(x, y, z); k.root.add(grp);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.4), k.solid(0x111318, 0.5, 0.6)); frame.position.z = -0.22; grp.add(frame);
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w + 3, h + 3), k.holo(C.cyan, 0.08)); glow.position.z = -0.45; grp.add(glow);
    [-w / 3, w / 3].forEach(px => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, y, 0.35), k.solid(0x23262d, 0.6, 0.6)); leg.position.set(px, -y / 2 - h / 2 + 0.1, -0.3); grp.add(leg); });
    if (face) grp.lookAt(face.x, y, face.z);
    const st = { hs, as, clock, flash: 0, last: -1, tick: 0, scorer: '' };
    const draw = t => {
      g.fillStyle = '#05070d'; g.fillRect(0, 0, 1024, 576);
      const bg = g.createLinearGradient(0, 0, 0, 576); bg.addColorStop(0, '#0c1630'); bg.addColorStop(1, '#05070d'); g.fillStyle = bg; g.fillRect(8, 8, 1008, 560);
      g.fillStyle = '#39d5ff'; g.fillRect(8, 8, 1008, 70); g.fillStyle = '#04121b'; g.font = '700 46px "Chakra Petch", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(title, 512, 45);
      const row = (name, sc, yy, col) => { g.textAlign = 'left'; g.fillStyle = col; g.fillRect(40, yy - 50, 14, 100); g.fillStyle = '#eef1f8'; g.font = '700 70px "Chakra Petch", system-ui'; g.fillText(name, 80, yy); g.textAlign = 'right'; g.font = '700 120px "Chakra Petch", system-ui'; g.fillText(sc, 980, yy + 6); };
      row(home, st.hs, 170, '#39d5ff'); row(away, st.as, 300, '#ff3d52');
      const m = Math.floor(st.clock / 60), sec = Math.floor(st.clock % 60);
      g.textAlign = 'center'; g.fillStyle = '#ffb21e'; g.font = '700 64px "Chakra Petch", system-ui'; g.fillText(`${period}  ${m}:${String(sec).padStart(2, '0')}`, 512, 405);
      if (st.flash > 0) { g.fillStyle = `rgba(92,242,160,${Math.min(1, st.flash)})`; g.fillRect(8, 350, 1008, 110); g.fillStyle = '#04121b'; g.font = '800 72px "Chakra Petch", system-ui'; g.fillText(st.scorer, 512, 405); }
      g.fillStyle = '#111a30'; g.fillRect(8, 480, 1008, 88); g.fillStyle = '#a4adc4'; g.font = '600 40px "Barlow Semi Condensed", system-ui'; g.textAlign = 'left';
      const tw = g.measureText(ticker).width, off = -((t * 120) % tw); for (let xx = off; xx < 1024; xx += tw) g.fillText(ticker, xx + 16, 526);
      tex.needsUpdate = true;
    };
    k.ups.push(t => {
      const step = Math.floor(t * 8); if (step === st.last) return; const dt = st.last < 0 ? 0 : (step - st.last) / 8; st.last = step;
      st.clock = Math.max(0, st.clock - dt); st.flash = Math.max(0, st.flash - dt * 0.6); st.tick += dt;
      if (st.tick > 9) { st.tick = 0; const homeScores = Math.random() < 0.55, p = points[(Math.random() * points.length) | 0]; if (homeScores) st.hs += p; else st.as += p; st.flash = 1.6; st.scorer = (homeScores ? home : away) + ' SCORE!  +' + p; }
      draw(t);
    });
    return grp;
  };
  // holographic stadium: tiered stands, crowd, light towers
  k.stadium = (cx, cz, w, l, gap = 4, jumbo = null, col = C.cyan) => {
    const tiers = 5, dep = 1.5, rise = 1.0, crowd = [], cols = [];
    const pal = [[1, 1, 1], [0.22, 0.84, 1], [1, 0.37, 0.78], [1, 0.7, 0.12], [0.36, 0.95, 0.63]];
    const side = (len, ox, oz, ry) => {
      const g = new THREE.Group(); g.position.set(ox, 0, oz); g.rotation.y = ry; k.root.add(g);
      for (let t = 0; t < tiers; t++) {
        const b = k.hm(new THREE.BoxGeometry(len + t * dep * 2, rise, dep), col, 0.06, g); b.position.set(0, t * rise + rise / 2, t * dep + dep / 2);
        for (let i = 0; i < len * 1.4; i++) { const p = V((Math.random() - 0.5) * (len + t * dep * 2), t * rise + rise + 0.35, t * dep + dep * 0.5); g.updateMatrixWorld(true); crowd.push(p.applyMatrix4(g.matrixWorld)); const c = pal[(Math.random() * pal.length) | 0]; cols.push(...c); }
      }
      const roof = k.hm(new THREE.BoxGeometry(len + tiers * dep * 2, 0.15, tiers * dep * 0.6), col, 0.08, g); roof.position.set(0, tiers * rise + 2.6, tiers * dep * 0.7);
    };
    side(w + 2 * gap, cx, cz - l / 2 - gap, Math.PI); side(w + 2 * gap, cx, cz + l / 2 + gap, 0);
    side(l + 2 * gap, cx - w / 2 - gap, cz, -Math.PI / 2); side(l + 2 * gap, cx + w / 2 + gap, cz, Math.PI / 2);
    const geo = new THREE.BufferGeometry().setFromPoints(crowd); geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const pm = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    k.root.add(new THREE.Points(geo, pm)); k.ups.push(t => { pm.size = 0.26 + Math.sin(t * 6) * 0.03; });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const x = cx + sx * (w / 2 + gap + tiers * dep + 1), z = cz + sz * (l / 2 + gap + tiers * dep + 1);
      k.hm(new THREE.CylinderGeometry(0.18, 0.25, 16, 8), col, 0.12).position.set(x, 8, z);
      const head = k.hm(new THREE.BoxGeometry(3, 1.4, 0.4), C.white, 0.7); head.position.set(x, 16.5, z); head.lookAt(cx, 0, cz);
    });
    if (jumbo) k.jumbotron(cx, tiers * rise + 6.5, cz - l / 2 - gap - tiers * dep - 1.5, Math.max(9, w * 0.9), jumbo);
  };
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
    k.jumbotron(0, 9, -13.5, 9, { title: 'iYiYi FOOTBALL', home: 'HOME', away: 'AWAY', hs: 14, as: 10, period: 'Q4', clock: 131, points: [3, 7], ticker: '3RD & 4  ·  QB @colin  ·  OPEN: @jay.cruz  ·  ' });
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

  // AR over a real lawn: only the holograms are digital
  tennis(k) {
    const L = 23.77, W = 10.97, S = 8.23, SV = 6.4, ZB = -1.6, ZC = ZB - L / 2, ZF = ZB - L;
    const strip = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1), a = Math.atan2(x2 - x1, z2 - z1);
      [[0.055, C.white, 0.95], [0.26, C.cyan, 0.14]].forEach(([wd, col, op]) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, len), k.holo(col, op)); m.rotation.x = -Math.PI / 2; m.rotation.z = a; m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2); k.root.add(m);
      });
    };
    [ZB, ZF].forEach(z => strip(-W / 2, z, W / 2, z));
    [-W / 2, W / 2, -S / 2, S / 2].forEach(x => strip(x, ZB, x, ZF));
    [ZC + SV, ZC - SV].forEach(z => strip(-S / 2, z, S / 2, z));
    strip(0, ZC + SV, 0, ZC - SV); strip(0, ZB, 0, ZB - 0.2); strip(0, ZF, 0, ZF + 0.2);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(W, L), k.holo(C.cyan, 0.05)); fill.rotation.x = -Math.PI / 2; fill.position.set(0, 0.008, ZC); k.root.add(fill);
    k.net(12.8, 0.914, 0.02, C.white, ZC, 0, 0.09);
    const band = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.07, 0.03), k.holo(C.white, 0.95)); band.position.set(0, 0.95, ZC); k.root.add(band);
    // remote opponent as a hologram
    k.at(k.person({ real: false, color: C.cyan, pose: 'swing', tag: '@kai.p · REMOTE', tagColor: C.cyan }), -1.4, 0, ZF - 0.6, 0);
    // ball in flight with a dotted trail and the bounce mark
    const bounce = V(1.6, 0.05, ZB - 4.2);
    const p1 = k.arcPts(V(-1.2, 1.4, ZF - 0.2), bounce, 1.9, 60), p2 = k.arcPts(bounce, V(1.9, 1.05, ZB + 0.6), 0.85, 24); const pts = p1.concat(p2);
    const dcv = document.createElement('canvas'); dcv.width = dcv.height = 32; const dg = dcv.getContext('2d'); const gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(120,230,255,0.9)'); gr.addColorStop(1, 'rgba(57,213,255,0)'); dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts.filter((_, i) => i % 2 === 0)), new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dcv), size: 0.09, transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending })); k.root.add(dots);
    const ball = new THREE.Group(); k.root.add(ball);
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd8f24a, emissive: 0x7a8a10, emissiveIntensity: 0.6, roughness: 0.9 })));
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), k.holo(C.cyan, 0.25)));
    k.ups.push(t => { const u = (t * 0.32) % 1; const i = u * (pts.length - 1), i0 = Math.floor(i); ball.position.copy(pts[i0]).lerp(pts[Math.min(i0 + 1, pts.length - 1)], i - i0); });
    k.ringMark(bounce.x, bounce.z, C.green, 0.35);
    const inn = k.label('IN', C.green, { w: 0.55, style: 'glass' }); inn.position.set(bounce.x, 0.45, bounce.z);
    // floating glass UI, like Specs
    const sc = k.label('15 – 30', C.white, { w: 1.5, sub: 'SET 1 · GAMES 4 – 3', style: 'glass', big: true }); sc.position.set(-2.9, 1.75, -4.5); k.bob(sc, 0.02, 1.1);
    const sp = k.label('118 MPH', C.white, { w: 1.1, sub: 'LAST SERVE', style: 'glass' }); sp.position.set(2.7, 1.6, -4.2); k.bob(sp, 0.02, 1.3, 1);
    const ym = k.label('Return the serve', C.cyan, { w: 2.6, style: 'neon' }); ym.position.set(0, 2.55, -7.5); k.bob(ym, 0.03, 1.2, 2);
    const ct = k.label('WIMBLEDON COURT', C.white, { w: 1.2, style: 'glass' }); ct.position.set(-5.2, 0.6, ZC);
    k.at(k.person({ ...RF, tag: '@maya.v', pose: 'stand' }), -2.4, 0, ZC + 3.6, Math.PI);
    const mp = k.label('YOUR PARTNER', C.green, { w: 0.9, style: 'glass' }); mp.position.set(-2.4, 2.45, ZC + 3.6);
    k.stadium(0, ZC, W, L, 4.5, { title: 'iYiYi TENNIS · SET 1', home: '@colin', away: '@kai.p', hs: 4, as: 3, period: 'GAME 8', clock: 2400, points: [1], ticker: 'ACE 118 MPH  ·  BREAK POINT  ·  WIMBLEDON MODE  ·  ' });
    k.at(k.person({ ...RQ, tag: '@colin' }), 1.3, 0, 0.2, Math.PI);
    return { dist: 18, h: 9, pov: { x: 1.3, z: 0.2, yaw: Math.PI, pitch: -0.12, fov: 70 } };
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
    k.stadium(0, 0, 5.5, 12, 3.6, { title: 'iYiYi PICKLEBALL', home: 'COLIN+MAYA', away: 'REMOTE', hs: 7, as: 5, period: 'GAME 2', clock: 900, points: [1], ticker: 'KITCHEN FAULT CALLED  ·  DOUBLES  ·  ' });
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
    k.at(k.person({ ...RQ, shirt: 0xff8a3c, pants: 0x1c2a40, pose: 'cheer', tag: '@colin' }), -1, 0, 4.8, Math.PI);
    k.at(k.person({ ...RF, shirt: 0x2e9cdb, pose: 'squat', tag: '@maya.v' }), 1.6, 0, 1.8, Math.PI);
    k.at(k.person({ real: false, color: C.purple, pose: 'cheer' }), 0.6, 0, -1.3); k.at(k.person({ real: false, color: C.purple, pose: 'squat' }), -1.6, 0, -4.4);
    // tomato ball
    const tomato = new THREE.Group(); k.root.add(tomato);
    const tb = k.hm(new THREE.SphereGeometry(0.17, 16, 12), C.red, 0.7, tomato); tb.scale.y = 0.85;
    const leaf = k.hm(new THREE.ConeGeometry(0.08, 0.06, 5), C.green, 0.8, tomato); leaf.position.y = 0.15;
    k.flight(V(-1, 2.6, 1.2), V(-1.2, 0.3, -4.6), 1.6, C.red, tomato, 0.42);
    const tl = k.label('TOMATO BALL', C.red, { w: 1.3 }); tl.position.set(-2.8, 3.4, 0);
    const gv = k.label('GRAVITY 0.6×', C.purple, { w: 1.3 }); gv.position.set(3.4, 3.2, -2);
    k.panel('SET 2 · 18 · 16', C.amber, 0, 4.6, 0, 2.4);
    k.stadium(0, 0, 6.4, 12.8, 3.6, { title: 'iYiYi BEACH VOLLEYBALL', home: 'COLIN+MAYA', away: 'PURPLE', hs: 18, as: 16, period: 'SET 2', clock: 600, points: [1], ticker: 'TOMATO BALL ROUND  ·  GRAVITY 0.6×  ·  ' });
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
    k.at(k.person({ real: false, color: C.red, pose: 'cheer' }), -0.6, 0, -2.4, 0.1);
    const ball = k.ball(0.12, C.amber); k.flight(V(1.1, 2.3, 1.1), V(0, 3.1, hz), 2.4, C.amber, ball, 0.38);
    k.panel('3PT · 72%', C.green, 4.5, 3.6, -2, 1.6, 'SHOT METER');
    k.panel('21', C.amber, -4.5, 3.6, -3, 1.1, 'TO WIN');
    k.stadium(0, -3, 12, 14, 3, { title: 'iYiYi HOOPS · TO 21', home: '@colin', away: '@jay.cruz', hs: 15, as: 12, period: 'Q4', clock: 300, points: [2, 3], ticker: 'FROM DOWNTOWN  ·  SHOT METER 72%  ·  ' });
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
    k.at(k.person({ ...RQ, pose: 'point', tag: '@colin' }), -4.2, 0, -2, 1.13);
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
    const r = k.at(k.person({ ...RQ, shirt: 0x15171c, pants: 0x3a3f4a, hood: true, pose: 'run', tag: '@colin' }), 1, 0, 1.5, 2.94);
    const bag = k.hm(new THREE.SphereGeometry(0.4, 14, 10), C.cyan, 0.25, r); bag.position.set(0.45, 1.1, -0.2);
    k.at(k.person({ ...RF, shirt: 0x1d1f26, hood: true, pose: 'point', tag: '@jay.cruz' }), 5.5, 0, 2.5, -2.2);
    const stars = k.label('WANTED ★★★★', C.amber, { w: 1.8 }); stars.position.set(1, 3, 1.5); k.bob(stars, 0.08);
    k.ringMark(7, 5.5, C.green, 0.7); const safe = k.label('SAFEHOUSE · 0.4 MI', C.green, { w: 1.7 }); safe.position.set(7, 1.2, 5.5);
    k.panel('HEIST · $48,200', C.green, -4, 4.6, -5, 2.4, 'EVADE OR SURRENDER');
    k.walker({ pose: 'run' }, -4.5, 3, -12, 3.0, 0.2); k.walker({}, 6.5, -2, -14, 1.0, 0.5); k.walker({ pose: 'run' }, -6.5, -10, 2, 2.6, 0.9);
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
    k.at(k.person({ ...RQ, shirt: 0xf0f0f0, pants: 0x27324a, pose: 'run', tag: '@colin' }), 0, 0, 7, Math.PI);
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
    k.at(k.person({ ...RQ, glasses: true, me: true }), 0.4, 0, 4.4, Math.PI);
    // opened profile card above @maya.v
    const card = new THREE.Group(); card.position.set(-2.6, 2.9, -1.2); k.root.add(card);
    k.hm(new THREE.BoxGeometry(1.7, 1.05, 0.02), C.cyan, 0.12, card);
    const nm = k.label('@maya.v', C.cyan, { w: 1.3, sub: 'IG · TT · YT · SP', parent: card }); nm.position.set(0, 0.18, 0.03);
    const fl = k.label('FOLLOW', C.green, { w: 0.9, parent: card }); fl.position.set(0, -0.32, 0.03);
    k.bob(card, 0.06, 1.2);
    // gaze ray from wearer
    k.beam(V(0.4, 1.65, 4.3), V(-2.4, 2.3, -1.1), C.cyan, 0);
    k.walker({}, -4.8, 2, -14, 1.1, 0.2); k.walker({}, 5.6, -12, 1, 1.0, 0.6); k.walker({ tag: '@zoe' }, -3.2, -16, -4, 1.2, 1.1);
    return { dist: 11, h: 5, target: 1.4 };
  },
};

// ---------- extra Lenses ----------
function lavaTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#ff3d00'); gr.addColorStop(0.5, '#ffb000'); gr.addColorStop(1, '#ff5a00'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(40,8,0,${0.35 + Math.random() * 0.5})`; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 26, 5 + Math.random() * 14, Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function realLava() {
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d');
  g.fillStyle = '#ff7a10'; g.fillRect(0, 0, N, N);
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.7); gr.addColorStop(0, 'rgba(255,220,90,0.9)'); gr.addColorStop(1, 'rgba(255,90,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
  // dark cooled crust plates with glowing seams between them (tileable)
  const pts = []; for (let i = 0; i < 64; i++) pts.push([Math.random() * N, Math.random() * N]);
  const img = g.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 1e9, b = 1e9;
    for (const [px, py] of pts) for (let oy = -N; oy <= N; oy += N) for (let ox = -N; ox <= N; ox += N) { const dd = (x - px - ox) ** 2 + (y - py - oy) ** 2; if (dd < a) { b = a; a = dd; } else if (dd < b) b = dd; }
    const edge = Math.sqrt(b) - Math.sqrt(a); const i = (y * N + x) * 4;
    const crust = Math.min(1, Math.max(0, (edge - 3) / 10));
    const n = 0.75 + 0.25 * Math.sin(x * 0.21 + y * 0.13) * Math.cos(y * 0.17 - x * 0.07);
    d[i] = d[i] * (1 - crust) + 38 * n * crust; d[i + 1] = d[i + 1] * (1 - crust) + 16 * n * crust; d[i + 2] = d[i + 2] * (1 - crust) + 10 * n * crust;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function windowsTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#5d6168'; g.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 256; y += 20) for (let x = 8; x < 128; x += 20) { g.fillStyle = Math.random() < 0.3 ? '#ffcf7a' : '#1f2833'; g.fillRect(x, y, 12, 13); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
Object.assign(SCENES, {
  spotify(k) {
    k.disc(0, 9, k.noise('#55585e', 22)); k.tree(-6, -5, 1.3); k.tree(6.5, -4.5, 1.1); k.tree(-7, 3, 1);
    const bench = k.sm(new THREE.BoxGeometry(1.8, 0.08, 0.5), 0x7a5a3c); bench.position.set(5.5, 0.45, 1); bench.rotation.y = -1.2;
    const ppl = [[{ ...RF, tag: '@maya.v' }, -2.2, -3, 0.5, 'Midnight Drive', 'Nova Lane'], [{ tag: '@rio.sky' }, 2.5, -4.2, -0.5, 'Golden Hour Loop', 'The Palms'], [{ tag: '@jay.cruz' }, 4.6, -0.6, -1.4, 'Low Tide', 'KAIRO']];
    ppl.forEach(([o, x, z, r, song, artist], j) => {
      k.at(k.person(o), x, 0, z, r);
      const np = k.label(song, C.green, { w: 1.4, sub: artist + ' · LISTEN IN' }); np.position.set(x, 2.75, z); k.bob(np, 0.05, 1.4, j);
      for (let i = 0; i < 5; i++) { const b = k.hm(new THREE.BoxGeometry(0.07, 0.4, 0.07), C.green, 0.6); b.position.set(x - 0.2 + i * 0.1, 3.4, z); const ph = i * 1.3 + j; k.ups.push(t => { b.scale.y = 0.3 + Math.abs(Math.sin(t * 4 + ph)); }); }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), k.holo(C.green, 0.6)); ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.05, z); k.root.add(ring);
      k.ups.push(t => { const u = (t * 0.5 + j * 0.33) % 1; ring.scale.setScalar(1 + u * 3); ring.material.opacity = 0.7 * (1 - u); });
    });
    const card = k.label('@maya.v', C.green, { w: 1.5, sub: 'TOP ARTISTS · Nova Lane · KAIRO' }); card.position.set(-1, 1.9, -1.6); k.bob(card, 0.05);
    k.at(k.person({ ...RQ, tag: '@colin' }), 0, 0, 4.4, Math.PI);
    k.panel('SPOTIFY · NEARBY', C.green, 0, 4.4, -6, 2.4, '3 PEOPLE LISTENING');
    k.walker({}, -5, 3, -12, 1.0, 0.3); k.walker({}, 6.8, -10, 2, 1.1, 0.8);
    return { dist: 13, h: 6 };
  },

  // AR: the real street turns to lava; pedestrians keep to the sidewalk
  nature(k) {
    const RX0 = 3.3, RX1 = 9.6, RW = RX1 - RX0, RC = (RX0 + RX1) / 2;
    const lt = realLava(); lt.repeat.set(RW / 6, 70 / 6);
    const lavaM = new THREE.MeshBasicMaterial({ map: lt, toneMapped: false });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(RW, 90), lavaM); river.rotation.x = -Math.PI / 2; river.position.set(RC, 0.02, -40); k.root.add(river);
    k.ups.push(t => { lt.offset.y = -t * 0.02; lt.offset.x = Math.sin(t * 0.25) * 0.03; });
    // glowing edge where lava meets the curb + heat haze
    [RX0, RX1].forEach(x => { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 90), k.holo(0xff6a00, 0.55)); e.rotation.x = -Math.PI / 2; e.position.set(x, 0.03, -40); k.root.add(e); });
    for (let z = 0; z > -40; z -= 8) { const L = new THREE.PointLight(0xff6a1a, 14, 10, 1.8); L.position.set(RC - 2, 0.6, z); k.root.add(L); }
    // embers and smoke
    for (let p = 0; p < 60; p++) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), k.holo(p % 3 ? C.amber : 0xff4010, 0.95)); k.root.add(e); const ph = Math.random(), x = RX0 + Math.random() * RW, z = -Math.random() * 40; k.ups.push(t => { const u = (t * 0.45 + ph) % 1; e.position.set(x + Math.sin(u * 6 + ph * 9) * 0.3, 0.1 + u * 3.2, z); e.material.opacity = 1 - u; }); }
    const smk = document.createElement('canvas'); smk.width = smk.height = 64; const sg = smk.getContext('2d'); const sgr = sg.createRadialGradient(32, 32, 0, 32, 32, 32); sgr.addColorStop(0, 'rgba(70,60,55,0.55)'); sgr.addColorStop(1, 'rgba(70,60,55,0)'); sg.fillStyle = sgr; sg.fillRect(0, 0, 64, 64);
    const smTex = new THREE.CanvasTexture(smk);
    for (let p = 0; p < 26; p++) { const m = new THREE.SpriteMaterial({ map: smTex, transparent: true, depthWrite: false, toneMapped: false }); const sp = new THREE.Sprite(m); k.root.add(sp); const ph = Math.random(), x = RX0 + Math.random() * RW, z = -2 - Math.random() * 45; k.ups.push(t => { const u = (t * 0.08 + ph) % 1; sp.position.set(x + u * 1.5, 0.5 + u * 7, z); const sc = 1.5 + u * 5; sp.scale.set(sc, sc, 1); m.opacity = 0.7 * Math.sin(Math.PI * u); }); }
    // pedestrians on the sidewalk
    const walker = k.walker;
    walker({ tag: '@rio.sky' }, 0.9, -4, -26, 1.2, 0.1);
    walker({}, 1.6, -9, -30, 1.1, 0.7);
    walker({ pose: 'run', tag: '@kai.p' }, 0.4, -22, -3, 3.2, 0.3);
    walker({}, -0.6, -14, -40, 1.0, 1.2);
    k.at(k.person({ ...RF, tag: '@maya.v', pose: 'point' }), -1.5, 0, -3.6, 0.9);
    // AR labels
    k.panel('THE FLOOR IS LAVA', 0xff6a00, RC - 2.5, 3.2, -9, 2.4, 'STAY ON THE SIDEWALK');
    const gm = k.label('GOOGLE MAPS · MAIN ST', C.cyan, { w: 1.6, style: 'glass', sub: 'REAL STREETS · LAVA MODE' }); gm.position.set(-1.4, 1.9, -6);
    const hot = k.label('1,200°C', 0xff6a00, { w: 1, style: 'glass', sub: 'DON\'T STEP IN' }); hot.position.set(RX0 + 1.4, 1.1, -4.5); k.bob(hot, 0.03);
    k.at(k.person({ ...RQ, tag: '@colin' }), 0, 0, 0, Math.PI);
    return { dist: 14, h: 6, sky: 'lava' };
  },

  workout(k) {
    k.disc(0, 9, k.noise('#232528', 12));
    if (!k.ar) {
    const metal = 0x2a2d33, steel = 0xc9ced6;
    [[-0.65, -0.55], [0.65, -0.55], [-0.65, 0.55], [0.65, 0.55]].forEach(([x, z]) => { const p = k.sm(new THREE.BoxGeometry(0.08, 2.3, 0.08), metal, k.root, 0.5, 0.6); p.position.set(x, 1.15, z - 3); });
    const bar = k.sm(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 12), steel, k.root, 0.25, 1); bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.45, -3.3);
    [-0.95, 0.95].forEach(x => { const pl = k.sm(new THREE.CylinderGeometry(0.23, 0.23, 0.06, 28), 0x111111, k.root, 0.6, 0.1); pl.rotation.z = Math.PI / 2; pl.position.set(x, 1.45, -3.3); });
    const pad = k.sm(new THREE.BoxGeometry(0.32, 0.12, 1.25), 0x1a1a1a, k.root, 0.7); pad.position.set(-3.4, 0.46, -0.8);
    [[-3.4, -1.3], [-3.4, -0.3]].forEach(([x, z]) => { const l = k.sm(new THREE.BoxGeometry(0.28, 0.42, 0.06), metal, k.root, 0.5, 0.6); l.position.set(x, 0.21, z); });
    const shelf = k.sm(new THREE.BoxGeometry(2.2, 0.06, 0.5), metal, k.root, 0.5, 0.6); shelf.position.set(3.5, 0.75, -1.8);
    for (let i = 0; i < 6; i++) { const d = new THREE.Group(); const h1 = k.sm(new THREE.CylinderGeometry(0.06 + i * 0.008, 0.06 + i * 0.008, 0.07, 14), 0x161616, d); h1.rotation.z = Math.PI / 2; h1.position.x = -0.13; const h2 = h1.clone(); h2.position.x = 0.13; d.add(h2); const hd = k.sm(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), steel, d, 0.3, 1); hd.rotation.z = Math.PI / 2; d.position.set(2.6 + i * 0.36, 0.86, -1.8); k.root.add(d); }
    }
    k.hm(new THREE.BoxGeometry(1.0, 1.0, 1.7), C.green, 0.06).position.set(-3.4, 0.5, -0.8); k.ringMark(-3.4, -0.8, C.green, 1.1);
    const nx = k.label('NEXT: BENCH PRESS', C.green, { w: 1.6, sub: '3 SETS × 10 · 135 LB' }); nx.position.set(-3.4, 1.7, -0.8); k.bob(nx, 0.05);
    k.at(k.person({ ...RF, pose: 'squat', tag: '@maya.v' }), 0, 0, -3, 0);
    const rep = k.label('REP 7 / 10', C.amber, { w: 1.5, bar: 0.7 }); rep.position.set(1.6, 2.6, -3); k.bob(rep, 0.04);
    const arrow = k.hm(new THREE.ConeGeometry(0.12, 0.3, 4), C.amber, 0.6); arrow.position.set(0.9, 1.2, -3); k.ups.push(t => { arrow.position.y = 1.0 + Math.abs(Math.sin(t * 1.6)) * 0.6; arrow.rotation.z = Math.cos(t * 1.6) > 0 ? 0 : Math.PI; });
    const ask = k.label('ANOTHER SET?', C.cyan, { w: 1.3, sub: 'YES · NO' }); ask.position.set(1.2, 1.7, 1.6); k.bob(ask, 0.05);
    k.at(k.person({ ...RQ, tag: '@colin' }), 0.3, 0, 4.2, Math.PI);
    return { dist: 12, h: 6, sky: 'indoor' };
  },

  running(k) {
    k.disc(0, 9, k.noise('#a3442f', 20));
    const S = 3, R0 = 2.6, LN = 0.55;
    const inf = new THREE.Group(); k.root.add(inf); const gm = k.solid(0x3f7d3a, 1);
    const ib = new THREE.Mesh(new THREE.PlaneGeometry(2 * S, 2 * R0), gm); ib.rotation.x = -Math.PI / 2; ib.position.y = 0.01; ib.receiveShadow = true; inf.add(ib);
    [-S, S].forEach(x => { const c = new THREE.Mesh(new THREE.CircleGeometry(R0, 40), gm); c.rotation.x = -Math.PI / 2; c.position.set(x, 0.01, 0); c.receiveShadow = true; inf.add(c); });
    const ovalPt = (R, u) => { const L = 4 * S + 2 * Math.PI * R; let s = ((u % 1) + 1) % 1 * L;
      if (s < 2 * S) return [V(-S + s, 0, R), 0]; s -= 2 * S;
      if (s < Math.PI * R) { const a = s / R; return [V(S + Math.sin(a) * R, 0, Math.cos(a) * R), a]; } s -= Math.PI * R;
      if (s < 2 * S) return [V(S - s, 0, -R), Math.PI]; s -= 2 * S; const a = Math.PI + s / R; return [V(-S + Math.sin(a) * R, 0, Math.cos(a) * R), a]; };
    for (let l = 0; l <= 4; l++) { const R = R0 + l * LN; const pts = []; for (let i = 0; i <= 160; i++) pts.push(ovalPt(R, i / 160)[0].setY(0.03)); k.line(pts, C.white, 0.85); }
    k.segs([[0, R0, 0, R0 + 4 * LN]], C.amber, 1);
    const runner = k.person({ ...RF, pose: 'run', tag: '@maya.v' });
    const ghost = k.person({ real: false, color: C.purple, pose: 'run', tag: 'GHOST · PB 52.1s', tagColor: C.purple });
    const pace = k.label('PACE 6:42 /MI', C.green, { w: 1.2 }); k.root.add(pace);
    k.ups.push(t => {
      const [p1] = ovalPt(R0 + 1.5 * LN, t * 0.05); runner.position.copy(p1); const q1 = ovalPt(R0 + 1.5 * LN, t * 0.05 + 0.002)[0].sub(p1); runner.rotation.y = Math.atan2(q1.x, q1.z);
      const [p2] = ovalPt(R0 + 2.5 * LN, t * 0.05 + 0.06); ghost.position.copy(p2); const q2 = ovalPt(R0 + 2.5 * LN, t * 0.05 + 0.062)[0].sub(p2); ghost.rotation.y = Math.atan2(q2.x, q2.z);
      pace.position.set(p1.x, 2.6, p1.z);
    });
    const dash = k.label('40 YD · 4.62s', C.amber, { w: 1.3 }); dash.position.set(0, 1.2, R0 + 2.5 * LN);
    const map = new THREE.Group(); map.position.set(5.6, 2.6, -4.6); map.rotation.y = -0.6; k.root.add(map);
    k.hm(new THREE.BoxGeometry(2.4, 1.6, 0.02), C.cyan, 0.08, map);
    const route = []; let x = -0.9, y = -0.5; for (let i = 0; i < 24; i++) { route.push(V(x, y, 0.02)); x += 0.08; y += Math.sin(i * 0.7) * 0.09 + 0.02; } k.line(route, C.green, 1, map);
    const ml = k.label('RUN MAP · 3.1 MI', C.cyan, { w: 1.2, parent: map }); ml.position.set(0, 1.05, 0);
    k.panel('400M · 0:38.4', C.green, -4.5, 3.8, -2, 2, 'LAP 1 · SPLIT 0:19.2');
    k.jumbotron(0, 7, -14, 8, { title: 'iYiYi RUN CLUB · 400M', home: '@maya.v', away: 'GHOST PB', hs: 38, as: 41, period: 'LAP 1', clock: 52, points: [1], ticker: '40 YD 4.62s  ·  PACE 6:42 /MI  ·  ' });
    k.at(k.person({ ...RQ, tag: '@colin' }), 0.5, 0, 5.4, Math.PI);
    return { dist: 15, h: 7.5 };
  },

  calorie(k) {
    k.disc(0, 6, k.noise('#6b4e36', 10));
    const wood = 0x8a5a3a; const top = k.sm(new THREE.BoxGeometry(2.2, 0.06, 1.2), wood, k.root, 0.55); top.position.set(0, 0.76, 0);
    [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]].forEach(([x, z]) => { const l = k.sm(new THREE.BoxGeometry(0.06, 0.73, 0.06), 0x5a3a26); l.position.set(x, 0.365, z); });
    const plate = k.sm(new THREE.CylinderGeometry(0.17, 0.15, 0.02, 32), 0xf4f4f4, k.root, 0.3); plate.position.set(-0.3, 0.8, 0.12);
    const B = (geo, col, y) => { const m = k.sm(geo, col, k.root, 0.6); m.position.set(-0.3, y, 0.12); return m; };
    B(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 24), 0xc8873c, 0.83); B(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 24), 0x4a2a1a, 0.865); B(new THREE.CylinderGeometry(0.108, 0.108, 0.006, 4), 0xf2c230, 0.882);
    B(new THREE.CylinderGeometry(0.112, 0.112, 0.012, 18), 0x5cae4a, 0.89); const bun = B(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xc8873c, 0.895); bun.scale.y = 0.7;
    const box = k.sm(new THREE.BoxGeometry(0.12, 0.13, 0.07), 0xc8202a, k.root, 0.6); box.position.set(0.25, 0.86, 0.15);
    for (let i = 0; i < 9; i++) { const f = k.sm(new THREE.BoxGeometry(0.012, 0.11, 0.012), 0xf4c542, k.root, 0.7); f.position.set(0.21 + (i % 5) * 0.02, 0.95, 0.14 + (i % 3 - 1) * 0.015); f.rotation.z = (i % 3 - 1) * 0.15; }
    const apple = k.sm(new THREE.SphereGeometry(0.045, 20, 14), 0xb71c1c, k.root, 0.35); apple.position.set(0.55, 0.835, -0.12);
    const cup = k.sm(new THREE.CylinderGeometry(0.045, 0.035, 0.15, 20), 0xe9eef5, k.root, 0.4); cup.position.set(-0.75, 0.865, -0.15);
    const scan = k.hm(new THREE.BoxGeometry(0.3, 0.18, 0.3), C.cyan, 0.05); scan.position.set(-0.3, 0.87, 0.12); k.ups.push(t => scan.scale.setScalar(1 + Math.sin(t * 3) * 0.04));
    const L = (txt, sub, col, x, y, z) => { const l = k.label(txt, col, { w: 0.34, sub }); l.position.set(x, y, z); k.bob(l, 0.01, 1.5, x); };
    L('BURGER · 540', 'P 28g · C 40g · F 30g', C.cyan, -0.32, 1.06, 0.12); L('FRIES · 365', 'MEDIUM', C.amber, 0.3, 1.16, 0.12); L('APPLE · 95', 'FIBER 4g', C.green, 0.66, 0.98, -0.14); L('SODA · 150', '12 OZ', C.pink, -0.86, 1.12, -0.18);
    const tot = k.label('TODAY 1,420 / 2,400 KCAL', C.amber, { w: 0.75, bar: 0.59 }); tot.position.set(0, 1.5, -0.7); k.bob(tot, 0.02);
    k.at(k.person({ ...RF, tag: '@maya.v' }), 0.2, 0, -1.25, 0);
    k.at(k.person({ ...RQ, tag: '@colin' }), 0, 0, 1.1, Math.PI);
    return { dist: 5.2, h: 3.2, target: 0.85, sky: 'indoor', pov: { x: 0, z: 1.05, yaw: Math.PI, pitch: -0.62, fov: 62 } };
  },

  yoga(k) {
    k.grass(); k.tree(-6.5, -4.5, 1.3); k.tree(6, -5.5, 1.2);
    [[-1.6, 0.2, 0x2aa198], [1.6, 0.2, 0x7b5cd6]].forEach(([x, z, c]) => { const m = k.sm(new THREE.BoxGeometry(0.62, 0.012, 1.8), c, k.root, 0.9); m.position.set(x, 0.006, z); });
    const plat = k.hm(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 40), C.cyan, 0.15); plat.position.set(0, 0.04, -3);
    k.at(k.person({ real: false, color: C.cyan, pose: 'cheer', tag: 'COACH · TREE POSE', tagColor: C.cyan }), 0, 0.08, -3, 0);
    const breath = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.025, 8, 64), k.holo(C.cyan, 0.8)); breath.rotation.x = Math.PI / 2; breath.position.set(0, 1.0, -3); k.root.add(breath);
    const inh = k.label('INHALE', C.cyan, { w: 1 }), exh = k.label('EXHALE', C.purple, { w: 1 }); [inh, exh].forEach(l => l.position.set(0, 3.1, -3));
    k.ups.push(t => { const s = Math.sin(t * 0.8); breath.scale.setScalar(1 + s * 0.25); inh.visible = s > 0; exh.visible = s <= 0; });
    k.at(k.person({ ...RF, pose: 'cheer', tag: '@maya.v' }), -1.6, 0, 0.2, 0);
    k.at(k.person({ real: false, color: C.green, pose: 'cheer' }), -1.6, 0, 0.2, 0);
    const match = k.label('POSE MATCH 86%', C.green, { w: 1.3, sub: 'RAISE LEFT ARM A LITTLE' }); match.position.set(-1.6, 2.65, 1.2); k.bob(match, 0.04);
    k.panel('TREE POSE · 0:24', C.cyan, 3.2, 3.2, -3, 2, 'FLOW 3 OF 8');
    k.at(k.person({ ...RQ, tag: '@colin' }), 1.8, 0, 3, -2.6);
    return { dist: 11, h: 5 };
  },
});

// ---------- environment: sky, light, outer ground ----------
// real-world 360° photos (CC0, Poly Haven): [image, u-coordinate to face forward]
export const PANO = {
  football: ['grass', 0.5], tennis: ['grass', 0.5], 'laser-tag': ['plaza-night', 0.5], pickleball: ['court', 0.5], 'ping-pong': ['playroom', 0.62],
  volleyball: ['beach', 0.5], basketball: ['courtyard', 0.5], bowling: ['warehouse', 0.8], cornhole: ['backyard', 0.5], chess: ['park', 0.5],
  mafia: ['yard-night', 0.5], 'beside-them': ['lobby', 0.62], 'we-outside': ['square-night', 0.5], world: ['field', 0.5], tags: ['street', 0.5],
  spotify: ['city', 0.75], nature: ['avenue', 0.5], workout: ['gym', 0.5], running: ['stadium', 0.5], calorie: ['cafe', 0.5], yoga: ['yoga', 0.5],
};
const SKY = { football: 'dusk', 'laser-tag': 'dusk', 'ping-pong': 'indoor', bowling: 'indoor', mafia: 'night', 'beside-them': 'night', 'we-outside': 'night', workout: 'indoor', calorie: 'indoor' };
const SKYDEF = {
  day: { top: '#3f86d6', mid: '#8fc0ec', hor: '#e6eef4', fog: 0xd6e4ef, hemi: [0xdfefff, 0x4b5a3a, 1.0], sun: [0xfff2dd, 2.6], sunPos: [8, 14, 6], exp: 1.0 },
  dusk: { top: '#1d2a5c', mid: '#7a4a7a', hor: '#ff9a5c', fog: 0x8a6a78, hemi: [0xffc9a0, 0x2a2a3a, 0.8], sun: [0xffb074, 2.2], sunPos: [-10, 5, -8], exp: 1.05 },
  night: { top: '#050914', mid: '#111a36', hor: '#2c3a6a', fog: 0x1a2340, hemi: [0x9fb2ff, 0x2a2f40, 1.1], sun: [0xc0d0ff, 1.5], sunPos: [6, 12, 4], exp: 1.3 },
  lava: { top: '#1a0606', mid: '#5a1a0c', hor: '#ff6a2a', fog: 0x6a2a18, hemi: [0xffa070, 0x2a1010, 0.7], sun: [0xff9a60, 1.6], sunPos: [-6, 10, 6], exp: 1.1 },
  indoor: { top: '#2a2622', mid: '#3a332c', hor: '#4a4036', fog: 0x3a342e, hemi: [0xfff4e6, 0x5a4c3e, 1.5], sun: [0xffffff, 2.4], sunPos: [2, 12, 3], exp: 1.15 },
};
function skyTexture(d) {
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 512; const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, d.top); gr.addColorStop(0.38, d.mid); gr.addColorStop(0.5, d.hor); gr.addColorStop(0.56, d.hor); gr.addColorStop(1, '#1a1c22'); g.fillStyle = gr; g.fillRect(0, 0, 8, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const ENV = {};
function envFor(kind) {
  if (ENV[kind]) return ENV[kind];
  const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(SKYDEF[kind]), side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer()); ENV[kind] = pm.fromScene(s, 0.02).texture; pm.dispose(); return ENV[kind];
}

// ---------- views: each card owns a scene; one shared WebGL renderer draws them all ----------
let R = null;
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.setPixelRatio(1);
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
  return R;
}
export class SceneView {
  constructor(name, opts = {}) {
    this.name = name; this.fpMode = !!opts.fp;
    const sc = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1.5, 0.05, 300);
    this.root = new THREE.Group(); sc.add(this.root);
    const pano = PANO[name];
    this.k = makeKit(this.root, this.fpMode); this.k.ar = !!pano; const cfg = SCENES[name](this.k) || {};
    const kind = cfg.sky || SKY[name] || 'day', d = SKYDEF[kind]; this.exp = d.exp;
    sc.environment = envFor(kind);
    if (!pano) sc.fog = new THREE.Fog(d.fog, kind === 'indoor' ? 14 : 30, kind === 'indoor' ? 40 : 110);
    sc.add(new THREE.HemisphereLight(d.hemi[0], d.hemi[1], d.hemi[2]));
    const sun = new THREE.DirectionalLight(d.sun[0], d.sun[1]); sun.position.set(...d.sunPos); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 60 }); sc.add(sun);
    if (pano) { /* real-world photo added below, once the viewpoint is known */ 
    } else if (kind === 'indoor') {
      const room = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 26), new THREE.MeshStandardMaterial({ color: 0x8a7d6e, roughness: 0.95, side: THREE.BackSide })); room.position.y = 3.48; room.receiveShadow = true; sc.add(room);
      for (let i = -1; i <= 1; i++) { const strip = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false })); strip.position.set(0, 6.9, i * 5); sc.add(strip); }
    } else {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(140, 48, 24), new THREE.MeshBasicMaterial({ map: skyTexture(d), side: THREE.BackSide, fog: false, depthWrite: false })); sc.add(dome);
    }
    // the world continues past the play area
    const gr = pano ? null : this.k.ground; if (gr) {
      let mat; if (gr.tex) { const t = new THREE.CanvasTexture(gr.tex.image); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); t.anisotropy = 8; mat = new THREE.MeshStandardMaterial({ map: t, roughness: 1, color: 0xbbbbbb }); }
      else mat = new THREE.MeshStandardMaterial({ color: gr.color, roughness: 1 });
      const outer = new THREE.Mesh(new THREE.CircleGeometry(kind === 'indoor' ? 13 : 130, 64), mat); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.012; outer.receiveShadow = true; sc.add(outer);
    }
    // third-person orbit
    this.base = this.dist = (cfg.dist || 16) * 1.12; this.target = V(0, cfg.target ?? 1, 0);
    this.pitch0 = this.pitch = Math.atan2(cfg.h || 7, this.base) * 0.9; this.yaw0 = this.yaw = 0.45 + Math.random() * 0.4; this.idle = 100; this.dragging = false; this.fov0 = this.fov = 40;
    // first person: stand where the Specs wearer stands
    if (this.fpMode) {
      let me = null; this.root.traverse(o => { if (!me && o.userData.me) me = o; });
      const p = cfg.pov || (me ? { x: me.position.x, z: me.position.z, yaw: me.rotation.y } : { x: 0, z: 8, yaw: Math.PI });
      if (me) me.visible = false;
      this.eye = V(p.x, p.y ?? 1.62, p.z); this.yaw0 = this.yaw = p.yaw; this.pitch0 = this.pitch = p.pitch ?? -0.1; this.fov0 = this.fov = p.fov ?? 72;
    }
    if (pano) {
      // 360° photo of a real place; holograms and people are composited on top, with soft contact shadows
      const hi = renderer().capabilities.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches;
      const mat = new THREE.MeshBasicMaterial({ color: 0x6f7a6a, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
      const sph = new THREE.Mesh(new THREE.SphereGeometry(200, 96, 48), mat); sph.scale.x = -1; sph.renderOrder = -1;
      sph.rotation.y = (this.fpMode ? this.yaw0 : 0) - Math.PI / 2 + 2 * Math.PI * pano[1];
      if (this.eye) sph.position.set(this.eye.x, 0, this.eye.z);
      sc.add(sph);
      new THREE.TextureLoader().load(`img/pano-${pano[0]}-${hi ? 'hi' : 'lo'}.jpg`, t => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
        const e = t.clone(); e.mapping = THREE.EquirectangularReflectionMapping; e.needsUpdate = true; sc.environment = e;
      });
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.32 })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.002; sh.receiveShadow = true; sc.add(sh);
    }
    this.lastT = null;
  }
  rotate(dx, dy) {
    if (this.fpMode) { this.yaw += dx * 0.0042; this.pitch = Math.min(0.75, Math.max(-1.2, this.pitch + dy * 0.0042)); }
    else { this.yaw -= dx * 0.008; this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + dy * 0.006)); }
    this.idle = 0;
  }
  zoom(f) { if (this.fpMode) this.fov = Math.min(95, Math.max(30, this.fov * f)); else this.dist = Math.min(this.base * 1.8, Math.max(this.base * 0.35, this.dist * f)); this.idle = 0; }
  reset() { this.dist = this.base; this.pitch = this.pitch0; this.yaw = this.yaw0; this.fov = this.fov0; this.idle = 0; }
  draw(t, canvas, scale = 1) {
    const w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale); if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const dt = this.lastT == null ? 0 : Math.min(0.1, t - this.lastT); this.lastT = t;
    const c = this.camera; c.aspect = w / h;
    if (!this.dragging) this.idle++;
    if (this.fpMode) {
      if (this.idle > 120) { this.yaw += Math.cos((this.idle - 120) * 0.006) * 0.0011; }
      c.fov = this.fov * (w / h < 1 ? 1.25 : 1);
      c.position.set(this.eye.x, this.eye.y + Math.sin(t * 1.7) * 0.006, this.eye.z);
      const cp = Math.cos(this.pitch); c.lookAt(this.eye.x + Math.sin(this.yaw) * cp, this.eye.y + Math.sin(this.pitch), this.eye.z + Math.cos(this.yaw) * cp);
    } else {
      if (this.idle > 90) this.yaw += 0.0025;
      c.fov = w / h < 1 ? 55 : 40; const cp = Math.cos(this.pitch);
      c.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist); c.lookAt(this.target);
    }
    c.updateProjectionMatrix();
    const k = this.k; for (let i = 0; i < k.mats.length; i++) { const m = k.mats[i]; m.opacity = m.userData.base * (0.82 + 0.18 * Math.sin(t * 2.2 + i * 0.37)); }
    for (const f of k.ups) f(t);
    for (const m of k.mixers) m.update(dt);
    const r = renderer(); r.toneMappingExposure = this.exp; const s = r.getSize(new THREE.Vector2()); if (s.x !== w || s.y !== h) r.setSize(w, h, false);
    r.render(this.scene, c);
    const g = canvas.getContext('2d'); g.clearRect(0, 0, w, h); g.drawImage(r.domElement, 0, 0, w, h);
  }
}
// drag to look around; a tap (no drag) calls onTap
export function attachDrag(el, getView, onTap) {
  let down = null;
  el.addEventListener('pointerdown', e => { const v = getView(); if (!v) return; down = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: false }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    const v = getView(); if (!down || !v || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down.x = e.clientX; down.y = e.clientY;
    if (!down.moved && Math.hypot(e.clientX - down.x0, e.clientY - down.y0) > 6) { down.moved = true; v.dragging = true; el.classList.add('grab'); }
    if (down.moved) v.rotate(dx, dy);
  });
  const up = e => { const v = getView(); if (!down) return; const tap = !down.moved; down = null; el.classList.remove('grab'); if (v) { v.dragging = false; v.idle = 0; } if (tap && e.type === 'pointerup' && onTap) onTap(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { const v = getView(); if (!v || (!e.ctrlKey && !e.metaKey)) return; e.preventDefault(); v.zoom(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });
}
