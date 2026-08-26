# Portfolio Source: Truth, Modes, and Degradation

This file governs where portfolio data comes from — for any asset class.
What counts as truth, which source modes exist, what each mode can honestly
support, and what to do when the ideal path is unavailable. Asset-class
specifics (pair/symbol resolution, sessions, class-owned alert kinds) live
in `asset-crypto.md` and `asset-equity.md`.

## 1. Source-of-truth hierarchy

For any value shown to the user, use the highest available source:

1. **Connected account API** (Binance is the connectable account today) —
   balances, and where available, trade history for cost basis.
2. **Platform data skills** — prices, OHLCV, market metadata, corporate
   events. Discover endpoints fresh (list → summary → endpoint) every build;
   remembered API shapes are not a contract.
3. **User-declared holdings** — quantities only. Prices still come from data
   skills; never accept a user-remembered price as data.

Never sourced from: LLM memory, pasted screenshots of balances treated as
live truth, or numbers synthesized "to fill a gap". If a value cannot be
sourced, show the gap and say so.

## 2. Three source modes

A portfolio is identified by whichever of these the user gives you — all
three are buildable, and none of them is a lesser product:

| Mode | User gives | NAV / Tier B alerts | P&L | Upkeep | UI variant |
|---|---|---|---|---|---|
| **Connected account** | access to a venue (Binance today) | yes | full (rung A/B) | none — live truth | full layout |
| **Declared holdings** | tickers + quantities (+ optional **target weights**) | yes; targets additionally unlock `drift` band alerts | period / since-watching | user maintains the list | full layout, "as declared on <date>" banner; exposure panel when targets exist |
| **Bare watchlist** | tickers only | **no — visibly dark** | per-asset since-watching | none | watchlist layout (`playbook-ui.md`) |

Target weights are the cleanest decision hook the user can hand the watch:
a weight drifting out of *their own* band is unambiguous decision-relevant
information, needing no judgment call from the product. Bands default to
target ± 5pp; tuning is config, never code. Never invent targets the user
didn't state — no targets means no drift alerts, said plainly.

The bare watchlist is the assignment's literal case ("keep an eye on my
NVDA, TSLA, and AAPL") and it is a **first-class mode, not a degraded rung**:

- **Tickers alone are a buildable portfolio.** Symbols resolve, prices come
  from data skills, every Tier A alert works without quantities. Build
  immediately — asking "how many shares?" before building spends the
  one-blocking-question budget on something the build does not need.
- **Never invent weights or quantities.** No equal-weight synthetic NAV, no
  "assuming equal positions" chart. A portfolio value the user never gave
  you is a fabricated number wearing a chart — the same promise-#1 violation
  as a guessed entry price.
- **Tier B goes dark visibly, with the reason.** The page says portfolio-level
  alerts (drawdown, concentration) are off because position sizes are
  unknown, and names the one-line upgrade path: "say 'I hold 20 NVDA'
  anytime, or connect an account". The upgrade note also belongs in the
  build's final summary — once, not as a nag.
- **Mode upgrades are config/data changes on the existing watch** — adding
  quantities or connecting an account later must never trigger a rebuild,
  for the same reason tuning a threshold never does.

## 3. Degradation ladder

Build the best pipeline the current access level supports, and say which
rung you are on:

| Rung | Condition | What the watch becomes |
|---|---|---|
| A | Account connected, history available | Full: live balances, P&L, all alert tiers |
| B | Account connected, no usable history | Live balances, period-change P&L only |
| C | No connection; user declares holdings (tickers + quantities) | Same pipeline; snapshot is user-maintained; UI banner: "holdings as declared on <date>" |
| C′ | User names tickers only (bare watchlist) | Per-asset pipeline in full; Tier B visibly dark with reason + upgrade path |
| D | No connection, no holdings, no tickers | Do not build a fake watch. Ask the one blocking question, offering **three** paths: connect an account, declare holdings, or just name tickers. If none lands, answer market questions and stop. |

Rung changes at run time (e.g., API auth expires) degrade gracefully: keep
serving the last good snapshot with a staleness banner, alert **once** about
the connection problem (severity: `action-needed`), and stay quiet after —
one broken-pipe alert is a service; hourly broken-pipe alerts are why users
uninstall.

## 4. Cost basis and P&L honesty

Real P&L needs cost basis; cost basis needs trade history, which may be
partial (transfers in, old trades beyond API limits).

- If trade history is complete enough to compute cost basis, show unrealized
  P&L and label the method (FIFO).
- If not, **do not fake it**. Show value and period changes (24h / 7d / since
  watch creation) instead, and tell the user why entry-based P&L is absent.
  "Since you started watching" is an honest and useful baseline; a guessed
  entry price is neither.
- The watchlist mode's chart baseline is the same principle with no
  positions at all: each asset's performance rebased to 100 at watch
  creation — honest, comparable, and requiring nothing the user didn't give.

## 5. Mixed portfolios (crypto + equities in one book)

- **One feed, one producer, one automation, one clock.** Cadence is the
  union of held classes (anything crypto → hourly 24/7; pure equity →
  market-hours cron per `asset-equity.md`). The producer applies each
  class's judgment windows internally — an equity outside its market session
  is simply not judged that run, and that is quiet, not stale. Never add a
  second automation to serve a second asset class: two clocks writing one
  product's numbers will disagree during every timing gap.
- **Unified USD NAV over quantified positions only.** The crypto sleeve's
  USDT quote is labeled (USDT≈USD). Watch-only tickers (no quantities) sit
  in a separate "watching — no position size" section, excluded from NAV
  with a visible label. Never blend quantified and unquantified holdings
  into one number.
- `stable_ratio` and `depeg` are evaluated over the crypto sleeve only, and
  are null/absent when no crypto is held.
- **Exposure, not tickers** (v4): with ≥2 correlated risk assets, compute
  rolling pairwise correlations, per-asset β/residual vs the benchmark, and
  **effective bets** (1/Σw²) — a five-name book can be 1.8 independent bets,
  and that number, not the name count, is what a concentrated holder needs
  to see. Cross-sectional alert rules live in `alerts.md` Tier A′; the
  benchmark is an index the user already holds where possible (their own
  stated market), else the class default.
- Ambiguous symbols (a string that is both a crypto asset and an equity
  ticker) resolve by: (a) the user's context words ("stocks", "shares",
  "coins", "美股"), then (b) connected-account holdings, then (c) — only if
  a symbol is genuinely unresolvable — spend the blocking question *on that
  symbol alone*, building the unambiguous rest. Building a watch on the
  wrong asset is a promise-#1 violation; this is the one ambiguity that
  earns a question.

## 6. Privacy posture

Balances are wealth data. Treat every artifact accordingly:

- Feed and Playbook are **private by default** — publishing a portfolio
  Playbook publicly without an explicit choice is a breach, not a feature.
  (A bare watchlist contains no balances, but it still reveals what the
  user is invested in — default to the same posture and let the user opt
  into sharing.)
- Logs and alert texts avoid absolute values where a percentage carries the
  same information.
- The share flow (share-safe mode, remix binding) is defined in
  `playbook-ui.md`; nothing in this file overrides it.
