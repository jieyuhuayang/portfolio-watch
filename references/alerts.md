# Alerts: Taxonomy, Thresholds, and the Novelty Gate

An alert spends the scarcest resource the product touches: the user's trust
that a notification about their money matters. Every rule here exists to
keep the alert channel's signal rate near 100% — because the first ignored
alert starts the path to mute, and mute is churn for a watch product.

## 1. Alert taxonomy

### Tier A — position events (`subject: asset:*`)

| Kind | Fires when | Severity |
|---|---|---|
| `price_move` | \|24h change\| ≥ K × that asset's 20d daily σ (`move_score ≥ K`) | warning; critical at 2K |
| `price_move` (fast) | \|1h change\| ≥ threshold% (fat-finger/flash events) | warning |
| `news` | `events` row with `materiality: high` for a held asset | warning |

Class-specific Tier A kinds — `gap`, `earnings_event`, `volume_anomaly` for
equities (`asset-equity.md` §5) — enter the same tiers, fingerprints, novelty
gate, and digest as the rows above; a new asset class adds rows to this
taxonomy, never a parallel alert system.

Volatility-scaled, not flat: a flat "±5%" rule alerts weekly on a mid-cap and
never on a stablecoin-heavy book — σ-scaling makes "unusual" mean unusual
*for that asset*. The σ window unit is per class (trading days for equities,
calendar days for crypto). Dust-bucket (`OTHER`) assets never fire Tier A.

### Tier A′ — cross-sectional rules (v4; any book with ≥2 correlated risk assets)

Risk lives in exposures, not tickers. When holdings are correlated (a
tech-concentrated book, an AI complex), univariate σ rules mistake one
factor event for N independent signals. Two rules fix this:

| Kind | Fires when | Severity |
|---|---|---|
| `systematic_move` | ≥ half the held risk assets move ≥ K × their own σ in the same direction **and** their avg pairwise 60d correlation ≥ 0.5 → **one** portfolio-level alert; that run's per-name `price_move` candidates are absorbed into it | warning; critical at 2K |
| `resid_move` | \|r_asset − β × r_benchmark\| ≥ K × that asset's 60d **residual** σ (`resid_score ≥ K`) | warning; critical at 2K |

