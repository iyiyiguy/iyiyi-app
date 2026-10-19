// iYiYi on Meta Ray-Ban Display (Meta's Web Apps for display glasses).
// - Link: the glasses show a code, you type it in the iYiYi app on your phone, done (migration 084
//   + edge function glasses-link give the glasses their own session; no password in the lens).
// - Nearby: iYiYi members near you (the phone's location), open a profile, follow.
// - Laser tag: while you're in a match on your phone, the glasses are your sights. Turn your head
//   to aim (glasses compass), pinch to fire. The phone runs the game and sends the HUD back over
//   the realtime topic glasses:<user id>:<pair key>.
// Input: Neural Band / temple swipes arrive as Arrow keys + Enter; Back is handled by the shell
// (history.back). No camera/microphone here.
;(function () {
  'use strict'
  var SUPABASE_URL = 'https://sqsjwcsrgcgcpxccxedp.supabase.co'
  var ANON = 'sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x'
  var API = SUPABASE_URL + '/functions/v1'
  var LABELS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', twitter: 'X', snapchat: 'Snapchat', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', spotify: 'Spotify', soundcloud: 'SoundCloud', youtube: 'YouTube', discord: 'Discord', twitch: 'Twitch', telegram: 'Telegram' }

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('iyg_' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
    set: function (k, v) { try { localStorage.setItem('iyg_' + k, JSON.stringify(v)) } catch (e) {} },
  }
  var sb = window.supabase.createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'iyg_auth' },
  })

  var app = document.getElementById('app')
  var fx = document.getElementById('fx')
  var state = { screen: 'start', user: null, heading: null, headingAt: 0, sensors: false, pos: null }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function el(html) { app.innerHTML = html; focusFirst() }
  function focusables() { return Array.prototype.slice.call(app.querySelectorAll('button.f:not([disabled])')) }
  function focusFirst(id) {
    var list = focusables()
    var t = (id && document.getElementById(id)) || list[0]
    if (t) t.focus()
  }
  function toast(text, ms) {
    var t = document.createElement('div')
    t.className = 'toast'
    t.textContent = text
    document.body.appendChild(t)
    setTimeout(function () { t.remove() }, ms || 2200)
  }
  function fmtDist(u) {
    if (u.distance_label) return u.distance_label
    var m = u.distance_m != null ? +u.distance_m : u.distance != null ? +u.distance : u.distance_ft != null ? u.distance_ft / 3.28084 : null
    if (m == null || !isFinite(m)) return ''
    var ft = m * 3.28084
    return ft < 1000 ? '~' + Math.max(5, Math.round(ft / 5) * 5) + ' ft' : '~' + (ft / 5280).toFixed(1) + ' mi'
  }
  function handleOf(platform, v) {
    v = String(v || '').trim()
    var m = v.match(/^https?:\/\/[^/]+\/(.+)$/)
    if (m) v = m[1].split(/[/?#]/).filter(Boolean).pop() || v
    return v.replace(/^@/, '')
  }
  function avatarHtml(u, cls) {
    var name = (u && u.username) || '?'
    if (u && u.avatar_url) return '<img class="avatar ' + (cls || '') + '" src="' + esc(u.avatar_url) + '" alt="">'
    return '<div class="avatar initial ' + (cls || '') + '">' + esc(name.slice(0, 1).toUpperCase()) + '</div>'
  }
  async function token() {
    var r = await sb.auth.getSession()
    var s = r && r.data && r.data.session
    if (!s) throw new Error('Signed out')
    return s.access_token
  }
  async function api(path, opts) {
    opts = opts || {}
    var res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    var data = await res.json().catch(function () { return {} })
    if (!res.ok) throw new Error(data.error || 'Something went wrong')
    return data
  }
  function where() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('No location'))
      navigator.geolocation.getCurrentPosition(function (p) {
        state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }
        resolve(state.pos)
      }, function (e) { reject(new Error(e.code === 1 ? 'Location is off for iYiYi' : 'Location unavailable (is your phone nearby?)')) }, { timeout: 15000, maximumAge: 20000 })
    })
  }

  // ---------- heading (head aim) ----------
  function onOrient(e) {
    var deg = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : e.alpha
    if (typeof deg !== 'number' || !isFinite(deg)) return
    if (store.get('flip', false)) deg = 360 - deg
    state.heading = ((deg % 360) + 360) % 360
    state.headingAt = Date.now()
  }
  function startSensors() {
    if (state.sensors) return
    state.sensors = true
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient)
    else window.addEventListener('deviceorientation', onOrient)
  }
  async function askSensors() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        var s = await DeviceOrientationEvent.requestPermission()
        if (s === 'granted') startSensors()
      } else startSensors()
    } catch (e) { /* the wearer said no: everything but head aim still works */ }
  }

  // ---------- sound (glasses speakers) ----------
  var actx = null
  function beep(kind) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)()
      var t = actx.currentTime
      var o = actx.createOscillator()
      var g = actx.createGain()
      o.connect(g); g.connect(actx.destination)
      if (kind === 'pew') { o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.16); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18) }
      else if (kind === 'hit') { o.type = 'triangle'; o.frequency.setValueAtTime(900, t); o.frequency.setValueAtTime(1300, t + 0.06); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2) }
      else if (kind === 'ouch') { o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.35); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4) }
      else { o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.7); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8) }
      o.start(t); o.stop(t + 0.85)
    } catch (e) {}
  }
  function say(text) { try { if (window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)) } } catch (e) {} }
  function addFx(cls, style, ms) {
    var d = document.createElement('div')
    d.className = cls
    if (style) for (var k in style) d.style.setProperty(k, style[k])
    fx.appendChild(d)
    setTimeout(function () { d.remove() }, ms || 900)
  }

  // ---------- navigation ----------
  // history entries: home is the root; nearby / profile / tag / settings push (max 5 entries).
  function go(screen, data, replace) {
    var st = { screen: screen, data: data || null }
    if (replace) history.replaceState(st, '')
    else history.pushState(st, '')
    render(st)
  }
  window.addEventListener('popstate', function (e) { render(e.state || { screen: 'home' }) })

  function render(st) {
    leaveTag()
    leaveFront()
    state.screen = st.screen
    var fn = SCREENS[st.screen] || SCREENS.home
    fn(st.data)
  }

  // Arrow keys move focus between the big buttons (Enter clicks the focused one natively).
  document.addEventListener('keydown', function (e) {
    if (state.screen === 'tag') {
      if (e.key === 'Enter') { e.preventDefault(); fire(); return }
      return
    }
    if (state.screen === 'front') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); frontStep(e.key === 'ArrowRight' ? 1 : -1); return }
      if (e.key === 'Enter') { e.preventDefault(); frontOpen(); return }
      return
    }
    if (state.screen === 'nearby' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); nearbyPage(e.key === 'ArrowRight' ? 1 : -1); return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    var list = focusables()
    if (!list.length) return
    e.preventDefault()
    var i = list.indexOf(document.activeElement)
    var back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
    var next = i < 0 ? 0 : back ? (i - 1 + list.length) % list.length : (i + 1) % list.length
    list[next].focus()
  })
  app.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-go]')
    if (!b) return
    var a = b.getAttribute('data-go')
    if (ACTIONS[a]) ACTIONS[a](b)
  })

  // ---------- screens ----------
  var SCREENS = {}
  var ACTIONS = {}

  SCREENS.start = function () {
    el('<h1>i<span class="y">Y</span>i<span class="y">Y</span>i</h1>' +
      '<p class="sub">See who\'s around you, open their profile and play laser tag with your head as the aim.</p>' +
      '<div class="grow"></div>' +
      '<button class="f primary" data-go="begin"><span class="ic">▶</span>Start</button>' +
      '<p class="sub">You\'ll be asked for motion and location access. Location comes from your phone.</p>')
  }
  ACTIONS.begin = async function () {
    // Sensor permission must come from this gesture and resolve before any history change.
    await askSensors()
    where().catch(function () {})
    store.set('started', true)
    var s = (await sb.auth.getSession()).data.session
    if (s) { state.user = s.user; go('home', null, true) } else go('link', null, true)
  }

  // Link: show a code until the member enters it in the app.
  var linkPoll = null
  SCREENS.link = function () {
    el('<h2>Link your iYiYi account</h2><div class="code" id="code">······</div>' +
      '<div class="steps">On your phone open <b>iYiYi</b> &rarr; <b>Settings</b> &rarr; <b>Meta glasses</b> and type this code.</div>' +
      '<div class="grow"></div><p class="sub" id="lstatus">Making a code…</p>' +
      '<button class="f" data-go="newcode"><span class="ic">↻</span>New code</button>')
    startLink()
  }
  ACTIONS.newcode = function () { startLink() }
  function randHex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2) }).join('') }
  async function sha256(s) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
  }
  async function startLink() {
    clearTimeout(linkPoll)
    var status = document.getElementById('lstatus')
    try {
      var secret = randHex(32)
      var r = await sb.rpc('glasses_link_start', { p_secret_hash: await sha256(secret) })
      if (r.error) throw r.error
      var code = r.data
      var started = Date.now()
      if (state.screen !== 'link') return
      document.getElementById('code').textContent = code
      status.textContent = 'Waiting for your phone…'
      var poll = async function () {
        if (state.screen !== 'link') return
        if (Date.now() - started > 9.5 * 60 * 1000) { startLink(); return }
        try {
          var res = await fetch(API + '/glasses-link', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ code: code, secret: secret }) })
          var d = await res.json().catch(function () { return {} })
          if (res.status === 200 && d.token_hash) {
            status.textContent = 'Signing in…'
            var v = await sb.auth.verifyOtp({ token_hash: d.token_hash, type: 'magiclink' })
            if (v.error) throw v.error
            state.user = v.data.user
            beep('hit')
            go('home', null, true)
            toast('Linked as @' + (await myName()))
            return
          }
          if (res.status === 410) { startLink(); return }
          if (res.status !== 202) status.textContent = d.error || 'Trying again…'
        } catch (e) { status.textContent = (e && e.message) || 'Trying again…' }
        linkPoll = setTimeout(poll, 2500)
      }
      linkPoll = setTimeout(poll, 2500)
    } catch (e) {
      if (status) status.textContent = (e && e.message) || 'Could not make a code'
      linkPoll = setTimeout(startLink, 6000)
    }
  }
  var nameCache = null
  async function myName() {
    if (nameCache) return nameCache
    try { var me = await api('/api/profiles/me'); nameCache = me.username || me.display_name || 'you' } catch (e) { nameCache = 'you' }
    return nameCache
  }

  SCREENS.home = function () {
    el('<div class="row"><h1>i<span class="y">Y</span>i<span class="y">Y</span>i</h1><div class="grow"></div><span class="sub" id="me"></span></div>' +
      '<div class="grow"></div>' +
      '<button class="f primary" data-go="front"><span class="ic">👁</span>Who\'s in front of me</button>' +
      '<button class="f" data-go="nearby"><span class="ic">◎</span>People nearby</button>' +
      '<button class="f" data-go="tag"><span class="ic">✛</span>Laser tag sights</button>' +
      '<button class="f" data-go="settings"><span class="ic">⚙</span>Settings</button>')
    myName().then(function (n) { var m = document.getElementById('me'); if (m) m.textContent = '@' + n })
  }
  ACTIONS.nearby = function () { go('nearby') }
  ACTIONS.front = function () { go('front') }
  ACTIONS.tag = function () { go('tag') }
  ACTIONS.settings = function () { go('settings') }

  // Nearby: 4 people per page; left / right flips pages.
  var near = { list: [], page: 0 }
  SCREENS.nearby = function () {
    el('<h2>People nearby</h2><div id="nlist"><p class="empty">Looking around…</p></div>')
    loadNearby()
  }
  async function loadNearby() {
    try {
      var p = state.pos || (await where())
      var d = await api('/api/locations/nearby?latitude=' + p.lat + '&longitude=' + p.lng + '&scope=local')
      near.list = (Array.isArray(d.users) ? d.users : []).filter(Boolean)
      near.page = 0
      drawNearby()
      where().catch(function () {}) // keep the next lookup fresh
    } catch (e) {
      var n = document.getElementById('nlist')
      if (n) n.innerHTML = '<p class="empty">' + esc(e.message) + '</p><button class="f" data-go="renear"><span class="ic">↻</span>Try again</button>'
      focusFirst()
    }
  }
  ACTIONS.renear = function () { loadNearby() }
  function drawNearby(focusIdx) {
    var n = document.getElementById('nlist')
    if (!n || state.screen !== 'nearby') return
    if (!near.list.length) {
      n.innerHTML = '<p class="empty">Nobody on iYiYi near you right now.</p><button class="f" data-go="renear"><span class="ic">↻</span>Look again</button>'
      focusFirst(); return
    }
    var pages = Math.ceil(near.list.length / 4)
    var start = near.page * 4
    var rows = near.list.slice(start, start + 4).map(function (u, i) {
      return '<button class="f" data-go="profile" data-i="' + (start + i) + '">' + avatarHtml(u, 'sm') +
        '<span>@' + esc(u.username || 'member') + '</span><span class="meta">' + esc(fmtDist(u)) + '</span></button>'
    }).join('')
    n.innerHTML = rows + (pages > 1 ? '<div class="pager">◀ ' + (near.page + 1) + ' / ' + pages + ' ▶</div>' : '')
    var list = focusables()
    if (list.length) list[Math.min(focusIdx || 0, list.length - 1)].focus()
  }
  function nearbyPage(dir) {
    var pages = Math.ceil(near.list.length / 4)
    if (pages < 2) return
    near.page = (near.page + dir + pages) % pages
    drawNearby()
  }
  ACTIONS.profile = function (b) {
    var u = near.list[+b.getAttribute('data-i')]
    if (u) go('profile', { id: u.id || u.user_id, preview: u })
  }

  SCREENS.profile = function (data) {
    var u = (data && data.preview) || {}
    drawProfile(u, true)
    if (data && data.id) api('/api/profiles/' + encodeURIComponent(data.id)).then(function (r) {
      if (state.screen === 'profile') drawProfile(Object.assign({ id: data.id }, data.preview || {}, r, { avatar_url: r.avatar_url || r.avatar || r.photo_url || (data.preview && data.preview.avatar_url) }), false)
    }).catch(function (e) { toast(e.message) })
  }
  function socialsOf(u) { return (u.social_links || []).filter(function (l) { return l && l.value && LABELS[l.platform] }) }
  function drawProfile(u, loading) {
    var socials = socialsOf(u)
    var following = !!u.is_following || u.follow_status === 'pending'
    state.profile = u
    el('<div class="row">' + avatarHtml(u) + '<div><div class="name">@' + esc(u.username || '') + '</div>' +
      '<div class="sub">' + esc(fmtDist(u) || (u.account_type === 'business' ? 'Business' : '')) + '</div></div></div>' +
      (u.bio ? '<p class="bio">' + esc(u.bio) + '</p>' : '') +
      (loading && !socials.length ? '<p class="sub">Loading…</p>' : '') +
      '<div class="grow"></div>' +
      (socials.length ? '<button class="f primary" data-go="socials"><span class="ic">✦</span>Socials<span class="meta">' + socials.slice(0, 3).map(function (l) { return esc(LABELS[l.platform]) }).join(' · ') + (socials.length > 3 ? ' +' + (socials.length - 3) : '') + '</span></button>' : (loading ? '' : '<p class="sub">No socials linked yet.</p>')) +
      (u.id ? '<button class="f" data-go="follow" id="fbtn"><span class="ic">' + (following ? '✓' : '+') + '</span>' + (following ? (u.follow_status === 'pending' ? 'Requested' : 'Following on iYiYi') : 'Follow on iYiYi') + '</button>' : ''))
  }
  ACTIONS.socials = function () { if (state.profile) go('socials', { profile: state.profile }) }
  SCREENS.socials = function (data) {
    var u = (data && data.profile) || state.profile || {}
    var list = socialsOf(u).slice(0, 7)
    el('<div class="row">' + avatarHtml(u, 'sm') + '<h2 style="margin:0">@' + esc(u.username || '') + '</h2></div>' +
      '<div style="margin-top:14px">' + list.map(function (l) {
        return '<div class="social big"><span>' + esc(LABELS[l.platform]) + '</span><span class="h">@' + esc(handleOf(l.platform, l.value)) + '</span></div>'
      }).join('') + '</div><div class="grow"></div>' +
      '<p class="sub">Follow them from your phone: their profile in iYiYi has a Follow everywhere button.</p>')
  }
  ACTIONS.follow = async function () {
    var u = state.profile
    if (!u || !u.id || u.is_following || u.follow_status === 'pending') return
    try {
      var r = await api('/api/profiles/follow/' + encodeURIComponent(u.id), { method: 'POST' })
      u.is_following = !(r && r.status === 'pending')
      if (r && r.status === 'pending') u.follow_status = 'pending'
      drawProfile(u, false)
      beep('hit')
      toast(u.follow_status === 'pending' ? 'Request sent' : 'Following @' + u.username)
    } catch (e) { toast(e.message) }
  }

  // ---------- who's in front of me ----------
  // People within ~150 ft who chose to be findable (allow tagging), placed by the direction you
  // face: their name floats over where they are. Left / right picks, pinch opens the profile.
  var front = { people: [], sel: null, selAt: 0, timer: null, watch: null, raf: null, lastDraw: 0, err: '' }
  SCREENS.front = function () {
    el('<div class="hud" id="front"><div class="center-msg">Looking around…<small>Face the people you want to see</small></div></div>')
    if (!state.sensors) askSensors()
    try {
      front.watch = navigator.geolocation.watchPosition(function (p) {
        state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }
      }, function () {}, { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 })
    } catch (e) {}
    loadFront()
    front.timer = setInterval(loadFront, 4000)
    drawFront()
  }
  function leaveFront() {
    clearInterval(front.timer)
    cancelAnimationFrame(front.raf)
    if (front.watch != null) { try { navigator.geolocation.clearWatch(front.watch) } catch (e) {} }
    front.watch = null
  }
  async function loadFront() {
    try {
      var p = state.pos || (await where())
      var r = await sb.rpc('camera_nearby', { lat: p.lat, lng: p.lng, radius_m: 60 })
      if (r.error) throw r.error
      front.people = (r.data || []).filter(function (x) { return x && typeof x.latitude === 'number' })
      front.err = ''
    } catch (e) { front.err = (e && e.message) || 'Could not look around' }
  }
  function bearingTo(a, b) {
    var toR = Math.PI / 180
    var y = Math.sin((b.lng - a.lng) * toR) * Math.cos(b.lat * toR)
    var x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lng - a.lng) * toR)
    return (Math.atan2(y, x) / toR + 360) % 360
  }
  var FOV = 45 // degrees either side shown across the lens
  function frontVisible() {
    if (!state.pos || !headingFresh()) return []
    return front.people.map(function (x) {
      var b = bearingTo(state.pos, { lat: x.latitude, lng: x.longitude })
      return { p: x, rel: rel(b), d: x.distance_m }
    }).filter(function (o) { return Math.abs(o.rel) <= FOV }).sort(function (a, b) { return a.rel - b.rel })
  }
  function frontStep(dir) {
    var vis = frontVisible()
    if (!vis.length) return
    var i = vis.findIndex(function (o) { return o.p.id === front.sel })
    i = i < 0 ? (dir > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + dir))
    front.sel = vis[i].p.id
    front.selAt = Date.now()
    beep('hit')
  }
  function frontOpen() {
    var o = front.people.find(function (x) { return x.id === front.sel })
    if (o) go('profile', { id: o.id, preview: { id: o.id, username: o.username, avatar_url: o.avatar_url, distance_m: o.distance_m } })
  }
  function drawFront() {
    if (state.screen !== 'front') return
    front.raf = requestAnimationFrame(drawFront)
    var now = Date.now()
    if (now - front.lastDraw < 90) return
    front.lastDraw = now
    var root = document.getElementById('front')
    if (!root) return
    if (!headingFresh()) { root.innerHTML = '<div class="center-msg">Turn on motion<small>Allow motion access so the glasses know which way you face</small></div>'; return }
    if (!state.pos) { root.innerHTML = '<div class="center-msg">Finding you…<small>Location comes from your phone</small></div>' + tape(); return }
    var vis = frontVisible()
    // auto-pick whoever is nearest the middle unless you picked someone in the last 4 s
    if (vis.length && (now - front.selAt > 4000 || !vis.some(function (o) { return o.p.id === front.sel }))) {
      var best = vis.reduce(function (a, b) { return Math.abs(b.rel) < Math.abs(a.rel) ? b : a })
      front.sel = best.p.id
    }
    var left = 0, right = 0
    front.people.forEach(function (x) {
      var r = rel(bearingTo(state.pos, { lat: x.latitude, lng: x.longitude }))
      if (r < -FOV) left++; else if (r > FOV) right++
    })
    var used = []
    var tags = vis.map(function (o) {
      var x = Math.max(95, Math.min(505, 300 + (o.rel / FOV) * 250))
      var near = Math.max(0, Math.min(1, 1 - (o.d || 0) / 46))
      var y = 250 - near * 70 // closer people float a little higher and bigger
      used.forEach(function (u) { if (Math.abs(u.x - x) < 150 && Math.abs(u.y - y) < 70) y = u.y + 74 })
      used.push({ x: x, y: y })
      var sel = o.p.id === front.sel
      var ft = Math.max(5, Math.round((o.d || 0) * 3.28084 / 5) * 5)
      return '<div class="tag' + (sel ? ' sel' : '') + '" style="left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;font-size:' + (sel ? 30 : 22 + near * 6).toFixed(0) + 'px">' +
        '<b>@' + esc(o.p.username || 'member') + '</b><small>' + ft + ' ft</small><i></i></div>'
    }).join('')
    var msg = ''
    if (!front.people.length) msg = '<div class="center-msg">Nobody findable nearby<small>' + esc(front.err || 'Only people who allow tagging show up here') + '</small></div>'
    else if (!vis.length) msg = '<div class="center-msg" style="font-size:30px">Turn toward them<small>' + front.people.length + ' nearby, not in front of you</small></div>'
    root.innerHTML = tape() + tags + msg +
      (left ? '<div class="edge l">◀ ' + left + '</div>' : '') + (right ? '<div class="edge r">' + right + ' ▶</div>' : '') +
      '<div class="bottom"><div class="hint"><span>◀ ▶ pick</span><span>' + (vis.length ? 'Pinch to open profile' : '') + '</span></div></div>'
  }

  SCREENS.settings = function () {
    var flip = store.get('flip', false)
    el('<h2>Settings</h2>' +
      '<button class="f" data-go="flip"><span class="ic">🧭</span>Compass direction<span class="meta">' + (flip ? 'Flipped' : 'Normal') + '</span></button>' +
      '<p class="sub">If the laser tag sights turn the wrong way when you turn your head, flip this.</p>' +
      '<div class="grow"></div>' +
      '<button class="f danger" data-go="signout"><span class="ic">⎋</span>Unlink these glasses</button>')
  }
  ACTIONS.flip = function () { store.set('flip', !store.get('flip', false)); SCREENS.settings(); focusFirst() }
  ACTIONS.signout = async function () {
    try { await sb.auth.signOut() } catch (e) {}
    nameCache = null
    state.user = null
    go('link', null, true)
  }

  // ---------- laser tag sights ----------
  var tag = { ch: null, hud: null, hudAt: 0, aimTimer: null, raf: null, feed: [] }
  SCREENS.tag = function () {
    el('<div class="hud" id="hud"><div class="center-msg" id="cmsg">Connecting…<small>Start or join a laser tag match on your phone</small></div></div>' +
      '<button class="f fire" id="firebtn" aria-label="Fire"></button>')
    if (!state.sensors) askSensors()
    joinTag()
  }
  async function joinTag() {
    try {
      var s = (await sb.auth.getSession()).data.session
      if (!s) { go('link', null, true); return }
      var k = await sb.rpc('glasses_pair_key')
      if (k.error) throw k.error
      if (state.screen !== 'tag') return
      var ch = sb.channel('glasses:' + s.user.id + ':' + k.data, { config: { broadcast: { self: false, ack: false } } })
      ch.on('broadcast', { event: 'p_hud' }, function (m) { tag.hud = m.payload; tag.hudAt = Date.now() })
      ch.on('broadcast', { event: 'p_event' }, function (m) { onTagEvent(m.payload || {}) })
      ch.subscribe(function (st) {
        if (st === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'g_hello', payload: { at: Date.now() } })
      })
      tag.ch = ch
      tag.aimTimer = setInterval(sendAim, 100)
      drawHud()
    } catch (e) {
      var c = document.getElementById('cmsg')
      if (c) c.innerHTML = 'Can\'t connect<small>' + esc(e.message || '') + '</small>'
    }
  }
  function leaveTag() {
    clearInterval(tag.aimTimer)
    cancelAnimationFrame(tag.raf)
    if (tag.ch) { try { sb.removeChannel(tag.ch) } catch (e) {} }
    tag.ch = null; tag.hud = null
  }
  function headingFresh() { return state.heading != null && Date.now() - state.headingAt < 2000 }
  function sendAim() {
    if (!tag.ch || !headingFresh()) return
    tag.ch.send({ type: 'broadcast', event: 'g_aim', payload: { deg: Math.round(state.heading * 10) / 10, at: Date.now() } })
  }
  var lastFire = 0
  function fire() {
    var now = Date.now()
    if (now - lastFire < 180) return
    lastFire = now
    if (!tag.ch) return
    if (!headingFresh()) { toast('Turn on motion access to aim'); askSensors(); return }
    tag.ch.send({ type: 'broadcast', event: 'g_fire', payload: { deg: Math.round(state.heading * 10) / 10, at: now } })
    addFx('tracer', null, 260)
    beep('pew')
  }
  function rel(b) { return (((b - state.heading) % 360) + 540) % 360 - 180 } // -180..180, 0 = straight ahead
  function onTagEvent(ev) {
    if (ev.kind === 'hit') { addFx('hitmark', null, 400); addFx('burst', null, 500); beep('hit') }
    else if (ev.kind === 'kill') { addFx('burst', null, 500); addFx('boom', null, 850); beep('boom'); pushFeed(ev.text || 'Eliminated') }
    else if (ev.kind === 'got_hit') {
      addFx('vignette', null, 650); beep('ouch')
      // a near-miss whiz from the shooter's side
      if (typeof ev.bearing === 'number' && headingFresh()) {
        var left = rel(ev.bearing) < 0
        addFx('whiz', { '--from': left ? '-200px' : '640px', '--to': left ? '640px' : '-200px' }, 320)
      }
    } else if (ev.kind === 'boom') { addFx('boom', null, 850); beep('boom') }
    else if (ev.kind === 'died') { addFx('vignette', null, 650); say(ev.text || 'You are out') }
    if (ev.text && ev.kind !== 'kill') pushFeed(ev.text)
  }
  function pushFeed(t) { tag.feed.unshift({ t: t, at: Date.now() }); tag.feed = tag.feed.slice(0, 4) }

  function drawHud() {
    if (state.screen !== 'tag') return
    tag.raf = requestAnimationFrame(drawHud)
    var root = document.getElementById('hud')
    if (!root) return
    var h = tag.hud
    var live = h && Date.now() - tag.hudAt < 4000
    var fb = document.getElementById('firebtn')
    if (fb && document.activeElement !== fb) fb.focus()
    if (!live) {
      root.className = 'hud'
      root.innerHTML = '<div class="center-msg">Waiting for your phone<small>Open a laser tag match in iYiYi. Your glasses become the sights.</small></div>' + tape()
      return
    }
    var hd = headingFresh() ? state.heading : null
    var pips = ''
    ;(h.enemies || []).forEach(function (o) {
      if (hd == null || typeof o.bearing !== 'number') return
      var r = rel(o.bearing) * Math.PI / 180
      var dist = Math.min(1, (o.d || 0) / (h.range || 60))
      var R = 30 + dist * 115
      pips += '<div class="pip ' + (o.alive === false ? 'dead' : '') + '" style="left:' + (300 + Math.sin(r) * R).toFixed(1) + 'px;top:' + (300 - Math.cos(r) * R).toFixed(1) + 'px"></div>'
    })
    ;(h.mates || []).forEach(function (o) {
      if (hd == null || typeof o.bearing !== 'number') return
      var r = rel(o.bearing) * Math.PI / 180
      var R = 30 + Math.min(1, (o.d || 0) / (h.range || 60)) * 115
      pips += '<div class="pip team" style="left:' + (300 + Math.sin(r) * R).toFixed(1) + 'px;top:' + (300 - Math.cos(r) * R).toFixed(1) + 'px"></div>'
    })
    var hpPct = Math.max(0, Math.min(100, Math.round(100 * (h.hp || 0) / (h.max || 100))))
    var t = h.target
    var mid = ''
    if (h.phase === 'countdown') mid = '<div class="center-msg">' + esc(h.countdown || 'Get ready') + '<small>Match starting</small></div>'
    else if (h.phase === 'lobby') mid = '<div class="center-msg">In the lobby<small>' + esc(h.players || 0) + ' players · waiting for the host</small></div>'
    else if (h.phase === 'ended') mid = '<div class="center-msg">Match over<small>' + esc(h.result || '') + '</small></div>'
    else if (h.alive === false) mid = '<div class="center-msg">You\'re out<small>' + esc(h.respawn ? 'Back in ' + h.respawn + 's' : '') + '</small></div>'
    root.className = 'hud' + (t ? ' lock' : '')
    root.innerHTML =
      '<div class="top"><span>' + esc(h.score || '') + '</span><span>' + esc(h.clock || '') + '</span></div>' + tape() +
      '<div class="ring"></div>' + pips + '<div class="cross"></div>' +
      (t && !mid ? '<div class="target">@' + esc(t.name) + '<small>' + esc(t.dist || '') + (t.chance != null ? ' · ' + Math.round(t.chance * 100) + '%' : '') + '</small></div>' : '') +
      mid +
      '<div class="feed">' + tag.feed.filter(function (f) { return Date.now() - f.at < 6000 }).map(function (f) { return '<div>' + esc(f.t) + '</div>' }).join('') + '</div>' +
      '<div class="bottom"><div class="hp ' + (hpPct < 35 ? 'low' : '') + '"><b style="width:' + hpPct + '%"></b></div>' +
      '<div class="hint"><span>' + esc(h.gun || '') + (h.ammo != null ? ' · ' + esc(h.ammo) : '') + '</span><span>' + (hd == null ? 'Turn on motion to aim' : 'Pinch to fire') + '</span></div></div>'
  }
  function tape() {
    if (!headingFresh()) return '<div class="tape"><i></i></div>'
    var out = ''
    var marks = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
    for (var a = 0; a < 360; a += 15) {
      var r = rel(a)
      if (Math.abs(r) > 50) continue
      var x = 150 + r * 3
      out += '<span class="' + (a === 0 ? 'n' : '') + '" style="left:' + x.toFixed(1) + 'px">' + (marks[a] || '·') + '</span>'
    }
    return '<div class="tape">' + out + '<i></i></div>'
  }

  // test hook (only with ?iygtest in the URL): feed a HUD / event without a phone
  if (/iygtest/.test(location.search)) window.__iyg = { hud: function (h) { tag.hud = h; tag.hudAt = Date.now() }, ev: onTagEvent, state: state, front: front }

  // ---------- boot ----------
  // First screen is always Start: sensor permission must come from a pinch, before any
  // history change. History entries are only created after it.
  history.replaceState({ screen: 'start' }, '')
  render({ screen: 'start' })
  sb.auth.onAuthStateChange(function (ev, s) {
    state.user = s ? s.user : null
    if (ev === 'SIGNED_OUT' && state.screen !== 'start' && state.screen !== 'link') go('link', null, true)
  })
})()
