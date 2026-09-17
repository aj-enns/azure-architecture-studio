# ADR-0017: Throughput capacity modelling — bottleneck sizing against a load target

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Repository maintainers
- **Related:** [ADR-0002](0002-diagram-schema-shared-source-of-truth.md), [ADR-0007](0007-persistence-local-only-mvp.md), [ADR-0012](0012-resiliency-sla-rpo-rto-modelling.md)

## Context

Cost alone doesn't tell a reviewer whether a design can carry its expected load. A
customer arrives with a load figure ("we expect ~1,000 users a minute at peak") and
wants to know which resource caps the design and what it costs to lift that cap. This
mirrors the resiliency review (ADR-0012), which already answers the analogous
availability question — current capability versus a target, with the weakest link
called out.

Two constraints shaped the design:

1. **There is no machine-readable source of per-SKU throughput.** Azure does not
   publish requests-per-second guarantees for most services; real capacity depends on
   payload, latency budget, and code. Any model is an order-of-magnitude planning aid,
   not a benchmark — the same footing as the curated pricing baseline.
2. **Throughput scales with configuration the diagram already carries.** Catalog
   defaults already expose the scaling dimensions (`capacity`, `instances`,
   `maxReplicas`, `nodeCount`, `throughputUnits`), so capability can be derived from
   existing node properties without new per-node inputs.

## Decision

**We will model throughput as a deterministic baseline in `@aas/shared`, sized against
a diagram-level target, and surface it inside the Cost tab.**

- `packages/shared/src/throughput.ts` holds a curated `SERVICE_THROUGHPUT` table for
  request-serving services (compute hosts, gateways, and the data tier). Each entry
  gives a representative requests/min per unit of one scaling property, plus the added
  monthly USD per unit. `analyzeThroughput()` is pure and runs client-side, exactly
  like the WAF, pricing, and resiliency modules.
- **The target is `usersPerMinute × requestsPerUser`**, stored on
  `diagram.metadata.throughput` (optional, persisted with the diagram like the
  resiliency target). A user enters expected users/min and a requests-per-user factor.
- **Design capacity is the weakest request-serving resource** — the minimum capability
  across gating nodes, the direct analogue of composite SLA's weakest link. Services
  not in the table (global front doors, caches, serverless, management/identity) are
  treated as non-gating and never bottleneck.
- **Under-provisioned resources are flagged, sized, and priced.** For each node below
  target we recommend the unit count that meets it (clamped to a per-service max) and
  compute the added monthly cost via the shared regional cost multiplier. When even
  the max cannot reach the target, the node is marked `capReached` rather than given a
  misleading scale recommendation.
- **The scale-up cost flows into the Total as an optional projected line.** The base
  Total is unchanged; when a target is set and resources fall short, the panel shows
  the projected "cost to meet target" alongside it.

## Consequences

- Reviewers get a load answer next to the cost answer, keyed off configuration the
  diagram already holds — no new per-node fields.
- The figures are approximations by construction; the UI frames them as planning aids,
  consistent with the pricing and resiliency disclaimers. Refining them against live
  data (e.g. Azure Retail meters or published limits) is possible later without
  changing the model's shape.
- Adding a new request-serving service means adding one `SERVICE_THROUGHPUT` entry;
  omission simply makes the service non-gating, which fails safe.