- Returns decompose into β (the market's move, expressed through the asset)
  and residual (the asset's own news). A −3% day on a −3% benchmark day is
  beta, not news; a −2.5σ residual on a flat benchmark **is** news even when
  the raw move never crosses the raw-σ threshold. Where both a raw
  `price_move` and a `resid_move` fire for the same asset, the residual one
  carries the signal — send it, absorb the raw one.
- β per asset from a rolling 60-trading-day regression against the
  benchmark; benchmark = an index ETF the user already holds (their own
  stated market), else the class default (`asset-equity.md` §4). β and
  residual σ are cached like sigma baselines (KV, refreshed daily).
- A `systematic_move` alert names the driver honestly: "your AI-complex
  exposure moved together (β-driven); largest residual 0.4σ — no
  single-name news."

### Tier B — portfolio events (`subject: portfolio`)

| Kind | Fires when | Severity |
|---|---|---|
| `drawdown` | drawdown_30d **crosses a band edge** (bands: 5/10/15/20/30%) | warning; critical ≥ 15% |
| `concentration` | top_weight crosses 40% (or 1.25× its 30d mean); with ≥3 positions, also when **effective bets** (1/Σw²) crosses below 2.0 — "you hold N names but fewer than two independent bets" | info |
| `drift` | a position's weight exits its **target band** (target ± 5pp default) — only when the user declared targets | info |
| `depeg` | any held stablecoin deviates > 1% from 1.00 for 2 consecutive runs (crypto only — owned by `asset-crypto.md`) | critical |

Banded, not continuous: drawdown alerts fire on *entering* a band, so a
portfolio oscillating around −9.8%…−10.2% alerts once, not every hour.
The 2-run confirmation on depeg trades 1 hour of latency for immunity to
single-candle data glitches — for a critical alert, a false positive is the
costlier error.

### Tier C — system events (`subject: system`)

| Kind | Fires when | Severity |
|---|---|---|
| `connection` | account API auth fails (once per outage, not per run) | action-needed |

## 2. Sensitivity presets

One user knob, mapped to concrete parameters — users think in temperament,
not in σ:

| Parameter | `calm` | `normal` | `sensitive` |
|---|---|---|---|
| σ multiple K (24h move) | 4 | 3 | 2 |
| 1h fast-move threshold | 12% | 8% | 5% |
| Drawdown bands | 10/20/30 | 5/10/15/20/30 | 5/10/15/20/30 |
| News materiality delivered | high only | high only | high + medium |
| Concentration alerts | off | on | on |
| Expected volume (typical 5-asset book) | ~1–2/month | ~1–2/week | ~several/week |

Publish the "expected volume" line to the user when they pick — a threshold
is meaningless to most people; "about one or two a week" is a promise they
can hold the product to. Tuning changes config only, never code.

Asset modules supply their own parameter values for the same three presets
(e.g. the equity table in `asset-equity.md` §6) — one knob, class-specific
mappings. The expected-volume promise is mandatory regardless of class.

## 3. The novelty gate

Runs after rule evaluation, before anything is written to `alerts`:

```
fingerprint = (subject, kind, normalized_state, severity_band)

for each candidate:
  last = kv["fingerprint:" + subject + ":" + kind]
  if last is missing                        → PASS   (first occurrence)
  if candidate.state == last.state:
      if candidate.severity >  last.severity → PASS  (escalation)
      else                                   → DROP  (already told them)
  if candidate.state != last.state:
      if returning to a state notified < cooldown ago
         and severity not higher             → DROP  (oscillation guard)
      else                                   → PASS  (real transition)
```

- `normalized_state` is discrete (`drawdown_band:10-15`, `move:down-3sigma`,
  `event:<event_id>`) — continuous values re-fingerprint every run and the
  gate becomes a no-op.
- **Escalation re-alerts, recovery doesn't.** Going from −10% to −15% is
  news the user must hear again; recovering to −8% shows up on the page. A
  recovery *notification* is `calm`/opt-in territory, not default.
- Cooldown (default 24h) guards threshold-straddling oscillation.
- The gate compares against last **notified** state — comparing against last
  *observed* state lets an oscillating value alert on every crossing.

## 4. Composition and delivery

**Written ≠ delivered.** Appending a row to the declared alert output is step
one of a four-link delivery chain, and every link can independently be the
reason a user "never got the alert":

1. **Declared** — the output is wrapped in `alertOutput()` with a root `body`
   string; rows in an undeclared output are just data.
2. **Enabled** — the producer cronjob carries `--push-notify` (default on for
   new automations; verify with `alva deploy get`, fix with
   `alva deploy update --id N --push-notify`).
3. **Bound** — the receiving user holds an ACTIVE alert binding for this
   automation. `alva automation publish` creates the owner's binding
   automatically (even with `--skip-auto-trigger`), but *following a Playbook
   never changes alerts* — any other viewer needs an explicit
   `alva alert enable --automation <owner>/<name>` (or `--automation-ids`,
   with `--channel-id` for a topic channel).
4. **Routed** — the delivery resource points at a live destination: check
   with `alva automation delivery get --id N`; update only the field that
   must change (`--email-enabled` / `--alva-channel-ids`), never
   read-modify-write the whole resource. `channel_id=0` is the default
   personal destination; external DM follows the account's active IM
   provider.

When debugging "no alert arrived", walk the chain in this order; when
verifying done-ness, prove each link separately before the single test
delivery. **Delivery proof is an `alva alert history` row with status
`sent`** — a written ALFS record is not delivery, and neither is a
successful binding/config mutation.

- Multiple survivors in one run → **one digest notification**, ordered by
  severity, not N pings. The unit of interruption is the run, not the rule.
  This is also the platform's contract, not just taste: a run may return **at
  most one alert record per declared source** (root `body` required, `title`
  optional), so the digest is the only shape that fits. Survivors are
  individually preserved in the `alerts/log` audit output
  (`feed-contract.md`).
- Every alert text answers: **what** changed, **how much/severe**, **since
  when**, on **what evidence** (with timestamp/source), **where to look**
  — attach the Playbook link as a declared action (`openUrlAction`; a bare
  `url` field does not become a button) — and **which standing decision it
  informs**: a rebalance band the user set, a thesis to re-check, a risk
  limit approached. Information is only worth an interruption if it can
  change an action. Name the user's own pre-declared decision point; never
  issue a trade instruction — "NVDA breached your 45% band — rebalance
  decision point" is the product's job, "sell NVDA" is not.
- Absolute balance values stay out of notification text (push notifications
  land on lock screens); percentages carry the signal.
- Stale or carried-price assets are excluded from rule evaluation entirely —
  suppression happens upstream (see `producer.md`), the gate is not a filter
  for bad data.

## 5. What never alerts

Refresh success, "no change detected", watch anniversary, marketing.
The Playbook's freshness badge proves liveness; the alert channel proves
materiality. Mixing those two jobs destroys both.

Be precise about what "staying quiet" means mechanically: the run executes
in full — reads balances, refreshes every data group, updates the Playbook —
and simply **does not append to the declared alert output**. Silence is a
property of one output group, never a skipped or degraded run. If a user
asks why they heard nothing, the answer is "the watch ran N times and judged
nothing material", provable from run history plus an empty alert delta.
