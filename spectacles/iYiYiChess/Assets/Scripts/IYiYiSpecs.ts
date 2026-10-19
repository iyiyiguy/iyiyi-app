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

// iYiYi people (every Lens): link your account once, then iYiYi members nearby who allow tagging get
// a name tag over their head, even mid-game. Look at a tag and pinch: their profile, then socials.
const PP_URL = "https://sqsjwcsrgcgcpxccxedp.supabase.co"
const PP_ANON = "sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x"
const PP_STORE = "iyiyi_specs_session_v1"
const PP_LABELS: {[k: string]: string} = {instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", twitter: "X", snapchat: "Snapchat", linkedin: "LinkedIn", whatsapp: "WhatsApp", spotify: "Spotify", soundcloud: "SoundCloud", youtube: "YouTube", discord: "Discord", twitch: "Twitch", telegram: "Telegram"}
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
        if (this.mode !== "menu" && this.envTapped(tp)) return
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
    this.ppInit()
    this.startIntro()
  }

  private onPinch(ray: vec3[]) {
    if (this.mode === "intro") { this.endIntro(); return }
    if (this.mode === "menu") { const g = this.gazed(); if (g) this.runButton(g); return }
    if (!ray && this.mode !== "menu" && this.envPinch()) return // the WORLD tag: next environment
    if (!ray && !this.menuLookedAt() && this.ppPinch()) return // looking at an iYiYi person: their profile, mid-game
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
    this.ppTick(Date.now())
    this.envTick(dt)
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
    items.push(["BOARD: " + SIZES[this.sizeI].name, "size"], ["CPU: " + LEVELS[this.levelI].name, "level"], [this.ppMenuLabel(), "pplink"])
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
      tr.setWorldPosition(cam.add(d.uniformScale(210)).add(new vec3(0, 54 - i * 16, 0)))
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
    if (b.action === "pplink") { this.ppMenuPress(); b.text.text = this.ppMenuLabel(); return }
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
