# Portfolio Watch Skill — Approach

A user says "keep an eye on my NVDA, TSLA, and AAPL, ping me when something
big happens." What this Skill has to produce is not really a page. It is
judgment that watches money on the user's behalf, for a long time: the
generated Playbook runs dozens of times every trading day, and each run has
to answer the same question correctly — "is there anything worth telling
the user right now?" Getting it wrong costs asymmetrically. One false alarm
and the user stops trusting notifications; one missed risk and the user
loses money.

So my approach was to write down the full standard for "what deserves to
interrupt an investor" as a methodology an AI can execute strictly, make it
hold for any portfolio, and make it checkable against historical data. That
unfolds into three questions, which are the three parts of this page:
**what to trust, when to speak, and why believe it**.

## 1. What to trust: portfolios vary endlessly, truth follows one rule

First, what the generated Playbook actually is: a pipeline that runs on a
schedule, and each run does four things — **fetch prices, compute metrics,
judge whether anything is worth saying, then update the page and push a
notification if needed**. For a portfolio the skill has never seen, only
the pipeline's inputs vary: **where the holdings come from**, and **what
is in them**.

- **Three sources, all built on the spot**: a connected exchange account
  (truest data); holdings the user states (a pasted brokerage screenshot
  works, cash can be declared too); or just a few tickers. Tickers alone
  get built with zero follow-up questions. Missing quantities just means
  no NAV or drawdown yet; the page says exactly what is missing, and "I
  hold 20 NVDA" unlocks it anytime.
- **Asset classes are plug-ins**: everything that differs between US
  stocks, crypto, and A-shares comes down to two blocks — where prices
  come from, and which class-specific events to judge (earnings, gaps,
  price limits, depegs). Switching asset class swaps only those two
  blocks; the pipeline's four steps stay untouched. So supporting a new
  class means adding a module, not reworking the product.

Whatever the source, one iron rule holds: **every number on the page comes
from a real API call and carries its fetch time**. Three mechanisms
enforce it: the page reads live data every time it opens, so no number is
ever baked into the HTML; the AI only makes textual judgments (say,
whether a news item matters) while every price, value, and P&L figure is
fetched by code; and when a fetch fails, the asset is marked stale and its
alerts are paused — bad data never gets a voice.

## 2. When to speak: only when it's worth it

**What to watch?** Risk is read in four layers, from close-up to wide:

1. **Each asset**: price moves, major news, earnings, gaps;
2. **Between assets**: correlated stocks falling together is one event,
   not several — strip out the market's influence first, and only what
   remains counts as that stock's own news;
3. **The whole portfolio**: drawdown, concentration, drift from the
   user's own target weights. Concentration isn't a position count; it's
   "effective independent bets" — five AI stocks can amount to just 1.8;
4. **The system itself**: if the account connection breaks, the user
   hears about it once, and only once.

**How big is big?** Relative to each asset's own volatility, never one
flat percentage: a 5% day is routine for a mid-cap and a catastrophe for a
stablecoin. And only band crossings count: drawdown moving from 9% to 11%
enters a new range and gets said once; hovering around 10% stays silent.

**What stays unsaid?** Four kinds of noise, each suppressed:

- Already said: each state notifies once; worse gets said again,
  recovery just updates the page quietly;
- Flip-flopping: a state notified moments ago that keeps re-crossing the
  threshold doesn't interrupt again;
- Market-driven: the index drops 3% and drags a stock down 3% — that's
  market news, and it doesn't get dressed up as stock news;
- Bad data: on a fetch error the page says "stale" rather than ever
  sounding an alarm on a broken number.

After all that, the user gets one sentence they can hold the product to:
"on the normal setting, roughly one or two a week." Replayed against the
past year of real prices, 82% of trading days were in fact silent.

**Several things at once?** Merge first, then rank: a sector-wide move
becomes one sector alert, not five stock alerts; each run sends at most one
digest, ordered by severity inside.

**And after it rings?** Every alert carries an "Open Playbook" button that
lands on the relevant part of the page. The alert is the doorbell; the
page is the full answer.

## 3. Why believe it: every design claim was tested against reality

The first two sections are design. This one answers a different question:
has any of it been tested outside the document? Four claims, each with
evidence from the live Alva platform.

- **"It holds for any portfolio"** — three real Playbooks were built from
  three completely different inputs: a connected-account crypto
  portfolio, a US-stock watchlist made of three bare tickers, and a
  declared A-share book concentrated in one name, with target weights and
  cash. All three are released and reading live data (links in
  SUBMISSION).
- **"It only interrupts when it's worth it"** — verified by real markets
  in both directions. It speaks: the day after NVDA's earnings, the
  US-stock watch sent three alerts (intraday move, escalation, close
  confirmation), each recorded as "delivered" in the platform's logs. It
  stays quiet: over the same stretch, the A-share watch ran 29 times with
  zero alerts, and indeed nothing material happened to that book. On top
  of that, the page embeds a 12-month replay of the alert rules, which
  exposed three design flaws in turn (re-alerting at band edges,
  ex-dividend days on unadjusted prices misread as crashes, replay code
  drifting from live behavior); after the fixes, live, replay, and the
  offline tests share one judgment module.
- **"Every number is real"** — each platform call the skill prescribes
  was verified individually, and the skill's data model was compared
  field by field against the platform's own first-party portfolio watch.
  The comparison confirmed two design choices: tickers without quantities
  are a proper input, not a broken one; and confirming delivery means
  checking both whether the user switched it on and whether the channel
  actually exists.
- **"The AI will follow it"** — four rounds of behavioral evals, using
  real user phrasings (including easy-to-fail cases like "just these
  tickers, don't ask me back" and "this is too chatty") to grade every
  decision the AI makes under this skill: 63 of 63 pass, against 42 for a
  control group without the skill loaded.

## 4. After launch: how to measure it, and what's still missing

**How to measure it**: one number worth watching is **weekly active
watches that have not been muted** — users mute a watch before they
abandon it, so "unmuted" reflects a change in trust earlier than "active"
does. Alongside it, alert open-rate (it deteriorates before the mute rate
does). And one hard line to hold: no number may ever appear on the page
without a nameable data source — the iron rule from section 1, which
after launch turns from a design principle into a quality check that must
be run continuously.

**Current boundaries** (stated plainly in the product): declared holdings
don't yet support shorts or non-USD positions, and a declared list is
maintained by the user, so the page labels it "as declared on ‹date›".

**Next, two things**: a one-tap "useful / noise" button on each alert,
feeding back into thresholds; and futures/margin as a separate module
with its own liquidation-distance warnings.
