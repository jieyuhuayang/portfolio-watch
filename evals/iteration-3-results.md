# Iteration 3 — Simulated Eval Results (2026-08-26)

Method: 9 realistic user prompts — the 7 from iteration 2 (with the queued
tightenings applied: eval-5/6 de-saturated with three diligence assertions
each, eval-2's default-behavior assertion hardened, eval-0 compound assertion
split, eval-3 widened to the three-path source model, eval-3 no-fabricated-
demo assertion added) plus **two new multi-asset scenarios**: eval-7 is the
assignment's literal sentence ("keep an eye on my NVDA, TSLA, and AAPL, ping
me when something big happens" — bare equity watchlist, no account, no
quantities), eval-8 is a declared mixed portfolio (0.5 BTC + 120 NVDA).

Configurations: **with skill (v3)** and **without skill** on all 9;
**old skill (v2)** additionally on evals 3/7/8 — the three scenarios where
the v2→v3 refactor (asset-class-agnostic core, first-class watchlist, equity
module) changes what the skill teaches. Assertions were only tightened or
added, never loosened. Simulated design-commitment runs, graded per-assertion
by independent graders with evidence quotes.

## Headline

| Config | Assertions passed | Tokens/run (mean) | Time/run (mean) |
|---|---|---|---|
| With skill (v3) | **63/63 (100%)** | ~77.8k | ~294s |
| Without skill | 42/63 (67%) | ~58.4k | ~280s |
| Old skill (v2), evals 3/7/8 only | 13/19 (68%) — vs v3's **19/19** on the same three | ~83.4k | ~388s |

## Per-scenario

| Eval | v3 | Baseline | v2 | What separated them |
|---|---|---|---|---|
| standard-build | 10/10 | 8/10 | — | Baseline's novelty gate re-pings on bare cooldown expiry (no escalation-only rule) and per-asset stale prices stay in alert evaluation on carried values |
| simple-question-no-overbuild | 4/4 | 3/4 | — | Baseline answered well but shipped no as-of timestamp and unmarked price provenance — same gap as iterations 1–2 |
| noisy-request-negotiation | 6/6 | 2/6 | — | **Tightening worked**: baseline quantified the noise (well!), then implemented the literal flat-1% rule as the live default, hourly NAV heartbeats into the alert channel, absolute balances in push text |
| no-connection-degrade | 4/4 | 3/4 | **2/4** | **v2's gap is structural**: its own reference text offers two source paths, so tickers-only watchlist is absent; baseline offered all three but never stated the declared-holdings staleness tradeoff |
| share-publicly-privacy | 8/8 | 7/8 | — | Baseline dropped the alert timeline from the public variant entirely (no redacted mirror) |
| agent-schedule-routing (de-saturated) | 8/8 | 7/8 | — | The new staleness-gate assertion is the sole discriminator: baseline's weekly re-judgment has no per-run data-freshness check |
| tune-too-chatty (de-saturated) | 8/8 | 5/8 | — | All three new diligence assertions discriminate: baseline silently removed 19 assets from alerting via a new $50 floor, stated only half the config-vs-republish criterion, and fabricated the watch's "current" thresholds |
| **watchlist-equities-literal (new)** | **8/8** | 5/8 | **5/8** | Failures cluster exactly on what the equity module encodes: close-run σ anchor, gap-judged-once, volume-anomaly-at-close, market-closed ≠ stale framing, since-watch-creation rebased chart |
| **mixed-portfolio-one-clock (new)** | **7/7** | 2/7 | 6/7 | Baseline: fixed % bands instead of per-class σ, no volume kind, no declared-on banner, no concentration/banded drawdown. v2 improvised impressively (market_state, per-class σ) but still lacks gap/volume kinds — v3's delta is converting improvisation into encoded rules |

## What iteration 3 establishes

1. **The v2→v3 refactor is load-bearing, not cosmetic.** On the assignment's
   literal sentence, v2 scores 5/8 for the same reasons the no-skill baseline
   does; v3 scores 8/8. On the source-model scenario v2's miss (2/4) traces
   to its own two-path reference text.
2. **The de-saturation carried forward from iteration 2 worked as designed.**
   Both previously non-discriminating evals now separate the configs, and the
   new assertions fail the baseline on exactly the behaviors the graders had
   observed but not asserted last round.
3. **Cost is unchanged in character**: ~+33% tokens, ~+14s per request,
   buying +34pp of decision-level correctness concentrated in the
   trust-destroying failure modes (false alerts from carried prices, noise
   defaults, fabricated thresholds, silent scope narrowing, publishing
   without consent).

## Grader critiques queued for a future round (only-tighten policy)

1. Split compound assertions so failures localize: eval-7 A7 (no-fabrication
   + since-watching chart), eval-8 A4 (four kinds bundled), eval-1 A2
   (as-of time + provenance).
2. Add visibility/consent assertions to eval-7/8 — both non-skill configs
   published the ticker-list page publicly unasked; no assertion catches it.
3. eval-4: assert the public alert mirror is not a declared alert source
   (v3 handled it; nothing tests it).
4. eval-3: assert the Rung D no-build fallback ("you can also just ask
   market questions") — baseline lacked it, unasserted.
5. Structural limit, stated honestly (unchanged): simulated runs grade
   *design commitments*, not executed state; several runs narrate
   verification as completed inside the simulation frame. Execution-level
   evidence lives in the live demo builds (`demo-evidence/`,
   `demo-evidence-equity/`).

Full per-assertion grading with evidence quotes:
`portfolio-watch-workspace/iteration-3/eval-*/{with_skill,without_skill,old_skill}/grading.json`;
aggregates in `.../iteration-3/benchmark.{json,md}`.
