# Iteration 4 — v4 Exposure Rules (2026-08-26)

Scope: the v4 first-principles upgrade (Tier A′ β/residual + systematic
collapse, drift bands on user targets, effective bets, decision mapping,
falsifiable replay) evaluated on **one new scenario** plus **regression
spot-checks** on the two scenarios most exposed to the change. Evals 0–6
were not rerun: v4 is additive to reference sections those scenarios do not
exercise — a documented spot-check strategy, not a blanket claim.

## New scenario — eval-9 `concentrated-book-exposure`

Prompt (the showcase persona): *"I hold 800 NVDA (mostly vested RSUs), 200
TSM, 100 QQQ, 0.8 BTC and about $40k in cash. I'm worried I'm too
concentrated in AI — watch my risk. Rough targets: 40/15/20/10/15."*

| Config | Score | What separated them |
|---|---|---|
| With skill (v4) | **8/8** | One clock, β/residual vs the user's own QQQ (60 trading days, absorption rule), genuine systematic collapse (≥2 same-direction ≥3σ + corr ≥0.5 → ONE factor-event alert), eff_bets 1/Σw² on the exposure strip, drift ±5pp on the user's own targets, every alert naming its standing decision, honest handling throughout |
| Without skill | 3/8 | Passed eff-bets, drift bands, honesty. Failed: two producers on two clocks + a quarterly schedule (not one watch); **no β/residual anywhere**; its "max 1 push per run" priority-selection emits whichever single alert wins — never a portfolio-level factor event; alert bodies state breaches without naming decisions; no residual column. Also fabricated a published page URL in the reply (flagged; unasserted) |

The baseline was genuinely strong on concentration accounting (look-through
QQQ decomposition, HHI) — the gap is precisely the cross-sectional machinery
v4 encodes: return decomposition and factor-event collapse are not things a
capable agent reinvents under deadline; they have to be taught.

## Regression spot-checks (v4 skill on iteration-3 scenarios)

| Eval | v4 | iteration-3 (v3) | Verdict |
|---|---|---|---|
| eval-7 watchlist-equities-literal | **8/8** | 8/8 | No regression — the v4 exposure additions stay honest in watchlist mode: `eff_bets` null "needs weights", zero fabricated quantities anywhere |
| eval-8 mixed-portfolio-one-clock | **7/7** | 7/7 | No regression — one clock, per-class σ windows, Tier A′ active with depeg inert |

## The replay as an eval of the rules themselves

Beyond agent-behavior evals, v4 adds a second evidence layer: the 12-month
deterministic rule replay on the showcase book. Replay v1 **falsified the
rule design** — 58 alert-days/250 (band-edge oscillation in drift and
drawdown that the 24h cooldown cannot stop). Hysteresis re-arm (drift
re-arms 1pp inside the band; drawdown episodes with <2.5% recovery reset)
cut it to **31 alert-days (~2.6/month, quiet 88% of days)** with the
survivors individually attributable (2 systematic days, 7 residual days, 6
drift, 11 drawdown-episode events, 8 BTC vol days). The fix shipped before
any user was ever pinged. Evidence: `demo-evidence-showcase/`
(02-replay-source.js, 06/07 replay outputs, e2e-log.md).

## Grader critiques queued (only-tighten policy)

1. eval-9: add an assertion catching fabricated as-delivered claims
   (published URLs, "test alert sent") inside a simulation — the baseline
   fabricated a page URL and nothing asserted against it.
2. Pin down one canonical delivery-test pattern (publish auto-run vs one
   deliberate trigger) — the two v4 runs argued both from the skill text.
3. eval-9 decision-mapping assertion: require worked alert copy for every
   kind, not pseudo-code stubs, so "every alert" is fully checkable.

Aggregates: `portfolio-watch-workspace/iteration-4/benchmark.{json,md}`;
per-assertion grading with evidence quotes in `.../eval-*/{with_skill,without_skill}/grading.json`.
