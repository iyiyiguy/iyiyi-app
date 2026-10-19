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
// Start: animated iYiYi LASER TAG logo, then a menu you pick from by looking at a button and
// pinching: Solo practice (cartoon robots to shoot, works with no phone or account), Play with
// iYiYi (link / your phone's match), World.
// Weapons: cartoon guns held in your right hand; left-hand pinch switches weapon. Big bright laser
// bolts, huge spiralling rockets. In a phone match, players show as cartoon avatars (team red /
// blue, or their own colour in free-for-all) and the bomb, bomb sites, sticky bombs and mines
// stand where they are.
//
// Inputs: blockMaterial = an Unlit material (cloned per colour). Without it the Lens still links,
// shows names and fires; only the 3D blocks / worlds are skipped.
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
// 5x7 block font for the giant title logos (the iYiYi i's are 2 wide).
const FONT5: {[k: string]: string[]} = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"], B: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"], D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"], F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ####", "#    ", "#    ", "#  ##", "#   #", "#   #", " ### "], H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: ["###", " # ", " # ", " # ", " # ", " # ", "###"], J: ["  ###", "   # ", "   # ", "   # ", "#  # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"], L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"], N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "], P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"], R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "], T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "], V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"], X: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "], Z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  i: ["##", "  ", "##", "##", "##", "##", "##"], " ": ["  ", "  ", "  ", "  ", "  ", "  ", "  "],
}

// title logo colours (the app's palette)
const LG = {pal: [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.7, 0.12, 1)], text: new vec4(0.95, 0.96, 0.97, 1), muted: new vec4(0.62, 0.64, 0.68, 1), friendly: new vec4(0.22, 0.84, 1, 1), objective: new vec4(1, 0.7, 0.12, 1)}

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
const WORLD_NAMES: {[k: string]: string} = {off: "Off", lava: "Hot lava", underwater: "Underwater", desert: "Desert", snow: "Snow", rainforest: "Rainforest", space: "Space", monogram: "iY monogram"}

type Weapon = {id: string; name: string; color: vec4; gap: number; bolt: number; speed: number; pellets?: number; rocket?: boolean; damage: number}
const WEAPONS: Weapon[] = [
  {id: "pistol", name: "Laser Pistol", color: new vec4(0.2, 0.9, 1, 1), gap: 220, bolt: 5, speed: 3200, damage: 1},
  {id: "rifle", name: "Pulse Rifle", color: new vec4(1, 0.3, 0.65, 1), gap: 120, bolt: 4.5, speed: 3800, damage: 1},
  {id: "shotgun", name: "Blaster", color: new vec4(1, 0.82, 0.2, 1), gap: 650, bolt: 6, speed: 3000, pellets: 5, damage: 1},
  {id: "sniper", name: "Rail Sniper", color: new vec4(0.45, 1, 0.4, 1), gap: 900, bolt: 4, speed: 8000, damage: 3},
  {id: "rocket", name: "Rocket Launcher", color: new vec4(1, 0.45, 0.1, 1), gap: 1600, bolt: 0, speed: 1400, rocket: true, damage: 3},
]
const TEAM_RED = new vec4(1, 0.25, 0.3, 1)
const TEAM_BLUE = new vec4(0.25, 0.55, 1, 1)
const PALETTE = [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.82, 0.25, 1), new vec4(0.36, 0.95, 0.63, 1), new vec4(0.69, 0.42, 1, 1), new vec4(1, 0.5, 0.2, 1)]
type Btn = {obj: SceneObject; text: Text; action: string}
type Avatar = {root: SceneObject; name: Text; color: string; pos: vec3}
type Robot = {root: SceneObject; pos: vec3; hp: number; phase: number; base: vec3}

