// iYiYi BESIDE THEM for Snap Spectacles (this project's one script; the file keeps the template's
// name so the scene's component reference stays wired).
//
// The app's Beside Them, in your real room or yard: task stations (glowing consoles) stand around
// you and a crew of penguins in coloured jumpsuits walks between them doing tasks. One of them is
// secretly the imposter (or you are).
// Crew: walk to your task stations (a beam marks the next one) and do the task there:
//   WIRES / NAV: watch the coloured pads flash, then look at them in the same order and pinch.
//   FUEL / REACTOR: look at the console and hold a pinch until it's full.
//   MEDBAY: stand on the scanner until the scan finishes.
// The imposter picks off crew when nobody's looking; they collapse into a pile of blocks. Look at
// a body and pinch to REPORT (or press the EMERGENCY button once). Meeting: the penguins gather
// around you and talk (witnesses say what they saw), then everyone votes. Look at a penguin and
// pinch to vote, or SKIP.
// Imposter (you): walk up to a penguin, look at it and pinch to eliminate it (cooldown). Fake tasks
// at stations to blend in. Don't get seen.
// Crew win: all tasks done or the imposter voted out. Imposter wins: as many imposters as crew.
// Solo with computer penguins for now; playing with friends through the app comes next.
// Lens Studio preview: click to pinch (stations work when you're near them, so walk the camera).
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
const CREW_COLORS = [hex(0x39d5ff), hex(0x5cf2a0), hex(0xffb21e), hex(0xb06cff), hex(0xff4fa3), hex(0xff7a1a)]
const STATIONS: {name: string; kind: string}[] = [
  {name: "WIRES", kind: "seq"}, {name: "FUEL", kind: "fuel"}, {name: "MEDBAY", kind: "scan"}, {name: "NAV", kind: "seq"}, {name: "REACTOR", kind: "fuel"},
]
type Station = {name: string; kind: string; pos: vec3; obj: SceneObject; screen: SceneObject}
type Bot = {peng: Penguin; name: string; color: vec4; alive: boolean; imp: boolean; goal: vec3; goalSt: number; busyT: number; tasksLeft: number; saw: number; hunting: number}
type Body = {pos: vec3; name: string; color: vec4; marker: SceneObject; who: number}
type Task = {st: number; kind: string; t: number; seq: number[]; step: number; showT: number; pads: SceneObject[]}

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

  // ================================================================== Beside Them
  private bigArea = false
  private rolePref = "random" // random | crew | imposter
  private stations: Station[] = []
  private bots: Bot[] = []
  private bodies: Body[] = []
  private start: vec3
  private emergency: SceneObject = null
  private emergencyUsed = false
  private imImp = false
  private myAlive = true
  private myTasks: number[] = []
  private task: Task = null
  private holding = false
  private killReady = 0
  private beacon: SceneObject = null
  private beaconFor = -1
  private phase = "" // play | meeting | vote | eject | end
  private phaseEnd = 0
  private talkQ: [number, string][] = []
  private talkAt = 0
  private votes: number[] = []
  private myVote = -9
  private botVote: number[] = []
  private signs: Btn[] = []
  private totalTasks = 0
  private doneTasks = 0
  private lastBodyAt: string = ""
  private game = false
  private ejected: Penguin = null

  onAwake() {
    this.initKit()
    this.startIntro("BESIDE THEM")
  }
  private introProps() {
    const d = this.flatDir(), r = this.rightOf(d), cam = this.camPos()
    for (let i = 0; i < 5; i++) {
      const at = cam.add(d.uniformScale(260)).add(r.uniformScale((i - 2) * 48))
      const p = this.makePenguin(new vec3(at.x, this.floorY + 30, at.z), "crew", CREW_COLORS[i], "", 0.45)
      this.posePenguin(p)
      this.fx.push({obj: p.root, t: 0, life: 4.2, vel: new vec3(0, 0, 0), spin: new vec3(0, 0, 0)})
    }
  }
  private onMenuOpen() { this.clearSigns() }
  private menuItems(): [string, string][] {
    const items: [string, string][] = []
    if (this.game && this.phase !== "end") items.push(["RESUME", "resume"])
    items.push(["PLAY BESIDE THEM", "play"], ["AREA: " + (this.bigArea ? "YARD" : "ROOM"), "area"], ["ROLE: " + this.rolePref.toUpperCase(), "role"])
    return items
  }
  private runButton(b: Btn) {
    if (b.action === "area") { this.bigArea = !this.bigArea; this.relabel("area", "AREA: " + (this.bigArea ? "YARD" : "ROOM")); this.toast(this.bigArea ? "About 7 m around you" : "About 3 m around you"); return }
    if (b.action === "role") { this.rolePref = this.rolePref === "random" ? "crew" : this.rolePref === "crew" ? "imposter" : "random"; this.relabel("role", "ROLE: " + this.rolePref.toUpperCase()); return }
    if (b.action === "resume") { this.setMode("game"); this.makeSigns(); return }
    if (b.action === "play" || b.action === "again") { this.setMode("game"); this.newGame(); return }
    if (b.action === "skip") this.vote(-1)
  }

  // ------------------------------------------------------------------ setup
  private clearGame() {
    this.stations.forEach((s) => s.obj.destroy())
    this.bots.forEach((b) => b.peng.root.destroy())
    this.bodies.forEach((b) => b.marker.destroy())
    if (this.emergency) this.emergency.destroy()
    if (this.beacon) this.beacon.destroy()
    if (this.ejected) this.ejected.root.destroy()
    this.endTask()
    this.stations = []; this.bots = []; this.bodies = []; this.emergency = null; this.beacon = null; this.beaconFor = -1; this.ejected = null
    this.clearSigns()
    this.clearFx()
  }
  private newGame() {
    this.clearGame()
    this.game = true
    const cam = this.camPos(), d = this.flatDir()
    this.start = new vec3(cam.x, this.floorY, cam.z)
    const near = this.bigArea ? 300 : 130, far = this.bigArea ? 700 : 280
    const order = STATIONS.map((_, i) => i).sort(() => Math.random() - 0.5)
    STATIONS.forEach((s, i) => {
      const ang = -150 + order[i] * 72 + (Math.random() - 0.5) * 30
      const pos = this.floorAt(this.start, d, ang, near + Math.random() * (far - near))
      this.stations.push(this.makeStation(s.name, s.kind, pos))
    })
    // emergency button where you start, a little to your side
    this.emergency = global.scene.createSceneObject("iyEmergency")
    const ep = this.floorAt(this.start, d, 120, 70)
    this.part(this.emergency, 0, 40, 0, 26, 80, 26, ST.line)
    this.part(this.emergency, 0, 84, 0, 30, 8, 30, ST.text)
    this.part(this.emergency, 0, 90, 0, 20, 6, 20, ST.enemy)
    const lab = this.makeText("EMERGENCY", 2.4, ST.enemy)
    lab.setParent(this.emergency)
    lab.getTransform().setLocalPosition(new vec3(0, 112, 0))
    this.emergency.getTransform().setWorldPosition(ep)
    this.emergencyUsed = false
    // roles
    this.imImp = this.rolePref === "imposter" || (this.rolePref === "random" && Math.random() < 1 / 6)
    const nBots = 5
    const impBot = this.imImp ? -1 : Math.floor(Math.random() * nBots)
    const names = NAMES.slice().sort(() => Math.random() - 0.5)
    for (let i = 0; i < nBots; i++) {
      const p = this.makePenguin(this.floorAt(this.start, d, -60 + i * 30, 120), "crew", CREW_COLORS[i], names[i], 0.8)
      this.bots.push({peng: p, name: names[i], color: CREW_COLORS[i], alive: true, imp: i === impBot, goal: null, goalSt: -1, busyT: 0, tasksLeft: 3, saw: -1, hunting: -1})
    }
    this.myAlive = true
    this.myTasks = this.imImp ? [] : order.slice(0, 3)
    this.totalTasks = this.bots.filter((b) => !b.imp).length * 3 + this.myTasks.length
    this.doneTasks = 0
    this.killReady = Date.now() + 20000
    this.phase = "play"
    this.makeSigns()
    this.toast(this.imImp ? "You are the IMPOSTER" : "You are CREW · one of them is the imposter", 6000)
    this.burst(this.camPos().add(d.uniformScale(120)), this.imImp ? ST.enemy : ST.friendly, 30)
  }
  private makeStation(name: string, kind: string, pos: vec3): Station {
    const o = global.scene.createSceneObject("iyStation")
    this.part(o, 0, 45, 0, 60, 90, 36, ST.line)                 // console
    this.part(o, 0, 92, 4, 64, 6, 44, ST.muted)                 // top edge
    const screen = this.part(o, 0, 70, 18.5, 46, 30, 1, ST.friendly)
    this.part(o, 0, 2, 0, 90, 3, 70, new vec4(0.12, 0.3, 0.4, 1)) // floor plate
    if (kind === "scan") { this.part(o, 0, 1, 70, 70, 2, 70, ST.health); this.part(o, 0, 2.5, 70, 50, 2, 50, new vec4(0.1, 0.35, 0.2, 1)) }
    if (kind === "fuel") { this.part(o, 42, 40, 0, 20, 70, 20, ST.objective) }
    const lab = this.makeText(name, 2.6, ST.friendly)
    lab.setParent(o)
    lab.getTransform().setLocalPosition(new vec3(0, 120, 0))
    o.getTransform().setWorldPosition(pos)
    // screen faces your start spot
    const v = this.start.sub(pos), f = new vec3(v.x, 0, v.z)
    if (f.length > 1) o.getTransform().setWorldRotation(quat.lookAt(f.normalize(), vec3.up()))
    return {name, kind, pos, obj: o, screen}
  }

  // ------------------------------------------------------------------ signs (SKIP / PLAY AGAIN)
  private makeSigns() {
    this.clearSigns()
    if (this.phase === "vote" && this.myAlive) this.addSign("SKIP VOTE", "skip", ST.muted)
    if (this.phase === "end") this.addSign("PLAY AGAIN", "again", ST.objective)
  }
  private addSign(label: string, action: string, c: vec4) {
    const o = this.makeText(label, 4.5, c)
    const t = o.getComponent("Component.Text") as Text
    this.panelize(t)
    const d = this.flatDir(), tr = o.getTransform()
    tr.setWorldPosition(this.camPos().add(d.uniformScale(110)).add(new vec3(0, -38, 0)))
    tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
    this.signs.push({obj: o, text: t, action})
  }
  private clearSigns() { this.signs.forEach((s) => s.obj.destroy()); this.signs = [] }
  private gazedSign(): Btn { for (const s of this.signs) if (this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R) return s; return null }

  // ------------------------------------------------------------------ input
  private onPinch(right: boolean, down: boolean) {
    if (!right) return
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
    // preview: a click is a short pinch (fuel tasks fill on clicks)
    this.act()
    if (this.task && this.task.kind === "fuel") this.task.t += 0.6
  }
  private act() {
    const cam = this.camPos()
    if (this.phase === "vote") {
      const i = this.lookedAtPenguin(this.bots.map((b) => b.peng), (k) => this.bots[k].alive)
      if (i >= 0) this.vote(i)
      return
    }
    if (this.phase !== "play" || !this.myAlive) return
    // report a body
    for (const b of this.bodies) {
      if (this.flatDist(b.pos, cam) < 320 && this.gazeAngle(b.pos.add(new vec3(0, 30, 0))) < 14 * D2R) { this.callMeeting(-1, b); return }
    }
    // emergency button
    if (this.emergency && !this.emergencyUsed && this.flatDist(this.emergency.getTransform().getWorldPosition(), cam) < 160 && this.gazeAngle(this.emergency.getTransform().getWorldPosition().add(new vec3(0, 90, 0))) < 14 * D2R) {
      this.emergencyUsed = true
      this.callMeeting(-1, null)
      return
    }
    // imposter: eliminate the penguin you're looking at, up close
    if (this.imImp) {
      const i = this.lookedAtPenguin(this.bots.map((b) => b.peng), (k) => this.bots[k].alive, 12)
      if (i >= 0 && this.flatDist(this.bots[i].peng.pos, cam) < 150) {
        if (Date.now() < this.killReady) { this.toast("Cooldown " + Math.ceil((this.killReady - Date.now()) / 1000) + "s"); return }
        this.kill(i, -1)
        this.killReady = Date.now() + 25000
        return
      }
    }
    // tasks
    if (this.task) { this.tapTask(); return }
    const st = this.nearStation()
    if (st >= 0) this.beginTask(st)
  }
  private nearStation(): number {
    const cam = this.camPos()
    let best = -1, bd = 150
    this.stations.forEach((s, i) => { const dd = this.flatDist(s.pos, cam); if (dd < bd) { bd = dd; best = i } })
    return best
  }

  // ------------------------------------------------------------------ tasks
  private beginTask(st: number) {
    const s = this.stations[st]
    if (!this.imImp && this.myTasks.indexOf(st) < 0) { this.toast(s.name + " isn't one of your tasks"); return }
    this.task = {st, kind: s.kind, t: 0, seq: [], step: 0, showT: 0, pads: []}
    if (s.kind === "seq") {
      for (let k = 0; k < 4; k++) this.task.seq.push(Math.floor(Math.random() * 4))
      const tr = s.obj.getTransform()
      for (let k = 0; k < 4; k++) {
        const lx = (k % 2 === 0 ? -1 : 1) * 16, ly = 135 + (k < 2 ? 18 : -2)
        const p = tr.getWorldPosition().add(tr.getWorldRotation().multiplyVec3(new vec3(lx, ly, 25)))
        const pad = this.block(p, new vec3(14, 14, 3), new vec4(PAL[k].r * 0.35, PAL[k].g * 0.35, PAL[k].b * 0.35, 1))
        if (pad) { pad.getTransform().setWorldRotation(tr.getWorldRotation()); this.task.pads.push(pad) }
      }
      this.toast("Watch the pads…", 2500)
    } else if (s.kind === "fuel") this.toast("Look at the console and HOLD a pinch", 3000)
    else this.toast("Stand on the scanner", 3000)
  }
  private endTask() { if (this.task) { this.task.pads.forEach((p) => p.destroy()); this.task = null } }
  private padColor(k: number, lit: boolean) {
    const pad = this.task.pads[k]
    if (!pad) return
    const c = PAL[k]
    ;(pad.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial = this.mat(lit ? c : new vec4(c.r * 0.35, c.g * 0.35, c.b * 0.35, 1))
  }
  private tapTask() {
    const t = this.task
    if (t.kind !== "seq" || t.showT < t.seq.length * 0.7 + 0.3) return
    // which pad are you looking at
    let best = -1, ba = 7 * D2R
    t.pads.forEach((p, k) => { const a = this.gazeAngle(p.getTransform().getWorldPosition()); if (a < ba) { ba = a; best = k } })
    if (best < 0 && this.camComp) best = t.seq[t.step] // preview: clicks walk the sequence
    if (best < 0) return
    this.padColor(best, true)
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => { if (this.task === t) this.padColor(best, false) })
    ev.reset(0.25)
    if (best === t.seq[t.step]) { t.step++; if (t.step >= t.seq.length) this.finishTask() }
    else { this.toast("Wrong pad · watch again"); t.step = 0; t.showT = 0 }
  }
  private tickTask(dt: number) {
    const t = this.task
    if (!t) return
    const s = this.stations[t.st]
    if (this.flatDist(s.pos, this.camPos()) > 220) { this.toast("Task cancelled"); this.endTask(); return }
    if (t.kind === "seq") {
      const before = t.showT
      t.showT += dt
      const showLen = t.seq.length * 0.7
      if (before < showLen + 0.3) {
        for (let k = 0; k < 4; k++) this.padColor(k, false)
        if (t.showT < showLen) { const i = Math.floor(t.showT / 0.7); if (t.showT - i * 0.7 < 0.45) this.padColor(t.seq[i], true) }
        else if (before < showLen) this.toast("Your turn: look + pinch the same order", 3000)
      }
      this.hud.text = s.name + "  " + t.step + " / " + t.seq.length
    } else if (t.kind === "fuel") {
      if (this.holding && this.gazeAngle(s.pos.add(new vec3(0, 60, 0))) < 25 * D2R) t.t += dt
      const k = Math.min(1, t.t / 3.5)
      this.hud.text = s.name + "  [" + "■■■■■■■■■■".slice(0, Math.round(k * 10)) + "□□□□□□□□□□".slice(0, 10 - Math.round(k * 10)) + "]"
      if (k >= 1) this.finishTask()
    } else {
      const pad = s.obj.getTransform().getWorldPosition().add(s.obj.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, 70)))
      if (this.flatDist(pad, this.camPos()) < 70) t.t += dt
      const k = Math.min(1, t.t / 4)
      this.hud.text = s.name + " SCAN  " + Math.round(k * 100) + "%"
      if (Math.random() < 0.5) { const b = this.block(new vec3(pad.x + (Math.random() - 0.5) * 50, this.floorY + 5, pad.z + (Math.random() - 0.5) * 50), new vec3(3, 3, 3), ST.health); if (b) this.fx.push({obj: b, t: 0, life: 1.2, vel: new vec3(0, 120, 0)}) }
      if (k >= 1) this.finishTask()
    }
  }
  private finishTask() {
    const t = this.task
    const s = this.stations[t.st]
    this.burst(s.pos.add(new vec3(0, 100, 0)), ST.health, 20)
    if (!this.imImp) {
      this.myTasks = this.myTasks.filter((x) => x !== t.st)
      this.doneTasks++
      this.toast(s.name + " done!" + (this.myTasks.length ? "" : " All your tasks are done"), 3000)
    } else this.toast("Faked " + s.name, 2000)
    this.endTask()
    this.checkWin()
  }

  // ------------------------------------------------------------------ bots
  private tickBots(dt: number) {
    const cam = this.camPos()
    const now = Date.now()
    this.bots.forEach((b, i) => {
      if (!b.alive) return
      let moving = false
      if (this.phase === "play") {
        // the computer imposter goes hunting when its cooldown is up
        if (b.imp && now > this.killReady && b.hunting === -1) b.hunting = this.pickVictim(i)
        if (b.imp && b.hunting !== -1) {
          const vpos = b.hunting === 99 ? new vec3(cam.x, this.floorY, cam.z) : this.bots[b.hunting] && this.bots[b.hunting].alive ? this.bots[b.hunting].peng.pos : null
          if (!vpos) b.hunting = -1
          else {
            b.goal = vpos
            if (this.flatDist(b.peng.pos, vpos) < 75) {
              if (this.unseen(vpos, i, b.hunting)) { this.kill(b.hunting === 99 ? -2 : b.hunting, i); this.killReady = now + 28000 + Math.random() * 10000 }
              b.hunting = -1
              b.goal = null
            }
          }
        }
        if (!b.goal && b.busyT <= 0) {
          b.goalSt = Math.floor(Math.random() * this.stations.length)
          const s = this.stations[b.goalSt]
          b.goal = s.pos.add(new vec3((Math.random() - 0.5) * 40, 0, 0)).add(s.obj.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, 55)))
        }
        if (b.goal) {
          const to = new vec3(b.goal.x - b.peng.pos.x, 0, b.goal.z - b.peng.pos.z)
          const sp = (this.bigArea ? 70 : 45) * (b.hunting !== -1 ? 1.4 : 1)
          if (to.length < 8) {
            if (b.hunting === -1) { b.goal = null; b.busyT = 5 + Math.random() * 5 }
          } else {
            b.peng.pos = b.peng.pos.add(to.normalize().uniformScale(Math.min(to.length, sp * dt)))
            moving = true
          }
        } else if (b.busyT > 0) {
          b.busyT -= dt
          if (b.busyT <= 0 && !b.imp && b.tasksLeft > 0 && b.goalSt >= 0) { b.tasksLeft--; this.doneTasks++; this.checkWin() }
        }
        // finds a body?
        for (const body of this.bodies) if (this.flatDist(body.pos, b.peng.pos) < 110 && !b.imp) { this.callMeeting(i, body); return }
      }
      const look = moving && b.goal ? b.goal : b.busyT > 0 && b.goalSt >= 0 ? this.stations[b.goalSt].pos : null
      this.posePenguin(b.peng, look, dt, moving)
      b.peng.label.textFill.color = this.imImp && this.lookedAtPenguin(this.bots.map((x) => x.peng), (k) => this.bots[k].alive, 12) === i ? ST.enemy : ST.text
    })
  }
  /** who the computer imposter goes after: a lone crew penguin, or you when you wander off alone */
  private pickVictim(imp: number): number {
    const cam = this.camPos()
    const crew = this.bots.map((b, k) => k).filter((k) => k !== imp && this.bots[k].alive)
    const youAlone = this.myAlive && this.bots.every((b, k) => k === imp || !b.alive || this.flatDist(b.peng.pos, cam) > 250)
    if (youAlone && Math.random() < 0.3) return 99
    return crew.length ? crew[Math.floor(Math.random() * crew.length)] : -1
  }
  /** nobody (you, or another penguin) is watching that spot */
  private unseen(at: vec3, imp: number, victim: number): boolean {
    const cam = this.camPos()
    if (victim !== 99) {
      const youSee = this.flatDist(at, cam) < 650 && this.gazeAngle(at.add(new vec3(0, 50, 0))) < 40 * D2R
      if (youSee && Math.random() < 0.85) return false
    }
    const others = this.bots.filter((b, k) => k !== imp && k !== victim && b.alive && this.flatDist(b.peng.pos, at) < 230)
    return others.length === 0 || Math.random() < 0.12
  }
  /** victim: bot index, -2 = you. killer: bot index, -1 = you */
  private kill(victim: number, killer: number) {
    const cam = this.camPos()
    if (victim === -2) {
      this.myAlive = false
      this.blockPile(new vec3(cam.x, this.floorY, cam.z), ST.friendly, 60, 999)
      this.toast("YOU WERE ELIMINATED by " + this.bots[killer].name, 8000)
      this.endTask()
      this.finish("imposter", "The imposter got you")
      return
    }
    const v = this.bots[victim]
    v.alive = false
    v.peng.root.enabled = false
    this.blockPile(v.peng.pos, v.color, 80, 999)
    const marker = this.makeText("!", 6, ST.enemy)
    marker.getTransform().setWorldPosition(v.peng.pos.add(new vec3(0, 70, 0)))
    this.bodies.push({pos: v.peng.pos, name: v.name, color: v.color, marker, who: killer})
    const near = this.stations.reduce((a, s) => (this.flatDist(s.pos, v.peng.pos) < this.flatDist(a.pos, v.peng.pos) ? s : a), this.stations[0])
    this.lastBodyAt = near.name
    // witnesses: penguins close enough to see it
    this.bots.forEach((b, k) => { if (b.alive && k !== killer && this.flatDist(b.peng.pos, v.peng.pos) < 400) b.saw = killer })
    if (killer >= 0) {
      const youSaw = this.flatDist(v.peng.pos, cam) < 650 && this.gazeAngle(v.peng.pos.add(new vec3(0, 50, 0))) < 40 * D2R
      if (youSaw) this.toast("You saw " + this.bots[killer].name + " do it! Report the body", 5000)
    } else {
      // you did it: a witness reports straight away
      const w = this.bots.findIndex((b) => b.alive && b.saw === -1 && this.flatDist(b.peng.pos, v.peng.pos) < 400)
      if (w >= 0) { this.say(this.bots[w].peng, "I SAW YOU!!", 3000); const body = this.bodies[this.bodies.length - 1]; const ev = this.createEvent("DelayedCallbackEvent"); ev.bind(() => { if (this.phase === "play") this.callMeeting(w, body) }); ev.reset(1.5) }
    }
    this.checkWin()
  }

  // ------------------------------------------------------------------ meetings + votes
  private callMeeting(reporter: number, body: Body) {
    if (this.phase !== "play") return
    this.endTask()
    this.phase = "meeting"
    this.phaseEnd = Date.now() + 14000
    this.toast(body ? (reporter >= 0 ? this.bots[reporter].name : "You") + " found " + body.name + "'s body!" : "EMERGENCY MEETING!", 4000)
    // everyone gathers in a ring around you, bodies are cleared away
    const cam = this.camPos(), d = this.flatDir()
    const alive = this.bots.filter((b) => b.alive)
    alive.forEach((b, k) => {
      b.peng.pos = this.floorAt(new vec3(cam.x, this.floorY, cam.z), d, alive.length === 1 ? 0 : -70 + (140 * k) / (alive.length - 1), 150)
      b.goal = null
      b.hunting = -1
      b.busyT = 0
    })
    this.bodies.forEach((x) => x.marker.destroy())
    this.bodies = []
    // what they say
    this.talkQ = []
    const bi = (b: Bot) => this.bots.indexOf(b)
    if (reporter >= 0 && body) this.talkQ.push([reporter, "Found " + body.name + " near " + this.lastBodyAt + "!"])
    alive.forEach((b) => {
      const i = bi(b)
      if (b.saw >= 0 && this.bots[b.saw] && this.bots[b.saw].alive && !b.imp) this.talkQ.push([i, "I SAW " + this.bots[b.saw].name + " DO IT!"])
      else if (b.saw === -1 && this.imImp && !b.imp && Math.random() < 0.0) this.talkQ.push([i, "It was YOU!"])
    })
    alive.forEach((b) => {
      const i = bi(b)
      if (b.imp) { const o = alive.filter((x) => x !== b); const t = o[Math.floor(Math.random() * o.length)]; this.talkQ.push([i, Math.random() < 0.5 && t ? "I think it's " + t.name + "." : "I was doing " + this.stations[Math.floor(Math.random() * this.stations.length)].name + "."]) }
      else if (Math.random() < 0.7) this.talkQ.push([i, ["Where was everyone?", "I was at " + this.stations[Math.floor(Math.random() * this.stations.length)].name + ".", "Not me, I was doing tasks!", "Who was alone?"][Math.floor(Math.random() * 4)]])
    })
    if (this.imImp && this.bots.some((b) => b.alive && b.saw === -1)) {
      const w = this.bots.findIndex((b) => b.alive && b.saw === -1)
      this.talkQ.unshift([w, "It was YOU! I saw you!"])
    }
    this.talkAt = Date.now() + 800
    this.clearSigns()
  }
  private startVote() {
    this.phase = "vote"
    this.phaseEnd = Date.now() + 16000
    this.votes = this.bots.map(() => 0)
    this.myVote = this.myAlive ? -9 : -1
    this.botVote = this.bots.map(() => -9)
    this.toast(this.myAlive ? "VOTE · look at a penguin and pinch, or SKIP" : "Voting…", 4000)
    this.makeSigns()
    this.bots.forEach((b, i) => {
      if (!b.alive) return
      const ev = this.createEvent("DelayedCallbackEvent")
      ev.bind(() => { if (this.phase === "vote") this.botCast(i) })
      ev.reset(2 + Math.random() * 10)
    })
  }
  private botCast(i: number) {
    const b = this.bots[i]
    const alive = this.bots.map((x, k) => k).filter((k) => this.bots[k].alive && k !== i)
    let t = -1 // skip
    if (b.saw === -1 && this.imImp) t = -2 // votes you
    else if (b.saw >= 0 && this.bots[b.saw].alive) t = b.saw
    else if (b.imp) t = alive.length ? alive[Math.floor(Math.random() * alive.length)] : -1
    else {
      // follow a witness, else mostly skip
      const accused = this.bots.find((x) => x.alive && x.saw >= 0 && !x.imp)
      if (accused && this.bots[accused.saw].alive) t = accused.saw
      else if (Math.random() < 0.35 && alive.length) t = alive[Math.floor(Math.random() * alive.length)]
    }
    this.botVote[i] = t
    if (t >= 0) this.votes[t]++
    this.say(b.peng, t === -1 ? "SKIP" : t === -2 ? "VOTE: YOU" : "VOTE: " + this.bots[t].name, 9000)
    this.maybeEndVote()
  }
  private vote(i: number) {
    if (this.phase !== "vote" || !this.myAlive || this.myVote !== -9) return
    this.myVote = i
    if (i >= 0) this.votes[i]++
    this.toast(i >= 0 ? "You voted " + this.bots[i].name : "You skipped")
    this.clearSigns()
    this.maybeEndVote()
  }
  private maybeEndVote() {
    if ((this.myVote !== -9) && this.bots.every((b, k) => !b.alive || this.botVote[k] !== -9)) this.phaseEnd = Math.min(this.phaseEnd, Date.now() + 1500)
  }
  private resolveVote() {
    const youVotes = this.botVote.filter((v) => v === -2).length
    const skips = this.botVote.filter((v) => v === -1).length + (this.myVote === -1 ? 1 : 0)
    let top = -1, tv = 0, tie = false
    this.votes.forEach((v, i) => { if (v > tv) { tv = v; top = i; tie = false } else if (v === tv && v > 0) tie = true })
    this.clearSigns()
    if (youVotes > tv && youVotes > skips) {
      this.myAlive = false
      this.toast("YOU were voted out · you WERE the imposter", 6000)
      this.blockPile(new vec3(this.camPos().x, this.floorY, this.camPos().z), ST.enemy, 60, 999)
      this.finish("crew", "The crew caught you")
      return
    }
    if (top < 0 || tie || skips >= tv) { this.toast(tie ? "Tie · nobody was ejected" : "Skipped · nobody was ejected", 4000); this.resume(); return }
    const b = this.bots[top]
    b.alive = false
    this.phase = "eject"
    this.phaseEnd = Date.now() + 4500
    this.toast(b.name + (b.imp ? " WAS the imposter!" : " was NOT the imposter"), 5000)
    // flies up and bursts into blocks
    this.ejected = b.peng
    this.fx.push({obj: b.peng.root, t: 0, life: 2.2, vel: new vec3(0, 160, 0), spin: new vec3(0, 6, 0), onDone: () => { this.burst(b.peng.pos.add(new vec3(0, 330, 0)), b.color, 40, 10); this.ejected = null }})
    this.bots[top].peng.root.enabled = true
  }
  private resume() {
    this.phase = "play"
    this.bots.forEach((b) => { b.saw = b.imp ? b.saw : (b.saw === -1 && this.imImp ? -1 : -3) })
    this.makeSigns()
    if (!this.checkWin()) this.killReady = Math.max(this.killReady, Date.now() + 15000)
  }
  private checkWin(): boolean {
    if (this.phase === "end") return true
    const crew = this.bots.filter((b) => b.alive && !b.imp).length + (this.myAlive && !this.imImp ? 1 : 0)
    const imps = this.bots.filter((b) => b.alive && b.imp).length + (this.myAlive && this.imImp ? 1 : 0)
    if (imps === 0) { this.finish("crew", "The imposter is gone"); return true }
    if (imps >= crew) { this.finish("imposter", "Too few crew left"); return true }
    if (this.doneTasks >= this.totalTasks) { this.finish("crew", "All tasks done"); return true }
    return false
  }
  private finish(winner: string, why: string) {
    this.phase = "end"
    this.endTask()
    const win = (winner === "imposter") === this.imImp
    this.toast((winner === "crew" ? "CREW WINS" : "IMPOSTER WINS") + " · " + why + (win ? " · YOU WIN" : " · YOU LOSE"), 20000)
    this.bots.forEach((b) => { if (b.alive && b.imp) { b.peng.label.text = b.name + " · IMPOSTER"; b.peng.label.textFill.color = ST.enemy } })
    for (let k = 0; k < 4; k++) this.burst(this.camPos().add(this.flatDir().uniformScale(200)).add(new vec3((k - 1.5) * 60, 40, 0)), winner === "crew" ? ST.friendly : ST.enemy, 24)
    this.makeSigns()
  }

  // ------------------------------------------------------------------ per frame
  private tick(dt: number) {
    if (!this.game) return
    const now = Date.now()
    this.tickBots(dt)
    if (this.ejected) {
      const tr = this.ejected.root.getTransform()
      this.ejected.pos = tr.getWorldPosition()
    }
    this.bodies.forEach((b) => { const tr = b.marker.getTransform(); tr.setWorldPosition(b.pos.add(new vec3(0, 70 + Math.sin(this.time * 4) * 6, 0))); this.faceCamera(tr) })
    this.stations.forEach((s) => { const l = s.obj.getChild(s.obj.getChildrenCount() - 1).getTransform(); const v = this.camPos().sub(l.getWorldPosition()); const f = new vec3(v.x, 0, v.z); if (f.length > 1) l.setWorldRotation(quat.lookAt(f.normalize(), vec3.up())) })
    if (this.emergency) { const l = this.emergency.getChild(this.emergency.getChildrenCount() - 1).getTransform(); const v = this.camPos().sub(l.getWorldPosition()); const f = new vec3(v.x, 0, v.z); if (f.length > 1) l.setWorldRotation(quat.lookAt(f.normalize(), vec3.up())) }
    for (const s of this.signs) s.text.textFill.color = this.gazeAngle(s.obj.getTransform().getWorldPosition()) < 7 * D2R ? ST.objective : ST.text
    // beacon over your next task
    let next = -1
    if (this.phase === "play" && this.myAlive && !this.imImp && this.myTasks.length) {
      let bd = 1e9
      for (const st of this.myTasks) { const dd = this.flatDist(this.stations[st].pos, this.camPos()); if (dd < bd) { bd = dd; next = st } }
    }
    if (next !== this.beaconFor) {
      if (this.beacon) this.beacon.destroy()
      this.beacon = next >= 0 ? this.makeBeacon(this.stations[next].pos, ST.objective, "TASK") : null
      this.beaconFor = next
    }
    this.faceBeacon(this.beacon)
    // HUD
    const pct = Math.round((100 * this.doneTasks) / Math.max(1, this.totalTasks))
    this.kicker.text = "iYiYi · BESIDE THEM · " + (this.imImp ? "IMPOSTER" : "CREW") + (this.myAlive ? "" : " · OUT")
    if (this.phase === "play") {
      if (this.task) this.tickTask(dt)
      else {
        let line = "TASKS " + pct + "%"
        if (this.imImp) line += "   KILL " + (now >= this.killReady ? "READY" : Math.ceil((this.killReady - now) / 1000) + "s")
        else if (next >= 0) line += "   NEXT: " + this.stations[next].name + "  " + this.arrowTo(this.stations[next].pos)
        else if (!this.myTasks.length) line += "   YOUR TASKS ARE DONE"
        const near = this.nearStation()
        if (near >= 0 && (this.imImp || this.myTasks.indexOf(near) >= 0)) line += "\nPINCH TO START " + this.stations[near].name
        if (this.bodies.some((b) => this.flatDist(b.pos, this.camPos()) < 320)) line += "\nLOOK AT THE BODY + PINCH TO REPORT"
        this.hud.text = line
      }
    } else if (this.phase === "meeting") {
      this.hud.text = "MEETING · DISCUSS  " + Math.max(0, Math.ceil((this.phaseEnd - now) / 1000)) + "s"
      if (now > this.talkAt && this.talkQ.length) { const [i, s] = this.talkQ.shift(); if (this.bots[i] && this.bots[i].alive) this.say(this.bots[i].peng, s, 4000); this.talkAt = now + 2200 }
      if (now > this.phaseEnd) this.startVote()
    } else if (this.phase === "vote") {
      const look = this.lookedAtPenguin(this.bots.map((b) => b.peng), (k) => this.bots[k].alive)
      this.bots.forEach((b, i) => { if (b.alive) { b.peng.label.text = (i === look ? "◎ " : "") + b.name + (this.votes[i] ? "  ×" + this.votes[i] : ""); b.peng.label.textFill.color = i === look ? ST.objective : ST.text } })
      this.hud.text = "VOTE  " + Math.max(0, Math.ceil((this.phaseEnd - now) / 1000)) + "s"
      if (now > this.phaseEnd) { this.bots.forEach((b, i) => { if (b.alive && this.botVote[i] === -9) this.botCast(i) }); if (this.myVote === -9) this.myVote = -1; this.resolveVote() }
    } else if (this.phase === "eject") {
      this.hud.text = ""
      if (now > this.phaseEnd) this.resume()
    } else if (this.phase === "end") this.hud.text = "GAME OVER"
  }
}
