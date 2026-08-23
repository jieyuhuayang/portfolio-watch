# Producer: The Scheduled Script That Does the Judging

The producer is the deterministic heart of the watch. It runs in the jagent
runtime on a schedule, and it — not the LLM, not the page — is where numbers
are computed and change is judged.

## 1. Runtime ground rules

- Each run starts cold: no memory of the previous run except what was written
  to the Feed/KV/ALFS. If next run needs it, persist it this run.
- This is not Node.js: no Node built-ins, no local filesystem, no global
  `fetch`, and **no top-level `await`** — wrap the entire script body in an
  async IIFE, `(async () => { ... })();`, and do all async work inside it.
  Use the platform modules for HTTP, storage, secrets, data skills, and
  inference.
- **Verify against current SDK docs before writing code.** Signatures in this
  file were calibrated against the platform docs at time of writing, but the
  platform's own reference (`alva sdk doc` / CLI help / skill references) is
  the contract. A producer written from memory of an older SDK is the #1
  cause of "works in chat, dies on schedule".
- **Fail fast on required inputs; degrade only declared partial states.** The
  platform's guidance is to let unexpected failures throw — a visible failed
  run beats silently-corrupt data, so never wrap fetches in catch blocks that
  continue with empty arrays or fabricated fallbacks. This skill's carry-last-
  price ladder is a *narrow, explicit* exception for per-asset price gaps: the
  gap is written as `pricing:"carried" / stale:true` (visible state, not a
  swallowed error), alerts for that asset are suppressed, and anything beyond
  that — account read failure, majority-stale pricing, invalid response
  shapes — throws and surfaces as a failed run.

## 2. Run structure (annotated template)

```js
// portfolio-watch producer — Feed SDK shapes calibrated against the current
// docs; helper functions (priceAssets, computeSnapshot, …) are this skill's
// structure, not platform API. Re-verify module surfaces on build.

const { Feed, feedPath, makeDoc, num, str, alertOutput } = require("@alva/feed");

const feed = new Feed({ path: feedPath("portfolio-watch") });
// Declare ALL outputs up front — never conditionally, never inside run().
feed.def("positions", { snapshot: makeDoc(/* per-asset fields */) });
feed.def("portfolio_nav", { series: makeDoc(/* nav fields */) });
feed.def("events", { log: makeDoc(/* event fields */) });
feed.def("alerts", {
  log: makeDoc(/* audit-trail fields — regular output */),
  digest: alertOutput(                       // the ONE delivered output
    makeDoc("Alert digest", "Material-change digest",
      [str("title"), str("body")])),         // root `body` required by platform
});

(async () => {                               // no top-level await in jagent
  await feed.run(async (ctx) => {
    // ── 1. Account truth ──────────────────────────────────────────
    const balances = await readBinanceSpotBalances();
    // Auth failure? → degrade per binance-portfolio.md §5:
    // carry last snapshot, stale banner, ONE `connection` alert, return.

    // ── 2. Pricing (data skills, fresh discovery) ─────────────────
    const priced = await priceAssets(balances);
    // per-asset failure → pricing:"carried", stale:true, NO alerts for it.
    // >50% of NAV stale → write the nav row with stale_count, suppress ALL
    // alerts this run. Never judge a portfolio you can only half see.

    // ── 3. Bounded history (real read surface: last/first/range) ──
    const nav    = ctx.self.ts("portfolio_nav", "series");
    const prev   = await nav.last(1);
    const now    = Date.now();
    // No nearest-timestamp API: read a bounded window, pick closest row.
    const near24 = await nav.range(now - 26 * 3600e3, now - 22 * 3600e3);
    const win30d = await nav.range(now - 30 * 86400e3, now);
    // KV values are raw strings — JSON round-trip structured state.
    const sigmas = JSON.parse((await ctx.kv.load("sigma20d")) || "{}");

    // ── 4. Deterministic computation ──────────────────────────────
    const snapshot = computeSnapshot(priced, sigmas);      // positions rows
    const navRow   = computeNav(snapshot, near24, win30d); // nav row

    // ── 5. Evidence (the ONLY LLM step) ───────────────────────────
    const events = await synthesizeEvents(ctx, snapshot);  // see §3

    // ── 6. Judgment + novelty gate ────────────────────────────────
    const candidates = evaluateAlertRules(snapshot, navRow, events);
    const survivors  = await noveltyGate(ctx.kv, candidates); // alerts.md

    // ── 7. Persist (order matters: data first, alerts last) ───────
    const runTs = now;                       // batch: all rows share run ts
    await ctx.self.ts("positions", "snapshot")
      .append(snapshot.map(r => ({ date: runTs, ...r })));
    await ctx.self.ts("portfolio_nav", "series")
      .append([{ date: runTs, ...navRow }]);
    await ctx.self.ts("events", "log")
      .append(events.fresh);                 // date = event PUBLISH time
    await ctx.self.ts("alerts", "log")
      .append(survivors.map(s => ({ date: runTs, ...s })));  // audit trail
    if (survivors.length) {
      // Platform contract: at most ONE record per declared source per run.
      await ctx.self.ts("alerts", "digest")
        .append([{ date: runTs, ...composeDigest(survivors) }]);
    }
    await ctx.kv.put("fingerprints", JSON.stringify(nextFingerprints));
    // Fingerprints commit AFTER the alert writes — if the alert write
    // failed, fingerprints must not claim it was sent.
  });
})();
```

