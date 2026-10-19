// iYiYi WE OUTSIDE (missions + cops & robbers) for Snap Spectacles (this project's one script; the file keeps the template's name
// so the scene's component reference stays wired).
//
// GTA-style jobs in your real room, yard or park, with the laser tag guns in your hand (the app's
// cartoon guns, big bright laser bolts). Places (stash, drop-off, bank, store, getaway car) stand
// around you; a beam marks where to go and the HUD points the way.
//   MISSIONS: a chain of jobs that pays cash: deliver a package (look at it + pinch to grab it,
//   carry it to the drop-off ring), take out a crew of thugs, hold a spot while they rush you, beat
//   the boss. Thugs shoot slow red bolts: step out of the way.
//   COPS & ROBBERS, pick a side:
//     ROBBER: rob the bank (look at the vault and hold a pinch to crack it), grab the loot and get to
//     the getaway car while the cops chase you (wanted stars).
//     COP: dispatch alerts you when a heist starts ("HEIST IN PROGRESS AT THE BANK"); get there and
//     tag the robbers before they reach their car.
// Pinch (right hand) to shoot, left pinch switches gun. Cash is saved on the Specs.
// Solo for now; cops vs robbers with friends through the app comes next.
// Lens Studio preview: click to shoot / grab (walk the camera to move).
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"

const D2R = Math.PI / 180
function hex(h: number): vec4 { return new vec4(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, 1) }
// The iYiYi app's game palette (src/games/studio.js, ST): same colours on the Specs.
const ST = {
  friendly: hex(0x39d5ff), enemy: hex(0xff3d52), objective: hex(0xffb21e), health: hex(0x5cf2a0),
  armor: hex(0x7fb4ff), epic: hex(0xb06cff), night: hex(0xb9a6ff), text: hex(0xf2f4f7),
  muted: new vec4(0.62, 0.64, 0.68, 1), line: new vec4(0.42, 0.46, 0.55, 1), panel: new vec4(0.03, 0.04, 0.055, 0.88),
}
const PAL = [hex(0xff4fa3), ST.friendly, ST.objective, ST.health, ST.epic, hex(0xff7a1a)]
const WHITE = new vec4(1, 1, 1, 1)
// Penguins: the app's Mafia / Beside Them characters. Black is invisible on Specs (additive
// display: dark colours turn see-through), so penguin "black" is a bright navy blue.
const PEN_DARK = new vec4(0.3, 0.4, 0.85, 1)
const PEN_BELLY = new vec4(0.97, 0.97, 1, 1)
const PEN_ORANGE = hex(0xffa21e)

type Fx = {obj: SceneObject; t: number; life: number; vel?: vec3; spin?: vec3; gravity?: boolean; floorY?: number; shrink?: boolean; onDone?: () => void}
type Btn = {obj: SceneObject; text: Text; action: string}
type Penguin = {root: SceneObject; label: Text; bubble: Text; bubbleUntil: number; pos: vec3; face: vec3; walk: number; outfit: SceneObject}

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

const LG = {pal: PAL, text: ST.text, muted: ST.muted, friendly: ST.friendly, objective: ST.objective}

