# ADR-0012: Resiliency modelling — composite SLA, RPO/RTO, and Learn grounding

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Repository maintainers
- **Related:** [ADR-0002](0002-diagram-schema-shared-source-of-truth.md), [ADR-0003](0003-ai-provider-byo-azure-openai.md), [ADR-0010](0010-ai-prompt-to-diagram.md)

## Context

Reviewers need to know whether a design can meet an availability target, and which
component limits it. That requires per-service SLA, RPO, and RTO figures, plus a way
to combine them.

Three constraints shaped the design:

1. **There is no machine-readable source of Azure SLA data.** The authoritative
   document is the [SLA for Microsoft Online Services][slaos] — a `.docx` revised
   monthly, which replaced the old per-service `azure.microsoft.com/support/legal/sla/*`
   pages. It has no API and is not indexed by the Microsoft Learn MCP server the
   repository already uses for grounding.
2. **Microsoft publishes RTO and RPO for only a handful of services.** The
   Well-Architected Framework states this outright, naming Azure SQL Database as one
   of the exceptions. The per-service [reliability guides][reliability] on Learn are
   the best broad source, and those *are* reachable over MCP.
3. **Zone redundancy is not a property of a service alone.** It requires an
   availability-zone region, a service and SKU that support it, and the user opting
   in. Getting any of the three wrong silently overstates availability.

The AI provider is bring-your-own (ADR-0003) and may be unconfigured, so the feature
cannot depend on a model call to produce any output at all.

## Decision

**We will model resiliency as a deterministic baseline in `@aar/shared`, optionally
refreshed from Microsoft Learn.**

- `packages/shared/src/resiliency.ts` holds a curated `SERVICE_RESILIENCE` table
  covering every catalog service, stamped with `SLA_BASELINE_VERIFIED_ON` and
  pointing at the SLAOS document. `analyzeResiliency()` is pure and runs client-side,
  exactly like the WAF and pricing modules.
- `POST /api/resiliency` always returns the baseline report. With `grounded: true` it
  additionally retrieves the per-service reliability guides over one Learn MCP session
  and extracts structured figures in a single model call, returning them as overrides
  plus citations. Any grounding failure returns the baseline with a `groundingError`;
  it never fails the request.
- **Every figure carries provenance** — `source.kind` (`baseline` or `learn`),
  a URL, a verification or retrieval date, and a `confidence` of `published`,
  `derived`, or `estimated`. The UI states plainly that these are planning figures,
  not a contractual SLA.
- **Composite SLA is the product of the contributing services' SLAs**, per the
  Well-Architected guidance on defining reliability targets. Services in the
  `management`, `identity`, and `devops` categories are excluded from the product
  because they don't gate the request path; excluded ids are reported so the omission
  is auditable. A per-node `excludeFromSla` property overrides the default.
- **Zone redundancy is resolved through three gates** — region, service/SKU, and the
  user's `zoneRedundant` flag. Failing any gate downgrades the tier and records *which*
  gate blocked it. `AZ_REGIONS` carries its own `AZ_REGIONS_VERIFIED_ON` stamp because
  Azure adds availability-zone regions regularly.
- **`zoneRedundant` and `multiRegion` become catalog defaults** for the services that
  actually support them, so they appear as editable node properties. They are omitted
  where the SKU is the real control (Storage replication, Redis tier) to avoid implying
  a switch that does not exist. The Bicep and Terraform emitters now read
  `zoneRedundant` from node properties rather than hardcoding `false`, so generated
  infrastructure matches the reviewed design.
- **`diagramMetadataSchema` gains an optional `resiliency` target** so the availability
  objective travels with an exported diagram.

## Alternatives considered

- **Learn-grounded only, no baseline table** — rejected. The panel would be empty
  whenever the model is unconfigured or Learn is unreachable, results would be
  non-deterministic, and none of it would be unit-testable.
- **Parsing the SLAOS `.docx`** — rejected. There is no API, the format is not a
  stable contract, and scraping a licensing document to republish its numbers is a
  poor fit for a public repository.
- **Baseline table only, no grounding** — rejected. SLA terms change monthly and a
  hardcoded table silently rots. Grounding gives a way to check and refresh it with
  citations the reviewer can follow.
- **Weakest-link SLA instead of a product** — rejected as the headline, because it
  overstates availability for a chain of services. The weakest link is still reported
  separately, since it is the actionable number.
- **A single `zoneRedundant` boolean per service** — rejected. It would report zone
  redundancy for a `Standard_LRS` storage account or a single-instance plan, which is
  wrong in a way that matters.

## Consequences

- The panel works offline and with AI unconfigured, and the analysis is unit-tested
  including all three zone-redundancy gates.
- **The baseline table needs periodic reconciliation.** `SLA_BASELINE_VERIFIED_ON` and
  `AZ_REGIONS_VERIFIED_ON` are surfaced in the panel footnote so staleness is visible
  rather than silent. A test asserts every catalog service has a profile, so adding a
  service to the catalog fails the build until its resiliency data is supplied.
- Figures are explicitly non-contractual. Published SLA coverage is narrower than a
  service as a whole, so a real SLO is usually lower — the Well-Architected "adjusted
  SLO" step is left to the reviewer.
- Adding `zoneRedundant` to catalog defaults changes the properties of newly created
  nodes and the emitted IaC for SQL, Cosmos DB, and App Service Plans.
- The grounding path reuses `LEARN_MCP_ENDPOINT` and `LEARN_GROUNDING_ENABLED`; no new
  configuration was introduced.
- **Follow-up:** per-node regions are not modelled, so a true multi-region topology
  (primary and secondary in different regions) cannot be drawn. `multiRegion` is a
  per-node flag that selects a higher SLA tier, not a second deployment. Modelling
  real region pairs needs a schema change and its own ADR.

[slaos]: https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services
[reliability]: https://learn.microsoft.com/azure/reliability/overview-reliability-guidance
