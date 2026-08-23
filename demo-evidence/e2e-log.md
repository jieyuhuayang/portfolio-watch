# Live End-to-End Log — Phase 3 (2026-08-23)

**Method note (honest framing).** The executing agent (Claude, operating the
real `alva` CLI) ran the flow exactly as the skill prescribes, from the user
line *"watch my crypto portfolio and alert me when something big happens"*.
The user played the never-used-Alva persona: they answered the single
blocking question (chose the manual holdings list) and confirmed the
share-safe preview before public release. Simulated with/without-skill
comparisons live in `evals/`; this log is about the platform truth.

**Account**: `lx79d` (pro tier, fresh account — no automations, no playbooks,
no broker connection at start).

## Timeline

| UTC | Step | Evidence |
|---|---|---|
| 18:05 | Preflight: whoami / automation list / playbooks mine / portfolio accounts → all empty → one blocking question → user chose manual holdings (BTC 0.1, ETH 2, SOL 30, USDT 2000) → Rung C | 01 |
| 18:06 | Fresh data discovery: `data-skills summary` + `endpoint` for Binance spot USDT kline | 02, 03 |
| 18:09 | Producer run #1 (`alva run`, non-delivering): NAV $17,451.18, 4 assets priced, 1 concentration alert (44.2% top weight, first occurrence) → alerts/log + alerts/digest | 04–06 |
| 18:12 | Producer run #2: read run #1 history (nav series 2 rows); novelty gate suppressed the repeat (alert counts unchanged 1/1) | 07 |
| 18:13 | Failure injection: ZZZFAKE in holdings → `unpriced/stale`, excluded from NAV (unchanged), `unpriced_count=1`, **no alert**, run green; holdings restored | 08 |
| 18:11–18:14 | `deploy create` (hourly, `--push-notify`) → cronjob 32066; `automation publish --skip-auto-trigger` → feed 27738 | 09, 10 |
| 18:14 | **Four delivery gates verified individually**: declared alertOutput ✓ / push_notify ✓ / ACTIVE owner binding (channel 5025, created by publish) ✓ / delivery destination enabled (web) ✓ | 11 |
| 18:12–18:13 | **Test delivery**: args `{"test_alert":true}` → `deploy trigger` → `alert history` shows exactly one row `sent` (provider `web`); second trigger → novelty gate dropped it, history still one row; args cleared | 12–14 |
| 18:17–18:20 | Playbook: design docs read → HTML built on design-system bundle → `alva lint` (1 error: ECharts requestAnimationFrame → fixed → 0 errors) → README → draft → release v1.0.0 | 15–17 |
| 18:20–18:30 | Pit: `playbooks set-visibility private` → repeatable 503; pit: screenshot of private playbook can't authenticate (published_url shows honest "feed read failed" empty state; canonical URL 403) | 18–20, 27 |
| 18:27 | Share-safe: producer extended to write mirror feed **in the same run**; pit: second feed on same cronjob → bare 500 → paused no-op anchor cronjob (32067, push-notify off); feed 27741 public; anonymous read HTTP 200 (ratios only) | 21–24 |
| 18:31 | Safe playbook: lint 0 errors → draft → **preview + exposed-field list to user → explicit confirmation** | 25, 26 |
| 18:38 | Public release v1.0.0 → canonical URL; released-page screenshot shows live data | 28, 29 |

## Headline numbers

- **One sentence → published, alert-verified watch: 33 minutes** (18:05:08 → 18:38:18 UTC), including three platform pits worked around live.
- **User interactions: 3** — the opening sentence, one blocking question (connection vs. manual list), one share-safe release confirmation. Everything else ran on skill defaults.
- Credits: ~30 of 3,000 used across the whole session (runs bill 0-credit SDK + seconds of runtime).

## Definition-of-done checklist (from SKILL.md §8)

- [x] Account read verified — manual-holdings fallback explicitly chosen (Rung C)
- [x] Producer ran manually twice; second run consumed first run's history
- [x] Feed readable with declared schema; time semantics correct (candle time on prices, run time on NAV rows)
- [x] Automation scheduled (hourly); run history green (2 completed runs at verification time); alert output bound
- [x] Playbook released: lint passed (0 errors), README current, screenshot verified on the share-safe public page (real values rendered)
- [x] Four delivery gates verified individually, then **one test alert delivered — and only one** (`alert history`: single `sent` row across two triggers)
- [x] User told: defaults applied (hourly, normal preset, dust rule), expected volume, and the tuning knob
- [!] Visibility: private release **blocked by platform 503** ("playbook dependency unavailable", repeatable) — private playbook remains technically public, but its private feed makes the page render an explicit empty state for anonymous visitors (no numbers leak); share-safe variant is the intended public surface. Recorded as a known pit, retry planned.

## Demo URLs

- Share-safe (public, canonical): <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo-safe>
- Private original (owner view): <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo>
