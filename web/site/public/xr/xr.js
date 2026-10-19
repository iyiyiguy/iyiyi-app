// iYiYi XR: the 3D iYiYi for see-through XR glasses (XREAL Aura / Android XR, Meta Quest 3 in
// passthrough, any browser with WebXR "immersive-ar").
//
// - Link: same as the Meta glasses: a 6-letter code, typed in the phone app (Settings > Meta
//   glasses), gives this browser its own session (migration 084 + edge function glasses-link).
// - Who's around: iYiYi members within ~150 ft who allow tagging (RPC camera_nearby) get a name tag
//   floating over their head, placed from GPS + which way is north. Point at a tag and pinch: their
//   profile card pops up; Socials opens the next card.
// - Nearby: a floating list split by range (Close / Near / Around you).
// - Laser tag: while your phone is in a match, enemies get red markers over their heads (teammates
//   green, your lock-on gold). Pinch to fire: the shot goes where you point, laser bolts fly, hits
//   burst, a knocked-out player collapses into a pile of blocks. Rides the same realtime topic as
//   the Ray-Ban glasses and the Specs (glasses:<user>:<pair key>), so the phone runs the game.
// - North: from the glasses' compass if the browser has one, otherwise learned while you walk
//   (GPS track vs. tracked movement), and ◀ ▶ on the home panel nudge it by hand.
// Preview: without XR (a laptop), "Preview" shows the same scene; drag to look, click to pinch.
// Test data: ?xrtest adds pretend people and a pretend laser tag match (no account needed).
import * as THREE from './three.module.min.js'

const SUPABASE_URL = 'https://sqsjwcsrgcgcpxccxedp.supabase.co'
const ANON = 'sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x'
const API = SUPABASE_URL + '/functions/v1'
const TEST = /xrtest/.test(location.search)
const LABELS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', twitter: 'X', snapchat: 'Snapchat', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', spotify: 'Spotify', soundcloud: 'SoundCloud', youtube: 'YouTube', discord: 'Discord', twitch: 'Twitch', telegram: 'Telegram' }
// the app's game palette (src/games/studio.js)
const C = { friendly: '#39d5ff', enemy: '#ff3d52', objective: '#ffb21e', health: '#5cf2a0', epic: '#b06cff', pink: '#ff4fa3', text: '#f2f4f7', muted: 'rgba(242,244,247,0.62)', faint: 'rgba(242,244,247,0.38)', panel: 'rgba(8,10,14,0.9)', line: 'rgba(255,255,255,0.16)', ink: '#07090c' }
const PAL = [0xff4fa3, 0x39d5ff, 0xffb21e, 0x5cf2a0, 0xb06cff, 0xff7a1a]
const D2R = Math.PI / 180
const FONT_D = '"Chakra Petch", sans-serif'
const FONT_U = '"Barlow Semi Condensed", sans-serif'

const sb = window.supabase.createClient(SUPABASE_URL, ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'iyx_auth' } })
const flat = document.getElementById('flat')
const st = {
  user: null, pos: null, watch: null,
  north: Number(localStorage.getItem('iyx_north') || 0), northSrc: localStorage.getItem('iyx_north') ? 'saved' : 'none',
  mode: 'home', people: [], nearby: [], range: 0, profile: null, xr: false, preview: false,
  tag: { ch: null, hud: null, hudAt: 0 },
}

// ======================================================================= helpers
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
async function token() { const s = (await sb.auth.getSession()).data.session; if (!s) throw new Error('Signed out'); return s.access_token }
async function api(path, opts = {}) {
  const res = await fetch(API + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'Something went wrong')
  return d
}
function ft(m) { const f = m * 3.28084; return f < 1000 ? Math.max(5, Math.round(f / 5) * 5) + ' FT' : (f / 5280).toFixed(1) + ' MI' }
function distOf(u) { const m = u.distance_m != null ? +u.distance_m : u.distance != null ? +u.distance : u.distance_ft != null ? u.distance_ft / 3.28084 : null; return m != null && isFinite(m) ? m : null }
function bearingTo(a, b) {
  const y = Math.sin((b.lng - a.lng) * D2R) * Math.cos(b.lat * D2R)
  const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lng - a.lng) * D2R)
  return (Math.atan2(y, x) / D2R + 360) % 360
}
function metersBetween(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * D2R, dLng = (b.lng - a.lng) * D2R
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function handleOf(v) { v = String(v || '').trim(); const m = v.match(/^https?:\/\/[^/]+\/(.+)$/); if (m) v = m[1].split(/[/?#]/).filter(Boolean).pop() || v; return v.replace(/^@/, '') }
function socialsOf(u) { return ((u && u.social_links) || []).filter((l) => l && l.value && LABELS[l.platform]) }

// sound
let actx = null
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)()
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain()
    o.connect(g); g.connect(actx.destination)
    if (kind === 'pew') { o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.16); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18) }
    else if (kind === 'hit' || kind === 'tap') { o.type = 'triangle'; o.frequency.setValueAtTime(kind === 'tap' ? 700 : 900, t); o.frequency.setValueAtTime(1300, t + 0.05); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15) }
    else if (kind === 'ouch') { o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.35); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4) }
    else { o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.7); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8) }
    o.start(t); o.stop(t + 0.85)
  } catch (e) {}
}

// ======================================================================= flat (2D) screens
function logoHtml() { return '<h1><span class="a">i</span><span class="b">Y</span><span class="g">i</span><span class="b">Y</span><span class="a">i</span></h1><div class="kick">XR · glasses in 3D</div>' }
function showFlat(html) { flat.style.display = 'flex'; flat.innerHTML = '<div class="card">' + html + '<div class="credit">Created by Colin Phillips</div></div>' }
async function xrSupported() { try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))) } catch (e) { return false } }

async function startScreen() {
  const ok = await xrSupported()
  const s = TEST ? { user: { id: 'test' } } : (await sb.auth.getSession()).data.session
  st.user = s ? s.user : null
  showFlat(logoHtml() +
    '<p>Names over people\'s heads, their profiles, and laser tag markers in your real space.</p>' +
    (st.user
      ? (ok ? '<button class="primary" id="go3d">Enter 3D</button>' : '<p class="small">This browser can\'t do 3D glasses mode. Open <b>iyiyi.xyz/xr</b> in the browser on your XR glasses (XREAL Aura, Android XR, Meta Quest).</p>') +
        '<button id="preview">Preview on this screen</button>' + (TEST ? '' : '<button id="unlink">Unlink</button>')
      : '<button class="primary" id="link">Link my iYiYi account</button>' + '<button id="preview">Preview on this screen</button>') +
    '<p class="small">Uses your location and motion so tags line up with people.</p>')
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn }
  on('go3d', enterXR)
  on('preview', enterPreview)
  on('link', linkScreen)
  on('unlink', async () => { await sb.auth.signOut(); startScreen() })
}

