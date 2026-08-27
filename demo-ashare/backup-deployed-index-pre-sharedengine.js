// portfolio-watch-ashare producer — A-share concentrated book (declared
// holdings + targets, rung C). Persona: an A-share investor heavy in
// Zhongji Innolight (中际旭创 300308.SZ) with optical-module peers, a
// non-AI control position (Moutai) and CNY cash.
//
// A-share specifics owned here:
//  - prices via stocks/non-us/kline (CNY; bar times track CST sessions,
//    incl. the lunch break — session state is data-driven, and CST has no
//    DST, so the cron window needs no seasonal caveat)
//  - price limits are a first-class alert: ChiNext ±20%, main board ±10% —
//    hitting the limit is a discrete, material event (limit_hit, critical)
//  - no market-index data on the platform → β/residual is computed against
//    the LEAVE-ONE-OUT mean of the held optical-module cluster: the residual
//    answers "did this stock move for its own reasons, or with its sector" —
//    for a sector-concentrated holder, the decomposition that matters.
//    Disclosed as a sector benchmark, not a market one.
//  - earnings calendar covers US listings only → earnings kind disabled
//    (disclosed blind spot)
// Inputs: ~/feeds/portfolio-watch-ashare/v1/holdings.json, config.json
// args: { test_alert?: true }

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const env = require("env");
const secret = require("secret-manager");
const alfs = require("alfs");

const BASE = feedPath("portfolio-watch-ashare");
const ARRAYS = "https://data-tools.prd.arrays.org";
const PRESETS = {
  calm:      { k: 4, kGap: 3 },
  normal:    { k: 3, kGap: 2 },
  sensitive: { k: 2, kGap: 1.5 },
};
const SEV_RANK = { info: 0, warning: 1, critical: 2, "action-needed": 2 };
const FRESH_S = 45 * 60;
const STATE_KINDS = { drift: 1, drawdown: 1, concentration: 1 };
// Daily price limit by board: ChiNext (300xxx) / STAR (688xxx) ±20%, else ±10%.
// Fire slightly inside the limit to absorb rounding.
const limitFor = (sym) => (/^(300|688)/.test(sym) ? 0.20 : 0.10);

const feed = new Feed({ path: BASE });
feed.def("positions", {
  snapshot: makeDoc("Positions", "Per-asset snapshot per run (A-share book, CNY)", [
    str("asset"), str("name_zh"), str("asset_class"), str("pair"), num("qty"),
    num("price"), num("value_cny"), num("weight"), num("target_weight"),
    num("chg_day"), num("beta"), num("resid_chg"), num("resid_score"),
    num("move_score"), num("vol_ratio"), num("limit_pct"), bool("limit_hit"),
    str("pricing"), bool("stale"), str("market_state"), str("asof_price"),
  ]),
});
feed.def("portfolio_nav", {
  series: makeDoc("Portfolio NAV", "One row per run (CNY; exposure metrics)", [
    num("nav_cny"), num("pnl_24h"), num("drawdown_30d"), num("cash_ratio"),
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
    num("resid_days"), num("limit_days"), num("drift_days"), num("drawdown_days"),
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
const cnKline = (jwt, s, iv, a, b, n) => getJson(jwt,
  ARRAYS + "/api/v1/stocks/non-us/kline?symbol=" + encodeURIComponent(s) +
  "&start_time=" + a + "&end_time=" + b + "&interval=" + iv + "&limit=" + n);
function rets(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}
function betaOf(ri, rb) {
  const n = Math.min(ri.length, rb.length), a = ri.slice(-n), b = rb.slice(-n);
  const ma = jStat.mean(a), mb = jStat.mean(b);
  let cov = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i]-ma)*(b[i]-mb); vb += (b[i]-mb)**2; }
  return vb > 0 ? cov / vb : null;
}
function corrOf(a0, b0) {
  const n = Math.min(a0.length, b0.length), a = a0.slice(-n), b = b0.slice(-n);
  const ma = jStat.mean(a), mb = jStat.mean(b);
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i]-ma)*(b[i]-mb); va += (a[i]-ma)**2; vb += (b[i]-mb)**2; }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
}

