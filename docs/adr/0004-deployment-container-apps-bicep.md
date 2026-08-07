# ADR-0004: Docker + Azure Container Apps with Bicep IaC

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** Plan Phase 0; ADR-0001

## Context

The reference product runs on Azure Container Apps. Our customers are Azure-centric and
want to self-host this tool in their own environment, ideally with infrastructure they can
review and version. We need a deployment story that is both easy to run locally and
straightforward to stand up in a customer's Azure subscription.

## Decision

We will target **Docker + Azure Container Apps**, with **Bicep** as the IaC:

- A `Dockerfile` per app (`apps/web`, `apps/api`).
- A `docker-compose.yml` for local multi-service dev.
- `infra/` Bicep templates provisioning the Container Apps environment, registry, and apps.

## Alternatives considered

- **Docker Compose only (cloud-agnostic)** — simplest, but leaves customers to figure out
  their own Azure hosting; misses the "review-ready IaC" value for ARB-minded orgs.
- **Both Compose and Bicep** — we do ship Compose for local dev, but Bicep is the primary
  cloud target rather than maintaining parallel Terraform + Bicep for MVP.
- **AKS** — far more operational overhead than this workload needs.

## Consequences

- Local dev via `docker compose up`; cloud deploy via Bicep.
- Serverless scale-to-zero economics of Container Apps keep self-host costs low.
- Terraform can be offered later for shops that standardize on it (the diagram→IaC exporter
  in Phase 3 already contemplates a Terraform target).