let linkTimer = null
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => ('0' + b.toString(16)).slice(-2)).join('') }
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), (x) => ('0' + x.toString(16)).slice(-2)).join('') }
async function linkScreen() {
  clearTimeout(linkTimer)
  showFlat(logoHtml() + '<p>On your phone open <b>iYiYi</b> → <b>Settings</b> → <b>Meta glasses</b> and type this code:</p><div class="code" id="code">······</div><p class="small" id="ls">Making a code…</p><button id="back">Back</button>')
  document.getElementById('back').onclick = () => { clearTimeout(linkTimer); startScreen() }
  try {
    const secret = randHex(32)
    const r = await sb.rpc('glasses_link_start', { p_secret_hash: await sha256(secret) })
    if (r.error) throw r.error
    const code = r.data, started = Date.now()
    document.getElementById('code').textContent = code
    document.getElementById('ls').textContent = 'Waiting for your phone…'
    const poll = async () => {
      const ls = document.getElementById('ls'); if (!ls) return
      if (Date.now() - started > 9.5 * 60000) { linkScreen(); return }
      try {
        const res = await fetch(API + '/glasses-link', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ code, secret }) })
        const d = await res.json().catch(() => ({}))
        if (res.status === 200 && d.token_hash) {
          const v = await sb.auth.verifyOtp({ token_hash: d.token_hash, type: 'magiclink' })
          if (v.error) throw v.error
          beep('hit'); startScreen(); return
        }
        if (res.status === 410) { linkScreen(); return }
      } catch (e) { ls.textContent = (e && e.message) || 'Trying again…' }
      linkTimer = setTimeout(poll, 2500)
    }
    linkTimer = setTimeout(poll, 2500)
  } catch (e) { const ls = document.getElementById('ls'); if (ls) ls.textContent = (e && e.message) || 'Could not make a code' }
}

// ======================================================================= 3D scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.domElement.id = 'gl'
renderer.domElement.style.display = 'none'
renderer.xr.enabled = true
renderer.xr.setReferenceSpaceType('local-floor')
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 3000)
camera.position.set(0, 1.6, 0)
scene.add(camera)
const previewFloor = new THREE.GridHelper(80, 80, 0x2a3344, 0x161b24)
previewFloor.visible = false
scene.add(previewFloor)
window.addEventListener('resize', () => { if (renderer.xr.isPresenting) return; camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight) })

const ui = new THREE.Group(); scene.add(ui) // world-locked panels
const tagsGroup = new THREE.Group(); scene.add(tagsGroup)
const fxGroup = new THREE.Group(); scene.add(fxGroup)
const fx = []

