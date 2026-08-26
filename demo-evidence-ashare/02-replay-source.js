// portfolio-watch-ashare — deterministic 12-month rule replay (A-share book).
// NOT a strategy backtest: no trades, no P&L simulation. Close-run rules only:
// raw sigma move, sector leave-one-out residual, systematic cluster collapse,
// limit hits (ChiNext 20% / main board 10%), volume anomaly, drift band
// crossings and drawdown episodes with the live producer's hysteresis.
// Assumptions disclosed in the summary row.

const { Feed, feedPath } = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const secret = require("secret-manager");

const ARRAYS = "https://data-tools.prd.arrays.org";
const K = 3, CORR_MIN = 0.5, BAND = 0.05, REARM = 0.01, VOL_MULT = 3;
const HOLD = { "300308.SZ": 3000, "300502.SZ": 1000, "300394.SZ": 1000, "600519.SS": 100, CASH: 660000 };
const TGT = { "300308.SZ": 0.50, "300502.SZ": 0.10, "300394.SZ": 0.10, "600519.SS": 0.05, CASH: 0.25 };
const EQ = ["300308.SZ", "300502.SZ", "300394.SZ", "600519.SS"];
const CLUSTER = ["300308.SZ", "300502.SZ", "300394.SZ"];
const NAME = { "300308.SZ": "中际旭创", "300502.SZ": "新易盛", "300394.SZ": "天孚通信", "600519.SS": "茅台" };
const limitFor = (s) => (/^(300|688)/.test(s) ? 0.20 : 0.10);

async function getJson(jwt, url) {
  const r = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  const b = await r.json();
  if (!Array.isArray(b.data)) throw new Error("bad envelope " + url);
  return b.data;
}
const mean = (a) => jStat.mean(a);
function betaOf(ri, rb) {
  const n = Math.min(ri.length, rb.length), a = ri.slice(-n), b = rb.slice(-n);
  const ma = mean(a), mb = mean(b);
  let cov = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i]-ma)*(b[i]-mb); vb += (b[i]-mb)**2; }
  return vb > 0 ? cov / vb : null;
}
function corrOf(a0, b0) {
  const n = Math.min(a0.length, b0.length), a = a0.slice(-n), b = b0.slice(-n);
  const ma = mean(a), mb = mean(b);
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i]-ma)*(b[i]-mb); va += (a[i]-ma)**2; vb += (b[i]-mb)**2; }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
}

