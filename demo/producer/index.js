// portfolio-watch-demo producer — Rung C (manual holdings) live demo build.
// Holdings: ~/feeds/portfolio-watch-demo/v1/holdings.json (user-declared).
// Config:   ~/feeds/portfolio-watch-demo/v1/config.json   (preset knob, playbook_url).
// args:     { test_alert?: true }  → one info-severity test alert, novelty-gated.

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const { jStat } = require("@alva/algorithm");
const http = require("net/http");
const alfs = require("alfs");
const env = require("env");
const secret = require("secret-manager");

const HOME = "/alva/home/" + env.username;
const BASE = feedPath("portfolio-watch-demo"); // ~/feeds/portfolio-watch-demo/v1
const ARRAYS = "https://data-tools.prd.arrays.org";

const STABLES = { USDT: true, USDC: true, FDUSD: true, DAI: true };

const PRESETS = {
  calm:      { k: 4, fast1h: 0.12, ddBands: [10, 20, 30],            conc: false },
  normal:    { k: 3, fast1h: 0.08, ddBands: [5, 10, 15, 20, 30],     conc: true  },
  sensitive: { k: 2, fast1h: 0.05, ddBands: [5, 10, 15, 20, 30],     conc: true  },
};
const SEV_RANK = { info: 0, warning: 1, critical: 2, "action-needed": 2 };

