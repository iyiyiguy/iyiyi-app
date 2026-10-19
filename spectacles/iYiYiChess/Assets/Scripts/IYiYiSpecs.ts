// iYiYi CHESS for Snap Spectacles (this project's one script; the file keeps the template's name so
// the scene's component reference stays wired).
//
// Start: animated iYiYi CHESS logo with pieces dropping in, then a look-and-pinch menu:
//   PLAY vs CPU / PLAY A FRIEND (take turns) / BOARD: TABLETOP | FLOOR | LIFE-SIZE / CPU: EASY | NORMAL | HARD
// Board sizes: Tabletop (44 cm board, 10 cm king), Floor (2 m board), Life-size (7.6 m board,
// kings ~1.8 m tall, walk around your army). You can change the size mid-game from the menu and
// RESUME: the same position is rebuilt at the new size.
// Look at a piece and pinch to pick it up (legal squares light up green, captures red), look at a
// square and pinch to move. Full rules: check, checkmate, stalemate, castling, en passant,
// promotion (to a queen), 50-move rule, bare kings. Captured pieces burst into colourful blocks and
// pile up beside the board.
// Lens Studio preview: click a square (no hands in preview).
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
const PAL = [new vec4(1, 0.31, 0.64, 1), new vec4(0.22, 0.84, 1, 1), new vec4(1, 0.82, 0.25, 1), new vec4(0.36, 0.95, 0.63, 1), new vec4(0.69, 0.42, 1, 1), new vec4(1, 0.5, 0.2, 1)]
// additive display: black is invisible, so the "dark" army is crimson and both armies are bright
const CREAM = new vec4(1, 0.93, 0.74, 1)
const CRIMSON = new vec4(1, 0.2, 0.32, 1)
const GOLD = new vec4(1, 0.78, 0.2, 1)
const CYAN = new vec4(0.22, 0.84, 1, 1)
const GREEN = new vec4(0.36, 0.95, 0.5, 1)
const RED = new vec4(1, 0.25, 0.2, 1)

type Size = {id: string; name: string; sq: number}
const SIZES: Size[] = [
  {id: "table", name: "TABLETOP", sq: 5.5},
  {id: "floor", name: "FLOOR", sq: 25},
  {id: "life", name: "LIFE-SIZE", sq: 95},
]
const LEVELS = [{name: "EASY", depth: 1, noise: 120}, {name: "NORMAL", depth: 2, noise: 15}, {name: "HARD", depth: 3, noise: 0}]

