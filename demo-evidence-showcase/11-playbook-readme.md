# Concentrated Book Risk Watch (Showcase)

A risk watch for a concentrated, correlated book — built from one sentence by
the portfolio-watch skill, as a **fictional showcase persona**: an NVIDIA
employee holding 800 NVDA (vested RSUs), 200 TSM, 100 QQQ, 0.8 BTC and $40k
cash, with self-declared targets 40/15/20/10/15 and a stated worry: *"I'm too
concentrated in AI."*

## The first-principles design

1. **Risk lives in exposures, not tickers.** Five positions currently behave
   like ~3.3 independent bets (effective bets = 1/Σw²) because the equity
   complex is ~0.73 correlated. The page leads with that number, not a list.
2. **Returns decompose into β and residual.** Each stock carries a rolling β
   against QQQ — the benchmark the owner already holds. When the complex
   moves together, that is **one** factor event → one portfolio alert. A
   single name only speaks when its residual move (its own news, market
   subtracted) is ≥ 3× its residual σ.
3. **Every alert names the decision it informs** — the owner's own rebalance
   band, a thesis to re-check, a risk limit — never a trade instruction.
4. **Rules must be falsifiable.** The 12-month deterministic replay on this
   page shows exactly which past days would have alerted (~2.6/month, quiet
   on ~88% of days). The replay also *caught a design flaw before launch*:
   band-edge oscillation produced 58 alert-days until hysteresis re-arm
   (drift re-arms 1pp inside the band; drawdown runs in episodes) cut it
   to 31.

## Alert rules in force (preset: `normal`)

| Rule | Threshold | Decision it informs |
|---|---|---|
| Systematic move | ≥2 correlated equities ≥3σ same direction, avg corr ≥0.5 → one alert | drawdown limit check, not per-ticker reaction |
| Residual move | ≥3× that stock's 60d residual σ vs QQQ | re-check that name's thesis |
| Drift | weight outside target ± 5pp (owner's own bands) | rebalance decision point |
| Drawdown | −5/10/15/20/30% episodes; entry + deepening only | risk-limit check |
| Effective bets | crossing below 2.0 | diversification review |
| Earnings / volume / gap / BTC | 3d proximity · 3× 20d volume at close · 2σ gap at open · BTC 3σ/24h, 8%/1h | event-risk window / attention flags |

One digest per run, severity-ordered, with an Open Playbook button. Repeats
are suppressed by a novelty gate; only escalation re-alerts.

## Honesty

Quantities are owner-declared and drift with real trades until updated
("holdings as declared on 2026-08-26"). No cost basis is invented — P&L is
period-based. A failed price fetch carries the last value, flags the asset,
and suppresses its alerts. Replay assumptions are printed beside its numbers.
Single-benchmark residuals by design — no multi-factor model pretensions.

*Fictional demo data. Not investment advice.*
