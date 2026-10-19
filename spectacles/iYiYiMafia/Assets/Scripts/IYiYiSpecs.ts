// iYiYi MAFIA for Snap Spectacles (this project's one script; the file keeps the template's name so
// the scene's component reference stays wired).
//
// The app's Mafia, around you in your room: the town penguins (the app's characters, built from
// blocks) stand in a half circle in front of you. You get a secret role: Town, Mafia, Doctor or
// Detective (a big penguin in that outfit shows you which).
//   Night: the moon comes up. Mafia: look at a penguin and pinch to pick who goes. Doctor: pick
//   who to save (or the SAVE MYSELF sign). Detective: pick someone to investigate (only you see
//   the answer). Town: sleep.
//   Morning: who went down last night (they collapse into a pile of colourful blocks) and their
//   role, or "the doctor saved someone".
//   Day: the penguins talk it out in speech bubbles (accusations, defences, detective claims).
//   Look at a penguin and pinch to accuse them. Then the vote: look and pinch to vote, or SKIP.
//   Most votes is out (a tie or Skip on top: nobody).
// Town wins when every Mafia is out; Mafia wins when they equal the Town.
// Same rules as the app (src/games/MafiaGame.js): Mafia can't target Mafia, the Doctor can't save
// the same player two nights running, one private Detective result per night.
// Solo with computer penguins for now; playing with friends through the app comes next.
// Lens Studio preview: click a penguin / sign (no hands in preview).
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