// ---------------------------------------------------------------------- rules engine
// Board: 64 strings, index = rank * 8 + file, rank 0 = White's back rank. Uppercase = White.
type St = {b: string[]; w: boolean; cr: string; ep: number; half: number}
type Mv = {f: number; t: number; p: string; c: string; promo?: string; castle?: boolean; ep?: boolean; dbl?: boolean}
const isW = (p: string) => p !== "" && p === p.toUpperCase()
const N_OFF = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
const K_OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BISH_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const VAL: {[k: string]: number} = {P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0}
const NAMES: {[k: string]: string} = {P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king"}
const inB = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8

function initial(): St {
  const back = "RNBQKBNR"
  const b: string[] = []
  for (let i = 0; i < 64; i++) b.push("")
  for (let f = 0; f < 8; f++) { b[f] = back[f]; b[8 + f] = "P"; b[48 + f] = "p"; b[56 + f] = back[f].toLowerCase() }
  return {b, w: true, cr: "KQkq", ep: -1, half: 0}
}
function attacked(b: string[], sq: number, byWhite: boolean): boolean {
  const f = sq % 8, r = Math.floor(sq / 8)
  const pr = byWhite ? r - 1 : r + 1, pawn = byWhite ? "P" : "p"
  if (pr >= 0 && pr < 8) for (const df of [-1, 1]) { const ff = f + df; if (ff >= 0 && ff < 8 && b[pr * 8 + ff] === pawn) return true }
  const kn = byWhite ? "N" : "n", kg = byWhite ? "K" : "k"
  for (const o of N_OFF) { const ff = f + o[0], rr = r + o[1]; if (inB(ff, rr) && b[rr * 8 + ff] === kn) return true }
  for (const o of K_OFF) { const ff = f + o[0], rr = r + o[1]; if (inB(ff, rr) && b[rr * 8 + ff] === kg) return true }
  const slide = (dirs: number[][], a: string, q: string) => {
    for (const d of dirs) {
      let ff = f + d[0], rr = r + d[1]
      while (inB(ff, rr)) { const p = b[rr * 8 + ff]; if (p !== "") { if (p === a || p === q) return true; break } ff += d[0]; rr += d[1] }
    }
    return false
  }
  return slide(ROOK_D, byWhite ? "R" : "r", byWhite ? "Q" : "q") || slide(BISH_D, byWhite ? "B" : "b", byWhite ? "Q" : "q")
}
const kingSq = (b: string[], white: boolean) => b.indexOf(white ? "K" : "k")
function pseudo(s: St): Mv[] {
  const ms: Mv[] = [], b = s.b, w = s.w
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq]
    if (p === "" || isW(p) !== w) continue
    const f = sq % 8, r = Math.floor(sq / 8), u = p.toUpperCase()
    const add = (t: number) => { if (b[t] === "" || isW(b[t]) !== w) ms.push({f: sq, t, p, c: b[t]}) }
    if (u === "P") {
      const dir = w ? 1 : -1, r1 = r + dir, last = w ? 7 : 0
      const pawnTo = (t: number, c: string) => ms.push(Math.floor(t / 8) === last ? {f: sq, t, p, c, promo: w ? "Q" : "q"} : {f: sq, t, p, c})
      if (r1 >= 0 && r1 < 8 && b[r1 * 8 + f] === "") {
        pawnTo(r1 * 8 + f, "")
        if (r === (w ? 1 : 6) && b[(r + 2 * dir) * 8 + f] === "") ms.push({f: sq, t: (r + 2 * dir) * 8 + f, p, c: "", dbl: true})
      }
      for (const df of [-1, 1]) {
        const ff = f + df
        if (!inB(ff, r1)) continue
        const t = r1 * 8 + ff
        if (b[t] !== "" && isW(b[t]) !== w) pawnTo(t, b[t])
        else if (t === s.ep) ms.push({f: sq, t, p, c: w ? "p" : "P", ep: true})
      }
    } else if (u === "N" || u === "K") {
      for (const o of u === "N" ? N_OFF : K_OFF) { const ff = f + o[0], rr = r + o[1]; if (inB(ff, rr)) add(rr * 8 + ff) }
      if (u === "K") {
        const enemy = !w, home = w ? 4 : 60, R = w ? "R" : "r"
        if (sq === home && !attacked(b, home, enemy)) {
          if (s.cr.indexOf(w ? "K" : "k") >= 0 && b[home + 1] === "" && b[home + 2] === "" && b[home + 3] === R && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) ms.push({f: sq, t: home + 2, p, c: "", castle: true})
          if (s.cr.indexOf(w ? "Q" : "q") >= 0 && b[home - 1] === "" && b[home - 2] === "" && b[home - 3] === "" && b[home - 4] === R && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) ms.push({f: sq, t: home - 2, p, c: "", castle: true})
        }
      }
    } else {
      const dirs = u === "R" ? ROOK_D : u === "B" ? BISH_D : ROOK_D.concat(BISH_D)
      for (const d of dirs) {
        let ff = f + d[0], rr = r + d[1]
        while (inB(ff, rr)) { const t = rr * 8 + ff; if (b[t] === "") ms.push({f: sq, t, p, c: ""}); else { add(t); break } ff += d[0]; rr += d[1] }
      }
    }
  }
  return ms
}
/** rook squares moved by a castling king move: [from, to] */
function castleRook(m: Mv): number[] { return m.t > m.f ? [m.f + 3, m.f + 1] : [m.f - 4, m.f - 1] }
function epVictim(m: Mv): number { return m.t + (isW(m.p) ? -8 : 8) }
function make(s: St, m: Mv): St {
  const b = s.b.slice()
  b[m.t] = m.promo || m.p
  b[m.f] = ""
  if (m.ep) b[epVictim(m)] = ""
  if (m.castle) { const rk = castleRook(m); b[rk[1]] = b[rk[0]]; b[rk[0]] = "" }
  let cr = s.cr
  const strip = (ch: string) => { cr = cr.replace(ch, "") }
  if (m.p === "K") { strip("K"); strip("Q") }
  if (m.p === "k") { strip("k"); strip("q") }
  if (m.f === 0 || m.t === 0) strip("Q")
  if (m.f === 7 || m.t === 7) strip("K")
  if (m.f === 56 || m.t === 56) strip("q")
  if (m.f === 63 || m.t === 63) strip("k")
  return {b, w: !s.w, cr, ep: m.dbl ? (m.f + m.t) / 2 : -1, half: m.p === "P" || m.p === "p" || m.c !== "" ? 0 : s.half + 1}
}
function legal(s: St): Mv[] {
  return pseudo(s).filter((m) => { const n = make(s, m); return !attacked(n.b, kingSq(n.b, s.w), !s.w) })
}
function inCheck(s: St) { return attacked(s.b, kingSq(s.b, s.w), !s.w) }
function insufficient(b: string[]) {
  const rest = b.filter((p) => p !== "" && p !== "K" && p !== "k")
  return rest.length === 0 || (rest.length === 1 && "NnBb".indexOf(rest[0]) >= 0)
}
function evalW(b: string[]): number {
  let e = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq]
    if (p === "") continue
    const u = p.toUpperCase(), f = sq % 8, r = Math.floor(sq / 8), w = isW(p)
    const c = 7 - (Math.abs(f - 3.5) + Math.abs(r - 3.5))
    let v = VAL[u]
    if (u === "N" || u === "B" || u === "P") v += c * 4
    if (u === "Q") v += c
    if (u === "P") v += (w ? r - 1 : 6 - r) * 6
    if (u === "K") v -= c * 3
    e += w ? v : -v
  }
  return e
}
const capVal = (m: Mv) => (m.c ? VAL[m.c.toUpperCase()] * 10 - VAL[m.p.toUpperCase()] / 10 : 0) + (m.promo ? 800 : 0)
function search(s: St, depth: number, alpha: number, beta: number): number {
  if (depth === 0) return s.w ? evalW(s.b) : -evalW(s.b)
  const ms = legal(s)
  if (!ms.length) return inCheck(s) ? -100000 - depth : 0
  ms.sort((a, b) => capVal(b) - capVal(a))
  for (const m of ms) {
    const v = -search(make(s, m), depth - 1, -beta, -alpha)
    if (v >= beta) return v
    if (v > alpha) alpha = v
  }
  return alpha
}
function bestMove(s: St, depth: number, noise: number): Mv {
  const ms = legal(s)
  ms.sort((a, b) => capVal(b) - capVal(a))
  let best: Mv = null, bv = -1e9, braw = -1e9
  for (const m of ms) {
    const raw = noise > 0 ? -search(make(s, m), depth - 1, -1e9, 1e9) : -search(make(s, m), depth - 1, -1e9, -braw)
    const v = raw + Math.random() * noise
    if (raw > braw) braw = raw
    if (v > bv) { bv = v; best = m }
  }
  return best
}

