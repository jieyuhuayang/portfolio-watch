# Calibration Report — Skill vs. Real Platform (Phase 2)

Every platform concept, command, and module named by this skill, checked
against the real surface. Sources, by authority: (1) live CLI `--help` tree
(`@alva-ai/toolkit` 0.26.0, captured in `calibration-raw/help-tree.txt`),
(2) official skill references (github.com/alva-ai/skills, `skills/alva/references/`),
(3) field-research behavioral evidence. Items marked **[unverified-live]**
could not be exercised against the runtime because the account's credit
balance was 0 at calibration time (`alva run` → `RATE_LIMITED: positive
credit balance required`); they rest on documentation only and are labeled
accordingly in the skill.

Verdicts: ✅ skill already correct · 🔧 skill fixed in this phase · ⚠️ noted
as known tension, deliberate deviation documented.

## 1. Object model and terminology

| Check | Real form | Verdict |
|---|---|---|
| "Feed" as internal object | `alva automation` is "the product-facing surface for what older CLI commands called feeds; ids are currently the same underlying feed ids" (CLI help, verbatim). UI never shows "Feed". | ✅ v2 already has the dialect section |
| "Subscribe" ambiguity | `alva subscriptions --help` itself warns: "Three DISTINCT concepts share the word subscribe: FOLLOW / ALERTS / PURCHASE". | ✅ skill's trap note matches the CLI's own warning |
| Automation → cronjob → run hierarchy | `alva deploy` manages the producer cronjob; `alva automation` the feed lifecycle; `alva release playbook` the published page. Three separately-stored objects; deleting one does not cascade. | ✅ |

## 2. Feed SDK (`@alva/feed`)

| Check | Real form | Verdict |
|---|---|---|
| Output modes | Documented patterns: **A** snapshot (latest-wins, start-of-day date), **B** event log (natural event timestamps), **C** tabular versioned batch (all rows share run ts, auto-grouped), **D** declared alert output (`alertOutput(typeDoc)` wrapper), **E** AlvaAsk agent feed. | 🔧 feed-contract.md now names the real pattern for each group |
| API surface | `const { Feed, feedPath, makeDoc, num, str, bool, obj, arr, fld, alertOutput, messageActionsField, messagePresentationField, openUrlAction, sendPromptAction, cardPresentation } = require("@alva/feed")`; `feed.def(group, outputs)` before `feed.run(cb)`; `ctx.self.ts(group, output).append(records)`. **[unverified-live]** (doc-verified only) | 🔧 producer template aligned |
| History reads | `ts.last(n, before?)`, `first(n, after?)`, `range(from, to)`, `lastDate()`, `count()`; CLI/FS reads via `@last/{n}`, `@range/{startMs}..{endMs}`, `@before/{ts}/{limit}`, `@after/{ts}/{limit}`, `@count`. `@last` returns oldest-first. | 🔧 producer.md pseudo-reads (`out.read(..., {nearest: ...})`) replaced with the real read set; "nearest 24h ago" is implemented with `before`/`range`, not a nearest-lookup API |
| KV state | `ctx.kv.put(key, value)` / `ctx.kv.load(key)`, **values are raw strings** (JSON.stringify structured state). | 🔧 noted in feed-contract.md |
| Dedup semantics | `append()` dedupes **by `date`** (ON CONFLICT DO UPDATE); same-date records transparently grouped and auto-flattened on read; `last(N)` limits unique timestamps, not records. | 🔧 idempotency section now leans on the platform's own date-keyed dedup |
| Alert output contract | Root `body` string **required**, `title` optional; max **1 alert record per declared source per execution**, 16 across sources; declare before `run()`, never conditionally; quiet run = do not append; reserved legacy sources `signal/targets`, `notify/message` must not be wrapped. | 🔧 major: `alerts` group split into an audit-log output plus a declared alert digest output — see feed-contract.md §1. The skill's "one digest per run" rule turns out to be platform-enforced, not just product judgment |
| Alert actions/cards | `messageActionsField()` + `openUrlAction()`/`sendPromptAction()`, `messagePresentationField()` + `cardPresentation()`. A free-standing `url` field does **not** become a button. | 🔧 alerts.md "where to look next" now cites `openUrlAction` |
| Group naming | Never name a group `data` (synth mount collision). | 🔧 noted in feed-contract.md |
| Error philosophy | Official: **fail fast** — no catch-and-continue with fallback records; conditionals only for expected business states; throw on invalid shapes. | ⚠️ tension with the skill's carry-last-price degradation. Reconciled: required inputs (account read, full pricing failure) throw → visible failed run; a *minority* of per-asset gaps is modeled as an expected business state, written explicitly as `pricing:"carried" / stale:true` (never silently), with alerts suppressed. Documented as a deliberate, visible deviation in DESIGN.md |

