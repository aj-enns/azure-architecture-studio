# Azure Architecture Review

> Design, review, and cost Azure architectures on an interactive canvas — self-hosted, open source, and AI-optional.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Azure Architecture Review is a self-hostable diagram builder for your
Architecture Review Board (ARB) process. Draw Azure architectures on an
interactive canvas, generate them from natural language or a screenshot, or
import them from Infrastructure as Code or a live subscription. Then validate the
design against Well-Architected principles, model resiliency and cost, and export
Bicep or Terraform — all inside your own environment.

> Inspired by the Azure Architecture Diagram Builder, rebuilt open source with a
> significantly upgraded UI and bring-your-own AI so teams can self-host it for
> ARB reviews. **Status:** active early development — see the [roadmap](docs/PROGRESS.md).

![Azure Architecture Review deployment topology rendered on the canvas](azure-architecture-review-deployment-topology.png)

## Features

- **Interactive canvas** — drag and drop Azure services from a categorized palette, group them by subscription, resource group, VNet, or subnet, auto-arrange the layout, and edit properties.
- **AI prompt-to-diagram** — generate or modify a diagram from natural language, or transcribe one from a pasted screenshot.
- **Unified AI advisor** — ask architecture questions about the current diagram and apply suggested edits.
- **AI architecture review** — a cross-pillar Well-Architected review, optionally grounded in Microsoft Learn.
- **Well-Architected validation** — a deterministic rule engine over the diagram model, with no AI required.
- **Resiliency modelling** — composite SLA, RPO/RTO, and weakest-link analysis with a canvas overlay.
- **Cost and throughput** — per-service and total monthly estimates plus bottleneck sizing against a load target.
- **Infrastructure as Code export** — deterministic Bicep and Terraform generation, previewed and downloaded in-app.
- **Import** — from ARM/Bicep templates, a public Git repository, or a live Azure resource group, as a best-effort starting point to review and refine.
- **Bring-your-own AI** — Microsoft Foundry or Azure OpenAI with keyless Entra ID auth. AI is optional; every other feature works without it.
- **Export** — save diagrams as PNG, SVG, or JSON.

## Quick start

### Prerequisites

- **Node.js** ≥ 20 (22 recommended)
- **pnpm** ≥ 9 — `npm install -g pnpm@9`
- **Docker** — optional, for the containerized run

### Run locally

```bash
pnpm install
cp .env.example .env   # optional — add AI credentials to enable AI features
pnpm dev               # web on http://localhost:5173, API on http://localhost:8080
```

Open <http://localhost:5173> and drag a service onto the canvas to confirm it is
running. For a full walkthrough — enabling AI, Docker, and troubleshooting — see
the [Getting started guide](docs/getting-started.md).

### Run with Docker

```bash
docker compose up --build   # app on http://localhost:8080
```

The web container reverse-proxies `/api` and `/healthz` to the API, so everything
is served from a single origin.

## Diagram your design

> **Recommended:** the most robust and reproducible way to capture an existing
> architecture is to define it as a **diagram JSON file** and import it — rather
> than dragging services by hand or generating from a prompt.

The diagram model is a schema-validated JSON document
([ADR-0002](docs/adr/0002-diagram-schema-shared-source-of-truth.md)), so a design
authored this way is deterministic, reviewable in a pull request, and laid out by
the same engine the app uses. AI generation and the canvas are great for
exploration; JSON is the reliable source of truth.

This repository ships a worked example that builds its own deployment topology
from code and infrastructure facts:

```bash
pnpm diagram:solution   # writes docs/examples/solution-deployment-topology.json
```

To visualize it, open the app and choose **File → Import JSON**, then select the
generated file. To capture **your** architecture, copy
[docs/examples/solution-deployment-topology.json](docs/examples/solution-deployment-topology.json)
as a starting point, edit the `nodes`, `groups`, and `edges`, and import the
result — positions are optional because auto-layout owns final placement.

## Documentation

