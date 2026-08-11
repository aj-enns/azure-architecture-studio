# Using the Azure Architecture Review Workspace

When this skill runs inside the `azure-architecture-review` app repo, prefer its
structured data and deterministic analysis over eyeballing a diagram. It already
implements much of this review method.

## Diagram as the source of truth

The design is a `Diagram` (see `packages/shared/src/schema.ts`): `nodes`
(`serviceId`, `properties`), `edges`, `groups`, and `metadata.region` +
`metadata.resiliency` (the SLA/RTO/RPO target). Ask the user to export it (Toolbar
→ Export → JSON) or read it from `localStorage['aar.diagram']`, and use it as the
canonical topology instead of inferring one.

## Deterministic analysis already in the repo

| Capability | Where | Use for review step |
|---|---|---|
| WAF pillar findings + per-pillar score | `packages/shared/src/waf.ts` (`validateArchitecture`) | Step 2 — pillar scorecard |
| Composite SLA, weakest link, RPO/RTO, zone-redundancy gates, findings | `packages/shared/src/resiliency.ts` (`analyzeResiliency`) | Step 3 — resiliency deep dive |
| Monthly cost estimate by node/category | `packages/shared/src/pricing.ts` (`estimateDiagramCost`) | Step 5 — cost side of the trade-off |
| Baseline SLA table + AZ region list, with `verifiedOn` stamps | `packages/shared/src/resiliency.ts` (`SERVICE_RESILIENCE`, `AZ_REGIONS`) | Step 1/3 — grounded figures |

The three zone-redundancy gates, the multiplicative composite, the weakest-link
call-out, and the supporting-category exclusion in this skill all match
`analyzeResiliency` — so the tool's numbers and this review agree by construction.

## API routes (if the dev server is running)

- `POST /api/validate` → WAF report
- `POST /api/resiliency` → composite SLA report; `{ "grounded": true }` refreshes
  figures from Microsoft Learn and returns citations
- `POST /api/cost` → cost estimate

Each takes `{ "diagram": <Diagram> }`. Prefer these when live, then narrate and
prioritize the results — the tool produces figures, the review adds judgement,
trade-offs, and a recommended target design.

## Provenance

Figures from the repo's baseline table carry `source` + `verifiedOn`. Repeat that
provenance in the review, and prefer a grounded (`/api/resiliency` with
`grounded: true`) refresh for anything customer-facing. See
[sources](./sources.md) for why the baseline needs periodic reconciliation.
