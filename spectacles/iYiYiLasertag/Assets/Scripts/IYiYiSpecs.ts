// iYiYi on Snap Spectacles (Specs). One component does it all; put it on one SceneObject.
//
// - Link: shows a 6-letter code in front of you; type it in the iYiYi app (Settings > Meta
//   glasses / smart glasses). Same flow as the Ray-Ban Display web app: Supabase RPC
//   glasses_link_start + edge function glasses-link + /auth/v1/verify, so the Specs get their own
//   session. Saved in persistent storage.
// - Who's in front of me: iYiYi members within ~150 ft who allow tagging (RPC camera_nearby),
//   their @name floats over where they are (GPS + north-aligned heading). Look at a name and pinch
//   (right hand) to open their card; pinch again for their socials; pinch away to close.
// - Laser tag: while your phone is in a match, the Specs are your sights. Pinch to fire along your
//   head direction. Tracers fly through the room, hits burst, a tagged-out player collapses into a
//   pile of colourful blocks where they stood, shots at you whiz past from the shooter's side.
//   Rides the same realtime topic as the Ray-Ban glasses (glasses:<user>:<pair key>), so the phone
//   runs the game and the HUD comes back.
// - Worlds: pinch with your LEFT hand to change the world: lava floor, underwater, desert, snow,
//   rainforest, space, iY monogram, off.
//
// Inputs: blockMaterial = an Unlit material (cloned per colour). Without it the Lens still links,
// shows names and fires; only the 3D blocks / worlds are skipped.
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"

