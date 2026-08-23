# Feed Contract: Schema, Time Semantics, and State

The Feed is the load-bearing wall: the Playbook renders it, the Automation
refreshes it, alerts are declared on it, and next run's judgment reads this
run's memory from it. Change it carelessly and every consumer breaks at once
— so treat this schema as an API with consumers, not a scratch file.

## 1. Output groups

### `positions` — versioned per-run batch

One row per held asset (plus one `OTHER` dust row), replaced each run.

| Field | Type | Notes |
|---|---|---|
| `asset` | string | e.g. `BTC`; `OTHER` for the dust bucket |
| `pair` | string | resolved trading pair, e.g. `BTC/USDT`; `null` if unpriced |
| `qty` | string | decimal-as-string; crypto quantities exceed float precision |
| `price` | number | quote in USDT |
| `value_usd` | number | qty × price |
| `weight` | number | value / NAV, 0–1 |
| `chg_1h` / `chg_24h` / `chg_7d` | number | fractional change of price |
| `move_score` | number | 24h move ÷ 20d daily σ — "is this move unusual *for this asset*" |
| `pricing` | enum | `direct` \| `two_hop` \| `carried` \| `unpriced` |
| `stale` | bool | true when `pricing = carried` (fetch failed, last value carried) |
| `asof_price` | timestamp | **candle/tick time of the price**, not run time |

`move_score` exists because a 5% day means nothing for a small-cap and
everything for BTC; alerts scale to each asset's own volatility, and the UI
sorts by it.

### `portfolio_nav` — append-only time series

One row per run.

| Field | Type | Notes |
|---|---|---|
| `ts` | timestamp | run time (this row genuinely describes the run moment) |
| `nav_usd` | number | sum of priced values |
| `pnl_24h` | number | vs the row nearest 24h ago (bounded lookup, not "previous row") |
| `drawdown_30d` | number | 1 − nav / max(nav over 30d), 0–1 |
| `stable_ratio` | number | stablecoin value / NAV |
| `top_weight` | number | largest single-asset weight |
| `unpriced_count` | int | assets excluded from NAV this run |
| `stale_count` | int | assets carried this run |

`unpriced_count` and `stale_count` are in the contract so the UI can honestly
badge freshness without re-deriving it.

### `events` — event log

Material external evidence about held assets. Append-only; keyed by the
event's own identity, not by run.

| Field | Type | Notes |
|---|---|---|
| `event_id` | string | stable hash of (source, url/native id) — the dedup key |
| `asset` | string | which holding it concerns |
| `event_ts` | timestamp | **publish time of the news/event**, never run time |
| `headline` | string | |
| `source_url` | string | required — no unsourced events, ever |
| `materiality` | enum | `high` \| `medium` \| `low` (alpi-classified, prompt in `producer.md`) |
| `synopsis` | string | alpi 1–2 sentence synthesis of the fetched source |

### `alerts` — declared alert output

This group *is* the notification contract: the platform delivers what lands
here. Only novelty-gate survivors are written (gate in `alerts.md`).

| Field | Type | Notes |
|---|---|---|
| `alert_id` | string | fingerprint (see below) — doubles as dedup key |
| `ts` | timestamp | when the judgment was made |
| `subject` | string | `asset:BTC` \| `portfolio` \| `system` |
| `kind` | string | `price_move` \| `drawdown` \| `concentration` \| `depeg` \| `news` \| `connection` |
| `state` | string | normalized current state, e.g. `drawdown_band:10-15` |
| `severity` | enum | `info` \| `warning` \| `critical` \| `action-needed` |
| `evidence_ts` | timestamp | time of the underlying evidence |
| `headline` | string | one sentence: what changed and how much |
| `detail` | string | why it matters + what to look at next |

## 2. KV state — the system's memory

Small keyed values, read at the start of every run:

- `fingerprint:<subject>:<kind>` → last **notified** state + severity + ts.
  The novelty gate compares against *notified* state, not merely previous
  state — otherwise a value oscillating around a threshold re-alerts forever.
- `baseline:<asset>:sigma20d` → rolling volatility (recomputed daily, cached
  hourly runs need not refetch 20d of candles).
- `seen_event:<event_id>` → prevents re-processing news across runs.
- `watch_created_ts`, `nav_at_creation` → the "since you started watching"
  baseline for rung-B P&L.

## 3. Time semantics (the rule that prevents silent corruption)

Every timestamp answers "when was this true in the world?", not "when did the
script run?":

- Prices → candle/tick time (`asof_price`).
- Events → publish time (`event_ts`).
- NAV rows → run time (correct: NAV is a statement about the run moment).
- Alerts → judgment time, carrying `evidence_ts` separately.

Stamping everything with run time is the classic shortcut; it makes "what did
we know when" unanswerable and quietly poisons every later comparison,
backtest, or audit. The convenience is never worth it.

## 4. Bounded history

Consumers and the producer read **windows, not everything**: last run for
novelty, ~24h for P&L, 20d for σ, 30d for drawdown. Windows are decision
parameters, chosen per judgment — unbounded reads grow without limit and turn
"compare against normal" into "compare against noise".

## 5. Schema evolution

Additive changes (new nullable fields) are safe. Renames/removals/type
changes require versioning the group and migrating the Playbook in the same
release — a Playbook reading a field that silently vanished renders a broken
page under a green Automation, the worst failure class: looks alive, is wrong.
