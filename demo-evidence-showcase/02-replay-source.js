// portfolio-watch-showcase — deterministic 12-month rule replay.
// NOT a strategy backtest: no positions are traded, no P&L is simulated.
// It answers one question: on which past days would this watch have spoken,
// and was it quiet everywhere else? Close-run rules only (raw sigma move,
// residual move, systematic collapse, volume anomaly, BTC daily move, drift
// band crossings, drawdown band crossings), evaluated on daily bars with the
// same thresholds as the live producer (normal preset, K=3).
// Assumptions (disclosed): share counts fixed at today's declared holdings;
// intraday/gap/earnings kinds excluded (no intraday history replay).
// Writes replay/log (one row per alert-day) + replay/summary to the feed.

const { Feed, feedPath } = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const secret = require("secret-manager");

const ARRAYS = "https://data-tools.prd.arrays.org";
const K = 3, VOL_MULT = 3, CORR_MIN = 0.5, BAND = 0.05;
const HOLD = { NVDA: 800, TSM: 200, QQQ: 100, BTC: 0.8, CASH: 40000 };
const TGT = { NVDA: 0.40, TSM: 0.15, QQQ: 0.20, BTC: 0.10, CASH: 0.15 };
const EQ = ["NVDA", "TSM", "QQQ"], BENCH = "QQQ";

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
  // ~15 months of daily bars so day 1 of the 12-month window has 60d of history
  const eq = {};
  for (const s of EQ) {
    const d = await getJson(jwt, ARRAYS + "/api/v1/stocks/kline?symbol=" + s +
      "&start_time=" + (now - 470 * 86400) + "&end_time=" + now + "&interval=1d&limit=330");
    eq[s] = d.slice().reverse(); // chronological
  }
  const btcRaw = await getJson(jwt, ARRAYS + "/api/v1/crypto/binance/spot/usdt/kline?symbol=BTC" +
    "&start_time=" + (now - 470 * 86400) + "&end_time=" + now + "&interval=1d&limit=470");
  const btcByDay = {};
  btcRaw.forEach((b) => { btcByDay[String(b.time_open).slice(0, 10)] = b.price_close; }); // crypto kline times are ISO strings (stocks: unix seconds)
  const btcChron = btcRaw.slice().reverse();

  // Align equity days on the benchmark's calendar
  const nDays = eq[BENCH].length;
  const eqIdx = {};
  for (const s of EQ) {
    eqIdx[s] = {};
    eq[s].forEach((b, i) => { eqIdx[s][b.time_close] = i; });
  }

  const events = [];       // {day, kinds:[], notes:[]}
  const lastState = {};    // per-rule novelty (hysteresis re-arm (drift re-arms 1pp inside band; drawdown episodes, recovery <2.5%))
  let evaluated = 0;
  const counts = { systematic: 0, resid: 0, raw: 0, volume: 0, btc: 0, drift: 0, drawdown: 0 };
  const navSeries = [];

  const start = Math.max(61, nDays - 250);
  for (let i = start; i < nDays; i++) {
    const bench = eq[BENCH][i];
    const day = bench.time_period_end.slice(0, 10);
    evaluated++;
    const kinds = [], notes = [];

    // rolling stats as of day i (past-only windows: no look-ahead)
    const win = {};
    for (const s of EQ) {
      const j = eqIdx[s][bench.time_close];
      if (j == null || j < 61) { win[s] = null; continue; }
      const closes = eq[s].slice(j - 61, j + 1).map((b) => b.price_close);
      const r = [];
      for (let x = 1; x < closes.length; x++) r.push(closes[x] / closes[x - 1] - 1);
      win[s] = { j, ret: r[r.length - 1], rets60: r.slice(0, -1),
        sigma20: jStat.stdev(r.slice(-21, -1), true),
        vol: eq[s][j].volume_traded,
        avgvol: mean(eq[s].slice(j - 20, j).map((b) => b.volume_traded)) };
    }
    if (!win.NVDA || !win.TSM || !win.QQQ) continue;

    // raw sigma moves + cluster
    const raws = [];
    for (const s of EQ) {
      const sc = win[s].sigma20 ? Math.abs(win[s].ret) / win[s].sigma20 : 0;
      if (sc >= K) raws.push({ s, dir: win[s].ret > 0 ? 1 : -1, sc });
    }
    const avgCorr = mean([
      corrOf(win.NVDA.rets60, win.TSM.rets60),
      corrOf(win.NVDA.rets60, win.QQQ.rets60),
      corrOf(win.TSM.rets60, win.QQQ.rets60)].filter((x) => x != null));
    const sameDir = raws.length >= 2 && raws.every((r) => r.dir === raws[0].dir);
    if (sameDir && avgCorr >= CORR_MIN) {
      kinds.push("systematic_move"); counts.systematic++;
      notes.push("complex moved together " + (raws[0].dir > 0 ? "up" : "down") +
        " (" + raws.map((r) => r.s + " " + r.sc.toFixed(1) + "σ").join(", ") + "; corr " + avgCorr.toFixed(2) + ")");
    } else {
      for (const r of raws) {
        kinds.push("price_move:" + r.s); counts.raw++;
        notes.push(r.s + " " + (win[r.s].ret * 100).toFixed(1) + "% (" + r.sc.toFixed(1) + "σ)");
      }
    }
    // residual moves (NVDA/TSM vs QQQ)
    for (const s of ["NVDA", "TSM"]) {
      const b = betaOf(win[s].rets60, win.QQQ.rets60);
      if (b == null) continue;
      const resid = [];
      const n = Math.min(win[s].rets60.length, win.QQQ.rets60.length);
      for (let x = 0; x < n; x++)
        resid.push(win[s].rets60[win[s].rets60.length - n + x] - b * win.QQQ.rets60[win.QQQ.rets60.length - n + x]);
      const rs = jStat.stdev(resid, true);
      const todayResid = win[s].ret - b * win.QQQ.ret;
      if (rs && Math.abs(todayResid) / rs >= K) {
        kinds.push("resid_move:" + s); counts.resid++;
        notes.push(s + " residual " + (todayResid * 100).toFixed(1) + "% (" + (Math.abs(todayResid) / rs).toFixed(1) + "× resid σ)");
      }
    }
    // volume anomaly
    for (const s of EQ) {
      if (win[s].avgvol && win[s].vol >= VOL_MULT * win[s].avgvol) {
        kinds.push("volume_anomaly:" + s); counts.volume++;
        notes.push(s + " volume " + (win[s].vol / win[s].avgvol).toFixed(1) + "×20d");
      }
    }
    // BTC daily move (calendar-day sigma)
    const bi = btcChron.findIndex((b) => String(b.time_open).slice(0, 10) === day);
    if (bi > 21) {
      const bcl = btcChron.slice(bi - 21, bi + 1).map((b) => b.price_close);
      const br = [];
      for (let x = 1; x < bcl.length; x++) br.push(bcl[x] / bcl[x - 1] - 1);
      const bs = jStat.stdev(br.slice(0, -1), true);
      const todayR = br[br.length - 1];
      if (bs && Math.abs(todayR) / bs >= K) {
        kinds.push("price_move:BTC"); counts.btc++;
        notes.push("BTC " + (todayR * 100).toFixed(1) + "% (" + (Math.abs(todayR) / bs).toFixed(1) + "σ)");
      }
    }
    // NAV, drift, drawdown (fixed today's share counts — disclosed assumption)
    const px = { NVDA: eq.NVDA[eqIdx.NVDA[bench.time_close]], TSM: eq.TSM[eqIdx.TSM[bench.time_close]] };
    const nav = HOLD.NVDA * (px.NVDA ? px.NVDA.price_close : 0) +
      HOLD.TSM * (px.TSM ? px.TSM.price_close : 0) +
      HOLD.QQQ * bench.price_close + HOLD.BTC * (btcByDay[day] || 0) + HOLD.CASH;
    navSeries.push(nav);
    // hysteresis (mirrors the live producer): drift re-arms only 1pp inside
    // the band; drawdown runs in episodes (deeper escalates, recovery <2.5% re-arms)
    const REARM = 0.01;
    for (const s of ["NVDA", "TSM", "QQQ", "BTC", "CASH"]) {
      const v = s === "QQQ" ? HOLD.QQQ * bench.price_close :
        s === "BTC" ? HOLD.BTC * (btcByDay[day] || 0) :
        s === "CASH" ? HOLD.CASH : HOLD[s] * (px[s] ? px[s].price_close : 0);
      const w = v / nav;
      const dev = w - TGT[s];
      const out = dev > BAND ? "over" : dev < -BAND ? "under" : null;
      const kkey = "drift:" + s;
      const st = lastState[kkey] === undefined ? "init" : lastState[kkey];
      if (st === "init") { lastState[kkey] = out || "armed"; continue; } // day-1 state seeded silently
      if (out && st === "armed") {
        kinds.push("drift:" + s); counts.drift++;
        notes.push(s + " " + (w * 100).toFixed(1) + "% exited its " + (TGT[s] * 100).toFixed(0) + "±5pp band (" + out + ")");
        lastState[kkey] = out;
      } else if (!out && st !== "armed" && Math.abs(dev) <= BAND - REARM) {
        lastState[kkey] = "armed";
      }
    }
    const hi30 = Math.max(...navSeries.slice(-22));
    const dd = (1 - nav / hi30) * 100;
    const band = [5, 10, 15, 20, 30].filter((b) => dd >= b).pop() || 0;
    if (lastState.ddEp === undefined) lastState.ddEp = { active: band > 0, deepest: band }; // day-1 seeded
    else if (band > 0 && (!lastState.ddEp.active || band > lastState.ddEp.deepest)) {
      kinds.push("drawdown"); counts.drawdown++;
      notes.push("drawdown crossed −" + band + "% (30d high" + (lastState.ddEp.active ? ", deepening" : "") + ")");
      lastState.ddEp = { active: true, deepest: band };
    } else if (lastState.ddEp.active && dd < 2.5) {
      lastState.ddEp = { active: false, deepest: 0 };
    }

    if (kinds.length) events.push({ day, kinds: kinds.join(","), headline: notes.join("; ") });
  }

  const feed = new Feed({ path: feedPath("portfolio-watch-showcase") });
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    await ctx.self.ts("replay", "log").append(events.map((e, i) => ({
      date: Date.parse(e.day) + i, day: e.day, kinds: e.kinds, headline: e.headline })));
    await ctx.self.ts("replay", "summary").append([{
      date: nowMs, days_evaluated: evaluated, alert_days: events.length,
      systematic_days: counts.systematic, resid_days: counts.resid,
      drift_days: counts.drift, drawdown_days: counts.drawdown,
      per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
      window: "last " + evaluated + " trading days",
      assumptions: "share counts fixed at today's declared holdings; close-run rules only (no intraday/gap/earnings); normal preset K=3; hysteresis re-arm (drift re-arms 1pp inside band; drawdown episodes, recovery <2.5%)",
    }]);
  });
  return { evaluated, alert_days: events.length, counts,
    per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
    sample: events.slice(-8) };
})();