const SUPABASE_URL = "https://sqsjwcsrgcgcpxccxedp.supabase.co"
const ANON = "sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x"
const WS_URL = "wss://sqsjwcsrgcgcpxccxedp.supabase.co/realtime/v1/websocket?apikey=" + ANON + "&vsn=1.0.0"
const STORE_KEY = "iyiyi_specs_session_v1"
const D2R = Math.PI / 180
const LABELS: {[k: string]: string} = {instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", twitter: "X", snapchat: "Snapchat", linkedin: "LinkedIn", whatsapp: "WhatsApp", spotify: "Spotify", soundcloud: "SoundCloud", youtube: "YouTube", discord: "Discord", twitch: "Twitch", telegram: "Telegram"}

type Session = {access_token: string; refresh_token: string; expires_at: number; user_id: string}
type Person = {id: string; username: string; avatar_url?: string; distance_m: number; latitude: number; longitude: number}
type Fx = {obj: SceneObject; t: number; life: number; vel?: vec3; spin?: vec3; gravity?: boolean; floorY?: number; onDone?: () => void}

const WORLDS = ["off", "lava", "underwater", "desert", "snow", "rainforest", "space", "monogram"]

@component
export class IYiYiSpecs extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Unlit material, used for blocks, tracers and worlds (cloned per colour)")
  blockMaterial: Material

  private internet: InternetModule = require("LensStudio:InternetModule")
  private store = global.persistentStorageSystem.store
  private camT: Transform
  private loc: LocationService
  private heading: number = null
  private headingAt = 0
  private pos: {lat: number; lng: number; acc: number} = null
  private session: Session = null
  private mats: {[c: string]: Material} = {}
  private cube: RenderMesh = null
  private fx: Fx[] = []
  private time = 0

  // ui
  private panel: SceneObject
  private panelText: Text
  private toastText: Text
  private toastUntil = 0

  // link
  private linkCode: string = null
  private linkSecret: string = null
  private linkStarted = 0
  private nextPoll = 0

  // who's in front
  private people: Person[] = []
  private labels: {[id: string]: {obj: SceneObject; text: Text}} = {}
  private nextNearby = 0
  private card: {id: string; page: "card" | "socials"; profile: any} = null

  // laser tag bridge
  private ws: WebSocket = null
  private wsOpen = false
  private topic: string = null
  private ref = 1
  private nextBeat = 0
  private nextAim = 0
  private hud: any = null
  private hudAt = 0
  private lastTargetPos: vec3 = null
  private hudText: Text
  private enemyMarks: SceneObject[] = []

  // worlds
  private world = "off"
  private worldRoot: SceneObject = null
  private worldParts: Fx[] = []
  private floorY = -150

  onAwake() {
    this.camT = this.findCamera()
    this.panel = this.makeText("iYiYi", 4.2, new vec4(1, 1, 1, 1))
    this.panelText = this.panel.getComponent("Component.Text") as Text
    const toast = this.makeText("", 3, new vec4(0.22, 0.84, 1, 1))
    this.toastText = toast.getComponent("Component.Text") as Text
    const hud = this.makeText("", 2.6, new vec4(1, 1, 1, 1))
    this.hudText = hud.getComponent("Component.Text") as Text
    if (this.blockMaterial) this.cube = this.makeCube()

    this.startSensors()
    this.loadSession()
    this.createEvent("UpdateEvent").bind(() => this.update())
    this.wireHands()
    if (this.camT) this.floorY = this.camT.getWorldPosition().y - 150
  }

  // ---------------------------------------------------------------- input
  private wireHands() {
    try {
      const hands = SIK.HandInputData
      const right = hands.getHand("right")
      const left = hands.getHand("left")
      right.onPinchDown.add(() => this.onPrimaryPinch())
      left.onPinchDown.add(() => this.nextWorld())
    } catch (e) {
      print("iYiYi: hand input unavailable " + e)
    }
  }

  private onPrimaryPinch() {
    if (!this.session) return
    if (this.matchLive()) { this.fire(); return }
    // profile card flow
    if (this.card) {
      if (this.card.page === "card" && this.socialsOf(this.card.profile).length) { this.card.page = "socials"; this.drawCard(); return }
      this.card = null
      this.panelText.text = ""
      return
    }
    const pick = this.lookedAtPerson()
    if (pick) this.openCard(pick)
    else this.toast("Look at a name and pinch")
  }

  // ---------------------------------------------------------------- update loop
  private update() {
    const dt = getDeltaTime()
    this.time += dt
    const now = Date.now()
    this.placeHudObjects()

    if (!this.session) {
      this.tickLink(now)
    } else {
      if (now > this.session.expires_at * 1000 - 60000) this.refreshSession()
      this.tickRealtime(now)
      if (now > this.nextNearby && !this.matchLive()) { this.nextNearby = now + 4000; this.loadNearby() }
      this.drawLabels()
      this.drawHud()
    }
    this.tickFx(dt)
    this.tickWorld(dt)
    if (now > this.toastUntil) this.toastText.text = ""
  }

  // ---------------------------------------------------------------- camera + placement helpers
  private findCamera(): Transform {
    const visit = (o: SceneObject): Transform => {
      if (o.getComponent("Component.Camera")) return o.getTransform()
      for (let i = 0; i < o.getChildrenCount(); i++) {
        const r = visit(o.getChild(i))
        if (r) return r
      }
      return null
    }
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const r = visit(global.scene.getRootObject(i))
      if (r) return r
    }
    return null
  }

  private viewDir(): vec3 {
    const d = this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    return d
  }

  private flatDir(): vec3 {
    const d = this.viewDir()
    const f = new vec3(d.x, 0, d.z)
    return f.length < 0.001 ? new vec3(0, 0, -1) : f.normalize()
  }

  /** World position for something `meters` away at compass `bearing` (deg), `up` cm above eye level. */
  private worldAt(bearing: number, meters: number, up: number): vec3 {
    if (!this.camT || this.heading === null) return null
    const rel = ((bearing - this.heading) % 360 + 540) % 360 - 180
    const dir = quat.angleAxis(-rel * D2R, vec3.up()).multiplyVec3(this.flatDir())
    const cam = this.camT.getWorldPosition()
    const p = cam.add(dir.uniformScale(Math.max(1, meters) * 100))
    return new vec3(p.x, cam.y + up, p.z)
  }

  private faceCamera(t: Transform) {
    const cam = this.camT.getWorldPosition()
    const p = t.getWorldPosition()
    const to = cam.sub(p)
    const flat = new vec3(to.x, 0, to.z)
    if (flat.length > 0.001) t.setWorldRotation(quat.lookAt(flat.normalize().uniformScale(-1), vec3.up()))
  }

  private placeHudObjects() {
    if (!this.camT) return
    const cam = this.camT.getWorldPosition()
    const d = this.viewDir()
    const right = this.camT.getWorldRotation().multiplyVec3(new vec3(1, 0, 0))
    const upv = this.camT.getWorldRotation().multiplyVec3(new vec3(0, 1, 0))
    const at = (dist: number, x: number, y: number) => cam.add(d.uniformScale(dist)).add(right.uniformScale(x)).add(upv.uniformScale(y))
    const put = (o: SceneObject, p: vec3) => { const t = o.getTransform(); t.setWorldPosition(p); t.setWorldRotation(this.camT.getWorldRotation()) }
    put(this.panel, at(80, 0, 2))
    put(this.toastText.getSceneObject(), at(80, 0, -14))
    put(this.hudText.getSceneObject(), at(85, 0, -19))
  }

  private makeText(s: string, size: number, color: vec4): SceneObject {
    const o = global.scene.createSceneObject("iyText")
    const t = o.createComponent("Component.Text") as Text
    t.text = s
    t.size = size * 18
    t.textFill.color = color
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.depthTest = false
    return o
  }

  private toast(s: string, ms: number = 2500) {
    this.toastText.text = s
    this.toastUntil = Date.now() + ms
  }

  // ---------------------------------------------------------------- sensors
  private startSensors() {
    try {
      this.loc = GeoLocation.createLocationService()
      this.loc.accuracy = GeoLocationAccuracy.Navigation
      this.loc.onNorthAlignedOrientationUpdate.add((q: quat) => {
        this.heading = (GeoLocation.getNorthAlignedHeading(q) % 360 + 360) % 360
        this.headingAt = Date.now()
      })
      const poll = this.createEvent("DelayedCallbackEvent")
      poll.bind(() => {
        this.loc.getCurrentPosition((g) => {
          this.pos = {lat: g.latitude, lng: g.longitude, acc: g.horizontalAccuracy}
        }, (err) => print("iYiYi: location " + err))
        poll.reset(2)
      })
      poll.reset(0.1)
    } catch (e) {
      print("iYiYi: location unavailable " + e)
    }
  }

  private headingFresh() { return this.heading !== null && Date.now() - this.headingAt < 3000 }

  // ---------------------------------------------------------------- http
  private async req(path: string, method: string, body: any, auth: boolean): Promise<{status: number; data: any}> {
    const headers: any = {"Content-Type": "application/json", apikey: ANON}
    if (auth && this.session) headers.Authorization = "Bearer " + this.session.access_token
    const r = await this.internet.fetch(new Request(SUPABASE_URL + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}))
    let data: any = null
    try { data = await r.json() } catch (e) { data = null }
    return {status: r.status, data}
  }

  // ---------------------------------------------------------------- session / link
  private loadSession() {
    try {
      const s = this.store.getString(STORE_KEY)
      if (s) this.session = JSON.parse(s)
    } catch (e) { this.session = null }
    if (this.session) this.toast("iYiYi linked")
  }
  private saveSession(s: any) {
    this.session = {access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user_id: s.user ? s.user.id : this.session && this.session.user_id}
    this.store.putString(STORE_KEY, JSON.stringify(this.session))
  }
  private refreshing = false
  private async refreshSession() {
    if (this.refreshing || !this.session) return
    this.refreshing = true
    try {
      const r = await this.req("/auth/v1/token?grant_type=refresh_token", "POST", {refresh_token: this.session.refresh_token}, false)
      if (r.status === 200 && r.data && r.data.access_token) this.saveSession(r.data)
      else if (r.status === 400 || r.status === 401) this.unlink()
    } catch (e) {}
    this.refreshing = false
  }
  private unlink() {
    this.session = null
    this.store.putString(STORE_KEY, "")
    this.closeWs()
    this.linkCode = null
  }

  private randHex(n: number) {
    let s = ""
    for (let i = 0; i < n; i++) s += ("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2)
    return s
  }
  private async sha256Hex(s: string): Promise<string> {
    // tiny SHA-256 (no crypto.subtle in Lens scripting)
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
    const bytes: number[] = []
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff) // ascii hex input
    const l = bytes.length * 8
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) bytes.push(0)
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff)
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const w = new Array(64)
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3]
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      let [a, b, c, d, e, f, g, hh] = h
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        const ch = (e & f) ^ (~e & g)
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        const mj = (a & b) ^ (a & c) ^ (b & c)
        const t2 = (S0 + mj) | 0
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
      }
      h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0, (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0]
    }
    return h.map((x) => ("00000000" + (x >>> 0).toString(16)).slice(-8)).join("")
  }

  private linkBusy = false
  private async tickLink(now: number) {
    if (this.linkBusy) return
    if (!this.linkCode || now - this.linkStarted > 9.5 * 60 * 1000) {
      this.linkBusy = true
      try {
        this.linkSecret = this.randHex(32)
        const r = await this.req("/rest/v1/rpc/glasses_link_start", "POST", {p_secret_hash: await this.sha256Hex(this.linkSecret)}, false)
        if (r.status === 200 && typeof r.data === "string") {
          this.linkCode = r.data
          this.linkStarted = Date.now()
          this.nextPoll = Date.now() + 2500
          this.panelText.text = "Link iYiYi\n\n" + this.linkCode.split("").join(" ") + "\n\nOn your phone: iYiYi > Settings >\nMeta glasses, type this code"
        } else this.panelText.text = "Can't reach iYiYi\nCheck the internet connection"
      } catch (e) { this.panelText.text = "Can't reach iYiYi" }
      this.linkBusy = false
      return
    }
    if (now < this.nextPoll) return
    this.linkBusy = true
    this.nextPoll = now + 2500
    try {
      const r = await this.req("/functions/v1/glasses-link", "POST", {code: this.linkCode, secret: this.linkSecret}, false)
      if (r.status === 200 && r.data && r.data.token_hash) {
        const v = await this.req("/auth/v1/verify", "POST", {type: "magiclink", token_hash: r.data.token_hash}, false)
        if (v.status === 200 && v.data && v.data.access_token) {
          this.saveSession(v.data)
          this.panelText.text = ""
          this.toast("Linked! Look around")
        }
      } else if (r.status === 410) this.linkCode = null
    } catch (e) {}
    this.linkBusy = false
  }

  // ---------------------------------------------------------------- who's in front
  private nearbyBusy = false
  private async loadNearby() {
    if (this.nearbyBusy || !this.pos) return
    this.nearbyBusy = true
    try {
      const r = await this.req("/rest/v1/rpc/camera_nearby", "POST", {lat: this.pos.lat, lng: this.pos.lng, radius_m: 60}, true)
      if (r.status === 200 && Array.isArray(r.data)) this.people = r.data.filter((p: any) => p && typeof p.latitude === "number")
      else if (r.status === 401) this.refreshSession()
    } catch (e) {}
    this.nearbyBusy = false
  }

  private bearingTo(lat: number, lng: number) {
    const a = this.pos
    const y = Math.sin((lng - a.lng) * D2R) * Math.cos(lat * D2R)
    const x = Math.cos(a.lat * D2R) * Math.sin(lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(lat * D2R) * Math.cos((lng - a.lng) * D2R)
    return (Math.atan2(y, x) / D2R + 360) % 360
  }

  private drawLabels() {
    const show = !this.matchLive() && this.pos && this.headingFresh() && this.camT
    const seen: {[id: string]: boolean} = {}
    if (show) {
      for (const p of this.people) {
        seen[p.id] = true
        let l = this.labels[p.id]
        if (!l) {
          const o = this.makeText("", 6, new vec4(0.22, 0.84, 1, 1))
          l = {obj: o, text: o.getComponent("Component.Text") as Text}
          this.labels[p.id] = l
        }
        const meters = Math.max(2, p.distance_m)
        const at = this.worldAt(this.bearingTo(p.latitude, p.longitude), meters, 35 + meters * 2)
        if (!at) continue
        const t = l.obj.getTransform()
        t.setWorldPosition(at)
        this.faceCamera(t)
        const sc = Math.max(1, meters / 3)
        t.setWorldScale(new vec3(sc, sc, sc))
        const ft = Math.max(5, Math.round(p.distance_m * 3.28084 / 5) * 5)
        const picked = this.card && this.card.id === p.id
        l.text.text = "@" + (p.username || "member") + "\n" + ft + " ft"
        l.text.textFill.color = picked ? new vec4(1, 0.82, 0.25, 1) : new vec4(0.22, 0.84, 1, 1)
        l.obj.enabled = true
      }
    }
    for (const id in this.labels) if (!seen[id]) this.labels[id].obj.enabled = false
  }

  private lookedAtPerson(): Person {
    if (!this.pos || !this.headingFresh()) return null
    let best: Person = null
    let bestOff = 14
    for (const p of this.people) {
      const rel = Math.abs(((this.bearingTo(p.latitude, p.longitude) - this.heading) % 360 + 540) % 360 - 180)
      if (rel < bestOff) { bestOff = rel; best = p }
    }
    return best
  }

  private socialsOf(u: any): any[] {
    return ((u && u.social_links) || []).filter((l: any) => l && l.value && LABELS[l.platform])
  }
  private handleOf(v: string) {
    v = String(v || "").trim()
    const m = v.match(/^https?:\/\/[^/]+\/(.+)$/)
    if (m) v = m[1].split(/[/?#]/).filter(Boolean).pop() || v
    return v.replace(/^@/, "")
  }

  private async openCard(p: Person) {
    this.card = {id: p.id, page: "card", profile: {username: p.username}}
    this.drawCard()
    try {
      const r = await this.req("/functions/v1/api/profiles/" + p.id, "GET", undefined, true)
      if (r.status === 200 && r.data && this.card && this.card.id === p.id) { this.card.profile = r.data; this.drawCard() }
    } catch (e) {}
  }
  private drawCard() {
    const c = this.card
    if (!c) return
    const u = c.profile || {}
    const soc = this.socialsOf(u)
    if (c.page === "card") {
      this.panelText.text = "@" + (u.username || "") + "\n" + (u.bio ? String(u.bio).slice(0, 80) + "\n" : "") +
        (soc.length ? "\n" + soc.slice(0, 3).map((l: any) => LABELS[l.platform]).join(" · ") + (soc.length > 3 ? " +" + (soc.length - 3) : "") + "\n\nPinch for socials" : "\nPinch to close")
    } else {
      this.panelText.text = "@" + (u.username || "") + "\n\n" + soc.slice(0, 7).map((l: any) => LABELS[l.platform] + "   @" + this.handleOf(l.value)).join("\n") + "\n\nFollow them in iYiYi on your phone"
    }
  }

  // ---------------------------------------------------------------- realtime (laser tag bridge)
  private keyBusy = false
  private async tickRealtime(now: number) {
    if (!this.topic) {
      if (this.keyBusy) return
      this.keyBusy = true
      try {
        const r = await this.req("/rest/v1/rpc/glasses_pair_key", "POST", {}, true)
        if (r.status === 200 && typeof r.data === "string") this.topic = "glasses:" + this.session.user_id + ":" + r.data
        else if (r.status === 401) this.refreshSession()
      } catch (e) {}
      this.keyBusy = false
      return
    }
    if (!this.ws) this.openWs()
    if (!this.wsOpen) return
    if (now > this.nextBeat) { this.nextBeat = now + 25000; this.wsSend({topic: "phoenix", event: "heartbeat", payload: {}, ref: String(this.ref++)}) }
    if (now > this.nextAim && this.headingFresh()) { this.nextAim = now + 120; this.broadcast("g_aim", {deg: Math.round(this.heading * 10) / 10, at: now}) }
  }
  private openWs() {
    try {
      const ws = this.internet.createWebSocket(WS_URL)
      this.ws = ws
      ws.onopen = () => {
        this.wsOpen = true
        this.wsSend({topic: "realtime:" + this.topic, event: "phx_join", ref: String(this.ref++), payload: {config: {broadcast: {ack: false, self: false}, presence: {key: ""}, private: false}, access_token: this.session.access_token}})
        this.broadcast("g_hello", {at: Date.now(), device: "specs"})
      }
      ws.onmessage = (ev: WebSocketMessageEvent) => {
        try {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "")
          if (m.event === "broadcast" && m.payload) this.onBroadcast(m.payload.event, m.payload.payload || {})
        } catch (e) {}
      }
      ws.onclose = () => { this.wsOpen = false; this.ws = null }
      ws.onerror = () => { this.wsOpen = false }
    } catch (e) { print("iYiYi: websocket " + e) }
  }
  private closeWs() { try { if (this.ws) this.ws.close() } catch (e) {} this.ws = null; this.wsOpen = false; this.topic = null }
  private wsSend(o: any) { try { if (this.ws && this.wsOpen) this.ws.send(JSON.stringify(o)) } catch (e) {} }
  private broadcast(event: string, payload: any) {
    this.wsSend({topic: "realtime:" + this.topic, event: "broadcast", ref: String(this.ref++), payload: {type: "broadcast", event, payload}})
  }

  private matchLive() { return this.hud && Date.now() - this.hudAt < 4000 && (this.hud.phase === "playing" || this.hud.phase === "countdown") }

  private onBroadcast(event: string, p: any) {
    if (event === "p_hud") { this.hud = p; this.hudAt = Date.now() }
    else if (event === "p_event") this.onGameEvent(p)
  }

  private lastFire = 0
  private fire() {
    const now = Date.now()
    if (now - this.lastFire < 180) return
    this.lastFire = now
    if (!this.headingFresh()) { this.toast("Compass calibrating, look around"); return }
    this.broadcast("g_fire", {deg: Math.round(this.heading * 10) / 10, at: now})
    // tracer from just below your eyes along your view
    const cam = this.camT.getWorldPosition()
    const d = this.viewDir()
    const start = cam.add(d.uniformScale(30)).add(new vec3(0, -12, 0))
    this.spawnTracer(start, d, new vec4(1, 0.82, 0.25, 1))
  }

  private onGameEvent(ev: any) {
    if (ev.kind === "hit") {
      const p = this.targetWorldPos()
      if (p) this.burst(p, new vec4(1, 0.82, 0.25, 1), 10)
    } else if (ev.kind === "kill") {
      const p = this.targetWorldPos() || this.lastTargetPos
      if (p) this.blockPile(p)
      this.toast(ev.text || "Tagged out!")
    } else if (ev.kind === "got_hit" || ev.kind === "died") {
      if (typeof ev.bearing === "number" && this.headingFresh()) {
        // a shot whizzes past from the shooter's side
        const from = this.worldAt(ev.bearing, 12, -5)
        const cam = this.camT.getWorldPosition()
        if (from) {
          const dir = cam.add(this.flatDir().uniformScale(40)).sub(from).normalize()
          this.spawnTracer(from, dir, new vec4(1, 0.25, 0.25, 1))
        }
      }
      this.toast(ev.kind === "died" ? (ev.text || "You're out") : "Hit!", 1200)
    } else if (ev.kind === "boom") {
      const p = this.targetWorldPos() || (this.camT ? this.camT.getWorldPosition().add(this.flatDir().uniformScale(400)) : null)
      if (p) this.burst(p, new vec4(1, 0.45, 0.1, 1), 22)
    }
  }

  private targetWorldPos(): vec3 {
    const t = this.hud && this.hud.target
    if (!t || this.heading === null) return null
    const ft = parseFloat(String(t.dist || ""))
    const meters = isFinite(ft) ? (String(t.dist).indexOf("mi") >= 0 ? ft * 1609 : ft / 3.28084) : 10
    const p = this.worldAt(this.heading, meters, -40)
    if (p) this.lastTargetPos = p
    return p
  }

  private drawHud() {
    if (!this.matchLive()) {
      this.hudText.text = this.card ? "" : (this.people.length ? "" : "")
      this.enemyMarks.forEach((o) => (o.enabled = false))
      return
    }
    const h = this.hud
    const t = h.target ? "◎ @" + h.target.name + "  " + (h.target.dist || "") + (h.target.chance != null ? "  " + Math.round(h.target.chance * 100) + "%" : "") : "+"
    const hp = Math.max(0, Math.min(10, Math.round(10 * (h.hp || 0) / (h.max || 100))))
    const bar = "█".repeat(hp) + "░".repeat(10 - hp)
    this.hudText.text = t + "\n" + bar + "   " + (h.score || "") + "   " + (h.clock || "") +
      (h.phase === "countdown" ? "\nStarting " + (h.countdown || "") : h.alive === false ? "\nOUT" + (h.respawn ? " · back in " + h.respawn + "s" : "") : "")
    // enemy markers floating where they are
    const list = (h.enemies || []).slice(0, 8)
    while (this.enemyMarks.length < list.length) this.enemyMarks.push(this.makeText("◆", 8, new vec4(1, 0.31, 0.64, 1)))
    this.enemyMarks.forEach((o, i) => {
      const e = list[i]
      if (!e || typeof e.bearing !== "number") { o.enabled = false; return }
      const at = this.worldAt(e.bearing, Math.max(2, e.d || 5), 30)
      if (!at) { o.enabled = false; return }
      o.enabled = true
      const tr = o.getTransform()
      tr.setWorldPosition(at)
      this.faceCamera(tr)
      const sc = Math.max(1, (e.d || 5) / 4)
      tr.setWorldScale(new vec3(sc, sc, sc))
      const tx = o.getComponent("Component.Text") as Text
      tx.textFill.color = e.alive === false ? new vec4(0.4, 0.4, 0.4, 1) : new vec4(1, 0.31, 0.64, 1)
    })
  }

  // ---------------------------------------------------------------- 3D effects
  private makeCube(): RenderMesh {
    const mb = new MeshBuilder([{name: "position", components: 3}, {name: "normal", components: 3}, {name: "texture0", components: 2}])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const faces = [
      [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
      [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
      [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
      [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    ]
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    faces.forEach((f, fi) => {
      const n = f[0]
      for (let k = 0; k < 4; k++) {
        const v = f[k + 1]
        mb.appendVerticesInterleaved([v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, n[0], n[1], n[2], uv[k][0], uv[k][1]])
      }
      const b = fi * 4
      mb.appendIndices([b, b + 1, b + 2, b, b + 2, b + 3])
    })
    mb.updateMesh()
    return mb.getMesh()
  }

  private mat(color: vec4): Material {
    const key = [color.r, color.g, color.b, color.a].map((x) => Math.round(x * 20)).join(",")
    if (!this.mats[key]) {
      const m = this.blockMaterial.clone()
      try { m.mainPass.baseColor = color } catch (e) {}
      this.mats[key] = m
    }
    return this.mats[key]
  }

  private block(pos: vec3, size: vec3, color: vec4, parent?: SceneObject): SceneObject {
    if (!this.cube) return null
    const o = global.scene.createSceneObject("iyBlock")
    if (parent) o.setParent(parent)
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mesh = this.cube
    v.mainMaterial = this.mat(color)
    const t = o.getTransform()
    t.setWorldPosition(pos)
    t.setWorldScale(size)
    return o
  }

  private spawnTracer(start: vec3, dir: vec3, color: vec4) {
    const o = this.block(start, new vec3(1.2, 1.2, 70), color)
    if (!o) return
    o.getTransform().setWorldRotation(quat.lookAt(dir, vec3.up()))
    this.fx.push({obj: o, t: 0, life: 0.6, vel: dir.uniformScale(4500)})
  }

  private burst(at: vec3, color: vec4, n: number) {
    for (let i = 0; i < n; i++) {
      const v = new vec3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().uniformScale(150 + Math.random() * 250)
      const o = this.block(at, new vec3(6, 6, 6), i % 3 === 0 ? new vec4(1, 1, 1, 1) : color)
      if (o) this.fx.push({obj: o, t: 0, life: 0.7, vel: v, spin: new vec3(Math.random() * 6, Math.random() * 6, 0)})
    }
  }

  // Tagged out: the player "collapses" into a pile of colourful blocks where they stood.
  private blockPile(at: vec3) {
    const colors = [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.82, 0.25, 1), new vec4(0.36, 0.95, 0.63, 1), new vec4(0.69, 0.42, 1, 1), new vec4(1, 0.45, 0.2, 1)]
    const floor = this.floorY
    for (let i = 0; i < 36; i++) {
      // stacked roughly in a person-sized column (they fall out of the shape)
      const p = new vec3(at.x + (Math.random() - 0.5) * 40, floor + 20 + Math.random() * 160, at.z + (Math.random() - 0.5) * 40)
      const s = 10 + Math.random() * 12
      const o = this.block(p, new vec3(s, s, s), colors[i % colors.length])
      if (!o) continue
      const v = new vec3((Math.random() - 0.5) * 120, 40 + Math.random() * 80, (Math.random() - 0.5) * 120)
      this.fx.push({obj: o, t: 0, life: 9, vel: v, spin: new vec3(Math.random() * 4, Math.random() * 4, Math.random() * 4), gravity: true, floorY: floor + s / 2})
    }
  }

  private tickFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.t += dt
      const tr = f.obj.getTransform()
      if (f.vel) {
        if (f.gravity) f.vel = new vec3(f.vel.x, f.vel.y - 980 * dt, f.vel.z)
        let p = tr.getWorldPosition().add(f.vel.uniformScale(dt))
        if (f.floorY !== undefined && p.y < f.floorY) {
          p = new vec3(p.x, f.floorY, p.z)
          f.vel = new vec3(f.vel.x * 0.5, Math.abs(f.vel.y) * 0.25, f.vel.z * 0.5)
          if (f.spin) f.spin = f.spin.uniformScale(0.6)
        }
        tr.setWorldPosition(p)
      }
      if (f.spin) tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)))
      if (!f.gravity && f.life < 1.5) {
        const k = Math.max(0.01, 1 - f.t / f.life)
        const s = tr.getWorldScale()
        if (f.vel && f.life > 0.65) tr.setWorldScale(new vec3(s.x * (0.96 + 0.04 * k), s.y * (0.96 + 0.04 * k), s.z * (0.96 + 0.04 * k)))
      }
      if (f.t >= f.life) {
        f.obj.destroy()
        this.fx.splice(i, 1)
        if (f.onDone) f.onDone()
      }
    }
  }

  // ---------------------------------------------------------------- worlds
  private nextWorld() {
    const i = (WORLDS.indexOf(this.world) + 1) % WORLDS.length
    this.setWorld(WORLDS[i])
  }

  private setWorld(w: string) {
    this.world = w
    if (this.worldRoot) this.worldRoot.destroy()
    this.worldRoot = null
    this.worldParts = []
    const names: {[k: string]: string} = {off: "World off", lava: "Hot lava floor", underwater: "Underwater", desert: "Desert", snow: "Snow", rainforest: "Rainforest", space: "Space", monogram: "iY monogram"}
    this.toast(names[w] || w)
    if (w === "off" || !this.cube || !this.camT) { if (!this.cube && w !== "off") this.toast("Add an Unlit material to see worlds"); return }
    this.worldRoot = global.scene.createSceneObject("iyWorld")
    const cam = this.camT.getWorldPosition()
    const floor = this.floorY
    const tile = 120
    const N = 9
    const pal: {[k: string]: vec4[]} = {
      lava: [new vec4(1, 0.25, 0, 1), new vec4(1, 0.55, 0, 1), new vec4(0.85, 0.1, 0, 1), new vec4(1, 0.8, 0.1, 1)],
      underwater: [new vec4(0, 0.35, 0.55, 1), new vec4(0, 0.5, 0.6, 1), new vec4(0.85, 0.75, 0.45, 1)],
      desert: [new vec4(0.93, 0.76, 0.45, 1), new vec4(0.86, 0.66, 0.36, 1), new vec4(0.97, 0.84, 0.55, 1)],
      snow: [new vec4(0.92, 0.96, 1, 1), new vec4(0.8, 0.88, 0.98, 1)],
      rainforest: [new vec4(0.1, 0.5, 0.15, 1), new vec4(0.2, 0.65, 0.2, 1), new vec4(0.35, 0.25, 0.1, 1)],
      space: [new vec4(0.12, 0.08, 0.25, 1), new vec4(0.05, 0.05, 0.12, 1)],
      monogram: [new vec4(0.55, 0.42, 0.18, 1), new vec4(0.12, 0.25, 0.15, 1)],
    }
    const colors = pal[w] || pal.lava
    // floor tiles around you
    for (let x = -N; x <= N; x++) {
      for (let z = -N; z <= N; z++) {
        if (x * x + z * z > N * N) continue
        let c = colors[Math.floor(Math.random() * colors.length)]
        if (w === "monogram") c = (x + z) % 2 === 0 ? colors[0] : colors[1]
        const o = this.block(new vec3(cam.x + x * tile, floor - 2, cam.z + z * tile), new vec3(tile - 4, 2, tile - 4), c, this.worldRoot)
        if (o && (w === "lava" || w === "underwater")) this.worldParts.push({obj: o, t: Math.random() * 6, life: 1e9})
        if (o && w === "monogram") {
          const m = global.scene.createSceneObject("iyMono")
          m.setParent(this.worldRoot)
          const tx = m.createComponent("Component.Text") as Text
          tx.text = "iY"
          tx.size = 300
          tx.textFill.color = new vec4(1, 0.85, 0.45, 1)
          tx.horizontalAlignment = HorizontalAlignment.Center
          const mt = m.getTransform()
          mt.setWorldPosition(new vec3(cam.x + x * tile, floor + 1, cam.z + z * tile))
          mt.setWorldRotation(quat.angleAxis(-Math.PI / 2, vec3.right()))
        }
      }
    }
    // atmosphere particles
    const count = w === "space" ? 120 : w === "monogram" || w === "desert" ? 30 : 70
    for (let i = 0; i < count; i++) {
      let c = new vec4(1, 1, 1, 1)
      let s = 3
      if (w === "lava") { c = Math.random() < 0.5 ? new vec4(1, 0.5, 0, 1) : new vec4(1, 0.85, 0.2, 1); s = 3 } // embers
      if (w === "underwater") { c = new vec4(0.7, 0.95, 1, 1); s = 2 + Math.random() * 4 } // bubbles
      if (w === "desert") { c = new vec4(0.95, 0.8, 0.5, 1); s = 2 } // sand
      if (w === "rainforest") { c = Math.random() < 0.6 ? new vec4(0.6, 0.85, 1, 1) : new vec4(0.2, 0.75, 0.25, 1); s = 2 } // rain + leaves
      if (w === "space") { c = Math.random() < 0.9 ? new vec4(1, 1, 1, 1) : new vec4(0.6, 0.7, 1, 1); s = 6 } // stars
      if (w === "monogram") { c = new vec4(1, 0.85, 0.45, 1); s = 4 }
      const r = w === "space" ? 1500 + Math.random() * 1500 : 100 + Math.random() * 900
      const a = Math.random() * Math.PI * 2
      const y = w === "space" ? (Math.random() * 2 - 0.3) * 1200 : floor + Math.random() * 350
      const o = this.block(new vec3(cam.x + Math.cos(a) * r, cam.y - 150 + (y - floor), cam.z + Math.sin(a) * r), new vec3(s, s, s), c, this.worldRoot)
      if (o) this.worldParts.push({obj: o, t: Math.random() * 10, life: 1e9, vel: new vec3(0, 0, 0), spin: new vec3(Math.random(), Math.random(), 0)})
    }
    if (w === "space") {
      // a planet
      const p = this.block(cam.add(this.flatDir().uniformScale(3000)).add(new vec3(800, 600, 0)), new vec3(700, 700, 700), new vec4(0.85, 0.45, 0.3, 1), this.worldRoot)
      if (p) this.worldParts.push({obj: p, t: 0, life: 1e9, spin: new vec3(0, 0.05, 0)})
    }
  }

  private tickWorld(dt: number) {
    if (!this.worldRoot) return
    const w = this.world
    const floor = this.floorY
    for (const f of this.worldParts) {
      f.t += dt
      const tr = f.obj.getTransform()
      const p = tr.getWorldPosition()
      if (f.vel) {
        let np = p
        if (w === "lava") np = new vec3(p.x + Math.sin(f.t) * 3 * dt, p.y + 40 * dt, p.z)
        else if (w === "underwater") np = new vec3(p.x + Math.sin(f.t * 2) * 8 * dt, p.y + 35 * dt, p.z)
        else if (w === "snow") np = new vec3(p.x + Math.sin(f.t) * 10 * dt, p.y - 40 * dt, p.z)
        else if (w === "rainforest") np = new vec3(p.x, p.y - 400 * dt, p.z)
        else if (w === "desert") np = new vec3(p.x + 120 * dt, p.y + Math.sin(f.t * 3) * 5 * dt, p.z)
        else if (w === "monogram") np = new vec3(p.x, p.y + Math.sin(f.t) * 10 * dt, p.z)
        if (np.y > floor + 400) np = new vec3(np.x, floor, np.z)
        if (np.y < floor && w !== "space") np = new vec3(np.x, floor + 380, np.z)
        if (w === "desert" && this.camT && np.x - this.camT.getWorldPosition().x > 900) np = new vec3(np.x - 1800, np.y, np.z)
        tr.setWorldPosition(np)
        if (f.spin) tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(f.spin.x * dt, f.spin.y * dt, 0)))
      } else if (f.spin) {
        tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(0, f.spin.y * dt, 0)))
      } else if (w === "lava" || w === "underwater") {
        // floor tiles bob a little (bubbling lava / swaying sea floor)
        tr.setWorldPosition(new vec3(p.x, floor - 2 + Math.sin(f.t * (w === "lava" ? 2 : 0.8)) * (w === "lava" ? 3 : 1.5), p.z))
      }
    }
  }
}
