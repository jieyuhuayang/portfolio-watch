# Feed Contract: Schema, Time Semantics, and State

The Feed is the load-bearing wall: the Playbook renders it, the Automation
refreshes it, alerts are declared on it, and next run's judgment reads this
run's memory from it. Change it carelessly and every consumer breaks at once
— so treat this schema as an API with consumers, not a scratch file.

**Scope isolation.** Each watch gets its **own Feed, created for it in this
session**. Never read from or write into a Feed that belongs to another
playbook or project, even if it looks like it already has the data you need
— unless the user explicitly asks to reuse it. Cross-feed reuse couples two
products' lifecycles: the other project's schema change, pause, or deletion
silently breaks this watch, and this watch's writes pollute their history.
Isolation is the default; reuse is an informed, user-requested exception.

## 1. Output groups

Each group below maps to a documented Feed SDK data-modeling pattern:
`positions` is a tabular versioned batch (all rows share the run timestamp;
the platform auto-groups same-date rows and flattens them on read),
`portfolio_nav` is a time series, `events` is an event log keyed by natural
event time, and `alerts` pairs an event-log audit trail with a declared
alert output. Never name a group `data` — the synth mount already is
`data/`, and you would get `data/data/...` paths.

### `positions` — versioned per-run batch

One row per held asset (plus one `OTHER` dust row), replaced each run.

| Field | Type | Notes |
|---|---|---|
| `asset` | string | e.g. `BTC`, `NVDA`; `OTHER` for the dust bucket |
| `asset_class` | enum | `crypto` \| `equity` — additive in v3; routes class-specific rendering and judgment |
| `pair` | string | resolved priced instrument — trading pair for crypto (`BTC/USDT`), kline symbol for equities; field name kept for compatibility; `null` if unpriced |
| `qty` | string | decimal-as-string; crypto quantities exceed float precision; **null in watchlist mode** (as are `value_usd` and `weight` — never fabricate them) |
| `price` | number | quote in USDT |
| `value_usd` | number | qty × price |
| `weight` | number | value / NAV, 0–1 |
| `chg_1h` / `chg_24h` / `chg_7d` | number | fractional change of price |
| `move_score` | number | 24h move ÷ 20d daily σ — "is this move unusual *for this asset*" |
| `beta` | number | v4, additive, nullable — rolling 60d β vs the benchmark |
| `resid_chg` | number | v4, additive, nullable — day return minus β × benchmark return |
| `resid_score` | number | v4, additive, nullable — \|resid_chg\| ÷ 60d residual σ (the cross-sectional analogue of `move_score`) |
| `target_weight` | number | v4, additive, nullable — user-declared target; null when no targets stated |
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
| `market_state` | enum | `open` \| `closed` \| `mixed` — additive in v3; nullable. Lets the badge say "market closed" instead of the page deriving (or worse, guessing) it |
| `eff_bets` | number | v4, additive, nullable — effective bets, 1/Σw² over risk positions |
| `avg_corr` | number | v4, additive, nullable — avg pairwise 60d correlation of risk positions |

`unpriced_count` and `stale_count` are in the contract so the UI can honestly
badge freshness without re-deriving it; `market_state` extends the same
honesty to closed markets — a weekend is quiet, not stale.

In watchlist mode `nav_usd`, `pnl_24h`, `drawdown_30d`, and `top_weight` are
null (no quantities → no NAV math); `stable_ratio` is computed over the
crypto sleeve only and is null when no crypto is held.

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

### `alerts` — audit log + declared digest (two outputs, one group)

The platform's alert contract (Feed SDK, calibrated): an output opted into
delivery by wrapping its TypeDoc in **`alertOutput(...)`** must carry a root
`body` string (`title` optional), and a run may return **at most one alert
record per declared source**. That constraint decides the shape — one output
cannot be both the full audit trail and the notification:

**`alerts/log` — audit-log output (regular, not alert-declared).** Every
novelty-gate survivor is appended here as its own row. This is the Playbook's
alert timeline and the record of what the watch judged, delivered or not.

| Field | Type | Notes |
|---|---|---|
| `alert_id` | string | fingerprint (see below) — doubles as dedup key |
| `subject` | string | `asset:BTC` \| `portfolio` \| `system` |
| `kind` | string | `price_move` \| `drawdown` \| `concentration` \| `depeg` \| `news` \| `connection` \| `gap` \| `earnings_event` \| `volume_anomaly` \| `resid_move` \| `systematic_move` \| `drift` (class/cross-sectional kinds per asset modules and `alerts.md` Tier A′) |
| `state` | string | normalized current state, e.g. `drawdown_band:10-15` |
| `severity` | enum | `info` \| `warning` \| `critical` \| `action-needed` |
| `evidence_ts` | timestamp | time of the underlying evidence |
| `headline` | string | one sentence: what changed and how much |
| `detail` | string | why it matters + what to look at next |

(Row `date` = judgment time; multiple survivors in one run share it and are
auto-grouped by the platform.)

**`alerts/digest` — the declared alert output** (wrapped in `alertOutput()`).
At most one record per run, composed from all survivors, ordered by severity:

| Field | Type | Notes |
|---|---|---|
| `title` | string | e.g. "Portfolio watch: 2 changes (1 critical)" |
| `body` | string | **required by platform** — severity-ordered digest lines, percentages not absolute values |
| `actions` | — | optional `messageActionsField()`: an `openUrlAction` to the Playbook |

A quiet run appends to neither output. The platform's one-record-per-source
rule is why the skill composes a digest instead of pushing N pings — the
product judgment and the API constraint agree here.

## 2. KV state — the system's memory

Small keyed values, read at the start of every run, via the Feed SDK's
`ctx.kv.load(key)` / `ctx.kv.put(key, value)`. **Values are raw strings** —
serialize structured state with `JSON.stringify` and parse defensively on
load. Keep separate watermarks for sources with different cadences (prices
hourly, sigma daily): a shared watermark silently filters the slower source
forever after the first run.

- `fingerprint:<subject>:<kind>` → last **notified** state + severity + ts.
  The novelty gate compares against *notified* state, not merely previous
  state — otherwise a value oscillating around a threshold re-alerts forever.
- `baseline:<asset>:sigma20d` → rolling volatility (recomputed daily, cached
  hourly runs need not refetch 20d of candles). The 20-day window unit is
  per asset class — trading days for equities, calendar days for crypto —
  and the separate-watermarks-per-cadence rule above now also separates
  classes: an equity σ watermark advances only on trading days.
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

The real read surface (calibrated): in-script,
`ctx.self.ts(group, output).last(n, before?)` / `first(n, after?)` /
`range(fromMs, toMs)` / `lastDate()` / `count()`; from CLI/browser, the
virtual path suffixes `@last/{n}`, `@range/{startMs}..{endMs}`,
`@before/{ts_ms}/{limit}`, `@after/{ts_ms}/{limit}`, `@count`. There is no
"nearest timestamp" lookup — implement "the row nearest 24h ago" with a
bounded `range`/`before` read and pick the closest row yourself. `@last`
returns records oldest-first, and `last(N)` limits unique *timestamps*: a
grouped batch expands to more rows on read.

One platform behavior doubles as a safety net: `append()` deduplicates by
`date` (ON CONFLICT DO UPDATE), so a retried run that re-appends the same
timestamps converges instead of duplicating history.

## 5. Schema evolution

Additive changes (new nullable fields) are safe. Renames/removals/type
changes require versioning the group and migrating the Playbook in the same
release — a Playbook reading a field that silently vanished renders a broken
page under a green Automation, the worst failure class: looks alive, is wrong.
