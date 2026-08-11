# ADR-0014: In-app AI architecture review

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Repository maintainers
- **Related:** [ADR-0003](0003-ai-provider-byo-azure-openai.md), [ADR-0010](0010-ai-prompt-to-diagram.md), [ADR-0012](0012-resiliency-sla-rpo-rto-modelling.md), [ADR-0013](0013-single-active-panel.md)

## Context

The repository ships a `waf-architecture-review` skill (`.github/skills/`) — a
Copilot agent customization that reviews a design against the Well-Architected
Framework with a resiliency and DR deep dive. Users asked for a button in the web
app that "runs the skill" against the current diagram.

Skills are agent customizations: they run inside the Copilot coding agent (VS Code
chat), reading files the agent can see. The deployed web app and its API have no
channel to the Copilot agent, so a browser button cannot invoke the skill file
directly.

The app already has the ingredients for an equivalent: bring-your-own Azure
OpenAI / Foundry (ADR-0003, ADR-0010), deterministic WAF (`validateArchitecture`),
resiliency (`analyzeResiliency`), and cost (`estimateDiagramCost`) analysis, and a
Microsoft Learn grounding path.

## Decision

**We will add an in-app AI review that applies the skill's methodology
server-side, rather than trying to invoke the skill file from the browser.**

- A new `apps/api/src/ai/review.ts` encodes the skill's methodology — five
  pillars, the resiliency/DR deep dive, cost-versus-uptime framing, source
  discipline, and the fixed report sections — as the model **system prompt**.
- The user message carries the **deterministic analysis** (`validateArchitecture`,
  `analyzeResiliency`, `estimateDiagramCost`) plus optional Microsoft Learn
  excerpts. The model is instructed to reason only over those figures and never
  invent SLA / RTO / RPO numbers, so the review agrees with the app's own
  analysis by construction.
- `POST /api/review` returns the review as GitHub-flavoured Markdown. It requires
  a configured model (503 when unconfigured, exactly like `/api/generate`), 400s
  an empty diagram, and treats grounding failure as soft (the review still runs on
  the deterministic analysis). It reuses the generalized `generateJson`
  structured-output helper.
- The web app renders the review in a `review` panel (part of the single
  `activePanel` rail, ADR-0013) using `react-markdown` + `remark-gfm` for the
  scorecard table and links.

## Alternatives considered

- **Invoke the skill file from the web app** — not possible. Skills execute in the
  Copilot agent, which the deployed app cannot reach.
- **A "copy prompt for Copilot" button** (assemble the diagram + a trigger prompt
  for the user to paste into chat, where the real skill runs) — rejected as the
  primary path because it needs a human hand-off and leaves the review outside the
  app. Still viable as a future secondary action for when the model is unconfigured.
- **A deterministic, template-filled review with no model** — rejected. The
  synthesis, prioritisation, and prose judgement are exactly what the model adds;
  the deterministic pieces already exist as the WAF/resiliency/cost panels.
- **Duplicate the skill content into the API by reading `.github/skills` at
  runtime** — rejected. The `.github` folder is not guaranteed to ship in the
  deployed container, and coupling the API to that path is fragile. The methodology
  is inlined in `review.ts` instead, which notes it mirrors the skill.

## Consequences

- The review works entirely in the app when a model is configured, and reuses the
  existing deterministic analysis so its numbers match the other panels.
- **The API now embeds a copy of the skill methodology.** `review.ts` and the
  `waf-architecture-review` SKILL.md must be kept in sync by hand; a substantive
  change to one should be mirrored in the other. `review.ts` carries a comment
  saying so.
- Requires a configured Azure OpenAI / Foundry model (bring-your-own, ADR-0003);
  with none, the panel shows the same "not configured" gate as AI generation.
- Adds `react-markdown` + `remark-gfm` to the web app — the first Markdown renderer
  in the UI.
- Grounding reuses `LEARN_MCP_ENDPOINT` / `LEARN_GROUNDING_ENABLED`; no new config.
- **Follow-up:** the "copy for Copilot" hand-off button is not built. It would let
  users run the real skill in chat when the model is unconfigured, and is the
  natural next increment.