## 3. Alert delivery chain

| Check | Real form | Verdict |
|---|---|---|
| Gate 1: declared output | `alertOutput(typeDoc)` with root `body`. | ✅ |
| Gate 2: producer capability | `--push-notify` on the cronjob ("Let successful Feed runs deliver declared alert outputs"); default ON for new automation producers; `alva deploy update --id X --push-notify`. | ✅ command names now exact |
| Gate 3: binding | `alva automation publish` creates an **ACTIVE owner FEED alert binding** (even with `--skip-auto-trigger`); other viewers via `alva alert enable --automation <owner>/<name>` or `--automation-ids a,b [--channel-id N]`. Follow ≠ alert: "Following or unfollowing a playbook never changes alerts" (push-notifications.md, verbatim). | ✅ |
| Gate 4: destination | `alva automation delivery get/update --id N` (Alva channel ids + verified email; partial updates only); default personal destination `channel_id=0`; external DM via `active_im_provider`. | 🔧 alerts.md delivery chain now names the exact read/update commands |
| Delivery proof | "An ALFS record alone is not delivery proof. Claim real delivery only when an `alva alert history` row records the run as `sent`." (verbatim). Also `alva notification-history list-feed`. | 🔧 definition-of-done test-delivery gate now cites `alert history` as the evidence |
| Test-run semantics | `alva deploy trigger` is **not a dry run** — may deliver real alerts; `alva run` is the non-delivering check; publish already admits one auto first-run (suppress with `--skip-auto-trigger`). | 🔧 SKILL.md §5 verification rewritten around run-vs-trigger |

## 4. Playbook chain

| Check | Real form | Verdict |
|---|---|---|
| Chain | `alva fs write` HTML+README → `alva release playbook-draft` → `alva lint playbook <local.html>` → `alva release playbook --readme-url /alva/home/<u>/playbooks/<name>/README.md` → `alva screenshot --url <published_url>`. Platform ships its own HARD-GATEs (`before-playbook-draft`, `before-playbook-release`). | ✅ chain as assumed; exact flags now in playbook-ui.md |
| Data binding | Published HTML must read feeds at runtime via `AlvaToolkit.AlvaClient` (browser SDK + PBSV viewer token) — raw `fetch` to `/api/v1/fs/read` is public-only and breaks on private playbooks. | 🔧 playbook-ui.md names the mechanism |
| Screenshot gate | Screenshot the deployed `published_url`; pass only if real feed-backed marks/rows/values are visible — blank frames and loading states are failures. | ✅ matches "the screenshot is the integration test" |
| **Visibility by tier** | **Free tier: released playbooks are always public; private/paid are Pro-gated (gateway PERMISSION_DENIED).** Draft is the pre-publication state. This account is `free`. | 🔧 major: privacy flow is now tier-aware — see SKILL.md §6. "Private by default" is achievable on free tier only as *draft* or as *share-safe content*; the skill must never resolve this by silently publishing real balances |
| Playbook quota | deployment.md mentions a "free-tier 1-playbook cap"; pricing page says "Unlimited Playbooks" for Free. Conflict. **[unverified-live]** — check `alva playbooks mine` before the demo build. | ⚠️ verify at Phase 3 |
| Feed visibility | `alva feed set-visibility --id N --visibility public|private`; direct `fs grant` on feed paths is rejected (state drift). | 🔧 noted in playbook-ui.md share-safe mechanics |

## 5. Producer runtime (jagent)

| Check | Real form | Verdict |
|---|---|---|
| Async model | No top-level await; whole script is `(async () => { ... })();` — also observed verbatim in production agent-authored scripts. | ✅ (v2 change already) |
| Module set | `alfs` (absolute paths), `env` (userId/username/args), `net/http` (`http.fetch`), `secret-manager`, `@alva/feed`, `@alva/algorithm` (jStat + 50 indicators — σ comes from `jStat.stdev`), `@alva/pi`, `@alva/onnx`. No Node builtins, no timer globals. | ✅ |
| `@alva/adk` | Listed in `alva run --help` ("Agent SDK for LLM tool calling") but absent from the official skill references, which document `@alva/pi` instead. Not exercised live. | 🔧 skill references only alpi; adk mentioned nowhere (it never was) — recorded here as "exists in CLI help, undocumented, unverified" |
| Limits | Heap 256 MB default (`--max-heap-size-mb` ≤ 2048); cronjob min interval 1 min; write payload 10 MB; HTTP body ≤ 128 MB; separate KV watermarks per source cadence. | ✅ |

