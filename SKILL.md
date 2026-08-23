---
name: portfolio-watch
description: >-
  Turn "watch my portfolio" into a live, alert-enabled Alva Playbook backed by
  the user's connected Binance account. Use this skill whenever the user wants
  to monitor, track, watch, or get alerts about their crypto holdings,
  portfolio, positions, balances, P&L, or drawdown — including phrasings like
  "keep an eye on my coins", "tell me when something big happens to my
  portfolio", "build me a dashboard of my Binance account", or "盯着我的持仓 /
  组合有大动静提醒我". Also use it when the user asks a one-off question about
  how their portfolio is doing (answer first, then offer the watch), or wants
  to tune, pause, share, or remix an existing portfolio watch. Produces the
  full pipeline: portfolio Feed + scheduled Automation + Playbook UI + semantic
  alerts.
---

# Portfolio Watch

Build a **portfolio watch**: a continuously refreshed view of the user's
Binance holdings that (a) renders as a live Playbook and (b) speaks up — once —
when something *material* changes, and stays quiet otherwise.

A portfolio watch is not a page. It is a pipeline:

```
Binance account truth  →  priced snapshot  →  bounded history
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

## 0. Route before you build

Decide what the user needs to *hold* at the end, then pick the route. Do not
over-build: a question deserves an answer, not an app.

| User intent sounds like | Route |
|---|---|
| "How's my portfolio doing?" / "am I up today?" | **Answer**: read account + fresh prices, answer with as-of time and sources. Then offer, in one line, to turn it into a standing watch. Build nothing unless they accept. |
| "Watch / monitor / track my portfolio", "alert me when…", "dashboard of my holdings" | **Build**: full pipeline (§2–§7). |
| "Make my alerts less noisy / more sensitive", "pause it", "change thresholds" | **Tune**: update the existing Automation's config; never create a duplicate watch. |
| "Share this with my group / friend" | **Share**: privacy flow in `references/playbook-ui.md` — never make absolute balances public by default. |
| "I want this for my friend's account too" | **Remix**: the Playbook template is shareable; the data binding is per-user. See `references/playbook-ui.md`. |

Before building, check whether a portfolio watch already exists for this user
(list their automations/feeds). If one exists, the request is almost always a
**Tune** or a rebuild-with-consent — creating a second watch silently is the
kind of "success" that becomes a support ticket.

**One blocking question, maximum.** The only question worth blocking on is
account access (§1). Everything else has a sensible default the user can tune
later — defaults are listed in §2. State the defaults you chose in your final
summary so the user knows what to change.

## 1. Preflight: account truth

Run identity and connection checks before writing any code:

1. Confirm who you are acting as (`whoami`-equivalent) — a watch built against
   the wrong scope is worse than no watch.
2. Check for a connected Binance account.
   - **Connected** → read spot balances. This is the portfolio's source of
     truth. Never substitute a remembered or user-recalled balance for the API
     result.
   - **Not connected** → this is your one blocking question. Offer two paths:
     connect Binance (preferred — live truth, P&L, no manual upkeep), or a
     **manual holdings list** (ticker + quantity) the user dictates. The manual
     path builds the same pipeline with the holdings snapshot as a static input
     the user must update; say so honestly.
3. An **empty portfolio is a valid state**, not an error. Build the watch
   anyway if asked; the Playbook shows an empty state and alerts activate when
   holdings appear.

Details, scope rules (spot vs. futures, dust filtering, stablecoin handling),
and the full degradation ladder: `references/binance-portfolio.md`.

## 2. Defaults (decide, don't ask)

Apply these unless the user specified otherwise; report them in the summary:

- **Scope**: Binance spot balances; positions worth < $10 *and* < 0.5% of NAV
  are folded into an "Other" bucket (dust must not spam alerts).
- **Quote currency**: USDT (display USD).
- **Refresh cadence**: hourly. Crypto trades 24/7 — there is no market-close
  cadence to borrow; hourly balances alert latency against cost. Alert
  evaluation runs on every refresh.
- **Alert sensitivity**: `normal` preset (see `references/alerts.md`; presets
  are `calm` / `normal` / `sensitive`).
- **Visibility**: **private**. A portfolio watch contains real wealth data;
  it is never public by default. Sharing is an explicit flow (§6).

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

Time semantics are part of the contract: prices carry candle time, events
carry publish time, snapshots carry run time. Never stamp everything with run
time because it is convenient — it silently corrupts every later comparison.

## 4. Producer: compute, remember, judge

The producer script runs in the jagent runtime (isolated per run — anything
needed next run must be written to the Feed or ALFS). Follow the annotated
template in `references/producer.md`. The shape:

1. Read balances from the account API; resolve each asset to its actual
   traded pair (BTC → BTC/USDT) — never assume symbol == pair.
2. Fetch prices via data skills. **Discover endpoints fresh** (list → summary
   → endpoint); do not call remembered API shapes.
3. Compute NAV, weights, changes **against bounded history** read from the
   Feed (last run, 20-day window). A run that sees only the present can
   report state but can never judge change.
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

1. Verify the producer manually **twice** (different times) before scheduling;
   confirm the second run reads the first run's history correctly.
2. Schedule at the chosen cadence; bind the alert output.
3. Pass the platform's pre-publish checks — treat them as hard gates, not
   suggestions. "It ran once" and "it is a publishable product" are different
   claims.
4. Confirm run history shows green after scheduling.

## 6. Playbook: the interface contract

Build the Playbook per `references/playbook-ui.md`. Non-negotiables:

- Every number on the page comes from the Feed at render time. No hardcoded
  values, no LLM-era numbers frozen into HTML.
- The page shows **as-of time** and a freshness badge; stale assets are
  visibly flagged.
- Layout: NAV header (value, 24h P&L, drawdown) → holdings table → NAV chart
  with drawdown shading → alert timeline → method/README.
- Follow the design system; run the design lint; take the screenshot; ship
  the README (what it watches, thresholds in force, update cadence, known
  blind spots). The README is the method's honest label, not decoration.
- **Privacy**: private by default. If the user wants to share, offer
  **share-safe mode**: percentages and shapes only — weights, % moves,
  drawdown — no absolute values. Remixers get the template and bind their
  own account; they never see the original owner's data.

## 7. Alerts: the product's voice

Full taxonomy, thresholds, presets, and the novelty algorithm live in
`references/alerts.md`. The principles that govern all of it:

- Alert on **state changes, not states**. "BTC is down 12% from your entry"
  is an alert once — not every hour that it remains true.
- Severity may only re-alert **upward**. Escalation notifies; decay updates
  the page silently.
- Every alert answers: what changed, how severe, since when, based on what
  evidence, and what to look at next.
- A scheduled run with nothing material to say writes its data and **stays
  silent**. Never send heartbeat notifications to prove the system is alive —
  the freshness badge on the Playbook does that job.

## 8. Definition of done

Do not report success until every line is true:

- [ ] Account read verified (or manual-holdings fallback explicitly chosen).
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
         destination (their chosen messaging channel or verified email).
- [ ] One test alert delivered — and only one (dedup verified) — checked
      *after* the four gates above, so a delivery failure points at the gate
      that broke instead of "alerts don't work".
- [ ] User told: what will alert, how often it refreshes, which defaults were
      applied, and how to tune sensitivity.

If any gate cannot pass (platform error, missing data coverage), deliver the
part that is verified, name the gap plainly, and propose the next step. Never
paper over a failed gate with a static page that looks alive.

## Reference files

| File | Read it when |
|---|---|
| `references/binance-portfolio.md` | Preflight, account scope, degradation ladder, symbol resolution |
| `references/feed-contract.md` | Designing or modifying the Feed schema |
| `references/producer.md` | Writing the producer script |
| `references/alerts.md` | Defining alert rules, thresholds, novelty gate |
| `references/playbook-ui.md` | Building, sharing, or remixing the Playbook |
