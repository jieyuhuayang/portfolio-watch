// portfolio-watch-crypto-book — PURE JUDGMENT MODULE.
// Second asset instantiation of the shared-judgment architecture proven in
// demo-ashare/judgment.js: one function owns every market-judgment rule; the
// live producer and the offline test suite call the same bytes.
//
// Crypto semantics replacing the A-share ones:
//   - 24/7: every run judges; no session gate, no close watermark. The fast
//     lane is the 1h bar; the slow lane is the rolling-24h change.
//   - no limit-up/down, no ex-div guard, no T+1 language.
//   - depeg (Tier B): watched on the stable cross (USDC/USDT), two-run
//     confirmation before alerting, silent fingerprint re-arm on recovery.
//   - σ base: 20 calendar-day daily σ (population, per the data skill's
//     own volatility guidance); fast σ: 7-day hourly σ.
//   - drawdown episodes carry state (entry/deepen/recovery re-arm) — this
//     fixes the v2 crypto demo's recorded blind spot (DESIGN §15).
//   - bars: platform crypto kline format — RFC 3339 time strings
//     (time_open/time_close), price_*, volume; reverse chronological.
//
// No platform imports, no Date.now(), no I/O — testable anywhere.
"use strict";

const PRESETS = {
  //           24h move   1h fast
  calm:      { k: 4,      kFast: 6 },
  normal:    { k: 3,      kFast: 5 },
  sensitive: { k: 2,      kFast: 4 },
};
const SEV_RANK = { info: 0, warning: 1, critical: 2, "action-needed": 2 };
const STATE_KINDS = { drift: 1, drawdown: 1, concentration: 1, depeg: 1 };
const FRESH_MS = 2 * 3600e3;          // hourly lane considered live within 2h
const DEPEG_ENTER = 0.005, DEPEG_CRIT = 0.01, DEPEG_EXIT = 0.003;

const ts = (bar, f) => Date.parse(bar[f]);          // RFC 3339 → ms
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stdevP = (a) => {                              // population σ (÷N)
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
};
function rets(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}
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

