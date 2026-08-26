# Equity Module: Sessions, Change Semantics, and Equity Alert Kinds

This file owns everything equity-specific. The pipeline, source modes,
novelty gate, delivery chain, and UI contract are shared and live in the
core references; what differs for stocks is that **the market closes** —
and half of this module is the consequences of that one fact.

## 1. Scope

- **First-class**: US-listed equities and ETFs. This covers the dominant
  case and the deepest data coverage.
- **Best-effort**: non-US listings via dotted-suffix tickers (`0700.HK`,
  `7203.T`) through the same kline data skills where covered — coverage is
  narrower (especially intraday), so label it honestly per instrument
  rather than pretending parity. If a listing cannot be priced reliably,
  it is `unpriced`: shown, excluded from NAV, never alerted on.
- **ADRs**: a US ticker means the US-listed ADR; note the underlying in the
  method panel so the user knows which line they're watching.

## 2. Symbol resolution

A US ticker resolves to the equity kline symbol via fresh endpoint
discovery — never assume ticker text maps 1:1 to an instrument. The
crypto-vs-equity ambiguity rule is in `portfolio-source.md` §5: context
words, then connected holdings, then — only for a genuinely unresolvable
symbol — the blocking question, spent on that symbol alone while the
unambiguous rest gets built.

## 3. Sessions and cadence

- **Cadence**: run on a market-hours cron — `*/30 9-16 * * 1-5` in
  `America/New_York` terms (every 30 minutes across the trading window,
  weekdays). Whether the deploy cron accepts a timezone flag is
  `[unverified-live]` — discover the current flag surface at build time; if
  cron is UTC-only, encode the ET window in UTC and note the DST caveat in
  the method panel rather than silently drifting an hour twice a year.
- The producer classifies each run by its timestamp:
  - **Pre-open run** (before 09:30 ET): judge the **gap** (open-vs-prior-
    close once real-time data confirms the open) and sweep overnight news.
  - **Regular-hours runs**: intraday judgment (last vs prior close).
  - **Close run** (~16:00 ET): computes the authoritative close-to-close
    change — the σ anchor — and is the **only** run that judges volume
    anomaly (intraday volume extrapolation is a false-positive machine).
- **Market closed is quiet by design, not staleness.** Weekends, holidays,
  and overnight: the freshness badge says "as of Fri 16:00 ET · market
  closed" and renders as `live`, never `stale`. A watch that cries "stale"
  every weekend teaches the user to ignore the one badge that must stay
  meaningful.
- **Holiday detection**: prefer a market-calendar endpoint if discovery
  finds one; otherwise detect "no new daily candle arrived" — never
  hardcode a holiday list into the producer.

## 4. What "change" means

- **σ base**: close-to-close σ over the last **20 trading days** — not
  calendar days (contrast: the crypto module uses calendar days because
  that market has no closed days). Sizing σ on calendar days silently
  deflates it by ~30% and every threshold fires too often.
- **Intraday change**: last price vs prior close (not vs today's open —
  the user's mental anchor is "how is it doing today", which starts at
  yesterday's close).
- **Gap**: today's open vs prior close, judged **once**, at the first run
  that sees the open. A gap is one event, not a state to re-judge all day.
- **After-hours / pre-market moves**: judge at the pre-open run *if*
  extended-hours data is covered by discovery; otherwise degrade to
  overnight-news-only with the gap check as the catch-all — and say which
  of the two the watch is doing in the method panel.
- **β and residual (v4)**: per-asset β from a rolling regression of 60
  trading-day daily returns against the benchmark (β = cov(r_i, r_b) /
  var(r_b)); residual return = r_i − β·r_b; residual σ over the same
  window. Benchmark = an index ETF the user holds (QQQ/SPY/etc. — their own
  stated market), else **QQQ** for a tech-dominated book, **SPY** otherwise.
  Cache β/residual-σ in KV beside the sigma baselines, refreshed daily.
  Cross-sectional rules that consume these live in `alerts.md` Tier A′.

## 5. Equity alert kinds

Class-specific rows of the Tier A taxonomy — same fingerprints, same
novelty gate, same digest as everything else (`alerts.md`):

| Kind | Fires when | Severity |
|---|---|---|
| `price_move` | \|close-to-close or intraday change\| ≥ K × 20-trading-day σ | warning; critical at 2K |
| `gap` | \|open vs prior close\| ≥ K_gap × 20d σ, judged once at first post-open run | warning |
| `earnings_event` | earnings date within N days (proximity — fires once per event) / result-day move ≥ preset | info / warning |
| `volume_anomaly` | close-run day volume ≥ M × 20d average volume | info |
| `news` | `events` row with `materiality: high` for a held ticker | warning |

- **Not applicable to equities**: `depeg` and `stable_ratio` (crypto-owned).
- The crypto 1h fast-move check does not carry over as-is: US equities have
  exchange circuit breakers and an open/close rhythm; the intraday
  `price_move` row above (σ-scaled, judged per run) is this class's fast
  path.
- `news` materiality examples for the alpi prompt: guidance cuts, M&A,
  restatements, delistings, trading halts, major analyst-target moves →
  high; routine price commentary, "top 10 stocks" listicles → low.

## 6. Preset deltas

Equity-specific parameters for the shared calm/normal/sensitive knob
(`alerts.md` §2 owns the shared rows; the expected-volume promise to the
user is mandatory regardless of class):

| Parameter | `calm` | `normal` | `sensitive` |
|---|---|---|---|
| σ multiple K (close/intraday move) | 4 | 3 | 2 |
| Gap multiple K_gap | 3 | 2 | 1.5 |
| Earnings proximity N (days ahead) | 1 | 3 | 7 |
| Volume anomaly multiple M | off | 3× | 2× |
| Expected volume (typical 5-ticker watchlist) | ~1–2/month | ~1–2/week | ~several/week |

## 7. Data endpoints (calibrated examples — fresh discovery still mandatory)

These endpoints existed in the catalog at calibration time; treat them as
hints for where discovery will land, never as remembered API shapes:

- `arrays-data-api-spot-market-price-and-volume` — US stock kline (price,
  volume; also serves dotted-suffix non-US tickers where covered)
- `arrays-data-api-equity-events` — earnings calendar (~30 days forward,
  which fits the proximity alert), transcripts
- `arrays-data-api-stock-metrics` — volatility, period price changes
- `arrays-data-api-equity-estimates-and-targets` — analyst targets (feeds
  `news` materiality context, not numbers into the feed)
- `arrays-data-api-news` — headline flow for held tickers