(async () => {
  const jwt = secret.loadPlaintext("ARRAYS_JWT");
  const now = Math.floor(Date.now() / 1000);
  const eq = {};
  for (const s of EQ) {
    const d = await getJson(jwt, ARRAYS + "/api/v1/stocks/non-us/kline?symbol=" +
      encodeURIComponent(s) + "&start_time=" + (now - 470 * 86400) + "&end_time=" + now +
      "&interval=1d&limit=330");
    eq[s] = d.slice().reverse(); // chronological
  }
  // Align on 中际旭创's trading calendar (SZ/SS share sessions)
  const cal = eq["300308.SZ"];
  const idx = {};
  for (const s of EQ) { idx[s] = {}; eq[s].forEach((b, i) => { idx[s][b.time_close] = i; }); }

  const events = [];
  const lastState = {};
  let vals = null; // chain-linked position values (CA-day price moves are not P&L)
  let evaluated = 0;
  const counts = { systematic: 0, resid: 0, raw: 0, limit: 0, ca: 0, volume: 0, drift: 0, drawdown: 0 };
  const navSeries = [];
  const start = Math.max(61, cal.length - 250);

  for (let i = start; i < cal.length; i++) {
    const anchor = cal[i];
    const day = anchor.time_period_end.slice(0, 10);
    evaluated++;
    const kinds = [], notes = [];

    const win = {};
    let ok = true;
    for (const s of EQ) {
      const j = idx[s][anchor.time_close];
      if (j == null || j < 61) { ok = false; break; }
      const closes = eq[s].slice(j - 61, j + 1).map((b) => b.price_close);
      const r = [];
      for (let x = 1; x < closes.length; x++) r.push(closes[x] / closes[x - 1] - 1);
      // neutralize corporate-action days (|ret| > limit+2pp on un-adjusted
      // prices) in rolling stats; today's ret stays raw and is CA-classified
      const limS = limitFor(s);
      const rAdj = r.map((x) => (Math.abs(x) > limS + 0.02 ? 0 : x));
      win[s] = { j, ret: r[r.length - 1], rets60: rAdj.slice(0, -1),
        sigma20: jStat.stdev(rAdj.slice(-21, -1), true),
        vol: eq[s][j].volume_traded,
        avgvol: mean(eq[s].slice(j - 20, j).map((b) => b.volume_traded)),
        close: eq[s][j].price_close };
    }
    if (!ok) continue;

    // corporate actions vs limit hits (un-adjusted data: beyond-limit = ex-div)
    const limited = {};
    for (const s of EQ) {
      const lim = limitFor(s);
      const a = Math.abs(win[s].ret);
      if (a > lim + 0.02) {
        limited[s] = true; // CA day: suppress all price judgments for s
        kinds.push("corporate_action:" + s); counts.ca++;
        notes.push(NAME[s] + " 除权除息日 (" + (win[s].ret * 100).toFixed(1) + "%，超出限价 — 非交易行情，静默)");
      } else if (a >= lim - 0.005) {
        limited[s] = true;
        kinds.push("limit_hit:" + s); counts.limit++;
        notes.push(NAME[s] + (win[s].ret > 0 ? " 涨停" : " 跌停") + " (" + (win[s].ret * 100).toFixed(1) + "%)");
      }
    }
    // raw sigma moves + cluster collapse (cluster members only)
    const raws = [];
    for (const s of CLUSTER) {
      if (limited[s]) continue;
      const sc = win[s].sigma20 ? Math.abs(win[s].ret) / win[s].sigma20 : 0;
      if (sc >= K) raws.push({ s, dir: win[s].ret > 0 ? 1 : -1, sc });
    }
    const avgCorr = mean([
      corrOf(win["300308.SZ"].rets60, win["300502.SZ"].rets60),
      corrOf(win["300308.SZ"].rets60, win["300394.SZ"].rets60),
      corrOf(win["300502.SZ"].rets60, win["300394.SZ"].rets60)].filter((x) => x != null));
    const sameDir = raws.length >= 2 && raws.every((r) => r.dir === raws[0].dir);
    if (sameDir && avgCorr >= CORR_MIN) {
      kinds.push("systematic_move"); counts.systematic++;
      notes.push("光模块板块同向" + (raws[0].dir > 0 ? "上涨" : "下跌") +
        " (" + raws.map((r) => NAME[r.s] + " " + r.sc.toFixed(1) + "σ").join(", ") + "; corr " + avgCorr.toFixed(2) + ")");
    } else {
      for (const r of raws) {
        kinds.push("price_move:" + r.s); counts.raw++;
        notes.push(NAME[r.s] + " " + (win[r.s].ret * 100).toFixed(1) + "% (" + r.sc.toFixed(1) + "σ)");
      }
    }
    // Moutai (non-cluster): raw sigma only
    if (!limited["600519.SS"]) {
      const sc = win["600519.SS"].sigma20 ? Math.abs(win["600519.SS"].ret) / win["600519.SS"].sigma20 : 0;
      if (sc >= K) {
        kinds.push("price_move:600519.SS"); counts.raw++;
        notes.push("茅台 " + (win["600519.SS"].ret * 100).toFixed(1) + "% (" + sc.toFixed(1) + "σ)");
      }
    }
    // sector leave-one-out residuals (cluster members)
    for (const s of CLUSTER) {
      const peers = CLUSTER.filter((p) => p !== s);
      const n = Math.min(...peers.map((p) => win[p].rets60.length), win[s].rets60.length);
      const bench = [];
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (const p of peers) acc += win[p].rets60[win[p].rets60.length - n + x];
        bench.push(acc / peers.length);
      }
      const b = betaOf(win[s].rets60.slice(-n), bench);
      if (b == null) continue;
      const resid = [];
      for (let x = 0; x < n; x++) resid.push(win[s].rets60[win[s].rets60.length - n + x] - b * bench[x]);
      const rs = jStat.stdev(resid, true);
      const benchToday = mean(peers.map((p) =>
        Math.abs(win[p].ret) > limitFor(p) + 0.02 ? 0 : win[p].ret));
      const todayResid = win[s].ret - b * benchToday;
      if (!limited[s] && rs && Math.abs(todayResid) / rs >= K) {
        kinds.push("resid_move:" + s); counts.resid++;
        notes.push(NAME[s] + " 板块残差 " + (todayResid * 100).toFixed(1) + "% (" + (Math.abs(todayResid) / rs).toFixed(1) + "× 残差σ)");
      }
    }
    // volume anomaly
    for (const s of EQ) {
      if (win[s].avgvol && win[s].vol >= VOL_MULT * win[s].avgvol) {
        kinds.push("volume_anomaly:" + s); counts.volume++;
        notes.push(NAME[s] + " 量 " + (win[s].vol / win[s].avgvol).toFixed(1) + "×20日均");
      }
    }
    // NAV: chain-linked from neutralized returns — an ex-div/split price drop
    // is not a P&L event for a holder (shares adjust); dividends not modeled.
    if (!vals) {
      vals = { CASH: HOLD.CASH };
      for (const s of EQ) vals[s] = HOLD[s] * win[s].close;
    } else {
      for (const s of EQ) vals[s] *= 1 + (Math.abs(win[s].ret) > limitFor(s) + 0.02 ? 0 : win[s].ret);
    }
    const nav = EQ.reduce((a, s) => a + vals[s], 0) + vals.CASH;
    navSeries.push(nav);
    for (const s of EQ.concat(["CASH"])) {
      const v = vals[s];
      const w = v / nav;
      const dev = w - TGT[s];
      const out = dev > BAND ? "over" : dev < -BAND ? "under" : null;
      const kkey = "drift:" + s;
      const st = lastState[kkey] === undefined ? "init" : lastState[kkey];
      if (st === "init") { lastState[kkey] = out || "armed"; continue; }
      if (out && st === "armed") {
        kinds.push("drift:" + s); counts.drift++;
        notes.push((NAME[s] || s) + " " + (w * 100).toFixed(1) + "% 出 " + (TGT[s] * 100).toFixed(0) + "±5pp 带 (" + out + ")");
        lastState[kkey] = out;
      } else if (!out && st !== "armed" && Math.abs(dev) <= BAND - REARM) {
        lastState[kkey] = "armed";
      }
    }
    const hi30 = Math.max(...navSeries.slice(-22));
    const dd = (1 - nav / hi30) * 100;
    const band = [5, 10, 15, 20, 30].filter((b) => dd >= b).pop() || 0;
    if (lastState.ddEp === undefined) lastState.ddEp = { active: band > 0, deepest: band };
    else if (band > 0 && (!lastState.ddEp.active || band > lastState.ddEp.deepest)) {
      kinds.push("drawdown"); counts.drawdown++;
      notes.push("回撤越过 −" + band + "% (30日高" + (lastState.ddEp.active ? "，加深" : "") + ")");
      lastState.ddEp = { active: true, deepest: band };
    } else if (lastState.ddEp.active && dd < 2.5) {
      lastState.ddEp = { active: false, deepest: 0 };
    }

    if (kinds.length) events.push({ day, kinds: kinds.join(","), headline: notes.join("; ") });
  }

  const feed = new Feed({ path: feedPath("portfolio-watch-ashare") });
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    await ctx.self.ts("replay", "log").append(events.map((e) => ({
      date: Date.parse(e.day), day: e.day, kinds: e.kinds, headline: e.headline })));
    await ctx.self.ts("replay", "summary").append([{
      date: nowMs, days_evaluated: evaluated, alert_days: events.length,
      systematic_days: counts.systematic, resid_days: counts.resid,
      limit_days: counts.limit, drift_days: counts.drift, drawdown_days: counts.drawdown,
      per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
      window: "last " + evaluated + " trading days",
      assumptions: "NAV chain-linked from neutralized returns (ex-div price moves are not P&L; dividends not modeled); corporate-action days (|ret|>limit+2pp, un-adjusted prices) neutralized in rolling stats and exempt from price alerts; share counts fixed at today's declared holdings; close-run rules only (no intraday/gap); sector leave-one-out benchmark (no market index on platform); normal preset K=3; hysteresis re-arm (drift 1pp inside band; drawdown episodes, recovery <2.5%)",
    }]);
  });
  return { evaluated, alert_days: events.length, counts,
    per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
    sample: events.slice(-10) };
})();