const NAMES = ["PIP", "WADDLES", "TUX", "NOOT", "FLAPPY", "ICEY", "CHILLY", "SLIDE", "POPPY", "BIRDIE", "FROSTY"]
const ROLE_NAME: {[k: string]: string} = {town: "TOWNSPERSON", mafia: "MAFIA", doctor: "DOCTOR", detective: "DETECTIVE"}
const ROLE_OUTFIT: {[k: string]: string} = {town: "vest", mafia: "mafia", doctor: "doctor", detective: "detective"}
const ROLE_DESC: {[k: string]: string} = {
  town: "Find the Mafia and vote them out.",
  mafia: "Each night, pick someone to eliminate. Don't get caught.",
  doctor: "Each night, save one player (not the same one twice in a row).",
  detective: "Each night, investigate one player. Only you see the answer.",
}
const ROLE_COLOR: {[k: string]: vec4} = {town: ST.friendly, mafia: ST.enemy, doctor: ST.health, detective: ST.objective}
type Pl = {name: string; role: string; alive: boolean; you: boolean; peng: Penguin; sus: number[]; color: vec4; checked: {[k: number]: string}; claimed: boolean; vote: number}

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

  // ================================================================== Mafia
  private count = 8
  private bigCircle = false
  private pl: Pl[] = []
  private phase = ""
  private phaseEnd = 0
  private day = 0
  private myPick = -1
  private lastSaved = -1
  private cpuLastSaved = -1
  private nightKill = -1
  private nightSave = -1
  private talkAt = 0
  private signs: Btn[] = []
  private sky: SceneObject = null
  private reveal: Penguin = null
  private center: vec3
  private winner = ""
  private votes: number[] = []

  onAwake() {
    this.initKit()
    this.startIntro("MAFIA")
  }
  private introProps() {
    // the four characters rise up in front of you under the logo
    const d = this.flatDir(), r = this.rightOf(d), cam = this.camPos()
    ;["vest", "mafia", "doctor", "detective"].forEach((o, i) => {
      const at = cam.add(d.uniformScale(260)).add(r.uniformScale((i - 1.5) * 60))
      const p = this.makePenguin(new vec3(at.x, this.floorY, at.z), o, ST.friendly, "", 0.6)
      this.introObjs.push(p.root)
      const ev = this.createEvent("UpdateEvent")
      ev.bind(() => {
        if (this.mode !== "intro") { ev.enabled = false; return }
        const k = Math.max(0, Math.min(1, (this.modeT - 1.2 - i * 0.2) / 0.5))
        p.pos = new vec3(at.x, this.floorY - 90 * (1 - k) + Math.abs(Math.sin(this.modeT * 4 + i)) * 4 * k, at.z)
        this.posePenguin(p)
      })
    })
  }
  private onMenuOpen() { this.clearSigns() }
  private menuItems(): [string, string][] {
    const items: [string, string][] = []
    if (this.pl.length && !this.winner) items.push(["RESUME", "resume"])
    items.push(["PLAY MAFIA", "play"], ["PLAYERS: " + this.count, "count"], ["CIRCLE: " + (this.bigCircle ? "BIG ROOM" : "SMALL ROOM"), "circle"])
    return items
  }
  private runButton(b: Btn) {
    if (b.action === "count") { this.count = this.count === 6 ? 8 : this.count === 8 ? 10 : 6; this.relabel("count", "PLAYERS: " + this.count); return }
    if (b.action === "circle") { this.bigCircle = !this.bigCircle; this.relabel("circle", "CIRCLE: " + (this.bigCircle ? "BIG ROOM" : "SMALL ROOM")); return }
    if (b.action === "resume") { this.setMode("game"); this.phaseEnd = Date.now() + 15000; this.makePhaseSigns(); return }
    if (b.action === "play") { this.setMode("game"); this.newGame(); return }
    // in-game signs
    if (b.action === "skip") this.pickSkip()
    if (b.action === "self") this.pickTarget(0)
    if (b.action === "vote_now" && this.phase === "day") this.startPhase("vote")
    if (b.action === "again") { this.setMode("game"); this.newGame() }
  }

  // ------------------------------------------------------------------ setup
  private clearGame() {
    this.pl.forEach((p) => { if (p.peng) this.zap(p.peng.root) })
    this.pl = []
    if (this.sky) { this.zap(this.sky); this.sky = null }
    if (this.reveal) { this.zap(this.reveal.root); this.reveal = null }
    this.clearSigns()
    this.clearFx()
  }
  private newGame() {
    this.clearGame()
    this.winner = ""
    this.day = 0
    this.lastSaved = this.cpuLastSaved = -1
    const n = this.count
    const mafiaN = n <= 6 ? 1 : n <= 9 ? 2 : 3
    const roles: string[] = []
    for (let i = 0; i < mafiaN; i++) roles.push("mafia")
    roles.push("doctor", "detective")
    while (roles.length < n) roles.push("town")
    for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = roles[i]; roles[i] = roles[j]; roles[j] = t }
    const names = NAMES.slice().sort(() => Math.random() - 0.5)
    const cam = this.camPos(), d = this.flatDir()
    this.center = new vec3(cam.x, this.floorY, cam.z)
    const R = this.bigCircle ? 400 : 290
    for (let i = 0; i < n; i++) {
      const sus: number[] = []
      for (let j = 0; j < n; j++) sus.push(j === i ? -99 : Math.random() * 0.6)
      const p: Pl = {name: i === 0 ? "YOU" : names[i - 1], role: roles[i], alive: true, you: i === 0, peng: null, sus, color: PAL[i % PAL.length], checked: {}, claimed: false, vote: -1}
      if (i > 0) {
        const ang = n === 2 ? 0 : -100 + (200 * (i - 1)) / (n - 2)
        p.peng = this.makePenguin(this.floorAt(this.center, d, ang, R), "vest", p.color, p.name, 1.05)
      }
      this.pl.push(p)
    }
    // Mafia know each other
    for (let i = 1; i < n; i++) if (this.pl[i].role === "mafia") for (let j = 0; j < n; j++) if (this.pl[j].role === "mafia" && j !== i) this.pl[i].sus[j] = -50
    this.startPhase("reveal")
  }
  private me(): Pl { return this.pl[0] }
  private alive(): number[] { const a: number[] = []; this.pl.forEach((p, i) => { if (p.alive) a.push(i) }); return a }
  private mafiaAlive() { return this.pl.filter((p) => p.alive && p.role === "mafia").length }
  private townAlive() { return this.pl.filter((p) => p.alive && p.role !== "mafia").length }

  // ------------------------------------------------------------------ phases
  private startPhase(ph: string) {
    this.phase = ph
    this.clearSigns()
    const now = Date.now()
    const me = this.me()
    if (ph === "reveal") {
      this.phaseEnd = now + 7000
      // your role penguin floats at eye level in front of you
      const d = this.flatDir(), f = this.floorAt(this.camPos(), d, 0, 230)
      const at = new vec3(f.x, this.camPos().y - 75, f.z)
      this.reveal = this.makePenguin(at, ROLE_OUTFIT[me.role], ST.friendly, ROLE_NAME[me.role], 1)
      this.reveal.label.textFill.color = ROLE_COLOR[me.role]
      this.burst(at.add(new vec3(0, 80, 0)), ROLE_COLOR[me.role], 30)
      this.toast("You are the " + ROLE_NAME[me.role], 7000)
      if (me.role === "mafia") {
        const mates = this.pl.filter((p, i) => i > 0 && p.role === "mafia").map((p) => p.name)
        if (mates.length) this.toast("You are the Mafia · partner: " + mates.join(", "), 7000)
      }
    } else if (ph === "night") {
      this.day++
      this.phaseEnd = now + (me.alive && me.role !== "town" ? 30000 : 7000)
      this.myPick = -1
      this.makeSky(true)
      if (me.alive) this.toast(me.role === "mafia" ? "Pick who to eliminate" : me.role === "doctor" ? "Pick who to save" : me.role === "detective" ? "Pick who to investigate" : "The town sleeps…", 5000)
      this.pl.forEach((p) => { if (p.peng && p.alive) this.say(p.peng, "z z z", 6000) })
    } else if (ph === "dawn") {
      this.phaseEnd = now + 6500
      this.makeSky(false)
      this.resolveNight()
    } else if (ph === "day") {
      this.phaseEnd = now + 30000
      this.talkAt = now + 1200
      if (me.alive) this.toast("Discuss · look at a penguin and pinch to accuse", 4500)
    } else if (ph === "vote") {
      this.phaseEnd = now + 20000
      this.votes = this.pl.map(() => 0)
      this.pl.forEach((p) => (p.vote = -1))
      this.myPick = -1
      if (me.alive) this.toast("Vote · look at a penguin and pinch, or SKIP", 4500)
      // computer penguins lock in their votes over the next few seconds
      this.pl.forEach((p, i) => {
        if (i === 0 || !p.alive) return
        const ev = this.createEvent("DelayedCallbackEvent")
        ev.bind(() => { if (this.phase === "vote" && p.alive && p.vote === -1) this.castVote(i, this.cpuVote(i)) })
        ev.reset(2 + Math.random() * 12)
      })
    } else if (ph === "verdict") {
      this.phaseEnd = now + 7000
      this.resolveVote()
    } else if (ph === "end") {
      this.phaseEnd = now + 999999
    }
    this.makePhaseSigns()
  }
  private makePhaseSigns() {
    const me = this.me()
    if (this.phase === "night" && me.alive && me.role === "doctor" && this.lastSaved !== 0) this.addSign("SAVE MYSELF", "self", ST.health)
    if (this.phase === "day" && me.alive) this.addSign("VOTE NOW", "vote_now", ST.objective)
    if (this.phase === "vote" && me.alive) this.addSign("SKIP", "skip", ST.muted)
    if (this.phase === "end") this.addSign("PLAY AGAIN", "again", ST.objective)
  }
  private addSign(label: string, action: string, c: vec4) {
    const o = this.makeText(label, 4.5, c)
    const t = o.getComponent("Component.Text") as Text
    this.panelize(t)
    const d = this.flatDir()
    const tr = o.getTransform()
    tr.setWorldPosition(this.camPos().add(d.uniformScale(110)).add(new vec3(0, -38, 0)).add(this.rightOf(d).uniformScale(30 * this.signs.length)))
    tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
    this.signs.push({obj: o, text: t, action})
  }
  private clearSigns() { this.signs.forEach((s) => this.zap(s.obj)); this.signs = [] }
  private makeSky(night: boolean) {
    if (this.sky) { this.zap(this.sky); this.sky = null }
    if (!night) return
    // moon + stars (the app's purple night colour)
    this.sky = global.scene.createSceneObject("iyNight")
    const d = this.flatDir(), cam = this.camPos()
    const moon = cam.add(d.uniformScale(600)).add(new vec3(0, 380, 0)).add(this.rightOf(d).uniformScale(180))
    this.block(moon, new vec3(70, 70, 70), new vec4(0.95, 0.93, 1, 1), this.sky)
    this.block(moon.add(new vec3(-14, 10, 30)), new vec3(14, 14, 14), ST.night, this.sky)
    for (let i = 0; i < 70; i++) {
      const dir = quat.angleAxis((Math.random() - 0.5) * 220 * D2R, vec3.up()).multiplyVec3(d)
      const p = cam.add(dir.uniformScale(500 + Math.random() * 300)).add(new vec3(0, 180 + Math.random() * 400, 0))
      const s = 2 + Math.random() * 4
      this.block(p, new vec3(s, s, s), i % 5 === 0 ? ST.night : WHITE, this.sky)
    }
  }

  // ------------------------------------------------------------------ input
  private onPinch(right: boolean, down: boolean) {
    if (!down || !right) return
    const s = this.gazedSign()
    if (s) { this.runButton(s); return }
    if (this.phase === "reveal") { this.phaseEnd = Date.now(); return }
    const i = this.lookedAtPenguin(this.pl.map((p) => p.peng), (k) => this.pl[k].alive)
    if (i > 0) this.pickTarget(i)
  }
  private onTap(tp: vec2) {
    if (!this.camComp) return
    for (const s of this.signs) {
      const sp = this.camComp.worldSpaceToScreenSpace(s.obj.getTransform().getWorldPosition())
      if (Math.abs(sp.x - tp.x) < 0.09 && Math.abs(sp.y - tp.y) < 0.05) { this.runButton(s); return }
    }
    if (this.phase === "reveal") { this.phaseEnd = Date.now(); return }
    let best = -1, bd = 0.09
    this.pl.forEach((p, i) => {
      if (!p.peng || !p.alive) return
      const sp = this.camComp.worldSpaceToScreenSpace(p.peng.pos.add(new vec3(0, 50, 0)))
      const dd = Math.abs(sp.x - tp.x)
      if (dd < bd) { bd = dd; best = i }
    })
    if (best > 0) this.pickTarget(best)
  }
  private gazedSign(): Btn { for (const s of this.signs) if (this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R) return s; return null }
  private pickTarget(i: number) {
    const me = this.me()
    if (!me.alive) { this.toast("You're out · watching"); return }
    const t = this.pl[i]
    if (this.phase === "night") {
      if (me.role === "town") return
      if (this.myPick >= 0) { this.toast("Already picked"); return }
      if (me.role === "mafia" && t.role === "mafia" && i !== 0) { this.toast("That's your partner"); return }
      if (me.role === "mafia" && i === 0) return
      if (me.role === "doctor" && i === this.lastSaved) { this.toast("Can't save the same player twice in a row"); return }
      this.myPick = i
      if (me.role === "detective") {
        const isM = t.role === "mafia"
        me.checked[i] = isM ? "mafia" : "clear"
        this.toast(t.name + (isM ? " IS THE MAFIA!" : " is not the Mafia"), 6000)
        if (t.peng) this.burst(t.peng.pos.add(new vec3(0, 70, 0)), isM ? ST.enemy : ST.health, 18)
      } else this.toast((me.role === "mafia" ? "Target: " : "Saving: ") + (i === 0 ? "yourself" : t.name), 3000)
      this.phaseEnd = Math.min(this.phaseEnd, Date.now() + 3500)
      return
    }
    if (this.phase === "day" && i > 0) {
      // accuse
      this.toast("You accuse " + t.name, 2500)
      this.pl.forEach((p, k) => { if (k > 0 && k !== i && p.alive && p.role !== "mafia") p.sus[i] += 0.7 })
      t.sus[0] += 1
      this.say(t.peng, ["Me?! No way!", "Why me?? I was asleep!", "Look at YOU being sus."][Math.floor(Math.random() * 3)], 3500)
      return
    }
    if (this.phase === "vote" && i > 0) {
      if (me.vote !== -1) { this.toast("You already voted"); return }
      this.castVote(0, i)
      this.toast("You voted " + t.name)
    }
  }
  private pickSkip() { if (this.phase === "vote" && this.me().alive && this.me().vote === -1) { this.castVote(0, -2); this.toast("You skipped") } }
  private castVote(i: number, target: number) {
    const p = this.pl[i]
    p.vote = target
    if (target >= 0) this.votes[target]++
    if (p.peng) this.say(p.peng, target === -2 ? "I SKIP" : "VOTE: " + this.pl[target].name, 8000)
    // everyone alive has voted: end the vote early
    if (this.pl.every((q) => !q.alive || q.vote !== -1)) this.phaseEnd = Math.min(this.phaseEnd, Date.now() + 1500)
  }

  // ------------------------------------------------------------------ night + day logic
  private cpuNight() {
    const al = this.alive()
    // Mafia target: a detective who claimed, else the town player who suspects the Mafia most
    const me = this.me()
    if (!(me.alive && me.role === "mafia" && this.myPick > 0)) {
      const town = al.filter((i) => this.pl[i].role !== "mafia")
      let best = -1, bs = -1e9
      for (const i of town) {
        const p = this.pl[i]
        let s = Math.random() * 0.8 + (p.claimed ? 5 : 0)
        this.pl.forEach((m, k) => { if (m.role === "mafia" && m.alive) s += p.sus[k] })
        if (s > bs) { bs = s; best = i }
      }
      if (this.mafiaAlive() > 0 && this.pl.some((p, k) => k > 0 && p.alive && p.role === "mafia")) this.nightKill = best
      else this.nightKill = -1
    } else this.nightKill = this.myPick
    if (me.role === "mafia" && me.alive && this.myPick <= 0 && !this.pl.some((p, k) => k > 0 && p.alive && p.role === "mafia")) this.nightKill = -1 // only you left as Mafia and you didn't pick
    // Doctor
    const doc = this.pl.findIndex((p) => p.role === "doctor")
    this.nightSave = -1
    if (doc === 0 && me.alive) { this.nightSave = this.myPick; this.lastSaved = this.myPick }
    else if (doc > 0 && this.pl[doc].alive) {
      let s = Math.random() < 0.35 ? doc : al[Math.floor(Math.random() * al.length)]
      if (s === this.cpuLastSaved) s = doc !== this.cpuLastSaved ? doc : al[0]
      this.nightSave = s
      this.cpuLastSaved = s
    }
    // Detective
    const det = this.pl.findIndex((p) => p.role === "detective")
    if (det > 0 && this.pl[det].alive) {
      const opts = al.filter((i) => i !== det && this.pl[det].checked[i] === undefined)
      if (opts.length) { const t = opts[Math.floor(Math.random() * opts.length)]; this.pl[det].checked[t] = this.pl[t].role === "mafia" ? "mafia" : "clear" }
    }
  }
  private resolveNight() {
    this.cpuNight()
    const k = this.nightKill
    if (k >= 0 && k === this.nightSave) { this.toast("The Doctor saved someone last night!", 6000); return }
    if (k < 0) { this.toast("A quiet night. Nobody went down.", 5000); return }
    this.eliminate(k, (k === 0 ? "YOU were eliminated" : this.pl[k].name + " was eliminated") + " · " + ROLE_NAME[this.pl[k].role])
  }
  private eliminate(i: number, msg: string) {
    const p = this.pl[i]
    p.alive = false
    this.toast(msg, 6500)
    if (p.peng) {
      const peng = p.peng
      this.dressPenguin(peng, ROLE_OUTFIT[p.role], p.color, 1.05)
      peng.label.text = p.name + " · " + ROLE_NAME[p.role]
      peng.label.textFill.color = ROLE_COLOR[p.role]
      const ev = this.createEvent("DelayedCallbackEvent")
      ev.bind(() => { this.blockPile(peng.pos, ROLE_COLOR[p.role], 90, 30); peng.root.enabled = false })
      ev.reset(2.6)
    } else {
      this.blockPile(this.floorAt(this.camPos(), this.flatDir(), 0, 60), ROLE_COLOR[p.role], 60, 8)
    }
  }
  private cpuTalk() {
    const speakers = this.alive().filter((i) => i > 0)
    if (!speakers.length) return
    const i = speakers[Math.floor(Math.random() * speakers.length)]
    const p = this.pl[i]
    const others = this.alive().filter((j) => j !== i)
    // Detective with a Mafia result goes public
    if (p.role === "detective" && !p.claimed) {
      const found = Object.keys(p.checked).map((x) => +x).find((x) => p.checked[x] === "mafia" && this.pl[x].alive)
      if (found !== undefined && Math.random() < 0.8) {
        p.claimed = true
        this.say(p.peng, "I'm the Detective. " + this.pl[found].name + " is MAFIA!", 5000)
        this.pl.forEach((q, k) => { if (k > 0 && q.role !== "mafia") q.sus[found] += 3 })
        return
      }
    }
    // the most-suspected player (by this penguin)
    let tgt = -1, ts = -1e9
    for (const j of others) { const s = p.role === "mafia" ? (this.pl[j].role === "mafia" ? -99 : p.sus[j] + (this.pl[j].claimed ? 2 : 0)) : p.sus[j]; if (s > ts) { ts = s; tgt = j } }
    if (tgt < 0) return
    const accused = this.pl.some((q, k) => k !== i && q.alive && q.sus[i] > 1.2)
    if (accused && Math.random() < 0.4) { this.say(p.peng, ["It's NOT me, I swear!", "I'm just a penguin!", "Why is everyone looking at me?"][Math.floor(Math.random() * 3)]); this.pl.forEach((q) => (q.sus[i] -= 0.1)); return }
    const nm = tgt === 0 ? "YOU" : this.pl[tgt].name
    const lines = [nm + " is acting sus.", "I don't trust " + nm + ".", "Where was " + nm + " last night?", "I think it's " + nm + ".", nm + " is too quiet…"]
    this.say(p.peng, lines[Math.floor(Math.random() * lines.length)])
    // listeners are swayed a little
    this.pl.forEach((q, k) => { if (k > 0 && k !== i && q.alive && q.role !== "mafia") q.sus[tgt] += 0.25 + Math.random() * 0.2 })
    if (tgt > 0) this.pl[tgt].sus[i] += 0.4
  }
  private cpuVote(i: number): number {
    const p = this.pl[i]
    const others = this.alive().filter((j) => j !== i)
    if (p.role === "mafia") {
      // Mafia pile onto the town player the town suspects most
      let best = -2, bs = -1e9
      for (const j of others) {
        if (this.pl[j].role === "mafia") continue
        let s = this.votes[j] * 0.8 + (this.pl[j].claimed ? 3 : 0)
        this.pl.forEach((q, k) => { if (k > 0 && q.alive && q.role !== "mafia") s += q.sus[j] * 0.3 })
        if (s > bs) { bs = s; best = j }
      }
      return best
    }
    let best = -2, bs = 0.55 + Math.random() * 0.4 // not convinced: skip
    for (const j of others) { const s = p.sus[j] + this.votes[j] * 0.25; if (s > bs) { bs = s; best = j } }
    return best
  }
  private resolveVote() {
    const skips = this.pl.filter((p) => p.alive && p.vote === -2).length
    let top = -1, tv = 0, tie = false
    this.votes.forEach((v, i) => { if (v > tv) { tv = v; top = i; tie = false } else if (v === tv && v > 0) tie = true })
    if (top < 0 || tie || skips >= tv) { this.toast(tie ? "A tie. Nobody is voted out." : "Skipped. Nobody is voted out.", 6000); return }
    this.eliminate(top, (top === 0 ? "YOU were voted out" : this.pl[top].name + " was voted out") + " · " + ROLE_NAME[this.pl[top].role])
  }
  private checkWin(): boolean {
    if (this.mafiaAlive() === 0) this.winner = "town"
    else if (this.mafiaAlive() >= this.townAlive()) this.winner = "mafia"
    if (!this.winner) return false
    const meWin = (this.winner === "mafia") === (this.me().role === "mafia")
    this.toast((this.winner === "town" ? "TOWN WINS!" : "THE MAFIA WINS!") + (meWin ? "  YOU WIN" : "  YOU LOSE"), 15000)
    // the survivors show their real roles
    this.pl.forEach((p) => { if (p.peng && p.alive) { this.dressPenguin(p.peng, ROLE_OUTFIT[p.role], p.color, 1.05); p.peng.label.text = p.name + " · " + ROLE_NAME[p.role]; p.peng.label.textFill.color = ROLE_COLOR[p.role] } })
    for (let k = 0; k < 4; k++) this.burst(this.camPos().add(this.flatDir().uniformScale(200)).add(new vec3((k - 1.5) * 60, 40, 0)), this.winner === "town" ? ST.friendly : ST.enemy, 24)
    this.startPhase("end")
    return true
  }

  // ------------------------------------------------------------------ per frame
  private tick(dt: number) {
    if (!this.pl.length) return
    const now = Date.now()
    this.pl.forEach((p) => { if (p.peng && p.peng.root.enabled) this.posePenguin(p.peng, null, dt, false) })
    if (this.reveal) this.posePenguin(this.reveal, null, dt, false)
    for (const s of this.signs) s.text.textFill.color = this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R ? ST.objective : ST.text
    // highlight who you're looking at
    const look = this.lookedAtPenguin(this.pl.map((p) => p.peng), (k) => this.pl[k].alive)
    this.pl.forEach((p, i) => {
      if (!p.peng || !p.alive) return
      const partner = this.me().role === "mafia" && p.role === "mafia"
      p.peng.label.textFill.color = i === look ? ST.objective : partner ? ST.enemy : ST.text
      p.peng.label.text = (i === look ? "◎ " : "") + p.name + (this.phase === "vote" && this.votes[i] ? "  ×" + this.votes[i] : "")
    })
    const left = Math.max(0, Math.ceil((this.phaseEnd - now) / 1000))
    const me = this.me()
    const titles: {[k: string]: string} = {reveal: "YOUR ROLE", night: "NIGHT " + this.day, dawn: "MORNING", day: "DAY " + this.day, vote: "VOTE", verdict: "VERDICT", end: "GAME OVER"}
    this.kicker.text = "iYiYi · MAFIA · " + (titles[this.phase] || "") + (this.phase !== "end" && this.phase !== "dawn" && this.phase !== "verdict" ? "  " + left + "s" : "")
    this.hud.text = (me.alive ? ROLE_NAME[me.role] : "OUT · WATCHING") + "   " + this.mafiaAlive() + " MAFIA · " + this.townAlive() + " TOWN"
    if (this.phase === "day" && now > this.talkAt) { this.cpuTalk(); this.talkAt = now + 2600 + Math.random() * 1800 }
    if (now < this.phaseEnd) return
    // phase transitions
    if (this.phase === "reveal") { if (this.reveal) { this.zap(this.reveal.root); this.reveal = null } this.startPhase("night") }
    else if (this.phase === "night") this.startPhase("dawn")
    else if (this.phase === "dawn") { if (!this.checkWin()) this.startPhase("day") }
    else if (this.phase === "day") this.startPhase("vote")
    else if (this.phase === "vote") this.startPhase("verdict")
    else if (this.phase === "verdict") { if (!this.checkWin()) this.startPhase("night") }
  }
}