| Guide | What it covers |
| ----- | -------------- |
| [Getting started](docs/getting-started.md) | Step-by-step install, running locally and in Docker, enabling AI, troubleshooting |
| [Install Azure infrastructure](docs/install-infrastructure.md) | Subscription setup, registry, managed identity, Entra registration, and optional Foundry access |
| [Deploy the application](docs/deploy-application.md) | Build images, deploy Container Apps, verify sign-in, and automate with GitHub Actions |
| [Diagram your design](#diagram-your-design) | The recommended JSON-first way to capture an architecture |
| [Configuration](#configuration) | AI provider and environment variables |
| [Deploy to Azure](#deploy-to-azure) | Bicep infrastructure and GitHub Actions CI/CD |
| [Architecture decisions](docs/adr/README.md) | The "why" behind the key technical choices (ADRs) |
| [Roadmap](docs/PROGRESS.md) | Current status and what's planned |
| [Contributing](CONTRIBUTING.md) | Development workflow and ground rules |

## Architecture

A pnpm monorepo ([ADR-0001](docs/adr/0001-monorepo-and-stack.md)):

| Path                | What it is                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `apps/web`          | React + Vite + TypeScript, Tailwind + shadcn/ui, React Flow canvas  |
| `apps/api`          | Fastify + TypeScript API (catalog, AI generate/advise/review, validation, resiliency, cost, IaC, imports) |
| `packages/shared`   | Zod diagram schema + Azure service catalog (single source of truth) |
| `tools/catalog-sync`| Detects new Azure resource types (AVM + icons) and drafts catalog candidates |
| `infra`             | Bicep for Azure Container Apps                                       |

Well-Architected, resiliency, and cost analysis are computed by deterministic
functions in `packages/shared`; a single model call then synthesises the
cross-pillar review, rather than separate per-pillar agents. See
[docs/architecture-flow.md](docs/architecture-flow.md) for a diagram of the
prompt, AI, and deterministic calls.

## Configuration

AI features use **bring-your-own Microsoft Foundry or Azure OpenAI**
([ADR-0003](docs/adr/0003-ai-provider-byo-azure-openai.md)). Set these in `.env`;
leave them blank to run without AI:

| Variable                     | Description                                                               |
| ---------------------------- | ------------------------------------------------------------------------- |
| `AZURE_FOUNDRY_ENDPOINT`     | Microsoft Foundry resource endpoint, e.g. `https://<resource>.services.ai.azure.com` |
| `AZURE_FOUNDRY_MODEL`        | Foundry model/deployment name, e.g. `gpt-5-mini`                          |
| `AZURE_FOUNDRY_RESOURCE_ID`  | Optional ARM resource ID used to discover compatible review deployments   |
| `AZURE_FOUNDRY_API_KEY`      | Optional Foundry API key; leave blank to use Entra ID                     |
| `AZURE_FOUNDRY_API_VERSION`  | Foundry model-inference API version (default `2024-05-01-preview`)       |
| `AZURE_OPENAI_ENDPOINT`      | Your Azure OpenAI / Foundry resource endpoint                             |
| `AZURE_OPENAI_API_KEY`       | Optional API key (server-side only); leave blank to use Entra ID          |
| `AZURE_OPENAI_DEPLOYMENT`    | Model deployment name (e.g. `gpt-4o`)                                    |
| `AZURE_OPENAI_API_VERSION`   | API version (default `2024-10-21`)                                        |

Use the `AZURE_FOUNDRY_*` variables for a Microsoft Foundry resource. Use the
`AZURE_OPENAI_*` variables for an Azure OpenAI-compatible endpoint. When both
are supplied, the explicit Foundry configuration takes precedence.

For keyless authentication, leave the selected provider's API key
(`AZURE_FOUNDRY_API_KEY` or `AZURE_OPENAI_API_KEY`) blank and authenticate
the API host with `az login` locally, or a managed identity/workload identity in
Azure. Grant that identity the **Cognitive Services OpenAI User** role on the
Azure OpenAI resource. See [ADR-0011](docs/adr/0011-entra-id-keyless-azure-openai-auth.md).

The architecture review can list compatible deployments from a Foundry resource.
Set `AZURE_FOUNDRY_RESOURCE_ID` to the full resource ID of its
`Microsoft.CognitiveServices/accounts` resource. Discovery always uses
`DefaultAzureCredential`, even when inference uses `AZURE_FOUNDRY_API_KEY`. Run
`az login` for local development, or configure a managed/workload identity in
Azure, and grant it `Microsoft.CognitiveServices/accounts/deployments/read`
(the built-in **Reader** role on the Foundry resource includes this action).
Only succeeded chat-completion deployments advertising JSON response support are
offered. If discovery or authorization fails, reviews remain available with the
configured `AZURE_FOUNDRY_MODEL` and the panel shows a warning. See
[ADR-0015](docs/adr/0015-foundry-review-model-discovery.md).

## Deploy to Azure

The fastest path is one idempotent script that handles infrastructure, images,
Container Apps, and Microsoft Entra "Easy Auth" — including registering the
sign-in redirect URI automatically (no portal clicks):

```powershell
./infra/setup.ps1 -SubscriptionId '<your-subscription-id>'
```

See [Install Azure infrastructure → Fast path](docs/install-infrastructure.md#fast-path-one-script-recommended)
for AI and reuse-existing-registration options. Prefer to run each step yourself?
Follow the two guides in order. Commands use PowerShell 7 and the existing Bicep
templates; no local Docker installation is needed for Azure deployment.

1. **[Install Azure infrastructure](docs/install-infrastructure.md)**: prepare
   the subscription and resource group, provision ACR and the managed identity,
   register the Entra sign-in application, and optionally grant Foundry access.
2. **[Deploy the application](docs/deploy-application.md)**: build the web and
   API images in ACR, deploy the remaining Container Apps infrastructure, finish
   the callback configuration, and verify sign-in and API access.

Azure deployments require Entra authentication by default. The public web app
proxies an internal API. Set **Assignment required** on the sign-in enterprise
application and assign approved users; users do not need their own Azure
subscription. The application uses the host's managed identity and AI resources.

Your local `.env` is not loaded by Azure deployment. Supply AI settings through
the documented Bicep parameters or GitHub Actions variables.

### CI/CD (GitHub Actions)

After the manual installation works, follow
**[Automate with GitHub Actions](docs/deploy-application.md#automate-with-github-actions)**.
One-time bootstrap of the deployment identity (resource-group RBAC and OIDC
federated credentials) is scripted in
[infra/grant-github-deploy.ps1](infra/grant-github-deploy.ps1).
It covers both required OIDC credentials (`main` branch and `production`
environment), deployment permissions, repository secrets and variables, and
release verification. The deployment identity is separate from the web sign-in
registration; only the latter needs a client secret.

## Security

Local development and non-Azure hosting are unauthenticated by default and must
not be exposed publicly without a trusted authentication proxy. Azure
deployments enable Container Apps authentication with Microsoft Entra ID by
default ([ADR-0020](docs/adr/0020-entra-protected-azure-deployments.md)).
The API also applies request rate limits by default. See
[SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
development workflow, coding conventions, and how significant decisions are
recorded as [ADRs](docs/adr/README.md). Before opening a pull request, make sure
`pnpm build`, `pnpm test`, and `pnpm typecheck` pass.

## License

MIT for all source code — see [LICENSE](LICENSE). Bundled Microsoft Azure icons
are © Microsoft under Microsoft's icon terms; see [TERMS.md](TERMS.md).