// ---------- canvas panels ----------
// A panel is a flat card with a canvas texture; buttons are rectangles in canvas pixels.
function makePanel(wPx, hPx, wM) {
  const canvas = document.createElement('canvas'); canvas.width = wPx; canvas.height = hPx
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
  const hM = wM * hPx / wPx
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }))
  mesh.renderOrder = 10
  const p = { mesh, canvas, ctx, tex, w: wPx, h: hPx, buttons: [], hover: -1, draw: null }
  mesh.userData.panel = p
  return p
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
function panelBg(p, kicker) {
  const c = p.ctx
  c.clearRect(0, 0, p.w, p.h)
  rr(c, 4, 4, p.w - 8, p.h - 8, 10); c.fillStyle = C.panel; c.fill(); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke()
  // amber corner brackets like the app's game cards
  c.strokeStyle = C.objective; c.lineWidth = 5
  for (const [x, y, dx, dy] of [[14, 14, 1, 1], [p.w - 14, 14, -1, 1], [14, p.h - 14, 1, -1], [p.w - 14, p.h - 14, -1, -1]]) { c.beginPath(); c.moveTo(x + dx * 34, y); c.lineTo(x, y); c.lineTo(x, y + dy * 34); c.stroke() }
  if (kicker) { c.fillStyle = C.friendly; c.font = '700 26px ' + FONT_U; c.textAlign = 'left'; c.fillText(kicker.toUpperCase().split('').join(String.fromCharCode(8202)), 44, 62) }
  p.buttons = []
}
function button(p, x, y, w, h, label, action, opts = {}) {
  const c = p.ctx, i = p.buttons.length, hot = p.hover === i
  rr(c, x, y, w, h, 6)
  c.fillStyle = opts.primary ? (hot ? '#7fe6ff' : C.friendly) : hot ? 'rgba(57,213,255,0.18)' : 'rgba(255,255,255,0.05)'
  c.fill(); c.lineWidth = 3; c.strokeStyle = hot ? C.objective : C.line; c.stroke()
  c.fillStyle = opts.primary ? C.ink : hot ? C.objective : C.text
  c.font = '700 ' + (opts.size || 38) + 'px ' + FONT_U; c.textAlign = opts.left ? 'left' : 'center'; c.textBaseline = 'middle'
  c.fillText(label, opts.left ? x + 28 : x + w / 2, y + h / 2 + 2)
  if (opts.meta) { c.textAlign = 'right'; c.fillStyle = C.muted; c.font = '600 30px ' + FONT_U; c.fillText(opts.meta, x + w - 24, y + h / 2 + 2) }
  c.textBaseline = 'alphabetic'
  p.buttons.push({ x, y, w, h, action, data: opts.data })
}
function textLine(p, s, x, y, size, color, weight = 700, font = FONT_U, align = 'left') { const c = p.ctx; c.fillStyle = color; c.font = weight + ' ' + size + 'px ' + font; c.textAlign = align; c.fillText(s, x, y) }
function wrap(p, s, x, y, maxW, size, color, lines = 3) {
  const c = p.ctx; c.font = '500 ' + size + 'px ' + FONT_U; c.fillStyle = color; c.textAlign = 'left'
  const words = String(s || '').split(/\s+/); let line = '', n = 0
  for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * size * 1.25); line = w; if (++n >= lines) return } else line = t }
  if (line && n < lines) c.fillText(line, x, y + n * size * 1.25)
}
const imgCache = {}
function avatar(p, u, x, y, r) {
  const c = p.ctx
  c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.closePath(); c.fillStyle = '#11151d'; c.fill(); c.clip()
  const url = u && (u.avatar_url || u.avatar || u.photo_url)
  const im = url && imgCache[url]
  if (im && im.complete && im.naturalWidth) c.drawImage(im, x - r, y - r, r * 2, r * 2)
  else {
    c.fillStyle = C.friendly; c.font = '700 ' + Math.round(r) + 'px ' + FONT_D; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(((u && u.username) || '?').slice(0, 1).toUpperCase(), x, y + 2); c.textBaseline = 'alphabetic'
    if (url && !imgCache[url]) { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => redrawAll(); i.onerror = () => {}; i.src = url; imgCache[url] = i }
  }
  c.restore(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.lineWidth = 4; c.strokeStyle = C.friendly; c.stroke()
}
function redraw(p) { if (p && p.draw) { p.draw(); p.tex.needsUpdate = true } }
function redrawAll() { for (const p of [homeP, listP, cardP, barP, hudP]) if (p.mesh.visible) redraw(p); people.forEach((t) => redraw(t.panel)) }

// ---------- the panels ----------
const homeP = makePanel(1000, 950, 0.9)
const listP = makePanel(1000, 1100, 0.9)
const cardP = makePanel(1000, 900, 0.85)
const barP = makePanel(1000, 170, 0.75) // small bar while looking around / in laser tag
const hudP = makePanel(1000, 260, 0.6) // laser tag HUD, follows your view
const gamesP = makePanel(1000, 960, 0.9) // the games list
const pickP = makePanel(1000, 960, 0.9) // a game's own choices (sport, board size, side...)
const UIP = [homeP, listP, cardP, barP, gamesP, pickP]
for (const p of UIP) { p.mesh.visible = false; ui.add(p.mesh) }
hudP.mesh.visible = false; scene.add(hudP.mesh)

homeP.draw = () => {
  const p = homeP; panelBg(p, 'iYiYi XR')
  const c = p.ctx
  ;['i', 'Y', 'i', 'Y', 'i'].forEach((ch, i) => textLine(p, ch, 330 + i * 70, 180, 120, ['#ff4fa3', C.friendly, C.objective, C.friendly, '#ff4fa3'][i], 700, FONT_D, 'center'))
  textLine(p, st.northSrc === 'none' ? 'NORTH: LEARNING — WALK A FEW STEPS OR USE ◀ ▶' : 'NORTH: ' + (st.northSrc === 'compass' ? 'COMPASS' : st.northSrc === 'walk' ? 'LEARNED FROM WALKING' : st.northSrc === 'manual' ? 'SET BY HAND' : 'SAVED'), 500, 232, 26, C.muted, 600, FONT_U, 'center')
  button(p, 60, 270, 880, 110, "WHO'S AROUND ME", 'around', { primary: true })
  button(p, 60, 400, 880, 110, 'PEOPLE NEARBY', 'nearby')
  button(p, 60, 530, 880, 110, 'LASER TAG', 'tag')
  button(p, 60, 660, 880, 110, 'GAMES', 'games', { meta: 'SPORTS · CHESS · MAFIA · MORE' })
  button(p, 60, 800, 200, 100, '◀', 'northL', { size: 44 })
  textLine(p, 'TURN TAGS', 500, 845, 30, C.muted, 700, FONT_U, 'center'); textLine(p, 'IF THEY\'RE OFF', 500, 882, 26, C.faint, 600, FONT_U, 'center')
  button(p, 740, 800, 200, 100, '▶', 'northR', { size: 44 })
  void c
}
listP.draw = () => {
  const p = listP; panelBg(p, 'People nearby')
  const tabs = ['CLOSE', 'NEAR', 'AROUND YOU']
  tabs.forEach((t, i) => button(p, 44 + i * 310, 90, 290, 84, t, 'range', { data: i, size: 32, primary: st.range === i }))
  const lim = [15, 150, 1e9][st.range], lo = [0, 15, 150][st.range]
  const rows = st.nearby.filter((u) => { const d = distOf(u); return d == null ? st.range === 2 : d >= lo && d < lim }).slice(0, 7)
  if (!rows.length) textLine(p, st.nearbyErr || (st.nearbyLoading ? 'LOOKING AROUND…' : 'NOBODY IN THIS RANGE'), 500, 330, 34, C.muted, 700, FONT_U, 'center')
  rows.forEach((u, i) => {
    const y = 200 + i * 112
    button(p, 44, y, 912, 100, '', 'open', { data: u })
    avatar(p, u, 104, y + 50, 36)
    textLine(p, '@' + (u.username || 'member'), 160, y + 62, 38, C.text)
    const d = distOf(u); if (d != null) textLine(p, ft(d), 930, y + 62, 30, C.muted, 600, FONT_U, 'right')
  })
  button(p, 44, 990, 912, 84, 'BACK', 'home', { size: 32 })
}
cardP.draw = () => {
  const p = cardP, u = st.profile || {}
  const soc = socialsOf(u)
  if (st.mode === 'socials') {
    panelBg(p, 'Socials')
    avatar(p, u, 110, 140, 46); textLine(p, '@' + (u.username || ''), 180, 156, 48, C.text, 700, FONT_D)
    soc.slice(0, 6).forEach((l, i) => {
      const y = 230 + i * 92
      textLine(p, LABELS[l.platform].toUpperCase(), 60, y + 50, 32, C.muted, 700)
      textLine(p, '@' + handleOf(l.value), 940, y + 50, 36, C.friendly, 700, FONT_U, 'right')
      p.ctx.fillStyle = C.line; p.ctx.fillRect(60, y + 72, 880, 2)
    })
    if (!soc.length) textLine(p, 'NO SOCIALS LINKED YET', 500, 360, 34, C.muted, 700, FONT_U, 'center')
    textLine(p, 'Follow them from your phone: their profile has Follow everywhere.', 500, 810, 26, C.faint, 600, FONT_U, 'center')
    button(p, 44, 680, 912, 84, 'BACK', 'card', { size: 32 })
    return
  }
  panelBg(p, 'Profile')
  avatar(p, u, 150, 220, 90)
  textLine(p, '@' + (u.username || ''), 270, 210, 58, C.text, 700, FONT_D)
  const d = distOf(u); textLine(p, d != null ? ft(d) + ' AWAY' : (u.account_type === 'business' ? 'BUSINESS' : ''), 272, 258, 30, C.muted, 600)
  if (u.bio) wrap(p, u.bio, 60, 370, 880, 34, C.muted, 3)
  else if (st.profileLoading) textLine(p, 'LOADING…', 60, 380, 30, C.faint, 600)
  button(p, 44, 500, 912, 100, soc.length ? 'SOCIALS' : 'NO SOCIALS YET', soc.length ? 'socials' : 'noop', { primary: !!soc.length, meta: soc.length ? soc.slice(0, 3).map((l) => LABELS[l.platform]).join(' · ') : '' })
  const following = !!u.is_following || u.follow_status === 'pending'
  button(p, 44, 620, 912, 100, following ? (u.follow_status === 'pending' ? 'REQUESTED' : 'FOLLOWING ✓') : 'FOLLOW ON iYiYi', 'follow')
  button(p, 44, 760, 912, 90, 'CLOSE', 'closecard', { size: 32 })
}
barP.draw = () => {
  const p = barP; panelBg(p)
  if (st.mode === 'game') {
    const toastOn = st.toast && Date.now() < st.toastUntil
    textLine(p, String(st.gameTitle || '').toUpperCase(), 44, 62, 30, C.friendly, 700)
    textLine(p, String(toastOn ? st.toast : st.gameLine || '').toUpperCase().slice(0, 52), 44, 104, 30, toastOn ? C.objective : C.text, 700)
    textLine(p, String(st.gameLine2 || '').toUpperCase().slice(0, 56), 44, 142, 24, C.muted, 600)
    button(p, 760, 40, 200, 90, 'MENU', 'home', { size: 32 })
    return
  }
  const label = st.mode === 'tag' ? (tagLive() ? 'LASER TAG · POINT + PINCH TO FIRE' : 'LASER TAG · START A MATCH ON YOUR PHONE') : "WHO'S AROUND · POINT AT A NAME + PINCH"
  textLine(p, label, 44, 70, 32, C.friendly, 700)
  textLine(p, st.mode === 'tag' ? (st.tag.hud && st.tag.hud.score ? String(st.tag.hud.score) : '') : (st.aroundMsg || ''), 44, 125, 30, C.muted, 600)
  button(p, 760, 40, 200, 90, 'MENU', 'home', { size: 32 })
}
hudP.draw = () => {
  const p = hudP, h = st.tag.hud || {}
  const c = p.ctx; c.clearRect(0, 0, p.w, p.h)
  if (!tagLive()) return
  rr(c, 4, 4, p.w - 8, p.h - 8, 10); c.fillStyle = 'rgba(8,10,14,0.55)'; c.fill()
  textLine(p, String(h.score || ''), 30, 60, 36, C.text, 700)
  textLine(p, String(h.clock || ''), 970, 60, 36, C.text, 700, FONT_U, 'right')
  const hp = Math.max(0, Math.min(1, (h.hp || 0) / (h.max || 100)))
  c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(30, 90, 940, 22); c.fillStyle = hp < 0.35 ? C.enemy : C.health; c.fillRect(30, 90, 940 * hp, 22)
  let mid = ''
  if (h.phase === 'countdown') mid = String(h.countdown || 'GET READY')
  else if (h.phase === 'lobby') mid = 'IN THE LOBBY · ' + (h.players || 0) + ' PLAYERS'
  else if (h.phase === 'ended') mid = 'MATCH OVER ' + (h.result || '')
  else if (h.alive === false) mid = "YOU'RE OUT" + (h.respawn ? ' · BACK IN ' + h.respawn + 'S' : '')
  else if (h.target) mid = '◎ @' + h.target.name + (h.target.dist ? '  ' + h.target.dist : '')
  textLine(p, mid, 500, 175, 44, h.target && !h.phase?.match?.(/countdown|lobby|ended/) ? C.objective : C.objective, 700, FONT_D, 'center')
  textLine(p, (h.gun || '') + (h.ammo != null ? ' · ' + h.ammo : ''), 30, 235, 30, C.muted, 600)
}

const GAME_LIST = [
  ['sports', 'SPORTS', 'TENNIS · PICKLEBALL · PING PONG · HOOPS'],
  ['chess', 'CHESS', 'TABLETOP · FLOOR · LIFE-SIZE'],
  ['mafia', 'MAFIA', 'THE PENGUIN TOWN'],
  ['beside', 'BESIDE THEM', 'TASKS · IMPOSTER · VOTES'],
  ['missions', 'WE OUTSIDE', 'JOBS · COPS & ROBBERS'],
]
gamesP.draw = () => {
  const p = gamesP; panelBg(p, 'Games')
  GAME_LIST.forEach(([id, name, meta], i) => button(p, 44, 100 + i * 140, 912, 120, name, 'play', { data: id, left: true, meta, primary: i === 0 }))
  button(p, 44, 830, 912, 90, 'BACK', 'home', { size: 32 })
}
pickP.draw = () => {
  const p = pickP, pk = st.pick || { title: '', items: [] }
  panelBg(p, pk.title)
  const n = pk.items.length, h = Math.min(120, Math.floor(700 / Math.max(1, n)) - 16)
  pk.items.forEach(([label, value, meta], i) => button(p, 44, 100 + i * (h + 16), 912, h, label, 'pickit', { data: value, meta: meta || '', size: h < 90 ? 32 : 38, primary: i === 0 }))
  button(p, 44, 840, 912, 90, 'MENU', 'home', { size: 32 })
}

// ---------- people tags (over heads) ----------
const people = new Map() // id -> { panel, line, pos(vec3), seen, data }
function tagFor(u) {
  let t = people.get(u.id)
  if (!t) {
    const panel = makePanel(640, 200, 0.75)
    panel.draw = () => {
      const p = panel, sel = hoverTag === t
      const c = p.ctx; c.clearRect(0, 0, p.w, p.h)
      rr(c, 6, 6, p.w - 12, p.h - 12, 14); c.fillStyle = C.panel; c.fill(); c.lineWidth = 6; c.strokeStyle = sel ? C.objective : C.friendly; c.stroke()
      avatar(p, t.data, 96, 100, 62)
      textLine(p, '@' + (t.data.username || 'member'), 180, 96, 54, sel ? C.objective : C.text, 700, FONT_D)
      textLine(p, t.dist != null ? ft(t.dist) : '', 182, 150, 34, C.muted, 600)
    }
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1, 0.01), new THREE.MeshBasicMaterial({ color: 0x39d5ff, transparent: true, opacity: 0.7 }))
    tagsGroup.add(panel.mesh); tagsGroup.add(line)
    panel.mesh.userData.tag = true
    t = { panel, line, pos: null, data: u, dist: null, seen: 0 }
    panel.mesh.userData.person = t
    people.set(u.id, t)
  }
  t.data = Object.assign({}, t.data, u)
  return t
}

