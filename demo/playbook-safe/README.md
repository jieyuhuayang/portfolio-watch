# Crypto Portfolio Watch — Share-Safe Demo

The **public, share-safe mirror** of a private portfolio watch built by the
portfolio-watch skill. It shows the *shape* of the portfolio — an indexed NAV
trajectory (rebased to 100 at watch start), allocation weights, percentage
moves, drawdown from the 30-day high, and a redacted alert timeline — and
deliberately nothing else. It answers: *how is this portfolio behaving?*
without answering *how much money is it?*

## What is exposed — and what is not

Exposed (ratios/shapes only): `nav_index`, `pnl_24h`, `drawdown_30d`,
`stable_ratio`, `top_weight`, per-asset `weight` / `chg_24h` / `chg_7d` /
`move_score` / staleness flags, and alert texts that carry percentages only.

**Not present in this page's feed at all**: dollar NAV, position values,
quantities, prices, cost basis, account identity. The redaction happens at the
data layer — a separate public feed written without those fields — not by
hiding them with CSS, so the page cannot leak what it never receives.

## Data sources & freshness

- Underlying holdings: a user-declared manual list (BTC, ETH, SOL, USDT),
  declared 2026-08-23.
- Prices behind the ratios: Binance spot USDT klines via the Alva data skill
  `arrays-data-api-spot-market-price-and-volume` (1h bars; 1d bars for each
  asset's 20-day volatility).
- Cadence: the producer cronjob runs hourly at minute 0 (UTC). This mirror is
  written by the **same producer run** as the private view — one clock, no
  timing race. "Fresh" = Data Status pill shows *live*, last run < 2h old.

## Alert rules in force (preset: `normal`)

State-changes only, novelty-gated, digest-composed: 24h move ≥ 3× the asset's
own 20d daily σ (critical at 6×); 1h move ≥ 8%; drawdown crossing
−5/−10/−15/−20/−30% bands; top weight crossing 40%. Escalation re-alerts;
recovery updates the page silently. The timeline here is the redacted mirror
of the private alert log.

## Blind spots

- Manual holdings drift until the owner updates the list.
- News/materiality alerts are disabled in this demo build.
- USDT valued at its quote-unit 1.00; external depeg reference not wired.
- Indexed NAV hides scale by design — that is the point, not a gap.
- History starts 2026-08-23; the 30d drawdown window is shorter until then.