Write data before alerts and fingerprints after alerts: a crash mid-run must
never leave the system believing it notified the user when it didn't (missed
alert) or that it didn't when it did (duplicate next run). Choose the failure
you can live with — here, a rare duplicate beats a silent miss, so
fingerprints commit last.

**Every write must be idempotent.** A run can die after some writes and be
retried, so design each append to be safely repeatable: key appends by
stable identity (`alert_id` fingerprint, `event_id`, run-stamped NAV rows)
and dedupe on that key before writing, so a retry converges to the same
state instead of doubling rows. The same applies to any tool call with side
effects mid-run — if you can't make it idempotent, make it last, so a retry
replays nothing before it. "Retried the run" must never be a user-visible
event.

## 3. The LLM's cage (alpi usage)

alpi does exactly one job here: turn fetched evidence into classified,
summarized events.

Call shape, calibrated against the current alpi docs (`@alva/pi`) — re-verify
on build:

```js
const { Agent, Type } = require("@alva/pi");

const agent = new Agent({
  // NO getApiKey in the online runtime: jagent injects platform credentials
  // host-side. getApiKey exists only for bring-your-own-key, and then it must
  // load from require("secret-manager") — never an inline key.
  initialState: {                          // behavior config nests here
    systemPrompt: MATERIALITY_PROMPT,      // the cage, verbatim below
    tools: [                               // adapters, one job each
      { name: "fetchVerifiedSource", description: "…",
        parameters: Type.Object({ url: Type.String() }),
        execute: async (_id, { url }) => ({
          content: [{ type: "text", text: await fetchSource(url) }] }) },
      /* readFeedHistory … */
    ],
    // thinkingLevel: omit to use the runtime default
  },
});

// ask() takes a plain string; the RESPONSE message is content blocks:
const { message } = await agent.ask(evidenceBundle);
const text = message.content
  .filter((b) => b.type === "text").map((b) => b.text).join("");
```

Configuration principles:

- **System prompt** pins the role: "You classify news relevance and
  materiality for specific held crypto assets. You are given fetched source
  text. You never estimate prices, balances, or percentages. Output strict
  JSON: `{asset, materiality: high|medium|low, synopsis}`. Materiality means:
  would a holder of this asset plausibly act on this? Protocol hacks,
  delistings, regulatory actions, tokenomics changes → high. Routine price
  commentary, influencer opinions, 'top 10 coins' listicles → low."
- **Tools**: fetch-verified-source, read-feed-history (to see what was
  already covered). No tool that writes numbers.
- **Defensive parse**: malformed JSON → drop the item, log it, continue. A
  lost news item costs little; a crashed run costs the whole cycle.
- Every emitted event keeps its `source_url`. An event alpi cannot source is
  an event that does not exist.

The boundary rule: **any number a user can see travels from API → arithmetic
→ Feed without passing through a model.** alpi's output lands only in
`events.materiality` and `events.synopsis` — words, not numbers.

## 4. Verification before scheduling

Manual verification uses **`alva run`** (`--entry-path` at the feed's src
path) — it exercises the script without backend alert fanout. Do **not**
"test" with `alva deploy trigger`: trigger is not a dry run, and because
publishing an automation creates the owner's alert binding immediately, a
trigger can deliver a real notification.

Run manually twice, minutes apart, and check:

1. Run 1 writes all groups; row counts and fields match the contract.
2. Run 2 **reads run 1's history** (prev/nav lookups return data) and the
   novelty gate suppresses everything run 1 already covered — two manual
   runs should produce at most one alert set, not two.
3. Force one failure (e.g., an unpriceable fake asset in a test list) and
   confirm the degradation path: carried value, stale flag, no alert.

Only then schedule. A producer that has never been watched consuming its own
history has not been tested — the second run is where state bugs live.
