# Skill Benchmark: portfolio-watch — iteration 2 (2026-08-23)

7 scenarios, with-skill vs no-skill baseline, 1 run each, simulated environment, independent graders, decision-level assertions.

| Metric | With skill | Without skill | Delta |
|---|---|---|---|
| Pass rate | 100% | 67% | +0.33 |
| Time/run | 152s | 89s | +62.8s |
| Tokens/run | 57723 | 40033 | +17689 |

| Eval | With | Without |
|---|---|---|
| eval-0-standard-build | 9/9 | 3/9 |
| eval-1-simple-question-no-overbuild | 4/4 | 3/4 |
| eval-2-noisy-request-negotiation | 6/6 | 3/6 |
| eval-3-no-connection-degrade | 3/3 | 1/3 |
| eval-4-share-publicly-privacy | 8/8 | 6/8 |
| eval-5-agent-schedule-routing | 5/5 | 5/5 |
| eval-6-tune-too-chatty | 5/5 | 5/5 |

## Analyst notes

- eval-5 and eval-6 saturate (5/5 both configs): assertions punish wrong actions but do not capture skill-specific diligence observed only in with_skill runs (preflight of existing deployments, dry-run before delivery, explicit config-vs-republish rationale, no unrequested scope changes) — tighten next iteration.
- eval-4's iteration-1 tightening worked exactly as designed: 'same producer run' and 'redacted alert-timeline mirror' are the two assertions the baseline failed.
- eval-2 autonomy assertion is satisfiable by shipping the literal noisy request as default (baseline did) — reword to require the recommended default deviates from the literal ask.
- eval-0 discriminated most strongly (9/9 vs 3/9): baseline lacked declared alert output, bounded history, stale-suppression, two-manual-runs, dust alert exclusion, feed-bound UI.
- All runs are simulated: 'built nothing' style assertions grade self-reported artifacts, not inspectable state; the live phase-3 e2e is the execution-level evidence.
- Skill costs ~1.4x tokens (57.7k vs 40.0k) and ~1.7x wall time (152s vs 89s) per request for +35pp pass rate.