// ---------- effects ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1)
const mats = {}
function mat(hex, opacity = 1) { const k = hex + ':' + opacity; return mats[k] || (mats[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity })) }
function addFx(mesh, life, vel, opts = {}) { fxGroup.add(mesh); fx.push(Object.assign({ mesh, t: 0, life, vel }, opts)) }
function burst(at, hex, n = 16, s = 0.06) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(boxGeo, mat(i % 3 ? hex : 0xffffff)); m.scale.setScalar(s); m.position.copy(at)
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3)
    addFx(m, 0.7, v, { spin: true, shrink: true })
  }
}
function blockPile(at) {
  for (let i = 0; i < 30; i++) {
    const s = 0.08 + Math.random() * 0.1
    const m = new THREE.Mesh(boxGeo, mat(PAL[i % PAL.length])); m.scale.setScalar(s)
    m.position.set(at.x + (Math.random() - 0.5) * 0.35, 0.2 + Math.random() * 1.6, at.z + (Math.random() - 0.5) * 0.35)
    addFx(m, 8, new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2), { gravity: true, floor: s / 2, spin: true })
  }
}
function bolt(from, dir, hex = 0x39d5ff) {
  const g = new THREE.Group()
  const core = new THREE.Mesh(boxGeo, mat(0xffffff)); core.scale.set(0.02, 0.02, 0.6)
  const glow = new THREE.Mesh(boxGeo, mat(hex, 0.75)); glow.scale.set(0.055, 0.055, 0.75)
  g.add(core, glow); g.position.copy(from); g.lookAt(from.clone().add(dir))
  addFx(g, 0.8, dir.clone().multiplyScalar(32))
}
function flashRed() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.45, side: THREE.BackSide, depthTest: false }))
  m.position.copy(viewPos()); addFx(m, 0.5, null, { fade: true })
}
function tickFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt
    if (f.vel) { if (f.gravity) f.vel.y -= 9.8 * dt; f.mesh.position.addScaledVector(f.vel, dt); if (f.floor != null && f.mesh.position.y < f.floor) { f.mesh.position.y = f.floor; f.vel.multiplyScalar(0.4); f.vel.y = Math.abs(f.vel.y) * 0.3 } }
    if (f.spin) { f.mesh.rotation.x += dt * 3; f.mesh.rotation.y += dt * 4 }
    if (f.shrink) f.mesh.scale.multiplyScalar(Math.max(0.2, 1 - dt * 1.5))
    if (f.fade) f.mesh.material.opacity = 0.45 * (1 - f.t / f.life)
    if (f.t >= f.life) { fxGroup.remove(f.mesh); fx.splice(i, 1) }
  }
}

// ---------- giant title logo (same as the Specs Lenses) ----------
const FONT5 = { X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'], R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'], Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '], i: ['##', '  ', '##', '##', '##', '##', '##'], ' ': ['  ', '  ', '  ', '  ', '  ', '  ', '  '] }
let logo = null
function buildLogo() {
  if (logo) scene.remove(logo)
  logo = new THREE.Group()
  const words = [['iYiYi', 0.5, 3.0, [0xff4fa3, 0x39d5ff, 0xffb21e, 0x39d5ff, 0xff4fa3]], ['XR', 0.17, 1.6, [0xf2f4f7]]]
  for (const [text, px, y0, cols] of words) {
    const glyphs = text.split('').map((ch) => FONT5[ch] || FONT5[' '])
    let total = 0; glyphs.forEach((g, i) => (total += g[0].length + (i ? 1 : 0)))
    let x0 = -total * px / 2
    glyphs.forEach((g, gi) => {
      const col = cols[gi % cols.length]
      for (let r = 0; r < 7; r++) for (let ci = 0; ci < g[r].length; ci++) {
        if (g[r][ci] !== '#') continue
        const m = new THREE.Mesh(boxGeo, mat(col)); m.scale.set(px * 0.92, px * 0.92, px * 0.7)
        m.userData.base = y0 + (6 - r) * px + px / 2; m.userData.drop = 4 + Math.random() * 2; m.userData.delay = (text === 'XR' ? 1 : 0) + gi * 0.15
        m.position.set(x0 + ci * px + px / 2, m.userData.base + m.userData.drop, 0)
        logo.add(m)
      }
      x0 += (g[0].length + 1) * px
    })
  }
  const vp = viewPos(), f = flatForward()
  logo.position.set(vp.x + f.x * 17, 0, vp.z + f.z * 17)
  logo.lookAt(vp.x, 0, vp.z)
  logo.userData.t = 0
  scene.add(logo)
}
function tickLogo(dt) {
  if (!logo) return
  logo.userData.t += dt
  const t = logo.userData.t
  logo.children.forEach((m) => { const k = Math.max(0, Math.min(1, (t - m.userData.delay) / 0.5)); m.position.y = m.userData.base + (1 - k) ** 3 * m.userData.drop })
  if (t > 5) { scene.remove(logo); logo = null }
}

