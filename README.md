# portfolio-watch — an Alva Agent Skill

Turn **"watch my portfolio"** into a live, alert-enabled Alva Playbook backed
by the user's connected Binance account.

This repo is my submission for Alva's PM take-home: *build a Portfolio Watch
Skill that lets any user generate a Playbook with a UI and alerts.*

## What it produces

```
"keep an eye on my coins, tell me if something big happens"
          │
          ▼
 Feed  ──  positions / nav series / events / declared alerts + KV memory
 Automation ── hourly producer: account truth → bounded history → judgment
 Playbook ── NAV header · holdings · drawdown chart · alert timeline · method
 Alerts ── σ-scaled, banded, novelty-gated, digest-composed, quiet by default
```

## Repo map

| Path | What it is |
|---|---|
| `SKILL.md` | The skill itself: routing, workflow, defaults, completion gates |
| `references/binance-portfolio.md` | Account truth, scope, symbol resolution, degradation ladder, privacy posture |
| `references/feed-contract.md` | Feed schema, time semantics, KV state, bounded history |
| `references/producer.md` | Annotated producer template, failure discipline, the LLM's cage |
| `references/alerts.md` | Alert taxonomy, sensitivity presets, the novelty gate |
| `references/playbook-ui.md` | Layout contract, freshness badges, share-safe mode, remix model |
| `DESIGN.md` | 中文产品设计说明：每条规则背后的判断、取舍、指标与路线图 |
| `evals/` | Behavioral eval set: 5 scenarios, with-skill vs. baseline, decision-level assertions |

## Design in one paragraph

A portfolio watch is a pipeline, not a page: account truth → bounded history
→ material-change judgment → quiet-by-default alerts → live UI. The skill
encodes three promises — *the numbers are real* (LLM never a fact source),
*silence is information* (novelty gate, σ-scaled thresholds, escalation-only
re-alerts), *the page is alive* (Feed-backed, staleness visible) — and defends
them with hard gates: two manual runs before scheduling, data-before-alerts
write ordering, alert suppression on stale data, private-by-default with
data-level (not CSS-level) share-safe mode, and remix that shares the method
while never sharing the money.

## Evals

No platform account was available, so the evals test **behavior, not
deployment**: an agent handles five realistic requests in a simulated Alva
environment, with and without the skill, and assertions check decisions —
declared alert output present? bounded history read? novelty gate designed?
over-building avoided on a simple question? privacy defaults held under a
"make it public" prompt? See `evals/evals.json`.
