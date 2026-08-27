// Offline test suite for the shared judgment module (platform bar format).
// Run: node demo-ashare/test/run-tests.js
// Deterministic fixtures (seeded LCG) — no Math.random, no Date.now.
"use strict";
const { judgeAshare } = require("../judgment");

// ── fixtures ──
const DAY = 86400, T0 = 1750000000;
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function gauss(rnd) { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) * Math.sqrt(2); }
const iso = (sec) => new Date(sec * 1000).toISOString();

// n ascending daily bars per symbol; common factor + idio; events[{idx:{SYM:ret}}]
function genDaily(symbols, n, opts) {
  const { seed = 42, factorVol = 0.015, events = {} } = opts || {};
  const rnd = lcg(seed);
  const out = {}, px = {};
  for (const s of symbols) { out[s.sym] = []; px[s.sym] = s.p0 || 100; }
  for (let i = 0; i < n; i++) {
    const f = gauss(rnd) * factorVol;
    for (const s of symbols) {
      let r = s.beta * f + gauss(rnd) * s.idioVol;
      if (events[i] && events[i][s.sym] != null) r = events[i][s.sym];
      const open = px[s.sym];
      px[s.sym] *= 1 + r;
      const tOpen = T0 + i * DAY + 3600, tClose = T0 + i * DAY + 7 * 3600;
      out[s.sym].push({ time_open: tOpen, time_close: tClose,
        time_period_start: iso(tOpen), time_period_end: iso(tClose),
        price_open: open, price_close: px[s.sym],
        volume_traded: 1e6 * (1 + Math.abs(gauss(rnd)) * 0.3) * ((events[i] && events[i]["_vol_" + s.sym]) || 1) });
    }
  }
  return out;
}
// judge market view at ascending index i; liveOverrides: sym -> {close, open?}
function eqAt(hist, i, liveOverrides) {
  const eq = {};
  for (const sym of Object.keys(hist)) {
    const days = hist[sym].slice(Math.max(0, i - 70), i + 1).slice().reverse();
    let rth = [];
    const ov = liveOverrides && liveOverrides[sym];
    if (ov != null) {
      const o = typeof ov === "number" ? { close: ov } : ov;
      const t = days[0].time_close + DAY;
      rth = [{ time_open: t, time_close: t + 1800,
        time_period_start: iso(t), time_period_end: iso(t + 1800),
        price_open: o.open != null ? o.open : days[0].price_close,
        price_close: o.close, volume_traded: 1e5 }];
    }
    eq[sym] = { days, rth };
  }
  return eq;
}
const freshState = () => ({ fingerprints: {}, stats: {}, closeWm: {}, gapWm: {},
  driftState: {}, ddState: { active: false, deepest: 0 }, bootstrapped: false });

let pass = 0, fail = 0;
const results = [];
function check(name, cond, note) {
  if (cond) { pass++; results.push("PASS  " + name); }
  else { fail++; results.push("FAIL  " + name + (note ? "  [" + note + "]" : "")); }
}
const has = (out, kind, sym) => out.survivors.some((s) =>
  s.kind === kind && (sym == null || s.subject === "asset:" + sym));

const SYMS = [
  { sym: "300100.SZ", beta: 1.0, idioVol: 0.008, p0: 100 },
  { sym: "300200.SZ", beta: 1.0, idioVol: 0.008, p0: 50 },
  { sym: "300300.SZ", beta: 1.0, idioVol: 0.008, p0: 80 },
  { sym: "600500.SS", beta: 0.2, idioVol: 0.010, p0: 1500 },
];
const HOLD = [
  { asset: "300100.SZ", name_zh: "甲", class: "equity", qty: 3000 },
  { asset: "300200.SZ", name_zh: "乙", class: "equity", qty: 1000 },
  { asset: "300300.SZ", name_zh: "丙", class: "equity", qty: 1000 },
  { asset: "600500.SS", name_zh: "丁", class: "equity", qty: 100 },
  { asset: "CASH", name_zh: "现金", class: "cash", qty: 660000 },
];
const CFG = { preset: "normal", BAND: 0.05, CLUSTER: ["300100.SZ", "300200.SZ", "300300.SZ"] };
const TGT = { "300100.SZ": 0.5, "300200.SZ": 0.1, "300300.SZ": 0.1, "600500.SS": 0.05, CASH: 0.25 };
const N = 120, LAST = N - 1;
const run = (eq, state, nowMs, over) => judgeAshare({
  holdings: (over && over.holdings) || HOLD, targets: TGT,
  config: (over && over.config) || CFG, eq,
  prevPos: (over && over.prevPos) || [], win30d: (over && over.win30d) || [],
  near24: [], state, nowMs, testAlert: false });
const tClose = (hist, i) => (hist["300100.SZ"][i].time_close + 3600) * 1000;

