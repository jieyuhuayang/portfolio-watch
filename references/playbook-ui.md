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
3. Draft → design lint → screenshot review → README → release with correct
   visibility. Lint and screenshot are gates, not chores: lint catches
   contract violations, the screenshot is the only end-to-end integration
   test of browser + Feed + auth actually composing.

## 2. Layout contract

Top to bottom — order mirrors the ten-second scan:

1. **Header band**: NAV, 24h P&L (value + %), drawdown from 30d high,
   **as-of timestamp**, freshness badge.
   - Badge states: `live` (last run on schedule, stale_count = 0) /
     `partial` (stale_count > 0 — "N assets showing last known price") /
     `stale` (missed runs — banner with last successful run time).
   - The badge reads `stale_count`/timestamps from the Feed; the page never
     computes its own optimistic freshness.
2. **Holdings table** (`positions`): asset, value, weight bar, 24h/7d change,
   move_score flag (⚡ when ≥ preset K). Default sort: weight. Stale rows
   visibly muted with a "carried price" marker. `OTHER` row expandable.
3. **NAV chart** (`portfolio_nav`): line + drawdown shading; alert markers on
   the dates they fired.
4. **Alert timeline** (`alerts`): newest first — headline, severity chip,
   evidence time, expandable detail. This is the alert channel's audit trail;
   it is how a user learns to trust that silence meant nothing happened.
5. **Method panel** (from README content): what is watched, active preset and
   its thresholds, refresh cadence, known blind spots (spot-only, unpriced
   assets, cost-basis rung), and where the data comes from.

Every rendered number is read from the Feed in the browser at view time. If
a field is missing, render an explicit gap ("—" with a tooltip), never a
remembered or hardcoded value — a plausible stale number is strictly worse
than a visible hole.

## 3. README contract

The README ships with the release and states, in the owner's language:
purpose, data sources, refresh cadence, alert rules in force (as the preset +
its table), method for P&L (or why P&L is period-based), and limitations.
It is versioned with the Playbook: change the thresholds, change the README
in the same release. An out-of-date README is a false label on a financial
product.

## 4. Privacy and sharing

Default visibility: **private**. This is wealth data; the burden of proof is
on sharing, never on hiding.

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
  lineage preserved, and binds **their own** Binance connection on setup.
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