// iYiYi people (every Lens): link your account once, then iYiYi members nearby who allow tagging get
// a name tag over their head, even mid-game. Look at a tag and pinch: their profile, then socials.
const PP_URL = "https://sqsjwcsrgcgcpxccxedp.supabase.co"
const PP_ANON = "sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x"
const PP_STORE = "iyiyi_specs_session_v1"
const PP_LABELS: {[k: string]: string} = {instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", twitter: "X", snapchat: "Snapchat", linkedin: "LinkedIn", whatsapp: "WhatsApp", spotify: "Spotify", soundcloud: "SoundCloud", youtube: "YouTube", discord: "Discord", twitch: "Twitch", telegram: "Telegram"}

type Weapon = {id: string; name: string; color: vec4; gap: number; bolt: number; speed: number; pellets?: number; damage: number}
const WEAPONS: Weapon[] = [
  {id: "pistol", name: "LASER PISTOL", color: new vec4(0.2, 0.9, 1, 1), gap: 260, bolt: 5, speed: 3200, damage: 1},
  {id: "rifle", name: "PULSE RIFLE", color: new vec4(1, 0.3, 0.65, 1), gap: 140, bolt: 4.5, speed: 3800, damage: 1},
  {id: "shotgun", name: "BLASTER", color: new vec4(1, 0.82, 0.2, 1), gap: 700, bolt: 6, speed: 3000, pellets: 5, damage: 2},
]
type Npc = {root: SceneObject; label: Text; pos: vec3; hp: number; kind: string; goal: vec3; nextShot: number; speed: number; alive: boolean; phase: number; scale: number; loot: boolean}
type Shot = {obj: SceneObject; pos: vec3; vel: vec3; life: number}
type Place = {id: string; name: string; pos: vec3; obj: SceneObject}
const CASH_KEY = "iyiyi_missions_cash_v1"

@component
export class IYiYiSpecs extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Unlit material (cloned per colour)")
  blockMaterial: Material

  // ================================================================== shared Specs kit
  // (same helpers in every iYiYi Lens: camera, text, blocks, effects, intro, look-and-pinch menu,
  // penguins)
  private camT: Transform = null
  private camComp: Camera = null
  private cube: RenderMesh = null
  private mats: {[k: string]: Material} = {}
  private fx: Fx[] = []
  private time = 0
  private floorY = -150
  private mode = "intro"
  private modeT = 0
  private introObjs: SceneObject[] = []
  private btns: Btn[] = []
  private hud: Text
  private kicker: Text
  private toastT: Text
  private toastUntil = 0
  private menuTag: SceneObject = null

  /** destroy a scene object if it still exists (effects can destroy things first) */
  private zap(o: SceneObject) { if (o && !isNull(o)) o.destroy() }
  private initKit() {
    this.camT = this.findCamera()
    if (this.blockMaterial) this.cube = this.makeCube()
    this.kicker = this.makeText("", 2.2, ST.friendly).getComponent("Component.Text") as Text
    this.hud = this.makeText("", 3, ST.text).getComponent("Component.Text") as Text
    this.toastT = this.makeText("", 3, ST.objective).getComponent("Component.Text") as Text
    if (this.camT) this.floorY = this.camT.getWorldPosition().y - 150
    this.createEvent("UpdateEvent").bind(() => this.update())
    try {
      SIK.HandInputData.getHand("right").onPinchDown.add(() => this.pinch(true, true))
      SIK.HandInputData.getHand("right").onPinchUp.add(() => this.pinch(true, false))
      SIK.HandInputData.getHand("left").onPinchDown.add(() => this.pinch(false, true))
    } catch (e) { print("iYiYi: hands unavailable " + e) }
    try {
      // Lens Studio preview has no hands: a click picks a menu row or acts like a pinch
      this.createEvent("TapEvent").bind((ev: TapEvent) => {
        const tp = ev.getTapPosition()
        if (this.mode === "menu" && this.camComp) {
          let best: Btn = null, bd = 0.06
          for (const b of this.btns) {
            const sp = this.camComp.worldSpaceToScreenSpace(b.obj.getTransform().getWorldPosition())
            if (Math.abs(sp.y - tp.y) < bd) { bd = Math.abs(sp.y - tp.y); best = b }
          }
          if (best) this.press(best)
          return
        }
        if (this.menuTag && this.camComp && this.mode !== "intro") {
          const sp = this.camComp.worldSpaceToScreenSpace(this.menuTag.getTransform().getWorldPosition())
          if (Math.abs(sp.x - tp.x) < 0.08 && Math.abs(sp.y - tp.y) < 0.05) { this.openMenu(); return }
        }
        this.onTap(tp)
      })
    } catch (e) {}
    this.ppInit()
  }
  /** a menu row: the shared LINK iYiYi row, or the game's own */
  private press(b: Btn) {
    if (b.action === "pplink") { this.ppMenuPress(); b.text.text = this.ppMenuLabel(); return }
    this.runButton(b)
  }

  private pinch(right: boolean, down: boolean) {
    if (this.mode === "intro") { if (down) this.endIntro(); return }
    if (this.mode === "menu") { if (down && right) { const g = this.gazedBtn(); if (g) this.press(g) } return }
    if (down && right && this.menuLookedAt()) { this.openMenu(); return }
    if (down && right && this.ppPinch()) return // looking at an iYiYi person: their profile, mid-game
    this.onPinch(right, down)
  }

  private update() {
    const dt = Math.min(0.05, getDeltaTime())
    this.time += dt
    this.modeT += dt
    this.placeHud()
    if (this.mode === "intro") this.tickIntro(dt)
    else if (this.mode === "menu") this.tickMenu()
    else { this.placeMenuTag(); this.tick(dt) }
    this.tickFx(dt)
    this.ppTick(Date.now())
    if (Date.now() > this.toastUntil) this.toastT.text = ""
  }

  // ------------------------------------------------------------------ camera + text
  private findCamera(): Transform {
    const visit = (o: SceneObject): Transform => {
      const c = o.getComponent("Component.Camera") as Camera
      if (c) { this.camComp = c; return o.getTransform() }
      for (let i = 0; i < o.getChildrenCount(); i++) { const r = visit(o.getChild(i)); if (r) return r }
      return null
    }
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { const r = visit(global.scene.getRootObject(i)); if (r) return r }
    return null
  }
  private camPos(): vec3 { return this.camT ? this.camT.getWorldPosition() : new vec3(0, 0, 0) }
  private viewDir(): vec3 { return this.camT ? this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1)) : new vec3(0, 0, -1) }
  private flatDir(): vec3 { const d = this.viewDir(); const f = new vec3(d.x, 0, d.z); return f.length < 0.001 ? new vec3(0, 0, -1) : f.normalize() }
  private rightOf(d: vec3): vec3 { return quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(d) }
  /** angle (rad) between where you're looking and a point */
  private gazeAngle(p: vec3): number { return Math.acos(Math.max(-1, Math.min(1, p.sub(this.camPos()).normalize().dot(this.viewDir())))) }
  private flatDist(a: vec3, b: vec3): number { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)) }
  /** a point on the floor `cm` away from `from`, `deg` to the right of direction `d` */
  private floorAt(from: vec3, d: vec3, deg: number, cm: number): vec3 {
    const dir = quat.angleAxis(-deg * D2R, vec3.up()).multiplyVec3(d)
    return new vec3(from.x + dir.x * cm, this.floorY, from.z + dir.z * cm)
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
  private panelize(t: Text) { try { t.backgroundSettings.enabled = true; t.backgroundSettings.fill.color = ST.panel } catch (e) {} }
  private toast(s: string, ms: number = 2500) { this.toastT.text = s.toUpperCase(); this.toastUntil = Date.now() + ms }
  private placeHud() {
    if (!this.camT) return
    const cam = this.camPos(), d = this.viewDir(), r = this.camT.getWorldRotation()
    const up = r.multiplyVec3(new vec3(0, 1, 0))
    const put = (t: Text, y: number) => { const tr = t.getSceneObject().getTransform(); tr.setWorldPosition(cam.add(d.uniformScale(85)).add(up.uniformScale(y))); tr.setWorldRotation(r) }
    put(this.kicker, 19)
    put(this.hud, 13.5)
    put(this.toastT, -13)
  }
  /** turn an object (its +Z side) toward you, staying upright */
  private faceCamera(tr: Transform) {
    const v = this.camPos().sub(tr.getWorldPosition()), f = new vec3(v.x, 0, v.z)
    if (f.length > 0.001) tr.setWorldRotation(quat.lookAt(f.normalize(), vec3.up()))
  }
  private faceDir(tr: Transform, d: vec3) { const f = new vec3(d.x, 0, d.z); if (f.length > 0.001) tr.setWorldRotation(quat.lookAt(f.normalize(), vec3.up())) }

  // ------------------------------------------------------------------ blocks + effects
  private makeCube(): RenderMesh {
    const mb = new MeshBuilder([{name: "position", components: 3}, {name: "normal", components: 3}, {name: "texture0", components: 2}])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const faces = [[[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    faces.forEach((f, fi) => {
      for (let k = 0; k < 4; k++) { const v = f[k + 1]; mb.appendVerticesInterleaved([v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, f[0][0], f[0][1], f[0][2], uv[k][0], uv[k][1]]) }
      const b = fi * 4; mb.appendIndices([b, b + 1, b + 2, b, b + 2, b + 3])
    })
    mb.updateMesh()
    return mb.getMesh()
  }
  private mat(c: vec4): Material {
    const k = [c.r, c.g, c.b].map((x) => Math.round(x * 24)).join(",")
    if (!this.mats[k]) { const m = this.blockMaterial.clone(); try { m.mainPass.baseColor = c } catch (e) {} this.mats[k] = m }
    return this.mats[k]
  }
  private block(pos: vec3, size: vec3, c: vec4, parent?: SceneObject): SceneObject {
    if (!this.cube) return null
    const o = global.scene.createSceneObject("iyBlock")
    if (parent) o.setParent(parent)
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mesh = this.cube
    v.mainMaterial = this.mat(c)
    o.getTransform().setWorldPosition(pos)
    o.getTransform().setWorldScale(size)
    return o
  }
  /** a block placed in a parent's local space (parent built at the origin) */
  private part(parent: SceneObject, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4): SceneObject {
    const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), c, parent)
    if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) }
    return o
  }
  private burst(at: vec3, c: vec4, n: number, size: number = 6) {
    for (let i = 0; i < n; i++) {
      const v = new vec3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().uniformScale(150 + Math.random() * 250)
      const o = this.block(at, new vec3(size, size, size), i % 3 === 0 ? WHITE : c)
      if (o) this.fx.push({obj: o, t: 0, life: 0.7, vel: v, spin: new vec3(Math.random() * 6, Math.random() * 6, 0), shrink: true})
    }
  }
  /** someone's out: they collapse into a pile of colourful blocks where they stood */
  private blockPile(at: vec3, tint: vec4, height: number = 120, life: number = 12) {
    for (let i = 0; i < 28; i++) {
      const p = new vec3(at.x + (Math.random() - 0.5) * 34, this.floorY + 15 + Math.random() * height, at.z + (Math.random() - 0.5) * 34)
      const s = 8 + Math.random() * 10
      const o = this.block(p, new vec3(s, s, s), i % 4 === 0 ? tint : PAL[i % PAL.length])
      if (!o) continue
      this.fx.push({obj: o, t: 0, life, vel: new vec3((Math.random() - 0.5) * 110, 30 + Math.random() * 70, (Math.random() - 0.5) * 110), spin: new vec3(Math.random() * 4, Math.random() * 4, Math.random() * 4), gravity: true, floorY: this.floorY + s / 2})
    }
  }
  private tickFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      if (isNull(f.obj)) { this.fx.splice(i, 1); continue }
      f.t += dt
      const tr = f.obj.getTransform()
      if (f.vel) {
        if (f.gravity) f.vel = new vec3(f.vel.x, f.vel.y - 980 * dt, f.vel.z)
        let p = tr.getWorldPosition().add(f.vel.uniformScale(dt))
        if (f.floorY !== undefined && p.y < f.floorY) {
          p = new vec3(p.x, f.floorY, p.z)
          f.vel = new vec3(f.vel.x * 0.45, Math.abs(f.vel.y) * 0.25, f.vel.z * 0.45)
          if (f.spin) f.spin = f.spin.uniformScale(0.5)
        }
        tr.setWorldPosition(p)
      }
      if (f.spin) tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)))
      if (f.shrink) { const s = tr.getWorldScale(); tr.setWorldScale(s.uniformScale(Math.max(0.2, 1 - dt * 1.2))) }
      if (f.t >= f.life) { this.zap(f.obj); this.fx.splice(i, 1); if (f.onDone) f.onDone() }
    }
  }
  private clearFx() { this.fx.forEach((f) => this.zap(f.obj)); this.fx = [] }

  // ------------------------------------------------------------------ intro + menu
  private setMode(m: string) {
    this.mode = m
    this.modeT = 0
    if (m !== "menu") { this.btns.forEach((b) => this.zap(b.obj)); this.btns = [] }
    if (m === "menu" && this.menuTag) { this.zap(this.menuTag); this.menuTag = null }
    this.hud.text = ""
    this.kicker.text = ""
  }
  /** the giant block-letter title logo (see buildLogo), then the menu */
  private startIntro(sub: string) {
    this.setMode("intro")
    if (!this.camT) return
    this.buildLogo(sub)
    this.introProps()
  }
  private tickIntro(dt: number) {
    if (!this.camT) { this.endIntro(); return }
    this.tickLogo(this.modeT)
    if (this.modeT > 5.5) this.endIntro()
  }
  private endIntro() {
    this.destroyLogo()
    this.introObjs.forEach((o) => this.zap(o))
    this.introObjs = []
    this.clearFx()
    this.openMenu()
  }
  // ------------------------------------------------------------------ giant title logo
  // A huge block-letter iYiYi (about 11.5 ft tall) stands 17 m in front of you (so the whole thing fits in the Specs view), the game's name
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
    const d = this.flatDir(), cam = this.camT.getWorldPosition()
    // the Specs camera stops drawing at about 15 m: push the far plane out so the top isn't cut off
    try { if (this.camComp && this.camComp.far < 4000) this.camComp.far = 4000 } catch (e) {}
    this.logoAnchor = new vec3(cam.x + d.x * 1700, this.floorY, cam.z + d.z * 1700)
    this.logoFace = quat.lookAt(d.uniformScale(-1), vec3.up())
    const PX = 50 // 7 rows x 50 cm = 3.5 m (11.5 ft) tall letters
    const letters = ["i", "Y", "i", "Y", "i"], cols = [LG.pal[0], LG.pal[1], LG.pal[2], LG.pal[1], LG.pal[0]]
    const total = 2 + 5 + 2 + 5 + 2 + 4
    let x = -total * PX / 2
    letters.forEach((ch, i) => {
      const w = FONT5[ch][0].length
      this.logoParts.push({obj: this.voxelText(ch, PX, cols[i]), x: x + w * PX / 2, y: 300, delay: 0.15 + i * 0.16, drop: 700})
      x += (w + 1) * PX
    })
    this.logoParts.push({obj: this.voxelText(sub, 17, LG.text), x: 0, y: 160, delay: 1.1, drop: 0})            // game name, ~1.2 m
    this.logoParts.push({obj: this.voxelText("CREATED BY COLIN PHILLIPS", 30 / 7, LG.muted), x: 0, y: 105, delay: 1.8, drop: 0}) // ~1 ft
    // frame: cyan rails with amber corner brackets (the app's game-cover style)
    const f = global.scene.createSceneObject("iyLogoFrame")
    const W = 1240, top = 690, bot = 80, th = 8
    if (this.cube) {
      this.logoPart(f, 0, top, 0, W, th, th, LG.friendly); this.logoPart(f, 0, bot, 0, W, th, th, LG.friendly)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const y = sy > 0 ? top : bot
        this.logoPart(f, sx * (W / 2 - 50), y + sy * 14, 0, 120, 18, 18, LG.objective)
        this.logoPart(f, sx * (W / 2 + 14), y - sy * 50, 0, 18, 120, 18, LG.objective)
      }
      this.logoPart(f, 0, 148, 0, 360, 5, 5, LG.objective) // rule between the name and the credit
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
  private destroyLogo() { this.logoParts.forEach((p) => this.zap(p.obj)); this.logoParts = []; this.logoAnchor = null }
  private openMenu() {
    this.setMode("menu")
    this.onMenuOpen()
    if (!this.camT) return
    const cam = this.camPos(), d = this.flatDir()
    const items = this.menuItems().concat([[this.ppMenuLabel(), "pplink"]])
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 7, ST.text)
      const t = o.getComponent("Component.Text") as Text
      this.panelize(t)
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(210)).add(new vec3(0, 54 - i * 16, 0))) // up to 7 rows inside the Specs view
      tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
      this.btns.push({obj: o, text: t, action})
    })
    this.toast("Look at an option and pinch", 4000)
  }
  private relabel(action: string, label: string) { for (const b of this.btns) if (b.action === action) b.text.text = label }
  private gazedBtn(): Btn {
    let best: Btn = null, ba = 6 * D2R
    for (const b of this.btns) { const a = this.gazeAngle(b.obj.getTransform().getWorldPosition()); if (a < ba) { ba = a; best = b } }
    return best
  }
  private tickMenu() {
    const g = this.gazedBtn()
    for (const b of this.btns) b.text.textFill.color = b === g ? ST.objective : ST.text
  }
  private menuLookedAt(): boolean {
    if (!this.menuTag || !this.camT) return false
    return this.gazeAngle(this.menuTag.getTransform().getWorldPosition()) < 8 * D2R
  }
  /** a small MENU tag low and to the left; look down at it and pinch */
  private placeMenuTag() {
    if (!this.camT) return
    if (!this.menuTag) this.menuTag = this.makeText("≡ MENU", 2.4, ST.muted)
    const cam = this.camPos(), d = this.flatDir()
    const tr = this.menuTag.getTransform()
    tr.setWorldPosition(cam.add(d.uniformScale(70)).add(this.rightOf(d).uniformScale(-40)).add(new vec3(0, -42, 0)))
    tr.setWorldRotation(quat.lookAt(cam.sub(tr.getWorldPosition()).normalize(), vec3.up()))
    ;(this.menuTag.getComponent("Component.Text") as Text).textFill.color = this.menuLookedAt() ? ST.objective : ST.muted
  }

  // ------------------------------------------------------------------ penguins
  /**
   * A blocky penguin like the app's Mafia / Beside Them characters, feet at `pos`, facing +Z.
   * outfit: "vest" (coloured vest + bow tie, the townsperson), "mafia" (pinstripe suit, fedora,
   * red tie, rose), "doctor" (white coat, med kit), "detective" (deerstalker, trench coat,
   * magnifier). `s` scales it (1 = about 1.2 m tall).
   */
  private makePenguin(pos: vec3, outfit: string, color: vec4, name: string, s: number = 1): Penguin {
    const root = global.scene.createSceneObject("iyPenguin")
    const P = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4, par: SceneObject = root) => this.part(par, x * s, y * s, z * s, sx * s, sy * s, sz * s, c)
    P(0, 42, 0, 50, 62, 40, PEN_DARK)              // body
    P(0, 38, 20.5, 34, 46, 2, PEN_BELLY)           // belly
    P(0, 92, 0, 42, 38, 38, PEN_DARK)              // head
    P(0, 90, 19.5, 32, 24, 2, PEN_BELLY)           // face
    P(-7, 95, 21, 6, 8, 1.5, new vec4(0.08, 0.1, 0.18, 1))  // eyes
    P(7, 95, 21, 6, 8, 1.5, new vec4(0.08, 0.1, 0.18, 1))
    P(-6, 97, 21.8, 2, 2, 1, WHITE)                // eye shine
    P(8, 97, 21.8, 2, 2, 1, WHITE)
    P(0, 85, 25, 12, 7, 10, PEN_ORANGE)            // beak
    P(-12, 2.5, 6, 16, 5, 22, PEN_ORANGE)          // feet
    P(12, 2.5, 6, 16, 5, 22, PEN_ORANGE)
    P(-29, 50, 0, 8, 40, 22, PEN_DARK)             // flippers
    P(29, 50, 0, 8, 40, 22, PEN_DARK)
    const outfitObj = global.scene.createSceneObject("iyOutfit")
    outfitObj.setParent(root)
    const peng: Penguin = {root, label: null, bubble: null, bubbleUntil: 0, pos, face: new vec3(0, 0, 1), walk: 0, outfit: outfitObj}
    this.dressPenguin(peng, outfit, color, s)
    const lab = global.scene.createSceneObject("iyPenguinName")
    lab.setParent(root)
    const t = lab.createComponent("Component.Text") as Text
    t.size = 150 * Math.max(0.6, s)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.depthTest = false
    t.text = name.toUpperCase()
    t.textFill.color = ST.text
    lab.getTransform().setLocalPosition(new vec3(0, 140 * s, 0))
    const bub = global.scene.createSceneObject("iyPenguinSay")
    bub.setParent(root)
    const b = bub.createComponent("Component.Text") as Text
    b.size = 120 * Math.max(0.6, s)
    b.horizontalAlignment = HorizontalAlignment.Center
    b.depthTest = false
    b.textFill.color = ST.text
    this.panelize(b)
    bub.getTransform().setLocalPosition(new vec3(0, 175 * s, 0))
    peng.label = t
    peng.bubble = b
    root.getTransform().setWorldPosition(pos)
    return peng
  }
  private dressPenguin(p: Penguin, outfit: string, color: vec4, s: number = 1) {
    for (let i = p.outfit.getChildrenCount() - 1; i >= 0; i--) this.zap(p.outfit.getChild(i))
    const o = p.outfit
    const P = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) => this.part(o, x * s, y * s, z * s, sx * s, sy * s, sz * s, c)
    if (outfit === "vest") {
      P(-15, 46, 20.6, 14, 34, 2, color); P(15, 46, 20.6, 14, 34, 2, color); P(0, 46, -20.6, 50, 34, 2, color)
      P(-25.6, 46, 0, 2, 34, 40, color); P(25.6, 46, 0, 2, 34, 40, color)
      P(0, 50, 22, 3, 3, 1, ST.objective); P(0, 40, 22, 3, 3, 1, ST.objective)        // buttons
      P(-5, 66, 22.5, 8, 6, 3, color); P(5, 66, 22.5, 8, 6, 3, color)                   // bow tie
    } else if (outfit === "mafia") {
      const suit = new vec4(0.5, 0.52, 0.62, 1), stripe = new vec4(0.8, 0.82, 0.9, 1)
      P(0, 40, 0, 54, 58, 44, suit)
      for (const x of [-18, -6, 6, 18]) P(x, 40, 22.2, 1.2, 56, 0.6, stripe)
      P(0, 58, 22.6, 12, 16, 1, PEN_BELLY); P(0, 50, 23.2, 5, 26, 1, ST.enemy)           // shirt + red tie
      P(0, 112, 0, 58, 4, 54, suit); P(0, 122, 0, 40, 18, 38, suit); P(0, 115, 0, 41, 4, 39, ST.enemy) // fedora
      P(34, 52, 12, 6, 6, 6, ST.enemy); P(34, 42, 12, 2, 16, 2, ST.health)               // rose
    } else if (outfit === "doctor") {
      P(0, 38, 0, 55, 54, 44, WHITE); P(0, 52, 23, 18, 22, 1, hex(0x2fd3c0))             // coat + scrubs
      P(-9, 58, 23.4, 2, 18, 1, ST.armor); P(9, 58, 23.4, 2, 18, 1, ST.armor); P(0, 45, 23.6, 6, 6, 1, ST.armor) // stethoscope
      P(-38, 30, 10, 22, 16, 10, ST.enemy); P(-38, 30, 15.5, 10, 3, 1, WHITE); P(-38, 30, 15.5, 3, 10, 1, WHITE) // med kit
    } else if (outfit === "detective") {
      const coat = hex(0xb07a3e), check = hex(0x8a5a2b)
      P(0, 38, 0, 56, 58, 45, coat); P(0, 30, 23, 56, 4, 1, check)                       // trench coat + belt
      P(0, 114, 0, 46, 16, 42, coat); P(0, 109, 24, 40, 4, 12, check); P(0, 109, -24, 40, 4, 12, check) // deerstalker
      P(0, 123, 0, 8, 6, 8, check)
      P(36, 78, 18, 20, 20, 3, ST.objective); P(36, 78, 19.6, 14, 14, 1, hex(0xbfe9ff)); P(36, 62, 18, 4, 14, 3, check) // magnifier
    } else if (outfit === "crew") {
      P(0, 44, 0, 54, 46, 44, color); P(0, 70, 22.6, 30, 6, 1, WHITE)                      // jumpsuit + collar
      P(0, 102, 21.5, 26, 12, 3, hex(0xbfe9ff))                                            // visor
      P(0, 114, 0, 44, 6, 40, color)                                                       // cap
    }
  }
  private say(p: Penguin, s: string, ms: number = 3500) { p.bubble.text = s; p.bubbleUntil = Date.now() + ms }
  /** keep a penguin standing at p.pos, turned toward `look` (or you), waddling while it walks */
  private posePenguin(p: Penguin, look: vec3 = null, dt: number = 0, moving: boolean = false) {
    const tr = p.root.getTransform()
    if (moving) p.walk += dt * 9
    const bob = moving ? Math.abs(Math.sin(p.walk)) * 4 : 0
    tr.setWorldPosition(new vec3(p.pos.x, p.pos.y + bob, p.pos.z))
    const to = look ? look.sub(p.pos) : this.camPos().sub(p.pos)
    const f = new vec3(to.x, 0, to.z)
    if (f.length > 0.001) tr.setWorldRotation(quat.lookAt(f.normalize(), vec3.up()).multiply(quat.angleAxis(moving ? Math.sin(p.walk) * 0.12 : 0, vec3.forward())))
    // name + speech always readable from where you stand
    const face = (o: SceneObject) => { const t = o.getTransform(); const v = this.camPos().sub(t.getWorldPosition()); const ff = new vec3(v.x, 0, v.z); if (ff.length > 0.001) t.setWorldRotation(quat.lookAt(ff.normalize(), vec3.up())) }
    face(p.label.getSceneObject())
    face(p.bubble.getSceneObject())
    if (Date.now() > p.bubbleUntil) p.bubble.text = ""
  }
  /** index of the penguin you're looking at (head/body within a few degrees), or -1 */
  private lookedAtPenguin(list: Penguin[], ok: (i: number) => boolean, maxDeg: number = 9): number {
    let best = -1, ba = 99
    list.forEach((p, i) => {
      if (!p || !ok(i)) return
      const c = p.pos.add(new vec3(0, 60, 0))
      const dist = c.sub(this.camPos()).length
      const a = this.gazeAngle(c)
      if (a < Math.max(maxDeg * D2R, Math.atan(45 / dist)) && a < ba) { ba = a; best = i }
    })
    return best
  }
  /** a tall glowing beam + label marking a spot (waypoint) */
  private makeBeacon(at: vec3, c: vec4, label: string): SceneObject {
    const root = global.scene.createSceneObject("iyBeacon")
    this.part(root, 0, 120, 0, 4, 240, 4, c)
    this.part(root, 0, 1, 0, 70, 2, 70, new vec4(c.r * 0.5, c.g * 0.5, c.b * 0.5, 1))
    this.part(root, 0, 1.5, 0, 50, 2, 50, c)
    const l = global.scene.createSceneObject("iyBeaconLabel")
    l.setParent(root)
    const t = l.createComponent("Component.Text") as Text
    t.size = 80
    t.horizontalAlignment = HorizontalAlignment.Center
    t.depthTest = false
    t.text = label
    t.textFill.color = c
    l.getTransform().setLocalPosition(new vec3(0, 260, 0))
    root.getTransform().setWorldPosition(at)
    return root
  }
  private faceBeacon(b: SceneObject) {
    if (!b) return
    const l = b.getChild(b.getChildrenCount() - 1)
    const t = l.getTransform(), v = this.camPos().sub(t.getWorldPosition()), f = new vec3(v.x, 0, v.z)
    if (f.length > 0.001) t.setWorldRotation(quat.lookAt(f.normalize(), vec3.up()))
  }
  /** "◀ 3.2 m" style direction to a floor point, for the HUD */
  private arrowTo(p: vec3): string {
    const cam = this.camPos(), to = new vec3(p.x - cam.x, 0, p.z - cam.z)
    const m = (to.length / 100).toFixed(1) + " M"
    if (to.length < 60) return "● HERE"
    const f = this.flatDir(), r = this.rightOf(f)
    const ang = Math.atan2(to.normalize().dot(r), to.normalize().dot(f)) / D2R
    if (Math.abs(ang) < 20) return "▲ " + m
    if (Math.abs(ang) > 150) return "▼ BEHIND YOU " + m
    return ang < 0 ? "◀ " + m : m + " ▶"
  }
  // ================================================================== end of shared kit

  // ================================================================== iYiYi people (all games)
  private ppStore: GeneralDataStore = null
  private ppNet: InternetModule = null
  private ppLoc: LocationService = null
  private ppSession: {access_token: string; refresh_token: string; expires_at: number; user_id: string} = null
  private ppPos: {lat: number; lng: number; acc: number} = null
  private ppHeading: number = null
  private ppHeadingAt = 0
  private ppPeople: any[] = []
  private ppLabels: {[id: string]: {obj: SceneObject; text: Text}} = {}
  private ppCard: {id: string; page: string; profile: any} = null
  private ppPanel: Text = null
  private ppLinking = false
  private ppCode: string = null
  private ppSecret = ""
  private ppCodeAt = 0
  private ppNextPoll = 0
  private ppBusy = false
  private ppNextNearby = 0
  private ppRefreshing = false

  private ppInit() {
    try { this.ppStore = global.persistentStorageSystem.store } catch (e) {}
    try { this.ppNet = require("LensStudio:InternetModule") } catch (e) {}
    try { const s = this.ppStore ? this.ppStore.getString(PP_STORE) : ""; if (s) this.ppSession = JSON.parse(s) } catch (e) { this.ppSession = null }
    this.ppPanel = this.makeText("", 3, new vec4(0.95, 0.96, 0.97, 1)).getComponent("Component.Text") as Text
    try { this.ppPanel.backgroundSettings.enabled = true; this.ppPanel.backgroundSettings.fill.color = new vec4(0.03, 0.04, 0.055, 0.9) } catch (e) {}
    try {
      this.ppLoc = GeoLocation.createLocationService()
      this.ppLoc.accuracy = GeoLocationAccuracy.Navigation
      this.ppLoc.onNorthAlignedOrientationUpdate.add((q: quat) => { this.ppHeading = (GeoLocation.getNorthAlignedHeading(q) % 360 + 360) % 360; this.ppHeadingAt = Date.now() })
      const poll = this.createEvent("DelayedCallbackEvent")
      poll.bind(() => {
        if (this.ppSession) this.ppLoc.getCurrentPosition((g) => { this.ppPos = {lat: g.latitude, lng: g.longitude, acc: g.horizontalAccuracy} }, () => {})
        poll.reset(2)
      })
      poll.reset(0.5)
    } catch (e) { print("iYiYi people: location unavailable " + e) }
  }
  /** label for the menu row that links / unlinks your iYiYi account */
  private ppMenuLabel(): string { return this.ppSession ? "iYiYi LINKED · TAP TO UNLINK" : this.ppLinking ? "CANCEL LINKING" : "LINK iYiYi (SEE PEOPLE)" }
  private ppMenuPress() {
    if (this.ppSession) { this.ppSession = null; try { this.ppStore.putString(PP_STORE, "") } catch (e) {} this.toast("iYiYi unlinked") }
    else { this.ppLinking = !this.ppLinking; this.ppCode = null }
  }
  private async ppReq(path: string, method: string, body: any, auth: boolean): Promise<{status: number; data: any}> {
    const headers: any = {"Content-Type": "application/json", apikey: PP_ANON}
    if (auth && this.ppSession) headers.Authorization = "Bearer " + this.ppSession.access_token
    const r = await this.ppNet.fetch(new Request(PP_URL + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}))
    let data: any = null
    try { data = await r.json() } catch (e) { data = null }
    return {status: r.status, data}
  }
  private ppSave(s: any) {
    this.ppSession = {access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user_id: s.user ? s.user.id : this.ppSession && this.ppSession.user_id}
    try { this.ppStore.putString(PP_STORE, JSON.stringify(this.ppSession)) } catch (e) {}
  }
  private async ppRefresh() {
    if (this.ppRefreshing || !this.ppSession) return
    this.ppRefreshing = true
    try {
      const r = await this.ppReq("/auth/v1/token?grant_type=refresh_token", "POST", {refresh_token: this.ppSession.refresh_token}, false)
      if (r.status === 200 && r.data && r.data.access_token) this.ppSave(r.data)
      else if (r.status === 400 || r.status === 401) { this.ppSession = null; try { this.ppStore.putString(PP_STORE, "") } catch (e) {} }
    } catch (e) {}
    this.ppRefreshing = false
  }
  private async ppSha256(s: string): Promise<string> {
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


  private async ppTickLink(now: number) {
    if (this.ppBusy || !this.ppNet) return
    this.ppBusy = true
    try {
      if (!this.ppCode || now - this.ppCodeAt > 9.5 * 60 * 1000) {
        let s = ""
        for (let i = 0; i < 32; i++) s += ("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2)
        this.ppSecret = s
        const r = await this.ppReq("/rest/v1/rpc/glasses_link_start", "POST", {p_secret_hash: await this.ppSha256(this.ppSecret)}, false)
        if (r.status === 200 && typeof r.data === "string") { this.ppCode = r.data; this.ppCodeAt = Date.now(); this.ppNextPoll = Date.now() + 2500 }
        else this.ppPanel.text = "Can't reach iYiYi\nCheck the internet connection"
      } else if (now > this.ppNextPoll) {
        this.ppNextPoll = now + 2500
        const r = await this.ppReq("/functions/v1/glasses-link", "POST", {code: this.ppCode, secret: this.ppSecret}, false)
        if (r.status === 200 && r.data && r.data.token_hash) {
          const v = await this.ppReq("/auth/v1/verify", "POST", {type: "magiclink", token_hash: r.data.token_hash}, false)
          if (v.status === 200 && v.data && v.data.access_token) { this.ppSave(v.data); this.ppLinking = false; this.toast("Linked! iYiYi people now show while you play", 4000) }
        } else if (r.status === 410) this.ppCode = null
      }
    } catch (e) {}
    this.ppBusy = false
  }
  private async ppLoadNearby() {
    if (!this.ppPos || this.ppBusy) return
    this.ppBusy = true
    try {
      const r = await this.ppReq("/rest/v1/rpc/camera_nearby", "POST", {lat: this.ppPos.lat, lng: this.ppPos.lng, radius_m: 60}, true)
      if (r.status === 200 && Array.isArray(r.data)) this.ppPeople = r.data.filter((p: any) => p && typeof p.latitude === "number")
      else if (r.status === 401) this.ppRefresh()
    } catch (e) {}
    this.ppBusy = false
  }
  private ppBearing(lat: number, lng: number) {
    const a = this.ppPos, R = Math.PI / 180
    const y = Math.sin((lng - a.lng) * R) * Math.cos(lat * R)
    const x = Math.cos(a.lat * R) * Math.sin(lat * R) - Math.sin(a.lat * R) * Math.cos(lat * R) * Math.cos((lng - a.lng) * R)
    return (Math.atan2(y, x) / R + 360) % 360
  }
  private ppFresh() { return this.ppHeading !== null && Date.now() - this.ppHeadingAt < 3000 && !!this.ppPos }
  private ppRel(b: number) { return ((b - this.ppHeading) % 360 + 540) % 360 - 180 }
  private ppTick(now: number) {
    if (!this.camT || !this.ppPanel) return
    const cam = this.camT.getWorldPosition(), r = this.camT.getWorldRotation()
    const fwd = r.multiplyVec3(new vec3(0, 0, -1)), up = r.multiplyVec3(new vec3(0, 1, 0))
    const ptr = this.ppPanel.getSceneObject().getTransform()
    ptr.setWorldPosition(cam.add(fwd.uniformScale(80)).add(up.uniformScale(2))); ptr.setWorldRotation(r)
    if (this.ppLinking) {
      this.ppTickLink(now)
      if (this.ppCode) this.ppPanel.text = "LINK iYiYi\n\n" + this.ppCode.split("").join(" ") + "\n\nOn your phone: iYiYi > Settings >\nMeta glasses, type this code"
      else this.ppPanel.text = "LINK iYiYi\n\nMaking a code…"
    } else if (this.ppCard) this.ppDrawCard()
    else this.ppPanel.text = ""
    const seen: {[id: string]: boolean} = {}
    if (this.ppSession) {
      if (now > this.ppSession.expires_at * 1000 - 60000) this.ppRefresh()
      if (now > this.ppNextNearby) { this.ppNextNearby = now + 4000; this.ppLoadNearby() }
      if (this.ppFresh()) {
        const flat = new vec3(fwd.x, 0, fwd.z).length > 0.001 ? new vec3(fwd.x, 0, fwd.z).normalize() : new vec3(0, 0, -1)
        const look = this.ppLooked()
        for (const p of this.ppPeople) {
          seen[p.id] = true
          let l = this.ppLabels[p.id]
          if (!l) { const o = this.makeText("", 6, new vec4(0.22, 0.84, 1, 1)); l = {obj: o, text: o.getComponent("Component.Text") as Text}; this.ppLabels[p.id] = l }
          const m = Math.max(2, p.distance_m || 2)
          const dir = quat.angleAxis(-this.ppRel(this.ppBearing(p.latitude, p.longitude)) * Math.PI / 180, vec3.up()).multiplyVec3(flat)
          const at = new vec3(cam.x + dir.x * m * 100, cam.y + 35 + m * 2, cam.z + dir.z * m * 100)
          const t = l.obj.getTransform()
          t.setWorldPosition(at)
          const to = cam.sub(at), tf = new vec3(to.x, 0, to.z)
          if (tf.length > 0.001) t.setWorldRotation(quat.lookAt(tf.normalize(), vec3.up()))
          const sc = Math.max(1, m / 3); t.setWorldScale(new vec3(sc, sc, sc))
          const hot = look && look.id === p.id
          l.text.text = (hot ? "◎ " : "") + "@" + (p.username || "member") + "\n" + Math.max(5, Math.round(m * 3.28084 / 5) * 5) + " ft"
          l.text.textFill.color = hot || (this.ppCard && this.ppCard.id === p.id) ? new vec4(1, 0.7, 0.12, 1) : new vec4(0.22, 0.84, 1, 1)
          l.obj.enabled = true
        }
      }
    }
    for (const id in this.ppLabels) if (!seen[id]) this.ppLabels[id].obj.enabled = false
  }
  private ppLooked(): any {
    if (!this.ppSession || !this.ppFresh()) return null
    let best: any = null, off = 6
    for (const p of this.ppPeople) { const rel = Math.abs(this.ppRel(this.ppBearing(p.latitude, p.longitude))); if (rel < off) { off = rel; best = p } }
    return best
  }
  /** call first on every pinch: true when it opened / paged / closed a profile card (the game ignores that pinch) */
  private ppPinch(): boolean {
    if (this.ppCard) {
      const soc = this.ppSocials(this.ppCard.profile)
      if (this.ppCard.page === "card" && soc.length) this.ppCard.page = "socials"
      else { this.ppCard = null; this.ppPanel.text = "" }
      return true
    }
    const p = this.ppLooked()
    if (!p) return false
    this.ppOpen(p)
    return true
  }
  private ppSocials(u: any): any[] { return ((u && u.social_links) || []).filter((l: any) => l && l.value && PP_LABELS[l.platform]) }
  private async ppOpen(p: any) {
    this.ppCard = {id: p.id, page: "card", profile: {username: p.username}}
    try {
      const r = await this.ppReq("/functions/v1/api/profiles/" + p.id, "GET", undefined, true)
      if (r.status === 200 && r.data && this.ppCard && this.ppCard.id === p.id) this.ppCard.profile = r.data
    } catch (e) {}
  }
  private ppDrawCard() {
    const c = this.ppCard, u = c.profile || {}, soc = this.ppSocials(u)
    const h = (v: string) => { v = String(v || "").trim(); const m = v.match(/^https?:\/\/[^/]+\/(.+)$/); if (m) v = m[1].split(/[/?#]/).filter(Boolean).pop() || v; return v.replace(/^@/, "") }
    if (c.page === "card") this.ppPanel.text = "@" + (u.username || "") + "\n" + (u.bio ? String(u.bio).slice(0, 80) + "\n" : "") + (soc.length ? "\n" + soc.slice(0, 3).map((l: any) => PP_LABELS[l.platform]).join(" · ") + (soc.length > 3 ? " +" + (soc.length - 3) : "") + "\n\nPinch for socials" : "\nPinch to close")
    else this.ppPanel.text = "@" + (u.username || "") + "\n\n" + soc.slice(0, 7).map((l: any) => PP_LABELS[l.platform] + "   @" + h(l.value)).join("\n") + "\n\nFollow them in iYiYi on your phone\nPinch to close"
  }

  // ================================================================== Missions
  private area = 1 // 0 room, 1 yard, 2 park
  private game = "" // missions | robber | cop
  private places: {[k: string]: Place} = {}
  private start: vec3
  private npcs: Npc[] = []
  private shots: Shot[] = []
  private hp = 5
  private cash = 0
  private earned = 0
  private job = "" // deliver | takeout | hold | boss | heist | escape | patrol | chase | dead
  private jobN = 0
  private jobEnd = 0
  private jobT = 0
  private carry: SceneObject = null
  private pkg: SceneObject = null
  private ring: SceneObject = null
  private beacon: SceneObject = null
  private beaconAt: vec3 = null
  private wanted = 0
  private holding = false
  private crack = 0
  private nextSpawn = 0
  private dispatchAt = 0
  private arrests = 0
  private escaped = 0
  private weaponIdx = 0
  private lastFire = 0
  private gun: SceneObject = null
  private gunFor = ""
  private hitFlash = 0
  private signs: Btn[] = []

  onAwake() {
    this.initKit()
    try { this.cash = global.persistentStorageSystem.store.getFloat(CASH_KEY) || 0 } catch (e) {}
    this.startIntro("WE OUTSIDE")
  }
  private introProps() {
    const d = this.flatDir(), r = this.rightOf(d), cam = this.camPos()
    const car = this.makeCar(ST.objective, false)
    car.getTransform().setWorldPosition(new vec3(cam.x + d.x * 320 - r.x * 250, this.floorY, cam.z + d.z * 320 - r.z * 250))
    car.getTransform().setWorldRotation(quat.lookAt(r, vec3.up()))
    this.introObjs.push(car)
    const start = car.getTransform().getWorldPosition()
    const ev = this.createEvent("UpdateEvent")
    ev.bind(() => { if (this.mode !== "intro") { ev.enabled = false; return } car.getTransform().setWorldPosition(start.add(r.uniformScale(this.modeT * 110))) })
  }
  private onMenuOpen() { this.clearSigns() }
  private menuItems(): [string, string][] {
    const items: [string, string][] = []
    if (this.game && this.job !== "dead") items.push(["RESUME", "resume"])
    items.push(["MISSIONS (JOBS FOR CASH)", "missions"], ["COPS & ROBBERS: ROBBER", "robber"], ["COPS & ROBBERS: COP", "cop"], ["AREA: " + ["ROOM", "YARD", "PARK"][this.area], "area"])
    return items
  }
  private runButton(b: Btn) {
    if (b.action === "area") { this.area = (this.area + 1) % 3; this.relabel("area", "AREA: " + ["ROOM", "YARD", "PARK"][this.area]); this.toast(["Places within about 3 m", "Places within about 8 m", "Places up to about 20 m away"][this.area]); return }
    if (b.action === "resume") { this.setMode("game"); return }
    if (b.action === "again") { this.setMode("game"); this.newGame(this.game); return }
    this.setMode("game")
    this.newGame(b.action)
  }

  // ------------------------------------------------------------------ world
  private R(min: number, max: number) { const k = [1, 2.6, 6][this.area]; return (min + Math.random() * (max - min)) * k }
  private clearGame() {
    this.npcs.forEach((n) => this.zap(n.root)); this.npcs = []
    this.shots.forEach((s) => this.zap(s.obj)); this.shots = []
    for (const k in this.places) this.zap(this.places[k].obj)
    this.places = {}
    for (const o of [this.carry, this.pkg, this.ring, this.beacon]) if (o) this.zap(o)
    this.carry = this.pkg = this.ring = this.beacon = null
    this.beaconAt = null
    this.clearSigns()
    this.clearFx()
  }
  private newGame(mode: string) {
    this.clearGame()
    this.game = mode
    this.hp = 5
    this.earned = 0
    this.jobN = 0
    this.wanted = 0
    this.arrests = this.escaped = 0
    const cam = this.camPos(), d = this.flatDir()
    this.start = new vec3(cam.x, this.floorY, cam.z)
    const spot = (id: string, name: string, ang: number, min: number, max: number, c: vec4, build: (o: SceneObject) => void) => {
      const pos = this.floorAt(this.start, d, ang + (Math.random() - 0.5) * 30, this.R(min, max))
      const o = global.scene.createSceneObject("iyPlace")
      build(o)
      const lab = this.makeText(name, 2.6, c)
      lab.setParent(o)
      lab.getTransform().setLocalPosition(new vec3(0, 150, 0))
      o.getTransform().setWorldPosition(pos)
      const v = this.start.sub(pos), f = new vec3(v.x, 0, v.z)
      if (f.length > 1) o.getTransform().setWorldRotation(quat.lookAt(f.normalize(), vec3.up()))
      this.places[id] = {id, name, pos, obj: o}
    }
    spot("bank", "BANK", -40, 180, 300, ST.objective, (o) => {
      this.part(o, 0, 50, 0, 80, 100, 40, hex(0xc9a227)); this.part(o, 0, 55, 20.5, 50, 50, 1, ST.text); this.part(o, 0, 55, 21.5, 12, 12, 2, ST.objective) // vault door + dial
      this.part(o, 0, 105, 0, 100, 10, 50, ST.muted)
    })
    spot("getaway", "GETAWAY", 140, 200, 320, ST.objective, (o) => { const car = this.makeCar(ST.objective, false); car.setParent(o) })
    spot("store", "STORE", 60, 150, 280, ST.health, (o) => { this.part(o, 0, 45, 0, 90, 90, 50, ST.line); this.part(o, 0, 95, 0, 100, 12, 60, ST.health); this.part(o, 0, 50, 25.5, 60, 40, 1, ST.friendly) })
    spot("stash", "STASH", -110, 120, 260, ST.epic, (o) => { this.part(o, 0, 20, 0, 70, 40, 50, ST.epic); this.part(o, 0, 42, 0, 74, 4, 54, ST.muted) })
    spot("drop", "DROP-OFF", 100, 160, 300, ST.health, (o) => { this.part(o, 0, 1, 0, 160, 2, 160, new vec4(0.1, 0.4, 0.25, 1)) })
    if (mode === "missions") this.nextJob()
    else if (mode === "robber") this.startHeist()
    else { this.job = "patrol"; this.dispatchAt = Date.now() + 5000; this.toast("COP ON PATROL · wait for dispatch", 4000) }
  }
  private makeCar(c: vec4, cop: boolean): SceneObject {
    const o = global.scene.createSceneObject("iyCar")
    const body = cop ? ST.text : c
    this.part(o, 0, 35, 0, 90, 40, 190, body)                       // body
    this.part(o, 0, 70, -10, 80, 34, 100, cop ? ST.armor : new vec4(c.r * 0.8, c.g * 0.8, c.b * 0.8, 1)) // cabin
    this.part(o, 0, 72, 40.5, 70, 26, 1, hex(0xbfe9ff))              // windshield
    for (const x of [-46, 46]) for (const z of [-60, 60]) this.part(o, x, 16, z, 10, 32, 32, ST.line) // wheels
    this.part(o, -30, 38, 95.5, 16, 10, 1, WHITE); this.part(o, 30, 38, 95.5, 16, 10, 1, WHITE) // headlights
    if (cop) { this.part(o, -14, 90, -10, 24, 8, 14, ST.enemy); this.part(o, 14, 90, -10, 24, 8, 14, TEAM_BLUE()) }
    return o
  }
  /** a blocky person: thug (red bandana), cop (blue, cap, badge), robber (striped, mask), boss */
  private makeNpc(kind: string, pos: vec3, hp: number): Npc {
    const root = global.scene.createSceneObject("iyNpc")
    const s = kind === "boss" ? 1.35 : 1
    const P = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) => this.part(root, x * s, y * s, z * s, sx * s, sy * s, sz * s, c)
    const skin = new vec4(1, 0.86, 0.7, 1)
    const col = kind === "cop" ? hex(0x3b6dff) : kind === "robber" ? ST.text : kind === "boss" ? ST.epic : hex(0xff7a1a)
    const legs = kind === "cop" ? hex(0x2a3f8f) : ST.line
    P(0, 165, 0, 30, 30, 30, skin)
    P(-7, 170, 15.5, 5, 5, 1, new vec4(0.1, 0.1, 0.1, 1)); P(7, 170, 15.5, 5, 5, 1, new vec4(0.1, 0.1, 0.1, 1))
    P(0, 115, 0, 40, 55, 24, col)
    if (kind === "robber") { for (const y of [100, 115, 130]) P(0, y, 0, 41, 5, 25, ST.line); P(0, 168, 15.6, 31, 9, 1, ST.line) } // stripes + mask
    if (kind === "cop") { P(0, 182, 2, 33, 8, 36, hex(0x2a3f8f)); P(0, 180, 18, 34, 3, 8, hex(0x2a3f8f)); P(-10, 128, 12.5, 7, 8, 1, ST.objective) } // cap + badge
    if (kind === "thug" || kind === "boss") { P(0, 158, 15.6, 31, 10, 1, ST.enemy); P(0, 182, 0, 32, 6, 32, kind === "boss" ? ST.objective : ST.line) } // bandana + beanie / crown
    P(-28, 118, 0, 12, 48, 12, col); P(28, 118, 0, 12, 48, 12, col)
    P(-11, 55, 0, 15, 70, 15, legs); P(11, 55, 0, 15, 70, 15, legs)
    P(28, 92, 14, 6, 6, 22, kind === "cop" ? ST.friendly : ST.enemy) // their gun
    const lab = global.scene.createSceneObject("iyNpcName")
    lab.setParent(root)
    const t = lab.createComponent("Component.Text") as Text
    t.size = 80
    t.horizontalAlignment = HorizontalAlignment.Center
    t.depthTest = false
    t.textFill.color = kind === "cop" ? ST.armor : ST.enemy
    t.text = kind.toUpperCase()
    lab.getTransform().setLocalPosition(new vec3(0, 215 * s, 0))
    root.getTransform().setWorldPosition(pos)
    return {root, label: t, pos, hp, kind, goal: null, nextShot: Date.now() + 2000 + Math.random() * 2000, speed: kind === "robber" ? 110 : 75, alive: true, phase: Math.random() * 6, scale: s, loot: false}
  }
  private spawnAt(kind: string, hp: number, near: vec3 = null): Npc {
    const d = this.flatDir()
    const pos = near ? new vec3(near.x + (Math.random() - 0.5) * 120, this.floorY, near.z + (Math.random() - 0.5) * 120) : this.floorAt(this.camPos(), d, (Math.random() - 0.5) * 160, this.R(250, 400))
    const n = this.makeNpc(kind, pos, hp)
    this.npcs.push(n)
    return n
  }
  private setBeacon(at: vec3, c: vec4, label: string) {
    if (this.beacon) this.zap(this.beacon)
    this.beacon = at ? this.makeBeacon(at, c, label) : null
    this.beaconAt = at
  }

  // ------------------------------------------------------------------ jobs
  private nextJob() {
    this.jobN++
    const kinds = ["deliver", "takeout", "hold", "boss"]
    this.job = kinds[(this.jobN - 1) % 4]
    const lvl = Math.floor((this.jobN - 1) / 4)
    this.jobT = 0
    if (this.job === "deliver") {
      const st = this.places["stash"]
      this.pkg = this.block(st.pos.add(new vec3(0, 62, 0)), new vec3(30, 30, 30), ST.objective)
      this.setBeacon(st.pos, ST.epic, "PACKAGE")
      this.jobEnd = Date.now() + (40 + this.area * 25) * 1000
      this.toast("JOB " + this.jobN + ": grab the package from the STASH", 4000)
    } else if (this.job === "takeout") {
      for (let i = 0; i < 3 + lvl; i++) this.spawnAt("thug", 2)
      this.setBeacon(null, ST.enemy, "")
      this.jobEnd = 0
      this.toast("JOB " + this.jobN + ": take out the crew", 4000)
    } else if (this.job === "hold") {
      const st = this.places["store"]
      this.ring = global.scene.createSceneObject("iyRing")
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; this.part(this.ring, Math.cos(a) * 110, 2, Math.sin(a) * 110, 30, 4, 10, ST.health) }
      this.ring.getTransform().setWorldPosition(st.pos.add(this.places["store"].obj.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, 170))))
      this.setBeacon(this.ring.getTransform().getWorldPosition(), ST.health, "HOLD")
      this.jobEnd = 0
      this.nextSpawn = Date.now() + 3000
      this.toast("JOB " + this.jobN + ": hold the spot by the STORE for 30 s", 4000)
    } else {
      const b = this.spawnAt("boss", 10 + lvl * 4)
      b.label.text = "BOSS"
      this.spawnAt("thug", 2)
      this.setBeacon(null, ST.enemy, "")
      this.toast("JOB " + this.jobN + ": BEAT THE BOSS", 4000)
    }
  }
  private payout(n: number, why: string) {
    this.cash += n
    this.earned += n
    try { global.persistentStorageSystem.store.putFloat(CASH_KEY, this.cash) } catch (e) {}
    this.toast(why + "  +$" + n, 3500)
    for (let k = 0; k < 3; k++) this.burst(this.camPos().add(this.flatDir().uniformScale(150)).add(new vec3((k - 1) * 40, 20, 0)), ST.health, 16)
  }
  private jobDone(n: number, why: string) {
    this.payout(n, why)
    this.setBeacon(null, ST.text, "")
    if (this.ring) { this.zap(this.ring); this.ring = null }
    this.job = "between"
    this.jobEnd = Date.now() + 3500
  }
  private startHeist() {
    this.job = "heist"
    this.crack = 0
    this.wanted = 0
    this.setBeacon(this.places["bank"].pos, ST.objective, "BANK")
    this.toast("ROB THE BANK: look at the vault and HOLD a pinch", 4500)
  }
  private dispatch() {
    const where = Math.random() < 0.5 ? "bank" : "store"
    const p = this.places[where]
    this.job = "chase"
    this.toast("DISPATCH: " + (where === "bank" ? "HEIST IN PROGRESS AT THE BANK!" : "ROBBERY AT THE STORE!"), 5000)
    this.setBeacon(p.pos, ST.enemy, "ALERT: " + p.name)
    const n = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < n; i++) {
      const r = this.spawnAt("robber", 2, p.pos)
      r.loot = true
      r.goal = this.places["getaway"].pos
      r.nextShot = Date.now() + 4000 + Math.random() * 3000
    }
  }

  // ------------------------------------------------------------------ input
  private onPinch(right: boolean, down: boolean) {
    if (!right) { if (down) this.switchWeapon(); return }
    if (!down) { this.holding = false; return }
    this.holding = true
    const s = this.gazedSign()
    if (s) { this.runButton(s); return }
    this.act()
  }
  private onTap(tp: vec2) {
    if (this.camComp) for (const s of this.signs) {
      const sp = this.camComp.worldSpaceToScreenSpace(s.obj.getTransform().getWorldPosition())
      if (Math.abs(sp.x - tp.x) < 0.09 && Math.abs(sp.y - tp.y) < 0.05) { this.runButton(s); return }
    }
    if (this.job === "heist" && this.nearPlace("bank", 200)) { this.crack += 0.25; return }
    this.act()
  }
  private nearPlace(id: string, cm: number) { const p = this.places[id]; return p && this.flatDist(p.pos, this.camPos()) < cm }
  private act() {
    if (this.job === "dead") return
    // grab the package
    if (this.pkg && !this.carry && this.flatDist(this.pkg.getTransform().getWorldPosition(), this.camPos()) < 170 && this.gazeAngle(this.pkg.getTransform().getWorldPosition()) < 18 * D2R) {
      this.zap(this.pkg); this.pkg = null
      this.carry = this.block(this.camPos(), new vec3(22, 22, 22), ST.objective)
      this.setBeacon(this.places["drop"].pos, ST.health, "DROP-OFF")
      this.toast("Got it! Take it to the DROP-OFF")
      return
    }
    if (this.job === "heist" && this.nearPlace("bank", 200)) return // cracking uses the hold
    this.fire()
  }

  // ------------------------------------------------------------------ guns
  private currentWeapon(): Weapon { return WEAPONS[this.weaponIdx % WEAPONS.length] }
  private switchWeapon() { this.weaponIdx = (this.weaponIdx + 1) % WEAPONS.length; this.toast(this.currentWeapon().name) }
  private fire() {
    const now = Date.now(), w = this.currentWeapon()
    if (now - this.lastFire < w.gap) return
    this.lastFire = now
    const cam = this.camPos(), d = this.viewDir()
    let best: Npc = null, ba = 99
    for (const n of this.npcs) {
      if (!n.alive) continue
      const c = n.pos.add(new vec3(0, 110 * n.scale, 0)), to = c.sub(cam), dist = to.length
      const a = Math.acos(Math.max(-1, Math.min(1, to.normalize().dot(d))))
      if (a < Math.atan((50 * n.scale) / dist) + (w.pellets ? 4 * D2R : 0) && a < ba) { ba = a; best = n }
    }
    const to = best ? best.pos.add(new vec3(0, 110 * best.scale, 0)) : cam.add(d.uniformScale(2500))
    const muzzle = this.gunMuzzle() || cam.add(d.uniformScale(30)).add(new vec3(0, -12, 0))
    for (let i = 0; i < (w.pellets || 1); i++) {
      let dir = to.sub(muzzle).normalize()
      if (w.pellets) dir = dir.add(new vec3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08)).normalize()
      this.spawnBolt(muzzle, dir, w.bolt, w.color, w.speed, 0.9)
    }
    if (!best) return
    const n = best
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => {
      if (!n.alive) return
      n.hp -= w.damage
      this.burst(n.pos.add(new vec3(0, 110 * n.scale, 0)), w.color, 8)
      if (n.hp <= 0) this.down(n)
    })
    ev.reset(Math.min(1.2, to.sub(cam).length / w.speed))
  }
  private down(n: Npc) {
    n.alive = false
    this.blockPile(n.pos, n.kind === "cop" ? hex(0x3b6dff) : n.kind === "robber" ? ST.text : ST.enemy, 140 * n.scale, 8)
    this.zap(n.root)
    this.npcs = this.npcs.filter((x) => x !== n)
    if (n.kind === "robber" && this.game === "cop") { this.arrests++; this.payout(250, "ROBBER TAGGED") }
    if (n.kind === "thug") this.cash += 0
  }
  private tickGun() {
    let hand: any = null
    try { hand = SIK.HandInputData.getHand("right") } catch (e) {}
    const w = this.currentWeapon()
    if (!hand || !hand.isTracked() || !this.cube || this.mode !== "game") { if (this.gun) this.gun.enabled = false; return }
    if (!this.gun || this.gunFor !== w.id) { if (this.gun) this.zap(this.gun); this.gun = this.makeGun(w); this.gunFor = w.id }
    this.gun.enabled = !this.carry
    const wrist = hand.wrist.position, knuckle = hand.indexKnuckle.position
    const tr = this.gun.getTransform()
    tr.setWorldPosition(knuckle.add(new vec3(0, -3, 0)))
    tr.setWorldRotation(quat.lookAt(knuckle.sub(wrist).normalize(), vec3.up()))
  }
  private gunMuzzle(): vec3 {
    if (!this.gun || !this.gun.enabled) return null
    const tr = this.gun.getTransform()
    return tr.getWorldPosition().add(tr.forward.uniformScale(26))
  }
  /** the app's chunky cartoon guns (forward = +Z) */
  private makeGun(w: Weapon): SceneObject {
    const root = global.scene.createSceneObject("iyGun")
    const c = w.color, dark = new vec4(0.15, 0.17, 0.22, 1)
    if (w.id === "shotgun") { this.part(root, 0, 2, 6, 6, 6, 20, c); this.part(root, 0, 2, 18, 7, 7, 6, dark); this.part(root, 0, -4, 0, 3.5, 8, 3.5, dark) }
    else if (w.id === "rifle") { this.part(root, 0, 2, 6, 4, 6, 22, c); this.part(root, 0, 2.5, 19, 2, 2, 10, dark); this.part(root, 0, -2, 8, 3, 6, 3, dark); this.part(root, 0, -4, 0, 3, 8, 3, dark) }
    else { this.part(root, 0, 2, 4, 4, 6, 14, c); this.part(root, 0, 2.5, 12, 2, 2, 5, dark); this.part(root, 0, -4, 0, 3.5, 8, 3.5, dark) }
    return root
  }
  /** big bright laser bolt: white core in a coloured glow */
  private spawnBolt(start: vec3, dir: vec3, s: number, c: vec4, speed: number, life: number) {
    for (const [sz, col, len] of [[s, WHITE, 60], [s * 2.6, c, 75]] as [number, vec4, number][]) {
      const o = this.block(start, new vec3(sz, sz, len), col)
      if (!o) continue
      o.getTransform().setWorldRotation(quat.lookAt(dir, vec3.up()))
      this.fx.push({obj: o, t: 0, life, vel: dir.uniformScale(speed)})
    }
  }

  // ------------------------------------------------------------------ enemies
  private tickNpcs(dt: number) {
    const cam = this.camPos(), now = Date.now()
    const me = new vec3(cam.x, this.floorY, cam.z)
    for (const n of this.npcs.slice()) {
      if (!n.alive) continue
      n.phase += dt
      let goal = n.goal
      if (n.kind !== "robber") {
        // keep a fighting distance from you and strafe
        const want = this.R(220, 320)
        const to = me.sub(n.pos), dist = to.length
        const side = this.rightOf(to.normalize()).uniformScale(Math.sin(n.phase * 0.7) * 80)
        goal = dist > want ? n.pos.add(to.normalize().uniformScale(dist - want)).add(side) : n.pos.add(side)
      }
      if (goal) {
        const to = new vec3(goal.x - n.pos.x, 0, goal.z - n.pos.z)
        if (to.length > 5) n.pos = n.pos.add(to.normalize().uniformScale(Math.min(to.length, n.speed * dt)))
        // a robber reached the car
        if (n.kind === "robber" && this.flatDist(n.pos, this.places["getaway"].pos) < 90) {
          n.alive = false
          this.zap(n.root)
          this.npcs = this.npcs.filter((x) => x !== n)
          this.escaped++
          this.toast("A ROBBER GOT AWAY!", 3000)
          continue
        }
      }
      const tr = n.root.getTransform()
      tr.setWorldPosition(new vec3(n.pos.x, this.floorY + Math.abs(Math.sin(n.phase * 6)) * 4, n.pos.z))
      if (n.kind === "robber" && goal) this.faceDir(tr, goal.sub(n.pos)); else this.faceCamera(tr)
      const lt = n.label.getSceneObject().getTransform(), lv = cam.sub(lt.getWorldPosition())
      if (new vec3(lv.x, 0, lv.z).length > 1) lt.setWorldRotation(quat.lookAt(new vec3(lv.x, 0, lv.z).normalize(), vec3.up()))
      n.label.text = n.kind.toUpperCase() + "  " + "♥".repeat(Math.max(0, Math.min(10, n.hp)))
      // shoot at you: slow red (or blue) bolts you can step away from
      if (now > n.nextShot && this.job !== "dead") {
        n.nextShot = now + (n.kind === "boss" ? 1400 : 2400) + Math.random() * 1500
        const from = n.pos.add(new vec3(0, 115 * n.scale, 0))
        const aim = cam.add(new vec3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30))
        const dir = aim.sub(from).normalize()
        const speed = 260 + this.area * 60
        const c = n.kind === "cop" ? hex(0x3b6dff) : ST.enemy
        const o = global.scene.createSceneObject("iyEnemyShot")
        this.part(o, 0, 0, 0, 7, 7, 40, WHITE)
        this.part(o, 0, 0, 0, 16, 16, 52, c)
        o.getTransform().setWorldPosition(from)
        o.getTransform().setWorldRotation(quat.lookAt(dir, vec3.up()))
        this.shots.push({obj: o, pos: from, vel: dir.uniformScale(speed), life: 6})
      }
    }
    for (const s of this.shots.slice()) {
      s.life -= dt
      s.pos = s.pos.add(s.vel.uniformScale(dt))
      s.obj.getTransform().setWorldPosition(s.pos)
      if (s.pos.sub(cam).length < 28 && this.job !== "dead") { this.gotHit(); s.life = 0 }
      if (s.life <= 0 || s.pos.y < this.floorY) { this.zap(s.obj); this.shots = this.shots.filter((x) => x !== s) }
    }
  }
  private gotHit() {
    this.hp--
    this.hitFlash = 0.4
    this.burst(this.camPos().add(this.viewDir().uniformScale(45)), ST.enemy, 10, 3)
    if (this.hp <= 0) {
      this.job = "dead"
      this.toast("WASTED · you earned $" + this.earned, 15000)
      this.setBeacon(null, ST.text, "")
      this.addSign("PLAY AGAIN", "again", ST.objective)
    } else this.toast("HIT!  ♥ " + this.hp, 1200)
  }

  // ------------------------------------------------------------------ signs
  private addSign(label: string, action: string, c: vec4) {
    const o = this.makeText(label, 4.5, c)
    const t = o.getComponent("Component.Text") as Text
    this.panelize(t)
    const d = this.flatDir(), tr = o.getTransform()
    tr.setWorldPosition(this.camPos().add(d.uniformScale(110)).add(new vec3(0, -38, 0)))
    tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
    this.signs.push({obj: o, text: t, action})
  }
  private clearSigns() { this.signs.forEach((s) => this.zap(s.obj)); this.signs = [] }
  private gazedSign(): Btn { for (const s of this.signs) if (this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R) return s; return null }

  // ------------------------------------------------------------------ per frame
  private tick(dt: number) {
    this.tickGun()
    if (!this.game) return
    const now = Date.now(), cam = this.camPos()
    this.tickNpcs(dt)
    for (const k in this.places) { const o = this.places[k].obj; const l = o.getChild(o.getChildrenCount() - 1).getTransform(); const v = cam.sub(l.getWorldPosition()); const f = new vec3(v.x, 0, v.z); if (f.length > 1) l.setWorldRotation(quat.lookAt(f.normalize(), vec3.up())) }
    this.faceBeacon(this.beacon)
    for (const s of this.signs) s.text.textFill.color = this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R ? ST.objective : ST.text
    if (this.carry) { const tr = this.carry.getTransform(); const d = this.flatDir(); tr.setWorldPosition(cam.add(d.uniformScale(45)).add(this.rightOf(d).uniformScale(-18)).add(new vec3(0, -32, 0))); tr.setWorldRotation(quat.lookAt(d, vec3.up())) }
    if (this.pkg) { const tr = this.pkg.getTransform(); tr.setWorldRotation(quat.angleAxis(this.time * 1.5, vec3.up())) }
    // jobs
    let line = ""
    if (this.job === "deliver") {
      if (this.carry && this.flatDist(this.places["drop"].pos, cam) < 90) { this.zap(this.carry); this.carry = null; this.jobDone(300 + this.jobN * 50, "DELIVERED") }
      else {
        const left = Math.max(0, Math.ceil((this.jobEnd - now) / 1000))
        line = (this.carry ? "DELIVER TO DROP-OFF " : "GRAB THE PACKAGE ") + this.arrowTo(this.beaconAt) + "   " + left + "s"
        if (left <= 0) { this.toast("TOO SLOW · job failed", 3000); if (this.carry) { this.zap(this.carry); this.carry = null } if (this.pkg) { this.zap(this.pkg); this.pkg = null } this.setBeacon(null, ST.text, ""); this.job = "between"; this.jobEnd = now + 3000; this.jobN-- }
      }
    } else if (this.job === "takeout" || this.job === "boss") {
      const left = this.npcs.filter((n) => n.alive).length
      line = (this.job === "boss" ? "BEAT THE BOSS" : "THUGS LEFT: " + left)
      if (left === 0) this.jobDone(this.job === "boss" ? 1000 : 400, this.job === "boss" ? "BOSS DOWN" : "CREW CLEARED")
    } else if (this.job === "hold") {
      const rp = this.ring.getTransform().getWorldPosition()
      const inside = this.flatDist(rp, cam) < 110
      if (inside) this.jobT += dt
      if (now > this.nextSpawn && this.npcs.length < 4) { this.spawnAt("thug", 2); this.nextSpawn = now + 6000 }
      line = (inside ? "HOLDING " : "GET IN THE RING " + this.arrowTo(rp) + "  ") + Math.floor(this.jobT) + " / 30s"
      if (this.jobT >= 30) { this.npcs.forEach((n) => { n.alive = false; this.blockPile(n.pos, ST.enemy, 140, 6); this.zap(n.root) }); this.npcs = []; this.jobDone(500, "SPOT HELD") }
    } else if (this.job === "between") {
      line = "NEXT JOB…"
      if (now > this.jobEnd) { if (this.game === "missions") this.nextJob(); else if (this.game === "robber") this.startHeist(); else { this.job = "patrol"; this.dispatchAt = now + 7000 } }
    } else if (this.job === "heist") {
      const bank = this.places["bank"]
      const near = this.flatDist(bank.pos, cam) < 200
      if (near && this.holding && this.gazeAngle(bank.pos.add(new vec3(0, 55, 0))) < 25 * D2R) this.crack += dt / 4
      line = near ? "CRACKING THE VAULT " + Math.round(Math.min(1, this.crack) * 100) + "%  (look + hold pinch)" : "GO TO THE BANK " + this.arrowTo(bank.pos)
      if (this.crack >= 1) {
        this.job = "escape"
        this.wanted = 3
        this.carry = this.block(cam, new vec3(26, 26, 26), ST.health)
        this.burst(bank.pos.add(new vec3(0, 60, 0)), ST.objective, 30)
        this.setBeacon(this.places["getaway"].pos, ST.objective, "GETAWAY")
        this.toast("ALARM! ★★★ Get to the GETAWAY car!", 4000)
        this.nextSpawn = now + 1500
      }
    } else if (this.job === "escape") {
      if (now > this.nextSpawn && this.npcs.length < 2 + this.wanted) { this.spawnAt("cop", 2); this.nextSpawn = now + 5000 }
      line = "★".repeat(this.wanted) + "☆".repeat(5 - this.wanted) + "  GETAWAY " + this.arrowTo(this.places["getaway"].pos)
      if (this.flatDist(this.places["getaway"].pos, cam) < 140) {
        if (this.carry) { this.zap(this.carry); this.carry = null }
        this.npcs.forEach((n) => this.zap(n.root)); this.npcs = []
        this.shots.forEach((s) => this.zap(s.obj)); this.shots = []
        this.wanted = 0
        this.jobDone(1500, "CLEAN GETAWAY")
      }
    } else if (this.job === "patrol") {
      line = "ON PATROL · waiting for dispatch"
      if (now > this.dispatchAt) this.dispatch()
    } else if (this.job === "chase") {
      const left = this.npcs.filter((n) => n.alive && n.kind === "robber").length
      line = "ROBBERS: " + left + "  " + (this.beaconAt ? this.arrowTo(this.beaconAt) : "")
      if (left === 0) { this.setBeacon(null, ST.text, ""); this.toast(this.escaped ? "Some got away · " + this.arrests + " tagged" : "ALL ROBBERS TAGGED", 3500); this.job = "between"; this.jobEnd = now + 3000 }
    } else if (this.job === "dead") line = "WASTED"
    const title = this.game === "missions" ? "WE OUTSIDE · JOB " + this.jobN : this.game === "robber" ? "COPS & ROBBERS · ROBBER" : "COPS & ROBBERS · COP"
    this.kicker.text = "iYiYi · " + title
    this.hud.text = "♥".repeat(Math.max(0, this.hp)) + "   $" + Math.round(this.cash) + "   " + this.currentWeapon().name + "\n" + line
    if (this.hitFlash > 0) { this.hitFlash -= dt; this.hud.textFill.color = ST.enemy } else this.hud.textFill.color = ST.text
  }
}
function TEAM_BLUE(): vec4 { return hex(0x3b6dff) }
