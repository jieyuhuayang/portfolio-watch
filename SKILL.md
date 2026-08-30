---
name: portfolio-watch
description: >-
  Turn "watch my portfolio" into a live, alert-enabled Alva Playbook — for
  stocks, crypto, or both, whether the portfolio is a connected account
  (Binance today), a declared holdings list, or just a few tickers the user
  names. Use this skill whenever the user wants to monitor, track, watch, or
  get alerts about their portfolio, holdings, positions, watchlist, balances,
  P&L, or drawdown — including phrasings like "keep an eye on my NVDA, TSLA,
  and AAPL, ping me when something big happens", "watch my stocks", "keep an
  eye on my coins", "build me a dashboard of my Binance account", or
  "盯着我的美股 / 盯着我的持仓 / 组合有大动静提醒我". Also use it when the
  user asks a one-off question about how their portfolio or watchlist is
  doing (answer first, then offer the watch), or wants to tune, pause, share,
  or remix an existing portfolio watch. Produces the full pipeline: portfolio
  Feed + scheduled Automation + Playbook UI + semantic alerts.
---

# Portfolio Watch

Build a **portfolio watch**: a continuously refreshed view of the user's
holdings — stocks, crypto, or both — that (a) renders as a live Playbook and
(b) speaks up — once — when something *material* changes, and stays quiet
otherwise.

A portfolio watch is not a page. It is a pipeline:

```
portfolio truth (account · declared holdings · watchlist)
        →  priced snapshot  →  bounded history
        →  material-change judgment  →  quiet-by-default alerts
        →  live Playbook UI
```

Every decision below exists to protect one of three promises to the user:

1. **The numbers are real** — every value traces to the account API or a data
   endpoint at a known time. The LLM never invents a price, balance, or P&L.
2. **Silence is information** — no alert means "nothing material happened",
   which is only true if noisy alerts are ruthlessly suppressed.
3. **The page is alive** — the Playbook reads the Feed; nothing is hardcoded,
   and staleness is visible, never disguised.

## Speak the user's dialect

Two vocabularies are in play and mixing them up costs trust:

- **User-facing words** (use these in every reply, summary, README, and UI
  label): *automation*, *playbook*, *alert* / *notification*, *Agent*,
  *script*. The platform UI never shows the words "feed" or "producer".
- **Internal words** (fine inside this skill, code, CLI calls, and logs):
  *feed*, *producer*, *KV*, output groups. Surface them to the user only
  when they are looking at raw data, logs, API fields, or an Automation's
  detail view.
- **One trap**: the button on a public Playbook that reads "Subscribe" is a
  *follow* — it does **not** subscribe anyone to that playbook's alerts.
  When a user says "I subscribed", find out which of the two they mean
  before reasoning about delivery.

## 0. Route before you build

Decide what the user needs to *hold* at the end, then pick the route. Do not
over-build: a question deserves an answer, not an app.

| User intent sounds like | Route |
|---|---|
| "How's my portfolio doing?" / "am I up today?" | **Answer**: read account + fresh prices, answer with as-of time and sources. Then offer, in one line, to turn it into a standing watch. Build nothing unless they accept. |
| "Watch / monitor / track my portfolio", "alert me when…", "dashboard of my holdings" | **Build**: full pipeline (§2–§7). |
| "Come back every Monday and re-evaluate my allocation", "check weekly whether my thesis still holds" | **Agent Schedule**: a recurring task where the *Agent must re-reason each time* — route it to an agent-owned schedule, not a deterministic Automation. The dividing line: an Automation re-runs a fixed script; an Agent Schedule re-runs the Agent's judgment. Record the thesis/baseline being re-evaluated so future runs have something concrete to compare against. A watch and a schedule can coexist: the watch supplies the data, the schedule supplies the reconsideration. |
| "Make my alerts less noisy / more sensitive", "pause it", "change thresholds" | **Tune**: update the existing Automation's config; never create a duplicate watch. Editing the producer source takes effect on the next run **without republishing** the Automation — republish only when registration info changes (version, entrypoint, description). Don't "fix" a threshold by rebuilding the pipeline. |
| "Share this with my group / friend" | **Share**: privacy flow in `references/playbook-ui.md` — never make absolute balances public by default. |
| "I want this for my friend's account too" | **Remix**: the Playbook template is shareable; the data binding is per-user. See `references/playbook-ui.md`. |

