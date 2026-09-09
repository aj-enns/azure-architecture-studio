# ADR-0020: Entra-protected Azure deployments

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Project owner (CSA), Copilot
- **Supersedes:** ADR-0008 for Azure deployments

## Context

The application has no user database and originally shipped without built-in
authentication. That remains useful for local development and for deployments
behind an existing trusted authentication proxy, but an internet-reachable
enterprise deployment must not be open by default.

Implementing OpenID Connect in the React and Fastify applications would
duplicate capabilities available at the Azure Container Apps ingress and make
the application responsible for token validation, sessions, and secret
lifecycle management.

## Decision

Azure deployments enable Container Apps built-in authentication with Microsoft
Entra ID by default:

- Authentication protects the external web app before requests reach nginx.
- Unauthenticated browser requests redirect to Microsoft Entra ID.
- The API remains internal and is reachable only through the web app's reverse
  proxy.
- Deployers provide a tenant ID, a dedicated app-registration client ID, and a
  client secret through secure deployment configuration.
- The GitHub Actions deployment fails validation when required authentication
  configuration is incomplete; manual deployments with invalid provider
  settings are rejected by Container Apps.
- Authentication can be disabled explicitly when a trusted upstream edge
  authenticates every request.

Local development remains unauthenticated. Authorization to specific users or
groups is configured through assignment requirements on the Entra enterprise
application.

## Consequences

- The default Azure deployment is protected without adding identity libraries
  or token-handling code to the application.
- Each customer controls its app registration, conditional-access policies,
  user/group assignments, and secret rotation.
- The application can later consume trusted Container Apps identity headers for
  audit attribution or role-aware features.
- Deployments outside Azure still require an authentication proxy. First-class
  portable OpenID Connect remains a future option if customer demand justifies
  the additional security surface.
