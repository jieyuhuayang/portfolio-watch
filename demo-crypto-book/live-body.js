// portfolio-watch-crypto-book — LIVE WRAPPER (I/O only; judgment in judgment.js).
// Built into a single deployable index.js by build.sh (judgment.js + this).
// Declared crypto book (manual holdings + stablecoin cash), hourly 24/7.
// Inputs: ~/feeds/portfolio-watch-crypto-book/v1/holdings.json, config.json
// args: { test_alert?: true }

const {
  Feed, feedPath, makeDoc, num, str, bool,
  alertOutput, messageActionsField, openUrlAction,
} = require("@alva/feed");
const http = require("net/http");
const env = require("env");
const secret = require("secret-manager");
const alfs = require("alfs");

const BASE = feedPath("portfolio-watch-crypto-book");
const ARRAYS = "https://data-tools.prd.arrays.org";

const feed = new Feed({ path: BASE });
feed.def("positions", {
  snapshot: makeDoc("Positions", "Per-asset snapshot per run (declared crypto book, USDT≈USD)", [
    str("asset"), str("name"), str("asset_class"), str("pair"), num("qty"),
    num("price"), num("value_usd"), num("weight"), num("target_weight"),
    num("chg_24h"), num("chg_1h"), num("beta"), num("resid_chg"), num("resid_score"),
    num("move_score"), num("fast_score"),
    str("pricing"), bool("stale"), str("asof_price"),
  ]),
});
feed.def("portfolio_nav", {
  series: makeDoc("Portfolio NAV", "One row per run (USD; exposure metrics)", [
    num("nav_usd"), num("pnl_24h"), num("drawdown_30d"), num("stable_ratio"),
    num("top_weight"), num("eff_bets"), num("avg_corr"),
    num("unpriced_count"), num("stale_count"), str("market_state"), str("run_kind"),
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
const kline = (jwt, sym, iv, a, b, n) => getJson(jwt,
  ARRAYS + "/api/v1/crypto/binance/spot/usdt/kline?symbol=" + encodeURIComponent(sym) +
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
      driftState: JSON.parse((await ctx.kv.load("drift_state")) || "{}"),
      ddState: JSON.parse((await ctx.kv.load("dd_state")) || '{"active":false,"deepest":0}'),
      depegState: JSON.parse((await ctx.kv.load("depeg_state")) || '{"phase":"armed","dir":null}'),
      bootstrapped: !!(await ctx.kv.load("bootstrap_done")),
    };
    if (!(await ctx.kv.load("watch_created_ts"))) await ctx.kv.put("watch_created_ts", String(nowMs));

    // fetch (I/O stays here; a degraded symbol enters judgment as {error})
    const px = {};
    for (const h of hdoc.holdings) {
      if (h.class === "stable") continue;
      const sym = String(h.asset).toUpperCase();
      try {
        const days = await kline(jwt, sym, "1d", nowSec - 160 * 86400, nowSec, 110);
        if (days.length < 30) throw new Error("insufficient daily history " + sym);
        let hours = [];
        try {
          hours = await kline(jwt, sym, "1h", nowSec - 8 * 86400, nowSec, 200);
        } catch (e2) {
          // hourly lane degraded → close-only judgment, visibly
          console.error("hourly degraded " + sym + ": " + e2.message);
        }
        px[sym] = { days, hours };
      } catch (err) {
        px[sym] = { error: err.message };
        console.error("fetch degraded " + sym + ": " + err.message);
      }
    }
    // depeg watch cross: USDC/USDT (deviation says one of the two is off peg)
    let stable = null;
    if (hdoc.holdings.some((h) => h.class === "stable")) {
      try {
        stable = { pair: "USDC/USDT",
          hours: await kline(jwt, "USDC", "1h", nowSec - 2 * 86400, nowSec, 30) };
      } catch (err) {
        stable = { error: err.message };
        console.error("stable cross degraded: " + err.message);
      }
    }

    const out = judgeCryptoBook({
      holdings: hdoc.holdings, targets: hdoc.targets || {},
      config: { preset: config.preset || "normal",
        BAND: config.drift_band != null ? config.drift_band : 0.05,
        CLUSTER: config.cluster || [] },
      px, stable,
      prevPos: await posTs.last(1),
      win30d: await navTs.range(nowMs - 30 * 86400e3, nowMs),
      near24: await navTs.range(nowMs - 26 * 3600e3, nowMs - 22 * 3600e3),
      state, nowMs, testAlert: args.test_alert === true,
    });

    // ── Persist: data → audit → digest → fingerprints ──
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
        title: "组合监控：" + out.survivors.length + " 项变化",
        body: lines.join("\n") };
      if (config.playbook_url) digest.actions = [openUrlAction("打开 Playbook", config.playbook_url)];
      await ctx.self.ts("alerts", "digest").append([digest]);
    }
    // fingerprints can change on quiet runs too (silent re-arm/recovery) —
    // persist unconditionally, after the data writes
    await ctx.kv.put("fingerprints", JSON.stringify(out.state.fingerprints));
    if (!(await ctx.kv.load("bootstrap_done"))) await ctx.kv.put("bootstrap_done", "1");
    await ctx.kv.put("drift_state", JSON.stringify(out.state.driftState));
    await ctx.kv.put("dd_state", JSON.stringify(out.state.ddState));
    await ctx.kv.put("depeg_state", JSON.stringify(out.state.depegState));
    console.error("run ok: nav=" + out.navRow.nav_usd.toFixed(0) +
      " stable=" + ((out.navRow.stable_ratio || 0) * 100).toFixed(1) + "%" +
      " effBets=" + (out.navRow.eff_bets || 0).toFixed(2) +
      " avgCorr=" + (out.navRow.avg_corr || 0).toFixed(2) +
      " candidates=" + out.candidates.length +
      " survivors=" + out.survivors.length +
      " engine=shared-judgment-crypto-v1");
  });
})();
