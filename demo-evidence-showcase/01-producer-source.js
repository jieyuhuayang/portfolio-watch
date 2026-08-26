// portfolio-watch-showcase producer — declared holdings + targets (rung C),
// mixed book (equities + ETF benchmark + crypto + cash), v4 cross-sectional
// rules: beta/residual vs the user's own benchmark, systematic collapse,
// drift bands, effective bets. One feed, one producer, one hourly clock.
//
// Inputs: ~/feeds/portfolio-watch-showcase/v1/holdings.json  (qty + targets)
//         ~/feeds/portfolio-watch-showcase/v1/config.json    (preset, benchmark, playbook_url)
// args:   { test_alert?: true }
//
// Bootstrap discipline: states already true at creation (drift out of band,
// drawdown band, eff-bets floor) are fingerprinted as notified on run 1 and
// reported in the build summary instead — the watch alerts on CHANGES.

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const env = require("env");
const secret = require("secret-manager");
const alfs = require("alfs");

const BASE = feedPath("portfolio-watch-showcase");
const ARRAYS = "https://data-tools.prd.arrays.org";
const PRESETS = {
  calm:      { k: 4, kGap: 3,   earnDays: 1, volMult: null, fast1h: 0.12 },
  normal:    { k: 3, kGap: 2,   earnDays: 3, volMult: 3,    fast1h: 0.08 },
  sensitive: { k: 2, kGap: 1.5, earnDays: 7, volMult: 2,    fast1h: 0.05 },
};
const SEV_RANK = { info: 0, warning: 1, critical: 2, "action-needed": 2 };
const FRESH_S = 45 * 60;
// State-type kinds: seeded silently at bootstrap (alert on changes, not states)
const STATE_KINDS = { drift: 1, drawdown: 1, concentration: 1 };

const feed = new Feed({ path: BASE });
feed.def("positions", {
  snapshot: makeDoc("Positions", "Per-asset snapshot per run (v4 exposure fields)", [
    str("asset"), str("asset_class"), str("pair"), num("qty"), num("price"),
    num("value_usd"), num("weight"), num("target_weight"), num("chg_day"),
    num("beta"), num("resid_chg"), num("resid_score"), num("move_score"),
    num("vol_ratio"), str("next_earnings"), num("days_to_earnings"),
    str("pricing"), bool("stale"), str("market_state"), str("asof_price"),
  ]),
});
feed.def("portfolio_nav", {
  series: makeDoc("Portfolio NAV", "One row per run (v4 exposure metrics)", [
    num("nav_usd"), num("pnl_24h"), num("drawdown_30d"), num("cash_ratio"),
    num("top_weight"), num("eff_bets"), num("avg_corr"),
    num("unpriced_count"), num("stale_count"), str("market_state"), str("run_kind"),
  ]),
});
feed.def("replay", {
  log: makeDoc("Replay log", "12-month deterministic rule replay: one row per alert-day", [
    str("day"), str("kinds"), str("headline"),
  ]),
  summary: makeDoc("Replay summary", "Aggregate stats of the rule replay", [
    num("days_evaluated"), num("alert_days"), num("systematic_days"),
    num("resid_days"), num("drift_days"), num("drawdown_days"),
    num("per_month"), str("window"), str("assumptions"),
  ]),
});
feed.def("alerts", {
  log: makeDoc("Alert log", "Audit trail of every novelty-gate survivor", [
    str("alert_id"), str("subject"), str("kind"), str("state"),
    str("severity"), str("evidence_ts"), str("headline"), str("detail"),
  ]),
  digest: alertOutput(makeDoc("Alert digest", "Material-change digest, one per run", [
    str("title"), str("body"), messageActionsField(),
  ])),
});

async function readJson(path, required) {
  try { return JSON.parse(await alfs.readFile(path)); }
  catch (e) { if (required) throw new Error("required input missing: " + path); return null; }
}
async function getJson(jwt, url) {
  const resp = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + url);
  const body = await resp.json();
  if (!Array.isArray(body.data)) throw new Error("invalid envelope: " + url);
  return body.data; // reverse chronological
}
const stockKline = (jwt, s, iv, a, b, n, sess) => getJson(jwt,
  ARRAYS + "/api/v1/stocks/kline?symbol=" + s + "&start_time=" + a + "&end_time=" + b +
  "&interval=" + iv + (sess ? "&session=" + sess : "") + "&limit=" + n);
