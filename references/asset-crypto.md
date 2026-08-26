# Crypto Module: Binance Scope, Pair Resolution, Cadence

> Formerly `references/binance-portfolio.md` (renamed in v3 when the source
> layer was extracted to `portfolio-source.md`). Historical documents —
> `calibration.md`, the iteration-1/2 eval reports — cite the old name; those
> files are frozen evidence and intentionally not rewritten.

This file owns everything crypto-specific: what a crypto portfolio is, how
crypto symbols become priced instruments, which alert kinds belong to this
asset class, and what cadence fits a market that never closes. Where the
portfolio's *source* comes from (connected account, declared holdings, bare
watchlist) is asset-agnostic and lives in `portfolio-source.md`.

## 1. Scope (v1)

- **In scope**: Binance **spot** balances, including locked/earn balances if
  the API exposes them (label them — they affect NAV but not liquidity).
  Binance is the connectable account today; the source rules in
  `portfolio-source.md` apply unchanged if more venues become connectable.
- **Out of scope in v1**: futures/perp positions, margin, cross-exchange
  aggregation, on-chain wallets. If the user asks for these, say v1 covers
  spot, deliver spot, and record the request. Do not silently include a
  leveraged position in a NAV sum built for spot math — wrong leverage
  handling produces confidently wrong P&L, which is worse than a smaller
  scope.
- **Stablecoins** (USDT, USDC, FDUSD…): included in NAV, reported as the
  `stable_ratio`, excluded from price-move alerts (a stablecoin price alert
  is either noise or a depeg — depeg detection is a portfolio-level alert,
  defined in `alerts.md`). `depeg` and `stable_ratio` are **owned by this
  module**: they apply to the crypto sleeve of a portfolio and never to
  equities.

## 2. Symbol and pair resolution

Balances arrive as assets (`BTC`); prices are quoted on pairs (`BTC/USDT`).
Resolve every asset to its actual traded pair before pricing:

- Prefer the deepest USDT pair; fall back to USDC or a two-hop via BTC only
  when no direct stable pair exists (flag two-hop pricing in the snapshot —
  it is an estimate, and estimates must be labeled).
- Some assets simply have no reliable pair (delisted, too new). Mark them
  `unpriced`, show quantity without value, exclude from NAV with a visible
  footnote, and never alert on them.
- Never assume ticker text is unique or stable across venues. Resolution
  happens at build time and is re-verified when it fails at run time. A
  symbol that could be either a crypto asset or an equity ticker is resolved
  by the disambiguation rule in `portfolio-source.md` — never by defaulting
  to this module.

## 3. Cadence and "change"

- **Refresh cadence: hourly, 24/7.** Crypto trades continuously — there is
  no market-close cadence to borrow; hourly balances alert latency against
  cost. Alert evaluation runs on every refresh; there are no session
  windows — every run is a judging run.
- Quote currency: USDT (displayed as USD, labeled as USDT-quoted).
- "Change" anchors: `chg_24h` is a rolling 24-hour window (there is no
  daily close); σ base is the 20 **calendar-day** daily σ — contrast with
  the equity module, whose window is trading days.
- **Dust rule**: assets worth < $10 **and** < 0.5% of NAV are aggregated
  into an `OTHER` bucket. They stay in NAV (accounting must balance) but
  never generate per-asset alerts. A wallet with 40 airdrop tokens must not
  become 40 alert streams.

## 4. Crypto alert kinds

The class-specific rows of the Tier A/B taxonomy in `alerts.md`:

- `price_move` (24h σ-scaled) and `price_move` fast (1h %) — the 24/7 market
  makes the 1h fast-move check meaningful at all hours.
- `depeg` (Tier B, critical, 2-run confirmation) — crypto-only.
- `news` materiality examples for the alpi prompt: protocol hacks,
  delistings, regulatory actions, tokenomics changes → high; routine price
  commentary, influencer opinions, listicles → low.