// ---------------------------------------------------------------------- the Lens
type Fx = {obj: SceneObject; t: number; life: number; vel?: vec3; spin?: vec3; gravity?: boolean; floorY?: number}
type Btn = {obj: SceneObject; text: Text; action: string}
type Anim = {obj: SceneObject; a: vec3; b: vec3; t: number; dur: number; hop: number; done?: () => void}

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
  private menuTag: SceneObject = null

  // settings
  private sizeI = 0
  private levelI = 1
  private vsCpu = true

  // game
  private st: St = null
  private over = ""
  private lastMove: Mv = null
  private root: SceneObject = null // board + pieces + markers + piles
  private origin: vec3 // centre of the board's top surface
  private fwd: vec3 // from White's side toward Black's
  private right: vec3
  private sq = 5.5
  private pieces: SceneObject[] = []
  private markers: SceneObject[] = []
  private markKey = ""
  private sel = -1
  private selMoves: Mv[] = []
  private hover = -1
  private anims: Anim[] = []
  private cpuAt = 0
  private piles = {w: 0, b: 0}
  private tapRay: vec3[] = null

  onAwake() {
    this.camT = this.findCamera()
    if (this.blockMaterial) this.cube = this.makeCube()
    this.hud = this.makeText("", 3, new vec4(1, 1, 1, 1)).getComponent("Component.Text") as Text
    this.toastT = this.makeText("", 3, CYAN).getComponent("Component.Text") as Text
    if (this.camT) this.floorY = this.camT.getWorldPosition().y - 150
    this.createEvent("UpdateEvent").bind(() => this.update())
    try {
      const r = SIK.HandInputData.getHand("right")
      r.onPinchDown.add(() => this.onPinch(null))
      const l = SIK.HandInputData.getHand("left")
      l.onPinchDown.add(() => this.onPinch(null))
    } catch (e) { print("iYiYi Chess: hands unavailable " + e) }
    try {
      this.createEvent("TapEvent").bind((ev: TapEvent) => {
        const tp = ev.getTapPosition()
        if (this.mode === "menu" && this.camComp) {
          let best: Btn = null, bd = 0.08
          for (const b of this.btns) {
            const sp = this.camComp.worldSpaceToScreenSpace(b.obj.getTransform().getWorldPosition())
            if (Math.abs(sp.y - tp.y) < bd) { bd = Math.abs(sp.y - tp.y); best = b }
          }
          if (best) this.runButton(best)
          return
        }
        if (this.mode === "chess" && this.camComp && this.camT) {
          // menu tag hit test in screen space, otherwise a ray through the clicked pixel
          if (this.menuTag) {
            const sp = this.camComp.worldSpaceToScreenSpace(this.menuTag.getTransform().getWorldPosition())
            if (Math.abs(sp.x - tp.x) < 0.08 && Math.abs(sp.y - tp.y) < 0.05) { this.openMenu(); return }
          }
          const cam = this.camT.getWorldPosition()
          const far = this.camComp.screenSpaceToWorldSpace(tp, 100)
          this.onPinch([cam, far.sub(cam).normalize()])
          return
        }
        this.onPinch(null)
      })
    } catch (e) {}
    this.startIntro()
  }

  private onPinch(ray: vec3[]) {
    if (this.mode === "intro") { this.endIntro(); return }
    if (this.mode === "menu") { const g = this.gazed(); if (g) this.runButton(g); return }
    if (this.mode !== "chess") return
    if (!ray && this.menuLookedAt()) { this.openMenu(); return }
    const sq = this.pick(ray || [this.camT.getWorldPosition(), this.viewDir()])
    this.choose(sq)
  }

  private update() {
    const dt = Math.min(0.05, getDeltaTime())
    this.time += dt
    this.modeT += dt
    this.placeHud()
    if (this.mode === "intro") this.tickIntro(dt)
    if (this.mode === "menu") this.tickMenu()
    if (this.mode === "chess") this.tickChess()
    this.tickAnims(dt)
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
    put(this.hud, 24)
    put(this.toastT, -18)
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
  private tickFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.t += dt
      const tr = f.obj.getTransform()
      if (f.vel) {
        if (f.gravity) f.vel = new vec3(f.vel.x, f.vel.y - 980 * dt, f.vel.z)
        let p = tr.getWorldPosition().add(f.vel.uniformScale(dt))
        if (f.floorY !== undefined && p.y < f.floorY) { p = new vec3(p.x, f.floorY, p.z); f.vel = new vec3(f.vel.x * 0.4, Math.abs(f.vel.y) * 0.25, f.vel.z * 0.4) }
        tr.setWorldPosition(p)
      }
      if (f.spin) tr.setWorldRotation(tr.getWorldRotation().multiply(quat.fromEulerAngles(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)))
      if (f.t >= f.life) { f.obj.destroy(); this.fx.splice(i, 1) }
    }
  }

  // ------------------------------------------------------------------ intro + menu
  private setMode(m: string) {
    this.mode = m
    this.modeT = 0
    if (m !== "menu") { this.btns.forEach((b) => b.obj.destroy()); this.btns = [] }
    if (m === "menu" && this.menuTag) { this.menuTag.destroy(); this.menuTag = null }
    this.hud.text = ""
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
    this.buildLogo("CHESS")
    // a few pieces drop in and bounce, cream and crimson
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    const right = quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(d)
    "KQRBNPkqrbnp".split("").forEach((ch, i) => {
      const p = cam.add(d.uniformScale(200 + Math.random() * 80)).add(right.uniformScale((i - 5.5) * 22)).add(new vec3(0, 140 + Math.random() * 120, 0))
      const o = this.buildPiece(ch, 12, p, quat.lookAt(d.uniformScale(-1), vec3.up()))
      this.fx.push({obj: o, t: 0, life: 3.6, vel: new vec3(0, -40, 0), gravity: true, floorY: this.floorY})
    })
  }
  private tickIntro(dt: number) {
    if (!this.camT) { this.endIntro(); return }
    this.tickLogo(this.modeT)
    if (this.modeT > 5.5) this.endIntro()
  }
  private endIntro() { this.destroyLogo();
    this.introObjs.forEach((o) => o.destroy())
    this.introObjs = []
    for (let i = this.fx.length - 1; i >= 0; i--) { this.fx[i].obj.destroy() }
    this.fx = []
    this.openMenu()
  }
  private menuItems(): [string, string][] {
    const items: [string, string][] = []
    if (this.st && !this.over) items.push(["RESUME GAME", "resume"])
    items.push(["PLAY vs CPU", "cpu"], ["PLAY A FRIEND (take turns)", "friend"])
    items.push(["BOARD: " + SIZES[this.sizeI].name, "size"], ["CPU: " + LEVELS[this.levelI].name, "level"])
    return items
  }
  private openMenu() {
    this.setMode("menu")
    if (!this.camT) return
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    const items = this.menuItems()
    items.forEach(([label, action], i) => {
      const o = this.makeText(label, 6, new vec4(1, 1, 1, 1))
      const t = o.getComponent("Component.Text") as Text
      try { t.backgroundSettings.enabled = true; t.backgroundSettings.fill.color = new vec4(0.05, 0.08, 0.14, 0.9) } catch (e) {}
      const tr = o.getTransform()
      tr.setWorldPosition(cam.add(d.uniformScale(160)).add(new vec3(0, 50 - i * 26, 0)))
      tr.setWorldRotation(quat.lookAt(d.uniformScale(-1), vec3.up()))
      this.btns.push({obj: o, text: t, action})
    })
    this.hud.text = "iYiYi CHESS"
    this.toast("Look at an option and pinch", 4000)
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
    for (const b of this.btns) b.text.textFill.color = b === g ? GOLD : new vec4(1, 1, 1, 1)
  }
  private runButton(b: Btn) {
    if (b.action === "size") {
      this.sizeI = (this.sizeI + 1) % SIZES.length
      b.text.text = "BOARD: " + SIZES[this.sizeI].name
      this.toast(this.sizeI === 2 ? "Life-size needs about 8 m of open space" : this.sizeI === 1 ? "Floor board: about 2 m of floor" : "Tabletop: 44 cm board", 3000)
      return
    }
    if (b.action === "level") { this.levelI = (this.levelI + 1) % LEVELS.length; b.text.text = "CPU: " + LEVELS[this.levelI].name; return }
    if (b.action === "resume") { this.setMode("chess"); this.buildWorld(); return }
    this.vsCpu = b.action === "cpu"
    this.st = initial()
    this.over = ""
    this.lastMove = null
    this.piles = {w: 0, b: 0}
    this.setMode("chess")
    this.buildWorld()
    this.toast(this.vsCpu ? "You're White (cream). Look at a piece and pinch" : "White (cream) moves first. Take turns", 4000)
  }
  private menuLookedAt(): boolean {
    if (!this.menuTag || !this.camT) return false
    const a = Math.acos(Math.max(-1, Math.min(1, this.menuTag.getTransform().getWorldPosition().sub(this.camT.getWorldPosition()).normalize().dot(this.viewDir()))))
    return a < 9 * D2R
  }
  private placeMenuTag() {
    if (!this.camT) return
    if (!this.menuTag) this.menuTag = this.makeText("≡ MENU", 2.6, new vec4(0.7, 0.75, 0.85, 1))
    const cam = this.camT.getWorldPosition(), d = this.flatDir()
    const right = quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(d)
    const tr = this.menuTag.getTransform()
    // low and off to the left so it isn't in the way of the board
    tr.setWorldPosition(cam.add(d.uniformScale(70)).add(right.uniformScale(-38)).add(new vec3(0, -40, 0)))
    tr.setWorldRotation(quat.lookAt(cam.sub(tr.getWorldPosition()).normalize(), vec3.up()))
    ;(this.menuTag.getComponent("Component.Text") as Text).textFill.color = this.menuLookedAt() ? GOLD : new vec4(0.7, 0.75, 0.85, 1)
  }

  // ------------------------------------------------------------------ board + pieces
  /** world point of a square's centre on the board top (+ height h cm) */
  private S(i: number, h: number = 0): vec3 {
    const f = i % 8, r = Math.floor(i / 8)
    return this.origin.add(this.right.uniformScale((f - 3.5) * this.sq)).add(this.fwd.uniformScale((r - 3.5) * this.sq)).add(new vec3(0, h, 0))
  }
  private buildWorld() {
    this.fx = this.fx.filter((f) => f.life < 1e8) // pile blocks die with the old board
    if (this.root) this.root.destroy()
    this.anims = []
    this.pieces = []
    this.markers = []
    this.markKey = ""
    this.sel = -1
    this.selMoves = []
    const size = SIZES[this.sizeI]
    this.sq = size.sq
    const cam = this.camT.getWorldPosition()
    this.fwd = this.flatDir()
    this.right = quat.angleAxis(-Math.PI / 2, vec3.up()).multiplyVec3(this.fwd)
    const L = this.sq * 8
    let top = this.floorY + 0.6, near = 60
    if (size.id === "table") { top = cam.y - 50; near = 22 }
    if (size.id === "life") near = 100
    this.origin = new vec3(cam.x, top, cam.z).add(this.fwd.uniformScale(near + L / 2))
    this.root = global.scene.createSceneObject("iyChess")
    const th = Math.max(0.4, this.sq * 0.06)
    const light = new vec4(0.34, 0.4, 0.56, 1), dark = new vec4(0.07, 0.08, 0.14, 1)
    for (let i = 0; i < 64; i++) {
      const f = i % 8, r = Math.floor(i / 8)
      const sqObj = this.block(this.S(i, -th / 2), new vec3(this.sq * 0.98, th, this.sq * 0.98), (f + r) % 2 === 1 ? light : dark, this.root)
      if (sqObj) sqObj.getTransform().setWorldRotation(quat.lookAt(this.fwd, vec3.up()))
    }
    // gold frame
    const fw = this.sq * 0.25, rot = quat.lookAt(this.fwd, vec3.up())
    const edge = (along: number, across: number, lenAlong: number, lenAcross: number) => {
      const o = this.block(this.origin.add(this.fwd.uniformScale(along)).add(this.right.uniformScale(across)).add(new vec3(0, -th / 2, 0)), new vec3(lenAcross, th * 1.4, lenAlong), new vec4(0.7, 0.5, 0.15, 1), this.root)
      if (o) o.getTransform().setWorldRotation(rot)
    }
    edge(L / 2 + fw / 2, 0, fw, L + fw * 2)
    edge(-L / 2 - fw / 2, 0, fw, L + fw * 2)
    edge(0, L / 2 + fw / 2, L, fw)
    edge(0, -L / 2 - fw / 2, L, fw)
    for (let i = 0; i < 64; i++) this.pieces.push(this.st.b[i] ? this.makePieceAt(this.st.b[i], i) : null)
    for (let n = 0; n < this.piles.w; n++) this.addPile(true, n, false)
    for (let n = 0; n < this.piles.b; n++) this.addPile(false, n, false)
    this.markKey = ""
    if (this.vsCpu && !this.st.w) this.cpuAt = this.time + 0.8
  }
  private makePieceAt(ch: string, i: number): SceneObject {
    const facing = isW(ch) ? this.fwd : this.fwd.uniformScale(-1)
    const o = this.buildPiece(ch, this.sq, this.S(i), quat.lookAt(facing, vec3.up()))
    if (o && this.root) o.setParent(this.root)
    return o
  }
  /** Block-built piece. s = square size in cm. Built at the origin, then placed. +Z = toward the enemy. */
  private buildPiece(ch: string, s: number, pos: vec3, rot: quat): SceneObject {
    const o = global.scene.createSceneObject("iyPiece")
    const main = isW(ch) ? CREAM : CRIMSON, acc = isW(ch) ? CYAN : GOLD
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, c: vec4) => this.block(new vec3(x * s, (y + h / 2) * s, z * s), new vec3(w * s, h * s, d * s), c, o)
    const u = ch.toUpperCase()
    if (u === "P") {
      add(0, 0, 0, 0.6, 0.12, 0.6, acc); add(0, 0.12, 0, 0.36, 0.4, 0.36, main); add(0, 0.52, 0, 0.42, 0.32, 0.42, main)
    } else if (u === "R") {
      add(0, 0, 0, 0.7, 0.14, 0.7, acc); add(0, 0.14, 0, 0.5, 0.7, 0.5, main); add(0, 0.84, 0, 0.62, 0.12, 0.62, main)
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) add(cx * 0.22, 0.96, cz * 0.22, 0.18, 0.16, 0.18, main)
    } else if (u === "N") {
      add(0, 0, 0, 0.7, 0.14, 0.7, acc); add(0, 0.14, -0.04, 0.44, 0.55, 0.44, main)
      add(0, 0.62, 0.08, 0.4, 0.34, 0.56, main); add(0, 0.62, 0.38, 0.3, 0.2, 0.3, main)
      add(-0.11, 0.96, -0.08, 0.1, 0.18, 0.1, main); add(0.11, 0.96, -0.08, 0.1, 0.18, 0.1, main)
      add(0, 0.7, -0.2, 0.12, 0.3, 0.12, acc) // mane
    } else if (u === "B") {
      add(0, 0, 0, 0.66, 0.14, 0.66, acc); add(0, 0.14, 0, 0.34, 0.8, 0.34, main)
      add(0, 0.94, 0, 0.44, 0.32, 0.44, main); add(0, 1.06, 0, 0.47, 0.05, 0.47, acc); add(0, 1.26, 0, 0.14, 0.14, 0.14, main)
    } else if (u === "Q") {
      add(0, 0, 0, 0.74, 0.14, 0.74, acc); add(0, 0.14, 0, 0.42, 0.9, 0.42, main); add(0, 1.04, 0, 0.6, 0.08, 0.6, acc)
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; add(Math.cos(a) * 0.22, 1.12, Math.sin(a) * 0.22, 0.12, 0.2, 0.12, main) }
      add(0, 1.18, 0, 0.18, 0.18, 0.18, acc)
    } else {
      add(0, 0, 0, 0.76, 0.14, 0.76, acc); add(0, 0.14, 0, 0.46, 1.0, 0.46, main); add(0, 1.14, 0, 0.64, 0.1, 0.64, acc)
      add(0, 1.24, 0, 0.5, 0.24, 0.5, main); add(0, 1.48, 0, 0.1, 0.42, 0.1, acc); add(0, 1.66, 0, 0.34, 0.1, 0.1, acc)
    }
    const tr = o.getTransform()
    tr.setWorldPosition(pos)
    tr.setWorldRotation(rot)
    return o
  }

  // ------------------------------------------------------------------ picking + moving
  private pick(ray: vec3[]): number {
    if (!this.origin) return -1
    const o = ray[0], d = ray[1]
    if (d.y > -0.0001) return -1
    const t = (this.origin.y - o.y) / d.y
    const p = o.add(d.uniformScale(t)).sub(this.origin)
    const f = Math.floor(p.dot(this.right) / this.sq + 4), r = Math.floor(p.dot(this.fwd) / this.sq + 4)
    return inB(f, r) ? r * 8 + f : -1
  }
  private humanTurn() { return !this.over && (!this.vsCpu || this.st.w) }
  private choose(i: number) {
    if (this.anims.length || !this.humanTurn()) return
    if (i < 0) { this.sel = -1; this.selMoves = []; return }
    const p = this.st.b[i]
    if (p !== "" && isW(p) === this.st.w) {
      this.sel = i
      this.selMoves = legal(this.st).filter((m) => m.f === i)
      if (!this.selMoves.length) this.toast("That " + NAMES[p.toUpperCase()] + " can't move")
      return
    }
    const m = this.selMoves.find((x) => x.t === i)
    if (m) { this.play(m); return }
    this.sel = -1
    this.selMoves = []
  }
  private play(m: Mv) {
    const s = this.st
    this.sel = -1
    this.selMoves = []
    this.lastMove = m
    const obj = this.pieces[m.f]
    this.pieces[m.f] = null
    // capture
    const victimSq = m.ep ? epVictim(m) : m.c ? m.t : -1
    if (victimSq >= 0) {
      const v = this.pieces[victimSq]
      this.pieces[victimSq] = null
      const delay = 0.3
      this.anims.push({obj: null, a: null, b: null, t: 0, dur: delay, hop: 0, done: () => { if (v) { this.shatter(v, this.S(victimSq), isW(m.c)) } }})
    }
    const hop = m.p.toUpperCase() === "N" ? this.sq * 0.9 : this.sq * 0.15
    const dist = Math.max(Math.abs((m.f % 8) - (m.t % 8)), Math.abs(Math.floor(m.f / 8) - Math.floor(m.t / 8)))
    this.anims.push({obj, a: this.S(m.f), b: this.S(m.t), t: 0, dur: 0.3 + dist * 0.07, hop, done: () => {
      if (m.promo && obj) { obj.destroy(); this.pieces[m.t] = this.makePieceAt(m.promo, m.t); this.burstAt(this.S(m.t, this.sq), this.sq * 0.18, 14); this.toast("Promoted to a queen!") }
    }})
    this.pieces[m.t] = obj
    if (m.castle) {
      const rk = castleRook(m), ro = this.pieces[rk[0]]
      this.pieces[rk[0]] = null
      this.pieces[rk[1]] = ro
      this.anims.push({obj: ro, a: this.S(rk[0]), b: this.S(rk[1]), t: 0, dur: 0.45, hop: this.sq * 0.6})
    }
    this.st = make(s, m)
    this.markKey = ""
    const replies = legal(this.st)
    const check = inCheck(this.st)
    const sideName = (w: boolean) => (this.vsCpu ? (w ? "You" : "CPU") : w ? "White" : "Red")
    if (!replies.length) {
      this.over = check ? "CHECKMATE! " + sideName(!this.st.w) + (this.vsCpu && this.st.w ? " wins" : this.vsCpu ? " win!" : " wins!") : "STALEMATE: draw"
      this.toast(this.over, 8000)
      if (check) this.celebrate(this.S(kingSq(this.st.b, this.st.w)))
    } else if (this.st.half >= 100) { this.over = "DRAW (50 moves)"; this.toast(this.over, 6000) }
    else if (insufficient(this.st.b)) { this.over = "DRAW (only kings left)"; this.toast(this.over, 6000) }
    else if (check) this.toast("CHECK!", 2000)
    if (!this.over && this.vsCpu && !this.st.w) this.cpuAt = this.time + 0.7
  }
  private shatter(obj: SceneObject, at: vec3, victimWhite: boolean) {
    obj.destroy()
    this.burstAt(at.add(new vec3(0, this.sq * 0.5, 0)), this.sq * 0.16, 16)
    const n = victimWhite ? this.piles.w++ : this.piles.b++
    this.addPile(victimWhite, n, true)
  }
  /** a little pile of colourful blocks beside the board for each captured piece (cream ones on your left, red on your right) */
  private addPile(victimWhite: boolean, n: number, drop: boolean) {
    const sign = victimWhite ? -1 : 1, s = this.sq
    const base = this.origin.add(this.right.uniformScale(sign * (s * 4.9 + Math.floor(n / 8) * s))).add(this.fwd.uniformScale((-3.5 + (n % 8)) * s))
    for (let k = 0; k < 6; k++) {
      const land = this.origin.y + s * 0.11 + Math.floor(k / 3) * s * 0.2
      const x = (k % 3 - 1) * s * 0.24 + (Math.random() - 0.5) * s * 0.08, z = (Math.random() - 0.5) * s * 0.3
      const p = base.add(this.right.uniformScale(x)).add(this.fwd.uniformScale(z)).add(new vec3(0, drop ? s * (1.5 + k * 0.4) : land - this.origin.y, 0))
      const c = k % 2 ? (victimWhite ? CREAM : CRIMSON) : PAL[(n + k) % PAL.length]
      const b = this.block(p, new vec3(s * 0.22, s * 0.22, s * 0.22), c, this.root)
      if (!b) continue
      b.getTransform().setWorldRotation(quat.angleAxis(Math.random() * Math.PI, vec3.up()))
      if (drop) this.fx.push({obj: b, t: 0, life: 1e9, vel: new vec3(0, -s, 0), gravity: true, floorY: land})
    }
  }
  private burstAt(at: vec3, size: number, n: number) {
    for (let i = 0; i < n; i++) {
      const v = new vec3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().uniformScale(size * (6 + Math.random() * 8))
      const o = this.block(at, new vec3(size, size, size), PAL[i % PAL.length])
      if (o) this.fx.push({obj: o, t: 0, life: 0.9, vel: v, spin: new vec3(3, 4, 2)})
    }
  }
  private celebrate(at: vec3) {
    for (let k = 0; k < 4; k++) this.anims.push({obj: null, a: null, b: null, t: 0, dur: 0.4 + k * 0.5, hop: 0, done: () => this.burstAt(at.add(new vec3(0, this.sq * 2, 0)), this.sq * 0.2, 24)})
  }
  private tickAnims(dt: number) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]
      a.t += dt
      const k = Math.min(1, a.t / a.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      if (a.obj && a.a) {
        const p = vec3.lerp(a.a, a.b, e).add(new vec3(0, Math.sin(Math.PI * k) * a.hop, 0))
        a.obj.getTransform().setWorldPosition(p)
      }
      if (k >= 1) { this.anims.splice(i, 1); if (a.done) a.done() }
    }
  }

  // ------------------------------------------------------------------ per frame
  private tickChess() {
    if (!this.camT || !this.st) return
    this.placeMenuTag()
    // CPU move
    if (!this.over && this.vsCpu && !this.st.w && !this.anims.length && this.time > this.cpuAt) {
      const lv = LEVELS[this.levelI]
      const m = bestMove(this.st, lv.depth, lv.noise)
      if (m) this.play(m)
    }
    this.hover = this.pick([this.camT.getWorldPosition(), this.viewDir()])
    const turn = this.over ? this.over : this.vsCpu ? (this.st.w ? "Your move" : "CPU thinking...") : (this.st.w ? "White's move (cream)" : "Red's move")
    const lm = this.lastMove ? "Last: " + NAMES[this.lastMove.p.toUpperCase()] + " " + this.sqName(this.lastMove.f) + "→" + this.sqName(this.lastMove.t) : ""
    this.hud.text = "CHESS  " + SIZES[this.sizeI].name + "\n" + turn + (inCheck(this.st) && !this.over ? "  CHECK" : "") + "\n" + lm
    this.drawMarkers()
  }
  private sqName(i: number) { return "abcdefgh"[i % 8] + (Math.floor(i / 8) + 1) }
  private drawMarkers() {
    const key = this.hover + "|" + this.sel + "|" + this.selMoves.length + "|" + (this.lastMove ? this.lastMove.f + "-" + this.lastMove.t : "")
    if (key === this.markKey) return
    this.markKey = key
    this.markers.forEach((m) => m.destroy())
    this.markers = []
    const s = this.sq, h = Math.max(0.3, s * 0.03), rot = quat.lookAt(this.fwd, vec3.up())
    const frame = (i: number, c: vec4, thick: number) => {
      const p = this.S(i, h / 2 + 0.05)
      const bars: [number, number, number, number][] = [[0, s * 0.45, s * 0.96, thick], [0, -s * 0.45, s * 0.96, thick], [s * 0.45, 0, thick, s * 0.96], [-s * 0.45, 0, thick, s * 0.96]]
      for (const b of bars) {
        const o = this.block(p.add(this.right.uniformScale(b[0])).add(this.fwd.uniformScale(b[1])), new vec3(b[2], h, b[3]), c, this.root)
        if (o) { o.getTransform().setWorldRotation(rot); this.markers.push(o) }
      }
    }
    if (this.lastMove) { frame(this.lastMove.f, new vec4(0.45, 0.4, 0.2, 1), s * 0.05); frame(this.lastMove.t, new vec4(0.6, 0.5, 0.2, 1), s * 0.05) }
    for (const m of this.selMoves) {
      if (m.c) frame(m.t, RED, s * 0.08)
      else { const o = this.block(this.S(m.t, h / 2 + 0.05), new vec3(s * 0.26, h, s * 0.26), GREEN, this.root); if (o) { o.getTransform().setWorldRotation(rot); this.markers.push(o) } }
    }
    if (this.sel >= 0) frame(this.sel, CYAN, s * 0.1)
    if (this.hover >= 0 && this.hover !== this.sel && this.humanTurn()) frame(this.hover, GOLD, s * 0.06)
  }
}