(async () => {
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const args = env.args || {};

    const hdoc = await readJson(BASE + "/holdings.json", true);
    const config = (await readJson(BASE + "/config.json", false)) || {};
    const preset = PRESETS[config.preset || "normal"] || PRESETS.normal;
    const BAND = config.drift_band != null ? config.drift_band : 0.05;
    const CLUSTER = config.cluster || []; // symbols forming the sector complex
    const targets = hdoc.targets || {};
    const jwt = secret.loadPlaintext("ARRAYS_JWT");
    if (!jwt) throw new Error("ARRAYS_JWT missing");

    const navTs = ctx.self.ts("portfolio_nav", "series");
    const posTs = ctx.self.ts("positions", "snapshot");
    const win30d = await navTs.range(nowMs - 30 * 86400e3, nowMs);
    const near24 = await navTs.range(nowMs - 26 * 3600e3, nowMs - 22 * 3600e3);
    const prevPos = await posTs.last(1);
    const fingerprints = JSON.parse((await ctx.kv.load("fingerprints")) || "{}");
    const stats = JSON.parse((await ctx.kv.load("stats")) || "{}");
    const closeWm = JSON.parse((await ctx.kv.load("close_wm")) || "{}");
    const gapWm = JSON.parse((await ctx.kv.load("gap_wm")) || "{}");
    const driftState = JSON.parse((await ctx.kv.load("drift_state")) || "{}");
    const ddState = JSON.parse((await ctx.kv.load("dd_state")) || '{"active":false,"deepest":0}');
    const bootstrapped = !!(await ctx.kv.load("bootstrap_done"));
    if (!(await ctx.kv.load("watch_created_ts"))) await ctx.kv.put("watch_created_ts", String(nowMs));

    // ── Pass 1: fetch all equity series (cluster residuals need every leg) ──
    const eq = {}; // sym -> {days, rth, retsAll}
    const rows = [];
    for (const h of hdoc.holdings) {
      const sym = String(h.asset).toUpperCase();
      if (h.class === "cash") continue;
      try {
        const days = await cnKline(jwt, sym, "1d", nowSec - 160 * 86400, nowSec, 110);
        if (days.length < 61) throw new Error("insufficient history " + sym);
        const rth = await cnKline(jwt, sym, "30min", nowSec - 5 * 86400, nowSec, 60);
        if (!rth.length) throw new Error("no intraday bars " + sym);
        // Un-adjusted prices: a "return" beyond the daily price limit +2pp is
        // physically impossible as trading — it is an ex-dividend/split day.
        // Neutralize those days (0) in rolling stats to keep cross-symbol
        // alignment while preventing corporate actions from poisoning sigma.
        const lim0 = limitFor(sym);
        eq[sym] = { h, days, rth,
          retsAll: rets(days.map((b) => b.price_close).reverse())
            .map((x) => (Math.abs(x) > lim0 + 0.02 ? 0 : x)).slice(-60) };
      } catch (err) {
        eq[sym] = { h, error: err.message };
        console.error("fetch degraded " + sym + ": " + err.message);
      }
    }

    // ── Pass 2: per-asset stats + candidates ──
    const candidates = [];
    let anyOpen = false, anyClose = false, anyGap = false;
    for (const h of hdoc.holdings) {
      const sym = String(h.asset).toUpperCase();
      const qty = Number(h.qty);
      const tgt = targets[sym] != null ? targets[sym] : null;
      if (h.class === "cash") {
        rows.push({ asset: sym, name_zh: h.name_zh || "现金", asset_class: "cash",
          pair: null, qty, price: 1, value_cny: qty, weight: null,
          target_weight: tgt, chg_day: 0, beta: null, resid_chg: null,
          resid_score: null, move_score: null, vol_ratio: null,
          limit_pct: null, limit_hit: false, pricing: "quote_unit",
          stale: false, market_state: null, asof_price: new Date(nowMs).toISOString() });
        continue;
      }
      const E = eq[sym];
      if (E.error) {
        const prev = prevPos.find((p) => p.asset === sym);
        if (prev && prev.price != null && prev.pricing !== "unpriced") {
          rows.push({ ...prev, qty, value_cny: qty * prev.price, chg_day: null,
            resid_chg: null, resid_score: null, move_score: null, vol_ratio: null,
            limit_hit: false, pricing: "carried", stale: true });
        } else {
          rows.push({ asset: sym, name_zh: h.name_zh || sym, asset_class: "equity",
            pair: null, qty, price: null, value_cny: null, weight: null,
            target_weight: tgt, chg_day: null, beta: null, resid_chg: null,
            resid_score: null, move_score: null, vol_ratio: null,
            limit_pct: limitFor(sym), limit_hit: false, pricing: "unpriced",
            stale: true, market_state: null, asof_price: null });
        }
        continue;
      }
      const { days, rth } = E;
      // Sector benchmark: leave-one-out mean of the OTHER cluster legs
      const peers = CLUSTER.filter((s2) => s2 !== sym && eq[s2] && !eq[s2].error);
      const inCluster = CLUSTER.includes(sym) && peers.length >= 1;
      let s = stats[sym];
      if (!s || nowMs - s.at > 20 * 3600e3) {
        let b = null, residSigma = null;
        if (inCluster) {
          const n = Math.min(...peers.map((p) => eq[p].retsAll.length), E.retsAll.length);
          const benchRets = [];
          for (let i = 0; i < n; i++) {
            let acc = 0;
            for (const p of peers) acc += eq[p].retsAll[eq[p].retsAll.length - n + i];
            benchRets.push(acc / peers.length);
          }
          const my = E.retsAll.slice(-n);
          b = betaOf(my, benchRets);
          if (b != null) {
            const resid = [];
            for (let i = 0; i < n; i++) resid.push(my[i] - b * benchRets[i]);
            residSigma = jStat.stdev(resid, true);
          }
        }
        s = { sigma: jStat.stdev(E.retsAll.slice(-20), true),
              avgvol: jStat.mean(days.slice(1, 21).map((d) => d.volume_traded)),
              beta: b, resid_sigma: residSigma, at: nowMs };
        stats[sym] = s;
      }
      const marketOpen = nowSec - rth[0].time_close < FRESH_S;
      if (marketOpen) anyOpen = true;
      const sessDay = Math.floor(rth[0].time_open / 86400);
      const sessBars = rth.filter((b2) => Math.floor(b2.time_open / 86400) === sessDay);
      const firstBar = sessBars[sessBars.length - 1];
      const price = rth[0].price_close;
      const prior = days.find((d) => d.time_close <= firstBar.time_open);
      const priorClose = prior ? prior.price_close : days[1].price_close;
      const chgDay = price / priorClose - 1;
      const mScore = s.sigma ? Math.abs(chgDay) / s.sigma : null;
      const lim = limitFor(sym);
      const isCA = Math.abs(chgDay) > lim + 0.02; // beyond the limit: ex-div/split, not trading
      const limitHit = !isCA && Math.abs(chgDay) >= lim - 0.005;
      const nameZh = h.name_zh || sym;

      // Sector residual for today's move (display + judgment)
      let residChg = null, residScore = null;
      if (inCluster && s.beta != null && s.resid_sigma) {
        let acc = 0, cnt = 0;
        for (const p of peers) {
          const pe = eq[p];
          const pFirst = pe.rth.filter((b2) => Math.floor(b2.time_open / 86400) === Math.floor(pe.rth[0].time_open / 86400));
          const pPrior = pe.days.find((d) => d.time_close <= pFirst[pFirst.length - 1].time_open);
          if (pPrior) { acc += pe.rth[0].price_close / pPrior.price_close - 1; cnt++; }
        }
        if (cnt) {
          const benchChg = acc / cnt;
          residChg = chgDay - s.beta * benchChg;
          residScore = Math.abs(residChg) / s.resid_sigma;
        }
      }

      // (a0) corporate action day: data event, not a market event — one info
      // note, and every price-based judgment for this name is suppressed today
      if (isCA) {
        candidates.push({ subject: "asset:" + sym, kind: "corporate_action",
          state: "ca:" + new Date(nowMs).toISOString().slice(0, 10),
          severity: "info", evidence_ts: rth[0].time_period_end,
          headline: nameZh + " 价格变动 " + (chgDay * 100).toFixed(1) +
            "% 超出 " + (lim * 100).toFixed(0) + "% 涨跌停板 — 判定为除权除息/送转，非交易行情",
          detail: "Decision: 请核对券商股数并更新持仓清单 — 送转/除权会改变股数；未更新前组合级指标（回撤/漂移）暂停判断。" });
      }
      // (a) limit hit — a discrete, material A-share event (any session state)
      if (limitHit) {
        candidates.push({ subject: "asset:" + sym, kind: "limit_hit",
          state: "limit:" + new Date(nowMs).toISOString().slice(0, 10) + ":" + (chgDay > 0 ? "up" : "down"),
          severity: "critical", evidence_ts: rth[0].time_period_end,
          headline: nameZh + " (" + sym + ") " + (chgDay > 0 ? "触及涨停" : "触及跌停") +
            " (" + (chgDay * 100).toFixed(1) + "%, " + (lim * 100).toFixed(0) + "% 板)",
          detail: "Decision: 涨跌停是流动性事件 — T+1 下明日才能反应，先核对持仓计划。" });
      }
      // (b) intraday raw move — market open only
      if (marketOpen && !limitHit && !isCA && mScore != null && mScore >= preset.k) {
        candidates.push({ subject: "asset:" + sym, kind: "price_move", _cluster: inCluster,
          _dir: chgDay > 0 ? 1 : -1,
          state: "move:" + (chgDay > 0 ? "up" : "down") + "-" + Math.floor(mScore) + "sigma",
          severity: mScore >= 2 * preset.k ? "critical" : "warning",
          evidence_ts: rth[0].time_period_end,
          headline: nameZh + " " + (chgDay > 0 ? "涨" : "跌") + (Math.abs(chgDay) * 100).toFixed(1) +
            "% vs 昨收 (" + mScore.toFixed(1) + "× 其 20 交易日 σ)",
          detail: "Decision: 看敞口面板 — 是板块在动还是它自己在动？" });
      }
      // (c) sector residual — the stock's own move, sector subtracted
      if (marketOpen && !isCA && residScore != null && residScore >= preset.k) {
        candidates.push({ subject: "asset:" + sym, kind: "resid_move",
          state: "resid:" + (residChg > 0 ? "up" : "down") + "-" + Math.floor(residScore) + "sigma",
          severity: residScore >= 2 * preset.k ? "critical" : "warning",
          evidence_ts: rth[0].time_period_end,
          headline: nameZh + " 扣除板块 β 后残差 " + (residChg * 100).toFixed(1) + "% (" +
            residScore.toFixed(1) + "× 残差 σ) — 这是它自己的行情",
          detail: "Decision: 重新检查你的 " + nameZh + " 论点；这不是板块联动。" });
      }
      // (d) gap once per session (post-US-overnight open is the A-share gap moment)
      if (firstBar && (!gapWm[sym] || firstBar.time_open > gapWm[sym]) && prior) {
        const gap = firstBar.price_open / priorClose - 1;
        if (s.sigma && Math.abs(gap) / s.sigma >= preset.kGap) {
          candidates.push({ subject: "asset:" + sym, kind: "gap",
            state: "gap:" + new Date(firstBar.time_open * 1e3).toISOString().slice(0, 10) + ":" + (gap > 0 ? "up" : "down"),
            severity: "warning", evidence_ts: firstBar.time_period_start,
            headline: nameZh + " 开盘跳空 " + (gap * 100).toFixed(1) + "% (" + (Math.abs(gap) / s.sigma).toFixed(1) + "σ)",
            detail: "Decision: 隔夜有事 — 通常与美股 AI 链隔夜行情有关，看时间线。" });
        }
        gapWm[sym] = firstBar.time_open; anyGap = true;
      }
      // (e) close run: authoritative close-to-close + sector residual + volume
      if (!closeWm[sym] || days[0].time_close > closeWm[sym]) {
        const cChg = days[0].price_close / days[1].price_close - 1;
        const cScore = s.sigma ? Math.abs(cChg) / s.sigma : null;
        const cCA = Math.abs(cChg) > lim + 0.02;
        const cLimit = !cCA && Math.abs(cChg) >= lim - 0.005;
        if (cCA) {
          candidates.push({ subject: "asset:" + sym, kind: "corporate_action",
            state: "caclose:" + days[0].time_period_end.slice(0, 10),
            severity: "info", evidence_ts: days[0].time_period_end,
            headline: nameZh + " 收盘价变动 " + (cChg * 100).toFixed(1) +
              "% 超出涨跌停板 — 判定为除权除息/送转",
            detail: "Decision: 无需行动 — 数据口径事件，波动类告警已静默。" });
        } else if (cLimit) {
          candidates.push({ subject: "asset:" + sym, kind: "limit_hit",
            state: "limitclose:" + days[0].time_period_end.slice(0, 10) + ":" + (cChg > 0 ? "up" : "down"),
            severity: "critical", evidence_ts: days[0].time_period_end,
            headline: nameZh + " " + (cChg > 0 ? "涨停收盘" : "跌停收盘") + " (" + (cChg * 100).toFixed(1) + "%)",
            detail: "Decision: 涨跌停收盘 — T+1 下明日才能反应，核对仓位计划与目标带。" });
        } else if (cScore != null && cScore >= preset.k) {
          candidates.push({ subject: "asset:" + sym, kind: "price_move", _cluster: inCluster,
            _dir: cChg > 0 ? 1 : -1,
            state: "close:" + days[0].time_period_end.slice(0, 10) + ":" + (cChg > 0 ? "up" : "down") + "-" + Math.floor(cScore) + "sigma",
            severity: cScore >= 2 * preset.k ? "critical" : "warning",
            evidence_ts: days[0].time_period_end,
            headline: nameZh + " 收盘" + (cChg > 0 ? "涨" : "跌") + (Math.abs(cChg) * 100).toFixed(1) +
              "% (" + cScore.toFixed(1) + "σ)",
            detail: "Decision: 收盘级波动 — 对照目标带与回撤限额。" });
        }
        if (s.avgvol && days[0].volume_traded >= 3 * s.avgvol) {
          candidates.push({ subject: "asset:" + sym, kind: "volume_anomaly",
            state: "vol:" + days[0].time_period_end.slice(0, 10), severity: "info",
            evidence_ts: days[0].time_period_end,
            headline: nameZh + " 当日成交量 " + (days[0].volume_traded / s.avgvol).toFixed(1) + "× 于 20 日均量",
            detail: "Decision: 关注信号 — 异常参与度通常有原因，查新闻面。" });
        }
        closeWm[sym] = days[0].time_close; anyClose = true;
      }
      rows.push({ asset: sym, name_zh: nameZh, asset_class: "equity", pair: sym,
        qty, price, value_cny: qty * price, weight: null, target_weight: tgt,
        chg_day: chgDay, beta: s.beta, resid_chg: residChg, resid_score: residScore,
        move_score: mScore, vol_ratio: s.avgvol ? days[0].volume_traded / s.avgvol : null,
        limit_pct: lim, limit_hit: limitHit, pricing: "direct", stale: false,
        market_state: marketOpen ? "open" : "closed", asof_price: rth[0].time_period_end });
    }
    await ctx.kv.put("stats", JSON.stringify(stats));

    // ── Aggregates ──
    const priced = rows.filter((r) => r.value_cny != null);
    const nav = priced.reduce((a, r) => a + r.value_cny, 0);
    for (const r of rows) r.weight = r.value_cny != null && nav > 0 ? r.value_cny / nav : null;
    const risk = rows.filter((r) => r.asset_class !== "cash" && r.weight != null);
    const riskSum = risk.reduce((a, r) => a + r.weight, 0);
    const effBets = riskSum > 0 ? 1 / risk.reduce((a, r) => a + (r.weight / riskSum) ** 2, 0) : null;
    const clusterSyms = (config.cluster || []).filter((s2) => eq[s2] && !eq[s2].error);
    let corrSum = 0, corrN = 0;
    for (let i = 0; i < clusterSyms.length; i++)
      for (let j = i + 1; j < clusterSyms.length; j++) {
        const c = corrOf(eq[clusterSyms[i]].retsAll, eq[clusterSyms[j]].retsAll);
        if (c != null) { corrSum += c; corrN++; }
      }
    const avgCorr = corrN ? corrSum / corrN : null;
    const staleCount = rows.filter((r) => r.stale).length;
    const staleNavShare = nav > 0
      ? rows.filter((r) => r.stale && r.value_cny != null).reduce((a, r) => a + r.value_cny, 0) / nav : 0;
    const navHist = win30d.map((r) => r.nav_cny).concat([nav]);
    const navRow = {
      nav_cny: nav,
      pnl_24h: near24.length
        ? nav / near24.reduce((b, r) => Math.abs(r.date - (nowMs - 24 * 3600e3)) < Math.abs(b.date - (nowMs - 24 * 3600e3)) ? r : b).nav_cny - 1 : null,
      drawdown_30d: 1 - nav / Math.max(...navHist),
      cash_ratio: nav > 0 ? rows.filter((r) => r.asset_class === "cash").reduce((a, r) => a + (r.value_cny || 0), 0) / nav : null,
      top_weight: Math.max(0, ...risk.map((r) => r.weight)),
      eff_bets: effBets, avg_corr: avgCorr,
      unpriced_count: rows.filter((r) => r.pricing === "unpriced").length,
      stale_count: staleCount,
    };

    // ── Portfolio-tier candidates (hysteresis; suppressed when half-blind
    //    or on a corporate-action day — un-adjusted NAV is briefly wrong
    //    until the owner updates share counts) ──
    const anyCA = rows.some((r) => r.asset_class === "equity" && r.chg_day != null &&
      Math.abs(r.chg_day) > (r.limit_pct || 0.1) + 0.02);
    if (staleNavShare <= 0.5 && !anyCA) {
      const REARM = 0.01;
      for (const r of rows) {
        if (r.target_weight == null || r.weight == null || r.stale) continue;
        const dev = r.weight - r.target_weight;
        const out = dev > BAND ? "over" : dev < -BAND ? "under" : null;
        const st = driftState[r.asset] || "armed";
        if (out && st === "armed") {
          candidates.push({ subject: "asset:" + r.asset, kind: "drift",
            state: "drift:" + r.asset + ":" + out, severity: "info",
            evidence_ts: new Date(nowMs).toISOString(),
            headline: (r.name_zh || r.asset) + " 仓位 " + (r.weight * 100).toFixed(1) + "% 超出你的 " +
              (r.target_weight * 100).toFixed(0) + "% ± " + (BAND * 100).toFixed(0) + "pp 目标带",
            detail: "Decision: 再平衡决策点 — 这条带是你自己设的。" });
          driftState[r.asset] = out;
        } else if (!out && st !== "armed" && Math.abs(dev) <= BAND - REARM) {
          driftState[r.asset] = "armed";
        }
      }
      const ddPct = navRow.drawdown_30d * 100;
      const band = [5, 10, 15, 20, 30].filter((b) => ddPct >= b).pop() || 0;
      if (win30d.length >= 3) {
        if (band > 0 && (!ddState.active || band > ddState.deepest)) {
          candidates.push({ subject: "portfolio", kind: "drawdown",
            state: "drawdown_band:" + band + ":" + (ddState.active ? "deeper" : "entry"),
            severity: band >= 15 ? "critical" : "warning",
            evidence_ts: new Date(nowMs).toISOString(),
            headline: "组合自 30 日高点回撤越过 −" + band + "%" + (ddState.active ? "（加深）" : ""),
            detail: "Decision: 风险限额检查 — 当前低于峰值 " + ddPct.toFixed(1) + "%。" });
          ddState.active = true; ddState.deepest = band;
        } else if (ddState.active && ddPct < 2.5) {
          ddState.active = false; ddState.deepest = 0;
        }
      }
      if (effBets != null && effBets < 2.0) {
        candidates.push({ subject: "portfolio", kind: "concentration",
          state: "eff_bets:below-2", severity: "info",
          evidence_ts: new Date(nowMs).toISOString(),
          headline: "有效押注数 " + effBets.toFixed(1) + " — " + risk.length +
            " 个风险仓位实际上不足两个独立押注",
          detail: "Decision: 分散度检查 — 是相关性在做集中化，不只是仓位。" });
      }
      // systematic collapse over the sector cluster
      const clusterCands = candidates.filter((c) => c._cluster);
      if (clusterCands.length >= 2 && avgCorr != null && avgCorr >= 0.5) {
        const dirs = clusterCands.map((c) => c._dir);
        if (dirs.every((d) => d === dirs[0])) {
          const names = clusterCands.map((c) => c.subject.split(":")[1]);
          const maxSev = clusterCands.some((c) => c.severity === "critical") ? "critical" : "warning";
          const resids = rows.filter((r) => names.includes(r.asset) && r.resid_score != null);
          const maxResid = resids.length ? Math.max(...resids.map((r) => r.resid_score)) : null;
          for (const c of clusterCands) candidates.splice(candidates.indexOf(c), 1);
          candidates.push({ subject: "portfolio", kind: "systematic_move",
            state: "sys:" + new Date(nowMs).toISOString().slice(0, 10) + ":" + (dirs[0] > 0 ? "up" : "down"),
            severity: maxSev, evidence_ts: new Date(nowMs).toISOString(),
            headline: "光模块板块（" + names.join("、") + "）同向" + (dirs[0] > 0 ? "上涨" : "下跌") +
              "（板块内相关性 " + avgCorr.toFixed(2) + "）" +
              (maxResid != null ? "；最大个股残差 " + maxResid.toFixed(1) + "σ — " +
                (maxResid < preset.k ? "无个体新闻" : "另有个股新闻，单独通知") : ""),
            detail: "Decision: 这是一次板块事件，不是 " + names.length + " 个信号 — 看回撤限额，不是逐票反应。" });
        }
      }
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

    // ── Novelty gate + bootstrap seeding ──
    const survivors = [];
    for (const c of candidates) {
      delete c._cluster; delete c._dir;
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
        const seedOnly = !bootstrapped && STATE_KINDS[c.kind];
        if (!seedOnly) survivors.push(c);
        fingerprints[key] = { state: c.state, prev_state: last ? last.state : null,
          severity: c.severity, ts: nowMs };
      }
    }
    if (!bootstrapped) await ctx.kv.put("bootstrap_done", "1");

    // ── Persist: data → audit → digest → fingerprints ──
    await posTs.append(rows.map((r) => ({ ...r, date: nowMs })));
    await navTs.append([{ ...navRow, date: nowMs,
      market_state: anyOpen ? "open" : "closed",
      run_kind: anyClose ? "close" : anyGap ? "open" : anyOpen ? "rth" : "offsession" }]);
    if (survivors.length) {
      await ctx.self.ts("alerts", "log").append(survivors.map((s2) => ({
        date: nowMs, alert_id: s2.subject + ":" + s2.kind + ":" + s2.state, ...s2 })));
      const lines = survivors
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .map((s2) => "[" + s2.severity.toUpperCase() + "] " + s2.headline + " — " + s2.detail);
      const digest = { date: nowMs,
        title: "风险监控：" + survivors.length + " 项变化",
        body: lines.join("\n") };
      if (config.playbook_url) digest.actions = [openUrlAction("打开 Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints));
    } else if (!bootstrapped) {
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints));
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
