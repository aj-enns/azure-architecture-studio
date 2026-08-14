# ADR-0019: Single AI synthesizer over per-pillar agents

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Repository maintainers
- **Related:** [ADR-0012](0012-resiliency-sla-rpo-rto-modelling.md), [ADR-0014](0014-in-app-ai-architecture-review.md), [ADR-0016](0016-unified-ai-advisor.md), [ADR-0017](0017-throughput-capacity-modelling.md)

## Context

A recurring design question is whether the AI layer should be decomposed into
several specialist agents — for example a **WAF agent**, a **Resiliency agent**,
and a **Cost agent** (and possibly Security, Performance, and Operational agents)
— on the theory that domain-focused agents produce deeper, better results than a
single model call.

The important constraint is where the analytical intelligence actually lives in
this app. The Well-Architected, resiliency, and cost analysis is **not** produced
by the model. It is computed by deterministic pure functions in
`packages/shared`:

- `validateArchitecture` — WAF findings
- `analyzeResiliency` — composite SLA, weakest link, zone-redundancy gates, RTO/RPO ([ADR-0012](0012-resiliency-sla-rpo-rto-modelling.md))
- `estimateDiagramCost` — representative monthly cost
- the throughput/capacity model ([ADR-0017](0017-throughput-capacity-modelling.md))

Both AI paths — the one-shot review (`apps/api/src/ai/review.ts`, [ADR-0014](0014-in-app-ai-architecture-review.md))
and the conversational advisor (`apps/api/src/ai/advisor.ts`, [ADR-0016](0016-unified-ai-advisor.md))
— inject those deterministic results into the prompt and explicitly forbid the
model from recomputing or inventing SLA/RTO/RPO/pricing figures. The model's job
is **synthesis and prioritisation**, not calculation. The deterministic modules
are, in effect, already the "specialists" — implemented as testable functions
rather than as LLM sub-agents.

## Decision

**We will keep a single AI synthesizer that reasons over the deterministic
analyses, rather than decomposing the AI layer into per-pillar agents.**

The pillar facts are computed deterministically and handed to one model call that
produces the cross-pillar verdict and prioritised, trade-off-driven
recommendations. Depth is added by improving the deterministic engines, not by
adding LLM agents.

## Alternatives considered

- **Per-pillar LLM agents (WAF / Resiliency / Cost / …)** — rejected for the
  current scope. Because the pillar facts are deterministic, specialist agents
  would re-narrate numbers a function already produced: no fidelity gain, but N×
  token cost and latency, and a real risk of the agents drifting on assumptions.
  The deterministic layer currently makes every panel and the review agree by
  construction; independent agents would erode that.
- **Multi-agent with an orchestrator/synthesizer on top** — rejected as
  redundant. The synthesizer is exactly what `review.ts` already is; adding
  upstream agents mainly adds moving parts and eval surface.
- **Losing the cross-pillar view** — rejected. The value of a WAF review is the
  *trade-off between* pillars ("close this reliability gap; here's the cost delta
  and the perf impact"). Siloed agents produce siloed advice and lose that.

## Consequences

- The AI layer stays a **tools-plus-one-reasoner** design: verifiable analysis in
  code, judgement and prose in the model. This keeps results consistent, cheap,
  fast, and testable.
- Improving review fidelity means investing in the deterministic engines in
  `packages/shared`, which is where accuracy lives.
- Decomposition remains a future option, but only under specific triggers:
  1. **Genuinely generative per-domain reasoning** that cannot be deterministic
     (e.g. a STRIDE-style security threat-model narrative, cost what-if
     optimisation, or performance reasoning over named load scenarios). Even then
     the preferred shape is an **optional specialist pre-pass that feeds the same
     synthesizer**, not an independent user-facing agent — and it would extend
     [ADR-0014](0014-in-app-ai-architecture-review.md) / [ADR-0016](0016-unified-ai-advisor.md)
     rather than replace this decision.
  2. **Prompt bloat** — each call already carries all three analyses plus Learn
     grounding plus transcript. If that context starts diluting answer quality,
     decompose to protect the context window. Measure before acting.