// ======================================================================= view + north
function viewPos() { const v = new THREE.Vector3(); (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(v); return v }
function viewDir() { const q = new THREE.Quaternion(); (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldQuaternion(q); return new THREE.Vector3(0, 0, -1).applyQuaternion(q) }
function flatForward() { const d = viewDir(); d.y = 0; return d.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : d.normalize() }
const yawOf = (d) => (Math.atan2(d.x, -d.z) / D2R + 360) % 360 // clockwise from the scene's -Z
const compassOf = (d) => (yawOf(d) + st.north + 360) % 360 // compass degrees of a scene direction
function dirOfCompass(deg) { const a = (deg - st.north) * D2R; return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)) }
function setNorth(v, src) { st.north = (v + 360) % 360; st.northSrc = src; try { localStorage.setItem('iyx_north', String(st.north)) } catch (e) {} if (homeP.mesh.visible) redraw(homeP) }
// compass, if this browser has one
window.addEventListener('deviceorientationabsolute', (e) => {
  if (typeof e.alpha !== 'number' || st.northSrc === 'manual') return
  const heading = (360 - e.alpha) % 360
  const target = (heading - yawOf(flatForward()) + 360) % 360
  const diff = ((target - st.north + 540) % 360) - 180
  setNorth(st.north + diff * (st.northSrc === 'compass' ? 0.05 : 1), 'compass')
}, true)
// learned from walking: compare the GPS track with how far you moved in the scene
let walkA = null
function learnFromWalk() {
  if (!st.pos || st.pos.acc > 20 || st.northSrc === 'compass' || st.northSrc === 'manual') return
  const here = viewPos()
  if (!walkA) { walkA = { gps: st.pos, xr: here.clone() }; return }
  const moved = Math.hypot(here.x - walkA.xr.x, here.z - walkA.xr.z)
  const gpsM = metersBetween(walkA.gps, st.pos)
  if (moved > 10 && gpsM > 8 && Math.abs(moved - gpsM) < moved * 0.5) {
    const gpsBearing = bearingTo(walkA.gps, st.pos)
    const xrYaw = yawOf(new THREE.Vector3(here.x - walkA.xr.x, 0, here.z - walkA.xr.z).normalize())
    setNorth(gpsBearing - xrYaw, 'walk')
    walkA = { gps: st.pos, xr: here.clone() }
  } else if (moved > 40) walkA = { gps: st.pos, xr: here.clone() }
}
/** scene position of a GPS point (on the floor) */
function placeOf(lat, lng) {
  if (!st.pos) return null
  const d = metersBetween(st.pos, { lat, lng }), b = bearingTo(st.pos, { lat, lng })
  const v = viewPos(), dir = dirOfCompass(b)
  return { p: new THREE.Vector3(v.x + dir.x * d, 0, v.z + dir.z * d), d }
}

// ======================================================================= location + data
function startLocation() {
  if (TEST) { st.pos = { lat: 36.2081, lng: -115.9839, acc: 5 }; return }
  try { st.watch = navigator.geolocation.watchPosition((p) => { st.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }) } catch (e) {}
}
function fakePeople() {
  const base = st.pos, out = []
  const names = ['tux', 'poppy', 'waddles', 'noot', 'icey']
  names.forEach((n, i) => {
    const b = [350, 15, 40, 300, 200][i], d = [9, 22, 36, 14, 60][i]
    const dLat = (d * Math.cos(b * D2R)) / 111320, dLng = (d * Math.sin(b * D2R)) / (111320 * Math.cos(base.lat * D2R))
    out.push({ id: 'f' + i, username: n, latitude: base.lat + dLat, longitude: base.lng + dLng, distance_m: d, bio: 'Pretend person for testing iYiYi XR.', social_links: [{ platform: 'instagram', value: '@' + n }, { platform: 'tiktok', value: n + '_irl' }] })
  })
  return out
}
async function loadAround() {
  if (!st.pos) { st.aroundMsg = 'FINDING YOUR LOCATION…'; return }
  if (TEST) { st.people = fakePeople(); st.aroundMsg = st.people.length + ' NEARBY'; return }
  try {
    const r = await sb.rpc('camera_nearby', { lat: st.pos.lat, lng: st.pos.lng, radius_m: 60 })
    if (r.error) throw r.error
    st.people = (r.data || []).filter((x) => x && typeof x.latitude === 'number')
    st.aroundMsg = st.people.length ? st.people.length + ' NEARBY WHO ALLOW TAGGING' : 'NOBODY FINDABLE NEARBY RIGHT NOW'
  } catch (e) { st.aroundMsg = String((e && e.message) || 'COULD NOT LOOK AROUND').toUpperCase() }
}
async function loadNearby() {
  st.nearbyLoading = true; st.nearbyErr = ''; redraw(listP)
  try {
    if (TEST) st.nearby = fakePeople()
    else {
      if (!st.pos) throw new Error('FINDING YOUR LOCATION…')
      const d = await api('/api/locations/nearby?latitude=' + st.pos.lat + '&longitude=' + st.pos.lng + '&scope=local')
      st.nearby = (Array.isArray(d.users) ? d.users : []).filter(Boolean).sort((a, b) => (distOf(a) ?? 1e9) - (distOf(b) ?? 1e9))
    }
  } catch (e) { st.nearbyErr = String(e.message || e).toUpperCase() }
  st.nearbyLoading = false; redraw(listP)
}
async function openProfile(u) {
  st.profile = Object.assign({}, u); st.profileLoading = true
  setMode('card')
  if (TEST || !u.id) { st.profileLoading = false; redraw(cardP); return }
  try { const r = await api('/api/profiles/' + encodeURIComponent(u.id)); st.profile = Object.assign({}, u, r, { avatar_url: r.avatar_url || r.avatar || r.photo_url || u.avatar_url }) } catch (e) {}
  st.profileLoading = false; redraw(cardP)
}
async function follow() {
  const u = st.profile
  if (!u || !u.id || u.is_following || u.follow_status === 'pending') return
  if (TEST) { u.is_following = true; redraw(cardP); return }
  try { const r = await api('/api/profiles/follow/' + encodeURIComponent(u.id), { method: 'POST' }); u.is_following = !(r && r.status === 'pending'); if (r && r.status === 'pending') u.follow_status = 'pending'; beep('hit'); redraw(cardP) } catch (e) {}
}

