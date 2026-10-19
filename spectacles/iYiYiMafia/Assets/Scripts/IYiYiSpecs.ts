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
  muted: new vec4(0.62, 0.64, 0.68, 1), line: new vec4(0.28, 0.31, 0.38, 1), panel: new vec4(0.03, 0.04, 0.055, 0.88),
}
const PAL = [hex(0xff4fa3), ST.friendly, ST.objective, ST.health, ST.epic, hex(0xff7a1a)]
const WHITE = new vec4(1, 1, 1, 1)
// Penguins: the app's Mafia / Beside Them characters. Black is invisible on Specs (additive
// display), so penguin "black" is a deep slate blue that still reads as a penguin.
const PEN_DARK = new vec4(0.2, 0.25, 0.42, 1)
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
          if (best) this.runButton(best)
          return
        }
        if (this.menuTag && this.camComp && this.mode !== "intro") {
          const sp = this.camComp.worldSpaceToScreenSpace(this.menuTag.getTransform().getWorldPosition())
          if (Math.abs(sp.x - tp.x) < 0.08 && Math.abs(sp.y - tp.y) < 0.05) { this.openMenu(); return }
        }
        this.onTap(tp)
      })
    } catch (e) {}
  }

  private pinch(right: boolean, down: boolean) {
    if (this.mode === "intro") { if (down) this.endIntro(); return }
    if (this.mode === "menu") { if (down && right) { const g = this.gazedBtn(); if (g) this.runButton(g) } return }
    if (down && right && this.menuLookedAt()) { this.openMenu(); return }
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
    put(this.kicker, 29)
    put(this.hud, 22)
    put(this.toastT, -17)
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
      if (f.t >= f.life) { f.obj.destroy(); this.fx.splice(i, 1); if (f.onDone) f.onDone() }
    }
  }
  private clearFx() { this.fx.forEach((f) => f.obj.destroy()); this.fx = [] }

  // ------------------------------------------------------------------ intro + menu
  private setMode(m: string) {
    this.mode = m
    this.modeT = 0
    if (m !== "menu") { this.btns.forEach((b) => b.obj.destroy()); this.btns = [] }
    if (m === "menu" && this.menuTag) { this.menuTag.destroy(); this.menuTag = null }
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
    this.introObjs.forEach((o) => o.destroy())
    this.introObjs = []
    this.clearFx()
    this.openMenu()
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
  private openMenu() {
    this.setMode("menu")
    this.onMenuOpen()
    if (!this.camT) return
    const cam = this.camPos(), d = this.flatDir()
    const items = this.menuItems()
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 5.5, ST.text)
      const t = o.getComponent("Component.Text") as Text
      this.panelize(t)
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(160)).add(new vec3(0, 52 - i * 24, 0)))
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
    t.size = 70 * Math.max(0.6, s)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.depthTest = false
    t.text = name.toUpperCase()
    t.textFill.color = ST.text
    lab.getTransform().setLocalPosition(new vec3(0, 135 * s, 0))
    const bub = global.scene.createSceneObject("iyPenguinSay")
    bub.setParent(root)
    const b = bub.createComponent("Component.Text") as Text
    b.size = 62 * Math.max(0.6, s)
    b.horizontalAlignment = HorizontalAlignment.Center
    b.depthTest = false
    b.textFill.color = ST.text
    this.panelize(b)
    bub.getTransform().setLocalPosition(new vec3(0, 168 * s, 0))
    peng.label = t
    peng.bubble = b
    root.getTransform().setWorldPosition(pos)
    return peng
  }
  private dressPenguin(p: Penguin, outfit: string, color: vec4, s: number = 1) {
    for (let i = p.outfit.getChildrenCount() - 1; i >= 0; i--) p.outfit.getChild(i).destroy()
    const o = p.outfit
    const P = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) => this.part(o, x * s, y * s, z * s, sx * s, sy * s, sz * s, c)
    if (outfit === "vest") {
      P(-15, 46, 20.6, 14, 34, 2, color); P(15, 46, 20.6, 14, 34, 2, color); P(0, 46, -20.6, 50, 34, 2, color)
      P(-25.6, 46, 0, 2, 34, 40, color); P(25.6, 46, 0, 2, 34, 40, color)
      P(0, 50, 22, 3, 3, 1, ST.objective); P(0, 40, 22, 3, 3, 1, ST.objective)        // buttons
      P(-5, 66, 22.5, 8, 6, 3, color); P(5, 66, 22.5, 8, 6, 3, color)                   // bow tie
    } else if (outfit === "mafia") {
      const suit = new vec4(0.32, 0.33, 0.4, 1), stripe = new vec4(0.55, 0.56, 0.64, 1)
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
    // the four characters slide in under the logo
    const d = this.flatDir(), r = this.rightOf(d), cam = this.camPos()
    ;["vest", "mafia", "doctor", "detective"].forEach((o, i) => {
      const p = this.makePenguin(new vec3(0, 0, 0), o, ST.friendly, "", 0.5)
      const at = cam.add(d.uniformScale(240)).add(r.uniformScale((i - 1.5) * 50))
      p.pos = new vec3(at.x, this.floorY + 40 - 400, at.z)
      this.posePenguin(p)
      this.fx.push({obj: p.root, t: 0, life: 3.6, vel: new vec3(0, 520, 0), gravity: true, floorY: undefined})
      // settle: stop rising at waist height
      const ev = this.createEvent("UpdateEvent")
      ev.bind(() => {
        if (this.mode !== "intro") { ev.enabled = false; return }
        const tr = p.root.getTransform(), q = tr.getWorldPosition()
        if (q.y > this.floorY + 40) tr.setWorldPosition(new vec3(q.x, this.floorY + 40, q.z))
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
    this.pl.forEach((p) => { if (p.peng) p.peng.root.destroy() })
    this.pl = []
    if (this.sky) { this.sky.destroy(); this.sky = null }
    if (this.reveal) { this.reveal.root.destroy(); this.reveal = null }
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
    const R = this.bigCircle ? 260 : 170
    for (let i = 0; i < n; i++) {
      const sus: number[] = []
      for (let j = 0; j < n; j++) sus.push(j === i ? -99 : Math.random() * 0.6)
      const p: Pl = {name: i === 0 ? "YOU" : names[i - 1], role: roles[i], alive: true, you: i === 0, peng: null, sus, color: PAL[i % PAL.length], checked: {}, claimed: false, vote: -1}
      if (i > 0) {
        const ang = n === 2 ? 0 : -100 + (200 * (i - 1)) / (n - 2)
        p.peng = this.makePenguin(this.floorAt(this.center, d, ang, R), "vest", p.color, p.name, 0.85)
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
      const d = this.flatDir(), at = this.floorAt(this.camPos(), d, 0, 140)
      this.reveal = this.makePenguin(at, ROLE_OUTFIT[me.role], ST.friendly, "", 1)
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
  private clearSigns() { this.signs.forEach((s) => s.obj.destroy()); this.signs = [] }
  private makeSky(night: boolean) {
    if (this.sky) { this.sky.destroy(); this.sky = null }
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
      this.dressPenguin(peng, ROLE_OUTFIT[p.role], p.color, 0.85)
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
    this.pl.forEach((p) => { if (p.peng && p.alive) { this.dressPenguin(p.peng, ROLE_OUTFIT[p.role], p.color, 0.85); p.peng.label.text = p.name + " · " + ROLE_NAME[p.role]; p.peng.label.textFill.color = ROLE_COLOR[p.role] } })
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
    if (this.phase === "reveal") { if (this.reveal) { this.reveal.root.destroy(); this.reveal = null } this.startPhase("night") }
    else if (this.phase === "night") this.startPhase("dawn")
    else if (this.phase === "dawn") { if (!this.checkWin()) this.startPhase("day") }
    else if (this.phase === "day") this.startPhase("vote")
    else if (this.phase === "vote") this.startPhase("verdict")
    else if (this.phase === "verdict") { if (!this.checkWin()) this.startPhase("night") }
  }
}
