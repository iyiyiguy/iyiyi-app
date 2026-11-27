// Liquidation heatmap model, shared by the web page and the Node backtest.
// Estimates where leveraged positions would be liquidated, from open-interest changes,
// price, the long/short account ratio and taker buy/sell volume. It is an estimate:
// no exchange publishes where its traders' liquidation prices or stop losses are.
(function (root) {
  const TIERS = [ [5, 0.15], [10, 0.30], [25, 0.30], [50, 0.15], [100, 0.10] ];
  const MMR = 0.005;          // maintenance margin
  const NB = 420;             // price bins

  // series: {t[], o[], h[], l[], c[], oi[] (USD), ls[] (long/short account ratio), buy[], sell[] (USD)}
  function run(s) {
    const n = s.t.length;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (s.l[i] < lo) lo = s.l[i]; if (s.h[i] > hi) hi = s.h[i]; }
    const pmin = lo * 0.82, pmax = hi * 1.22;
    const lmin = Math.log(pmin), lspan = Math.log(pmax) - lmin;
    const binOf = p => Math.max(0, Math.min(NB - 1, Math.floor((Math.log(p) - lmin) / lspan * NB)));
    const priceOf = b => Math.exp(lmin + (b + 0.5) / NB * lspan);
    const longL = new Float64Array(NB), shortL = new Float64Array(NB);
    const framesLong = [], framesShort = [];
    const liqLong = new Float64Array(n), liqShort = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const tp = (s.h[i] + s.l[i] + s.c[i]) / 3;
      // 1) positions liquidated by this bar's range
      // a long is liquidated once the low trades at or below its level; a short once the high reaches it
      for (let b = 0; b < NB; b++) {
        const p = priceOf(b);
        if (longL[b] && p >= s.l[i]) { liqLong[i] += longL[b]; longL[b] = 0; }
        if (shortL[b] && p <= s.h[i]) { liqShort[i] += shortL[b]; shortL[b] = 0; }
      }
      // 2) open-interest change: new positions open at the bar's typical price, or positions close
      if (i > 0) {
        const d = s.oi[i] - s.oi[i - 1];
        if (d > 0) {
          const r = s.ls[i] > 0 ? s.ls[i] : 1;
          const acct = r / (1 + r);
          const tb = s.buy[i] + s.sell[i];
          const taker = tb > 0 ? s.buy[i] / tb : 0.5;
          const longShare = 0.5 * acct + 0.5 * taker;
          for (const [L, w] of TIERS) {
            const pl = tp * (1 - 1 / L + MMR), ps = tp * (1 + 1 / L - MMR);
            if (pl > pmin) longL[binOf(pl)] += d * longShare * w;
            if (ps < pmax) shortL[binOf(ps)] += d * (1 - longShare) * w;
          }
        } else if (d < 0 && s.oi[i - 1] > 0) {
          const f = Math.max(0, 1 + d / s.oi[i - 1]);
          for (let b = 0; b < NB; b++) { longL[b] *= f; shortL[b] *= f; }
        }
      }
      framesLong.push(Float32Array.from(longL));
      framesShort.push(Float32Array.from(shortL));
    }
    return { n, NB, pmin, pmax, binOf, priceOf, framesLong, framesShort, liqLong, liqShort };
  }

  // Load OKX rows into aligned arrays (shared by page and backtest)
  function align(raw, ctVal) {
    const m = {};
    for (const r of raw.c) m[+r[0]] = { o: +r[1], h: +r[2], l: +r[3], c: +r[4] };
    for (const r of raw.oi) if (m[+r[0]]) m[+r[0]].oi = +r[3];
    for (const r of raw.ls) if (m[+r[0]]) m[+r[0]].ls = +r[1];
    for (const r of raw.tk) if (m[+r[0]]) { m[+r[0]].sell = +r[1]; m[+r[0]].buy = +r[2]; }
    const ts = Object.keys(m).map(Number).filter(t => m[t].oi !== undefined).sort((a, b) => a - b);
    const s = { t: [], o: [], h: [], l: [], c: [], oi: [], ls: [], buy: [], sell: [] };
    let lastLs = 1;
    for (const t of ts) {
      const x = m[t];
      if (x.ls !== undefined) lastLs = x.ls;
      s.t.push(t); s.o.push(x.o); s.h.push(x.h); s.l.push(x.l); s.c.push(x.c); s.oi.push(x.oi); s.ls.push(lastLs);
      s.buy.push((x.buy || 0) * ctVal * x.c); s.sell.push((x.sell || 0) * ctVal * x.c);
    }
    return s;
  }

  const api = { run, align, TIERS, NB };
  if (typeof module !== 'undefined') module.exports = api; else root.LiqModel = api;
})(this);
