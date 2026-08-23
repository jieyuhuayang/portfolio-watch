# Iteration 2 — Simulated Eval Results (2026-08-23)

Method: 7 realistic user prompts (the original 5 plus two new v2 scenarios),
each run by independent agents in a simulated Alva environment (with the v2
skill vs. without), graded by independent graders against decision-level
assertions. Simulated runs only — the live platform was exercised once,
end-to-end, in the phase-3 demo (see `demo-evidence/`), not farmed for evals.

## Headline

| Config | Assertions passed | Tokens/run (mean) | Time/run (mean) |
|---|---|---|---|
| With skill (v2) | **40/40 (100%)** | ~57.7k | ~152s |
| Without skill | 26/40 (65%) | ~40.0k | ~89s |

On the 5 scenarios shared with iteration 1: with-skill 30/30 (iter-1: 27/27),
baseline 16/30 ≈ 53% (iter-1: 15/27 ≈ 56%) — no regressions; the tightened
eval-4 set got *harder* and the skill still clears it.

## Per-scenario

| Eval | With | Without | What separated them |
|---|---|---|---|
| standard-build | 9/9 | 3/9 | Strongest discriminator. Baseline: no declared alert output group, no bounded-history read, no stale-data suppression, one post-scheduling dry-run instead of two pre-scheduling manual runs, dust tokens still firing per-asset alerts, no feed-binding contract for the page |
| simple-question-no-overbuild | 4/4 | 3/4 | Baseline answered well but shipped no as-of timestamp anywhere — the one provenance decision the route exists to force |
| noisy-request-negotiation | 6/6 | 3/6 | Baseline quantified the noise, then shipped the literal flat-1% rule as default anyway (mechanical throttles only), built no Playbook, and its push templates embed absolute dollar values |
| no-connection-degrade | 3/3 | 1/3 | Baseline built nothing (good) but offered a three-way menu including a fabricated-data "DEMO" dashboard, never named the connect-Binance path, and skipped the manual path's staleness tradeoff |
| share-publicly-privacy (tightened) | 8/8 | 6/8 | **The iteration-1 tightening worked as designed**: the two assertions added from iter-1 findings — share-safe rows from the *same producer run*, and a *redacted alert-timeline mirror* — are exactly the two the baseline failed |
| agent-schedule-routing (new) | 5/5 | 5/5 | **Non-discriminating** — a strong baseline also routed to an agent schedule. Real differences (preflight of existing deployments, dry-run validation, staleness gate in the recurring prompt) were not asserted |
| tune-too-chatty (new) | 5/5 | 5/5 | **Non-discriminating** — baseline also tuned config-only. Real differences observed but unasserted: baseline silently removed 19 tokens from monitoring scope (unrequested coverage narrowing) and invented baseline thresholds; with-skill cited the republish criterion and preserved KV fingerprints |

Full per-assertion grading with evidence quotes:
`portfolio-watch-workspace/iteration-2/eval-*/{with_skill,without_skill}/grading.json`;
aggregates in `.../iteration-2/benchmark.{json,md}`.

## Grader critiques and carry-forward for iteration 3

Assertions were only tightened this round, never loosened (per policy). The
graders' independent critiques, queued as tightenings for a future round:

1. eval-5/6: add diligence assertions — "no unrequested monitoring-scope
   changes", "explicit config-vs-republish rationale", "preflight existing
   deployments before creating anything".
2. eval-2: reword the autonomy assertion so that implementing the literal
   noisy request *as the default* cannot pass it.
3. eval-0: split the compound "expected volume / how to tune" assertion;
   scope the dust assertion to price/move alerts.
4. eval-3: add an explicit "no fabricated-data demo offered" assertion.
5. Structural limit, stated honestly: simulated runs grade *design
   commitments* (self-reported artifacts), not executed state. The phase-3
   live end-to-end is the execution-level evidence and covers exactly the
   claims simulation cannot (delivery gates, dedup on real triggers, lint,
   release chain).

## Cost note

The skill costs ~1.4× tokens and ~1.7× wall time per request, buying +35pp
on decision-level correctness — concentrated precisely in the
failure modes that would page a user at 3am (false alerts from zeroed
fetches, dust spam, absolute balances on lock screens, fabricated data).
