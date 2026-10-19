// iYiYi SPORTS for Snap Spectacles (this project's one script; the file keeps the template's
// name so the scene's component reference stays wired).
//
// Start: animated iYiYi SPORTS logo, rackets, paddles and balls rain down, then a look-and-pinch
// menu: Tennis, Pickleball, Ping Pong, Basketball, plus Court size (Full / Backyard).
// Racket sports: the court is laid on the real floor in front of you at its standard size (or a
// backyard scale), net in the middle, the computer plays the far side. Your right hand is the
// racket: swing through the ball to hit it (faster swing = faster ball). Real scoring:
// tennis (15/30/40/deuce/advantage, games), pickleball and ping pong (to 11, win by 2).
// Basketball: a hoop 4.6 m away; pinch, swing your hand up and let go to shoot.
// Lens Studio preview: a click swings for you when the ball is near (no hands in preview).
// Coming next: volleyball, bowling, cornhole, two players on one court, shop (balls, uniforms).
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"

const D2R = Math.PI / 180
const FT = 30.48 // cm per foot
const PAL = [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.82, 0.25, 1), new vec4(0.36, 0.95, 0.63, 1), new vec4(0.69, 0.42, 1, 1), new vec4(1, 0.5, 0.2, 1)]

type Sport = {id: string; name: string; lenFt: number; widFt: number; netFt: number; ballCm: number; speed: number; scoring: "tennis" | "to11"; color: vec4; table?: boolean}
const SPORTS: Sport[] = [
  {id: "tennis", name: "TENNIS", lenFt: 78, widFt: 27, netFt: 3, ballCm: 6.7, speed: 1500, scoring: "tennis", color: new vec4(0.85, 1, 0.2, 1)},
  {id: "pickleball", name: "PICKLEBALL", lenFt: 44, widFt: 20, netFt: 2.9, ballCm: 7.4, speed: 1050, scoring: "to11", color: new vec4(1, 0.9, 0.2, 1)},
  {id: "pingpong", name: "PING PONG", lenFt: 9, widFt: 5, netFt: 0.5, ballCm: 4, speed: 500, scoring: "to11", color: new vec4(1, 0.6, 0.2, 1), table: true},
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
    if (m !== "racket" && m !== "hoops") this.clearGame()
    this.hud.text = ""
  }
  private startIntro() {
    this.setMode("intro")
    if (!this.camT) return
    ;["i", "Y", "i", "Y", "i"].forEach((ch, i) => this.introObjs.push(this.makeText(ch, 14, [PAL[0], PAL[1], PAL[2], PAL[1], PAL[0]][i])))
    this.introObjs.push(this.makeText("SPORTS", 5, new vec4(1, 1, 1, 1)))
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
    const t = this.modeT, cam = this.camT.getWorldPosition(), d = this.flatDir()
    const right = quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(d)
    const center = cam.add(d.uniformScale(220)).add(new vec3(0, 20, 0))
    this.introObjs.forEach((o, i) => {
      const sub = i === 5, delay = sub ? 0.9 : i * 0.12
      const k = Math.max(0, Math.min(1, (t - delay) / 0.35))
      const s = Math.max(0.001, k < 1 ? k * (1.25 - 0.25 * k) : 1 + Math.sin(t * 3 + i) * 0.03)
      const tr = o.getTransform()
      tr.setWorldPosition(center.add(right.uniformScale(sub ? 0 : (i - 2) * 34)).add(new vec3(0, sub ? -45 : Math.sin(t * 2.5 + i) * 3, 0)))
      tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
      tr.setWorldScale(new vec3(s, s, s))
    })
    if (t > 0.6 && t - dt <= 0.6) this.burst(center, PAL[2], 24)
    if (t > 3.4) this.endIntro()
  }
  private endIntro() { this.introObjs.forEach((o) => o.destroy()); this.introObjs = []; this.openMenu() }
  private openMenu() {
    this.setMode("menu")
    if (!this.camT) return
    const items: [string, string][] = [["TENNIS", "tennis"], ["PICKLEBALL", "pickleball"], ["PING PONG", "pingpong"], ["BASKETBALL", "hoops"], ["COURT: " + (this.backyard ? "BACKYARD" : "FULL SIZE"), "size"]]
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 6, new vec4(1, 1, 1, 1))
      const t = o.getComponent("Component.Text") as Text
      try { t.backgroundSettings.enabled = true; t.backgroundSettings.fill.color = new vec4(0.05, 0.08, 0.14, 0.9) } catch (e) {}
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(160)).add(new vec3(0, 44 - i * 26, 0)))
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
    const s = SPORTS.find((x) => x.id === b.action)
    if (s) this.startRacket(s)
  }
  // a small MENU tag low in front of you during a game; look down at it and pinch
  private menuTag: SceneObject = null
  private menuLookedAt(): boolean {
    if (this.mode !== "racket" && this.mode !== "hoops") return false
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
    this.block(this.P(0, 0, netH / 2), new vec3(W + 20, netH, 1.5), new vec4(0.85, 0.85, 0.9, 1), this.court)
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
    if (this.lastHitter !== "me" && this.handPrev && p.distance(this.handPrev) < (s.table ? 18 : 35)) this.hitByMe()
    // auto-serve if you don't swing
    if (this.server === "me" && this.lastHitter === "cpu" && this.bounces === 0 && local.z < -L / 2 + 10 && Date.now() - this.serveAt > 4000) this.hitByMe()
    // computer
    const target = this.lastHitter === "me" ? this.predictLanding() : this.P(0, L / 2 + 50, 0)
    this.moveCpu(dt, target)
    if (this.lastHitter === "me" && local.z > 0 && this.bounces === 1 && p.distance(this.cpuPos.add(new vec3(0, 110, 0))) < (s.table ? 60 : 160)) this.hitByCpu()
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
    if (s.scoring === "to11") {
      if (winner === "me") this.pts.me++; else this.pts.cpu++
      const a = this.pts.me, b = this.pts.cpu
      if ((a >= 11 || b >= 11) && Math.abs(a - b) >= 2) {
        this.toast((a > b ? "YOU WIN " : "COMPUTER WINS ") + a + "–" + b + " · look down at MENU to play another", 7000)
        this.pts = {me: 0, cpu: 0}
      } else this.toast(why + (winner === "me" ? "  Your point" : "  Their point"))
      // service: pickleball/ping pong simplified to alternate every 2 points
      if ((a + b) % 2 === 0) this.server = this.server === "me" ? "cpu" : "me"
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
    if (s.scoring === "to11") line = "YOU " + this.pts.me + "  –  " + this.pts.cpu + " CPU"
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
}
