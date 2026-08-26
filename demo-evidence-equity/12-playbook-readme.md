# Equity Watchlist Watch (Demo)

A standing watch built from one sentence — *"keep an eye on my NVDA, TSLA, and
AAPL, ping me when something big happens"* — with **no brokerage connection and
no position sizes**. It watches the tickers, judges what counts as a real move
for each one, and stays quiet otherwise.

## What it watches

- **Tickers**: NVDA, TSLA, AAPL (owner-declared watchlist; edit the list to
  change coverage).
- **Data**: US stock klines (30-minute and daily bars) and the earnings
  calendar, via Alva data skills. Every number on the page is read from the
  automation's data at view time — nothing is hardcoded.
- **Refresh**: every 30 minutes across the US trading session (pre-open
  through the close, weekdays). When the market is closed the page says
  *market closed* — that is by design, not staleness.

## Alert rules in force (preset: `normal`, expected volume ≈ 1–2/week)

Alerts fire on **state changes, not states**; a novelty gate suppresses
repeats; only escalation re-alerts. Multiple findings in one run arrive as a
single digest with a button that opens this page.

| Rule | Threshold | Severity |
|---|---|---|
| Move vs prior close | ≥ 3× that stock's 20-trading-day σ | warning (critical at 6×) |
| Opening gap | ≥ 2× its 20-day σ — judged once, at the open | warning |
| Volume anomaly | day volume ≥ 3× its 20-day average — judged at the close only | info |
| Earnings proximity | report within 3 days — one heads-up per report date | info |

## Why there is no portfolio value on this page

No quantities were declared, so portfolio-level analytics (total value,
drawdown, concentration) are **off, visibly** — not estimated, not assumed
equal-weight. A portfolio value the owner never gave would be a fabricated
number. Declaring share counts ("I hold 20 NVDA") or connecting an account
upgrades the watch in place.

## Failure honesty

A ticker whose price fetch fails is carried at its last known price and
flagged (never silently zeroed), its alerts are suppressed, and the Data
Status pill degrades to *partial*. If most of the list is degraded, the run
records data but judges nothing.

## Known blind spots

- News/materiality alerts are disabled in this demo build.
- After-hours moves are caught at the next session's open-gap check, not in
  real time.
- The cron window is encoded in UTC, so around daylight-saving transitions
  the first/last run of the day shifts by an hour; the in-script session
  detector keeps judgments aligned to actual trading bars.

*This page is a demo of the portfolio-watch skill's bare-watchlist mode. It
is not investment advice.*