// ---------- laser tag link (same topic as the Ray-Ban glasses + Specs) ----------
const tagLive = () => st.tag.hud && Date.now() - st.tag.hudAt < 4000
async function joinTag() {
  if (st.tag.ch || TEST) return
  try {
    const s = (await sb.auth.getSession()).data.session; if (!s) return
    const k = await sb.rpc('glasses_pair_key'); if (k.error) throw k.error
    const ch = sb.channel('glasses:' + s.user.id + ':' + k.data, { config: { broadcast: { self: false, ack: false } } })
    ch.on('broadcast', { event: 'p_hud' }, (m) => { st.tag.hud = m.payload; st.tag.hudAt = Date.now() })
    ch.on('broadcast', { event: 'p_event' }, (m) => onTagEvent(m.payload || {}))
    ch.subscribe((s2) => { if (s2 === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'g_hello', payload: { at: Date.now() } }) })
    st.tag.ch = ch
  } catch (e) {}
}
function send(event, payload) { if (st.tag.ch) st.tag.ch.send({ type: 'broadcast', event, payload }).catch?.(() => {}) }
const markers = new Map() // name -> { group, label }
function markerFor(key, kind) {
  let m = markers.get(key)
  if (!m) {
    const group = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), mat(0xff3d52)); ring.rotation.x = Math.PI / 2
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), mat(0xff3d52)); diamond.position.y = 0.32
    const label = makePanel(560, 120, 0.6); label.mesh.position.y = 0.62
    group.add(ring, diamond, label.mesh); tagsGroup.add(group)
    m = { group, ring, diamond, label, kind, name: key, pos: null }
    markers.set(key, m)
  }
  return m
}
function drawMarkers(h) {
  const seen = {}
  const list = [].concat((h.enemies || []).map((e) => ({ ...e, kind: 'enemy' })), (h.mates || []).map((e) => ({ ...e, kind: 'mate' })))
  for (const e of list) {
    if (typeof e.bearing !== 'number' || e.d == null) continue
    const key = e.kind + ':' + (e.id || e.name)
    seen[key] = true
    const m = markerFor(key, e.kind)
    const v = viewPos(), dir = dirOfCompass(e.bearing), d = Math.max(1, e.d)
    const target = new THREE.Vector3(v.x + dir.x * d, 2.05 + d * 0.01, v.z + dir.z * d)
    m.pos = m.pos ? m.pos.lerp(target, 0.2) : target
    m.group.position.copy(m.pos)
    m.group.scale.setScalar(Math.max(1.3, d / 4.5))
    m.group.lookAt(v.x, m.pos.y, v.z)
    const locked = h.target && e.name && h.target.name === e.name
    const col = e.alive === false ? 0x555a66 : locked ? 0xffb21e : e.kind === 'mate' ? 0x5cf2a0 : 0xff3d52
    m.ring.material = mat(col); m.diamond.material = mat(col); m.diamond.rotation.y += 0.04
    const lk = (locked ? '◎ ' : '') + '@' + (e.name || (e.kind === 'mate' ? 'teammate' : 'enemy')) + '|' + col
    if (m.label.key !== lk) {
      m.label.key = lk
      const c = m.label.ctx; c.clearRect(0, 0, 560, 120); rr(c, 4, 4, 552, 112, 12); c.fillStyle = C.panel; c.fill()
      c.lineWidth = 5; c.strokeStyle = '#' + col.toString(16).padStart(6, '0'); c.stroke()
      textLine(m.label, lk.split('|')[0], 280, 80, 52, '#' + col.toString(16).padStart(6, '0'), 700, FONT_D, 'center'); m.label.tex.needsUpdate = true
    }
    m.group.visible = st.mode === 'tag'
  }
  for (const [k, m] of markers) if (!seen[k]) { tagsGroup.remove(m.group); markers.delete(k) }
}
function onTagEvent(ev) {
  const ahead = viewPos().add(flatForward().multiplyScalar(6)); ahead.y = 1.4
  const tgt = st.tag.hud && st.tag.hud.target && [...markers.values()].find((m) => m.name.endsWith(':' + st.tag.hud.target.name))
  const at = tgt && tgt.pos ? tgt.pos.clone() : ahead
  if (ev.kind === 'hit') { burst(at, 0xffb21e, 14, 0.07); beep('hit') }
  else if (ev.kind === 'kill') { burst(at, 0xff3d52, 24, 0.09); blockPile(new THREE.Vector3(at.x, 0, at.z)); beep('boom') }
  else if (ev.kind === 'got_hit') { flashRed(); beep('ouch'); if (typeof ev.bearing === 'number') { const v = viewPos(), dir = dirOfCompass(ev.bearing); bolt(v.clone().add(dir.clone().multiplyScalar(14)).setY(1.6), dir.clone().negate().add(new THREE.Vector3(0.05, 0, 0)).normalize(), 0xff3d52) } }
  else if (ev.kind === 'boom') { burst(ahead, 0xff7a1a, 30, 0.12); beep('boom') }
  else if (ev.kind === 'died') flashRed()
}
function fakeHud() {
  const t = Date.now() / 1000
  return { phase: 'playing', score: 'RED 3 · BLUE 2', clock: '2:14', hp: 70, max: 100, gun: 'PULSE RIFLE', ammo: '24/30', range: 60,
    enemies: [{ id: 'e1', name: 'tux', bearing: 10 + Math.sin(t / 2) * 8, d: 18, alive: true }, { id: 'e2', name: 'poppy', bearing: 330, d: 28, alive: true }],
    mates: [{ id: 'm1', name: 'noot', bearing: 60, d: 12, alive: true }], target: { name: 'tux', dist: '59 FT' } }
}
let lastFire = 0
function fire(ray) {
  const now = Date.now(); if (now - lastFire < 180) return; lastFire = now
  const dir = ray.dir.clone()
  bolt(ray.origin.clone().add(dir.clone().multiplyScalar(0.25)), dir)
  beep('pew')
  send('g_fire', { deg: Math.round(compassOf(new THREE.Vector3(dir.x, 0, dir.z).normalize()) * 10) / 10, at: now })
  if (TEST && st.tag.hud && st.tag.hud.target) setTimeout(() => onTagEvent({ kind: Math.random() < 0.3 ? 'kill' : 'hit' }), 250)
}

// ======================================================================= modes + input
function placeInFront(mesh, dist = 1.3, dy = -0.1) {
  const v = viewPos(), f = flatForward()
  mesh.position.set(v.x + f.x * dist, v.y + dy, v.z + f.z * dist)
  mesh.lookAt(v.x, v.y + dy, v.z)
}
const TAG_MODES = ['around', 'tag', 'game'] // name tags over iYiYi people show in these, even mid-game
function setMode(m) {
  if (m !== 'game' && m !== 'pick' && m !== 'card' && m !== 'socials' && game) stopGame()
  st.mode = m
  gamesP.mesh.visible = m === 'games'
  pickP.mesh.visible = m === 'pick'
  if (m === 'games') { placeInFront(gamesP.mesh); redraw(gamesP) }
  if (m === 'pick') { placeInFront(pickP.mesh, 1.3, -0.05); redraw(pickP) }
  homeP.mesh.visible = m === 'home'
  listP.mesh.visible = m === 'nearby'
  cardP.mesh.visible = m === 'card' || m === 'socials'
  barP.mesh.visible = m === 'around' || m === 'tag' || m === 'game'
  hudP.mesh.visible = m === 'tag'
  people.forEach((t) => { t.panel.mesh.visible = t.line.visible = TAG_MODES.includes(m) })
  markers.forEach((mk) => (mk.group.visible = m === 'tag'))
  if (m === 'home') { placeInFront(homeP.mesh); redraw(homeP) }
  if (m === 'nearby') { placeInFront(listP.mesh, 1.35, -0.05); loadNearby() }
  if (m === 'card' || m === 'socials') { placeInFront(cardP.mesh, 1.2, -0.05); redraw(cardP) }
  if (m === 'around' || m === 'tag' || m === 'game') { placeInFront(barP.mesh, 1.2, -0.55); redraw(barP) }
  if (m === 'tag' || m === 'game') loadAround()
  if (m === 'around') loadAround()
  if (m === 'tag') joinTag()
}
const ACT = {
  around: () => setMode('around'), nearby: () => setMode('nearby'), tag: () => setMode('tag'), home: () => setMode('home'),
  northL: () => setNorth(st.north - 10, 'manual'), northR: () => setNorth(st.north + 10, 'manual'),
  range: (b) => { st.range = b.data; redraw(listP) }, open: (b) => openProfile(b.data),
  socials: () => { st.mode = 'socials'; redraw(cardP) }, card: () => { st.mode = 'card'; redraw(cardP) },
  closecard: () => setMode(st.backTo || 'home'), follow, noop: () => {},
  games: () => setMode('games'), play: (b) => startGame(b.data),
  pickit: (b) => { const pk = st.pick; st.pick = null; setMode('game'); if (pk && pk.cb) pk.cb(b.data) },
}

