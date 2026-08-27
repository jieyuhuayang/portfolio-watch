// portfolio-watch-ashare — REPLAY WRAPPER (built with judgment.js into a
// single script by build.sh; run once via `alva run --local-file`).
//
// Replays ~12 months of daily bars through the SAME judgeAshare() the live
// producer runs — close-run mode (rth=[]), state carried day to day exactly
// as KV carries it run to run, novelty gate included. This replaces the
// previous stand-alone replay implementation, whose semantics had drifted
// from live (no fingerprint modeling; residuals judged only here).
//
// Corporate-action days: instead of chain-linking neutralized returns, the
// driver does what the CA alert tells a real owner to do — adjust share
// counts value-preservingly (qty *= prevClose/close) — so NAV stays
// continuous while judgeAshare still sees the raw price jump and reports
// the corporate action.

const { Feed, feedPath, makeDoc, num, str } = require("@alva/feed");
const http = require("net/http");
const secret = require("secret-manager");
const alfs = require("alfs");

const BASE = feedPath("portfolio-watch-ashare");
const ARRAYS = "https://data-tools.prd.arrays.org";

async function getJson(jwt, url) {
  const resp = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + url);
  const body = await resp.json();
  if (!Array.isArray(body.data)) throw new Error("invalid envelope: " + url);
  return body.data;
}

(async () => {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const jwt = secret.loadPlaintext("ARRAYS_JWT");
  if (!jwt) throw new Error("ARRAYS_JWT missing");
  const hdoc = JSON.parse(await alfs.readFile(BASE + "/holdings.json"));
  const config = JSON.parse(await alfs.readFile(BASE + "/config.json"));
  const CLUSTER = config.cluster || [];
  const equities = hdoc.holdings.filter((h) => h.class !== "cash");
  const qty = {};
  for (const h of hdoc.holdings) qty[String(h.asset).toUpperCase()] = Number(h.qty);

  // ascending daily bars per symbol
  const hist = {};
  for (const h of equities) {
    const sym = String(h.asset).toUpperCase();
    const bars = await getJson(jwt,
      ARRAYS + "/api/v1/stocks/non-us/kline?symbol=" + encodeURIComponent(sym) +
      "&start_time=" + (nowSec - 500 * 86400) + "&end_time=" + nowSec +
      "&interval=1d&limit=330");
    hist[sym] = bars.slice().reverse(); // ascending
  }
  const anchorSym = String(equities[0].asset).toUpperCase();
  const cal = hist[anchorSym];
  const start = Math.max(62, cal.length - 250);

  const state = { fingerprints: {}, stats: {}, closeWm: {}, gapWm: {},
    driftState: {}, ddState: { active: false, deepest: 0 }, bootstrapped: false };
  const navRows = [];
  const events = [];
  const counts = { systematic: 0, resid: 0, raw: 0, limit: 0, ca: 0, volume: 0, drift: 0, drawdown: 0 };
  const KIND2C = { systematic_move: "systematic", resid_move: "resid", price_move: "raw",
    limit_hit: "limit", corporate_action: "ca", volume_anomaly: "volume",
    drift: "drift", drawdown: "drawdown" };
  let evaluated = 0;

  for (let i = start; i < cal.length; i++) {
    const dayTs = cal[i].time_close * 1000 + 3600e3;
    // per-symbol descending window ending at (or before) the anchor day
    const eq = {};
    let ok = true;
    for (const h of equities) {
      const sym = String(h.asset).toUpperCase();
      const upto = hist[sym].filter((b) => b.time_close <= cal[i].time_close);
      if (upto.length < 62) { ok = false; break; }
      eq[sym] = { days: upto.slice(-75).reverse(), rth: [] };
    }
    if (!ok) continue;
    evaluated++;
    // CA day: adjust share counts value-preservingly (what the alert asks
    // the owner to do) BEFORE judging, so NAV never fakes a crash
    for (const h of equities) {
      const sym = String(h.asset).toUpperCase();
      const d = eq[sym].days;
      const r = d[0].price_close / d[1].price_close - 1;
      const lim = /^(300|688)/.test(sym) ? 0.20 : 0.10;
      if (Math.abs(r) > lim + 0.02) qty[sym] = qty[sym] * (d[1].price_close / d[0].price_close);
    }
    const holdings = hdoc.holdings.map((h) => ({ ...h, qty: qty[String(h.asset).toUpperCase()] }));
    for (const sym of Object.keys(state.stats)) state.stats[sym].at = dayTs - 21 * 3600e3;
    const out = judgeAshare({
      holdings, targets: hdoc.targets || {},
      config: { preset: config.preset || "normal",
        BAND: config.drift_band != null ? config.drift_band : 0.05, CLUSTER },
      eq, prevPos: [], win30d: navRows.slice(-22), near24: [],
      state, nowMs: dayTs, testAlert: false,
    });
    navRows.push({ nav_cny: out.navRow.nav_cny, date: dayTs });
    if (out.survivors.length) {
      const kinds = [...new Set(out.survivors.map((s) => s.kind))];
      for (const k of kinds) if (KIND2C[k]) counts[KIND2C[k]]++;
      events.push({ day: new Date(dayTs).toISOString().slice(0, 10),
        kinds: kinds.join(","), headline: out.survivors[0].headline });
    }
  }

  const feed = new Feed({ path: BASE });
  feed.def("replay", {
    log: makeDoc("Replay log", "12-month deterministic rule replay: one row per alert-day", [
      str("day"), str("kinds"), str("headline"),
    ]),
    summary: makeDoc("Replay summary", "Aggregate stats of the rule replay", [
      num("days_evaluated"), num("alert_days"), num("systematic_days"),
      num("resid_days"), num("limit_days"), num("drift_days"), num("drawdown_days"),
      num("per_month"), str("window"), str("assumptions"),
    ]),
  });
  await feed.run(async (ctx) => {
    await ctx.self.ts("replay", "log").append(events.map((e) => ({ ...e, date: nowMs })));
    await ctx.self.ts("replay", "summary").append([{
      date: nowMs, days_evaluated: evaluated, alert_days: events.length,
      systematic_days: counts.systematic, resid_days: counts.resid,
      limit_days: counts.limit, drift_days: counts.drift, drawdown_days: counts.drawdown,
      per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
      window: "last " + evaluated + " trading days",
      assumptions: "SHARED ENGINE: this replay executes the same judgeAshare() as the live producer (close-run mode, novelty gate and hysteresis included) — replay/live parity by construction. Corporate-action days (|ret|>limit+2pp on un-adjusted prices) handled by value-preserving share-count adjustment, mirroring the CA alert's instruction to the owner; dividends not modeled; sector leave-one-out benchmark (no market index on platform); preset " + (config.preset || "normal") + "; drift band ±" + (((config.drift_band != null ? config.drift_band : 0.05)) * 100) + "pp with 1pp re-arm; drawdown episodes with recovery <2.5%.",
    }]);
  });
  return { evaluated, alert_days: events.length, counts,
    per_month: Math.round(events.length / (evaluated / 21) * 10) / 10,
    sample: events.slice(-8) };
})();
