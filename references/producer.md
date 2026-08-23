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
- **Verify against current SDK docs before writing code.** Module names and
  signatures below are structural pseudocode; the platform's own reference
  (`sdk docs` / CLI help) is the contract. A producer written from memory of
  an older SDK is the #1 cause of "works in chat, dies on schedule".

## 2. Run structure (annotated template)

```js
// portfolio-watch producer — structural template.
// Resolve real module names/signatures from current SDK docs before use.
// The whole script is one async IIFE: the runtime rejects top-level await.

(async () => {
  const out = feedWriter();                   // feed writer  (resolve real module)
  const kv  = kvStore();                      // KV state     (resolve real module)

  // ── 1. Account truth ────────────────────────────────────────────
  const balances = await readBinanceSpotBalances();
  // Auth failure? → degrade per binance-portfolio.md §5:
  // carry last snapshot, stale banner, ONE `connection` alert, return.

  // ── 2. Pricing (data skills, fresh discovery) ───────────────────
  const priced = await priceAssets(balances);
  // per-asset failure → pricing:"carried", stale:true, NO alerts for it.
  // >50% of NAV stale → treat as run-level failure: write nav row with
  // stale_count, suppress ALL alerts this run. Never judge a portfolio
  // you can only half see.

  // ── 3. Bounded history ──────────────────────────────────────────
  const prev    = await out.read("portfolio_nav", { last: 1 });
  const nav24   = await out.read("portfolio_nav", { nearest: hoursAgo(24) });
  const nav30d  = await out.read("portfolio_nav", { window: days(30) });
  const sigmas  = await getOrRefreshSigmas(kv, priced);   // daily refresh

  // ── 4. Deterministic computation ────────────────────────────────
  const snapshot = computeSnapshot(priced, sigmas);        // positions rows
  const navRow   = computeNav(snapshot, nav24, nav30d);    // nav row

  // ── 5. Evidence (the ONLY LLM step) ─────────────────────────────
  const events = await synthesizeEvents(snapshot);         // see §3

  // ── 6. Judgment + novelty gate ──────────────────────────────────
  const candidates = evaluateAlertRules(snapshot, navRow, events); // alerts.md
  const survivors  = await noveltyGate(kv, candidates);            // alerts.md

  // ── 7. Persist (order matters: data first, alerts last) ─────────
  await out.write("positions", snapshot);
  await out.append("portfolio_nav", navRow);
  await out.append("events", events.fresh);
  await out.append("alerts", survivors);      // platform delivers these
  await updateFingerprints(kv, survivors);    // AFTER successful write —
  // if the alert write failed, fingerprints must not claim it was sent.
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

Structural shape of the call (**illustrative, not a signature** — resolve the
real API from the current SDK docs before writing code; field names below
follow the platform's documented layout at time of writing):

```js
// Agent behavior config nests inside initialState; credentials sit outside.
const agent = new Agent({
  getApiKey: /* platform-provided key resolution — outer level, not state */,
  initialState: {
    systemPrompt: MATERIALITY_PROMPT,      // the cage, verbatim below
    tools: [fetchVerifiedSource, readFeedHistory],
    thinkingLevel: /* per SDK docs */,
  },
});
// message is a content-blocks object, not a bare string:
const reply = await agent.send({
  message: { content: [{ type: "text", text: evidenceBundle }] },
});
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

Run manually twice, minutes apart, and check:

1. Run 1 writes all groups; row counts and fields match the contract.
2. Run 2 **reads run 1's history** (prev/nav lookups return data) and the
   novelty gate suppresses everything run 1 already covered — two manual
   runs should produce at most one alert set, not two.
3. Force one failure (e.g., an unpriceable fake asset in a test list) and
   confirm the degradation path: carried value, stale flag, no alert.

Only then schedule. A producer that has never been watched consuming its own
history has not been tested — the second run is where state bugs live.
