# ADR-0011: Support Entra ID keyless authentication for Azure OpenAI

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** Project maintainers
- **Related:** ADR-0003, ADR-0010

## Context

The application connects to a customer-provided Azure OpenAI / Foundry endpoint.
Some organizations prohibit storing or transmitting Azure OpenAI API keys, while
an open-source self-hosted application must continue to support customers who
use API-key authentication.

The API therefore needs a credential option that works both for local development
and for Azure-hosted deployments without placing a secret in application settings.

## Decision

We will support both authentication modes:

- When `AZURE_OPENAI_API_KEY` is set, the API sends it in the `api-key` header.
- When the key is omitted, the API uses `DefaultAzureCredential` from
  `@azure/identity` and sends an Entra ID bearer token in the `Authorization`
  header.

The bearer token uses the scope
`https://cognitiveservices.azure.com/.default`. Local developers can authenticate
with `az login`; Azure deployments can use a managed identity or another
credential supported by `DefaultAzureCredential`. The selected identity must have
the **Cognitive Services OpenAI User** role on the target resource.

Endpoint and deployment remain required in both modes. The presence of the API
key selects key auth; its absence selects Entra ID auth.

## Alternatives considered

- **API key only** — rejected because it violates the organization's keyless
  requirement and is less suitable for managed-identity deployments.
- **Entra ID only** — rejected because this is a public, self-hostable repository
  and API-key access remains necessary for customers that cannot use Entra ID.
- **Pass-through browser authentication** — rejected because the server-side API
  should own the Azure OpenAI credential and must not expose provider credentials
  to the browser.

## Consequences

- Customers can run the application without an Azure OpenAI API key.
- The same deployment can use `az login`, workload identity, managed identity, or
  environment credentials according to the host environment.
- Operators must grant the appropriate Azure RBAC role to the runtime identity.
- `@azure/identity` becomes an API runtime dependency.
- API-key authentication remains backward-compatible for existing deployments.
