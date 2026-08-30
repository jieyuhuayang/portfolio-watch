# Portfolio Watch Skill — Approach

A user says "keep an eye on my NVDA, TSLA, and AAPL, ping me when something
big happens," and this skill turns that sentence into a running Playbook: a
live holdings page, plus an alert channel that only speaks when something
actually matters. Every piece of methodology in the skill serves one
promise: **"no alert" must reliably mean "nothing happened"** — for a
product that watches people's money, the first ignored alert is the
beginning of churn. That promise breaks down into three disciplines: every
number on the page is traceable (the AI never invents one), every
interruption must be worth it (noise is suppressed systematically), and the
rules themselves can be checked against history (not "this feels
reasonable," but "replay the past year — it alerted on the right days and
stayed quiet on the rest").

## 1. Reusability: a fixed methodology with swappable modules

An "unseen portfolio" only varies along two axes: **where the holdings come
from**, and **what's in them**.

- **Three sources, all built immediately**: a connected exchange account
  (truest data); holdings the user states (a pasted brokerage screenshot
  works, cash can be declared too); or just a few tickers. The brief's own
  sentence gives only three tickers — the skill builds it with zero
  follow-up questions. Missing quantities just means no NAV or drawdown
  yet; the page says so plainly, and "I hold 20 NVDA" unlocks it anytime.
- **Asset classes are plug-ins**: US equities, crypto, and A-shares each
  bring their own sessions, quoting, and alert kinds (earnings, gaps,
  price limits, depegs), while the core pipeline — fetch, judge, alert,
  render — stays untouched. Supporting a new class means adding a module,
  not changing the product.

That's how one skill produced three completely different portfolios (see
Evidence) without touching its core.

## 2. Interface and alerts: the brief's four questions, four answers

**Which dimensions to watch?** Four layers, by where the risk lives: single
assets (price, news, earnings, gaps); the cross-section (correlated names
falling together is **one** event, not five; what remains after stripping
the market's influence — the residual — is that stock's own news); the
portfolio (drawdown, concentration, drift from the user's own target
weights); and the system (a broken account connection). Concentration is
measured in "effective independent bets" — five AI stocks can amount to
just 1.8 of them, and that number is closer to a concentrated holder's real
risk than the position count.

**What counts as a material move?** Relative to each asset's own
volatility, never a flat percentage — a 5% day is routine for a mid-cap and
a catastrophe for a stablecoin. And only state *transitions* count: drawdown
going from 9% to 11% enters a new band and alerts once; oscillating around
10% stays silent.

**What is noise?** Four kinds, all explicitly suppressed: things already
said (each state notifies once), things oscillating (cooldown), market
moves masquerading as single-stock news (strip the market's move before
judging), and data
failures (if a price fetch fails, mark the asset stale and say nothing —
one false alarm from bad data ends the trust). What survives is translated
into a promise the user can hold the product to: "about 1–2 a week on the
normal setting" — the replay measures ~3.7 alert-days per month, with 82%
of trading days quiet.

**How are simultaneous signals ordered?** Merge first, then rank: a sector
move absorbs that run's single-name signals, a residual signal absorbs the
raw one, and each run sends **at most one digest**, ordered by severity
inside. Only escalation interrupts again; recovery updates the page
silently.

**Once an alert reaches the phone**, it carries an "Open Playbook"
deep-link button straight to the relevant part of the page — the alert is
the doorbell; the page is the full answer.

## 3. Evidence: three live Playbooks, delivery proven in both directions

- **Three real builds spanning the full input range** (links in
  SUBMISSION): a connected-account crypto portfolio, the brief's literal
  sentence as a US-stock watchlist, and a concentrated A-share book with
  declared holdings (price-limit, ex-dividend, and lunch-break semantics
  included). All live-reading, all released.
- **Delivery verified in both directions by real markets**: the US-stock
  demo fired three real alerts on NVDA's post-earnings day (intraday move,
  escalation, close confirmation), each with a platform delivery receipt;
  the A-share demo ran 29 times in the same period with zero alerts —
  because nothing happened. What should ring rang; what shouldn't, didn't.
- **The rules were caught wrong three times — by their own replay**: a
  12-month historical replay rendered on the page itself exposed
  band-edge re-alerting, ex-dividend days on unadjusted prices posing as
  crashes, and the replay implementation quietly drifting from live
  behavior. After the fixes, live, replay, and the offline test suite run
  one shared judgment module — "silence is information" went from slogan
  to measured number.
- **Every platform call is individually verified**, including a
  field-by-field comparison against the platform's own first-party
  portfolio watch data model — which confirmed two of this skill's key
  positions: tickers-without-quantities is a first-class input, and
  delivery means checking both "the user switched it on" and "a real
  endpoint exists."
- **Four rounds of behavioral evals**: real user phrasings (including
  traps like "only tickers, don't ask back" and "too chatty") test how
  well the AI executes the skill — 63/63, against a 42/63 baseline
  without the skill loaded.

## 4. Boundaries and next

The north-star metric is **weekly active *and unmuted* watches** — a muted
watch is churn that hasn't happened yet, so the guardrails track alert
open-rate and "fabricated numbers: always zero." Stated boundaries:
declared mode doesn't yet support shorts or non-USD holdings (said plainly,
not papered over). Next: per-alert "useful / noise" feedback recycled into
thresholds, and futures/margin as a new module with its own
liquidation-distance alerts.