// ======================================================================= games (./games/*.js)
// A game module: export default { title, start(ctx), stop(), tick(dt, now), select(ray), release(ray) }.
let game = null
const gameGroup = new THREE.Group(); scene.add(gameGroup)
async function startGame(id) {
  if (game) stopGame()
  st.gameTitle = id; st.gameLine = 'LOADING…'; st.gameLine2 = ''
  setMode('game')
  try {
    const mod = await import('./games/' + id + '.js')
    game = mod.default
    st.gameTitle = 'iYiYi · ' + game.title
    game.start(ctx)
  } catch (e) { st.gameLine = 'COULD NOT LOAD: ' + (e.message || e); redraw(barP) }
}
function stopGame() {
  try { if (game && game.stop) game.stop() } catch (e) {}
  game = null
  while (gameGroup.children.length) gameGroup.remove(gameGroup.children[0])
  st.pick = null
}
const hand = { pos: null, prev: null, vel: new THREE.Vector3(), tracked: false }
function updateHand(dt) {
  let c = controllers.find((x) => x.userData.mode === 'tracked-pointer' && x.userData.hand === 'right') || controllers.find((x) => x.userData.mode === 'tracked-pointer')
  hand.tracked = !!c
  if (!c) { hand.pos = null; hand.prev = null; hand.vel.set(0, 0, 0); return }
  const p = new THREE.Vector3(); c.getWorldPosition(p)
  if (hand.prev && dt > 0) hand.vel.lerp(p.clone().sub(hand.prev).divideScalar(dt), 0.5)
  hand.prev = p.clone(); hand.pos = p
}
const ctx = {
  THREE, scene, group: gameGroup, C, PAL, FONT_D, FONT_U, D2R, TEST,
  viewPos, viewDir, flatForward, hand, beep, burst, blockPile, mat, boxGeo, makePanel, panelBg, button, textLine, rr, redraw,
  get holding() { return st.holding },
  get preview() { return st.preview },
  right(d) { return new THREE.Vector3(-d.z, 0, d.x) },
  /** a point on the floor `m` meters from `from`, `deg` degrees to the right of `dir` */
  floorAt(from, dir, deg, m) { const v = new THREE.Vector3(dir.x, 0, dir.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -deg * D2R); return new THREE.Vector3(from.x + v.x * m, 0, from.z + v.z * m) },
  box(pos, size, color, parent) { const m = new THREE.Mesh(boxGeo, mat(color)); m.position.copy(pos); m.scale.set(size.x, size.y, size.z); (parent || gameGroup).add(m); return m },
  part(parent, x, y, z, sx, sy, sz, color) { const m = new THREE.Mesh(boxGeo, mat(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m },
  /** floating text card that always faces you */
  label(text, color = C.text, widthM = 0.6, wPx = 640, hPx = 140) {
    const p = makePanel(wPx, hPx, widthM); p.mesh.material.depthTest = true; p.mesh.renderOrder = 5
    p.set = (t, col = color, bg = true) => { if (p.key === t + col) return; p.key = t + col; const c = p.ctx; c.clearRect(0, 0, p.w, p.h); if (t && bg) { rr(c, 4, 4, p.w - 8, p.h - 8, 12); c.fillStyle = C.panel; c.fill() } if (t) textLine(p, t, p.w / 2, p.h / 2 + p.h * 0.17, Math.round(p.h * 0.48), col, 700, FONT_U, 'center'); p.tex.needsUpdate = true }
    p.set(text); p.mesh.userData.billboard = true; return p
  },
  face(obj) { const v = viewPos(); const w = new THREE.Vector3(); obj.getWorldPosition(w); obj.lookAt(v.x, w.y, v.z) },
  line(a, b) { if (st.gameLine !== a || st.gameLine2 !== (b || '')) { st.gameLine = a; st.gameLine2 = b || ''; redraw(barP) } },
  toast(t, ms = 2500) { st.toast = t; st.toastUntil = Date.now() + ms; redraw(barP); setTimeout(() => redraw(barP), ms + 50) },
  choose(title, items, cb) { st.pick = { title, items, cb }; setMode('pick') },
  menu() { setMode('home') },
  angle(p) { return Math.acos(Math.max(-1, Math.min(1, p.clone().sub(viewPos()).normalize().dot(viewDir())))) },
  rayHit(ray, objects) { raycaster.set(ray.origin, ray.dir); const h = raycaster.intersectObjects(objects, true); return h.length ? h[0] : null },
  rayFloor(ray, y = 0) { if (ray.dir.y > -1e-4) return null; const t = (y - ray.origin.y) / ray.dir.y; return ray.origin.clone().addScaledVector(ray.dir, t) },
  bolt: (from, dir, hex) => bolt(from, dir, hex),
}
const raycaster = new THREE.Raycaster()
function hitTest(ray) {
  raycaster.set(ray.origin, ray.dir)
  const targets = []
  for (const p of UIP) if (p.mesh.visible) targets.push(p.mesh)
  if (TAG_MODES.includes(st.mode)) people.forEach((t) => targets.push(t.panel.mesh))
  const hits = raycaster.intersectObjects(targets, false)
  if (!hits.length) return null
  const h = hits[0], p = h.object.userData.panel
  if (h.object.userData.person) return { person: h.object.userData.person }
  const px = h.uv.x * p.w, py = (1 - h.uv.y) * p.h
  const i = p.buttons.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)
  return { panel: p, index: i }
}
let hoverTag = null
function onSelect(ray) {
  const h = hitTest(ray)
  if (h && h.person) { beep('tap'); st.backTo = st.mode; openProfile(h.person.data); return }
  if (h && h.panel) { const b = h.panel.buttons[h.index]; if (b) { beep('tap'); st.backTo = st.mode === 'socials' ? st.backTo : st.mode === 'card' ? st.backTo : st.mode; ACT[b.action] && ACT[b.action](b) } return }
  if (st.mode === 'tag') fire(ray)
  if (st.mode === 'game' && game && game.select) game.select(ray)
}
function onRelease(ray) { if (st.mode === 'game' && game && game.release) game.release(ray) }
function updateHover(ray) {
  const h = hitTest(ray)
  const newTag = h && h.person ? h.person : null
  if (newTag !== hoverTag) { const old = hoverTag; hoverTag = newTag; if (old) redraw(old.panel); if (newTag) redraw(newTag.panel) }
  for (const p of UIP) {
    const idx = h && h.panel === p ? h.index : -1
    if (p.hover !== idx) { p.hover = idx; if (p.mesh.visible) redraw(p) }
  }
}
// pointing: XR controllers / hands (pinch = select). Gaze from your head when nothing else.
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i)
  c.addEventListener('select', () => onSelect(rayFrom(c)))
  c.addEventListener('selectstart', () => { st.holding = true })
  c.addEventListener('selectend', () => { st.holding = false; onRelease(rayFrom(c)) })
  c.addEventListener('connected', (e) => { c.userData.mode = e.data && e.data.targetRayMode; c.userData.hand = e.data && e.data.handedness })
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 1), mat(0x39d5ff, 0.6)); line.position.z = -0.5; c.add(line); c.userData.line = line
  scene.add(c)
  return c
})
function rayFrom(c) {
  const origin = new THREE.Vector3(), q = new THREE.Quaternion()
  c.getWorldPosition(origin); c.getWorldQuaternion(q)
  if (origin.lengthSq() < 1e-6 && !c.userData.mode) return headRay()
  return { origin, dir: new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize() }
}
function headRay() { return { origin: viewPos(), dir: viewDir() } }
function activeRay() {
  for (const c of controllers) if (c.userData.mode === 'tracked-pointer') return rayFrom(c)
  return headRay()
}

