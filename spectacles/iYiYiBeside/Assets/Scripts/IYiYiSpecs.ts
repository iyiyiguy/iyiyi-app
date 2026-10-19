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
        if (this.mode !== "menu" && this.envTapped(tp)) return
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
    if (down && right && this.envPinch()) return // the WORLD tag: next environment
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
    this.envTick(dt)
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
  // ================================================================== WORLD environments (every Lens)
  // A small "◐ WORLD" tag low on the right: look at it and pinch to switch Snow / Lava / Neon
  // Hallway / Neon City / Tokyo Neon / off. The Specs scan the room with hit tests (surface
  // classification): the floor gets the theme, and light strips run along the bottom of every wall
  // found, glowing onto the floor (plus ceiling lines, neon outlines or signs per theme). With no
  // scanning (Lens Studio preview) a stand-in ring of walls goes up around you.
  // helpers of its own, so this chunk drops into any iYiYi Lens
  private eW = new vec4(1, 1, 1, 1)
  private eHex(h: number): vec4 { return new vec4(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, 1) }
  private eCam(): vec3 { return this.camT ? this.camT.getWorldPosition() : new vec3(0, 0, 0) }
  private eFlat(a: vec3, b: vec3): number { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)) }
  private eZap(o: SceneObject) { if (o && !isNull(o)) o.destroy() }
  private eRight(d: vec3): vec3 { return quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(d) }
  private eGaze(p: vec3): number { return Math.acos(Math.max(-1, Math.min(1, p.sub(this.eCam()).normalize().dot(this.viewDir())))) }
  private envTheme = "none"
  private envRoot: SceneObject = null
  private envGround: SceneObject = null
  private envGroundAt: vec3 = null
  private envFlakes: {o: SceneObject; v: number}[] = []
  private envTag: SceneObject = null
  private envHits: ({p: vec3; n: vec3} | null)[] = []
  private envSegs: {[k: string]: SceneObject} = {}
  private envSession: any = null
  private envScanI = 0
  private envSince = 0
  private envFallback: SceneObject = null
  private envFloorSeen = false
  private envLoaded = false
  private ENV_THEMES = ["none", "snow", "lava", "hall", "city", "tokyo"]
  private ENV_NAMES: {[k: string]: string} = {none: "OFF", snow: "SNOW DAY", lava: "LAVA", hall: "NEON HALLWAY", city: "NEON CITY", tokyo: "TOKYO NEON"}
  private envCols(): vec4[] {
    const t = this.envTheme
    if (t === "snow") return [this.eHex(0x9be8ff)]
    if (t === "lava") return [this.eHex(0xff4a1a), this.eHex(0xffb21e)]
    if (t === "hall") return [this.eHex(0xb070ff), this.eHex(0xd9b3ff)]
    if (t === "city") return [this.eHex(0xff2bd6), this.eHex(0x39d5ff), this.eHex(0x5cff7a), this.eHex(0xffe633)]
    return [this.eHex(0xff2b7a), this.eHex(0x39d5ff), this.eHex(0xff3d3d), this.eHex(0xffb21e)]
  }
  private dim(c: vec4, k: number): vec4 { return new vec4(c.r * k, c.g * k, c.b * k, 1) }

  private envTick(dt: number) {
    if (!this.envLoaded) {
      this.envLoaded = true
      try { const s = global.persistentStorageSystem.store.getString("iyiyi_world_theme"); if (s && this.ENV_THEMES.indexOf(s) >= 0) this.envSet(s, false) } catch (e) {}
    }
    this.placeEnvTag()
    if (this.envTheme === "none" || !this.camT) return
    const cam = this.eCam()
    // ground: anchored in the world, rebuilt when you've walked a few metres away
    if (!this.envGroundAt || this.eFlat(cam, this.envGroundAt) > 300) this.envBuildGround()
    // falling snow / rising embers / floating motes around you
    for (const f of this.envFlakes) {
      if (isNull(f.o)) continue
      const tr = f.o.getTransform(), p = tr.getWorldPosition()
      let y = p.y + f.v * dt, x = p.x + Math.sin(this.time + f.v) * dt * 12, z = p.z
      if (y < this.floorY) y = this.floorY + 400
      if (y > this.floorY + 400) y = this.floorY
      if (x - cam.x > 500) x -= 1000; if (x - cam.x < -500) x += 1000; if (z - cam.z > 500) z -= 1000; if (z - cam.z < -500) z += 1000
      tr.setWorldPosition(new vec3(x, y, z))
    }
    this.envScan()
  }
  private placeEnvTag() {
    if (!this.camT || this.mode === "intro" || this.mode === "menu") { if (this.envTag) { this.eZap(this.envTag); this.envTag = null } return }
    if (!this.envTag) this.envTag = this.makeText("", 2.4, LG.muted)
    const cam = this.eCam(), d = this.flatDir(), tr = this.envTag.getTransform()
    tr.setWorldPosition(cam.add(d.uniformScale(70)).add(this.eRight(d).uniformScale(40)).add(new vec3(0, -42, 0)))
    tr.setWorldRotation(quat.lookAt(cam.sub(tr.getWorldPosition()).normalize(), vec3.up()))
    const t = this.envTag.getComponent("Component.Text") as Text
    t.text = "◐ WORLD: " + this.ENV_NAMES[this.envTheme]
    t.textFill.color = this.envLookedAt() ? LG.objective : LG.muted
  }
  private envLookedAt(): boolean { return !!this.envTag && this.eGaze(this.envTag.getTransform().getWorldPosition()) < 8 * D2R }
  /** Lens Studio preview: a click on the WORLD tag */
  private envTapped(tp: vec2): boolean {
    if (!this.envTag || !this.camComp) return false
    const sp = this.camComp.worldSpaceToScreenSpace(this.envTag.getTransform().getWorldPosition())
    if (Math.abs(sp.x - tp.x) < 0.1 && Math.abs(sp.y - tp.y) < 0.05) { const T = this.ENV_THEMES; this.envSet(T[(T.indexOf(this.envTheme) + 1) % T.length], true); return true }
    return false
  }
  /** pinch while looking at the WORLD tag: next theme */
  private envPinch(): boolean {
    if (!this.envLookedAt()) return false
    const T = this.ENV_THEMES
    this.envSet(T[(T.indexOf(this.envTheme) + 1) % T.length], true)
    return true
  }
  private envSet(id: string, announce: boolean) {
    this.envClear()
    this.envTheme = id
    try { global.persistentStorageSystem.store.putString("iyiyi_world_theme", id) } catch (e) {}
    if (announce) this.toast(id === "none" ? "WORLD OFF" : this.ENV_NAMES[id] + " · LOOK AROUND TO SCAN THE ROOM", 3500)
    if (id === "none") return
    this.envRoot = global.scene.createSceneObject("iyEnv")
    this.envSince = Date.now()
    this.envHits = []
    for (let i = 0; i < 36; i++) this.envHits.push(null)
    try {
      if (!this.envSession) {
        const wq = require("LensStudio:WorldQueryModule") as WorldQueryModule
        const o = HitTestSessionOptions.create(); o.filter = false
        try { o.classification = true } catch (e) {}
        this.envSession = wq.createHitTestSessionWithOptions(o)
      }
      this.envSession.start()
    } catch (e) { this.envSession = null }
    const n = id === "snow" ? 70 : id === "lava" ? 40 : 24, c = id === "snow" ? this.eW : id === "lava" ? this.eHex(0xff7a1a) : this.envCols()[0]
    const cam = this.eCam()
    for (let i = 0; i < n; i++) {
      const s = id === "snow" ? 2.5 : 2
      const o = this.block(new vec3(cam.x + (Math.random() - 0.5) * 1000, this.floorY + Math.random() * 400, cam.z + (Math.random() - 0.5) * 1000), new vec3(s, s, s), c, this.envRoot)
      if (o) this.envFlakes.push({o, v: id === "snow" ? -(40 + Math.random() * 50) : id === "lava" ? 30 + Math.random() * 70 : (Math.random() - 0.5) * 10})
    }
  }
  private envClear() {
    if (this.envRoot) this.eZap(this.envRoot)
    this.envRoot = null; this.envGround = null; this.envGroundAt = null; this.envFlakes = []; this.envSegs = {}; this.envFallback = null
    try { if (this.envSession) this.envSession.stop() } catch (e) {}
  }
  private envBuildGround() {
    if (this.envGround) this.eZap(this.envGround)
    const cam = this.eCam(), at = new vec3(Math.round(cam.x / 100) * 100, this.floorY, Math.round(cam.z / 100) * 100)
    this.envGroundAt = at
    const g = global.scene.createSceneObject("iyEnvGround"); g.setParent(this.envRoot); this.envGround = g
    const y = this.floorY + 0.6, R = 450, t = this.envTheme, cols = this.envCols()
    const flat = (x: number, z: number, sx: number, sz: number, c: vec4, rot: number = 0) => { const o = this.block(new vec3(at.x + x, y, at.z + z), new vec3(sx, 0.6, sz), c, g); if (o && rot) o.getTransform().setWorldRotation(quat.angleAxis(rot, vec3.up())); return o }
    if (t === "snow") { for (let i = 0; i < 70; i++) { const r = Math.sqrt(Math.random()) * R, a = Math.random() * 6.283, s = 30 + Math.random() * 90; flat(Math.cos(a) * r, Math.sin(a) * r, s, s * (0.5 + Math.random() * 0.5), this.dim(this.eW, 0.22 + Math.random() * 0.2), Math.random() * 3) } }
    else if (t === "lava") {
      for (let k = 0; k < 9; k++) { let x = (Math.random() - 0.5) * 2 * R, z = (Math.random() - 0.5) * 2 * R, a = Math.random() * 6.283
        for (let i = 0; i < 9; i++) { const nx = x + Math.cos(a) * 32, nz = z + Math.sin(a) * 32; flat((x + nx) / 2, (z + nz) / 2, 3.5, 34, i % 3 ? this.eHex(0xff6a1a) : this.eHex(0xffd060), -a + Math.PI / 2); x = nx; z = nz; a += (Math.random() - 0.5) * 1.2 } }
      for (let i = 0; i < 6; i++) flat((Math.random() - 0.5) * 2 * R, (Math.random() - 0.5) * 2 * R, 40, 40, this.dim(this.eHex(0xff5a1a), 0.45), Math.random() * 3)
    } else if (t === "city") { for (let i = -4; i <= 4; i++) { flat(i * 100, 0, 1.5, 2 * R, this.dim(this.eHex(0x39d5ff), 0.8)); flat(0, i * 100, 2 * R, 1.5, this.dim(this.eHex(0xff2bd6), 0.8)) } }
    else if (t === "hall") { for (let i = 0; i < 18; i++) flat((Math.random() - 0.5) * 2 * R, (Math.random() - 0.5) * 2 * R, 8 + Math.random() * 14, 120 + Math.random() * 200, this.dim(cols[i % 2], 0.25)) }
    else { for (let i = 0; i < 26; i++) flat((Math.random() - 0.5) * 2 * R, (Math.random() - 0.5) * 2 * R, 5 + Math.random() * 12, 60 + Math.random() * 160, this.dim(cols[i % cols.length], 0.35)) }
  }
  /** cast a few rays a frame around you: walls (classified, or upright normals) at chest height + the floor */
  private envScan() {
    const cam = this.eCam()
    if (this.envSession) {
      try {
        // floor: straight down
        if (this.envScanI % 6 === 0) this.envSession.hitTest(cam, cam.add(new vec3(0, -400, 0)), (h: WorldQueryHitTestResult) => { if (h && h.normal.y > 0.8 && cam.y - h.position.y > 80) { this.floorY = this.envFloorSeen ? this.floorY * 0.9 + h.position.y * 0.1 : h.position.y; this.envFloorSeen = true } })
        for (let k = 0; k < 2; k++) {
          const i = this.envScanI++ % 36, a = i * 10 * D2R, dir = new vec3(Math.sin(a), -0.15, -Math.cos(a)).normalize()
          const from = cam.add(new vec3(0, -30, 0))
          this.envSession.hitTest(from, from.add(dir.uniformScale(800)), (h: WorldQueryHitTestResult) => {
            if (!this.envRoot) return
            let wall = h && Math.abs(h.normal.y) < 0.35
            try { if (h && h.classification === SurfaceClassification.Wall) wall = true; if (h && (h.classification === SurfaceClassification.Ground || h.classification === SurfaceClassification.Table)) wall = false } catch (e) {}
            const prev = this.envHits[i]
            this.envHits[i] = wall ? {p: h.position, n: new vec3(h.normal.x, 0, h.normal.z).normalize()} : null
            if (!!prev !== !!this.envHits[i] || (prev && this.envHits[i] && prev.p.distance(this.envHits[i].p) > 40)) { this.envSeg(i); this.envSeg((i + 35) % 36) }
          })
        }
      } catch (e) {}
    }
    // nothing found after a few seconds (Lens Studio preview): stand-in walls
    const found = this.envHits.some((h) => !!h)
    if (!found && !this.envFallback && Date.now() - this.envSince > 4000) this.envBuildFallback()
    if (found && this.envFallback) { this.eZap(this.envFallback); this.envFallback = null }
  }
  /** the strip between scan bins i and i+1, when both hit the same wall */
  private envSeg(i: number) {
    const key = "s" + i
    if (this.envSegs[key]) { this.eZap(this.envSegs[key]); delete this.envSegs[key] }
    const a = this.envHits[i], b = this.envHits[(i + 1) % 36]
    if (!a || !b || a.n.dot(b.n) < 0.8 || a.p.distance(b.p) > 180) return
    const g = global.scene.createSceneObject("iyEnvSeg"); g.setParent(this.envRoot)
    this.envWall(g, new vec3(a.p.x, this.floorY, a.p.z), new vec3(b.p.x, this.floorY, b.p.z), a.n.add(b.n).normalize(), 260, i)
    this.envSegs[key] = g
  }
  /** decorate one wall: floor line a→b, room-facing normal n, wall height h (cm) */
  private envWall(g: SceneObject, a: vec3, b: vec3, n: vec3, h: number, idx: number) {
    const cols = this.envCols(), c1 = cols[idx % cols.length], c2 = cols[(idx + 1) % cols.length], t = this.envTheme
    const line = (p: vec3, q: vec3, c: vec4, glowUp: number) => {
      const len = p.distance(q); if (len < 8) return
      const mid = p.add(q).uniformScale(0.5), rot = quat.lookAt(q.sub(p).normalize(), vec3.up())
      const put = (pos: vec3, size: vec3, col: vec4) => { const o = this.block(pos, size, col, g); if (o) o.getTransform().setWorldRotation(rot) }
      put(mid, new vec3(2.5, 2.5, len), this.eW)
      put(mid, new vec3(6, 6, len + 3), c)
      if (glowUp !== 0) {
        put(mid.add(new vec3(0, glowUp * 22, 0)).add(n.uniformScale(1)), new vec3(0.5, 40, len), this.dim(c, 0.28)) // wash on the wall
        if (glowUp > 0) put(new vec3(mid.x, this.floorY + 0.8, mid.z).add(n.uniformScale(35)), new vec3(66, 0.5, len), this.dim(c, 0.3)) // reflection on the floor
      }
    }
    const up = (p: vec3, y: number) => new vec3(p.x, this.floorY + y, p.z)
    line(up(a, 3), up(b, 3), c1, 1)
    if (t === "hall") { line(up(a, Math.min(h, 250)), up(b, Math.min(h, 250)), c2, -1); line(up(a, 95).add(n), up(b, 95).add(n), cols[0], 0); line(up(a, 135).add(n), up(b, 135).add(n), cols[0], 0) }
    else if (t === "city") { line(up(a, 3), up(a, h), c2, 0); line(up(b, 3), up(b, h), c2, 0); line(up(a, h), up(b, h), c1, 0) }
    else if (t === "lava") line(up(a, 18).add(n), up(b, 18).add(n), c2, 0)
    else if (t === "tokyo") {
      const mid = a.add(b).uniformScale(0.5).add(n.uniformScale(4)), words = ["RAMEN", "TOKYO", "iYiYi", "24H", "BAR", "KARAOKE", "SUSHI", "GAME"]
      const s = this.makeText(words[idx % words.length], 6, c2); s.setParent(g)
      const tx = s.getComponent("Component.Text") as Text; tx.depthTest = true
      s.getTransform().setWorldPosition(new vec3(mid.x, this.floorY + 200 + (idx % 3) * 35, mid.z)); s.getTransform().setWorldRotation(quat.lookAt(n, vec3.up()))
      this.block(new vec3(mid.x, this.floorY + 200 + (idx % 3) * 35, mid.z).add(n.uniformScale(-1)), new vec3(Math.max(40, a.distance(b) * 0.8), 26, 1), this.dim(c2, 0.22), g)
      for (let k = 0; k < 2; k++) { const lp = a.add(b.sub(a).uniformScale(0.25 + k * 0.5)).add(n.uniformScale(15)); this.block(new vec3(lp.x, this.floorY + 240, lp.z), new vec3(14, 20, 14), this.eHex(0xff3d3d), g) }
    }
  }
  private envBuildFallback() {
    const g = global.scene.createSceneObject("iyEnvFallback"); g.setParent(this.envRoot); this.envFallback = g
    const cam = this.eCam(), d = this.flatDir()
    if (this.envTheme === "hall") {
      const r = this.eRight(d)
      for (const s of [-1, 1]) { const a = cam.add(r.uniformScale(s * 160)).add(d.uniformScale(-300)), b = cam.add(r.uniformScale(s * 160)).add(d.uniformScale(1200)); this.envWall(g, new vec3(a.x, this.floorY, a.z), new vec3(b.x, this.floorY, b.z), r.uniformScale(-s), 260, s + 2) }
      return
    }
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * 6.283, a1 = ((i + 0.7) / 8) * 6.283, R = 550 + (i % 3) * 140
      const a = new vec3(cam.x + Math.sin(a0) * R, this.floorY, cam.z + Math.cos(a0) * R), b = new vec3(cam.x + Math.sin(a1) * R, this.floorY, cam.z + Math.cos(a1) * R)
      const mid = a.add(b).uniformScale(0.5), n = new vec3(cam.x - mid.x, 0, cam.z - mid.z).normalize()
      this.envWall(g, a, b, n, this.envTheme === "city" ? 300 + (i % 4) * 150 : 300, i)
    }
  }

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
      this.introObjs.push(p.root)
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
    this.stations.forEach((s) => this.zap(s.obj))
    this.bots.forEach((b) => this.zap(b.peng.root))
    this.bodies.forEach((b) => this.zap(b.marker))
    if (this.emergency) this.zap(this.emergency)
    if (this.beacon) this.zap(this.beacon)
    if (this.ejected) this.zap(this.ejected.root)
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
  private clearSigns() { this.signs.forEach((s) => this.zap(s.obj)); this.signs = [] }
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
  private endTask() { if (this.task) { this.task.pads.forEach((p) => this.zap(p)); this.task = null } }
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
    this.bodies.forEach((x) => this.zap(x.marker))
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
      if (this.beacon) this.zap(this.beacon)
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
