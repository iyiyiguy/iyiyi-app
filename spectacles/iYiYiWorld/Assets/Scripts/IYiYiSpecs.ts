// iYiYi WORLD for Snap Spectacles (this project's one script; the file keeps the template's name
// so the scene's component reference stays wired).
//
// A candy-coloured obstacle course built on the floor of your real space (room, yard or park),
// raced against three penguin rivals. Walk the track and use your body:
//   JUMP over the low spinning sweepers, DUCK under the high ones (the Specs watch your head
//   height), time the swinging hammers, keep moving on the falling tiles, pick the door that
//   breaks, bounce on the pads, grab the stars. Bonks cost 3 seconds. Best times are saved.
// Lens Studio preview: click = jump (walk the camera along the track).
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

type Obs = {kind: string; s: number; root: SceneObject; arm: SceneObject; speed: number; phase: number; ang: number; hitAt: number; tiles: {o: SceneObject; row: number; c: number; stepped: number; fallen: number; col: vec4}[]; doors: SceneObject[]; real: number; passed: boolean; pad: SceneObject}
type Rival = {p: Penguin; s: number; lat: number; speed: number; pause: number; done: number}
const CANDY = [hex(0xff4fa3), hex(0xffe633), hex(0x39d5ff), hex(0xb06cff), hex(0x5cf27f), hex(0xff8a33)]
const AREAS = [{name: "ROOM", w: 260, d: 280}, {name: "YARD", w: 700, d: 700}, {name: "PARK", w: 1200, d: 1600}]
const LANE = 130
const BEST_KEY = "iyiyi_world_best_"

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

  // ================================================================== World
  private area = 1
  private course: SceneObject = null
  private path: vec3[] = []
  private segLen: number[] = []
  private total = 0
  private obs: Obs[] = []
  private stars: SceneObject[] = []
  private rivals: Rival[] = []
  private finishArch: SceneObject = null
  private head0 = 0
  private calib: number[] = []
  private countdown = 0
  private t0 = 0
  private penalty = 0
  private stun = 0
  private prog = 0
  private got = 0
  private done = false
  private doneAt = 0
  private place = 0
  private fakeJump = 0
  private running = false

  onAwake() {
    this.initKit()
    this.startIntro("iYiYi WORLD")
  }
  private introProps() {
    const d = this.flatDir(), cam = this.camPos()
    for (let i = 0; i < 6; i++) {
      const o = this.block(new vec3(cam.x + d.x * (250 + i * 60), this.floorY + 60 + i * 25, cam.z + d.z * (250 + i * 60)), new vec3(30, 30, 30), CANDY[i])
      if (o) { this.introObjs.push(o); this.fx.push({obj: o, t: 0, life: 5.4, spin: new vec3(1, 2, 0.5)}) }
    }
  }
  private onMenuOpen() {}
  private best(): number { try { return global.persistentStorageSystem.store.getFloat(BEST_KEY + this.area) || 0 } catch (e) { return 0 } }
  private menuItems(): [string, string][] {
    const items: [string, string][] = []
    if (this.running && !this.done) items.push(["RESUME", "resume"])
    const b = this.best()
    items.push(["START THE COURSE" + (b ? " (BEST " + b.toFixed(1) + " S)" : ""), "go"], ["SPACE: " + AREAS[this.area].name, "area"])
    return items
  }
  private runButton(b: Btn) {
    if (b.action === "area") { this.area = (this.area + 1) % 3; this.relabel("area", "SPACE: " + AREAS[this.area].name); this.toast(["About 3 x 3 m", "About 8 x 8 m", "Up to about 20 m"][this.area]); return }
    if (b.action === "resume") { this.setMode("game"); return }
    this.setMode("game")
    this.build()
  }
  private onPinch(right: boolean, down: boolean) { if (down && right) this.fakeJump = Date.now() + 650 }
  private onTap(tp: vec2) { this.fakeJump = Date.now() + 650 }

  // ------------------------------------------------------------------ course
  private sAt(s: number): {pos: vec3; dir: vec3; edge: number} {
    let acc = 0
    for (let i = 0; i < this.segLen.length; i++) {
      const l = this.segLen[i]
      if (s <= acc + l || i === this.segLen.length - 1) { const a = this.path[i], b = this.path[i + 1], dir = b.sub(a).normalize(), u = Math.max(0, Math.min(l, s - acc)); return {pos: a.add(dir.uniformScale(u)), dir, edge: Math.min(u, l - u)} }
      acc += l
    }
    return {pos: this.path[0], dir: new vec3(0, 0, -1), edge: 0}
  }
  private project(p: vec3): {s: number; d: number; lat: number} {
    let best = {s: 0, d: 1e9, lat: 0}, acc = 0
    for (let i = 0; i < this.segLen.length; i++) {
      const a = this.path[i], b = this.path[i + 1], dir = b.sub(a).normalize(), l = this.segLen[i]
      const rel = new vec3(p.x - a.x, 0, p.z - a.z), u = Math.max(0, Math.min(l, rel.dot(dir))), lat = rel.dot(this.rightOf(dir)), q = a.add(dir.uniformScale(u)), d = this.flatDist(p, q)
      if (d < best.d) best = {s: acc + u, d, lat}
      acc += l
    }
    return best
  }
  private clearCourse() { if (this.course) this.zap(this.course); this.course = null; this.rivals.forEach((r) => this.zap(r.p.root)); this.rivals = []; this.obs = []; this.stars = [] }
  private build() {
    this.clearCourse()
    const A = AREAS[this.area], cam = this.camPos(), f = this.flatDir(), r = this.rightOf(f)
    this.course = global.scene.createSceneObject("iyCourse")
    const lanes = Math.max(2, Math.floor(A.w / LANE))
    const start = new vec3(cam.x, this.floorY, cam.z).add(f.uniformScale(60)).add(r.uniformScale(-((lanes - 1) * LANE) / 2))
    this.path = []
    for (let i = 0; i < lanes; i++) { const a = start.add(r.uniformScale(i * LANE)), b = a.add(f.uniformScale(A.d)); if (i % 2) this.path.push(b, a); else this.path.push(a, b) }
    this.segLen = []; this.total = 0
    for (let i = 0; i < this.path.length - 1; i++) { const l = this.path[i].distance(this.path[i + 1]); this.segLen.push(l); this.total += l }
    // candy track + rails
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1], dir = b.sub(a).normalize(), len = this.segLen[i], rot = quat.lookAt(dir, vec3.up()), side = this.rightOf(dir)
      for (let s = 0; s < len; s += 50) { const c = CANDY[(i + Math.floor(s / 50)) % 6]; const o = this.block(a.add(dir.uniformScale(s + 25)).add(new vec3(0, 0.6, 0)), new vec3(LANE * 0.92, 0.8, 48), new vec4(c.r * 0.35, c.g * 0.35, c.b * 0.35, 1), this.course); if (o) o.getTransform().setWorldRotation(rot) }
      for (const sd of [-1, 1]) { const o = this.block(a.add(dir.uniformScale(len / 2)).add(side.uniformScale(sd * LANE * 0.5)).add(new vec3(0, 5, 0)), new vec3(5, 10, len), sd < 0 ? CANDY[0] : CANDY[2], this.course); if (o) o.getTransform().setWorldRotation(rot) }
    }
    this.arch(0, "START", CANDY[2]); this.finishArch = this.arch(this.total - 5, "FINISH", CANDY[1])
    const kinds = ["sweepLow", "hammer", "tiles", "bounce", "sweepHigh", "doors", "hammer", "tiles", "sweepLow", "bounce", "doors", "sweepHigh"]
    let k = Math.floor(Math.random() * 3)
    for (let s = 160; s < this.total - 120; s += 260) { if (this.sAt(s).edge < 70) continue; this.obstacle(kinds[k++ % kinds.length], s) }
    for (let s = 110; s < this.total - 60; s += 170) { const p = this.sAt(s); const o = this.block(p.pos.add(this.rightOf(p.dir).uniformScale((Math.random() - 0.5) * 70)).add(new vec3(0, 110 + Math.random() * 40, 0)), new vec3(12, 12, 12), CANDY[1], this.course); if (o) this.stars.push(o) }
    const names = ["BEANZ", "WOBBLE", "SPLAT"]
    for (let i = 0; i < 3; i++) this.rivals.push({p: this.makePenguin(this.path[0], "crew", CANDY[[0, 4, 3][i]], names[i], 0.6), s: -30 - i * 30, lat: (i - 1) * 35, speed: 55 + Math.random() * 30, pause: 0, done: 0})
    this.calib = []; this.countdown = Date.now() + 3200; this.penalty = 0; this.stun = 0; this.prog = 0; this.got = 0; this.done = false; this.running = true
    this.toast("STAND TALL AT THE START · 3", 1500)
  }
  private arch(s: number, text: string, c: vec4): SceneObject {
    const p = this.sAt(s), g = global.scene.createSceneObject("iyArch"); g.setParent(this.course)
    for (const sd of [-1, 1]) this.part(g, sd * LANE * 0.55, 110, 0, 12, 220, 12, c)
    this.part(g, 0, 220, 0, LANE * 1.22, 16, 12, c)
    const t = this.makeText(text, 5, c); t.setParent(g); t.getTransform().setLocalPosition(new vec3(0, 250, 0))
    g.getTransform().setWorldPosition(p.pos); g.getTransform().setWorldRotation(quat.lookAt(p.dir.uniformScale(-1), vec3.up()))
    return g
  }
  private obstacle(kind: string, s: number) {
    const p = this.sAt(s), g = global.scene.createSceneObject("iyObs"); g.setParent(this.course)
    g.getTransform().setWorldPosition(p.pos); g.getTransform().setWorldRotation(quat.lookAt(p.dir, vec3.up()))
    const o: Obs = {kind, s, root: g, arm: null, speed: 0, phase: Math.random() * 6, ang: 0, hitAt: 0, tiles: [], doors: [], real: 0, passed: false, pad: null}
    const col = CANDY[this.obs.length % 6], white = new vec4(0.95, 0.96, 0.97, 1)
    if (kind === "sweepLow" || kind === "sweepHigh") {
      const h = kind === "sweepLow" ? 28 : 125
      this.part(g, 0, h / 2, 0, 14, h, 14, white)
      o.arm = global.scene.createSceneObject("iyArm"); o.arm.setParent(g); o.arm.getTransform().setLocalPosition(new vec3(0, h, 0))
      this.part(o.arm, 0, 0, 0, LANE * 1.05, 9, 9, col); this.part(o.arm, LANE * 0.52, 0, 0, 14, 14, 14, CANDY[1]); this.part(o.arm, -LANE * 0.52, 0, 0, 14, 14, 14, CANDY[1])
      o.speed = (kind === "sweepLow" ? 1.6 : 1.3) * (Math.random() < 0.5 ? 1 : -1)
      const t = this.makeText(kind === "sweepLow" ? "JUMP!" : "DUCK!", 3.5, kind === "sweepLow" ? CANDY[1] : CANDY[2]); t.setParent(g); t.getTransform().setLocalPosition(new vec3(0, kind === "sweepLow" ? 100 : 175, 0))
    } else if (kind === "hammer") {
      this.part(g, -LANE * 0.62, 120, 0, 10, 240, 10, white); this.part(g, LANE * 0.62, 120, 0, 10, 240, 10, white); this.part(g, 0, 240, 0, LANE * 1.3, 10, 10, white)
      o.arm = global.scene.createSceneObject("iyHammer"); o.arm.setParent(g); o.arm.getTransform().setLocalPosition(new vec3(0, 240, 0))
      this.part(o.arm, 0, -75, 0, 5, 150, 5, white); this.part(o.arm, 0, -155, 0, 42, 32, 32, col)
      o.speed = 1.9 + Math.random() * 0.6
    } else if (kind === "tiles") {
      for (let row = 0; row < 4; row++) for (let c = 0; c < 3; c++) { const tc = CANDY[(row + c) % 6]; const t = this.part(g, (c - 1) * LANE / 3, 3, (row - 1.5) * 40, LANE / 3 - 4, 5, 36, tc); if (t) o.tiles.push({o: t, row, c, stepped: 0, fallen: 0, col: tc}) }
    } else if (kind === "bounce") {
      o.pad = this.part(g, 0, 4, 0, 70, 8, 70, CANDY[4]); this.part(g, 0, 9, 0, 45, 2, 45, CANDY[1])
    } else if (kind === "doors") {
      o.real = Math.floor(Math.random() * 3)
      for (let i = 0; i < 3; i++) o.doors.push(this.part(g, (i - 1) * LANE / 3, 90, 0, LANE / 3 - 5, 180, 8, CANDY[(i * 2 + this.obs.length) % 6]))
      this.part(g, 0, 185, 0, LANE * 1.05, 10, 12, white)
      const t = this.makeText("PICK A DOOR", 3, white); t.setParent(g); t.getTransform().setLocalPosition(new vec3(0, 215, 0))
    }
    this.obs.push(o)
  }
  private local(o: Obs, p: vec3): vec3 { const inv = o.root.getTransform().getInvertedWorldTransform(); return inv.multiplyPoint(new vec3(p.x, o.root.getTransform().getWorldPosition().y, p.z)) }

  // ------------------------------------------------------------------ play
  private bonk(why: string) {
    const now = Date.now(); if (now < this.stun) return
    this.penalty += 3; this.stun = now + 1200
    this.burst(this.camPos().add(this.flatDir().uniformScale(50)), ST.enemy, 14, 5)
    this.toast(why + " · +3 S", 2000)
  }
  private tick(dt: number) {
    if (!this.running) return
    const now = Date.now(), v = this.camPos()
    this.animate(dt, now)
    if (this.countdown) {
      this.calib.push(v.y)
      this.kicker.text = "iYiYi WORLD"
      this.hud.text = "GET READY · " + Math.max(1, Math.ceil((this.countdown - now) / 1000))
      if (now >= this.countdown) { this.countdown = 0; const c = this.calib.slice().sort((a, b) => a - b); this.head0 = c[Math.floor(c.length / 2)] || v.y; this.t0 = now; this.toast("GO GO GO!", 1500) }
      return
    }
    const pr = this.project(v), onTrack = pr.d < LANE * 0.9
    if (onTrack && pr.s > this.prog && pr.s - this.prog < 250) this.prog = pr.s
    const jumping = v.y > this.head0 + 10 || now < this.fakeJump
    const ducking = v.y < this.head0 - 28
    if (!this.done) {
      for (const o of this.obs) {
        const ds = pr.s - o.s
        if (o.kind === "sweepLow" || o.kind === "sweepHigh") {
          if (Math.abs(ds) > LANE * 0.55 || !onTrack) continue
          const l = this.local(o, v), ang = Math.atan2(l.z, l.x), rad = Math.sqrt(l.x * l.x + l.z * l.z)
          let diff = Math.abs(Math.atan2(Math.sin(ang + o.phase), Math.cos(ang + o.phase))); diff = Math.min(diff, Math.PI - diff)
          if (diff < 0.22 && rad < LANE * 0.55 && rad > 5 && now - o.hitAt > 900) { o.hitAt = now; if (o.kind === "sweepLow" ? !jumping : !ducking) this.bonk(o.kind === "sweepLow" ? "TRIPPED! JUMP NEXT TIME" : "BONK! DUCK NEXT TIME"); else this.toast(o.kind === "sweepLow" ? "NICE JUMP!" : "NICE DUCK!", 1000) }
        } else if (o.kind === "hammer") {
          if (Math.abs(ds) > 30 || !onTrack) continue
          const hx = Math.sin(o.ang) * 155, lat = this.local(o, v).x
          if (Math.abs(lat - hx) < 32 && now - o.hitAt > 1200) { o.hitAt = now; this.bonk("SMACKED BY THE HAMMER") }
        } else if (o.kind === "tiles") {
          if (Math.abs(ds) > 85 || !onTrack) continue
          const l = this.local(o, v), row = Math.floor(l.z / 40 + 2), c = Math.floor(l.x / (LANE / 3) + 1.5)
          const t = o.tiles.find((x) => x.row === row && x.c === c)
          if (t) { if (t.fallen) { if (now - o.hitAt > 1500) { o.hitAt = now; this.bonk("YOU FELL THROUGH!") } } else if (!t.stepped) { t.stepped = now; (t.o.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial = this.mat(ST.enemy) } }
        } else if (o.kind === "bounce") {
          if (Math.abs(ds) < 35 && Math.abs(pr.lat) < 35 && now - o.hitAt > 1500) { o.hitAt = now; this.burst(o.root.getTransform().getWorldPosition().add(new vec3(0, 30, 0)), CANDY[4], 18, 5); this.penalty -= 0.5; this.toast("BOING! -0.5 S", 1200) }
        } else if (o.kind === "doors") {
          if (o.passed || ds < -5 || ds > 40 || !onTrack) continue
          o.passed = true
          const lat = this.local(o, v).x, i = Math.max(0, Math.min(2, Math.round(lat / (LANE / 3)) + 1))
          const d = o.doors[o.real]
          if (d) { this.burst(d.getTransform().getWorldPosition(), CANDY[o.real], 20, 6); this.zap(d); o.doors[o.real] = null }
          if (i === o.real) this.toast("SMASHED THROUGH!", 1200); else this.bonk("SOLID DOOR!")
        }
      }
      for (let i = this.stars.length - 1; i >= 0; i--) { const st = this.stars[i]; if (isNull(st)) continue; const sp = st.getTransform().getWorldPosition(); if (this.flatDist(sp, v) < 35) { this.burst(sp, CANDY[1], 10, 4); this.zap(st); this.stars.splice(i, 1); this.got++ } }
      if (this.prog > this.total - 25) this.finish(now)
    }
    const tNow = ((this.done ? this.doneAt : now) - this.t0) / 1000 + this.penalty
    const place = 1 + this.rivals.filter((r) => (r.done ? r.done : 1e15) < (this.done ? this.doneAt : now) || r.s > this.prog).length
    this.kicker.text = "iYiYi WORLD · ★ " + this.got
    this.hud.text = this.done ? "FINISHED · " + tNow.toFixed(1) + " S · " + this.ord(this.place) : tNow.toFixed(1) + " S · " + this.ord(place) + " · " + Math.round((this.prog / this.total) * 100) + "%" + (jumping ? " · JUMP" : ducking ? " · DUCK" : "")
  }
  private ord(n: number): string { return n + (n === 1 ? "ST" : n === 2 ? "ND" : n === 3 ? "RD" : "TH") }
  private animate(dt: number, now: number) {
    const t = now / 1000
    for (const o of this.obs) {
      if (o.arm && (o.kind === "sweepLow" || o.kind === "sweepHigh")) { o.phase += o.speed * dt; o.arm.getTransform().setLocalRotation(quat.angleAxis(o.phase, vec3.up())) }
      if (o.kind === "hammer") { const a = Math.sin(t * o.speed + o.phase) * 0.95; o.ang = a; o.arm.getTransform().setLocalRotation(quat.angleAxis(a, vec3.forward())) }
      if (o.kind === "bounce" && o.pad) o.pad.getTransform().setLocalScale(new vec3(70, 8 * (1 + Math.max(0, Math.sin(t * 6)) * 0.6), 70))
      for (const tl of o.tiles) {
        if (tl.stepped && !tl.fallen && now - tl.stepped > 900) tl.fallen = now
        const tr = tl.o.getTransform(), lp = tr.getLocalPosition()
        if (tl.fallen) { tr.setLocalPosition(new vec3(lp.x, 3 - Math.min(300, ((now - tl.fallen) / 1000) ** 2 * 490), lp.z)); if (now - tl.fallen > 4000) { tl.fallen = 0; tl.stepped = 0; tr.setLocalPosition(new vec3(lp.x, 3, lp.z)); (tl.o.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial = this.mat(tl.col) } }
      }
    }
    for (const st of this.stars) if (!isNull(st)) st.getTransform().setWorldRotation(quat.angleAxis(t * 3, vec3.up()))
    for (const r of this.rivals) {
      if (!this.countdown && !r.done) {
        if (now >= r.pause) { r.s += r.speed * dt * (this.area === 0 ? 0.5 : 1); if (Math.random() < dt * 0.25) { r.pause = now + 900 + Math.random() * 1200; this.say(r.p, ["OOF!", "BONK", "WHEEE", "NOOO"][Math.floor(Math.random() * 4)], 900) } }
        if (r.s >= this.total - 10) { r.done = now; this.say(r.p, "FINISHED!", 2000) }
      }
      const p = this.sAt(Math.max(0, Math.min(this.total - 10, r.s)))
      r.p.pos = p.pos.add(this.rightOf(p.dir).uniformScale(r.lat))
      this.posePenguin(r.p, r.p.pos.add(p.dir.uniformScale(100)), dt, !this.countdown && !r.done && now >= r.pause)
    }
  }
  private finish(now: number) {
    this.done = true; this.doneAt = now
    const time = (now - this.t0) / 1000 + this.penalty
    this.place = 1 + this.rivals.filter((r) => r.done && r.done < now).length
    const prev = this.best(), pb = !prev || time < prev
    if (pb) try { global.persistentStorageSystem.store.putFloat(BEST_KEY + this.area, time) } catch (e) {}
    this.toast((this.place === 1 ? "YOU WIN! " : this.ord(this.place) + " PLACE · ") + time.toFixed(1) + " S" + (pb ? " · NEW BEST!" : ""), 8000)
    const fp = this.finishArch.getTransform().getWorldPosition()
    for (let k = 0; k < 5; k++) this.burst(fp.add(new vec3((Math.random() - 0.5) * 140, 200 + Math.random() * 50, 0)), CANDY[k % 6], 16, 6)
  }
}