// ======================================================================= frame loop
let lastAround = 0, lastAim = 0
const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()), now = Date.now()
  if (!st.xr && !st.preview) return
  if (st.preview) applyPreviewLook()
  tickLogo(dt); tickFx(dt)
  learnFromWalk()
  // who's around: name tags over heads
  if (TAG_MODES.includes(st.mode)) {
    if (now - lastAround > 4000) { lastAround = now; loadAround().then(() => st.mode === 'around' && redraw(barP)) }
    const v = viewPos(), seen = {}
    for (const u of st.people) {
      const pl = placeOf(u.latitude, u.longitude); if (!pl) continue
      const t = tagFor(u); seen[u.id] = true
      const d = Math.max(1.5, pl.d)
      const target = new THREE.Vector3(pl.p.x, 2.1 + d * 0.012, pl.p.z)
      t.pos = t.pos ? t.pos.lerp(target, 0.12) : target
      const s = Math.max(1, d / 3.5)
      t.panel.mesh.position.copy(t.pos); t.panel.mesh.scale.setScalar(s); t.panel.mesh.lookAt(v.x, t.pos.y, v.z)
      t.line.position.set(t.pos.x, t.pos.y - 0.12 * s - 0.15, t.pos.z); t.line.scale.set(s, 0.3, s)
      if (t.dist == null || Math.abs(t.dist - pl.d) > 1) { t.dist = pl.d; redraw(t.panel) }
      t.panel.mesh.visible = t.line.visible = true
    }
    for (const [id, t] of people) if (!seen[id]) { tagsGroup.remove(t.panel.mesh); tagsGroup.remove(t.line); people.delete(id) }
  }
  // laser tag
  if (TEST && st.mode === 'tag') { st.tag.hud = fakeHud(); st.tag.hudAt = now }
  if (st.mode === 'tag') {
    if (st.tag.hud) drawMarkers(st.tag.hud)
    // the HUD floats low in your view
    const v = viewPos(), f = viewDir()
    hudP.mesh.position.copy(v).addScaledVector(f, 1.1).add(new THREE.Vector3(0, -0.28, 0))
    hudP.mesh.lookAt(v)
    if (now - (hudP.lastDraw || 0) > 150) { hudP.lastDraw = now; redraw(hudP) }
    if (now - (barP.lastDraw || 0) > 1000) { barP.lastDraw = now; redraw(barP) }
    if (now - lastAim > 100) { lastAim = now; send('g_aim', { deg: Math.round(compassOf(flatForward()) * 10) / 10, at: now }) }
  }
  // games
  updateHand(dt)
  if (game && (st.mode === 'game' || st.mode === 'pick')) { try { game.tick(dt, now) } catch (e) { console.error(e) } }
  gameGroup.traverse((o) => { if (o.userData.billboard) { const v = viewPos(), w = new THREE.Vector3(); o.getWorldPosition(w); o.lookAt(v.x, w.y, v.z) } })
  if (st.mode === 'game' && now - (barP.lastDraw || 0) > 500) { barP.lastDraw = now; redraw(barP) }
  // pointer hover + ray lines
  updateHover(activeRay())
  controllers.forEach((c) => (c.userData.line.visible = c.userData.mode === 'tracked-pointer'))
  // keep the open panel within reach if you turn away
  for (const p of [homeP, listP, cardP, gamesP, pickP]) if (p.mesh.visible) {
    const to = p.mesh.position.clone().sub(viewPos()); to.y = 0
    if (to.length() > 3 || to.normalize().dot(flatForward()) < Math.cos(55 * D2R)) placeInFront(p.mesh, p === homeP ? 1.3 : 1.25, -0.08)
  }
  renderer.render(scene, camera)
})

// ======================================================================= enter / leave
async function enterXR() {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hand-tracking', 'bounded-floor'] })
    beep('tap')
    renderer.setClearColor(0x000000, 0)
    previewFloor.visible = false
    await renderer.xr.setSession(session)
    st.xr = true
    flat.style.display = 'none'; renderer.domElement.style.display = 'block'
    startLocation()
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission() } catch (e) {}
    setTimeout(() => { buildLogo(); setTimeout(() => { if (st.xr) setMode('home') }, 4200) }, 300)
    session.addEventListener('end', () => { st.xr = false; renderer.domElement.style.display = 'none'; startScreen() })
  } catch (e) {
    showFlat(logoHtml() + '<p>Couldn\'t start 3D mode: ' + esc(e.message || e) + '</p><button id="back">Back</button>')
    document.getElementById('back').onclick = startScreen
  }
}
// preview on a normal screen: drag to look, click = pinch where you point
let yaw = 0, pitch = 0, drag = null, moved = 0
function applyPreviewLook() { camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')) }
function enterPreview() {
  st.preview = true
  flat.style.display = 'none'; renderer.domElement.style.display = 'block'
  document.getElementById('previewbar').style.display = 'block'
  renderer.setClearColor(0x07090c, 1); previewFloor.visible = true
  startLocation()
  if (st.northSrc === 'none') setNorth(0, 'saved')
  buildLogo(); setTimeout(() => { if (st.preview) setMode('home') }, 4200)
}
document.getElementById('exitpv').onclick = (e) => { e.preventDefault(); st.preview = false; renderer.domElement.style.display = 'none'; document.getElementById('previewbar').style.display = 'none'; startScreen() }
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; st.holding = true })
window.addEventListener('pointermove', (e) => {
  if (!drag || !st.preview) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy)
  yaw -= dx * 0.005; pitch = Math.max(-1.3, Math.min(1.3, pitch - dy * 0.005)); drag = { x: e.clientX, y: e.clientY }
})
window.addEventListener('pointerup', (e) => {
  if (drag && st.preview && moved < 6) {
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    onSelect({ origin: raycaster.ray.origin.clone(), dir: raycaster.ray.direction.clone() })
  }
  if (drag && st.preview) { st.holding = false; const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); onRelease({ origin: raycaster.ray.origin.clone(), dir: raycaster.ray.direction.clone() }) }
  drag = null
})
window.addEventListener('keydown', (e) => { if (!st.preview) return; const f = flatForward(), r = new THREE.Vector3(-f.z, 0, f.x); const k = e.key.toLowerCase(); if (k === 'w') camera.position.addScaledVector(f, 0.5); if (k === 's') camera.position.addScaledVector(f, -0.5); if (k === 'a') camera.position.addScaledVector(r, -0.5); if (k === 'd') camera.position.addScaledVector(r, 0.5) })
if (TEST) window.__iyx = { st, setMode, onTagEvent, people, markers, camera, startGame, ctx, get game() { return game }, look: (y, p) => { yaw = y; pitch = p || 0 }, select: () => onSelect(headRay()), pick: (i) => { const pk = st.pick; if (pk) ACT.pickit({ data: pk.items[i][1] }) } }

sb.auth.onAuthStateChange((ev, s) => { if (!TEST) st.user = s ? s.user : null })
startScreen()