const feed = new Feed({ path: BASE });
feed.def("positions", {
  snapshot: makeDoc("Positions", "Per-asset snapshot per run", [
    str("asset"), str("pair"), num("qty"), num("price"), num("value_usd"),
    num("weight"), num("chg_1h"), num("chg_24h"), num("chg_7d"),
    num("move_score"), str("pricing"), bool("stale"), str("asof_price"),
  ]),
});
feed.def("portfolio_nav", {
  series: makeDoc("Portfolio NAV", "One row per run", [
    num("nav_usd"), num("pnl_24h"), num("drawdown_30d"), num("stable_ratio"),
    num("top_weight"), num("unpriced_count"), num("stale_count"),
  ]),
});
feed.def("events", {
  log: makeDoc("Events", "Material external evidence (disabled in demo)", [
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

// Share-safe variant feed: written by THE SAME run (one producer, one clock).
// Data-layer stripping: shapes and ratios only — no NAV dollars, no
// quantities, no prices, no absolute values. No alertOutput here (the private
// feed owns delivery); the alert timeline is mirrored as a regular output —
// alert texts carry percentages only by construction.
const safeFeed = new Feed({ path: feedPath("portfolio-watch-demo-safe") });
safeFeed.def("allocation", {
  weights: makeDoc("Allocation", "Weights and relative moves, no absolutes", [
    str("asset"), num("weight"), num("chg_24h"), num("chg_7d"),
    num("move_score"), str("pricing"), bool("stale"),
  ]),
});
safeFeed.def("portfolio_shape", {
  series: makeDoc("Portfolio shape", "Indexed NAV and ratio series", [
    num("nav_index"), num("pnl_24h"), num("drawdown_30d"),
    num("stable_ratio"), num("top_weight"), num("unpriced_count"), num("stale_count"),
  ]),
});
safeFeed.def("alerts", {
  log: makeDoc("Alert mirror", "Redacted alert timeline (percentages only)", [
    str("subject"), str("kind"), str("severity"), str("evidence_ts"),
    str("headline"), str("detail"),
  ]),
});

async function readJson(path, required) {
  try {
    return JSON.parse(await alfs.readFile(path));
  } catch (e) {
    if (required) throw new Error("required input missing/invalid: " + path + " — " + e.message);
    return null;
  }
}

async function kline(jwt, symbol, interval, startSec, endSec, limit) {
  const url = ARRAYS + "/api/v1/crypto/binance/spot/usdt/kline" +
    "?symbol=" + encodeURIComponent(symbol) +
    "&start_time=" + startSec + "&end_time=" + endSec +
    "&interval=" + interval + "&limit=" + limit;
  const resp = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  if (!resp.ok) throw new Error("kline HTTP " + resp.status + " for " + symbol);
  const body = await resp.json();
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error("kline invalid envelope for " + symbol);
  }
  return body.data; // reverse chronological: data[0] latest
}

(async () => {
  const shared = {};                         // handoff to the share-safe write
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const args = env.args || {};

    // ── 1. Account truth (Rung C: user-declared holdings; REQUIRED input) ──
    const holdingsDoc = await readJson(BASE + "/holdings.json", true);
    if (!Array.isArray(holdingsDoc.holdings) || !holdingsDoc.holdings.length) {
      throw new Error("holdings.json has no holdings[]");
    }
    const config = (await readJson(BASE + "/config.json", false)) || {};
    const preset = PRESETS[config.preset || "normal"] || PRESETS.normal;

    const jwt = secret.loadPlaintext("ARRAYS_JWT");
    if (!jwt) throw new Error("ARRAYS_JWT missing — run `alva arrays token ensure`");

    // ── 2. Bounded history + KV state (strings; JSON round-trip) ──
    const navTs = ctx.self.ts("portfolio_nav", "series");
    const posTs = ctx.self.ts("positions", "snapshot");
    const win30d = await navTs.range(nowMs - 30 * 86400e3, nowMs);
    const near24 = await navTs.range(nowMs - 26 * 3600e3, nowMs - 22 * 3600e3);
    const prevPos = await posTs.last(1); // last batch (auto-flattened rows)
    const fingerprints = JSON.parse((await ctx.kv.load("fingerprints")) || "{}");
    const sigmas = JSON.parse((await ctx.kv.load("sigmas")) || "{}");
    if (!(await ctx.kv.load("watch_created_ts"))) {
      await ctx.kv.put("watch_created_ts", String(nowMs));
    }

    // ── 3. Pricing (per-asset; carried/unpriced are explicit partial states) ──
    const rows = [];
    for (const h of holdingsDoc.holdings) {
      const asset = String(h.asset).toUpperCase();
      const qty = Number(h.qty);
      if (!(qty >= 0)) throw new Error("bad qty for " + asset);

      if (STABLES[asset]) {
        rows.push({ asset, pair: asset === "USDT" ? null : asset + "/USDT",
          qty, price: 1.0, value_usd: qty, chg_1h: 0, chg_24h: 0, chg_7d: 0,
          move_score: 0, pricing: "quote_unit", stale: false,
          asof_price: new Date(nowMs).toISOString() });
        continue;
      }
      try {
        const bars = await kline(jwt, asset, "1h", nowSec - 8 * 86400, nowSec, 200);
        if (!bars.length) throw new Error("no bars for " + asset);
        const px = (i) => (bars[i] ? bars[i].price_close : null);
        const price = px(0);
        // σ20d from daily bars, cached in KV, refreshed when older than 20h
        let s = sigmas[asset];
        if (!s || nowMs - s.at > 20 * 3600e3) {
          const daily = await kline(jwt, asset, "1d", nowSec - 25 * 86400, nowSec, 25);
          const closes = daily.map((b) => b.price_close).reverse(); // chronological
          const rets = [];
          for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
          s = { sigma: rets.length >= 10 ? jStat.stdev(rets, true) : null, at: nowMs };
          sigmas[asset] = s;
        }
        const chg24 = px(24) ? price / px(24) - 1 : null;
        rows.push({
          asset, pair: asset + "/USDT", qty, price, value_usd: qty * price,
          chg_1h: px(1) ? price / px(1) - 1 : null,
          chg_24h: chg24,
          chg_7d: px(168) ? price / px(168) - 1 : null,
          move_score: chg24 != null && s.sigma ? Math.abs(chg24) / s.sigma : null,
          pricing: "direct", stale: false, asof_price: bars[0].time_close,
        });
      } catch (e) {
        // Explicit degradation: carry last known value if one exists, else unpriced.
        const prev = prevPos.find((p) => p.asset === asset);
        if (prev && prev.price != null && prev.pricing !== "unpriced") {
          rows.push({ ...prev, qty, value_usd: qty * prev.price, chg_1h: null,
            chg_24h: null, chg_7d: null, move_score: null,
            pricing: "carried", stale: true });
        } else {
          rows.push({ asset, pair: null, qty, price: null, value_usd: null,
            chg_1h: null, chg_24h: null, chg_7d: null, move_score: null,
            pricing: "unpriced", stale: true, asof_price: null });
        }
        console.error("degraded " + asset + ": " + e.message);
      }
    }
    await ctx.kv.put("sigmas", JSON.stringify(sigmas));

    // ── 4. Deterministic aggregates (dust → OTHER; unpriced excluded from NAV) ──
    const priced = rows.filter((r) => r.value_usd != null);
    const nav = priced.reduce((a, r) => a + r.value_usd, 0);
    for (const r of rows) r.weight = r.value_usd != null && nav > 0 ? r.value_usd / nav : null;
    const dust = priced.filter((r) => r.value_usd < 10 && r.weight < 0.005);
    const kept = rows.filter((r) => !dust.includes(r));
    if (dust.length) {
      kept.push({ asset: "OTHER", pair: null, qty: null,
        price: null, value_usd: dust.reduce((a, r) => a + r.value_usd, 0),
        weight: dust.reduce((a, r) => a + r.weight, 0), chg_1h: null,
        chg_24h: null, chg_7d: null, move_score: null, pricing: "direct",
        stale: false, asof_price: new Date(nowMs).toISOString() });
    }
    const staleCount = kept.filter((r) => r.stale).length;
    const staleNavShare = nav > 0
      ? kept.filter((r) => r.stale && r.value_usd != null)
            .reduce((a, r) => a + r.value_usd, 0) / nav : 0;
    const navHist = win30d.map((r) => r.nav_usd).concat([nav]);
    const navRow = {
      nav_usd: nav,
      pnl_24h: near24.length
        ? nav / near24.reduce((best, r) =>
            Math.abs(r.date - (nowMs - 24 * 3600e3)) <
            Math.abs(best.date - (nowMs - 24 * 3600e3)) ? r : best).nav_usd - 1
        : null,
      drawdown_30d: 1 - nav / Math.max(...navHist),
      stable_ratio: nav > 0
        ? kept.filter((r) => STABLES[r.asset]).reduce((a, r) => a + (r.value_usd || 0), 0) / nav : null,
      top_weight: Math.max(0, ...kept.filter((r) => r.asset !== "OTHER" && !STABLES[r.asset] && r.weight != null).map((r) => r.weight)),
      unpriced_count: kept.filter((r) => r.pricing === "unpriced").length,
      stale_count: staleCount,
    };

    // ── 5. Alert candidates (stale assets excluded; half-blind → no judgment) ──
    const candidates = [];
    if (staleNavShare <= 0.5) {
      for (const r of kept) {
        if (r.stale || r.asset === "OTHER" || STABLES[r.asset]) continue;
        if (r.move_score != null && r.move_score >= preset.k) {
          const sev = r.move_score >= 2 * preset.k ? "critical" : "warning";
          candidates.push({ subject: "asset:" + r.asset, kind: "price_move",
            state: "move:" + (r.chg_24h > 0 ? "up" : "down") + "-" + Math.floor(r.move_score) + "sigma",
            severity: sev, evidence_ts: r.asof_price,
            headline: r.asset + " moved " + (r.chg_24h * 100).toFixed(1) + "% in 24h (" + r.move_score.toFixed(1) + "× its 20d daily σ)",
            detail: "Unusual for this asset's own volatility. Check the holdings table and NAV chart." });
        }
        if (r.chg_1h != null && Math.abs(r.chg_1h) >= preset.fast1h) {
          candidates.push({ subject: "asset:" + r.asset, kind: "price_move",
            state: "fast:" + (r.chg_1h > 0 ? "up" : "down"),
            severity: "warning", evidence_ts: r.asof_price,
            headline: r.asset + " moved " + (r.chg_1h * 100).toFixed(1) + "% in 1h",
            detail: "Fast move beyond the " + preset.fast1h * 100 + "% 1h threshold." });
        }
      }
      const ddPct = navRow.drawdown_30d * 100;
      const band = preset.ddBands.filter((b) => ddPct >= b).pop();
      if (band != null && win30d.length >= 3) {
        candidates.push({ subject: "portfolio", kind: "drawdown",
          state: "drawdown_band:" + band,
          severity: band >= 15 ? "critical" : "warning",
          evidence_ts: new Date(nowMs).toISOString(),
          headline: "Portfolio drawdown crossed −" + band + "% from its 30d high",
          detail: "Now " + ddPct.toFixed(1) + "% below the 30-day peak." });
      }
      if (preset.conc && navRow.top_weight >= 0.40) {
        candidates.push({ subject: "portfolio", kind: "concentration",
          state: "top_weight:above-40", severity: "info",
          evidence_ts: new Date(nowMs).toISOString(),
          headline: "Top position is " + (navRow.top_weight * 100).toFixed(0) + "% of the portfolio",
          detail: "Concentration above the 40% attention line." });
      }
    }
    if (args.test_alert === true) {
      candidates.push({ subject: "system", kind: "test", state: "test-delivery",
        severity: "info", evidence_ts: new Date(nowMs).toISOString(),
        headline: "Test alert — delivery chain verification",
        detail: "Sent once to prove the pipeline; the novelty gate suppresses repeats." });
    }

    // ── 6. Novelty gate (compare against last NOTIFIED state; escalation only) ──
    const survivors = [];
    for (const c of candidates) {
      const key = c.subject + ":" + c.kind;
      const last = fingerprints[key];
      const esc = last ? (SEV_RANK[c.severity] || 0) > (SEV_RANK[last.severity] || 0) : false;
      let pass;
      if (!last) pass = true;                       // first occurrence
      else if (last.state === c.state) pass = esc;  // same state: escalation only
      else {
        // real transition passes; returning to the recently-notified previous
        // state within cooldown is the oscillation guard
        const oscillating = c.state === last.prev_state && nowMs - last.ts < 24 * 3600e3;
        pass = esc || !oscillating;
      }
      if (pass) {
        survivors.push(c);
        fingerprints[key] = { state: c.state, prev_state: last ? last.state : null,
          severity: c.severity, ts: nowMs };
      }
    }

    // ── 7. Persist: data → audit log → digest → fingerprints (in that order) ──
    await posTs.append(kept.map((r) => ({ ...r, date: nowMs })));
    await navTs.append([{ ...navRow, date: nowMs }]);
    if (survivors.length) {
      await ctx.self.ts("alerts", "log").append(survivors.map((s) => ({
        date: nowMs, alert_id: s.subject + ":" + s.kind + ":" + s.state, ...s })));
      const lines = survivors
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .map((s) => "[" + s.severity.toUpperCase() + "] " + s.headline + " — " + s.detail);
      const digest = {
        date: nowMs,
        title: "Portfolio watch: " + survivors.length + " change" + (survivors.length > 1 ? "s" : ""),
        body: lines.join("\n"),
      };
      if (config.playbook_url) digest.actions = [openUrlAction("Open Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
      await ctx.kv.put("fingerprints", JSON.stringify(fingerprints));
    }
    console.error("run ok: nav=" + nav.toFixed(2) + " rows=" + kept.length +
      " stale=" + staleCount + " candidates=" + candidates.length +
      " delivered_records=" + (survivors.length ? 1 : 0));
    shared.ts = nowMs;
    shared.nav = nav;
    shared.navRow = navRow;
    shared.rows = kept;
    shared.survivors = survivors;
  });

  // ── Share-safe mirror: same run, same clock, absolutes stripped ──
  await safeFeed.run(async (ctx) => {
    if (shared.ts == null) return;
    let base = Number(await ctx.kv.load("nav_base"));
    if (!base) { base = shared.nav; await ctx.kv.put("nav_base", String(base)); }
    await ctx.self.ts("allocation", "weights").append(shared.rows.map((r) => ({
      date: shared.ts, asset: r.asset, weight: r.weight, chg_24h: r.chg_24h,
      chg_7d: r.chg_7d, move_score: r.move_score, pricing: r.pricing, stale: r.stale,
    })));
    await ctx.self.ts("portfolio_shape", "series").append([{
      date: shared.ts,
      nav_index: base > 0 ? (shared.nav / base) * 100 : null,
      pnl_24h: shared.navRow.pnl_24h, drawdown_30d: shared.navRow.drawdown_30d,
      stable_ratio: shared.navRow.stable_ratio, top_weight: shared.navRow.top_weight,
      unpriced_count: shared.navRow.unpriced_count, stale_count: shared.navRow.stale_count,
    }]);
    if (shared.survivors.length) {
      await ctx.self.ts("alerts", "log").append(shared.survivors.map((s) => ({
        date: shared.ts, subject: s.subject, kind: s.kind, severity: s.severity,
        evidence_ts: s.evidence_ts, headline: s.headline, detail: s.detail,
      })));
    }
  });
})();
