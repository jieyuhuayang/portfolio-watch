# Playbook UI: The Live Interface, Privacy, and Remix

The Playbook is where the user checks in between alerts. Its job is to answer
three questions in under ten seconds: **How am I doing? What changed? Can I
trust these numbers right now?**

## 1. Build order

Data before UI, always:

1. Feed exists, Automation is green, and history has ≥ 2 runs — a page built
   against an empty Feed gets designed around imagined data.
2. Read the platform's pre-build checklist for Playbooks; use the design
   system (tokens/components), not ad-hoc CSS.
3. Draft → design lint → release → screenshot, with the README written
   *before* release. The calibrated chain: write `index.html` and `README.md`
   to the playbook's ALFS directory → `alva release playbook-draft` →
   `alva lint playbook <local index.html>` (exit 0 required) →
   `alva release playbook --readme-url` with the README's **absolute** ALFS
   path → `alva screenshot --url <published_url>`. Lint and screenshot are
   gates, not chores: lint catches design-contract violations, and the
   screenshot passes only if it shows **real feed-backed values** — a blank
   frame, headers-only table, or loading state is a data-rendering failure,
   not a pass.

## 2. Layout contract

Top to bottom — order mirrors the ten-second scan:

1. **Header band**: NAV, 24h P&L (value + %), drawdown from 30d high,
   **as-of timestamp**, freshness badge.
   - Badge states: `live` (last run on schedule, stale_count = 0) /
     `partial` (stale_count > 0 — "N assets showing last known price") /
     `stale` (missed runs — banner with last successful run time).
   - The badge reads `stale_count`/timestamps/`market_state` from the Feed;
     the page never computes its own optimistic freshness. **Market-aware**:
     when `market_state` is `closed`, the badge reads "as of <close time> ·
     market closed" and renders as `live` — a weekend must never display as
     `stale`, or the one badge that must stay meaningful goes numb.