Before building, check whether a portfolio watch already exists for this user
(list their automations/feeds). If one exists, the request is almost always a
**Tune** or a rebuild-with-consent — creating a second watch silently is the
kind of "success" that becomes a support ticket.

**One blocking question, maximum.** The only question worth blocking on is
**source truth** (§1): account access when nothing else identifies the
portfolio, or a single symbol that cannot be honestly resolved to one asset.
Tickers alone are a buildable portfolio — never block a watchlist build to
ask for quantities. Everything else has a sensible default the user can tune
later — defaults are listed in §2. State the defaults you chose in your final
summary so the user knows what to change.

## 1. Preflight: source and symbol truth

Run identity and source checks before writing any code:

1. Confirm who you are acting as (`whoami`-equivalent) — a watch built against
   the wrong scope is worse than no watch. Note the account's active IM
   provider while you're there: alerts route through it (§7's delivery chain),
   and if none is connected, tell the user in the final summary how to connect
   one so alerts reach their phone — don't block the build on it.
2. **Resolve the portfolio source** (full rules: `references/portfolio-source.md`):
   - **User named tickers** → watchlist or declared-holdings mode. Classify
     each symbol's asset class (NVDA/TSLA → equities; BTC/ETH → crypto;
     mixed → both) and **read the matching `references/asset-*.md` module(s)
     before building**. Tickers alone are sufficient to build — quantities
     unlock NAV-level features and are an upgrade note, never a prerequisite.
   - **No tickers named** → check for a connected account (Binance today).
     Connected → read spot balances; that is the source of truth. Never
     substitute a remembered or user-recalled balance for the API result.
   - **Neither** → this is your one blocking question. Offer three paths:
     connect an account (live truth, P&L, no upkeep), declare holdings
     (ticker + quantity, user-maintained — say so honestly), or just name
     tickers to watch. A pasted brokerage screenshot counts as declaring
     holdings: extract tickers + quantities, confirm the list back, and
     treat it as a typed declaration (`references/portfolio-source.md` §1 —
     the screenshot's *values* are never live data).
3. An **empty portfolio is a valid state**, not an error. Build the watch
   anyway if asked; the Playbook shows an empty state and alerts activate when
   holdings appear.

Source modes, degradation ladder, and mixed-portfolio rules:
`references/portfolio-source.md`. Asset-class specifics:
`references/asset-crypto.md`, `references/asset-equity.md`.

## 2. Defaults (decide, don't ask)

Apply these unless the user specified otherwise; report them in the summary.

Invariant across asset classes:

- **Alert sensitivity**: `normal` preset (see `references/alerts.md`; presets
  are `calm` / `normal` / `sensitive`; asset modules supply class-specific
  parameter values).
- **Dust**: positions worth < $10 *and* < 0.5% of NAV fold into an "Other"
  bucket (dust must not spam alerts).
- **Language**: alerts, page copy, and README render in the language the
  user asked in — recorded once as build config, not re-inferred per run
  (a watch that flips language between runs reads as a different product).
- **Visibility**: **as private as the account's tier allows.** A portfolio
  watch contains real wealth data. Private *released* playbooks are a
  paid-tier feature; on a free-tier account the honest choices are to stop at
  **draft** (pre-publication state) or to release a **share-safe** page
  (§6) — never to resolve the tier limit by silently publishing real
  balances. Say which of the three the user is getting and why.

Per asset class (authoritative values live in the asset modules):

| | Cadence | Quote | "Change" anchor |
|---|---|---|---|
| Crypto (`asset-crypto.md`) | hourly, 24/7 | USDT (display USD) | rolling 24h; 20 calendar-day σ |
| Equities (`asset-equity.md`) | market-hours cron | USD | vs prior close; 20 trading-day σ |
| Mixed | union of the above | USD (USDT labeled) | per class, one clock (`portfolio-source.md` §5) |

## 3. Feed: the contract everything else depends on

Create one Feed with these output groups (full schemas and field tables in
`references/feed-contract.md`):

- `positions` — per-asset snapshot per run: quantity, price, value, weight,
  1h/24h/7d change, volatility-scaled move score, staleness flag.
- `portfolio_nav` — time series: NAV, 24h P&L, drawdown from 30d high,
  stablecoin ratio, top-position weight.
- `events` — event log of material news/catalysts for held assets,
  timestamped by **event time**, with source URLs.
- `alerts` — the **declared alert output**: subject, state, severity,
  evidence time, dedup key. This group is the notification contract.
- KV state — last-notified fingerprints and rolling baselines (the memory
  that makes "has this changed?" answerable).

In watchlist mode (tickers, no quantities), `qty`/`value`/`weight` are null
and NAV-derived judgment stays dark — see `references/portfolio-source.md`.

Time semantics are part of the contract: prices carry candle time, events
carry publish time, snapshots carry run time. Never stamp everything with run
time because it is convenient — it silently corrupts every later comparison.

## 4. Producer: compute, remember, judge

The producer script runs in the jagent runtime (isolated per run — anything
needed next run must be written to the Feed or ALFS). Follow the annotated
template in `references/producer.md`. The shape:

1. Read holdings from the resolved source (account API, declared list, or
   watchlist config); resolve every symbol to its priced instrument per its
   asset-class module (BTC → BTC/USDT; NVDA → US-equity kline symbol) —
   never assume symbol == instrument.
2. Fetch prices via data skills. **Discover endpoints fresh** (list → summary
   → endpoint); do not call remembered API shapes.
3. Compute NAV, weights, changes **against bounded history** read from the
   Feed (last run, 20-day window — σ windows per the asset module: trading
   days for equities, calendar days for crypto). A run that sees only the
   present can report state but can never judge change. Judge each asset
   only inside its market's session (`asset-equity.md` §3): an equity on a
   weekend is quiet, not stale.
4. Use the embedded LLM (alpi) **only** to classify and synthesize evidence —
   e.g., "is this news material to a held asset?" — over real fetched
   sources, returning strict JSON. It never produces a number that lands in
   `positions` or `portfolio_nav`.
5. Evaluate alert candidates, pass them through the **novelty gate**
   (`references/alerts.md`), write the survivors to `alerts`, update KV
   fingerprints, write all groups.

**Failure discipline — missing data must never look like a crash.** If a
price fetch fails, carry the last known value, set the staleness flag,
**suppress alerts for that asset**, and surface staleness in the UI. An alert
that fires because an API returned 0 destroys promise #2 permanently — users
forgive a quiet bug, not a false alarm about their money.

## 5. Automation: make it a standing service

**One watch, one cronjob.** Cadence is the union of the held asset classes
(anything crypto → hourly 24/7; pure equity → market-hours cron) and the
producer applies each class's judgment windows internally — never add a
second automation to serve a second asset class. Two clocks writing one
product's numbers disagree during every timing gap.

1. Verify the producer manually **twice** (different times) with the
   platform's non-delivering run command before scheduling; confirm the
   second run reads the first run's history correctly. Never "test" with the
   automation's trigger command — it uses production delivery semantics and
   can send a real alert.
2. Deploy the producer on the chosen cadence with notification capability
   enabled, then publish the automation **once** (publish is create-only;
   updates go through the update command, never delete-and-recreate).
   Publishing creates the owner's alert binding and by default starts the
   producer once — decide deliberately whether that first auto-run or a
   skip-and-route path fits, and don't run both.
3. Pass the platform's pre-publish checks — treat them as hard gates, not
   suggestions. "It ran once" and "it is a publishable product" are different
   claims.
4. Confirm run history shows green after scheduling.

## 6. Playbook: the interface contract

Build the Playbook per `references/playbook-ui.md`. Non-negotiables:

- Every number on the page comes from the Feed at render time. No hardcoded
  values, no LLM-era numbers frozen into HTML.
- The page shows **as-of time** and a freshness badge; stale assets are
  visibly flagged. The badge is market-aware: a closed market renders as
  "market closed", never as `stale`.
- Layout: NAV header (value, 24h P&L, drawdown) → holdings table → NAV chart
  with drawdown shading → alert timeline → method/README. Watchlist mode
  (no quantities) uses the watchlist variant in `references/playbook-ui.md`.
- Follow the design system; run the design lint; take the screenshot; ship
  the README (what it watches, thresholds in force, update cadence, known
  blind spots). The README is the method's honest label, not decoration.
- **Privacy**: as private as the tier allows (§2) — private release on paid
  tiers, draft or share-safe on free tier. If the user wants to share, offer
  **share-safe mode**: percentages and shapes only — weights, % moves,
  drawdown — no absolute values. Remixers get the template and bind their
  own account; they never see the original owner's data.

## 7. Alerts: the product's voice

Full taxonomy, thresholds, presets, and the novelty algorithm live in
`references/alerts.md`; class-specific kinds (equity gap/earnings/volume,
crypto depeg) are defined in the asset modules and flow through the same
tiers, fingerprints, novelty gate, and digest. The principles that govern
all of it:

- Alert on **state changes, not states**. "BTC is down 12% from your entry"
  is an alert once — not every hour that it remains true.
- **Exposure, not tickers.** Correlated holdings moving together are one
  factor event, not N signals — collapse them into one portfolio-level
  alert; the per-name voice belongs to **residual** moves (the asset's own
  news after subtracting β × benchmark). See `alerts.md` Tier A′.
- Every alert names the **standing decision it informs** (a band the user
  set, a thesis to re-check, a risk limit) — never a trade instruction.
  Information is only worth an interruption if it can change an action.
- Severity may only re-alert **upward**. Escalation notifies; decay updates
  the page silently.
- Every alert answers: what changed, how severe, since when, based on what
  evidence, and what to look at next.
- Quiet is not paused. A run with nothing material to say **appends nothing
  to the declared alert output** — that is the whole of its silence. Data
  groups still refresh, the Playbook still updates, run history still shows
  green. Never send heartbeat notifications to prove the system is alive —
  the freshness badge on the Playbook does that job.

## 8. Definition of done

Do not report success until every line is true:

- [ ] Source resolved and verified: account read succeeded, or declared
      holdings / watchlist symbols each resolved to exactly one instrument.
- [ ] Producer ran manually twice; second run consumed first run's history.
- [ ] Feed readable with the declared schema; time semantics correct.
- [ ] Automation scheduled; run history green; alert output bound.
- [ ] Playbook released: lint passed, screenshot verified, README current,
      visibility private (or share-safe explicitly chosen).
- [ ] Alert delivery chain verified **gate by gate** — a written alert row is
      not a delivered notification. All four must hold, in order:
      1. the declared alert output exists and the test alert row landed in it;
      2. the Automation's notification capability is enabled (successful runs
         deliver their declared alert outputs);
      3. the user holds an **active alert binding** for this automation —
         publishing creates the owner's binding, but verify it rather than
         assume it, and remember that following a Playbook does **not**
         subscribe anyone to its alerts;
      4. the user's channel preference routes notifications to a real
         destination — two checks, not one: the destination is *enabled*
         (preference switched on) **and** *available* (a verified email or
         bound IM channel actually resolves; `references/alerts.md` §4).
         Enabled-but-unavailable passes every config read and delivers
         nothing.
- [ ] One test alert delivered — and only one (dedup verified) — checked
      *after* the four gates above, so a delivery failure points at the gate
      that broke instead of "alerts don't work". Delivery evidence is the
      platform's alert delivery history recording the run as **sent** — a
      written alert record alone is not proof, and neither is a successful
      config update.
- [ ] User told: what will alert, how often it refreshes, which defaults were
      applied, and how to tune sensitivity.

If any gate cannot pass (platform error, missing data coverage), deliver the
part that is verified, name the gap plainly, and propose the next step. Never
paper over a failed gate with a static page that looks alive.

## Reference files

| File | Read it when |
|---|---|
| `references/portfolio-source.md` | Preflight: source modes, degradation ladder, mixed portfolios, privacy |
| `references/asset-crypto.md` | Any crypto holdings: Binance scope, pair resolution, cadence, crypto alert kinds |
| `references/asset-equity.md` | Any stock/ETF holdings: sessions, change semantics, equity alert kinds |
| `references/feed-contract.md` | Designing or modifying the Feed schema |
| `references/producer.md` | Writing the producer script |
| `references/alerts.md` | Defining alert rules, thresholds, novelty gate |
| `references/playbook-ui.md` | Building, sharing, or remixing the Playbook |
