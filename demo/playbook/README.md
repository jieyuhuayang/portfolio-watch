# Crypto Portfolio Watch (Demo)

A standing watch over a **user-declared crypto holdings list** (BTC 0.1, ETH 2,
SOL 30, USDT 2,000 — manual mode: quantities are maintained by the owner, not
read from an exchange account). Every hour it re-prices the holdings, compares
the portfolio against its own bounded history, and appends an alert **only when
something material changed** — so an empty alert timeline is a statement, not a
gap. It answers: *what is this portfolio worth, what changed, and can I trust
these numbers right now?*

## Data sources & freshness

- **Holdings**: `holdings.json` in the feed directory — user-declared
  quantities, last declared 2026-08-23. This is the manual (Rung C) mode: the
  list only changes when the owner edits it, and the page says so.
- **Prices**: Binance spot **USDT** klines via the Alva data skill
  `arrays-data-api-spot-market-price-and-volume`
  (`/api/v1/crypto/binance/spot/usdt/kline`) — `1h` bars for price and 24h/7d
  changes (price timestamp shown is the bar's close time, not the run time),
  `1d` bars for each asset's 20-day daily volatility (refreshed at most every
  20h, cached between runs).
- **USDT** is valued at its quote-unit 1.00 by construction (see blind spots).
- **Cadence**: producer cronjob runs hourly at minute 0 (UTC; 19:00/20:00 ET
  offset depending on DST). "Fresh" means the Data Status pill shows *live* and
  the last-run stamp is under 2 hours old; beyond that the page badges itself
  *stale* rather than pretending.
- Every number rendered on the page is read from the feed at view time via the
  Alva browser SDK — nothing is hardcoded into the HTML.

## Alert rules in force (preset: `normal`)

Alerts fire on **state changes, not states**; a novelty gate suppresses
repeats, re-alerts only on escalation, and composes all survivors of one run
into a single digest notification.

| Rule | Threshold | Severity |
|---|---|---|
| 24h move | ≥ 3× that asset's 20d daily σ | warning (critical at 6×) |
| 1h fast move | ≥ 8% | warning |
| Drawdown from 30d high | crossing −5 / −10 / −15 / −20 / −30% bands | warning; critical ≥ 15% |
| Concentration | top position crossing 40% of NAV | info |

Expected volume on this book: roughly one or two alerts per week. Sensitivity
is a config knob (`calm` / `normal` / `sensitive`) — tuning changes config,
not code.

## Failure honesty

A failed price fetch never looks like a crash or a zero: the asset is carried
at its last known value, visibly flagged ("carried price", dimmed row), its
alerts are suppressed, and the nav row records `stale_count`/`unpriced_count`
so the freshness badge is computed from the data, not from optimism. If more
than half of NAV is degraded, the run records data but makes no alert
judgments at all.

## Blind spots

- Manual holdings drift silently until the owner updates `holdings.json` —
  this is the honest cost of the no-exchange-connection mode, and the page
  banner says so.
- News/materiality alerts are **disabled in this demo build** (the events
  group exists in the schema but is not populated).
- USDT is assumed at 1.00 (it is the quote unit); an external depeg reference
  is not wired, so a USDT depeg would show up only indirectly.
- No cost-basis P&L: entry prices are unknown, so changes are period-based
  (24h/7d/since-watch) — a guessed entry price would be fabrication, and this
  playbook does not do that.
- History starts 2026-08-23; drawdown-from-30d-high reads over a shorter
  window until 30 days of history exist.