@component
export class IYiYiSpecs extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Unlit material, used for blocks, tracers and worlds (cloned per colour)")
  blockMaterial: Material

  private internet: InternetModule = require("LensStudio:InternetModule")
  private store = global.persistentStorageSystem.store
  private camT: Transform
  private camComp: Camera = null
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

  // modes: intro -> menu -> solo | link | live (linked, names) | match (phone match running)
  private mode = "intro"
  private modeT = 0
  private introObjs: SceneObject[] = []
  private btns: Btn[] = []
  private menuBtn: SceneObject = null
  private weaponIdx = 0
  private gun: SceneObject = null
  private gunFor = ""
  private robots: Robot[] = []
  private soloScore = 0
  private soloEnd = 0
  private avatars: {[id: string]: Avatar} = {}
  private objMarks: SceneObject[] = []

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

    this.panelText.text = ""
    this.startSensors()
    this.loadSession()
    this.createEvent("UpdateEvent").bind(() => this.update())
    this.wireHands()
    // Lens Studio preview: a mouse click / screen tap stands in for a right-hand pinch
    try {
      this.createEvent("TapEvent").bind((ev: TapEvent) => {
        // in the menu a click picks the button under the mouse; elsewhere it acts like a pinch
        if (this.mode === "menu" && this.camComp) {
          const tp = ev.getTapPosition()
          let best: Btn = null
          let bestD = 0.12
          for (const b of this.btns) {
            const sp = this.camComp.worldSpaceToScreenSpace(b.obj.getTransform().getWorldPosition())
            const dd = Math.abs(sp.y - tp.y)
            if (dd < bestD) { bestD = dd; best = b }
          }
          if (best) { this.runButton(best); return }
        }
        this.onPrimaryPinch()
      })
    } catch (e) {}
    if (this.camT) this.floorY = this.camT.getWorldPosition().y - 150
    this.startIntro()
  }

  // ---------------------------------------------------------------- input
  private wireHands() {
    try {
      const hands = SIK.HandInputData
      const right = hands.getHand("right")
      const left = hands.getHand("left")
      right.onPinchDown.add(() => this.onPrimaryPinch())
      left.onPinchDown.add(() => this.onSecondaryPinch())
    } catch (e) {
      print("iYiYi: hand input unavailable " + e)
    }
  }

  private onSecondaryPinch() {
    if (this.mode === "solo" || this.mode === "match") this.switchWeapon()
    else if (this.mode === "menu" || this.mode === "live") this.nextWorld()
  }

  private onPrimaryPinch() {
    if (this.mode === "intro") { this.endIntro(); return }
    if (this.mode === "menu") { this.pickButton(); return }
    if (this.menuGazed()) { this.openMenu(); return }
    if (this.mode === "solo") { this.soloFire(); return }
    if (this.mode === "link") return
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

    this.modeT += dt
    if (this.mode === "intro") this.tickIntro()
    if (this.mode === "menu") this.tickMenu()
    if (this.mode === "solo") this.tickSolo(dt, now)
    this.tickGun()
    this.tickMenuBtn()
    if (this.mode === "link") {
      if (this.session) { this.panelText.text = ""; this.setMode("live"); this.toast("Linked! Look around") }
      else this.tickLink(now)
    } else if (this.session && (this.mode === "live" || this.mode === "match")) {
      if (this.mode === "live" && this.matchLive()) this.setMode("match")
      if (this.mode === "match" && !this.matchLive() && Date.now() - this.hudAt > 6000) this.setMode("live")
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
      const cc = o.getComponent("Component.Camera") as Camera
      if (cc) { this.camComp = cc; return o.getTransform() }
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
    if (flat.length > 0.001) t.setWorldRotation(quat.lookAt(flat.normalize(), vec3.up())) // +Z (the readable side) toward you
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
    const show = this.mode === "live" && this.pos && this.headingFresh() && this.camT
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
    const w = this.currentWeapon()
    if (now - this.lastFire < Math.max(150, w.gap)) return
    this.lastFire = now
    if (!this.headingFresh()) { this.toast("Compass calibrating, look around"); return }
    if (w.rocket) { this.toast("Rockets: aim with your phone for now"); }
    else this.broadcast("g_fire", {deg: Math.round(this.heading * 10) / 10, at: now})
    this.shootVisual(w, null)
  }

  /** Bolt / rocket visual from the gun (or below your eyes) along your view, optionally to a point. */
  private shootVisual(w: Weapon, to: vec3) {
    const cam = this.camT.getWorldPosition()
    const d = this.viewDir()
    const muzzle = this.gunMuzzle() || cam.add(d.uniformScale(30)).add(new vec3(0, -12, 0))
    const target = to || cam.add(d.uniformScale(2500))
    if (w.rocket) { this.spawnRocket(muzzle, target); return }
    const n = w.pellets || 1
    for (let i = 0; i < n; i++) {
      let dir = target.sub(muzzle).normalize()
      if (n > 1) dir = dir.add(new vec3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08)).normalize()
      this.spawnBolt(muzzle, dir, w)
    }
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
      for (const id in this.avatars) this.avatars[id].root.enabled = false
      this.objMarks.forEach((o) => (o.enabled = false))
      if (this.mode === "match") this.hudText.text = ""
      return
    }
    const h = this.hud
    const t = h.target ? "◎ @" + h.target.name + "  " + (h.target.dist || "") + (h.target.chance != null ? "  " + Math.round(h.target.chance * 100) + "%" : "") : "+"
    const hp = Math.max(0, Math.min(10, Math.round(10 * (h.hp || 0) / (h.max || 100))))
    const bar = "█".repeat(hp) + "░".repeat(10 - hp)
    this.hudText.text = t + "\n" + bar + "   " + (h.score || "") + "   " + (h.clock || "") + "\n" + (h.gun || "") +
      (h.phase === "countdown" ? "\nStarting " + (h.countdown || "") : h.alive === false ? "\nOUT" + (h.respawn ? " · back in " + h.respawn + "s" : "") : "")
    this.drawAvatars(h)
    this.drawObjects(h)
  }

  // Players in the match as cartoon avatars where they stand: red / blue in team modes, their own
  // colour in free-for-all. Name + health above. Phone players are placed from GPS.
  private drawAvatars(h: any) {
    const seen: {[id: string]: boolean} = {}
    const list = ([] as any[]).concat((h.enemies || []).map((e: any) => ({...e, enemy: true})), (h.mates || []).map((e: any) => ({...e, enemy: false})))
    list.slice(0, 16).forEach((e: any, i: number) => {
      if (typeof e.bearing !== "number") return
      const id = e.id || (e.enemy ? "e" : "m") + i
      seen[id] = true
      const color = h.teams ? (e.team === h.myTeam ? (h.myTeam === "A" ? TEAM_RED : TEAM_BLUE) : (h.myTeam === "A" ? TEAM_BLUE : TEAM_RED)) : PALETTE[this.hashStr(id) % PALETTE.length]
      const ck = [color.r, color.g, color.b].join(",") + (e.alive === false ? "x" : "")
      let a = this.avatars[id]
      if (!a || a.color !== ck) {
        if (a) a.root.destroy()
        a = this.makeAvatar(e.alive === false ? new vec4(0.45, 0.45, 0.45, 1) : color)
        a.color = ck
        this.avatars[id] = a
      }
      const meters = Math.max(2, e.d || 5)
      const at = this.worldAt(e.bearing, meters, 0)
      if (!at) { a.root.enabled = false; return }
      const ground = new vec3(at.x, this.floorY, at.z)
      a.pos = a.pos ? vec3.lerp(a.pos, ground, 0.15) : ground
      a.root.enabled = true
      const tr = a.root.getTransform()
      tr.setWorldPosition(a.pos)
      this.faceCamera(tr)
      // far players get a bigger avatar so they stay readable (GPS places them, not their body)
      const sc = Math.max(1, meters / 12)
      tr.setWorldScale(new vec3(sc, sc, sc))
      const locked = h.target && e.name && h.target.name === e.name
      a.name.text = (locked ? "◎ " : "") + "@" + (e.name || (e.enemy ? "enemy" : "teammate"))
      a.name.textFill.color = locked ? new vec4(1, 0.82, 0.25, 1) : new vec4(1, 1, 1, 1)
    })
    for (const id in this.avatars) if (!seen[id]) this.avatars[id].root.enabled = false
  }

  private hashStr(s: string) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x) }

  private makeAvatar(color: vec4): Avatar {
    const root = global.scene.createSceneObject("iyAvatar")
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) => {
      const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), c, root)
      if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) }
    }
    const dark = new vec4(color.r * 0.55, color.g * 0.55, color.b * 0.55, 1)
    const skin = new vec4(1, 0.86, 0.7, 1)
    part(0, 165, 0, 30, 30, 30, skin)          // head
    part(-7, 170, 15.5, 5, 5, 1, new vec4(0.1, 0.1, 0.1, 1)) // eyes (front = +Z, faces you)
    part(7, 170, 15.5, 5, 5, 1, new vec4(0.1, 0.1, 0.1, 1))
    part(0, 182, 0, 33, 8, 33, dark)           // helmet
    part(0, 115, 0, 40, 55, 24, color)         // body
    part(-28, 118, 0, 12, 48, 12, color)       // arms
    part(28, 118, 0, 12, 48, 12, color)
    part(-11, 55, 0, 15, 70, 15, dark)         // legs
    part(11, 55, 0, 15, 70, 15, dark)
    const n = global.scene.createSceneObject("iyAvatarName")
    n.setParent(root)
    const t = n.createComponent("Component.Text") as Text
    t.size = 90
    t.horizontalAlignment = HorizontalAlignment.Center
    t.depthTest = false
    t.textFill.color = new vec4(1, 1, 1, 1)
    n.getTransform().setLocalPosition(new vec3(0, 215, 0))
    return {root, name: t, color: "", pos: null}
  }

  // The bomb, bomb sites, sticky bombs and land mines where they really are (from the phone match).
  private drawObjects(h: any) {
    const list = (h.objects || []).slice(0, 12)
    while (this.objMarks.length < list.length) {
      const o = global.scene.createSceneObject("iyObj")
      const t = o.createComponent("Component.Text") as Text
      t.size = 160
      t.horizontalAlignment = HorizontalAlignment.Center
      t.depthTest = false
      this.objMarks.push(o)
    }
    const blink = Math.sin(this.time * 10) > 0
    this.objMarks.forEach((o, i) => {
      const e = list[i]
      if (!e || typeof e.bearing !== "number") { o.enabled = false; return }
      const meters = Math.max(1.5, e.d || 3)
      const at = this.worldAt(e.bearing, meters, 0)
      if (!at) { o.enabled = false; return }
      o.enabled = true
      const tr = o.getTransform()
      const t = o.getComponent("Component.Text") as Text
      const k = e.kind
      const y = k === "site" ? this.floorY + 60 : this.floorY + 25
      tr.setWorldPosition(new vec3(at.x, y, at.z))
      this.faceCamera(tr)
      const sc = Math.max(1, meters / 6)
      tr.setWorldScale(new vec3(sc, sc, sc))
      if (k === "bomb") { t.text = e.planted ? "💣\nPLANTED" : "💣"; t.textFill.color = e.planted && blink ? new vec4(1, 0.2, 0.2, 1) : new vec4(1, 0.85, 0.3, 1) }
      else if (k === "site") { t.text = e.label || "A"; t.textFill.color = new vec4(1, 0.82, 0.25, 1) }
      else if (k === "sticky") { t.text = "●"; t.textFill.color = blink ? new vec4(1, 0.2, 0.2, 1) : new vec4(0.5, 0.05, 0.05, 1) }
      else if (k === "mine") { t.text = "◉"; t.textFill.color = blink ? new vec4(1, 0.9, 0.2, 1) : new vec4(0.6, 0.5, 0.1, 1) }
      else { t.text = "◆"; t.textFill.color = new vec4(1, 1, 1, 1) }
    })
  }

  // ---------------------------------------------------------------- modes: intro, menu, solo
  private setMode(m: string) {
    this.mode = m
    this.modeT = 0
    if (m !== "menu") { this.btns.forEach((b) => b.obj.destroy()); this.btns = [] }
    if (m !== "solo") { this.robots.forEach((r) => r.root.destroy()); this.robots = [] }
    if (m !== "live") for (const id in this.labels) this.labels[id].obj.enabled = false
    if (m !== "match") { for (const id in this.avatars) this.avatars[id].root.enabled = false; this.objMarks.forEach((o) => (o.enabled = false)); this.hudText.text = "" }
    if (m === "menu" || m === "intro") this.panelText.text = ""
  }

  // ------------------------------------------------------------------ giant title logo
  // A huge block-letter iYiYi (about 11.5 ft tall) stands 14 m in front of you, the game's name
  // under it, and "CREATED BY COLIN PHILLIPS" about 1 ft tall at the bottom, in a frame.
  private logoParts: {obj: SceneObject; x: number; y: number; delay: number; drop: number}[] = []
  private logoAnchor: vec3 = null
  private logoFace: quat = null
  /** one mesh of cubes spelling `text` (FONT5), `px` cm per pixel, centred, bottom at y = 0 */
  private voxelText(text: string, px: number, c: vec4): SceneObject {
    const mb = new MeshBuilder([{name: "position", components: 3}, {name: "normal", components: 3}, {name: "texture0", components: 2}])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const glyphs = text.split("").map((ch) => FONT5[ch] || FONT5[ch.toUpperCase()] || FONT5[" "])
    let cols = 0
    glyphs.forEach((g, i) => (cols += g[0].length + (i ? 1 : 0)))
    let x0 = -cols * px / 2, n = 0
    const faces = [[[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const h = px * 0.46, dz = px * 0.35
    glyphs.forEach((g) => {
      for (let r = 0; r < 7; r++) for (let cI = 0; cI < g[r].length; cI++) {
        if (g[r][cI] !== "#" || n > 2600) continue
        const cx = x0 + cI * px + px / 2, cy = (6 - r) * px + px / 2
        faces.forEach((f) => {
          const b = n * 24 + faces.indexOf(f) * 4
          for (let k = 0; k < 4; k++) { const v = f[k + 1]; mb.appendVerticesInterleaved([cx + v[0] * h, cy + v[1] * h, v[2] * dz, f[0][0], f[0][1], f[0][2], uv[k][0], uv[k][1]]) }
          mb.appendIndices([b, b + 1, b + 2, b, b + 2, b + 3])
        })
        n++
      }
      x0 += (g[0].length + 1) * px
    })
    const o = global.scene.createSceneObject("iyLogoText")
    if (n === 0 || !this.blockMaterial) return o
    mb.updateMesh()
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mesh = mb.getMesh()
    v.mainMaterial = this.mat(c)
    return o
  }
  private buildLogo(sub: string) {
    this.destroyLogo()
    const d = this.flatDir(), cam = this.camPos()
    this.logoAnchor = new vec3(cam.x + d.x * 1400, this.floorY, cam.z + d.z * 1400)
    this.logoFace = quat.lookAt(d.uniformScale(-1), vec3.up())
    const PX = 50 // 7 rows x 50 cm = 3.5 m (11.5 ft) tall letters
    const letters = ["i", "Y", "i", "Y", "i"], cols = [LG.pal[0], LG.pal[1], LG.pal[2], LG.pal[1], LG.pal[0]]
    const total = 2 + 5 + 2 + 5 + 2 + 4
    let x = -total * PX / 2
    letters.forEach((ch, i) => {
      const w = FONT5[ch][0].length
      this.logoParts.push({obj: this.voxelText(ch, PX, cols[i]), x: x + w * PX / 2, y: 330, delay: 0.15 + i * 0.16, drop: 700})
      x += (w + 1) * PX
    })
    this.logoParts.push({obj: this.voxelText(sub, 17, LG.text), x: 0, y: 150, delay: 1.1, drop: 0})            // game name, ~1.2 m
    this.logoParts.push({obj: this.voxelText("CREATED BY COLIN PHILLIPS", 30 / 7, LG.muted), x: 0, y: 80, delay: 1.8, drop: 0}) // ~1 ft
    // frame: cyan rails with amber corner brackets (the app's game-cover style)
    const f = global.scene.createSceneObject("iyLogoFrame")
    const W = 1240, top = 740, bot = 50, th = 8
    if (this.cube) {
      this.logoPart(f, 0, top, 0, W, th, th, LG.friendly); this.logoPart(f, 0, bot, 0, W, th, th, LG.friendly)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const y = sy > 0 ? top : bot
        this.logoPart(f, sx * (W / 2 - 50), y + sy * 14, 0, 120, 18, 18, LG.objective)
        this.logoPart(f, sx * (W / 2 + 14), y - sy * 50, 0, 18, 120, 18, LG.objective)
      }
      this.logoPart(f, 0, 128, 0, 360, 5, 5, LG.objective) // rule between the name and the credit
    }
    this.logoParts.push({obj: f, x: 0, y: 0, delay: 0, drop: 0})
    this.tickLogo(0)
  }
  private tickLogo(t: number) {
    if (!this.logoAnchor) return
    const r = this.logoFace.multiplyVec3(new vec3(1, 0, 0))
    this.logoParts.forEach((p, i) => {
      const k = Math.max(0, Math.min(1, (t - p.delay) / 0.45))
      const ease = 1 - Math.pow(1 - k, 3)
      const pop = k < 1 ? Math.max(0.001, k * (1.2 - 0.2 * k)) : 1 + (p.drop ? Math.sin(t * 2.4 + i) * 0.02 : 0)
      const isFrame = i === this.logoParts.length - 1
      const tr = p.obj.getTransform()
      tr.setWorldPosition(this.logoAnchor.add(r.uniformScale(p.x)).add(new vec3(0, p.y + p.drop * (1 - ease), 0)))
      tr.setWorldRotation(this.logoFace)
      const fk = Math.max(0.001, Math.min(1, (t - 0.05) / 0.6))
      tr.setWorldScale(isFrame ? new vec3(fk, 1, 1) : new vec3(pop, pop, pop))
      if (p.drop && k >= 1 && t - 0.02 < p.delay + 0.47 && t > p.delay + 0.45) this.logoBurst(tr.getWorldPosition().add(new vec3(0, 20, 0)), LG.pal[i % LG.pal.length])
    })
  }
  private logoPart(parent: SceneObject, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) {
    const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), c, parent)
    if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) }
  }
  private logoBurst(at: vec3, c: vec4) {
    for (let i = 0; i < 24; i++) {
      const v = new vec3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().uniformScale(300 + Math.random() * 400)
      const o = this.block(at, new vec3(22, 22, 22), i % 3 === 0 ? new vec4(1, 1, 1, 1) : c)
      if (o) this.fx.push({obj: o, t: 0, life: 0.9, vel: v, spin: new vec3(3, 4, 2)})
    }
  }
  private destroyLogo() { this.logoParts.forEach((p) => p.obj.destroy()); this.logoParts = []; this.logoAnchor = null }
  private startIntro() {
    this.setMode("intro")
    if (!this.camT) return
    this.buildLogo("LASER TAG")
  }
  private tickIntro() {
    if (!this.camT) { this.endIntro(); return }
    this.tickLogo(this.modeT)
    if (this.modeT > 5.5) this.endIntro()
  }
  private endIntro() { this.destroyLogo();
    this.introObjs.forEach((o) => o.destroy())
    this.introObjs = []
    this.openMenu()
  }

  private openMenu() {
    this.setMode("menu")
    if (!this.camT) return
    const items: [string, string][] = [
      ["SOLO PRACTICE", "solo"],
      [this.session ? "PLAY WITH iYiYi" : "LINK iYiYi ACCOUNT", "play"],
      ["WORLD: " + WORLD_NAMES[this.world].toUpperCase(), "world"],
    ]
    const cam = this.camT.getWorldPosition()
    const d = this.flatDir()
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 6.5, new vec4(1, 1, 1, 1))
      const t = o.getComponent("Component.Text") as Text
      try { t.backgroundSettings.enabled = true; t.backgroundSettings.fill.color = new vec4(0.05, 0.08, 0.14, 0.9); t.backgroundSettings.cornerRadius = 1 } catch (e) {}
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(150)).add(new vec3(0, 30 - i * 32, 0)))
      tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
      this.btns.push({obj: o, text: t, action})
    })
    this.panelText.text = ""
    this.toast("Look at a button and pinch", 4000)
  }
  private gazedButton(): Btn {
    if (!this.camT) return null
    const cam = this.camT.getWorldPosition()
    const d = this.viewDir()
    let best: Btn = null
    let bestA = 12 * D2R
    for (const b of this.btns) {
      const to = b.obj.getTransform().getWorldPosition().sub(cam).normalize()
      const a = Math.acos(Math.max(-1, Math.min(1, to.dot(d))))
      if (a < bestA) { bestA = a; best = b }
    }
    return best
  }
  private tickMenu() {
    const g = this.gazedButton()
    for (const b of this.btns) {
      b.text.textFill.color = b === g ? new vec4(1, 0.82, 0.25, 1) : new vec4(1, 1, 1, 1)
      const s = b === g ? 1.12 : 1
      b.obj.getTransform().setWorldScale(new vec3(s, s, s))
    }
  }
  private pickButton() {
    const g = this.gazedButton()
    if (!g) { this.toast("Look at a button and pinch"); return }
    this.runButton(g)
  }
  private runButton(g: Btn) {
    if (g.action === "solo") this.startSolo()
    else if (g.action === "play") { if (this.session) this.setMode("live"); else { this.setMode("link"); this.linkCode = null } }
    else if (g.action === "world") { this.nextWorld(); g.text.text = "WORLD: " + WORLD_NAMES[this.world].toUpperCase() }
  }

  // small MENU button floating low in front of you outside the menu; look down at it and pinch
  private tickMenuBtn() {
    const show = this.mode === "solo" || this.mode === "live" || this.mode === "link"
    if (!show || !this.camT) { if (this.menuBtn) this.menuBtn.enabled = false; return }
    if (!this.menuBtn) {
      this.menuBtn = this.makeText("≡ MENU", 2.6, new vec4(0.7, 0.75, 0.85, 1))
    }
    this.menuBtn.enabled = true
    const cam = this.camT.getWorldPosition()
    const d = this.flatDir()
    const tr = this.menuBtn.getTransform()
    tr.setWorldPosition(cam.add(d.uniformScale(70)).add(new vec3(0, -55, 0)))
    tr.setWorldRotation(quat.lookAt(cam.sub(tr.getWorldPosition()).normalize(), vec3.up()))
    const t = this.menuBtn.getComponent("Component.Text") as Text
    t.textFill.color = this.menuGazed() ? new vec4(1, 0.82, 0.25, 1) : new vec4(0.7, 0.75, 0.85, 1)
  }
  private menuGazed(): boolean {
    if (!this.menuBtn || !this.menuBtn.enabled || !this.camT) return false
    const cam = this.camT.getWorldPosition()
    const to = this.menuBtn.getTransform().getWorldPosition().sub(cam).normalize()
    return Math.acos(Math.max(-1, Math.min(1, to.dot(this.viewDir())))) < 10 * D2R
  }

  // Solo practice: cartoon robots around you; 60 s, score, works with no phone, GPS or account.
  private startSolo() {
    this.setMode("solo")
    this.soloScore = 0
    this.soloEnd = Date.now() + 60000
    for (let i = 0; i < 4; i++) this.spawnRobot()
    this.toast("Solo practice · pinch to shoot · left pinch switches gun", 4000)
  }
  private spawnRobot() {
    if (!this.camT) return
    const cam = this.camT.getWorldPosition()
    const ang = (Math.random() - 0.5) * 120
    const dist = 300 + Math.random() * 500
    const dir = quat.angleAxis(ang * D2R, vec3.up()).multiplyVec3(this.flatDir())
    const base = new vec3(cam.x + dir.x * dist, this.floorY, cam.z + dir.z * dist)
    const a = this.makeAvatar(PALETTE[Math.floor(Math.random() * PALETTE.length)])
    a.name.text = "ROBOT"
    this.robots.push({root: a.root, pos: base, hp: 2, phase: Math.random() * 6, base})
  }
  private tickSolo(dt: number, now: number) {
    const left = Math.max(0, Math.ceil((this.soloEnd - now) / 1000))
    if (left > 0) {
      this.hudText.text = "SOLO PRACTICE   Score " + this.soloScore + "   " + left + "s\n" + this.currentWeapon().name
      for (const r of this.robots) {
        r.phase += dt
        const side = quat.angleAxis(Math.PI / 2, vec3.up()).multiplyVec3(this.flatDir())
        r.pos = r.base.add(side.uniformScale(Math.sin(r.phase * 0.9) * 120)).add(new vec3(0, Math.abs(Math.sin(r.phase * 3)) * 15, 0))
        const tr = r.root.getTransform()
        tr.setWorldPosition(r.pos)
        this.faceCamera(tr)
      }
    } else {
      if (this.robots.length) { this.robots.forEach((r) => r.root.destroy()); this.robots = []; this.toast("Time! Score " + this.soloScore + " · pinch to play again", 6000) }
      this.hudText.text = "FINAL SCORE " + this.soloScore + "\nPinch to play again"
    }
  }
  private soloFire() {
    if (Date.now() > this.soloEnd) { this.startSolo(); return }
    const now = Date.now()
    const w = this.currentWeapon()
    if (now - this.lastFire < w.gap) return
    this.lastFire = now
    const cam = this.camT.getWorldPosition()
    const d = this.viewDir()
    let best: Robot = null
    let bestA = 99
    for (const r of this.robots) {
      const c = r.pos.add(new vec3(0, 110, 0))
      const to = c.sub(cam)
      const dist = to.length
      const a = Math.acos(Math.max(-1, Math.min(1, to.normalize().dot(d))))
      const allowed = Math.atan(60 / dist) + (w.pellets ? 4 * D2R : 0) + (w.rocket ? 5 * D2R : 0)
      if (a < allowed && a < bestA) { bestA = a; best = r }
    }
    const hitPoint = best ? best.pos.add(new vec3(0, 110, 0)) : null
    this.shootVisual(w, hitPoint)
    if (!best) return
    const delay = this.createEvent("DelayedCallbackEvent")
    const r = best
    delay.bind(() => {
      if (this.robots.indexOf(r) < 0) return
      r.hp -= w.damage
      this.burst(r.pos.add(new vec3(0, 110, 0)), w.color, w.rocket ? 26 : 8)
      if (r.hp <= 0) {
        this.soloScore += w.rocket ? 1 : 1
        this.blockPile(r.pos)
        r.root.destroy()
        this.robots.splice(this.robots.indexOf(r), 1)
        this.spawnRobot()
      }
    })
    const flight = hitPoint.sub(cam).length / (w.rocket ? w.speed : w.speed)
    delay.reset(Math.min(1.5, flight))
  }

  // ---------------------------------------------------------------- weapons in hand
  private currentWeapon(): Weapon {
    if (this.mode === "match" && this.hud && this.hud.gunId) {
      const w = WEAPONS.find((x) => x.id === this.hud.gunId)
      if (w) return w
      return {...WEAPONS[1], id: this.hud.gunId, name: this.hud.gun || "Gun"}
    }
    return WEAPONS[this.weaponIdx % WEAPONS.length]
  }
  private switchWeapon() {
    if (this.mode === "match" && this.hud && Array.isArray(this.hud.loadout) && this.hud.loadout.length) {
      const ids = this.hud.loadout.map((x: any) => x.id)
      const i = (ids.indexOf(this.hud.gunId) + 1) % ids.length
      this.broadcast("g_weapon", {id: ids[i]})
      this.toast(this.hud.loadout[i].name || ids[i])
      return
    }
    this.weaponIdx = (this.weaponIdx + 1) % WEAPONS.length
    this.toast(this.currentWeapon().name)
  }
  private tickGun() {
    const show = this.mode === "solo" || this.mode === "match"
    let hand: any = null
    try { hand = SIK.HandInputData.getHand("right") } catch (e) {}
    const tracked = hand && hand.isTracked()
    const w = this.currentWeapon()
    if (!show || !tracked || !this.cube) { if (this.gun) this.gun.enabled = false; return }
    if (!this.gun || this.gunFor !== w.id) {
      if (this.gun) this.gun.destroy()
      this.gun = this.makeGun(w)
      this.gunFor = w.id
    }
    this.gun.enabled = true
    const wrist = hand.wrist.position
    const knuckle = hand.indexKnuckle.position
    const fwd = knuckle.sub(wrist).normalize()
    const tr = this.gun.getTransform()
    tr.setWorldPosition(knuckle.add(new vec3(0, -3, 0)))
    tr.setWorldRotation(quat.lookAt(fwd, vec3.up()))
  }
  private gunMuzzle(): vec3 {
    if (!this.gun || !this.gun.enabled) return null
    const tr = this.gun.getTransform()
    return tr.getWorldPosition().add(tr.forward.uniformScale(this.gunFor === "sniper" ? 42 : 26))
  }
  // Chunky cartoon guns (forward = +Z in the gun's space).
  private makeGun(w: Weapon): SceneObject {
    const root = global.scene.createSceneObject("iyGun")
    const c = w.color
    const dark = new vec4(0.15, 0.17, 0.22, 1)
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: vec4) => {
      const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), col, root)
      if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) }
    }
    if (w.id === "rocket") {
      part(0, 3, 6, 7, 7, 34, new vec4(0.3, 0.45, 0.2, 1)); part(0, 3, 24, 9, 9, 4, c); part(0, -4, 2, 3, 8, 3, dark)
    } else if (w.id === "sniper") {
      part(0, 2, 6, 4, 5, 22, dark); part(0, 2.5, 26, 1.8, 1.8, 20, c); part(0, 6, 8, 2.5, 2.5, 9, c); part(0, -4, 0, 3, 8, 3, dark)
    } else if (w.id === "shotgun") {
      part(0, 2, 6, 6, 6, 20, c); part(0, 2, 18, 7, 7, 6, dark); part(0, -4, 0, 3.5, 8, 3.5, dark)
    } else if (w.id === "rifle") {
      part(0, 2, 6, 4, 6, 22, c); part(0, 2.5, 19, 2, 2, 10, dark); part(0, -2, 8, 3, 6, 3, dark); part(0, -4, 0, 3, 8, 3, dark)
    } else {
      part(0, 2, 4, 4, 6, 14, c); part(0, 2.5, 12, 2, 2, 5, dark); part(0, -4, 0, 3.5, 8, 3.5, dark)
    }
    return root
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

  private spawnBolt(start: vec3, dir: vec3, w: Weapon) {
    const s = w.bolt
    const core = this.block(start, new vec3(s, s, 60), new vec4(1, 1, 1, 1))
    const glow = this.block(start, new vec3(s * 2.6, s * 2.6, 75), w.color)
    for (const o of [core, glow]) {
      if (!o) continue
      o.getTransform().setWorldRotation(quat.lookAt(dir, vec3.up()))
      this.fx.push({obj: o, t: 0, life: 0.9, vel: dir.uniformScale(w.speed)})
    }
  }

  // Huge cartoon rocket that spirals to the target, puffing smoke, then a big boom.
  private spawnRocket(start: vec3, target: vec3) {
    const root = global.scene.createSceneObject("iyRocket")
    const part = (z: number, sx: number, sy: number, sz: number, col: vec4) => {
      const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), col, root)
      if (o) { o.getTransform().setLocalPosition(new vec3(0, 0, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) }
    }
    part(0, 14, 14, 55, new vec4(0.95, 0.95, 0.95, 1))
    part(32, 10, 10, 12, new vec4(1, 0.25, 0.25, 1))
    part(-26, 26, 4, 10, new vec4(1, 0.25, 0.25, 1))
    part(-26, 4, 26, 10, new vec4(1, 0.25, 0.25, 1))
    part(-36, 12, 12, 8, new vec4(1, 0.7, 0.1, 1))
    const dist = target.sub(start).length
    const dur = Math.max(0.5, Math.min(2.2, dist / 1400))
    const dir = target.sub(start).normalize()
    const side = dir.cross(vec3.up()).normalize()
    const up = side.cross(dir).normalize()
    let t = 0
    let lastPuff = 0
    const tr = root.getTransform()
    tr.setWorldPosition(start)
    const fx: Fx = {obj: root, t: 0, life: dur, onDone: () => this.burst(target, new vec4(1, 0.45, 0.1, 1), 30)}
    const ev = this.createEvent("UpdateEvent")
    ev.bind(() => {
      if (!root || fx.t >= dur) { ev.enabled = false; return }
      t = fx.t / dur
      const spiral = Math.sin(t * Math.PI) * 40
      const p = start.add(dir.uniformScale(dist * t)).add(side.uniformScale(Math.cos(t * 18) * spiral)).add(up.uniformScale(Math.sin(t * 18) * spiral + Math.sin(t * Math.PI) * 60))
      tr.setWorldPosition(p)
      tr.setWorldRotation(quat.lookAt(dir, vec3.up()).multiply(quat.angleAxis(t * 20, vec3.forward())))
      if (fx.t - lastPuff > 0.04) {
        lastPuff = fx.t
        const puff = this.block(p.sub(dir.uniformScale(40)), new vec3(14, 14, 14), new vec4(0.85, 0.85, 0.85, 1))
        if (puff) this.fx.push({obj: puff, t: 0, life: 0.6, vel: new vec3((Math.random() - 0.5) * 30, 25, (Math.random() - 0.5) * 30), spin: new vec3(2, 3, 1)})
      }
    })
    this.fx.push(fx)
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
