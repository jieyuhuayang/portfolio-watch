# Binance Portfolio: Account Truth, Scope, and Degradation

This file governs where portfolio data comes from, what counts as "the
portfolio", and what to do when the ideal path is unavailable.

## 1. Source-of-truth hierarchy

For any value shown to the user, use the highest available source:

1. **Connected Binance account API** (via the platform's trading/portfolio
   resources) — balances, and where available, trade history for cost basis.
2. **Platform data skills** — prices, OHLCV, market metadata. Discover
   endpoints fresh (list → summary → endpoint) every build; remembered API
   shapes are not a contract.
3. **User-declared holdings** (manual fallback) — quantities only. Prices
   still come from data skills; never accept a user-remembered price as data.

Never sourced from: LLM memory, pasted screenshots of balances treated as
live truth, or numbers synthesized "to fill a gap". If a value cannot be
sourced, show the gap and say so.

## 2. What is "the portfolio" (v1 scope)

- **In scope**: Binance **spot** balances, including locked/earn balances if
  the API exposes them (label them — they affect NAV but not liquidity).
- **Out of scope in v1**: futures/perp positions, margin, cross-exchange
  aggregation, on-chain wallets. If the user asks for these, say v1 covers
  spot, deliver spot, and record the request. Do not silently include a
  leveraged position in a NAV sum built for spot math — wrong leverage
  handling produces confidently wrong P&L, which is worse than a smaller
  scope.
- **Dust rule**: assets worth < $10 **and** < 0.5% of NAV are aggregated into
  an `OTHER` bucket. They stay in NAV (accounting must balance) but never
  generate per-asset alerts. A wallet with 40 airdrop tokens must not become
  40 alert streams.
- **Stablecoins** (USDT, USDC, FDUSD…): included in NAV, reported as the
  `stable_ratio`, excluded from price-move alerts (a stablecoin price alert
  is either noise or a depeg — depeg detection is a portfolio-level alert,
  defined in `alerts.md`).

## 3. Symbol and pair resolution

Balances arrive as assets (`BTC`); prices are quoted on pairs (`BTC/USDT`).
Resolve every asset to its actual traded pair before pricing:

- Prefer the deepest USDT pair; fall back to USDC or a two-hop via BTC only
  when no direct stable pair exists (flag two-hop pricing in the snapshot —
  it is an estimate, and estimates must be labeled).
- Some assets simply have no reliable pair (delisted, too new). Mark them
  `unpriced`, show quantity without value, exclude from NAV with a visible
  footnote, and never alert on them.
- Never assume ticker text is unique or stable across venues. Resolution
  happens at build time and is re-verified when it fails at run time.

## 4. Cost basis and P&L honesty

Real P&L needs cost basis; cost basis needs trade history, which may be
partial (transfers in, old trades beyond API limits).

- If trade history is complete enough to compute cost basis, show unrealized
  P&L and label the method (FIFO).
- If not, **do not fake it**. Show value and period changes (24h / 7d / since
  watch creation) instead, and tell the user why entry-based P&L is absent.
  "Since you started watching" is an honest and useful baseline; a guessed
  entry price is neither.

## 5. Degradation ladder

Build the best pipeline the current access level supports, and say which rung
you are on:

| Rung | Condition | What the watch becomes |
|---|---|---|
| A | Binance connected, history available | Full: live balances, P&L, all alert tiers |
| B | Binance connected, no usable history | Live balances, period-change P&L only |
| C | No connection; user provides holdings | Same pipeline; snapshot is user-maintained; UI banner: "holdings as declared on <date>" |
| D | No connection, no holdings list | Do not build a fake watch. Answer market questions, explain what connecting enables, stop. |

Rung changes at run time (e.g., API auth expires) degrade gracefully: keep
serving the last good snapshot with a staleness banner, alert **once** about
the connection problem (severity: `action-needed`), and stay quiet after —
one broken-pipe alert is a service; hourly broken-pipe alerts are why users
uninstall.

## 6. Privacy posture

Balances are wealth data. Treat every artifact accordingly:

- Feed and Playbook are **private by default** — publishing a portfolio
  Playbook publicly without an explicit choice is a breach, not a feature.
- Logs and alert texts avoid absolute values where a percentage carries the
  same information.
- The share flow (share-safe mode, remix binding) is defined in
  `playbook-ui.md`; nothing in this file overrides it.
