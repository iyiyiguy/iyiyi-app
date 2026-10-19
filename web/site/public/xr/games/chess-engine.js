// Chess rules (same engine as the Specs Lens): moves, check, castling, en passant, promotion, CPU search.
export const isW = (p) => p !== "" && p === p.toUpperCase();
const N_OFF = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const K_OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISH_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
export const NAMES = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
export const inB = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
export function initial() {
  const back = "RNBQKBNR";
  const b = [];
  for (let i = 0; i < 64; i++)
    b.push("");
  for (let f = 0; f < 8; f++) {
    b[f] = back[f];
    b[8 + f] = "P";
    b[48 + f] = "p";
    b[56 + f] = back[f].toLowerCase();
  }
  return { b, w: true, cr: "KQkq", ep: -1, half: 0 };
}
export function attacked(b, sq, byWhite) {
  const f = sq % 8, r = Math.floor(sq / 8);
  const pr = byWhite ? r - 1 : r + 1, pawn = byWhite ? "P" : "p";
  if (pr >= 0 && pr < 8)
    for (const df of [-1, 1]) {
      const ff = f + df;
      if (ff >= 0 && ff < 8 && b[pr * 8 + ff] === pawn)
        return true;
    }
  const kn = byWhite ? "N" : "n", kg = byWhite ? "K" : "k";
  for (const o of N_OFF) {
    const ff = f + o[0], rr = r + o[1];
    if (inB(ff, rr) && b[rr * 8 + ff] === kn)
      return true;
  }
  for (const o of K_OFF) {
    const ff = f + o[0], rr = r + o[1];
    if (inB(ff, rr) && b[rr * 8 + ff] === kg)
      return true;
  }
  const slide = (dirs, a, q) => {
    for (const d of dirs) {
      let ff = f + d[0], rr = r + d[1];
      while (inB(ff, rr)) {
        const p = b[rr * 8 + ff];
        if (p !== "") {
          if (p === a || p === q)
            return true;
          break;
        }
        ff += d[0];
        rr += d[1];
      }
    }
    return false;
  };
  return slide(ROOK_D, byWhite ? "R" : "r", byWhite ? "Q" : "q") || slide(BISH_D, byWhite ? "B" : "b", byWhite ? "Q" : "q");
}
export const kingSq = (b, white) => b.indexOf(white ? "K" : "k");
export function pseudo(s) {
  const ms = [], b = s.b, w = s.w;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === "" || isW(p) !== w)
      continue;
    const f = sq % 8, r = Math.floor(sq / 8), u = p.toUpperCase();
    const add = (t) => {
      if (b[t] === "" || isW(b[t]) !== w)
        ms.push({ f: sq, t, p, c: b[t] });
    };
    if (u === "P") {
      const dir = w ? 1 : -1, r1 = r + dir, last = w ? 7 : 0;
      const pawnTo = (t, c) => ms.push(Math.floor(t / 8) === last ? { f: sq, t, p, c, promo: w ? "Q" : "q" } : { f: sq, t, p, c });
      if (r1 >= 0 && r1 < 8 && b[r1 * 8 + f] === "") {
        pawnTo(r1 * 8 + f, "");
        if (r === (w ? 1 : 6) && b[(r + 2 * dir) * 8 + f] === "")
          ms.push({ f: sq, t: (r + 2 * dir) * 8 + f, p, c: "", dbl: true });
      }
      for (const df of [-1, 1]) {
        const ff = f + df;
        if (!inB(ff, r1))
          continue;
        const t = r1 * 8 + ff;
        if (b[t] !== "" && isW(b[t]) !== w)
          pawnTo(t, b[t]);
        else if (t === s.ep)
          ms.push({ f: sq, t, p, c: w ? "p" : "P", ep: true });
      }
    } else if (u === "N" || u === "K") {
      for (const o of u === "N" ? N_OFF : K_OFF) {
        const ff = f + o[0], rr = r + o[1];
        if (inB(ff, rr))
          add(rr * 8 + ff);
      }
      if (u === "K") {
        const enemy = !w, home = w ? 4 : 60, R = w ? "R" : "r";
        if (sq === home && !attacked(b, home, enemy)) {
          if (s.cr.indexOf(w ? "K" : "k") >= 0 && b[home + 1] === "" && b[home + 2] === "" && b[home + 3] === R && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy))
            ms.push({ f: sq, t: home + 2, p, c: "", castle: true });
          if (s.cr.indexOf(w ? "Q" : "q") >= 0 && b[home - 1] === "" && b[home - 2] === "" && b[home - 3] === "" && b[home - 4] === R && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy))
            ms.push({ f: sq, t: home - 2, p, c: "", castle: true });
        }
      }
    } else {
      const dirs = u === "R" ? ROOK_D : u === "B" ? BISH_D : ROOK_D.concat(BISH_D);
      for (const d of dirs) {
        let ff = f + d[0], rr = r + d[1];
        while (inB(ff, rr)) {
          const t = rr * 8 + ff;
          if (b[t] === "")
            ms.push({ f: sq, t, p, c: "" });
          else {
            add(t);
            break;
          }
          ff += d[0];
          rr += d[1];
        }
      }
    }
  }
  return ms;
}
export function castleRook(m) {
  return m.t > m.f ? [m.f + 3, m.f + 1] : [m.f - 4, m.f - 1];
}
export function epVictim(m) {
  return m.t + (isW(m.p) ? -8 : 8);
}
export function make(s, m) {
  const b = s.b.slice();
  b[m.t] = m.promo || m.p;
  b[m.f] = "";
  if (m.ep)
    b[epVictim(m)] = "";
  if (m.castle) {
    const rk = castleRook(m);
    b[rk[1]] = b[rk[0]];
    b[rk[0]] = "";
  }
  let cr = s.cr;
  const strip = (ch) => {
    cr = cr.replace(ch, "");
  };
  if (m.p === "K") {
    strip("K");
    strip("Q");
  }
  if (m.p === "k") {
    strip("k");
    strip("q");
  }
  if (m.f === 0 || m.t === 0)
    strip("Q");
  if (m.f === 7 || m.t === 7)
    strip("K");
  if (m.f === 56 || m.t === 56)
    strip("q");
  if (m.f === 63 || m.t === 63)
    strip("k");
  return { b, w: !s.w, cr, ep: m.dbl ? (m.f + m.t) / 2 : -1, half: m.p === "P" || m.p === "p" || m.c !== "" ? 0 : s.half + 1 };
}
export function legal(s) {
  return pseudo(s).filter((m) => {
    const n = make(s, m);
    return !attacked(n.b, kingSq(n.b, s.w), !s.w);
  });
}
export function inCheck(s) {
  return attacked(s.b, kingSq(s.b, s.w), !s.w);
}
export function insufficient(b) {
  const rest = b.filter((p) => p !== "" && p !== "K" && p !== "k");
  return rest.length === 0 || rest.length === 1 && "NnBb".indexOf(rest[0]) >= 0;
}
export function evalW(b) {
  let e = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === "")
      continue;
    const u = p.toUpperCase(), f = sq % 8, r = Math.floor(sq / 8), w = isW(p);
    const c = 7 - (Math.abs(f - 3.5) + Math.abs(r - 3.5));
    let v = VAL[u];
    if (u === "N" || u === "B" || u === "P")
      v += c * 4;
    if (u === "Q")
      v += c;
    if (u === "P")
      v += (w ? r - 1 : 6 - r) * 6;
    if (u === "K")
      v -= c * 3;
    e += w ? v : -v;
  }
  return e;
}
const capVal = (m) => (m.c ? VAL[m.c.toUpperCase()] * 10 - VAL[m.p.toUpperCase()] / 10 : 0) + (m.promo ? 800 : 0);
export function search(s, depth, alpha, beta) {
  if (depth === 0)
    return s.w ? evalW(s.b) : -evalW(s.b);
  const ms = legal(s);
  if (!ms.length)
    return inCheck(s) ? -1e5 - depth : 0;
  ms.sort((a, b) => capVal(b) - capVal(a));
  for (const m of ms) {
    const v = -search(make(s, m), depth - 1, -beta, -alpha);
    if (v >= beta)
      return v;
    if (v > alpha)
      alpha = v;
  }
  return alpha;
}
export function bestMove(s, depth, noise) {
  const ms = legal(s);
  ms.sort((a, b) => capVal(b) - capVal(a));
  let best = null, bv = -1e9, braw = -1e9;
  for (const m of ms) {
    const raw = noise > 0 ? -search(make(s, m), depth - 1, -1e9, 1e9) : -search(make(s, m), depth - 1, -1e9, -braw);
    const v = raw + Math.random() * noise;
    if (raw > braw)
      braw = raw;
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return best;
}