## 6. alpi (`@alva/pi`)

| Check | Real form | Verdict |
|---|---|---|
| Construction | `new Agent({ initialState: { systemPrompt, tools, thinkingLevel } })`. Tools: `{ name, description, parameters: Type.Object({...}), execute: async (toolCallId, params) => ({ content: [{type:"text", text}] }) }`. | 🔧 producer.md sketch corrected to the documented shape |
| API keys | **Omit `getApiKey` entirely in the online runtime** — jagent injects platform credentials host-side. `getApiKey` is only for BYOK and must load from `secret-manager`, never inline. | 🔧 the earlier v2 sketch (drawn from bot#9's "getApiKey at outer level") was misleading and is fixed: bot phrased where the field sits, the docs say when to use it — normally never |
| Invocation | `const { message, messages } = await agent.ask(prompt)` — prompt is a string; **the returned** `message.content` is a content-blocks array you filter for `type === "text"`. bot#10's "message is content blocks" describes the response, not the request. | 🔧 fixed in producer.md |
| Structured output | Enforced via systemPrompt ("MUST begin with `{`"), parsed defensively. | ✅ matches the skill's defensive-parse rule |
| Event timestamps | Official rule: extracted records carry the **content's own date** (`published_at_iso` + `date_confidence`), never `Date.now()`; crawl time goes in a separate field. | ✅ the skill's time-semantics rule is the platform's own rule |

## 7. Data skills (pricing)

| Check | Real form | Verdict |
|---|---|---|
| Discovery flow | `alva data-skills list` → `summary <skill>` → `endpoint <skill> <file>` — exactly the "list → summary → endpoint" flow the skill mandates. | ✅ |
| Crypto spot pricing | `arrays-data-api-spot-market-price-and-volume` (Binance spot USDT + Hyperliquid spot USDC kline/OHLCV). Field-observed call shape: REST `GET {ARRAYS}/api/v1/crypto/binance/spot/usdt/kline` with `ARRAYS_JWT` bearer. | ✅ |
| Symbol form | Binance spot USDT — pair-shaped symbols (`BTCUSDT` in SDK examples). Skill's asset→pair resolution rule stands. | ✅ |

## 8. Agent Schedule

| Check | Real form | Verdict |
|---|---|---|
| Command | `alva schedule put --name --message` + exactly one of `--after/--at/--every/--cron` (`--cron` requires IANA `--timezone`); bounds `--starts-at/--until/--max-occurrences` on recurrences only. | ✅ (v2 route already) |
| Dividing line | "Use `alva deploy` when the occurrence must run a deterministic producer script; use `alva schedule` when it must ask the Agent to resume reasoning or judgment" (verbatim). | ✅ the skill's "script re-runs vs Agent re-thinks" is a faithful paraphrase |

## 9. Update semantics & scope isolation

| Check | Real form | Verdict |
|---|---|---|
| Source edits | "ALFS source writes take effect without republishing"; `automation update` only for version/producer/description/changelog/agent-type; publish is create-only — never delete-and-recreate around `ALREADY_EXISTS`. | ✅ (v2 change) + 🔧 Tune row now also warns against publish-as-update |
| Changing alert declarations | Also takes effect without republish, next run. | ✅ |
| Feed scope isolation | content-legitimacy.md: read only from feeds created for this playbook in this session unless the user explicitly asks to reuse. | ✅ (v2 change) |

## 10. Summary of skill fixes made in this phase

1. `feed-contract.md`: alert group split (audit log + `alertOutput` digest with required `body`), real KV/read/dedup semantics, pattern names, no-`data`-group rule.
2. `producer.md`: real Feed SDK read/write calls; corrected alpi sketch (omit `getApiKey`; `ask(string)` → content-blocks response); fail-fast reconciliation; `alva run` vs `deploy trigger` testing discipline.
3. `SKILL.md`: tier-aware visibility (free ⇒ draft or share-safe, never silent public real balances); verification steps use non-delivering `alva run`; delivery evidence = `alert history` `sent` row.
4. `alerts.md`: digest-per-run now cited as platform contract; delivery chain gates carry exact commands; `openUrlAction` for "where to look".
5. `playbook-ui.md`: AlvaClient/PBSV runtime reads; exact release chain flags; screenshot-content gate; `feed set-visibility` (never raw `fs grant`).

**Fabrications found: none.** The v1 skill consistently marked platform calls
as structural pseudocode and mandated fresh discovery — the calibration
replaced pseudocode with verified shapes and corrected two secondhand claims
(alpi `getApiKey`, alpi message direction) that came from the bot's
corrections, not from the docs.
