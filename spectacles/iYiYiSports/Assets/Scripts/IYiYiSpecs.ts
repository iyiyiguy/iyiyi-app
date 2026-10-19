// iYiYi SPORTS for Snap Spectacles (this project's one script; the file keeps the template's
// name so the scene's component reference stays wired).
//
// Start: animated iYiYi SPORTS logo, rackets, paddles and balls rain down, then a look-and-pinch
// menu: Tennis, Pickleball, Ping Pong, Volleyball, Basketball, Bowling, Cornhole, plus Court size.
// Racket sports: the court is laid on the real floor in front of you at its standard size (or a
// backyard scale), net in the middle, the computer plays the far side. Your right hand is the
// racket: swing through the ball to hit it (faster swing = faster ball). Real scoring:
// tennis (15/30/40/deuce/advantage, games), pickleball and ping pong (to 11, win by 2).
// Basketball: a hoop 4.6 m away; pinch, swing your hand up and let go to shoot.
// Lens Studio preview: a click swings for you when the ball is near (no hands in preview).
// Volleyball: 59 × 29.5 ft, 7 ft 11 in net, no bounces, rally scoring to 25. Bowling: 60 ft lane,
// 10 frames with strikes/spares. Cornhole: boards 27 ft away, 1 on the board, 3 in the hole, cancel
// scoring to 21. Throws: pinch, swing, let go.
// Coming next: two players on one court, shop (balls, uniforms).
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

const D2R = Math.PI / 180
const FT = 30.48 // cm per foot
const PAL = [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.82, 0.25, 1), new vec4(0.36, 0.95, 0.63, 1), new vec4(0.69, 0.42, 1, 1), new vec4(1, 0.5, 0.2, 1)]

type Sport = {id: string; name: string; lenFt: number; widFt: number; netFt: number; ballCm: number; speed: number; scoring: "tennis" | "to11" | "to25"; color: vec4; table?: boolean; nobounce?: boolean}
const SPORTS: Sport[] = [
  {id: "tennis", name: "TENNIS", lenFt: 78, widFt: 27, netFt: 3, ballCm: 6.7, speed: 1500, scoring: "tennis", color: new vec4(0.85, 1, 0.2, 1)},
  {id: "pickleball", name: "PICKLEBALL", lenFt: 44, widFt: 20, netFt: 2.9, ballCm: 7.4, speed: 1050, scoring: "to11", color: new vec4(1, 0.9, 0.2, 1)},
  {id: "pingpong", name: "PING PONG", lenFt: 9, widFt: 5, netFt: 0.5, ballCm: 4, speed: 500, scoring: "to11", color: new vec4(1, 0.6, 0.2, 1), table: true},
  {id: "volleyball", name: "VOLLEYBALL", lenFt: 59, widFt: 29.5, netFt: 7.96, ballCm: 21, speed: 900, scoring: "to25", color: new vec4(1, 0.95, 0.84, 1), nobounce: true},
]
type Fx = {obj: SceneObject; t: number; life: number; vel?: vec3; spin?: vec3; gravity?: boolean; floorY?: number}
type Btn = {obj: SceneObject; text: Text; action: string}

