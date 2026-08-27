// portfolio-watch-ashare — LIVE WRAPPER (I/O only; judgment in judgment.js).
// Built into a single deployable index.js by build.sh (judgment.js + this).
// Feed definitions, inputs and write order are byte-compatible with the
// previously deployed producer; the judgment rules come from the shared
// judgeAshare() that the replay and the offline tests also run.
// Inputs: ~/feeds/portfolio-watch-ashare/v1/holdings.json, config.json
// args: { test_alert?: true }

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const http = require("net/http");
const env = require("env");
const secret = require("secret-manager");
const alfs = require("alfs");

const BASE = feedPath("portfolio-watch-ashare");
const ARRAYS = "https://data-tools.prd.arrays.org";

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

(async () => {
  await feed.run(async (ctx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const args = env.args || {};

    const hdoc = await readJson(BASE + "/holdings.json", true);
    const config = (await readJson(BASE + "/config.json", false)) || {};
    const jwt = secret.loadPlaintext("ARRAYS_JWT");
    if (!jwt) throw new Error("ARRAYS_JWT missing");

    const navTs = ctx.self.ts("portfolio_nav", "series");
    const posTs = ctx.self.ts("positions", "snapshot");
    const state = {
      fingerprints: JSON.parse((await ctx.kv.load("fingerprints")) || "{}"),
      stats: JSON.parse((await ctx.kv.load("stats")) || "{}"),
      closeWm: JSON.parse((await ctx.kv.load("close_wm")) || "{}"),
      gapWm: JSON.parse((await ctx.kv.load("gap_wm")) || "{}"),
      driftState: JSON.parse((await ctx.kv.load("drift_state")) || "{}"),
      ddState: JSON.parse((await ctx.kv.load("dd_state")) || '{"active":false,"deepest":0}'),
      bootstrapped: !!(await ctx.kv.load("bootstrap_done")),
    };
    if (!(await ctx.kv.load("watch_created_ts"))) await ctx.kv.put("watch_created_ts", String(nowMs));

    // fetch (I/O stays here; a degraded symbol enters judgment as {error})
    const eq = {};
    for (const h of hdoc.holdings) {
      if (h.class === "cash") continue;
      const sym = String(h.asset).toUpperCase();
      try {
        const days = await cnKline(jwt, sym, "1d", nowSec - 160 * 86400, nowSec, 110);
        if (days.length < 61) throw new Error("insufficient history " + sym);
        let rth = [];
        try {
          rth = await cnKline(jwt, sym, "30min", nowSec - 5 * 86400, nowSec, 60);
        } catch (e2) {
          // intraday degraded → close-only judgment (judgment.js FIX 1)
          console.error("intraday degraded " + sym + ": " + e2.message);
        }
        eq[sym] = { days, rth };
      } catch (err) {
        eq[sym] = { error: err.message };
        console.error("fetch degraded " + sym + ": " + err.message);
      }
    }

    const out = judgeAshare({
      holdings: hdoc.holdings, targets: hdoc.targets || {},
      config: { preset: config.preset || "normal",
        BAND: config.drift_band != null ? config.drift_band : 0.05,
        CLUSTER: config.cluster || [] },
      eq,
      prevPos: await posTs.last(1),
      win30d: await navTs.range(nowMs - 30 * 86400e3, nowMs),
      near24: await navTs.range(nowMs - 26 * 3600e3, nowMs - 22 * 3600e3),
      state, nowMs, testAlert: args.test_alert === true,
    });

    // ── Persist: data → audit → digest → fingerprints (same order as before) ──
    await ctx.kv.put("stats", JSON.stringify(out.state.stats));
    await posTs.append(out.rows.map((r) => ({ ...r, date: nowMs })));
    await navTs.append([{ ...out.navRow, date: nowMs }]);
    if (out.survivors.length) {
      await ctx.self.ts("alerts", "log").append(out.survivors.map((s2) => ({
        date: nowMs, alert_id: s2.subject + ":" + s2.kind + ":" + s2.state, ...s2 })));
      const lines = out.survivors
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
        .map((s2) => "[" + s2.severity.toUpperCase() + "] " + s2.headline + " — " + s2.detail);
      const digest = { date: nowMs,
        title: "风险监控：" + out.survivors.length + " 项变化",
        body: lines.join("\n") };
      if (config.playbook_url) digest.actions = [openUrlAction("打开 Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
    }
    // fingerprints can now change on quiet runs too (silent re-arm/recovery
    // transitions) — persist unconditionally, after the data writes
    await ctx.kv.put("fingerprints", JSON.stringify(out.state.fingerprints));
    if (!(await ctx.kv.load("bootstrap_done"))) await ctx.kv.put("bootstrap_done", "1");
    await ctx.kv.put("close_wm", JSON.stringify(out.state.closeWm));
    await ctx.kv.put("gap_wm", JSON.stringify(out.state.gapWm));
    await ctx.kv.put("drift_state", JSON.stringify(out.state.driftState));
    await ctx.kv.put("dd_state", JSON.stringify(out.state.ddState));
    console.error("run ok: nav=" + out.navRow.nav_cny.toFixed(0) +
      " effBets=" + (out.navRow.eff_bets || 0).toFixed(2) +
      " avgCorr=" + (out.navRow.avg_corr || 0).toFixed(2) +
      " candidates=" + out.candidates.length +
      " survivors=" + out.survivors.length +
      " engine=shared-judgment-v1");
  });
})();