2. **Holdings table** (`positions`): asset, value, weight bar, 24h/7d change,
   move_score flag (⚡ when ≥ preset K). Default sort: weight. Stale rows
   visibly muted with a "carried price" marker. `OTHER` row expandable.
   **Exposure variant (v4, when targets/β exist)**: add weight-vs-target
   band bars, a residual column ("how much of today's move was this asset's
   own"), and an exposure strip above the table — effective bets, avg
   pairwise correlation, benchmark in use. The strip answers the question a
   concentrated holder actually has: *how many independent bets am I really
   running?*
3. **NAV chart** (`portfolio_nav`): line + drawdown shading; alert markers on
   the dates they fired.
4. **Alert timeline** (`alerts`): newest first — headline, severity chip,
   evidence time, expandable detail. This is the alert channel's audit trail;
   it is how a user learns to trust that silence meant nothing happened.
5. **Method panel** (from README content): what is watched, active preset and
   its thresholds, refresh cadence, known blind spots (spot-only, unpriced
   assets, cost-basis rung), and where the data comes from.

**Watchlist variant** (bare-watchlist mode, no quantities —
`portfolio-source.md` §2): the same scan order with the NAV math honestly
absent, never faked:

1. Header band without NAV/P&L: N assets watched, biggest mover since prior
   close, as-of timestamp, market-aware freshness badge.
2. Watch table: drops the value/weight columns; keeps price, day change,
   move_score flag; adds next-earnings-date for equities.
3. Chart: per-asset performance rebased to 100 at watch creation ("since
   you started watching") instead of a NAV line.
4. A visibly-dark Tier-B panel: portfolio-level alerts (drawdown,
   concentration) are off because position sizes are unknown, plus the
   one-line unlock ("say 'I hold 20 NVDA' anytime, or connect an account").
5. Alert timeline and method panel unchanged.

Every rendered number is read from the Feed in the browser at view time. If
a field is missing, render an explicit gap ("—" with a tooltip), never a
remembered or hardcoded value — a plausible stale number is strictly worse
than a visible hole.

The mechanism (calibrated): load the platform's browser SDK and read feed
paths through its client with the viewer token
(`AlvaToolkit.AlvaClient` + `window.alva.udf.getViewerToken()`, `api_origin`
as `baseUrl`) — never a raw `fetch` to the filesystem API with hand-written
auth. The SDK path works for public *and* private playbooks; the anonymous
fetch is public-only and silently breaks the page the day visibility
changes.

## 3. README contract

The README ships with the release and states, in the owner's language:
purpose, data sources, refresh cadence, alert rules in force (as the preset +
its table), method for P&L (or why P&L is period-based), and limitations.
It is versioned with the Playbook: change the thresholds, change the README
in the same release. An out-of-date README is a false label on a financial
product.

The playbook **description** (metadata, rendered under the title) has a
different audience than the README: it is the first paragraph a visitor
reads, before they've seen a single number. Write it as *why this page
exists and what it does for its owner* — whose problem, what it watches
for, when it speaks up — in plain words a non-quant understands. Never
make it a feature list of techniques ("leave-one-out β/residual,
hysteresis, effective bets…"): jargon belongs in the README's method
section, each term introduced with its one-line explanation. Test: would
the persona this page was built for understand their own page's opening
line?

## 4. Privacy and sharing

Default visibility: **as private as the tier allows**. This is wealth data;
the burden of proof is on sharing, never on hiding. Private *released*
playbooks are a paid-tier feature (the gateway denies `private`/`paid` for
free accounts); on free tier the honest ladder is **draft** (not published)
→ **share-safe release** (public, but only shapes/ratios) → paid-tier
private release. Never close the gap by publishing real balances, and never
flip a backing feed public with raw filesystem grants — feed visibility goes
through the feed's own visibility command so the record and permissions move
together.

When the user asks to share, offer two explicit modes:

- **Trusted-viewer share**: the real page to named people/groups the platform
  supports. Confirm the audience back to the user before release ("this shows
  your actual balances to everyone in that group").
- **Share-safe mode** (default suggestion for anything semi-public): a
  variant rendering only shapes and ratios — weights, % changes, drawdown,
  alert history — with absolute values (NAV, position values, quantities)
  removed *from the shared Feed exposure*, not merely hidden with CSS. Data
  the page doesn't receive can't leak; data merely unstyled can.

Share-safe mechanics — three rules that keep the variant honest:

1. **Same run, not a second pipeline.** The share-safe rows are produced by
   the *same producer run* that writes the private rows — one Automation,
   one clock. A second Automation recomputing "the same" numbers on its own
   schedule will disagree with the private page during every timing gap, and
   a public page that contradicts the private one reads as either a bug or a
   lie.
2. **The alert timeline survives, redacted.** Don't drop the alert history
   from the shared variant — it is the proof that silence means nothing
   happened, which is exactly what a public audience needs to trust the
   method. Mirror each alert with absolute values stripped (percentages,
   bands, severities stay).
3. **Preview before release, even for share-safe.** Before publishing the
   variant, show the user the rendered preview *and the list of fields it
   exposes*, and get an explicit yes. "Safe by construction" is the
   designer's claim; the user is the only one entitled to decide their risk
   posture — weights and drawdown history are still information about their
   wealth.

Never publish a public portfolio Playbook as a side effect of any other
request. If a completion gate requires public readability, that is a signal
the visibility choice is wrong, not a reason to flip the data public.

## 5. Remix: share the method, not the money

The remix story for a portfolio watch: the **method is the shareable asset;
the data binding is personal.**

- A remixer gets the template — layout, alert rules, presets, README — with
  lineage preserved, and binds **their own** source on setup (account
  connection, holdings list, or tickers — `portfolio-source.md` §2).
  They never inherit or see the original owner's Feed.
- Keep every user-tunable parameter (preset, dust threshold, cadence) in
  config, not hardcoded into producer logic or HTML — a template whose
  thresholds are buried in code is remixable in name only.
- The setup path for a remixer is the same preflight as §1 of the skill:
  connection check, degradation ladder, defaults, gates. A remix that skips
  the gates ships an untested watch under someone else's good name — lineage
  makes quality travel in both directions.

This is how "any user can generate a Playbook with UI and alerts" scales
beyond one build: the skill produces watches one at a time; remix turns the
best one into everyone's starting point.
