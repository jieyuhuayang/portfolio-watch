# Showcase Demo — Live E2E Log (2026-08-26, UTC)

Input (fictional persona, the realistic upper bound of the skill's input
range): *"I hold 800 NVDA (mostly vested RSUs), 200 TSM, 100 QQQ, 0.8 BTC and
about $40k in cash. I'm worried I'm too concentrated in AI — watch my risk.
Rough targets: 40/15/20/10/15."* Mode: declared holdings + targets (rung C),
zero blocking questions. Skill: portfolio-watch v4.

| Time (UTC) | Step | Evidence |
|---|---|---|
| 08:24 | Data smoke: TSM 276 daily bars, QQQ 276, BTC 300 — replay window covered | — |
| 08:30 | Producer written: β/residual vs QQQ (60 trading days), systematic collapse, drift bands, effective bets, one hourly 24/7 clock with in-producer equity session gates | 01 |
| 08:30 | **Manual run 1**: NAV $428,071; **effective bets 3.34 / avg corr 0.73**; β NVDA 1.08, TSM 1.59; bootstrap seeding worked — out-of-band states (CASH −5.7pp) fingerprinted silently, only the event-type alert sent (NVDA earnings today) | 03, 04, 05 |
| 08:32 | Bug found & fixed in run 1 review: benchmark processed after the other equities → their intraday residuals null. Fix: benchmark-first ordering + close-run residual judgment | 01 (comment) |
| 08:33 | **Manual run 2**: residual display live (NVDA +1.5% resid / 0.81σ, TSM +0.81% / 0.48σ); alert counts unchanged (gate held); history consumed | 05 |
| 08:34 | **Failure injection**: ZZZFAKE → unpriced/stale, no judgment, no alert; restored | — |
| 08:35 | `deploy create` → cronjob **32186** (hourly 24/7 — union cadence, crypto sleeve sets the clock), push_notify on; `automation publish` → feed **27824**, owner binding auto-created, auto first run green and quiet | 08, 09 |
| 08:37 | **12-month rule replay v1**: 250 trading days → **58 alert-days** — replay exposed band-edge oscillation (drift 25, drawdown 27) that the 24h cooldown cannot stop | 02 |
| 08:40 | **Hysteresis added from the replay finding** (drift re-arms 1pp inside band; drawdown episodes, recovery <2.5% re-arms) → replay v2: **31 alert-days (~2.6/month), quiet on 88% of days**; systematic 2 · residual 7 · drift 6 · drawdown 11. The noise was caught and fixed before any user was ever pinged | 02, 06, 07 |
| 08:42 | Live producer updated with the same hysteresis; verification run: no spurious alerts | 01 |
| 08:44 | Playbook (exposure view + live replay panel): lint **0/0/0**; draft (8984); feed → public (fictional demo data, disclosed); **released v1.0.0**; playbook_url wired into digest actions | 10, 11, 12 |
| 08:46 | **Screenshot gate passed**: effective bets 3.3/4, avg corr 0.73, CASH flagged outside band, residual/β columns live, replay panel showing 31/250 with per-day events, market-closed badge | 13 |

## What this demo showcases (beyond the equity/crypto demos)

1. **Exposure, not tickers**: effective bets + avg correlation as the lead
   KPIs; β/residual columns; the systematic-collapse rule.
2. **Decision mapping**: every alert names the standing decision it informs.
3. **Falsifiability**: the replay is rendered ON the page, and its first run
   *changed the product* (hysteresis) before launch — measured, not asserted.
4. Same skill, third input shape: account (crypto demo) / bare tickers
   (equity demo) / declared holdings + targets (this).

## Open item (shared with the equity demo)

Alert delivery `sent`-row pending on the platform-side fanout issue for newly
published automations (see `demo-evidence-equity/15-delivery-diagnostics.txt`).
Digest writes, binding, routing all verified; the crypto demo carries the
executed delivery proof for the same mechanism.

Share link: <https://alva.ai/u/lx79d/playbooks/portfolio-watch-showcase>
