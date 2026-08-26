// portfolio-watch-equity-demo producer — bare-watchlist (rung C′) live demo.
// Watchlist: ~/feeds/portfolio-watch-equity-demo/v1/watchlist.json (tickers only).
// Config:    ~/feeds/portfolio-watch-equity-demo/v1/config.json (preset, playbook_url).
// args:      { test_alert?: true } → one info-severity test alert, novelty-gated.
//
// Watchlist mode: qty/value/weight are null by contract and NEVER fabricated;
// portfolio-tier alerts (drawdown/concentration) stay dark — no quantities.
// Session logic is DATA-DRIVEN (bar timestamps), not clock math: a new daily
// bar means a close happened; a new session's first RTH bar means an open
// happened; a fresh RTH bar means the market is open. DST needs no handling.

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const env = require("env");
const secret = require("secret-manager");

const BASE = feedPath("portfolio-watch-equity-demo"); // ~/feeds/portfolio-watch-equity-demo/v1
const ARRAYS = "https://data-tools.prd.arrays.org";
const alfs = require("alfs");

// Equity preset values (asset-equity.md §6)
const PRESETS = {
  calm:      { k: 4, kGap: 3,   earnDays: 1, volMult: null },
  normal:    { k: 3, kGap: 2,   earnDays: 3, volMult: 3 },
  sensitive: { k: 2, kGap: 1.5, earnDays: 7, volMult: 2 },
};
const SEV_RANK = { info: 0, warning: 1, critical: 2, "action-needed": 2 };
const FRESH_MS = 45 * 60e3; // an RTH bar closing within 45min of now ⇒ market open