const btcKline = (jwt, iv, a, b, n) => getJson(jwt,
  ARRAYS + "/api/v1/crypto/binance/spot/usdt/kline?symbol=BTC&start_time=" + a +
  "&end_time=" + b + "&interval=" + iv + "&limit=" + n);

function rets(closes) { // chronological closes -> daily returns
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}
function beta(ri, rb) { // aligned same-length return arrays
  const n = Math.min(ri.length, rb.length);
  const a = ri.slice(-n), b = rb.slice(-n);
  const ma = jStat.mean(a), mb = jStat.mean(b);
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); varb += (b[i] - mb) ** 2; }
  return varb > 0 ? cov / varb : null;
}
function corr(a0, b0) {
  const n = Math.min(a0.length, b0.length);
  const a = a0.slice(-n), b = b0.slice(-n);
  const ma = jStat.mean(a), mb = jStat.mean(b);
  let cab = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { cab += (a[i]-ma)*(b[i]-mb); va += (a[i]-ma)**2; vb += (b[i]-mb)**2; }
  return va > 0 && vb > 0 ? cab / Math.sqrt(va * vb) : null;
}

(async () => {
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const args = env.args || {};

    // ── 1. Source truth: declared holdings + targets ──
    const hdoc = await readJson(BASE + "/holdings.json", true);
    const config = (await readJson(BASE + "/config.json", false)) || {};
    const preset = PRESETS[config.preset || "normal"] || PRESETS.normal;
    const BENCH = config.benchmark || "QQQ";
    const BAND = config.drift_band != null ? config.drift_band : 0.05;
    const targets = hdoc.targets || {};
    const jwt = secret.loadPlaintext("ARRAYS_JWT");
    if (!jwt) throw new Error("ARRAYS_JWT missing");

    // ── 2. History + KV ──
    const navTs = ctx.self.ts("portfolio_nav", "series");
    const posTs = ctx.self.ts("positions", "snapshot");
    const win30d = await navTs.range(nowMs - 30 * 86400e3, nowMs);
    const near24 = await navTs.range(nowMs - 26 * 3600e3, nowMs - 22 * 3600e3);
    const prevPos = await posTs.last(1);
    const fingerprints = JSON.parse((await ctx.kv.load("fingerprints")) || "{}");
    const stats = JSON.parse((await ctx.kv.load("stats")) || "{}"); // {SYM:{sigma,avgvol,beta,resid_sigma,at}}
    const earnCache = JSON.parse((await ctx.kv.load("earnings")) || "{}");
    const closeWm = JSON.parse((await ctx.kv.load("close_wm")) || "{}");
    const gapWm = JSON.parse((await ctx.kv.load("gap_wm")) || "{}");
    const bootstrapped = !!(await ctx.kv.load("bootstrap_done"));
    // Hysteresis state machines (added after the 12-month replay exposed
    // band-edge oscillation): drift re-arms only after returning 1pp inside
    // the band; drawdown runs in episodes — deeper bands escalate, nothing
    // re-fires until NAV recovers above the shallowest band's half-way mark.
    const driftState = JSON.parse((await ctx.kv.load("drift_state")) || "{}"); // {SYM: "armed"|"over"|"under"}
    const ddState = JSON.parse((await ctx.kv.load("dd_state")) || '{"active":false,"deepest":0}');
    if (!(await ctx.kv.load("watch_created_ts"))) await ctx.kv.put("watch_created_ts", String(nowMs));

    // ── 3. Benchmark daily series (needed for every equity's beta/resid) ──
    const benchDays = await stockKline(jwt, BENCH, "1d", nowSec - 160 * 86400, nowSec, 110);
    const benchCloses = benchDays.map((b) => b.price_close).reverse(); // chronological
    const benchRets = rets(benchCloses).slice(-60);
    const benchByClose = {}; // time_close -> chronological index
    const benchChron = benchDays.slice().reverse();
    benchChron.forEach((b, i) => { benchByClose[b.time_close] = i; });

    // ── 4. Per-asset pricing + stats + per-name candidates ──
    const rows = [];
    const candidates = [];
    const eqRets = {}; // for corr matrix
    let anyOpen = false, anyClose = false, anyGap = false;
    let benchChgDay = null;

    // Process the benchmark first: every other equity's residual needs its
    // day-change, so ordering is correctness, not style.
    const ordered = hdoc.holdings.slice().sort((a, b) =>
      (String(a.asset).toUpperCase() === BENCH ? -1 : 0) - (String(b.asset).toUpperCase() === BENCH ? -1 : 0));
    for (const h of ordered) {
      const sym = String(h.asset).toUpperCase();
      const cls = h.class;
      const qty = Number(h.qty);
      const tgt = targets[sym] != null ? targets[sym] : null;
      try {
        if (cls === "cash") {
          rows.push({ asset: sym, asset_class: "cash", pair: null, qty, price: 1,
            value_usd: qty, weight: null, target_weight: tgt, chg_day: 0,
            beta: null, resid_chg: null, resid_score: null, move_score: null,
            vol_ratio: null, next_earnings: null, days_to_earnings: null,
            pricing: "quote_unit", stale: false, market_state: null,
            asof_price: new Date(nowMs).toISOString() });
          continue;
        }
        if (cls === "crypto") { // BTC path: 24/7, calendar-day sigma
          const bars = await btcKline(jwt, "1h", nowSec - 8 * 86400, nowSec, 200);
          if (!bars.length) throw new Error("no BTC bars");
          const price = bars[0].price_close;
          let s = stats[sym];
          if (!s || nowMs - s.at > 20 * 3600e3) {
            const daily = await btcKline(jwt, "1d", nowSec - 25 * 86400, nowSec, 25);
            s = { sigma: jStat.stdev(rets(daily.map((b) => b.price_close).reverse()), true), at: nowMs };
            stats[sym] = s;
          }
          const px = (i) => (bars[i] ? bars[i].price_close : null);
          const chg24 = px(24) ? price / px(24) - 1 : null;
          const chg1h = px(1) ? price / px(1) - 1 : null;
          const mScore = chg24 != null && s.sigma ? Math.abs(chg24) / s.sigma : null;
          if (mScore != null && mScore >= preset.k) {
            candidates.push({ subject: "asset:" + sym, kind: "price_move",
              state: "move:" + (chg24 > 0 ? "up" : "down") + "-" + Math.floor(mScore) + "sigma",
              severity: mScore >= 2 * preset.k ? "critical" : "warning",
              evidence_ts: String(bars[0].time_close),
              headline: sym + " moved " + (chg24 * 100).toFixed(1) + "% in 24h (" + mScore.toFixed(1) + "× its 20d σ)",
              detail: "Decision: check your BTC sleeve against its 10% target band." });
          }
          if (chg1h != null && Math.abs(chg1h) >= preset.fast1h) {
            candidates.push({ subject: "asset:" + sym, kind: "price_move",
              state: "fast:" + (chg1h > 0 ? "up" : "down"), severity: "warning",
              evidence_ts: String(bars[0].time_close),
              headline: sym + " moved " + (chg1h * 100).toFixed(1) + "% in 1h",
              detail: "Decision: fast-move check — open the playbook before reacting." });
          }
          rows.push({ asset: sym, asset_class: "crypto", pair: "BTC/USDT", qty, price,
            value_usd: qty * price, weight: null, target_weight: tgt, chg_day: chg24,
            beta: null, resid_chg: null, resid_score: null, move_score: mScore,
            vol_ratio: null, next_earnings: null, days_to_earnings: null,
            pricing: "direct", stale: false, market_state: "open",
            asof_price: String(bars[0].time_close) });
          continue;
        }
        // Equity path (incl. the benchmark ETF as a holding)
        const days = await stockKline(jwt, sym, "1d", nowSec - 160 * 86400, nowSec, 110);
        if (days.length < 61) throw new Error("insufficient history " + sym);
        const closes = days.map((b) => b.price_close).reverse();
        const myRets = rets(closes).slice(-60);
        eqRets[sym] = myRets;
        let s = stats[sym];
        if (!s || nowMs - s.at > 20 * 3600e3) {
          const b = sym === BENCH ? null : beta(myRets, benchRets);
          let residSigma = null;
          if (b != null) {
            const n = Math.min(myRets.length, benchRets.length);
            const resid = [];
            for (let i = 0; i < n; i++) resid.push(myRets[myRets.length - n + i] - b * benchRets[benchRets.length - n + i]);
            residSigma = jStat.stdev(resid, true);
          }
          s = { sigma: jStat.stdev(myRets.slice(-20), true),
                avgvol: jStat.mean(days.slice(1, 21).map((d) => d.volume_traded)),
                beta: b, resid_sigma: residSigma, at: nowMs };
          stats[sym] = s;
        }
        const rth = await stockKline(jwt, sym, "30min", nowSec - 4 * 86400, nowSec, 60, "RTH");
        if (!rth.length) throw new Error("no intraday bars " + sym);
        const marketOpen = nowSec - rth[0].time_close < FRESH_S;
        if (marketOpen) anyOpen = true;
        const sessDay = Math.floor(rth[0].time_open / 86400);
        const sessBars = rth.filter((b) => Math.floor(b.time_open / 86400) === sessDay);
        const firstBar = sessBars[sessBars.length - 1];
        const price = rth[0].price_close;
        const prior = days.find((d) => d.time_close <= firstBar.time_open);
        const priorClose = prior ? prior.price_close : days[1].price_close;
        const chgDay = price / priorClose - 1;
        if (sym === BENCH) benchChgDay = chgDay;
        const mScore = s.sigma ? Math.abs(chgDay) / s.sigma : null;

        let e = earnCache[sym];
        if (sym !== BENCH && (!e || nowMs - e.at > 20 * 3600e3)) {
          const cal = await getJson(jwt, ARRAYS + "/api/v1/stocks/earnings-calendar?symbol=" + sym + "&limit=8");
          const todayIso = new Date(nowMs).toISOString().slice(0, 10);
          const up = cal.filter((r) => r.date >= todayIso).sort((a, b) => a.date < b.date ? -1 : 1)[0];
          e = { date: up ? up.date : null, time: up ? up.time : null, at: nowMs };
          earnCache[sym] = e;
        }
        const daysToEarn = e && e.date ? Math.round((Date.parse(e.date) - nowMs) / 86400e3 + 0.5) : null;

        // per-name raw move candidate (in-session only; close run below)
        if (marketOpen && mScore != null && mScore >= preset.k) {
          candidates.push({ subject: "asset:" + sym, kind: "price_move", _cluster: true,
            _dir: chgDay > 0 ? 1 : -1,
            state: "move:" + (chgDay > 0 ? "up" : "down") + "-" + Math.floor(mScore) + "sigma",
            severity: mScore >= 2 * preset.k ? "critical" : "warning",
            evidence_ts: rth[0].time_period_end,
            headline: sym + " is " + (chgDay > 0 ? "up " : "down ") + (chgDay * 100).toFixed(1) + "% vs prior close (" + mScore.toFixed(1) + "σ)",
            detail: "Decision: check the exposure panel — is this the market or the stock?" });
        }
        // residual candidate (the asset's own move, market subtracted)
        if (marketOpen && sym !== BENCH && s.beta != null && s.resid_sigma && benchChgDay != null) {
          const resid = chgDay - s.beta * benchChgDay;
          const rScore = Math.abs(resid) / s.resid_sigma;
          if (rScore >= preset.k) {
            candidates.push({ subject: "asset:" + sym, kind: "resid_move", _resid_of: sym,
              state: "resid:" + (resid > 0 ? "up" : "down") + "-" + Math.floor(rScore) + "sigma",
              severity: rScore >= 2 * preset.k ? "critical" : "warning",
              evidence_ts: rth[0].time_period_end,
              headline: sym + " residual " + (resid * 100).toFixed(1) + "% after subtracting β×" + BENCH + " (" + rScore.toFixed(1) + "× residual σ) — this move is the stock's own",
              detail: "Decision: re-check your " + sym + " thesis; this is idiosyncratic, not the market." });
          }
        }
        // gap once per session
        if (firstBar && (!gapWm[sym] || firstBar.time_open > gapWm[sym]) && prior) {
          const gap = firstBar.price_open / priorClose - 1;
          if (s.sigma && Math.abs(gap) / s.sigma >= preset.kGap) {
            candidates.push({ subject: "asset:" + sym, kind: "gap",
              state: "gap:" + new Date(firstBar.time_open * 1e3).toISOString().slice(0, 10) + ":" + (gap > 0 ? "up" : "down"),
              severity: "warning", evidence_ts: firstBar.time_period_start,
              headline: sym + " opened " + (gap * 100).toFixed(1) + "% vs prior close (" + (Math.abs(gap) / s.sigma).toFixed(1) + "σ gap)",
              detail: "Decision: event check — gaps usually have a reason; see the timeline." });
          }
          gapWm[sym] = firstBar.time_open; anyGap = true;
        }
        // close run: authoritative close-to-close + residual + volume anomaly
        if (!closeWm[sym] || days[0].time_close > closeWm[sym]) {
          const cChg = days[0].price_close / days[1].price_close - 1;
          const cScore = s.sigma ? Math.abs(cChg) / s.sigma : null;
          // the day's authoritative residual: subtract β × the benchmark's
          // close-to-close for the SAME trading day (matched by time_close)
          if (sym !== BENCH && s.beta != null && s.resid_sigma) {
            const bi = benchByClose[days[0].time_close];
            if (bi != null && bi > 0) {
              const bChg = benchChron[bi].price_close / benchChron[bi - 1].price_close - 1;
              const cResid = cChg - s.beta * bChg;
              const crScore = Math.abs(cResid) / s.resid_sigma;
              if (crScore >= preset.k) {
                candidates.push({ subject: "asset:" + sym, kind: "resid_move",
                  state: "residclose:" + days[0].time_period_end.slice(0, 10) + ":" + (cResid > 0 ? "up" : "down"),
                  severity: crScore >= 2 * preset.k ? "critical" : "warning",
                  evidence_ts: days[0].time_period_end,
                  headline: sym + " closed with a " + (cResid * 100).toFixed(1) + "% residual after subtracting β×" + BENCH +
                    " (" + crScore.toFixed(1) + "× residual σ) — the move was the stock's own",
                  detail: "Decision: re-check your " + sym + " thesis; this is idiosyncratic, not the market." });
              }
            }
          }
          if (cScore != null && cScore >= preset.k) {
            candidates.push({ subject: "asset:" + sym, kind: "price_move", _cluster: true,
              _dir: cChg > 0 ? 1 : -1,
              state: "close:" + days[0].time_period_end.slice(0, 10) + ":" + (cChg > 0 ? "up" : "down") + "-" + Math.floor(cScore) + "sigma",
              severity: cScore >= 2 * preset.k ? "critical" : "warning",
              evidence_ts: days[0].time_period_end,
              headline: sym + " closed " + (cChg > 0 ? "up " : "down ") + (cChg * 100).toFixed(1) + "% (" + cScore.toFixed(1) + "σ)",
              detail: "Decision: end-of-day exposure check." });
          }
          if (preset.volMult && s.avgvol && days[0].volume_traded >= preset.volMult * s.avgvol) {
            candidates.push({ subject: "asset:" + sym, kind: "volume_anomaly",
              state: "vol:" + days[0].time_period_end.slice(0, 10), severity: "info",
              evidence_ts: days[0].time_period_end,
              headline: sym + " traded " + (days[0].volume_traded / s.avgvol).toFixed(1) + "× its 20d average volume",
              detail: "Decision: attention flag — unusual participation, check for news." });
          }
          closeWm[sym] = days[0].time_close; anyClose = true;
        }
        if (sym !== BENCH && daysToEarn != null && daysToEarn >= 0 && daysToEarn <= preset.earnDays) {
          candidates.push({ subject: "asset:" + sym, kind: "earnings_event",
            state: "earnings:" + e.date, severity: "info", evidence_ts: e.date,
            headline: sym + " reports earnings " + (daysToEarn === 0 ? "today" : "in " + daysToEarn + "d") +
              (e.time === "amc" ? " (after close)" : e.time === "bmo" ? " (before open)" : ""),
            detail: "Decision: event-risk window — review the position before the print." });
        }
        rows.push({ asset: sym, asset_class: "equity", pair: sym, qty, price,
          value_usd: qty * price, weight: null, target_weight: tgt, chg_day: chgDay,
          beta: s.beta, resid_chg: s.beta != null && benchChgDay != null ? chgDay - s.beta * benchChgDay : null,
          resid_score: s.beta != null && benchChgDay != null && s.resid_sigma
            ? Math.abs(chgDay - s.beta * benchChgDay) / s.resid_sigma : null,
          move_score: mScore, vol_ratio: s.avgvol ? days[0].volume_traded / s.avgvol : null,
          next_earnings: e ? e.date : null, days_to_earnings: daysToEarn,
          pricing: "direct", stale: false, market_state: marketOpen ? "open" : "closed",
          asof_price: rth[0].time_period_end });
      } catch (err) {
        const prev = prevPos.find((p) => p.asset === sym);
        if (prev && prev.price != null && prev.pricing !== "unpriced") {
          rows.push({ ...prev, qty, value_usd: qty * prev.price, chg_day: null,
            resid_chg: null, resid_score: null, move_score: null, vol_ratio: null,
            pricing: "carried", stale: true });
        } else {
          rows.push({ asset: sym, asset_class: cls, pair: null, qty, price: null,
            value_usd: null, weight: null, target_weight: tgt, chg_day: null,
            beta: null, resid_chg: null, resid_score: null, move_score: null,
            vol_ratio: null, next_earnings: null, days_to_earnings: null,
            pricing: "unpriced", stale: true, market_state: null, asof_price: null });
        }
        console.error("degraded " + sym + ": " + err.message);
      }
    }
    await ctx.kv.put("stats", JSON.stringify(stats));
    await ctx.kv.put("earnings", JSON.stringify(earnCache));

    // ── 5. Aggregates: NAV, weights, drift, eff-bets, avg corr ──
    const priced = rows.filter((r) => r.value_usd != null);
    const nav = priced.reduce((a, r) => a + r.value_usd, 0);
    for (const r of rows) r.weight = r.value_usd != null && nav > 0 ? r.value_usd / nav : null;
    const risk = rows.filter((r) => r.asset_class !== "cash" && r.weight != null);
    const riskSum = risk.reduce((a, r) => a + r.weight, 0);
    const effBets = riskSum > 0 ? 1 / risk.reduce((a, r) => a + (r.weight / riskSum) ** 2, 0) : null;
    const eqSyms = Object.keys(eqRets);
    let corrSum = 0, corrN = 0;
    for (let i = 0; i < eqSyms.length; i++)
      for (let j = i + 1; j < eqSyms.length; j++) {
        const c = corr(eqRets[eqSyms[i]], eqRets[eqSyms[j]]);
        if (c != null) { corrSum += c; corrN++; }
      }
    const avgCorr = corrN ? corrSum / corrN : null;
    const staleCount = rows.filter((r) => r.stale).length;
    const staleNavShare = nav > 0
      ? rows.filter((r) => r.stale && r.value_usd != null).reduce((a, r) => a + r.value_usd, 0) / nav : 0;
    const navHist = win30d.map((r) => r.nav_usd).concat([nav]);
    const navRow = {
      nav_usd: nav,
      pnl_24h: near24.length
        ? nav / near24.reduce((b, r) => Math.abs(r.date - (nowMs - 24 * 3600e3)) < Math.abs(b.date - (nowMs - 24 * 3600e3)) ? r : b).nav_usd - 1 : null,
      drawdown_30d: 1 - nav / Math.max(...navHist),
      cash_ratio: nav > 0 ? rows.filter((r) => r.asset_class === "cash").reduce((a, r) => a + (r.value_usd || 0), 0) / nav : null,
      top_weight: Math.max(0, ...risk.map((r) => r.weight)),
      eff_bets: effBets, avg_corr: avgCorr,
      unpriced_count: rows.filter((r) => r.pricing === "unpriced").length,
      stale_count: staleCount,
    };

    // ── 6. Portfolio-tier candidates (suppressed when half-blind) ──
    if (staleNavShare <= 0.5) {
      // drift bands with hysteresis re-arm (replay-informed): fire on
      // armed→out transition; re-arm only after returning 1pp inside the band
      const REARM = 0.01;
      for (const r of rows) {
        if (r.target_weight == null || r.weight == null || r.stale) continue;
        const dev = r.weight - r.target_weight;
        const out = dev > BAND ? "over" : dev < -BAND ? "under" : null;
        const st = driftState[r.asset] || "armed";
        if (out && st === "armed") {
          candidates.push({ subject: "asset:" + r.asset, kind: "drift",
            state: "drift:" + r.asset + ":" + out,
            severity: "info", evidence_ts: new Date(nowMs).toISOString(),
            headline: r.asset + " weight " + (r.weight * 100).toFixed(1) + "% is outside your " +
              (r.target_weight * 100).toFixed(0) + "% ± " + (BAND * 100).toFixed(0) + "pp band",
            detail: "Decision: rebalance decision point — this band is the one you set." });
          driftState[r.asset] = out;
        } else if (!out && st !== "armed" && Math.abs(dev) <= BAND - REARM) {
          driftState[r.asset] = "armed"; // recovered 1pp inside: re-arm silently
        }
      }
      // drawdown episodes: entry notifies once, deeper bands escalate, and
      // nothing re-fires until NAV recovers above half the shallowest band
      const ddPct = navRow.drawdown_30d * 100;
      const band = [5, 10, 15, 20, 30].filter((b) => ddPct >= b).pop() || 0;
      if (win30d.length >= 3) {
        if (band > 0 && (!ddState.active || band > ddState.deepest)) {
          candidates.push({ subject: "portfolio", kind: "drawdown",
            state: "drawdown_band:" + band + ":" + (ddState.active ? "deeper" : "entry"),
            severity: band >= 15 ? "critical" : "warning",
            evidence_ts: new Date(nowMs).toISOString(),
            headline: "Portfolio drawdown crossed −" + band + "% from its 30d high" +
              (ddState.active ? " (deepening)" : ""),
            detail: "Decision: risk-limit check — now " + ddPct.toFixed(1) + "% below the peak." });
          ddState.active = true; ddState.deepest = band;
        } else if (ddState.active && ddPct < 2.5) {
          ddState.active = false; ddState.deepest = 0; // episode over: re-arm silently
        }
      }
      if (effBets != null && effBets < 2.0) {
        candidates.push({ subject: "portfolio", kind: "concentration",
          state: "eff_bets:below-2", severity: "info",
          evidence_ts: new Date(nowMs).toISOString(),
          headline: "Effective bets " + effBets.toFixed(1) + " — " + risk.length +
            " risk positions behaving like fewer than two independent bets",
          detail: "Decision: diversification review — correlation is doing the concentrating." });
      }
      // systematic collapse: correlated equity cluster moving together = ONE event
      const clusterCands = candidates.filter((c) => c._cluster);
      if (clusterCands.length >= 2 && avgCorr != null && avgCorr >= 0.5) {
        const dirs = clusterCands.map((c) => c._dir);
        if (dirs.every((d) => d === dirs[0])) {
          const names = clusterCands.map((c) => c.subject.split(":")[1]);
          const maxSev = clusterCands.some((c) => c.severity === "critical") ? "critical" : "warning";
          const resids = rows.filter((r) => names.includes(r.asset) && r.resid_score != null);
          const maxResid = resids.length ? Math.max(...resids.map((r) => r.resid_score)) : null;
          // remove the per-name raw candidates; residual candidates stay
          for (const c of clusterCands) candidates.splice(candidates.indexOf(c), 1);
          candidates.push({ subject: "portfolio", kind: "systematic_move",
            state: "sys:" + new Date(nowMs).toISOString().slice(0, 10) + ":" + (dirs[0] > 0 ? "up" : "down"),
            severity: maxSev, evidence_ts: new Date(nowMs).toISOString(),
            headline: "Your equity complex (" + names.join(", ") + ") moved " +
              (dirs[0] > 0 ? "up" : "down") + " together (avg corr " + avgCorr.toFixed(2) + ")" +
              (maxResid != null ? "; largest residual " + maxResid.toFixed(1) + "σ — " +
                (maxResid < preset.k ? "no single-name news" : "single-name news too, sent separately") : ""),
            detail: "Decision: this is one factor event, not " + names.length +
              " signals — check your drawdown limit, not each ticker." });
        }
      }
      // raw + residual both firing for the same asset: residual carries the signal
      for (const rc of candidates.filter((c) => c.kind === "resid_move")) {
        const raw = candidates.find((c) => c._cluster && c.subject === rc.subject);
        if (raw) candidates.splice(candidates.indexOf(raw), 1);
      }
    }
    if (args.test_alert === true) {
      candidates.push({ subject: "system", kind: "test", state: "test-delivery",
        severity: "info", evidence_ts: new Date(nowMs).toISOString(),
        headline: "Test alert — delivery chain verification",
        detail: "Sent once to prove the pipeline; the novelty gate suppresses repeats." });
    }

    // ── 7. Novelty gate + bootstrap seeding ──
    const survivors = [];
    for (const c of candidates) {
      delete c._cluster; delete c._dir; delete c._resid_of;
      const key = c.subject + ":" + c.kind;
      const last = fingerprints[key];
      const esc = last ? (SEV_RANK[c.severity] || 0) > (SEV_RANK[last.severity] || 0) : false;
      let pass;
      if (!last) pass = true;
      else if (last.state === c.state) pass = esc;
      else {
        const osc = c.state === last.prev_state && nowMs - last.ts < 24 * 3600e3;
        pass = esc || !osc;
      }
      if (pass) {
        // bootstrap: state-type kinds true at creation are seeded, not sent
        const seedOnly = !bootstrapped && STATE_KINDS[c.kind];
        if (!seedOnly) survivors.push(c);
        fingerprints[key] = { state: c.state, prev_state: last ? last.state : null,
          severity: c.severity, ts: nowMs };
      }
    }
    if (!bootstrapped) await ctx.kv.put("bootstrap_done", "1");

    // ── 8. Persist: data → audit → digest → fingerprints ──
    await posTs.append(rows.map((r) => ({ ...r, date: nowMs })));
    await navTs.append([{ ...navRow, date: nowMs,
      market_state: anyOpen ? "mixed" : "closed",
      run_kind: anyClose ? "close" : anyGap ? "open" : anyOpen ? "rth" : "offsession" }]);
    if (survivors.length) {
      await ctx.self.ts("alerts", "log").append(survivors.map((s2) => ({
        date: nowMs, alert_id: s2.subject + ":" + s2.kind + ":" + s2.state, ...s2 })));
      const lines = survivors
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .map((s2) => "[" + s2.severity.toUpperCase() + "] " + s2.headline + " — " + s2.detail);
      const digest = { date: nowMs,
        title: "Risk watch: " + survivors.length + " change" + (survivors.length > 1 ? "s" : ""),
        body: lines.join("\n") };
      if (config.playbook_url) digest.actions = [openUrlAction("Open Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints));
    } else if (!bootstrapped) {
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints)); // seeded states
    }
    await ctx.kv.put("close_wm", JSON.stringify(closeWm));
    await ctx.kv.put("gap_wm", JSON.stringify(gapWm));
    await ctx.kv.put("drift_state", JSON.stringify(driftState));
    await ctx.kv.put("dd_state", JSON.stringify(ddState));
    console.error("run ok: nav=" + nav.toFixed(0) + " effBets=" + (effBets || 0).toFixed(2) +
      " avgCorr=" + (avgCorr || 0).toFixed(2) + " candidates=" + candidates.length +
      " survivors=" + survivors.length + " bootstrapped=" + bootstrapped);
  });
})();
