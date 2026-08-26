# Equity Watchlist Demo — Live E2E Log (2026-08-26, UTC)

Input sentence (the assignment's literal example, verbatim):
**"keep an eye on my NVDA, TSLA, and AAPL, ping me when something big happens."**
Mode: bare watchlist (no account connected, no quantities) — rung C′,
**zero blocking questions**. Account `lx79d` (pro). Skill: portfolio-watch v3.

| Time (UTC) | Step | Evidence |
|---|---|---|
| 07:15 | Preflight: whoami (pro, `active_im_provider` empty → web delivery), deploy/automation list (no existing watch), credits 32,993 | 01, 02 |
| 07:16 | Fresh endpoint discovery: `data-skills list → summary → endpoint` for US stock kline + earnings-calendar; jagent smoke test of both endpoints (NVDA daily 28 bars, intraday OK, earnings row **2026-08-26 amc — report day is today**) | §7 of `references/asset-equity.md` |
| 07:21 | Producer + watchlist.json + config.json written to ALFS (`~/feeds/portfolio-watch-equity-demo/v1/`) | 03, 04 |
| 07:23 | **Manual run 1** (`alva run`, non-delivering): 3 tickers priced direct, qty/value/weight all null, baselines seeded (perf_index 100), run_kind `close` (data-driven watermark judged the latest completed close), **one real alert: "NVDA reports earnings today (after market close)"** → alerts/log + digest 1/1 | 05, 06, 07 |
| 07:24 | **Manual run 2**: read run 1's history; novelty gate suppressed the repeat (alert counts unchanged 1/1; pulse series 2 rows) | — |
| 07:25 | **Failure injection**: ZZZFAKE added to watchlist → `unpriced/stale`, no price, no judgment, **no alert** (counts still 1/1); watchlist restored | 05 pattern |
| 07:25 | `deploy create` → cronjob **32183**, cron `*/30 13-21 * * 1-5` UTC (ET session window; deploy cron verified timezone-flag-less → UTC encoding, DST drift absorbed by the in-producer data-driven session gate), `push_notify: true` | 08 |
| 07:25 | `automation publish` → feed **27821**; owner ACTIVE binding auto-created (ch 5025); default first run: green **and quiet** (digest still 1 — the gate held under production delivery semantics) | 09 |
| 07:26 | **Four delivery gates verified individually**: declared alertOutput ✓ / push_notify ✓ / ACTIVE owner binding ✓ / delivery routing isEnabled → alva channel 5025 ✓ | 08, 09, 10 |
| 07:26 | Test delivery attempt #1: args `{"test_alert":true}` → trigger (run 25821036) → digest row written | 07, 15 |
| 07:30–07:33 | Playbook: watchlist-variant `index.html` + README → ALFS; **`alva lint playbook`: 0/0/0**; draft (playbook 8983); public release blocked by **412 FAILED_PRECONDITION** (private feed bundled into public playbook — a good platform gate); watchlist feed holds no wealth data → `feed set-visibility public` → **released v1.0.0** | 11, 12, 13 |
| 07:33 | `config.json` gains `playbook_url` → digests now carry the **Open Playbook deep-link button** (verified on the next digest: `actions: true`) | 07 |
| 07:34 | **Screenshot gate passed**: released page renders real feed values — market-aware badge "market closed" (not stale), NVDA earnings "today", full watchlist table, both alerts on the timeline, Portfolio-Alerts-Off panel | 14 |
| 07:36–08:0x | Delivery attempts: #1 lost during an alert-history 504 window; test fingerprint reset (KV surgery, gate itself behaved correctly) → attempt #2 (run 25823638): digest written **with actions**, still no `sent` row after 6+ min of polling; routing diffed field-by-field against the working crypto automation — identical. Judged platform-side fanout issue; monitoring continues; feedback drafted | 15 |

## Definition of done — status

- [x] Source resolved: 3/3 symbols → US equities, zero blocking questions
- [x] Producer ran manually twice; second run consumed first run's history
- [x] Failure injection: unpriced/stale, alerts suppressed
- [x] Automation scheduled (market-hours cron); run history green; publish auto-run quiet under delivery semantics
- [x] Playbook released v1.0.0: lint 0/0/0, README current, screenshot shows real feed-backed values
- [x] Alert content real (earnings-day alert on the actual NVDA report date) with deep-link action attached
- [x] Four delivery gates verified individually
- [ ] **Delivery `sent` row: pending — platform-side fanout not firing for this new automation** (two controlled attempts; the same mechanism's executed delivery proof exists in the crypto demo: `demo-evidence/13-delivery-proof-1.txt`). The skill's own discipline is what kept this from being reported as delivered.

## Cost

Runs so far: 3 manual (0 credits — `alva run` was free-tier metered at 0 this session) + 3 platform runs (1 credit each) + screenshot; well under the crypto demo's ~30-credit envelope. Scheduled cost: ~14 runs/trading-day × 1 credit.

Share link: <https://alva.ai/u/lx79d/playbooks/portfolio-watch-equity-demo>
