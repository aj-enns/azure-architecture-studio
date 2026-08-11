# ADR-0015: Discover and allowlist Foundry review deployments through ARM

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Repository maintainers
- **Related:** [ADR-0003](0003-ai-provider-byo-azure-openai.md), [ADR-0011](0011-entra-id-keyless-azure-openai-auth.md), [ADR-0014](0014-in-app-ai-architecture-review.md)

## Context

Architecture reviewers need to choose among the model deployments configured on
their Microsoft Foundry resource. The Foundry model-inference endpoint can invoke
a named deployment, but it does not provide an authoritative list of deployments.
The model catalog is also unsuitable because it includes models that are not
deployed or compatible with this review's chat and structured-output contract.

Inference credentials and deployment discovery have different security scopes.
An inference API key cannot authorize Azure Resource Manager (ARM), and exposing
ARM identifiers or arbitrary endpoint selection to the browser would widen the
application's trust boundary.

## Decision

**The API will discover review-compatible Foundry deployments through the ARM
Deployments - List operation and enforce the returned names as an allowlist.**

- `AZURE_FOUNDRY_RESOURCE_ID` identifies the
  `Microsoft.CognitiveServices/accounts` resource. The API calls its deployments
  collection using ARM API version `2024-10-01`.
- Discovery always uses `DefaultAzureCredential` with the ARM scope. The API
  identity needs `Microsoft.CognitiveServices/accounts/deployments/read`, such
  as the built-in Reader role scoped to the Foundry resource.
- The API offers succeeded deployments that advertise chat completion and JSON
  Schema or JSON object response support. It returns deployment names for calls
  and model name/version only as display metadata.
- Results are cached in memory for five minutes, concurrent refreshes are
  deduplicated, and an expired successful result may be reused after a transient
  refresh failure.
- The configured `AZURE_FOUNDRY_MODEL` is always retained. Missing configuration,
  ARM failure, or insufficient authorization produces a warning and a default-only
  list rather than disabling review.
- `POST /api/review` accepts an optional deployment name and validates it against
  the server-side list before creating a per-request inference configuration.
  Diagram generation and resiliency analysis continue to use their configured
  defaults.

## Alternatives considered

- **Enumerate deployments from the inference endpoint** - rejected because the
  endpoint does not expose an authoritative deployment-list contract.
- **List the Foundry model catalog** - rejected because availability in the
  catalog does not mean a model is deployed or callable by the resource.
- **Configure a static comma-separated model list** - rejected because it
  duplicates Foundry state and becomes stale.
- **Accept any client-provided deployment name** - rejected because it permits
  arbitrary routing outside the set the server found compatible.
- **Fail review when discovery fails** - rejected because the existing configured
  deployment remains a valid operational fallback.

## Consequences

- The review panel reflects live Foundry deployments without storing management
  credentials in the browser.
- Operators using inference API keys must still configure an Entra identity for
  discovery. This requirement is independent of model-inference authorization.
- ARM capability metadata is advisory. A deployment may advertise JSON object
  support yet reject strict JSON Schema at inference time; such provider errors
  remain visible to the caller, while the configured default stays available.
- Legacy Azure OpenAI configuration does not use ARM discovery and exposes only
  its configured deployment.