const feed = new Feed({ path: BASE });
feed.def("positions", {
  snapshot: makeDoc("Watchlist", "Per-ticker snapshot per run (watchlist mode: qty/value/weight null)", [
    str("asset"), str("asset_class"), str("pair"), num("qty"), num("price"),
    num("value_usd"), num("weight"), num("chg_day"), num("gap_pct"),
    num("move_score"), num("vol_ratio"), str("next_earnings"), num("days_to_earnings"),
    num("perf_index"), str("pricing"), bool("stale"), str("market_state"), str("asof_price"),
  ]),
});
feed.def("portfolio_nav", {
  series: makeDoc("Watch pulse", "One row per run; NAV fields null in watchlist mode", [
    num("nav_usd"), num("pnl_24h"), num("drawdown_30d"), num("stable_ratio"),
    num("top_weight"), num("unpriced_count"), num("stale_count"),
    str("market_state"), str("run_kind"),
  ]),
});
feed.def("events", {
  log: makeDoc("Events", "Material external evidence (news disabled in demo — see README blind spots)", [
    str("asset"), str("headline"), str("source_url"), str("materiality"), str("synopsis"),
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
  try {
    return JSON.parse(await alfs.readFile(path));
  } catch (e) {
    if (required) throw new Error("required input missing/invalid: " + path + " — " + e.message);
    return null;
  }
}

async function getJson(jwt, url) {
  const resp = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + url);
  const body = await resp.json();
  if (!Array.isArray(body.data)) throw new Error("invalid envelope for " + url);
  return body.data; // reverse chronological: data[0] latest
}

function stocksKline(jwt, sym, interval, startSec, endSec, limit, session) {
  return getJson(jwt, ARRAYS + "/api/v1/stocks/kline?symbol=" + encodeURIComponent(sym) +
    "&start_time=" + startSec + "&end_time=" + endSec + "&interval=" + interval +
    (session ? "&session=" + session : "") + "&limit=" + limit);
}

(async () => {
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const args = env.args || {};

    // ── 1. Source truth: bare watchlist (tickers only; REQUIRED input) ──
    const wl = await readJson(BASE + "/watchlist.json", true);
    if (!Array.isArray(wl.tickers) || !wl.tickers.length) {
      throw new Error("watchlist.json has no tickers[]");
    }
    const config = (await readJson(BASE + "/config.json", false)) || {};
    const preset = PRESETS[config.preset || "normal"] || PRESETS.normal;

    const jwt = secret.loadPlaintext("ARRAYS_JWT");
    if (!jwt) throw new Error("ARRAYS_JWT missing — run `alva arrays token ensure`");

    // ── 2. Bounded history + KV state (strings; JSON round-trip) ──
    const posTs = ctx.self.ts("positions", "snapshot");
    const prevPos = await posTs.last(1);
    const fingerprints = JSON.parse((await ctx.kv.load("fingerprints")) || "{}");
    const sigmas = JSON.parse((await ctx.kv.load("sigmas")) || "{}");       // {SYM:{sigma,avgvol,at}}
    const baselines = JSON.parse((await ctx.kv.load("baselines")) || "{}"); // {SYM:{price,ts}} — "since watching" rebase
    const earnCache = JSON.parse((await ctx.kv.load("earnings")) || "{}");  // {SYM:{date,time,at}}
    const closeWm = JSON.parse((await ctx.kv.load("close_wm")) || "{}");    // {SYM: time_close of last judged daily bar}
    const gapWm = JSON.parse((await ctx.kv.load("gap_wm")) || "{}");        // {SYM: time_open of last judged session}
    if (!(await ctx.kv.load("watch_created_ts"))) {
      await ctx.kv.put("watch_created_ts", String(nowMs));
    }

    // ── 3. Per-ticker pricing + class-aware judgment windows ──
    const rows = [];
    const candidates = [];
    let anyOpen = false, anyClose = false, anyGap = false;
    for (const t of wl.tickers) {
      const sym = String(t).toUpperCase();
      try {
        // Daily bars (completed trading days; today's bar appears only after close)
        const days = await stocksKline(jwt, sym, "1d", nowSec - 45 * 86400, nowSec, 30);
        if (days.length < 21) throw new Error("insufficient daily history for " + sym);
        // σ over 20 TRADING-day close-to-close returns + 20d average volume,
        // cached and refreshed when older than 20h
        let s = sigmas[sym];
        if (!s || nowMs - s.at > 20 * 3600e3) {
          const closes = days.slice(0, 21).map((b) => b.price_close).reverse();
          const rets = [];
          for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
          const vols = days.slice(1, 21).map((b) => b.volume_traded);
          s = { sigma: jStat.stdev(rets, true),
                avgvol: vols.reduce((a, v) => a + v, 0) / vols.length, at: nowMs };
          sigmas[sym] = s;
        }
        // Intraday RTH bars: session detection + latest session's first bar (gap)
        const rth = await stocksKline(jwt, sym, "30min", nowSec - 4 * 86400, nowSec, 60, "RTH");
        if (!rth.length) throw new Error("no intraday bars for " + sym);
        const marketOpen = nowSec - rth[0].time_close < FRESH_MS / 1e3;
        if (marketOpen) anyOpen = true;
        // Bars of the latest session = all bars after the last completed daily
        // close that precedes them; first bar of that session judges the gap.
        const sessBars = rth.filter((b) => b.time_open >= rth[0].time_open - 6.5 * 3600)
                            .filter((b) => Math.floor(b.time_open / 86400) === Math.floor(rth[0].time_open / 86400));
        const firstBar = sessBars[sessBars.length - 1]; // reverse-chron ⇒ last = earliest
        const price = rth[0].price_close;
        // prior close: the newest daily bar that closed BEFORE the current session opened
        const prior = days.find((d) => d.time_close <= firstBar.time_open);
        const priorClose = prior ? prior.price_close : days[1].price_close;
        const chgDay = price / priorClose - 1;
        const moveScore = s.sigma ? Math.abs(chgDay) / s.sigma : null;
        // Baseline for the since-watching rebase (first successful pricing)
        if (!baselines[sym]) baselines[sym] = { price, ts: nowMs };
        // Earnings calendar (cached 20h): nearest upcoming date within window
        let e = earnCache[sym];
        if (!e || nowMs - e.at > 20 * 3600e3) {
          const cal = await getJson(jwt, ARRAYS + "/api/v1/stocks/earnings-calendar?symbol=" + sym + "&limit=8");
          const todayIso = new Date(nowMs).toISOString().slice(0, 10);
          const upcoming = cal.filter((r) => r.date >= todayIso).sort((a, b) => a.date < b.date ? -1 : 1)[0];
          e = { date: upcoming ? upcoming.date : null, time: upcoming ? upcoming.time : null, at: nowMs };
          earnCache[sym] = e;
        }
        const daysToEarn = e.date
          ? Math.round((Date.parse(e.date) - nowMs) / 86400e3 + 0.5) : null;

        // ── Judgment windows (only in-session facts are judged) ──
        // (a) intraday move — only while the market is open
        if (marketOpen && moveScore != null && moveScore >= preset.k) {
          candidates.push({ subject: "asset:" + sym, kind: "price_move",
            state: "move:" + (chgDay > 0 ? "up" : "down") + "-" + Math.floor(moveScore) + "sigma",
            severity: moveScore >= 2 * preset.k ? "critical" : "warning",
            evidence_ts: rth[0].time_period_end,
            headline: sym + " is " + (chgDay > 0 ? "up " : "down ") + (chgDay * 100).toFixed(1) +
              "% vs prior close (" + moveScore.toFixed(1) + "× its 20-trading-day σ)",
            detail: "Unusual for this stock's own volatility. Open the watchlist for the chart." });
        }
        // (b) gap — judged once per session, at the first RTH bar
        if (firstBar && (!gapWm[sym] || firstBar.time_open > gapWm[sym]) && prior) {
          const gap = firstBar.price_open / priorClose - 1;
          if (s.sigma && Math.abs(gap) / s.sigma >= preset.kGap) {
            candidates.push({ subject: "asset:" + sym, kind: "gap",
              state: "gap:" + new Date(firstBar.time_open * 1e3).toISOString().slice(0, 10) +
                ":" + (gap > 0 ? "up" : "down"),
              severity: "warning", evidence_ts: firstBar.time_period_start,
              headline: sym + " opened " + (gap > 0 ? "up " : "down ") + (gap * 100).toFixed(1) +
                "% vs prior close (" + (Math.abs(gap) / s.sigma).toFixed(1) + "σ gap)",
              detail: "Judged once at the open; intraday follow-through is tracked separately." });
          }
          gapWm[sym] = firstBar.time_open;
          anyGap = true;
        }
        // (c) close run — a new completed daily bar: authoritative close-to-close
        //     judgment + the ONLY volume-anomaly check
        if (!closeWm[sym] || days[0].time_close > closeWm[sym]) {
          const closeChg = days[0].price_close / days[1].price_close - 1;
          const cScore = s.sigma ? Math.abs(closeChg) / s.sigma : null;
          if (cScore != null && cScore >= preset.k) {
            candidates.push({ subject: "asset:" + sym, kind: "price_move",
              state: "close:" + days[0].time_period_end.slice(0, 10) + ":" + (closeChg > 0 ? "up" : "down") + "-" + Math.floor(cScore) + "sigma",
              severity: cScore >= 2 * preset.k ? "critical" : "warning",
              evidence_ts: days[0].time_period_end,
              headline: sym + " closed " + (closeChg > 0 ? "up " : "down ") + (closeChg * 100).toFixed(1) +
                "% (" + cScore.toFixed(1) + "× its 20-trading-day σ)",
              detail: "Close-to-close move — the day's authoritative change." });
          }
          if (preset.volMult && s.avgvol && days[0].volume_traded >= preset.volMult * s.avgvol) {
            candidates.push({ subject: "asset:" + sym, kind: "volume_anomaly",
              state: "vol:" + days[0].time_period_end.slice(0, 10),
              severity: "info", evidence_ts: days[0].time_period_end,
              headline: sym + " traded " + (days[0].volume_traded / s.avgvol).toFixed(1) +
                "× its 20-day average volume today",
              detail: "Judged at the close only — intraday volume extrapolation is noise." });
          }
          closeWm[sym] = days[0].time_close;
          anyClose = true;
        }
        // (d) earnings proximity — date-based, fires once per event via the gate
        if (daysToEarn != null && daysToEarn >= 0 && daysToEarn <= preset.earnDays) {
          candidates.push({ subject: "asset:" + sym, kind: "earnings_event",
            state: "earnings:" + e.date,
            severity: "info", evidence_ts: e.date,
            headline: sym + " reports earnings " + (daysToEarn === 0 ? "today" : "in " + daysToEarn + " day" + (daysToEarn > 1 ? "s" : "")) +
              (e.time === "amc" ? " (after market close)" : e.time === "bmo" ? " (before market open)" : ""),
            detail: "Expect elevated volatility around the report." });
        }

        rows.push({
          asset: sym, asset_class: "equity", pair: sym, qty: null, price,
          value_usd: null, weight: null, chg_day: chgDay,
          gap_pct: firstBar && prior ? firstBar.price_open / priorClose - 1 : null,
          move_score: moveScore,
          vol_ratio: s.avgvol ? days[0].volume_traded / s.avgvol : null,
          next_earnings: e.date, days_to_earnings: daysToEarn,
          perf_index: (price / baselines[sym].price) * 100,
          pricing: "direct", stale: false,
          market_state: marketOpen ? "open" : "closed",
          asof_price: rth[0].time_period_end,
        });
      } catch (err) {
        // Explicit degradation: carry last known price if one exists, else unpriced.
        // Stale/carried tickers are excluded from ALL judgment (no alerts on bad data).
        const prev = prevPos.find((p) => p.asset === sym);
        if (prev && prev.price != null && prev.pricing !== "unpriced") {
          rows.push({ ...prev, chg_day: null, gap_pct: null, move_score: null,
            vol_ratio: null, pricing: "carried", stale: true });
        } else {
          rows.push({ asset: sym, asset_class: "equity", pair: null, qty: null,
            price: null, value_usd: null, weight: null, chg_day: null, gap_pct: null,
            move_score: null, vol_ratio: null, next_earnings: null, days_to_earnings: null,
            perf_index: null, pricing: "unpriced", stale: true, market_state: null,
            asof_price: null });
        }
        console.error("degraded " + sym + ": " + err.message);
      }
    }
    await ctx.kv.put("sigmas", JSON.stringify(sigmas));
    await ctx.kv.put("baselines", JSON.stringify(baselines));
    await ctx.kv.put("earnings", JSON.stringify(earnCache));

    // ── 4. Half-blind guard: majority stale ⇒ record, never judge ──
    const staleCount = rows.filter((r) => r.stale).length;
    const halfBlind = staleCount > rows.length / 2;
    let live = halfBlind ? [] : candidates;
    if (args.test_alert === true) {
      live = live.concat([{ subject: "system", kind: "test", state: "test-delivery",
        severity: "info", evidence_ts: new Date(nowMs).toISOString(),
        headline: "Test alert — delivery chain verification",
        detail: "Sent once to prove the pipeline; the novelty gate suppresses repeats." }]);
    }

    // ── 5. Novelty gate (compare against last NOTIFIED state; escalation only) ──
    const survivors = [];
    for (const c of live) {
      const key = c.subject + ":" + c.kind;
      const last = fingerprints[key];
      const esc = last ? (SEV_RANK[c.severity] || 0) > (SEV_RANK[last.severity] || 0) : false;
      let pass;
      if (!last) pass = true;
      else if (last.state === c.state) pass = esc;
      else {
        const oscillating = c.state === last.prev_state && nowMs - last.ts < 24 * 3600e3;
        pass = esc || !oscillating;
      }
      if (pass) {
        survivors.push(c);
        fingerprints[key] = { state: c.state, prev_state: last ? last.state : null,
          severity: c.severity, ts: nowMs };
      }
    }

    // ── 6. Persist: data → audit log → digest → fingerprints (in that order) ──
    const marketState = anyOpen ? "open" : "closed";
    await posTs.append(rows.map((r) => ({ ...r, date: nowMs })));
    await ctx.self.ts("portfolio_nav", "series").append([{
      date: nowMs, nav_usd: null, pnl_24h: null, drawdown_30d: null,
      stable_ratio: null, top_weight: null,
      unpriced_count: rows.filter((r) => r.pricing === "unpriced").length,
      stale_count: staleCount, market_state: marketState,
      run_kind: anyClose ? "close" : anyGap ? "open" : anyOpen ? "rth" : "offsession",
    }]);
    if (survivors.length) {
      await ctx.self.ts("alerts", "log").append(survivors.map((s2) => ({
        date: nowMs, alert_id: s2.subject + ":" + s2.kind + ":" + s2.state, ...s2 })));
      const lines = survivors
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .map((s2) => "[" + s2.severity.toUpperCase() + "] " + s2.headline + " — " + s2.detail);
      const digest = {
        date: nowMs,
        title: "Watchlist: " + survivors.length + " change" + (survivors.length > 1 ? "s" : ""),
        body: lines.join("\n"),
      };
      if (config.playbook_url) digest.actions = [openUrlAction("Open Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints));
    }
    await ctx.kv.put("close_wm", JSON.stringify(closeWm));
    await ctx.kv.put("gap_wm", JSON.stringify(gapWm));
    console.error("run ok: tickers=" + rows.length + " stale=" + staleCount +
      " market=" + marketState + " candidates=" + candidates.length +
      " survivors=" + survivors.length +
      " delivered_records=" + (survivors.length ? 1 : 0));
  });
})();
