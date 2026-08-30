// Offline test suite for the crypto judgment module (platform bar format:
// RFC 3339 time strings, reverse-chronological arrays).
// Run: node demo-crypto-book/test/run-tests.js
// Deterministic fixtures (seeded LCG) — no Math.random, no Date.now.
"use strict";
const { judgeCryptoBook } = require("../judgment");

const HOUR = 3600, DAY = 86400, T0 = 1750000000;
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function gauss(rnd) { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) * Math.sqrt(2); }
const iso = (sec) => new Date(sec * 1000).toISOString();
const bar = (tOpen, dur, open, close) => ({
  time_open: iso(tOpen), time_close: iso(tOpen + dur),
  price_open: open, price_high: Math.max(open, close), price_low: Math.min(open, close),
  price_close: close, volume: 1000 });

// n ascending daily bars per symbol; common factor + idio; events[{idx:{SYM:ret}}]
function genDaily(symbols, n, opts) {
  const { seed = 42, factorVol = 0.02, events = {} } = opts || {};
  const rnd = lcg(seed);
  const out = {}, px = {};
  for (const s of symbols) { out[s.sym] = []; px[s.sym] = s.p0; }
  for (let i = 0; i < n; i++) {
    const f = gauss(rnd) * factorVol;
    for (const s of symbols) {
      let r = s.beta * f + gauss(rnd) * s.idioVol;
      if (events[i] && events[i][s.sym] != null) r = events[i][s.sym];
      const open = px[s.sym];
      px[s.sym] *= 1 + r;
      out[s.sym].push(bar(T0 + i * DAY, DAY, open, px[s.sym]));
    }
  }
  return out;
}
// market view at ascending day index i. hourly: flat ladder from the daily
// close 25h ago to `nowPx` (so the 24h anchor exists); ov: {SYM: {now, h1?}}
// h1 = price one hour ago (sets the 1h move); default = tiny drift.
function pxAt(hist, i, nowSec, ov) {
  const px = {};
  for (const sym of Object.keys(hist)) {
    const days = hist[sym].slice(Math.max(0, i - 70), i + 1).slice().reverse();
    const o = (ov && ov[sym]) || {};
    const nowP = o.now != null ? o.now : days[0].price_close;
    const base = days[0].price_close;
    const hours = [];
    for (let h = 30; h >= 1; h--) {           // ascending build, then reverse
      const t = nowSec - h * HOUR;
      let p = base * (1 + 0.0002 * (30 - h)); // gentle drift, ~flat
      if (h === 1 && o.h1 != null) p = o.h1;
      hours.push(bar(t - HOUR + 60, HOUR - 60, p, p));
    }
    hours.push(bar(nowSec - 30 * 60, 25 * 60, nowP, nowP)); // freshest bar
    px[sym] = { days, hours: hours.slice().reverse() };
  }
  return px;
}
// stable cross fixture: USDC/USDT at price `p`, fresh
const stableAt = (nowSec, p) => ({ pair: "USDC/USDT",
  hours: [bar(nowSec - 30 * 60, 25 * 60, p, p)] });

const freshState = () => ({ fingerprints: {}, stats: {}, driftState: {},
  ddState: { active: false, deepest: 0 },
  depegState: { phase: "armed", dir: null }, bootstrapped: false });

let pass = 0, fail = 0;
const results = [];
function check(name, cond, note) {
  if (cond) { pass++; results.push("PASS  " + name); }
  else { fail++; results.push("FAIL  " + name + (note ? "  [" + note + "]" : "")); }
}
const has = (out, kind, subj) => out.survivors.some((s) =>
  s.kind === kind && (subj == null || s.subject === subj));

const SYMS = [
  { sym: "BTC", beta: 1.0, idioVol: 0.006, p0: 60000 },
  { sym: "ETH", beta: 1.1, idioVol: 0.010, p0: 3000 },
  { sym: "SOL", beta: 1.2, idioVol: 0.015, p0: 150 },
];
const HOLD = [
  { asset: "BTC", name: "BTC", class: "crypto", qty: 0.75 },
  { asset: "ETH", name: "ETH", class: "crypto", qty: 6 },
  { asset: "SOL", name: "SOL", class: "crypto", qty: 160 },
  { asset: "USDT", name: "USDT", class: "stable", qty: 18000 },
];
const CFG = { preset: "normal", BAND: 0.05, CLUSTER: ["BTC", "ETH", "SOL"] };
const TGT = { BTC: 0.40, ETH: 0.25, SOL: 0.20, USDT: 0.15 };
const HIST = genDaily(SYMS, 90, {});
const I = 89, NOWSEC = T0 + I * DAY + DAY + 12 * HOUR, NOW = NOWSEC * 1000;

