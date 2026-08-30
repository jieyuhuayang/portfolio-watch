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

For a portfolio the skill has never seen, only two things actually vary:
**where the holdings come from**, and **what is in them**.

- **Three sources, all built on the spot**: a connected exchange account
  (truest data); holdings the user states (a pasted brokerage screenshot
  works, cash can be declared too); or just a few tickers. Tickers alone
  get built with zero follow-up questions. Missing quantities just means
  no NAV or drawdown yet; the page says exactly what is missing, and "I
  hold 20 NVDA" unlocks it anytime.
- **Asset classes are plug-ins**: US stocks, crypto, and A-shares each
  bring their own sessions, quoting, and special events (earnings, gaps,
  price limits, depegs), while the main line — fetch, judge, alert,
  render — stays untouched. Supporting a new class means adding a module,
  not reworking the product.

Above all of it sits one iron rule: every number on the page can name the
endpoint and timestamp it came from. The AI never invents a number; if a
price can't be fetched, the asset is marked stale and nothing fires.

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

## 3. Why believe it: every claim has a matching fact on the platform

**The skill has produced three real Playbooks on Alva**, deliberately fed
three completely different inputs: a connected-account crypto portfolio, a
US-stock watchlist built from three bare tickers, and a declared A-share
book concentrated in one name, with target weights and cash. All three are
released and reading live data (links in SUBMISSION).

**What should ring rang; what shouldn't, didn't.** The day after NVDA's
earnings, the US-stock watch sent three alerts — intraday move, escalation,
close confirmation — each one traceable to a "delivered" receipt in the
platform's records. Over the same stretch, the A-share watch ran 29 times
and said nothing, because nothing happened.

**The rules were caught wrong three times — by their own replay.** The page
embeds a 12-month replay of the alert rules, and it exposed three design
flaws in turn: re-alerting at band edges, ex-dividend days on unadjusted
prices misread as crashes, and the replay code quietly drifting from live
behavior. After the fixes, live, replay, and the offline tests share one
judgment module. "Silence means nothing happened" is a measured number,
not a slogan.

**Every platform call was verified one by one**, including a
field-by-field comparison with the platform's own first-party portfolio
watch data model. The comparison confirmed two key choices: tickers
without quantities are a proper input, not a broken one; and confirming
delivery means checking two things — whether the user switched it on, and
whether the channel actually exists.

**How well does the AI execute it? Tested four rounds.** Real user
phrasings — including easy-to-fail ones like "just these tickers, don't
ask me back" and "this is too chatty" — grade every decision the AI makes
under this skill: 63 of 63 pass; the same questions without the skill
loaded pass 42.

## 4. Boundaries and next

The north-star metric is **weekly active watches that haven't been
muted**: a muted watch is churn that just hasn't happened yet. Two
boundaries are written plainly into the product: declared holdings don't
yet support shorts or non-USD positions, and a declared list is maintained
by the user, so the page labels it "as declared on ‹date›". Next, two
things: a per-alert "useful / noise" button feeding back into thresholds,
and futures/margin as a new module with its own liquidation-distance
warnings.
