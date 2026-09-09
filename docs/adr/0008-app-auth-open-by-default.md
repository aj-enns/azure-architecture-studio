# ADR-0008: App open by default; document Entra ID fronting (no built-in SSO)

- **Status:** Superseded by ADR-0020
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0003, ADR-0004, ADR-0007

## Context

Enterprises running this for their ARB process will have opinions about authentication, and
those opinions vary (Entra ID, existing reverse proxies, private networking). Building a
specific SSO integration into the MVP risks being wrong for many environments and adds
scope before the core value is proven. The app holds no user database (ADR-0007) and keeps
AI secrets server-side only (ADR-0003).

## Decision

The application ships **open (unauthenticated) by default**, and we **document how to front
it with authentication** rather than building SSO into the MVP:

- Recommend Azure Container Apps built-in auth or a reverse proxy / Entra ID in front.
- Keep the API stateless and secret-free from the client's perspective so it sits safely
  behind such a gateway.

## Alternatives considered

- **Build Entra ID SSO into Phase 1** — opinionated, more scope, and often duplicates auth
  the customer already runs at the edge. Deferred.
- **HTTP basic auth in-app** — weak and awkward for enterprises; not worth building.

## Consequences

- Fast, dependency-light MVP that drops into a customer's existing auth perimeter.
- Self-hosters are responsible for putting auth in front for any non-trivial deployment;
  this must be stated clearly in the docs (do not expose the open app publicly as-is).
- A future ADR can add first-class Entra ID SSO for ARB governance if there is demand.