function run(ov, opts) {
  const o = opts || {};
  const nowSec = o.nowSec || NOWSEC;
  return judgeCryptoBook({
    holdings: o.holdings || HOLD, targets: o.targets || TGT,
    config: o.config || CFG,
    px: o.px || pxAt(o.hist || HIST, I, nowSec, ov),
    stable: o.stable !== undefined ? o.stable : stableAt(nowSec, 1.0001),
    prevPos: o.prevPos || [], win30d: o.win30d || [],
    near24: o.near24 || [], state: o.state || freshState(),
    nowMs: nowSec * 1000, testAlert: o.testAlert === true });
}
const boot = (state) => { run(null, { state }); return state; }; // seed state-kinds

// ── 1. quiet baseline ──
{
  const st = boot(freshState());
  const out = run(null, { state: st });
  check("1.1 quiet on a no-event run", out.survivors.length === 0,
    JSON.stringify(out.survivors.map((s) => s.kind)));
  check("1.2 NAV computed over priced + stable", out.navRow.nav_usd > 0 &&
    out.navRow.stable_ratio > 0.05 && out.navRow.stable_ratio < 0.5);
  check("1.3 market never closes", out.navRow.market_state === "24x7");
  check("1.4 eff_bets present and ≤ risk count", out.navRow.eff_bets != null &&
    out.navRow.eff_bets <= 3.0001);
}
// ── 2. 24h move lane (σ-scaled) ──
{
  const st = boot(freshState());
  const base = HIST.BTC[I].price_close;
  const out = run({ BTC: { now: base * 1.12 } }, { state: st });
  const moved = (o) => o.survivors.some((s) => s.subject === "asset:BTC" &&
    (s.kind === "price_move" || s.kind === "resid_move")) || has(o, "systematic_move");
  check("2.1 12% BTC 24h move alerts (raw or residual voice)", moved(out),
    JSON.stringify(out.survivors.map((s) => s.kind)));
  check("2.1b the flat legs get no laggard-residual alert",
    !out.survivors.some((s) => s.kind === "resid_move" &&
      (s.subject === "asset:ETH" || s.subject === "asset:SOL")),
    JSON.stringify(out.survivors.map((s) => s.subject + ":" + s.kind)));
  const again = run({ BTC: { now: base * 1.12 } }, { state: st });
  check("2.2 same state suppressed on rerun", !moved(again));
  const esc = run({ BTC: { now: base * 1.30 } }, { state: st });
  check("2.3 escalation re-alerts upward", esc.survivors.some((s) =>
    (s.kind === "price_move" || s.kind === "resid_move" || s.kind === "systematic_move") &&
    s.severity === "critical" && s.subject !== "asset:ETH" && s.subject !== "asset:SOL"));
}
// ── 3. 1h fast lane (direction-regime state) ──
{
  const st = boot(freshState());
  const base = HIST.SOL[I].price_close;
  const out = run({ SOL: { now: base * 0.94, h1: base } }, { state: st });
  check("3.1 6% hourly SOL drop alerts fast_move", has(out, "fast_move", "asset:SOL"),
    JSON.stringify(out.survivors.map((s) => s.kind)));
  const again = run({ SOL: { now: base * 0.88, h1: base * 0.94 } }, { state: st });
  check("3.2 sustained slide does not ping hourly", !has(again, "fast_move", "asset:SOL"));
}
// ── 4. stablecoin discipline ──
{
  const st = boot(freshState());
  const out = run(null, { state: st });
  const usdtRow = out.rows.find((r) => r.asset === "USDT");
  check("4.1 stable row unit-priced, never a move subject",
    usdtRow.pricing === "quote_unit" && usdtRow.move_score === null);
  check("4.2 no price_move alert ever targets the stable sleeve",
    !out.candidates.some((c) => c.subject === "asset:USDT" &&
      (c.kind === "price_move" || c.kind === "fast_move")));
}
// ── 5. depeg: two-run confirmation + recovery re-arm ──
{
  const st = boot(freshState());
  const r1 = run(null, { state: st, stable: stableAt(NOWSEC, 0.992) });
  check("5.1 first depeg observation is silent (pending)", !has(r1, "depeg") &&
    st.depegState.phase === "pending");
  const r2 = run(null, { state: st, stable: stableAt(NOWSEC, 0.991) });
  check("5.2 second consecutive run confirms and alerts", has(r2, "depeg"));
  const r3 = run(null, { state: st, stable: stableAt(NOWSEC, 0.9905) });
  check("5.3 active depeg does not re-ping at same severity", !has(r3, "depeg"));
  const r4 = run(null, { state: st, stable: stableAt(NOWSEC, 0.985) });
  check("5.4 crossing 1% escalates to critical", r4.survivors.some((s) =>
    s.kind === "depeg" && s.severity === "critical"));
  run(null, { state: st, stable: stableAt(NOWSEC, 1.0) });           // recovery
  check("5.5 recovery re-arms silently", st.depegState.phase === "armed" &&
    st.fingerprints["portfolio:depeg"].state === "depeg:recovered");
  const r6a = run(null, { state: st, stable: stableAt(NOWSEC, 0.992) });
  const r6b = run(null, { state: st, stable: stableAt(NOWSEC, 0.992) });
  check("5.6 a NEW episode alerts again after recovery", !has(r6a, "depeg") && has(r6b, "depeg"));
  const stale = boot(freshState());
  const r7 = run(null, { state: stale, stable: { pair: "USDC/USDT",
    hours: [bar(NOWSEC - 10 * HOUR, HOUR, 0.99, 0.99)] } });
  check("5.7 a stale stable feed never judges depeg", !has(r7, "depeg") &&
    stale.depegState.phase === "armed");
}
// ── 6. drift bands: hysteresis + re-arm fingerprint transition ──
// Targets are set to the fixture's own baseline weights so the baseline is
// exactly in-band; excursions are then driven by a BTC price move.
{
  const st = boot(freshState());
  const baseline = run(null, { state: boot(freshState()) });
  const tgt = {};
  for (const r of baseline.rows) tgt[r.asset] = r.weight;
  const base = HIST.BTC[I].price_close;
  const r0 = run(null, { state: st, targets: tgt });
  check("6.0 in-band baseline is quiet", !has(r0, "drift"));
  const r1 = run({ BTC: { now: base * 1.6 } }, { state: st, targets: tgt });
  check("6.1 BTC weight breakout alerts drift once",
    r1.survivors.some((s) => s.kind === "drift" && s.subject === "asset:BTC"),
    JSON.stringify(r1.survivors.map((s) => s.subject + ":" + s.kind)));
  const r2 = run({ BTC: { now: base * 1.62 } }, { state: st, targets: tgt });
  check("6.2 still out of band → quiet", !has(r2, "drift"));
  run(null, { state: st, targets: tgt });                 // back to baseline → in-band → re-arm
  check("6.3 re-arm transitions the fingerprint silently",
    st.fingerprints["asset:BTC:drift"] &&
    st.fingerprints["asset:BTC:drift"].state === "drift:BTC:armed",
    JSON.stringify(st.fingerprints["asset:BTC:drift"]));
  const r4a = run({ BTC: { now: base * 1.6 } }, { state: st, targets: tgt });
  check("6.4a re-excursion within 24h is oscillation, suppressed", !has(r4a, "drift"));
  run(null, { state: st, targets: tgt, nowSec: NOWSEC + 25 * HOUR });  // stay armed past 24h
  const r4b = run({ BTC: { now: base * 1.6 } },
    { state: st, targets: tgt, nowSec: NOWSEC + 26 * HOUR });
  check("6.4b second excursion after 24h re-alerts",
    r4b.survivors.some((s) => s.kind === "drift" && s.subject === "asset:BTC"),
    JSON.stringify(st.fingerprints["asset:BTC:drift"]));
}
// ── 7. drawdown episodes ──
{
  const st = boot(freshState());
  const navSeed = run(null, { state: st }).navRow.nav_usd;
  const win = [{ date: NOW - 10 * DAY * 1000, nav_usd: navSeed * 1.13 },
               { date: NOW - 5 * DAY * 1000, nav_usd: navSeed * 1.10 },
               { date: NOW - 1 * DAY * 1000, nav_usd: navSeed * 1.02 }];
  const r1 = run(null, { state: st, win30d: win });
  check("7.1 crossing −10% band alerts entry", r1.survivors.some((s) =>
    s.kind === "drawdown" && s.state.includes(":10:")), JSON.stringify(r1.survivors));
  const r2 = run(null, { state: st, win30d: win });
  check("7.2 same band stays quiet", !has(r2, "drawdown"));
  const winDeep = win.map((w) => ({ ...w, nav_usd: w.nav_usd * 1.10 }));
  const r3 = run(null, { state: st, win30d: winDeep });
  check("7.3 deepening re-alerts", r3.survivors.some((s) => s.kind === "drawdown"));
  const r4 = run(null, { state: st, win30d: [{ date: NOW - 5 * DAY * 1000, nav_usd: navSeed * 0.99 },
    { date: NOW - 3 * DAY * 1000, nav_usd: navSeed }, { date: NOW - DAY * 1000, nav_usd: navSeed }] });
  check("7.4 recovery re-arms the episode", !st.ddState.active &&
    st.fingerprints["portfolio:drawdown"].state === "drawdown_band:0:recovered" && !has(r4, "drawdown"));
}
// ── 8. systematic collapse ──
{
  const st = boot(freshState());
  const ov = {};
  for (const s of SYMS) ov[s.sym] = { now: HIST[s.sym][I].price_close * 0.85 };
  const out = run(ov, { state: st });
  check("8.1 correlated crash collapses to ONE portfolio alert",
    has(out, "systematic_move") &&
    !out.survivors.some((s) => s.kind === "price_move"),
    JSON.stringify(out.survivors.map((s) => s.kind)));
  check("8.2 collapse names every leg", out.survivors.find((s) =>
    s.kind === "systematic_move").headline.includes("SOL"));
}
// ── 9. degradation ──
{
  const st = boot(freshState());
  const px = pxAt(HIST, I, NOWSEC, null);
  px.SOL = { error: "HTTP 500" };
  const prev = run(null, { state: boot(freshState()) }).rows;
  const out = run(null, { state: st, px, prevPos: prev });
  const solRow = out.rows.find((r) => r.asset === "SOL");
  check("9.1 failed fetch carries last price, marked stale",
    solRow.pricing === "carried" && solRow.stale === true && solRow.value_usd > 0);
  check("9.2 no alert fires for the degraded asset",
    !out.survivors.some((s) => s.subject === "asset:SOL"));
  const px2 = pxAt(HIST, I, NOWSEC, null);
  px2.SOL = { error: "HTTP 500" };
  const out2 = run(null, { state: boot(freshState()), px: px2, prevPos: [] });
  const solRow2 = out2.rows.find((r) => r.asset === "SOL");
  check("9.3 no prior price → unpriced, out of NAV, footnoted",
    solRow2.pricing === "unpriced" && solRow2.value_usd === null &&
    out2.navRow.unpriced_count === 1);
  const px3 = pxAt(HIST, I, NOWSEC, null);
  px3.BTC = { days: px3.BTC.days, hours: [] };                        // hourly lane dead
  const out3 = run(null, { state: boot(freshState()), px: px3 });
  const btcRow = out3.rows.find((r) => r.asset === "BTC");
  check("9.4 dead hourly lane degrades to close-only, not a crash",
    btcRow.pricing === "close_only" && btcRow.fast_score === null && btcRow.price > 0);
}
// ── 10. bootstrap seeding ──
{
  const st = freshState();                       // NOT booted
  const navProbe = run(null, { state: boot(freshState()) }).navRow.nav_usd;
  const win = [{ date: NOW - 10 * DAY * 1000, nav_usd: navProbe * 1.2 },
               { date: NOW - 5 * DAY * 1000, nav_usd: navProbe * 1.15 },
               { date: NOW - 1 * DAY * 1000, nav_usd: navProbe * 1.05 }];
  const out = run(null, { state: st, win30d: win });
  check("10.1 first run seeds state-kinds without alerting",
    !out.survivors.some((s) => ["drawdown", "concentration", "drift", "depeg"].includes(s.kind)) &&
    st.fingerprints["portfolio:drawdown"] != null,
    JSON.stringify({ surv: out.survivors.map((s) => s.kind), fp: Object.keys(st.fingerprints) }));
}
// ── 11. test-alert plumbing ──
{
  const st = boot(freshState());
  const out = run(null, { state: st, testAlert: true });
  check("11.1 test alert passes exactly once", has(out, "test"));
  const again = run(null, { state: st, testAlert: true });
  check("11.2 test alert repeat suppressed", !has(again, "test"));
}

console.log(results.join("\n"));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
