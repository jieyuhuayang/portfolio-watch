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

## The four decisions that carry the product

1. **"Big move" is relative to the asset, not a flat %.** Thresholds are
   σ-scaled per instrument (20 *trading* days for stocks, calendar days for
   crypto). A flat ±5% alerts weekly on a mid-cap and never on a mega-cap.
2. **Alert on state changes, never states.** A novelty gate (fingerprints of
   discrete states, escalation-only re-alerts, oscillation cooldown) plus
   one severity-ordered digest per run — which is also the platform's
   one-record-per-source contract, so product judgment and API agree.
3. **The market closing is a feature, not staleness.** Equities get session
   semantics: gap judged once at the open, volume judged only at the close,
   weekends render "market closed" — a badge that cries stale every weekend
   teaches users to ignore it. Mixed portfolios run on **one clock**: a
   single automation at the union cadence, class judgment windows inside the
   producer.
4. **Never fabricate a number.** No synthetic equal-weight NAV for a
   watchlist, no guessed cost basis, no CSS-hidden "private" data. Missing
   data degrades visibly (carried price → suppressed alerts → honest badge);
   sharing strips absolutes at the data layer.

## Evidence

- **Behavioral evals** (iteration 3, decision-level assertions, graded with
  evidence quotes): with skill **63/63** vs 42/63 baseline; the v2 crypto-only
  skill scores 13/19 on the refactor-affected scenarios vs v3's 19/19 — the
  equity module and watchlist mode are load-bearing, not cosmetic.
- **Two live builds from one skill**: a crypto watch (Binance, share-safe
  public mirror) and an equity watchlist built from the brief's exact
  sentence — both with lint-clean released interfaces, verified four-gate
  alert delivery, dedup proven on real triggers, and alert buttons that
  deep-link back to the page.

## Metrics and next

North star: **Weekly Trusted Watches** — watches active *and unmuted*; a muted
watch is churn that hasn't happened yet. Guardrails: alert open-rate (decays
before mute-rate rises), stale-run share, fabricated-number count (must be 0).
Next: per-alert usefulness feedback closing the loop on thresholds; futures /
margin as a module with its own liquidation-distance alerts; blueprint-izing
the highest-retention configurations via Remix.
