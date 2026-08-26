# Portfolio Watch — One-Pager

**The deliverable is trust, not a dashboard.** A portfolio watch earns its
place on a phone only if silence reliably means "nothing happened". So the
skill is built around one invariant — **the alert channel's signal rate stays
near 100%** — and everything else (thresholds, interface, degradation,
sharing) is derived from it.

## How I read the assignment

"Any Alva user" is two distributions, not one. The **entry distribution**:
connected account / declared holdings / just tickers / just a question. The
**asset distribution**: the brief's own example is NVDA, TSLA, AAPL — stocks —
while the natural first build on Alva is crypto. The skill therefore has an
asset-agnostic core (pipeline, alert discipline, interface contract, delivery
verification) with per-class modules (`asset-equity.md`, `asset-crypto.md`),
and a **source model with three first-class modes**: connected account,
declared holdings, bare watchlist. The brief's literal sentence builds with
**zero blocking questions** — tickers alone are a buildable portfolio, and
what quantities would unlock is a one-line upgrade note, never a prerequisite.

## The five decisions that carry the product

1. **Risk lives in exposures, not tickers.** Returns decompose into β and
   residual against the benchmark the user already holds: correlated names
   moving together are **one factor event → one alert**; a single name only
   speaks on its **residual** move (its own news, market subtracted).
   Concentration is measured as **effective bets** (1/Σw²) — five positions
   can be 1.8 independent bets, and that number is what a concentrated
   holder needs to see.
2. **"Big move" is relative to the asset, not a flat %.** Thresholds are
   σ-scaled per instrument (20 *trading* days for stocks, calendar days for
   crypto); residual moves are scaled to residual σ.
3. **Every alert names the decision it informs** — the user's own rebalance
   band, a thesis to re-check, a risk limit — never a trade instruction.
   Information is only worth an interruption if it can change an action.
   State changes only, escalation-only re-alerts, one digest per run.
4. **The market closing is a feature, not staleness.** Session semantics for
   equities (gap once at the open, volume only at the close, weekends read
   "market closed"); mixed books run on **one clock** with class judgment
   windows inside the producer.
5. **Rules must be falsifiable.** A deterministic 12-month replay of the
   alert rules is rendered on the page itself: which days would have
   alerted, and was it quiet everywhere else. The replay already earned its
   keep — it exposed band-edge oscillation (58 alert-days/year) before
   launch, and hysteresis re-arm cut it to 31 (~2.6/month, quiet 88% of
   days). "Silence is information" is measured, not asserted.

## Evidence

- **Behavioral evals** (decision-level assertions, graded with evidence
  quotes, only ever tightened): v3 **63/63** vs 42/63 baseline; the v2
  crypto-only skill scores 13/19 on refactor-affected scenarios vs 19/19 —
  the equity module and watchlist mode are load-bearing. Iteration 4 adds
  the concentrated-book scenario for the v4 exposure rules.
- **Three live builds from one skill, spanning its whole input range**: a
  connected-account crypto watch (share-safe public mirror; delivered alert
  proven), the brief's literal sentence as a bare watchlist (real
  earnings-day alert, deep-link buttons), and the concentrated-book showcase
  (effective bets 3.3/4 at 0.73 correlation, β/residual columns, live replay
  panel). All lint-clean, all live-read, all released.

## Metrics and next

North star: **Weekly Trusted Watches** — watches active *and unmuted*; a muted
watch is churn that hasn't happened yet. Guardrails: alert open-rate (decays
before mute-rate rises), stale-run share, fabricated-number count (must be 0).
Next: per-alert usefulness feedback closing the loop on thresholds; futures /
margin as a module with its own liquidation-distance alerts; blueprint-izing
the highest-retention configurations via Remix.
