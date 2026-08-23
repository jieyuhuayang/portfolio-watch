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

Volatility-scaled, not flat: a flat "±5%" rule alerts weekly on a mid-cap and
never on a stablecoin-heavy book — σ-scaling makes "unusual" mean unusual
*for that asset*. Dust-bucket (`OTHER`) assets never fire Tier A.

### Tier B — portfolio events (`subject: portfolio`)

| Kind | Fires when | Severity |
|---|---|---|
| `drawdown` | drawdown_30d **crosses a band edge** (bands: 5/10/15/20/30%) | warning; critical ≥ 15% |
| `concentration` | top_weight crosses 40% (or 1.25× its 30d mean) | info |
| `depeg` | any held stablecoin deviates > 1% from 1.00 for 2 consecutive runs | critical |

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

- Multiple survivors in one run → **one digest notification**, ordered by
  severity, not N pings. The unit of interruption is the run, not the rule.
- Every alert text answers: **what** changed, **how much/severe**, **since
  when**, on **what evidence** (with timestamp/source), and **where to look**
  (link to the Playbook section). No alert says only "something happened".
- Absolute balance values stay out of notification text (push notifications
  land on lock screens); percentages carry the signal.
- Stale or carried-price assets are excluded from rule evaluation entirely —
  suppression happens upstream (see `producer.md`), the gate is not a filter
  for bad data.

## 5. What never alerts

Refresh success, "no change detected", watch anniversary, marketing.
The Playbook's freshness badge proves liveness; the alert channel proves
materiality. Mixing those two jobs destroys both.