@component
export class IYiYiSpecs extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Unlit material (cloned per colour)")
  blockMaterial: Material

  private camT: Transform
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
  private toastT: Text
  private toastUntil = 0
  private backyard = false

  // racket game
  private sport: Sport = null
  private court: SceneObject = null
  private origin: vec3 // centre of the court on the floor
  private fwd: vec3 // from you toward the far side
  private side: vec3
  private scale = 1
  private ball: SceneObject = null
  private ballPos: vec3
  private ballVel: vec3
  private ballLive = false
  private lastHitter = "" // "me" | "cpu"
  private bounces = 0
  private paddle: SceneObject = null
  private cpu: SceneObject = null
  private cpuPos: vec3
  private handPrev: vec3 = null
  private handVel = new vec3(0, 0, 0)
  private serveAt = 0
  private server = "me"
  private pts = {me: 0, cpu: 0}
  private games = {me: 0, cpu: 0}

  // bowling + cornhole
  private pins: {obj: SceneObject; pos: vec3; vel: vec3; hit: boolean; down: boolean; gone: boolean; tilt: number; axis: vec3}[] = []
  private laneL = 1829
  private rolling = false
  private gutter = false
  private frames: number[][] = []
  private frame = 0
  private roll = 0
  private bowlOver = false
  private bags: SceneObject[] = []
  private bag: {obj: SceneObject; pos: vec3; vel: vec3; who: string} = null
  private board: vec3 = null
  private holeP: vec3 = null
  private chTotal = {me: 0, cpu: 0}
  private chRound = {me: 0, cpu: 0}
  private chLeft = {me: 4, cpu: 4}
  private chTurn = "me"
  private chCpuAt = 0
  private tilt = 0
  // basketball
  private hoop: vec3 = null
  private shots = 0
  private makes = 0
  private holding = false

  onAwake() {
    this.camT = this.findCamera()
    if (this.blockMaterial) this.cube = this.makeCube()
    this.hud = this.makeText("", 3, new vec4(1, 1, 1, 1)).getComponent("Component.Text") as Text
    this.toastT = this.makeText("", 3, new vec4(0.22, 0.84, 1, 1)).getComponent("Component.Text") as Text
    if (this.camT) this.floorY = this.camT.getWorldPosition().y - 150
    this.createEvent("UpdateEvent").bind(() => this.update())
    try {
      const r = SIK.HandInputData.getHand("right")
      r.onPinchDown.add(() => this.onPinch(true))
      r.onPinchUp.add(() => this.onPinch(false))
    } catch (e) { print("iYiYi Sports: hands unavailable " + e) }
    try {
      this.createEvent("TapEvent").bind((ev: TapEvent) => {
        if (this.mode === "menu" && this.camComp) {
          const tp = ev.getTapPosition()
          let best: Btn = null, bd = 0.08
          for (const b of this.btns) {
            const sp = this.camComp.worldSpaceToScreenSpace(b.obj.getTransform().getWorldPosition())
            if (Math.abs(sp.y - tp.y) < bd) { bd = Math.abs(sp.y - tp.y); best = b }
          }
          if (best) { this.runButton(best); return }
        }
        if (this.mode === "racket") { this.assistSwing(); return }
        if (this.mode === "hoops") { this.shoot(new vec3(0, 0, 0), true); return }
        if (this.mode === "bowling" || this.mode === "cornhole") { this.throwIt(true); return }
        this.onPinch(true)
      })
    } catch (e) {}
    this.startIntro()
  }

  private onPinch(down: boolean) {
    if (this.mode === "intro" && down) { this.endIntro(); return }
    if (this.mode === "menu" && down) { const g = this.gazed(); if (g) this.runButton(g); return }
    if (this.menuLookedAt() && down) { this.openMenu(); return }
    if (this.mode === "hoops") {
      if (down) this.holding = true
      else if (this.holding) { this.holding = false; this.shoot(this.handVel, false) }
    }
    if (this.mode === "bowling" || this.mode === "cornhole") {
      if (down) this.holding = true
      else if (this.holding) { this.holding = false; this.throwIt(false) }
    }
  }

  private update() {
    const dt = Math.min(0.05, getDeltaTime())
    this.time += dt
    this.modeT += dt
    this.placeHud()
    this.trackHand(dt)
    if (this.mode === "intro") this.tickIntro(dt)
    if (this.mode === "menu") this.tickMenu()
    if (this.mode === "racket") this.tickRacket(dt)
    if (this.mode === "hoops") this.tickHoops(dt)
    if (this.mode === "bowling") this.tickBowling(dt)
    if (this.mode === "cornhole") this.tickCornhole(dt)
    this.tickFx(dt)
    if (Date.now() > this.toastUntil) this.toastT.text = ""
  }

  // ------------------------------------------------------------------ helpers
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
  private viewDir() { return this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1)) }
  private flatDir() { const d = this.viewDir(); const f = new vec3(d.x, 0, d.z); return f.length < 0.001 ? new vec3(0, 0, -1) : f.normalize() }
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
  private toast(s: string, ms: number = 2500) { this.toastT.text = s; this.toastUntil = Date.now() + ms }
  private placeHud() {
    if (!this.camT) return
    const cam = this.camT.getWorldPosition(), d = this.viewDir()
    const r = this.camT.getWorldRotation()
    const up = r.multiplyVec3(new vec3(0, 1, 0))
    const put = (t: Text, y: number) => { const tr = t.getSceneObject().getTransform(); tr.setWorldPosition(cam.add(d.uniformScale(85)).add(up.uniformScale(y))); tr.setWorldRotation(r) }
    put(this.hud, 22)
    put(this.toastT, -16)
  }
  private faceToward(tr: Transform, to: vec3) {
    const v = to.sub(tr.getWorldPosition()); const f = new vec3(v.x, 0, v.z)
    if (f.length > 0.001) tr.setWorldRotation(quat.lookAt(f.normalize(), vec3.up()))
  }
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
    const k = [c.r, c.g, c.b].map((x) => Math.round(x * 20)).join(",")
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
  private burst(at: vec3, c: vec4, n: number) {
    for (let i = 0; i < n; i++) {
      const v = new vec3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().uniformScale(120 + Math.random() * 200)
      const o = this.block(at, new vec3(5, 5, 5), PAL[i % PAL.length])
      if (o) this.fx.push({obj: o, t: 0, life: 0.8, vel: v, spin: new vec3(3, 4, 2)})
    }
  }
  private tickFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt
      const tr = f.obj.getTransform()
      if (f.vel) {
        if (f.gravity) f.vel = new vec3(f.vel.x, f.vel.y - 980 * dt, f.vel.z)
        let p = tr.getWorldPosition().add(f.vel.uniformScale(dt))
        if (f.floorY !== undefined && p.y < f.floorY) { p = new vec3(p.x, f.floorY, p.z); f.vel = new vec3(f.vel.x * 0.5, Math.abs(f.vel.y) * 0.3, f.vel.z * 0.5) }
        tr.setWorldPosition(p)
      }
      if (f.spin) tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)))
      if (f.t >= f.life) { f.obj.destroy(); this.fx.splice(i, 1) }
    }
  }

  // ------------------------------------------------------------------ intro + menu
  private setMode(m: string) {
    this.mode = m; this.modeT = 0
    if (m !== "menu") { this.btns.forEach((b) => b.obj.destroy()); this.btns = [] }
    if (m !== "racket" && m !== "hoops" && m !== "bowling" && m !== "cornhole") this.clearGame()
    this.hud.text = ""
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
  private destroyLogo() { this.logoParts.forEach((p) => p.obj.destroy()); this.logoParts = []; this.logoAnchor = null }
  private startIntro() {
    this.setMode("intro")
    if (!this.camT) return
    this.buildLogo("SPORTS")
    // rackets, paddles and balls rain down and bounce
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    for (let i = 0; i < 18; i++) {
      const p = cam.add(d.uniformScale(150 + Math.random() * 200)).add(new vec3((Math.random() - 0.5) * 250, 150 + Math.random() * 200, 0))
      const isBall = i % 2 === 0
      const o = isBall ? this.block(p, new vec3(8, 8, 8), SPORTS[i % 3].color) : this.block(p, new vec3(22, 30, 3), PAL[i % PAL.length])
      if (o) this.fx.push({obj: o, t: 0, life: 4, vel: new vec3((Math.random() - 0.5) * 60, -50, (Math.random() - 0.5) * 60), spin: new vec3(Math.random() * 3, Math.random() * 3, 0), gravity: true, floorY: this.floorY + 4})
    }
  }
  private tickIntro(dt: number) {
    if (!this.camT) { this.endIntro(); return }
    this.tickLogo(this.modeT)
    if (this.modeT > 5.5) this.endIntro()
  }
  private endIntro() { this.destroyLogo(); this.introObjs.forEach((o) => o.destroy()); this.introObjs = []; this.openMenu() }
  private openMenu() {
    this.setMode("menu")
    if (!this.camT) return
    const items: [string, string][] = [["TENNIS", "tennis"], ["PICKLEBALL", "pickleball"], ["PING PONG", "pingpong"], ["VOLLEYBALL", "volleyball"], ["BASKETBALL", "hoops"], ["BOWLING", "bowling"], ["CORNHOLE", "cornhole"], ["COURT: " + (this.backyard ? "BACKYARD" : "FULL SIZE"), "size"]]
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 6, new vec4(1, 1, 1, 1))
      const t = o.getComponent("Component.Text") as Text
      try { t.backgroundSettings.enabled = true; t.backgroundSettings.fill.color = new vec4(0.05, 0.08, 0.14, 0.9) } catch (e) {}
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(210)).add(new vec3(0, 52 - i * 14, 0))) // 8 rows that fit the Specs view
      tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
      this.btns.push({obj: o, text: t, action})
    })
    this.toast("Look at a sport and pinch", 4000)
  }
  private gazed(): Btn {
    if (!this.camT) return null
    const cam = this.camT.getWorldPosition(), d = this.viewDir()
    let best: Btn = null, ba = 7 * D2R
    for (const b of this.btns) {
      const a = Math.acos(Math.max(-1, Math.min(1, b.obj.getTransform().getWorldPosition().sub(cam).normalize().dot(d))))
      if (a < ba) { ba = a; best = b }
    }
    return best
  }
  private tickMenu() {
    const g = this.gazed()
    for (const b of this.btns) b.text.textFill.color = b === g ? new vec4(1, 0.82, 0.25, 1) : new vec4(1, 1, 1, 1)
  }
  private runButton(b: Btn) {
    if (b.action === "size") { this.backyard = !this.backyard; b.text.text = "COURT: " + (this.backyard ? "BACKYARD" : "FULL SIZE"); return }
    if (b.action === "hoops") { this.startHoops(); return }
    if (b.action === "bowling") { this.startBowling(); return }
    if (b.action === "cornhole") { this.startCornhole(); return }
    const s = SPORTS.find((x) => x.id === b.action)
    if (s) this.startRacket(s)
  }
  // a small MENU tag low in front of you during a game; look down at it and pinch
  private menuTag: SceneObject = null
  private menuLookedAt(): boolean {
    if (this.mode !== "racket" && this.mode !== "hoops" && this.mode !== "bowling" && this.mode !== "cornhole") return false
    if (!this.menuTag || !this.camT) return false
    const a = Math.acos(Math.max(-1, Math.min(1, this.menuTag.getTransform().getWorldPosition().sub(this.camT.getWorldPosition()).normalize().dot(this.viewDir()))))
    return a < 10 * D2R
  }
  private placeMenuTag() {
    if (!this.menuTag) this.menuTag = this.makeText("≡ MENU", 2.6, new vec4(0.7, 0.75, 0.85, 1))
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    const tr = this.menuTag.getTransform()
    tr.setWorldPosition(cam.add(d.uniformScale(70)).add(new vec3(0, -55, 0)))
    tr.setWorldRotation(quat.lookAt(cam.sub(tr.getWorldPosition()).normalize(), vec3.up()))
    ;(this.menuTag.getComponent("Component.Text") as Text).textFill.color = this.menuLookedAt() ? new vec4(1, 0.82, 0.25, 1) : new vec4(0.7, 0.75, 0.85, 1)
  }

  // ------------------------------------------------------------------ racket sports
  private clearGame() {
    for (const o of [this.court, this.ball, this.paddle, this.cpu]) if (o) o.destroy()
    this.court = this.ball = this.paddle = this.cpu = null
    this.pins.forEach((p) => { if (!p.gone) p.obj.destroy() }); this.pins = []
    this.bags.forEach((b) => b.destroy()); this.bags = []
    if (this.bag) { this.bag.obj.destroy(); this.bag = null }
    if (this.menuTag) { this.menuTag.destroy(); this.menuTag = null }
    this.hoop = null
  }

  /** Point on the court: x across (cm, + = your right), z along (cm, + = toward the far side), y up. */
  private P(x: number, z: number, y: number): vec3 {
    return this.origin.add(this.side.uniformScale(x)).add(this.fwd.uniformScale(z)).add(new vec3(0, y, 0))
  }

  private startRacket(s: Sport) {
    this.setMode("racket")
    this.sport = s
    this.scale = this.backyard ? Math.min(1, 1200 / (s.lenFt * FT)) : 1 // backyard: whole court fits in ~12 m
    const L = s.lenFt * FT * this.scale, W = s.widFt * FT * this.scale
    const cam = this.camT.getWorldPosition()
    this.fwd = this.flatDir()
    this.side = this.fwd.cross(vec3.up()).normalize().uniformScale(-1)
    const tableH = s.table ? 76 : 0
    // you stand just behind your baseline
    this.origin = new vec3(cam.x, this.floorY + tableH, cam.z).add(this.fwd.uniformScale(L / 2 + (s.table ? 40 : 60)))
    this.court = global.scene.createSceneObject("iyCourt")
    const line = new vec4(1, 1, 1, 1)
    const surface = s.id === "tennis" ? new vec4(0.12, 0.35, 0.6, 1) : s.id === "pickleball" ? new vec4(0.1, 0.45, 0.3, 1) : new vec4(0.05, 0.25, 0.45, 1)
    const thick = s.table ? 1.5 : 4
    this.block(this.P(0, 0, -1), new vec3(W, 1, L), surface, this.court)
    // outer lines
    for (const z of [-L / 2, L / 2]) this.block(this.P(0, z, 0.5), new vec3(W, 1, thick), line, this.court)
    for (const x of [-W / 2, W / 2]) this.block(this.P(x, 0, 0.5), new vec3(thick, 1, L), line, this.court)
    // centre line(s) / kitchen
    if (s.id === "pickleball") { for (const z of [-7 * FT * this.scale, 7 * FT * this.scale]) this.block(this.P(0, z, 0.5), new vec3(W, 1, thick), line, this.court); for (const z of [-(L / 2 + 7 * FT * this.scale) / 2, (L / 2 + 7 * FT * this.scale) / 2]) this.block(this.P(0, z, 0.5), new vec3(thick, 1, L / 2 - 7 * FT * this.scale), line, this.court) }
    if (s.id === "tennis") { for (const z of [-21 * FT * this.scale, 21 * FT * this.scale]) this.block(this.P(0, z, 0.5), new vec3(W, 1, thick), line, this.court); this.block(this.P(0, 0, 0.5), new vec3(thick, 1, 42 * FT * this.scale), line, this.court) }
    if (s.table) { this.block(this.P(0, 0, 0.5), new vec3(thick, 1, L), line, this.court); for (const x of [-W / 2 + 8, W / 2 - 8]) for (const z of [-L / 2 + 8, L / 2 - 8]) this.block(this.P(x, z, -tableH / 2), new vec3(5, tableH, 5), new vec4(0.3, 0.3, 0.35, 1), this.court) }
    // net + posts
    const netH = s.netFt * FT * (s.table ? 1 : this.scale)
    if (s.nobounce) this.block(this.P(0, 0, netH - 45), new vec3(W + 20, 90, 1.5), new vec4(0.85, 0.85, 0.9, 1), this.court)
    else this.block(this.P(0, 0, netH / 2), new vec3(W + 20, netH, 1.5), new vec4(0.85, 0.85, 0.9, 1), this.court)
    this.block(this.P(0, 0, netH), new vec3(W + 20, 3, 3), line, this.court)
    for (const x of [-(W / 2 + 10), W / 2 + 10]) this.block(this.P(x, 0, netH / 2 + 5), new vec3(5, netH + 10, 5), new vec4(0.4, 0.4, 0.45, 1), this.court)
    // ball, paddle, computer player
    this.ball = this.block(this.P(0, -L / 2, 100), new vec3(s.ballCm, s.ballCm, s.ballCm), s.color)
    this.paddle = global.scene.createSceneObject("iyPaddle")
    const ps = s.table ? 0.6 : 1
    const face = this.block(new vec3(0, 0, 0), new vec3(22 * ps, 26 * ps, 2), s.id === "tennis" ? new vec4(0.9, 0.2, 0.3, 1) : PAL[1], this.paddle)
    const grip = this.block(new vec3(0, 0, 0), new vec3(3, 14 * ps, 3), new vec4(0.2, 0.2, 0.25, 1), this.paddle)
    if (face) face.getTransform().setLocalPosition(new vec3(0, 14 * ps, 0))
    if (grip) grip.getTransform().setLocalPosition(new vec3(0, 0, 0))
    this.cpu = this.makeCpu()
    this.cpuPos = this.P(0, L / 2 + 50, s.table ? -tableH : 0)
    this.pts = {me: 0, cpu: 0}; this.games = {me: 0, cpu: 0}
    this.server = "me"
    this.newPoint()
    this.toast(s.name + " · swing your hand through the ball", 4000)
  }

  private makeCpu(): SceneObject {
    const root = global.scene.createSceneObject("iyCpu")
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: vec4) => { const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), c, root); if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) } }
    part(0, 160, 0, 28, 28, 28, new vec4(1, 0.86, 0.7, 1))
    part(0, 112, 0, 38, 52, 22, PAL[0])
    part(-10, 52, 0, 14, 68, 14, new vec4(0.2, 0.2, 0.3, 1))
    part(10, 52, 0, 14, 68, 14, new vec4(0.2, 0.2, 0.3, 1))
    part(28, 120, 12, 20, 24, 2, PAL[1]) // racket
    return root
  }

  private newPoint() {
    this.ballLive = false
    this.bounces = 0
    this.serveAt = Date.now() + 1200
    this.drawScore()
  }

  private serve() {
    const s = this.sport, L = s.lenFt * FT * this.scale
    if (this.server === "me") {
      // ball tossed in front of you; swing to serve (auto-serves after 4 s)
      this.ballPos = this.P(15, -L / 2 - (s.table ? 10 : 30), s.table ? 25 : 140)
      this.ballVel = new vec3(0, s.table ? 120 : 350, 0)
      this.lastHitter = "cpu" // so your swing counts as the next hit
    } else {
      this.ballPos = this.cpuPos.add(new vec3(0, s.table ? 80 : 120, 0))
      this.ballVel = this.aimToward(this.P((Math.random() - 0.5) * s.widFt * FT * this.scale * 0.5, -L / 3, 0), this.ballPos, s.speed * 0.8 * (s.table ? 1 : this.scale ** 0.3))
      this.lastHitter = "cpu"
    }
    this.ballLive = true
    this.bounces = 0
  }

  /** Velocity that lands a ball from `from` at `to` with roughly `speed` horizontal cm/s. */
  private aimToward(to: vec3, from: vec3, speed: number): vec3 {
    if (this.sport && this.sport.nobounce) speed *= 0.55 // volleyball: lob it high over the net
    const d = to.sub(from), flat = new vec3(d.x, 0, d.z), dist = flat.length
    const t = Math.max(0.35, dist / speed)
    const vy = (d.y + 0.5 * 980 * t * t) / t
    return flat.uniformScale(1 / t).add(new vec3(0, vy, 0))
  }

  private trackHand(dt: number) {
    try {
      const h = SIK.HandInputData.getHand("right")
      if (!h.isTracked()) { this.handPrev = null; return }
      const p = h.indexKnuckle.position
      if (this.handPrev && dt > 0) this.handVel = vec3.lerp(this.handVel, p.sub(this.handPrev).uniformScale(1 / dt), 0.5)
      this.handPrev = p
      if (this.paddle) {
        const w = h.wrist.position
        const tr = this.paddle.getTransform()
        tr.setWorldPosition(p)
        const f = p.sub(w).normalize()
        tr.setWorldRotation(quat.lookAt(this.fwd || this.flatDir(), f))
      }
    } catch (e) { this.handPrev = null }
  }

  private tickRacket(dt: number) {
    const s = this.sport, L = s.lenFt * FT * this.scale, W = s.widFt * FT * this.scale
    const tableTop = s.table ? 0 : 0
    this.placeMenuTag()
    if (!this.ballLive && Date.now() > this.serveAt) this.serve()
    if (!this.ballLive) { if (this.ball) this.ball.getTransform().setWorldPosition(this.P(0, this.server === "me" ? -L / 2 : L / 2, 100)); this.moveCpu(dt, this.P(0, L / 2 + 50, 0)); return }
    // physics
    this.ballVel = new vec3(this.ballVel.x, this.ballVel.y - 980 * dt, this.ballVel.z)
    let p = this.ballPos.add(this.ballVel.uniformScale(dt))
    const local = this.toCourt(p)
    if (local.y < s.ballCm / 2 + tableTop && this.ballVel.y < 0) {
      // bounce: in or out?
      const inX = Math.abs(local.x) <= W / 2 + 3, inZ = Math.abs(local.z) <= L / 2 + 3
      const onMySide = local.z < 0
      // volleyball: the ball may never touch the floor
      if (s.nobounce) { if (inX && inZ) this.endRally(onMySide ? "cpu" : "me", "Kill!"); else this.endRally(this.lastHitter === "me" ? "cpu" : "me", "Out!"); return }
      if (!inX || !inZ) { this.endRally(this.lastHitter === "me" ? "cpu" : "me", "Out!"); return }
      if ((onMySide && this.lastHitter === "me") || (!onMySide && this.lastHitter === "cpu")) { this.endRally(this.lastHitter === "me" ? "cpu" : "me", "Fault"); return }
      this.bounces++
      if (this.bounces >= 2) { this.endRally(onMySide ? "cpu" : "me", "Double bounce"); return }
      p = this.fromCourt(new vec3(local.x, s.ballCm / 2 + tableTop, local.z))
      this.ballVel = new vec3(this.ballVel.x * 0.85, -this.ballVel.y * (s.table ? 0.8 : 0.7), this.ballVel.z * 0.85)
    }
    // net
    const prevZ = this.toCourt(this.ballPos).z
    const netH = s.netFt * FT * (s.table ? 1 : this.scale)
    if ((prevZ < 0) !== (local.z < 0) && local.y < netH) { this.endRally(this.lastHitter === "me" ? "cpu" : "me", "Net!"); return }
    // ball fell far away / behind
    if (local.y < -200 || Math.abs(local.z) > L) { this.endRally(this.lastHitter === "me" ? "cpu" : "me", "Out!"); return }
    this.ballPos = p
    if (this.ball) this.ball.getTransform().setWorldPosition(p)
    // your hit: ball near the paddle and coming toward you
    if (this.lastHitter !== "me" && this.handPrev && p.distance(this.handPrev) < (s.table ? 18 : s.nobounce ? 45 : 35)) this.hitByMe()
    // auto-serve if you don't swing
    if (this.server === "me" && this.lastHitter === "cpu" && this.bounces === 0 && local.z < -L / 2 + 10 && Date.now() - this.serveAt > 4000) this.hitByMe()
    // computer
    const target = this.lastHitter === "me" ? this.predictLanding() : this.P(0, L / 2 + 50, 0)
    this.moveCpu(dt, target)
    const cpuReady = s.nobounce ? (this.ballVel.y < 0 && local.y < 260) : this.bounces === 1
    if (this.lastHitter === "me" && local.z > 0 && cpuReady && p.distance(this.cpuPos.add(new vec3(0, 110, 0))) < (s.table ? 60 : s.nobounce ? 190 : 160)) this.hitByCpu()
  }

  private toCourt(p: vec3): vec3 { const d = p.sub(this.origin); return new vec3(d.dot(this.side), d.y, d.dot(this.fwd)) }
  private fromCourt(l: vec3): vec3 { return this.P(l.x, l.z, l.y) }

  private predictLanding(): vec3 {
    // where the ball will be after its bounce on the far side, roughly
    const t = 0.9
    const p = this.ballPos.add(this.ballVel.uniformScale(t))
    const l = this.toCourt(p)
    const L = this.sport.lenFt * FT * this.scale
    return this.P(l.x, Math.max(10, Math.min(L / 2 + 40, l.z + 60)), 0)
  }

  private moveCpu(dt: number, target: vec3) {
    const s = this.sport
    const speed = (s.table ? 150 : 450) * (this.backyard ? 0.8 : 1)
    const d = new vec3(target.x - this.cpuPos.x, 0, target.z - this.cpuPos.z)
    const step = Math.min(d.length, speed * dt)
    if (d.length > 1) this.cpuPos = this.cpuPos.add(d.normalize().uniformScale(step))
    if (this.cpu) {
      const tr = this.cpu.getTransform()
      tr.setWorldPosition(new vec3(this.cpuPos.x, this.floorY, this.cpuPos.z))
      this.faceToward(tr, this.origin.sub(this.fwd.uniformScale(1000)))
    }
  }

  private hitByMe() {
    const s = this.sport, L = s.lenFt * FT * this.scale, W = s.widFt * FT * this.scale
    const swing = Math.max(0, this.handVel.dot(this.fwd))
    const power = Math.min(1.6, 0.75 + swing / 600)
    const aimX = Math.max(-W / 2 + 20, Math.min(W / 2 - 20, this.handVel.dot(this.side) * 0.4 + (Math.random() - 0.5) * W * 0.3))
    const depth = L / 2 * (0.45 + Math.min(0.45, swing / 1500))
    this.ballVel = this.aimToward(this.P(aimX, depth, 0), this.ballPos, s.speed * power * (s.table ? 1 : this.scale ** 0.3))
    this.lastHitter = "me"
    this.bounces = 0
    this.burst(this.ballPos, s.color, 6)
  }
  private assistSwing() {
    if (this.mode !== "racket" || !this.ballLive || this.lastHitter === "me") return
    this.handVel = this.fwd.uniformScale(700)
    this.hitByMe()
  }

  private hitByCpu() {
    const s = this.sport, L = s.lenFt * FT * this.scale, W = s.widFt * FT * this.scale
    // the computer misses now and then, more when you hit hard
    const hard = this.ballVel.length / (s.speed * (s.table ? 1 : this.scale ** 0.3))
    if (Math.random() < 0.08 + Math.max(0, hard - 1) * 0.25) return
    const err = (Math.random() < 0.12) ? 1.25 : 0.8
    const to = this.P((Math.random() - 0.5) * W * 0.8, -L / 2 * (0.4 + Math.random() * 0.45) * err, 0)
    this.ballVel = this.aimToward(to, this.ballPos, s.speed * (0.85 + Math.random() * 0.3) * (s.table ? 1 : this.scale ** 0.3))
    this.lastHitter = "cpu"
    this.bounces = 0
  }

  private endRally(winner: string, why: string) {
    this.ballLive = false
    this.burst(this.ballPos, winner === "me" ? PAL[3] : PAL[0], 10)
    const s = this.sport
    if (s.scoring === "to11" || s.scoring === "to25") {
      if (winner === "me") this.pts.me++; else this.pts.cpu++
      const a = this.pts.me, b = this.pts.cpu, to = s.scoring === "to25" ? 25 : 11
      if ((a >= to || b >= to) && Math.abs(a - b) >= 2) {
        this.toast((a > b ? "YOU WIN " : "COMPUTER WINS ") + a + "–" + b + " · look down at MENU to play another", 7000)
        this.pts = {me: 0, cpu: 0}
      } else this.toast(why + (winner === "me" ? "  Your point" : "  Their point"))
      // service: pickleball/ping pong simplified to alternate every 2 points
      if (s.scoring === "to25") this.server = winner === "me" ? "me" : "cpu" // volleyball: rally winner serves
      else if ((a + b) % 2 === 0) this.server = this.server === "me" ? "cpu" : "me"
    } else {
      // tennis
      const w = winner === "me" ? "me" : "cpu", l = w === "me" ? "cpu" : "me"
      this.pts[w]++
      if (this.pts[w] >= 4 && this.pts[w] - this.pts[l] >= 2) {
        this.games[w]++
        this.pts = {me: 0, cpu: 0}
        this.server = this.server === "me" ? "cpu" : "me"
        const gw = this.games[w], gl = this.games[l]
        if (gw >= 6 && gw - gl >= 2) { this.toast((w === "me" ? "YOU WIN THE SET " : "COMPUTER WINS THE SET ") + gw + "–" + gl, 7000); this.games = {me: 0, cpu: 0} }
        else this.toast("Game " + (w === "me" ? "you" : "computer"))
      } else this.toast(why + (w === "me" ? "  Your point" : "  Their point"))
    }
    this.newPoint()
  }

  private drawScore() {
    const s = this.sport
    if (!s) return
    let line = ""
    if (s.scoring !== "tennis") line = "YOU " + this.pts.me + "  –  " + this.pts.cpu + " CPU"
    else {
      const names = ["0", "15", "30", "40"]
      const a = this.pts.me, b = this.pts.cpu
      let p = ""
      if (a >= 3 && b >= 3) p = a === b ? "DEUCE" : a > b ? "AD YOU" : "AD CPU"
      else p = names[Math.min(3, a)] + " – " + names[Math.min(3, b)]
      line = "GAMES " + this.games.me + "–" + this.games.cpu + "   " + p
    }
    this.hud.text = s.name + (this.backyard ? " (backyard)" : "") + "\n" + line + "\n" + (this.server === "me" ? "Your serve" : "Their serve")
  }

  // ------------------------------------------------------------------ basketball
  private startHoops() {
    this.setMode("hoops")
    this.shots = 0; this.makes = 0
    this.fwd = this.flatDir()
    this.side = this.fwd.cross(vec3.up()).normalize().uniformScale(-1)
    const cam = this.camT.getWorldPosition()
    this.origin = new vec3(cam.x, this.floorY, cam.z)
    const dist = this.backyard ? 300 : 457 // free-throw line 15 ft
    this.hoop = this.P(0, dist, 305) // rim 10 ft
    this.court = global.scene.createSceneObject("iyHoop")
    // backboard, rim, pole
    this.block(this.P(0, dist + 40, 340), new vec3(183, 107, 4), new vec4(0.95, 0.95, 1, 1), this.court)
    this.block(this.P(0, dist + 38, 325), new vec3(59, 45, 2), new vec4(1, 0.3, 0.3, 1), this.court)
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2
      this.block(this.hoop.add(this.side.uniformScale(Math.cos(a) * 23)).add(this.fwd.uniformScale(Math.sin(a) * 23)), new vec3(5, 3, 5), new vec4(1, 0.45, 0.1, 1), this.court)
    }
    this.block(this.P(0, dist + 80, 170), new vec3(12, 340, 12), new vec4(0.35, 0.35, 0.4, 1), this.court)
    this.block(this.P(0, dist, 0.5), new vec3(360, 1, 4), new vec4(1, 1, 1, 1), this.court)
    this.ball = this.block(this.P(0, 40, 120), new vec3(24, 24, 24), new vec4(1, 0.5, 0.15, 1))
    this.ballLive = false
    this.toast("Pinch, swing your hand up toward the hoop and let go", 5000)
  }

  private shoot(vel: vec3, assisted: boolean) {
    if (this.mode !== "hoops" || this.ballLive) return
    const from = this.handPrev || this.camT.getWorldPosition().add(this.flatDir().uniformScale(40)).add(new vec3(0, -20, 0))
    this.ballPos = from
    if (assisted || vel.length < 150) {
      // preview / weak flick: a decent shot at the rim with some error
      const target = this.hoop.add(new vec3((Math.random() - 0.5) * 30, 0, 0)).add(this.fwd.uniformScale((Math.random() - 0.5) * 30))
      const d = target.sub(from), flat = new vec3(d.x, 0, d.z)
      const t = 1.1
      this.ballVel = flat.uniformScale(1 / t).add(new vec3(0, (d.y + 0.5 * 980 * t * t) / t, 0))
    } else this.ballVel = vel.uniformScale(1.6)
    this.ballLive = true
    this.shots++
  }

  private tickHoops(dt: number) {
    this.placeMenuTag()
    this.hud.text = "BASKETBALL\nMade " + this.makes + " / " + this.shots + (this.shots ? "  (" + Math.round(100 * this.makes / this.shots) + "%)" : "")
    if (!this.ballLive) {
      const hold = this.handPrev || this.P(0, 40, 120)
      if (this.ball) this.ball.getTransform().setWorldPosition(hold)
      return
    }
    const prev = this.ballPos
    this.ballVel = new vec3(this.ballVel.x, this.ballVel.y - 980 * dt, this.ballVel.z)
    this.ballPos = this.ballPos.add(this.ballVel.uniformScale(dt))
    // through the rim from above
    if (prev.y > this.hoop.y && this.ballPos.y <= this.hoop.y) {
      const flat = new vec3(this.ballPos.x - this.hoop.x, 0, this.ballPos.z - this.hoop.z)
      if (flat.length < 18) { this.makes++; this.burst(this.hoop, PAL[2], 26); this.toast(this.makes % 5 === 0 ? "ON FIRE!" : "SWISH!") }
      else if (flat.length < 30) { this.ballVel = new vec3(-this.ballVel.x * 0.4, Math.abs(this.ballVel.y) * 0.4, -this.ballVel.z * 0.4) }
    }
    if (this.ballPos.y < this.floorY + 12) { this.ballLive = false }
    if (this.ball) this.ball.getTransform().setWorldPosition(this.ballPos)
  }

  // ------------------------------------------------------------------ bowling (60 ft lane, 10 frames)
  private startBowling() {
    this.setMode("bowling")
    this.laneL = this.backyard ? 800 : 1829
    this.fwd = this.flatDir()
    this.side = this.fwd.cross(vec3.up()).normalize().uniformScale(-1)
    const cam = this.camT.getWorldPosition()
    this.origin = new vec3(cam.x, this.floorY, cam.z).add(this.fwd.uniformScale(60))
    this.court = global.scene.createSceneObject("iyLane")
    const rot = quat.lookAt(this.fwd, vec3.up())
    const lb = (x: number, z: number, y: number, sx: number, sy: number, sz: number, c: vec4) => { const o = this.block(this.P(x, z, y), new vec3(sx, sy, sz), c, this.court); if (o) o.getTransform().setWorldRotation(rot) }
    lb(0, this.laneL / 2, 0.3, 105, 0.6, this.laneL, new vec4(0.77, 0.6, 0.36, 1))
    for (const x of [-64, 64]) lb(x, this.laneL / 2, 0.3, 23, 0.6, this.laneL, new vec4(0.42, 0.46, 0.55, 1))
    for (let i = 1; i <= 7; i++) lb((i - 4) * 12, 460 * (this.backyard ? 0.44 : 1), 0.8, 3, 0.4, 8, new vec4(1, 0.24, 0.32, 1))
    lb(0, 0, 0.8, 105, 0.4, 2, new vec4(1, 1, 1, 1))
    this.ball = this.block(this.P(0, 10, 11), new vec3(22, 22, 22), PAL[1])
    this.frames = []; this.frame = 0; this.roll = 0; this.bowlOver = false; this.rolling = false
    this.rack(true)
    this.toast("Pinch, swing forward, let go to bowl", 5000)
  }
  private bowlFrom(): vec3 { const c = this.camT.getWorldPosition(); return this.P(Math.max(-45, Math.min(45, this.toCourt(c).x)), 10, 11) }
  private rack(full: boolean) {
    if (full) {
      this.pins.forEach((p) => { if (!p.gone) p.obj.destroy() }); this.pins = []
      const rows = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]]
      rows.forEach((r, ri) => r.forEach((x) => {
        const pos = this.P(x * 30.5, this.laneL - 90 + ri * 26.4, 0)
        const g = global.scene.createSceneObject("iyPin")
        for (const [y, w, h, c] of [[19, 12, 30, new vec4(1, 1, 1, 1)], [34, 7, 8, new vec4(1, 1, 1, 1)], [28, 12.5, 2.5, new vec4(1, 0.24, 0.32, 1)]] as [number, number, number, vec4][]) { const o = this.block(new vec3(0, 0, 0), new vec3(w, h, w), c, g); if (o) { o.getTransform().setLocalPosition(new vec3(0, y, 0)); o.getTransform().setLocalScale(new vec3(w, h, w)) } }
        g.getTransform().setWorldPosition(pos)
        this.pins.push({obj: g, pos, vel: new vec3(0, 0, 0), hit: false, down: false, gone: false, tilt: 0, axis: new vec3(1, 0, 0)})
      }))
    } else this.pins.forEach((p) => { if (p.down && !p.gone) { p.obj.destroy(); p.gone = true } })
  }
  private throwIt(assisted: boolean) {
    if (this.mode === "bowling") {
      if (this.rolling || this.bowlOver) return
      this.ballPos = this.bowlFrom()
      const v = this.handVel
      if (!assisted && this.handPrev && v.length > 140) this.ballVel = new vec3(v.x, 0, v.z).uniformScale(1.4)
      else { const target = this.P((Math.random() - 0.5) * 30, this.laneL - 60, 11); const d = target.sub(this.ballPos); this.ballVel = new vec3(d.x, 0, d.z).normalize().uniformScale(600 + Math.random() * 200) }
      this.rolling = true
      return
    }
    if (this.mode === "cornhole") {
      if (this.bag || this.chTurn !== "me" || this.chLeft.me <= 0) return
      const from = this.handPrev || this.camT.getWorldPosition().add(this.flatDir().uniformScale(40)).add(new vec3(0, -40, 0))
      const v = this.handVel
      let vel: vec3
      if (!assisted && this.handPrev && v.length > 150) vel = v.uniformScale(1.4)
      else vel = this.lob(from, this.holeP.add(new vec3((Math.random() - 0.5) * 35, 0, 0)).add(this.fwd.uniformScale((Math.random() - 0.5) * 40)), 1.15)
      this.launchBag("me", from, vel)
    }
  }
  private lob(from: vec3, to: vec3, t: number): vec3 { const d = to.sub(from); return new vec3(d.x / t, (d.y + 0.5 * 980 * t * t) / t, d.z / t) }
  private tickBowling(dt: number) {
    this.placeMenuTag()
    this.hud.text = "BOWLING\nFrame " + Math.min(10, this.frame + 1) + " · roll " + (this.roll + 1) + "   Score " + this.bowlScore()
    if (!this.rolling) { if (this.ball) this.ball.getTransform().setWorldPosition(this.bowlFrom()); return }
    this.ballPos = this.ballPos.add(this.ballVel.uniformScale(dt))
    this.ballVel = this.ballVel.uniformScale(1 - 0.08 * dt)
    const bc = this.toCourt(this.ballPos)
    if (Math.abs(bc.x) > 53 && !this.gutter) { this.gutter = true; this.ballVel = this.fwd.uniformScale(400) }
    if (this.ball) this.ball.getTransform().setWorldPosition(this.gutter ? this.ballPos.add(new vec3(0, -8, 0)) : this.ballPos)
    for (const p of this.pins) {
      if (p.gone || this.gutter) continue
      const flat = new vec3(this.ballPos.x - p.pos.x, 0, this.ballPos.z - p.pos.z)
      if (!p.hit && flat.length < 17) { p.hit = true; p.vel = this.ballVel.uniformScale(0.7).add(this.side.uniformScale((Math.random() - 0.5) * 150)); this.ballVel = this.ballVel.uniformScale(0.93) }
    }
    for (const a of this.pins) if (a.hit && !a.gone) for (const b of this.pins) if (b !== a && !b.hit && !b.gone && a.pos.distance(b.pos) < 13) { b.hit = true; b.vel = a.vel.uniformScale(0.6).add(this.side.uniformScale((Math.random() - 0.5) * 120)) }
    let moving = this.ballVel.length > 20 && bc.z < this.laneL + 40
    for (const p of this.pins) {
      if (!p.hit || p.gone) continue
      p.pos = p.pos.add(p.vel.uniformScale(dt)); p.vel = p.vel.uniformScale(Math.max(0, 1 - 2.5 * dt))
      if (!p.down) { p.down = true; const ax = new vec3(p.vel.z, 0, -p.vel.x); p.axis = ax.length > 0.01 ? ax.normalize() : new vec3(1, 0, 0) }
      p.tilt = Math.min(Math.PI / 2, p.tilt + dt * 6)
      const tr = p.obj.getTransform(); tr.setWorldPosition(p.pos); tr.setWorldRotation(quat.angleAxis(p.tilt, p.axis))
      if (p.vel.length > 15) moving = true
    }
    if (!moving) this.endRoll()
  }
  private endRoll() {
    this.rolling = false; this.gutter = false
    const down = this.pins.filter((p) => p.down && !p.gone).length
    if (!this.frames[this.frame]) this.frames[this.frame] = []
    const f = this.frames[this.frame]
    f.push(down)
    const total = f.reduce((a, b) => a + b, 0), last = this.frame === 9
    let next = false
    if (!last) {
      if (down === 10 && this.roll === 0) { this.toast("STRIKE!", 2500); this.burst(this.P(0, this.laneL - 60, 50), PAL[2], 40); next = true }
      else if (this.roll === 1) { if (total === 10) this.toast("SPARE!"); next = true }
    } else {
      const r = f.length
      if (r === 3 || (r === 2 && total < 10)) { this.bowlOver = true; this.toast("GAME OVER · " + this.bowlScore() + " · look down at MENU to play again", 8000) }
      else if (down === 10 || (r === 2 && total >= 10)) { this.toast(down === 10 ? "STRIKE!" : "SPARE!"); this.rack(true); this.roll = r; return }
    }
    if (next) { this.frame++; this.roll = 0; this.rack(true) } else if (!this.bowlOver) { this.roll++; this.rack(false) }
  }
  private bowlScore(): number {
    const rolls: number[] = [].concat(...this.frames)
    let sc = 0, i = 0
    for (let f = 0; f < 10 && i < rolls.length; f++) {
      if (rolls[i] === 10) { sc += 10 + (rolls[i + 1] || 0) + (rolls[i + 2] || 0); i += 1 }
      else if ((rolls[i] || 0) + (rolls[i + 1] || 0) === 10) { sc += 10 + (rolls[i + 2] || 0); i += 2 }
      else { sc += (rolls[i] || 0) + (rolls[i + 1] || 0); i += 2 }
    }
    return sc
  }

  // ------------------------------------------------------------------ cornhole (27 ft, cancel scoring to 21)
  private startCornhole() {
    this.setMode("cornhole")
    const dist = this.backyard ? 600 : 823
    this.fwd = this.flatDir()
    this.side = this.fwd.cross(vec3.up()).normalize().uniformScale(-1)
    const cam = this.camT.getWorldPosition()
    this.origin = new vec3(cam.x, this.floorY, cam.z)
    this.board = this.P(0, dist, 0)
    this.tilt = Math.atan2(23, 122)
    this.court = global.scene.createSceneObject("iyBoard")
    // the board: 4 × 2 ft, front 3 in up, back 12 in up, hole 6 in wide, 9 in from the top
    const top = global.scene.createSceneObject("iyBoardTop"); top.setParent(this.court)
    const parts: [number, number, number, number, number, number, vec4][] = [[0, 0, 0, 61, 2, 122, PAL[1]], [0, 1.2, 0, 50, 0.4, 110, new vec4(0.12, 0.44, 0.66, 1)]]
    for (const [x, y, z, sx, sy, sz, c] of parts) { const o = this.block(new vec3(0, 0, 0), new vec3(sx, sy, sz), c, top); if (o) { o.getTransform().setLocalPosition(new vec3(x, y, z)); o.getTransform().setLocalScale(new vec3(sx, sy, sz)) } }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const o = this.block(new vec3(0, 0, 0), new vec3(3, 1.5, 3), PAL[2], top); if (o) { o.getTransform().setLocalPosition(new vec3(Math.cos(a) * 8, 1.6, 38 + Math.sin(a) * 8)); o.getTransform().setLocalScale(new vec3(3, 1.5, 3)) } }
    top.getTransform().setLocalPosition(new vec3(0, 19, 0))
    top.getTransform().setLocalRotation(quat.angleAxis(-this.tilt, new vec3(1, 0, 0)))
    this.court.getTransform().setWorldPosition(this.board)
    this.court.getTransform().setWorldRotation(quat.lookAt(this.fwd, vec3.up()))
    // hole centre in the world
    this.holeP = this.board.add(this.fwd.uniformScale(38 * Math.cos(this.tilt))).add(new vec3(0, 19 + 38 * Math.sin(this.tilt) + 2, 0))
    this.chTotal = {me: 0, cpu: 0}; this.chRound = {me: 0, cpu: 0}; this.chLeft = {me: 4, cpu: 4}; this.chTurn = "me"
    this.toast("Pinch, swing underhand, let go to toss", 5000)
  }
  private launchBag(who: string, from: vec3, vel: vec3) {
    const o = this.block(from, new vec3(15, 4, 15), who === "me" ? new vec4(1, 0.24, 0.32, 1) : PAL[2])
    this.bag = {obj: o, pos: from, vel, who}
    this.chLeft[who]--
  }
  private tickCornhole(dt: number) {
    this.placeMenuTag()
    this.hud.text = "CORNHOLE   YOU " + this.chTotal.me + " – " + this.chTotal.cpu + " CPU\nThis round " + this.chRound.me + "–" + this.chRound.cpu + " · bags: you " + this.chLeft.me + ", CPU " + this.chLeft.cpu + "\n" + (this.chTurn === "me" ? "Your toss" : "CPU tossing…")
    const b = this.bag
    if (b) {
      b.vel = new vec3(b.vel.x, b.vel.y - 980 * dt, b.vel.z)
      b.pos = b.pos.add(b.vel.uniformScale(dt))
      if (b.obj) { b.obj.getTransform().setWorldPosition(b.pos); b.obj.getTransform().setWorldRotation(quat.angleAxis(this.time * 5, vec3.up())) }
      const d = b.pos.sub(this.board), lx = d.dot(this.side), lz = d.dot(this.fwd)
      const onBoard = Math.abs(lx) < 31 && lz > -61 && lz < 61
      const surf = 19 + Math.tan(this.tilt) * lz
      if (onBoard && d.y <= surf + 2 && b.vel.y < 0) {
        const hole = new vec3(b.pos.x - this.holeP.x, 0, b.pos.z - this.holeP.z).length
        if (hole < 8.5) { this.landBag(3); this.burst(this.holeP, PAL[2], 26); this.toast(b.who === "me" ? "CORNHOLE! +3" : "CPU cornhole"); if (b.obj) b.obj.enabled = false }
        else this.landBag(1)
      } else if (b.pos.y < this.floorY + 2) this.landBag(0)
    } else if (this.chTurn === "cpu" && Date.now() > this.chCpuAt) {
      const from = this.P(40, -20, 110)
      const tgt = this.holeP.add(new vec3((Math.random() - 0.5) * 70, 0, 0)).add(this.fwd.uniformScale((Math.random() - 0.5) * 90))
      this.launchBag("cpu", from, this.lob(from, tgt, 1.15))
    }
  }
  private landBag(pts: number) {
    const b = this.bag
    this.chRound[b.who] += pts
    if (b.obj) this.bags.push(b.obj)
    if (pts === 1) this.toast((b.who === "me" ? "On the board" : "CPU on the board") + " +1", 1500)
    this.bag = null
    this.chTurn = b.who === "me" ? (this.chLeft.cpu > 0 ? "cpu" : "me") : (this.chLeft.me > 0 ? "me" : "cpu")
    this.chCpuAt = Date.now() + 1300
    if (this.chLeft.me === 0 && this.chLeft.cpu === 0) {
      const ev = this.createEvent("DelayedCallbackEvent")
      ev.bind(() => this.endRoundCh())
      ev.reset(1.5)
    }
  }
  private endRoundCh() {
    if (this.mode !== "cornhole") return
    const diff = this.chRound.me - this.chRound.cpu
    if (diff > 0) this.chTotal.me += diff; else this.chTotal.cpu -= diff
    this.toast(diff === 0 ? "Round cancels out" : diff > 0 ? "You score " + diff : "CPU scores " + -diff, 3000)
    this.bags.forEach((o) => o.destroy()); this.bags = []
    this.chRound = {me: 0, cpu: 0}; this.chLeft = {me: 4, cpu: 4}; this.chTurn = diff >= 0 ? "me" : "cpu"; this.chCpuAt = Date.now() + 2500
    if (this.chTotal.me >= 21 || this.chTotal.cpu >= 21) { this.toast(this.chTotal.me >= 21 ? "YOU WIN 21!" : "CPU WINS 21", 6000); this.chTotal = {me: 0, cpu: 0} }
  }
}