// inputs: { holdings, targets, config:{preset,BAND,CLUSTER}, px, stable,
//           prevPos, win30d, near24, state, nowMs, testAlert }
//   holdings: [{asset, name?, class:"crypto"|"stable", qty}]
//   px: SYM -> { days, hours } (platform bars, reverse chrono; hours may be
//               [] → close-only degradation) or { error }
//   stable: { pair, hours } | { error } | null — depeg watch cross
// returns: { rows, navRow, candidates, survivors, state }
function judgeCryptoBook(inp) {
  const { holdings, px, prevPos, win30d, near24, nowMs } = inp;
  const targets = inp.targets || {};
  const preset = PRESETS[(inp.config && inp.config.preset) || "normal"] || PRESETS.normal;
  const BAND = inp.config && inp.config.BAND != null ? inp.config.BAND : 0.05;
  const CLUSTER = (inp.config && inp.config.CLUSTER) || [];
  const st = inp.state;
  const fingerprints = st.fingerprints, stats = st.stats,
    driftState = st.driftState, ddState = st.ddState;
  const depegState = st.depegState || (st.depegState = { phase: "armed", dir: null });
  const bootstrapped = st.bootstrapped;

  // ── Pass 1: per-symbol daily return series (cluster residuals need all) ──
  for (const sym of Object.keys(px)) {
    const E = px[sym];
    if (E.error || E.retsAll) continue;
    E.retsAll = rets(E.days.map((b) => b.price_close).reverse()).slice(-60);
  }

  // ── Pass 2: per-asset stats + candidates ──
  const rows = [];
  const candidates = [];
  for (const h of holdings) {
    const sym = String(h.asset).toUpperCase();
    const qty = Number(h.qty);
    const tgt = targets[sym] != null ? targets[sym] : null;
    const name = h.name || sym;
    if (h.class === "stable") {
      // Stablecoin sleeve: unit-priced (USDT≈USD, labeled), in NAV, never a
      // price-move subject; its risk voice is the portfolio-level depeg watch.
      rows.push({ asset: sym, name, asset_class: "stable", pair: null,
        qty, price: 1, value_usd: qty, weight: null, target_weight: tgt,
        chg_24h: 0, chg_1h: 0, beta: null, resid_chg: null, resid_score: null,
        move_score: null, fast_score: null, pricing: "quote_unit",
        stale: false, asof_price: new Date(nowMs).toISOString() });
      continue;
    }
    const E = px[sym];
    if (!E.error && (!E.days || E.days.length < 2)) E.error = "insufficient daily history";
    if (E.error) {
      const prev = prevPos.find((p) => p.asset === sym);
      if (prev && prev.price != null && prev.pricing !== "unpriced") {
        rows.push({ ...prev, qty, value_usd: qty * prev.price, chg_24h: null,
          chg_1h: null, resid_chg: null, resid_score: null, move_score: null,
          fast_score: null, pricing: "carried", stale: true });
      } else {
        rows.push({ asset: sym, name, asset_class: "crypto", pair: null,
          qty, price: null, value_usd: null, weight: null, target_weight: tgt,
          chg_24h: null, chg_1h: null, beta: null, resid_chg: null,
          resid_score: null, move_score: null, fast_score: null,
          pricing: "unpriced", stale: true, asof_price: null });
      }
      continue;
    }
    const { days, hours } = E;
    const peers = CLUSTER.filter((s2) => s2 !== sym && px[s2] && !px[s2].error);
    const inCluster = CLUSTER.includes(sym) && peers.length >= 1;
    let s = stats[sym];
    if (!s || nowMs - s.at > 20 * 3600e3) {
      let b = null, residSigma = null;
      if (inCluster) {
        const n = Math.min(...peers.map((p) => px[p].retsAll.length), E.retsAll.length);
        const benchRets = [];
        for (let i = 0; i < n; i++) {
          let acc = 0;
          for (const p of peers) acc += px[p].retsAll[px[p].retsAll.length - n + i];
          benchRets.push(acc / peers.length);
        }
        const my = E.retsAll.slice(-n);
        b = betaOf(my, benchRets);
        if (b != null) {
          const resid = [];
          for (let i = 0; i < n; i++) resid.push(my[i] - b * benchRets[i]);
          residSigma = stdevP(resid);
        }
      }
      const hourRets = hours.length >= 30
        ? rets(hours.slice(0, 168).map((b2) => b2.price_close).reverse()) : [];
      s = { sigma: stdevP(E.retsAll.slice(-20)),
            sigma1h: hourRets.length ? stdevP(hourRets) : null,
            beta: b, resid_sigma: residSigma, at: nowMs };
      stats[sym] = s;
    }
    // fast lane live? (a stale hourly feed degrades to close-only, visibly)
    const live = hours.length > 0 && nowMs - ts(hours[0], "time_close") < FRESH_MS;
    const price = live ? hours[0].price_close : days[0].price_close;
    const asofTs = live ? hours[0].time_close : days[0].time_close;

    // rolling-24h anchor: the hourly close nearest now−24h (±3h tolerance);
    // fallback = prior UTC daily close, honestly a different anchor
    let anchor = null;
    if (live && hours.length > 20) {
      const want = nowMs - 24 * 3600e3;
      let best = null, bestD = Infinity;
      for (const b2 of hours) {
        const d = Math.abs(ts(b2, "time_close") - want);
        if (d < bestD) { bestD = d; best = b2; }
      }
      if (best && bestD <= 3 * 3600e3) anchor = best.price_close;
    }
    const chg24 = anchor != null ? price / anchor - 1
      : days.length > 1 ? price / days[1].price_close - 1 : null;
    const chg1h = live && hours.length > 1 ? hours[0].price_close / hours[1].price_close - 1 : null;
    const mScore = chg24 != null && s.sigma ? Math.abs(chg24) / s.sigma : null;
    const fScore = chg1h != null && s.sigma1h ? Math.abs(chg1h) / s.sigma1h : null;

    // residual of the 24h move vs leave-one-out cluster mean
    let residChg = null, residScore = null;
    if (inCluster && s.beta != null && s.resid_sigma && chg24 != null) {
      let acc = 0, cnt = 0;
      for (const p of peers) {
        const pe = px[p];
        const pLive = pe.hours.length > 0 && nowMs - ts(pe.hours[0], "time_close") < FRESH_MS;
        const pPrice = pLive ? pe.hours[0].price_close : pe.days[0].price_close;
        let pAnchor = null;
        if (pLive && pe.hours.length > 20) {
          const want = nowMs - 24 * 3600e3;
          let best = null, bestD = Infinity;
          for (const b2 of pe.hours) {
            const d = Math.abs(ts(b2, "time_close") - want);
            if (d < bestD) { bestD = d; best = b2; }
          }
          if (best && bestD <= 3 * 3600e3) pAnchor = best.price_close;
        }
        const pChg = pAnchor != null ? pPrice / pAnchor - 1
          : pe.days.length > 1 ? pPrice / pe.days[1].price_close - 1 : null;
        if (pChg != null) { acc += pChg; cnt++; }
      }
      if (cnt) {
        const benchChg = acc / cnt;
        residChg = chg24 - s.beta * benchChg;
        residScore = Math.abs(residChg) / s.resid_sigma;
      }
    }

    // (a) 24h σ-scaled move — the slow lane
    if (mScore != null && mScore >= preset.k) {
      candidates.push({ subject: "asset:" + sym, kind: "price_move",
        _cluster: inCluster, _dir: chg24 > 0 ? 1 : -1,
        state: "move24:" + (chg24 > 0 ? "up" : "down") + "-" + Math.floor(mScore) + "sigma",
        severity: mScore >= 2 * preset.k ? "critical" : "warning",
        evidence_ts: asofTs,
        headline: name + " 24小时" + (chg24 > 0 ? "涨" : "跌") + (Math.abs(chg24) * 100).toFixed(1) +
          "% (" + mScore.toFixed(1) + "× 其 20 日 σ)",
        detail: "Decision: 看敞口面板 — 是大盘在动还是它自己在动？对照目标带与回撤限额。" });
    }
    // (b) 1h fast move — the 24/7 fast lane; direction-regime state so a
    // sustained slide alerts once, not hourly (the 24h/drawdown tiers own it)
    if (fScore != null && fScore >= preset.kFast) {
      candidates.push({ subject: "asset:" + sym, kind: "fast_move",
        state: "fast:" + (chg1h > 0 ? "up" : "down"),
        severity: fScore >= 1.5 * preset.kFast ? "critical" : "warning",
        evidence_ts: asofTs,
        headline: name + " 1小时" + (chg1h > 0 ? "急涨" : "急跌") + (Math.abs(chg1h) * 100).toFixed(1) +
          "% (" + fScore.toFixed(1) + "× 其 7 日小时 σ)",
        detail: "Decision: 快速行情 — 先查是否有事件（爆仓潮/新闻），再对照风险限额；不要追着每根K线反应。" });
    }
    // (c) residual — its own move, market beta subtracted. Gated on the
    // asset itself having moved (≥1σ raw): an asset that sat still while
    // the market ran has a large residual but no news of its own — without
    // this gate one mover produces N−1 "laggard" alerts, which is exactly
    // the exposure-not-tickers failure the residual voice exists to fix.
    if (residScore != null && residScore >= preset.k && mScore != null && mScore >= 1) {
      candidates.push({ subject: "asset:" + sym, kind: "resid_move",
        state: "resid:" + (residChg > 0 ? "up" : "down") + "-" + Math.floor(residScore) + "sigma",
        severity: residScore >= 2 * preset.k ? "critical" : "warning",
        evidence_ts: asofTs,
        headline: name + " 扣除大盘 β 后残差 " + (residChg * 100).toFixed(1) + "% (" +
          residScore.toFixed(1) + "× 残差 σ) — 这是它自己的行情",
        detail: "Decision: 重新检查你的 " + name + " 论点；这不是大盘联动。" });
    }
    rows.push({ asset: sym, name, asset_class: "crypto", pair: sym + "/USDT",
      qty, price, value_usd: qty * price, weight: null, target_weight: tgt,
      chg_24h: chg24, chg_1h: chg1h, beta: s.beta, resid_chg: residChg,
      resid_score: residScore, move_score: mScore, fast_score: fScore,
      pricing: live ? "direct" : "close_only", stale: !live && days.length === 0,
      asof_price: asofTs });
  }

  // ── Aggregates ──
  const priced = rows.filter((r) => r.value_usd != null);
  const nav = priced.reduce((a, r) => a + r.value_usd, 0);
  for (const r of rows) r.weight = r.value_usd != null && nav > 0 ? r.value_usd / nav : null;
  const risk = rows.filter((r) => r.asset_class === "crypto" && r.weight != null);
  const riskSum = risk.reduce((a, r) => a + r.weight, 0);
  const effBets = riskSum > 0 ? 1 / risk.reduce((a, r) => a + (r.weight / riskSum) ** 2, 0) : null;
  const clusterSyms = CLUSTER.filter((s2) => px[s2] && !px[s2].error);
  let corrSum = 0, corrN = 0;
  for (let i = 0; i < clusterSyms.length; i++)
    for (let j = i + 1; j < clusterSyms.length; j++) {
      const c = corrOf(px[clusterSyms[i]].retsAll, px[clusterSyms[j]].retsAll);
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
    stable_ratio: nav > 0 ? rows.filter((r) => r.asset_class === "stable").reduce((a, r) => a + (r.value_usd || 0), 0) / nav : null,
    top_weight: Math.max(0, ...risk.map((r) => r.weight)),
    eff_bets: effBets, avg_corr: avgCorr,
    unpriced_count: rows.filter((r) => r.pricing === "unpriced").length,
    stale_count: staleCount,
    market_state: "24x7", run_kind: "hourly",
  };

  // ── Depeg watch (portfolio tier, two-run confirmation, hysteresis) ──
  const sx = inp.stable;
  if (sx && !sx.error && sx.hours && sx.hours.length > 0 &&
      nowMs - ts(sx.hours[0], "time_close") < FRESH_MS) {
    const dev = sx.hours[0].price_close - 1;
    const dir = dev > 0 ? "up" : "down";
    if (Math.abs(dev) >= DEPEG_ENTER) {
      if (depegState.phase === "armed") {
        depegState.phase = "pending"; depegState.dir = dir;   // run 1: observe, don't alert
      } else if (depegState.phase === "pending" || depegState.phase === "active") {
        candidates.push({ subject: "portfolio", kind: "depeg",
          state: "depeg:active:" + dir,
          severity: Math.abs(dev) >= DEPEG_CRIT ? "critical" : "warning",
          evidence_ts: sx.hours[0].time_close,
          headline: "稳定币交叉盘 " + sx.pair + " 偏离 1.0 达 " + (dev * 100).toFixed(2) +
            "%（连续两次确认）— 你的稳定币仓位可能正在脱锚",
          detail: "Decision: 核实是 " + sx.pair.split("/")[0] + " 还是 " + sx.pair.split("/")[1] +
            " 在脱锚（交叉盘无法区分方向）；检查稳定币仓位的赎回渠道。" });
        depegState.phase = "active"; depegState.dir = dir;
      }
    } else if (Math.abs(dev) < DEPEG_EXIT && depegState.phase !== "armed") {
      depegState.phase = "armed"; depegState.dir = null;
      // silent fingerprint re-arm (same class as drawdown-recovery FIX)
      if (fingerprints["portfolio:depeg"]) fingerprints["portfolio:depeg"] = {
        state: "depeg:recovered", prev_state: fingerprints["portfolio:depeg"].state,
        severity: "info", ts: nowMs };
    }
  }

  // ── Portfolio-tier candidates (suppressed when half-blind) ──
  if (staleNavShare <= 0.5) {
    const REARM = 0.01;
    for (const r of rows) {
      if (r.target_weight == null || r.weight == null || r.stale) continue;
      const dev = r.weight - r.target_weight;
      const out = dev > BAND ? "over" : dev < -BAND ? "under" : null;
      const dst = driftState[r.asset] || "armed";
      if (out && dst === "armed") {
        candidates.push({ subject: "asset:" + r.asset, kind: "drift",
          state: "drift:" + r.asset + ":" + out, severity: "info",
          evidence_ts: new Date(nowMs).toISOString(),
          headline: (r.name || r.asset) + " 仓位 " + (r.weight * 100).toFixed(1) + "% 超出你的 " +
            (r.target_weight * 100).toFixed(0) + "% ± " + (BAND * 100).toFixed(0) + "pp 目标带",
          detail: "Decision: 再平衡决策点 — 这条带是你自己设的。" });
        driftState[r.asset] = out;
      } else if (!out && dst !== "armed" && Math.abs(dev) <= BAND - REARM) {
        driftState[r.asset] = "armed";
        const fk = "asset:" + r.asset + ":drift";
        if (fingerprints[fk]) fingerprints[fk] = {
          state: "drift:" + r.asset + ":armed",
          prev_state: fingerprints[fk].state, severity: "info", ts: nowMs };
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
        if (fingerprints["portfolio:drawdown"]) fingerprints["portfolio:drawdown"] = {
          state: "drawdown_band:0:recovered",
          prev_state: fingerprints["portfolio:drawdown"].state,
          severity: "info", ts: nowMs };
      }
    }
    if (effBets != null && effBets < 2.0) {
      candidates.push({ subject: "portfolio", kind: "concentration",
        state: "eff_bets:below-2", severity: "info",
        evidence_ts: new Date(nowMs).toISOString(),
        headline: "有效押注数 " + effBets.toFixed(1) + " — " + risk.length +
          " 个风险仓位实际上不足两个独立押注",
        detail: "Decision: 分散度检查 — 加密资产的高相关性在做集中化，不只是仓位。" });
    }
    // systematic collapse over the crypto cluster
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
          headline: "加密大盘联动（" + names.join("、") + "）同向" + (dirs[0] > 0 ? "上涨" : "下跌") +
            "（组合内相关性 " + avgCorr.toFixed(2) + "）" +
            (maxResid != null ? "；最大个币残差 " + maxResid.toFixed(1) + "σ — " +
              (maxResid < preset.k ? "无个体新闻" : "另有个币行情，单独通知") : ""),
          detail: "Decision: 这是一次大盘事件，不是 " + names.length + " 个信号 — 看回撤限额，不是逐币反应。" });
      }
    }
    for (const rc of candidates.filter((c) => c.kind === "resid_move")) {
      const raw = candidates.find((c) => c._cluster && c.subject === rc.subject);
      if (raw) candidates.splice(candidates.indexOf(raw), 1);
    }
  }
  if (inp.testAlert === true) {
    candidates.push({ subject: "system", kind: "test", state: "test-delivery",
      severity: "info", evidence_ts: new Date(nowMs).toISOString(),
      headline: "Test alert — delivery chain verification",
      detail: "Sent once to prove the pipeline; the novelty gate suppresses repeats." });
  }

  // ── Novelty gate + bootstrap seeding (identical to the A-share engine) ──
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
  st.bootstrapped = true;

  return { rows, navRow, candidates, survivors, state: st };
}

if (typeof module !== "undefined" && module.exports)
  module.exports = { judgeCryptoBook, PRESETS, SEV_RANK, rets, mean, stdevP };
