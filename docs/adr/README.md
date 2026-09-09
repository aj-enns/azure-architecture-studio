# Architecture Decision Records (ADR)

This folder captures the significant architecture and design decisions made while
building the Azure Architecture Diagram Builder. Each record is immutable once
accepted — if a decision changes, we add a **new** ADR that supersedes the old one
(rather than editing history), so the reasoning trail stays reviewable.

## Format

Each ADR follows [Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
**Context → Decision → Consequences**, plus status and date. Use
[0000-adr-template.md](0000-adr-template.md) as the starting point.

## Status values

- `Proposed` — under discussion, not yet acted on
- `Accepted` — decided and in effect
- `Superseded by ADR-XXXX` — replaced by a later decision
- `Deprecated` — no longer relevant, not replaced

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-monorepo-and-stack.md) | pnpm monorepo with React + Fastify + TypeScript | Accepted | 2026-08-06 |
| [0002](0002-diagram-schema-shared-source-of-truth.md) | Zod diagram schema in `packages/shared` as single source of truth | Accepted | 2026-08-06 |
| [0003](0003-ai-provider-byo-azure-openai.md) | Bring-your-own Azure OpenAI for AI generation | Accepted | 2026-08-06 |
| [0004](0004-deployment-container-apps-bicep.md) | Docker + Azure Container Apps with Bicep IaC | Accepted | 2026-08-06 |
| [0005](0005-ui-stack-react-flow-shadcn.md) | React Flow + shadcn/ui + Tailwind for the UI | Accepted | 2026-08-06 |
| [0006](0006-azure-icon-licensing.md) | Bundle official Microsoft Azure icons + disclose in Terms | Accepted | 2026-08-06 |
| [0007](0007-persistence-local-only-mvp.md) | localStorage + JSON files for MVP persistence (no database) | Accepted | 2026-08-06 |
| [0008](0008-app-auth-open-by-default.md) | App open by default; document Entra ID fronting (no built-in SSO) | Superseded by ADR-0020 | 2026-08-06 |
| [0009](0009-web-reverse-proxy-topology.md) | Web container reverse-proxies the API (same-origin) | Accepted | 2026-08-06 |
| [0010](0010-ai-prompt-to-diagram.md) | AI prompt-to-diagram via server-side structured output + layout | Accepted | 2026-08-06 |
| [0011](0011-entra-id-keyless-azure-openai-auth.md) | Support API keys and keyless Entra ID auth for Azure OpenAI | Accepted | 2026-08-07 |
| [0012](0012-resiliency-sla-rpo-rto-modelling.md) | Resiliency modelling — composite SLA, RPO/RTO, and Learn grounding | Accepted | 2026-08-11 |
| [0013](0013-single-active-panel.md) | One analysis panel open at a time | Accepted | 2026-08-11 |
| [0014](0014-in-app-ai-architecture-review.md) | In-app AI architecture review (skill methodology server-side) | Accepted | 2026-08-11 |
| [0015](0015-foundry-review-model-discovery.md) | Discover and allowlist Foundry review deployments through ARM | Accepted | 2026-08-11 |
| [0016](0016-unified-ai-advisor.md) | Unified AI advisor with explicit diagram modification | Accepted | 2026-08-11 |
| [0017](0017-throughput-capacity-modelling.md) | Throughput capacity modelling — bottleneck sizing against a load target | Accepted | 2026-08-12 |
| [0018](0018-automated-catalog-ingestion.md) | Automated Azure resource-type catalog ingestion (AVM + icons, PR for review) | Accepted | 2026-08-12 |
| [0019](0019-single-synthesizer-over-multi-agent.md) | Single AI synthesizer over per-pillar (WAF / Resiliency / Cost) agents | Accepted | 2026-08-13 |
| [0020](0020-entra-protected-azure-deployments.md) | Entra-protected Azure deployments | Accepted | 2026-09-09 |

## When to write an ADR

Write one when a decision is costly to reverse or shapes the architecture: choice of
framework, data model, external dependency, security/auth posture, deployment target,
or a licensing/legal constraint. Small, local, easily-reversible choices don't need one.
