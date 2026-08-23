# Iteration 1 — Simulated Eval Results (2026-08-20)

Method: 5 realistic user prompts, each run twice by independent agents in a
simulated Alva environment (with skill vs. without), graded against
decision-level assertions by independent graders.

## Headline

| Config | Pass rate | Tokens/run | Time/run |
|---|---|---|---|
| With skill | **27/27 (100%)** | ~52k | ~117s |
| Without skill | 15/27 (56%) | ~39k | ~80s |

## Per-scenario

| Eval | With | Without | What separated them |
|---|---|---|---|
| standard-build | 9/9 | 5/9 | Baseline: no Playbook at all; `?? 0` on failed price fetch could fire a false crash alert; scheduled before verifying; cooldown re-notifies unchanged state |
| simple-question-no-overbuild | 4/4 | 3/4 | Baseline answered well but named no data source (provenance) |
| noisy-request-negotiation | 6/6 | 1/6 | Baseline quantified the noise (30–80 alerts/day) then shipped the literal 1% rule as default, hourly value pushes with absolute balances, no dashboard |
| no-connection-degrade | 3/3 | 1/3 | Baseline asked before building (good) but offered no Binance-connect path with tradeoffs |
| share-publicly-privacy | 5/5 | 5/5 | **Non-discriminating** — baseline independently made the right privacy calls; real differences (second automation with timing race; dropped alert timeline instead of redacted mirror) were not asserted |

## Carry-forward items for iteration 2

1. Tighten eval-4 assertions: share-safe rows produced by the same
   automation run (no second pipeline); redacted alert-timeline mirror;
   confirm-with-user before releasing even the share-safe variant.
2. Skill change: share-safe variant is previewed and confirmed before
   release (iteration-1 with-skill run published immediately — debatable).
3. Two new eval scenarios: an Agent-Schedule-shaped request ("come back
   weekly and re-evaluate my allocation") and a Tune request against an
   existing watch.