// A1: quiet day quiet; bootstrap seeds state kinds silently
{
  const hist = genDaily(SYMS, N, { seed: 42 });
  const st = freshState();
  const r1 = run(eqAt(hist, LAST - 1), st, tClose(hist, LAST - 1));
  check("A1a bootstrap seeds concentration/drift silently", !has(r1, "concentration") && !has(r1, "drift"));
  const r2 = run(eqAt(hist, LAST), r1.state, tClose(hist, LAST));
  check("A1b ordinary day: zero warning/critical", r2.survivors.filter((s) => s.severity !== "info").length === 0,
    JSON.stringify(r2.survivors.map((s) => s.kind)));
}
// A2: limit-down critical, no double price_move
{
  const hist = genDaily(SYMS, N, { seed: 42, events: { [LAST]: { "300100.SZ": -0.198 } } });
  const r = run(eqAt(hist, LAST), freshState(), tClose(hist, LAST));
  check("A2a limit_hit critical", r.survivors.some((s) => s.kind === "limit_hit" && s.severity === "critical"));
  check("A2b no separate price_move for the limit name", !has(r, "price_move", "300100.SZ"));
}
// A3: ex-div beyond limit = corporate action; tier paused; sigma clean
{
  const hist = genDaily(SYMS, N, { seed: 42, events: { [LAST]: { "300100.SZ": -0.25 } } });
  const st = freshState();
  const b = run(eqAt(hist, LAST - 1), st, tClose(hist, LAST - 1));
  const r = run(eqAt(hist, LAST), b.state, tClose(hist, LAST));
  check("A3a corporate_action (info)", r.survivors.some((s) => s.kind === "corporate_action" && s.severity === "info"));
  check("A3b not limit_hit / price_move", !has(r, "limit_hit", "300100.SZ") && !has(r, "price_move", "300100.SZ"));
  check("A3c portfolio tier paused on CA day", !has(r, "drift") && !has(r, "drawdown") && !has(r, "concentration"));
  for (const k of Object.keys(r.state.stats)) r.state.stats[k].at = 0;
  const hist2 = genDaily(SYMS, N + 1, { seed: 42, events: { [LAST]: { "300100.SZ": -0.25 } } });
  const r2 = run(eqAt(hist2, LAST + 1), r.state, tClose(hist2, LAST + 1));
  const sg = r2.state.stats["300100.SZ"].sigma;
  check("A3d sigma un-poisoned by the CA day", sg != null && sg < 0.04, "sigma=" + (sg && sg.toFixed(4)));
}
// A4: drift hysteresis + novelty regression (FIX 3)
{
  const one = [{ sym: "300100.SZ", beta: 0, idioVol: 0.008, p0: 100 }];
  const hist = genDaily(one, N, { seed: 9 });
  const px = hist["300100.SZ"][LAST].price_close;
  const NAV = 200000;
  const holdW = (w) => [
    { asset: "300100.SZ", name_zh: "甲", class: "equity", qty: (w * NAV) / px },
    { asset: "CASH", name_zh: "现金", class: "cash", qty: (1 - w) * NAV }];
  const cfg = { preset: "normal", BAND: 0.05, CLUSTER: [] };
  const tg = { "300100.SZ": 0.5 };
  const eq = eqAt(hist, LAST);
  const t = tClose(hist, LAST), H = 3600e3;
  const J = (w, st2, tt) => judgeAshare({ holdings: holdW(w), targets: tg, config: cfg,
    eq, prevPos: [], win30d: [], near24: [], state: st2, nowMs: tt, testAlert: false });
  let st = J(0.50, freshState(), t).state;
  const r1 = J(0.57, st, t + 1 * H); st = r1.state;
  check("A4a first excursion fires drift", has(r1, "drift"));
  const r2 = J(0.545, st, t + 2 * H); st = r2.state;
  const r3 = J(0.57, st, t + 3 * H); st = r3.state;
  check("A4b band-edge flap suppressed", !has(r2, "drift") && !has(r3, "drift"));
  const r4 = J(0.52, st, t + 4 * H); st = r4.state;
  check("A4c re-arm is silent", r4.survivors.length === 0);
  const r5 = J(0.57, st, t + 30 * H); st = r5.state;
  check("A4d REGRESSION: re-alert after re-arm (deployed logic suppressed forever)", has(r5, "drift"));
  const r6 = J(0.52, st, t + 31 * H); st = r6.state;
  const r7 = J(0.57, st, t + 32 * H);
  check("A4e rapid flap still killed by 24h oscillation rule", !has(r7, "drift"));
}
// A5: cluster co-move collapses to one systematic alert
{
  const hist = genDaily(SYMS, N, { seed: 42, events: {
    [LAST]: { "300100.SZ": -0.08, "300200.SZ": -0.078, "300300.SZ": -0.082 } } });
  const r = run(eqAt(hist, LAST), freshState(), tClose(hist, LAST));
  check("A5a exactly one systematic_move", r.survivors.filter((s) => s.kind === "systematic_move").length === 1,
    JSON.stringify(r.survivors.map((s) => s.kind)));
  check("A5b no per-ticker price_move for cluster names",
    !has(r, "price_move", "300100.SZ") && !has(r, "price_move", "300200.SZ") && !has(r, "price_move", "300300.SZ"));
}
// A6: close-run residual (FIX 2) — one name alone → resid, raw superseded
{
  const hist = genDaily(SYMS, N, { seed: 42, events: { [LAST]: { "300100.SZ": -0.08 } } });
  const r = run(eqAt(hist, LAST), freshState(), tClose(hist, LAST));
  check("A6a close-run resid_move fires", has(r, "resid_move", "300100.SZ"));
  check("A6b raw close move superseded", !has(r, "price_move", "300100.SZ"));
}
// A7: gap ex-div guard (FIX 5) — −25% open gap is a CA, not a gap alert
{
  const one = [{ sym: "300100.SZ", beta: 0, idioVol: 0.008, p0: 100 }];
  const hist = genDaily(one, N, { seed: 11 });
  const prior = hist["300100.SZ"][LAST].price_close;
  const eq = eqAt(hist, LAST, { "300100.SZ": { open: prior * 0.75, close: prior * 0.752 } });
  const t = (eq["300100.SZ"].rth[0].time_close + 60) * 1000;
  const r = judgeAshare({ holdings: [{ asset: "300100.SZ", name_zh: "甲", class: "equity", qty: 100 }],
    targets: {}, config: { preset: "normal", BAND: 0.05, CLUSTER: [] }, eq,
    prevPos: [], win30d: [], near24: [], state: freshState(), nowMs: t, testAlert: false });
  check("A7a ex-div morning: NO gap alert", !has(r, "gap", "300100.SZ"));
  check("A7b reported as corporate_action instead", r.survivors.some((s) => s.kind === "corporate_action"));
  // sane gap still fires, once
  const eq2 = eqAt(hist, LAST, { "300100.SZ": { open: prior * 1.05, close: prior * 1.049 } });
  const t2 = (eq2["300100.SZ"].rth[0].time_close + 60) * 1000;
  const st2 = freshState();
  const g1 = judgeAshare({ holdings: [{ asset: "300100.SZ", name_zh: "甲", class: "equity", qty: 100 }],
    targets: {}, config: { preset: "normal", BAND: 0.05, CLUSTER: [] }, eq: eq2,
    prevPos: [], win30d: [], near24: [], state: st2, nowMs: t2, testAlert: false });
  check("A7c genuine gap fires", has(g1, "gap", "300100.SZ"));
  const g2 = judgeAshare({ holdings: [{ asset: "300100.SZ", name_zh: "甲", class: "equity", qty: 100 }],
    targets: {}, config: { preset: "normal", BAND: 0.05, CLUSTER: [] }, eq: eq2,
    prevPos: [], win30d: [], near24: [], state: g1.state, nowMs: t2 + 1800e3, testAlert: false });
  check("A7d gap judged once per session", !has(g2, "gap", "300100.SZ"));
}
// A8: novelty dedup — identical repeat suppressed, new state passes
{
  const hist = genDaily(SYMS, N, { seed: 42 });
  const prior = hist["300100.SZ"][LAST].price_close;
  const mk = (mult) => eqAt(hist, LAST, { "300100.SZ": prior * mult });
  const tl = (eq) => (eq["300100.SZ"].rth[0].time_close + 60) * 1000;
  const m1 = mk(1.055);
  const r1 = run(m1, freshState(), tl(m1));
  check("A8a 3σ intraday move fires", has(r1, "price_move", "300100.SZ") || has(r1, "resid_move", "300100.SZ"));
  const r2 = run(m1, r1.state, tl(m1) + 1500e3);
  check("A8b identical repeat suppressed", !has(r2, "price_move", "300100.SZ") && !has(r2, "resid_move", "300100.SZ"));
}
// A9: degraded symbol — carried via prevPos, no alerts for it
{
  const hist = genDaily(SYMS, N, { seed: 42 });
  const st = freshState();
  const r1 = run(eqAt(hist, LAST - 1), st, tClose(hist, LAST - 1));
  const eq = eqAt(hist, LAST);
  eq["300100.SZ"] = { error: "HTTP 500" };
  const r2 = run(eq, r1.state, tClose(hist, LAST), { prevPos: r1.rows });
  const row = r2.rows.find((r) => r.asset === "300100.SZ");
  check("A9a carried price, marked stale", row.pricing === "carried" && row.stale === true && row.value_cny != null);
  check("A9b no candidates for the degraded symbol", !r2.candidates.some((c) => c.subject === "asset:300100.SZ"));
  check("A9c portfolio tier paused (stale majority of NAV)", !has(r2, "drift") && !has(r2, "drawdown") && !has(r2, "concentration"));
}

console.log(results.join("\n"));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
