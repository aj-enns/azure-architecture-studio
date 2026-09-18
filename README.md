# Azure Architecture Studio

> Design, review, and cost Azure architectures on an interactive canvas — self-hosted, open source, and AI-optional.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Azure Architecture Studio is a self-hostable diagram builder for your
Architecture Review Board (ARB) process. Draw Azure architectures on an
interactive canvas, generate them from natural language or a screenshot, or
import them from Infrastructure as Code or a live subscription. Then validate the
design against Well-Architected principles, model resiliency and cost, and export
Bicep or Terraform. Run it in your own environment, or configure a hosted demo
for diagram-based exploration without repository or IaC import.

> Inspired by Arturo Quiroga's Azure Architecture Diagram Builder, rebuilt open
> source with a upgraded UI and bring-your-own AI so teams can
> self-host it for ARB reviews. **Status:** active early development — see the
> [roadmap](docs/PROGRESS.md).

![Azure Architecture Studio deployment topology rendered on the canvas](azure-architecture-studio-deployment-topology.png)

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

## Two ways to run

This Microsoft Global Hackathon project supports two configurations from one
codebase. A hosted instance can be offered free to visitors; its operator still
pays for hosting and any configured AI usage. No public service availability or
free AI quota is implied by this repository.

| | Hosted demo | Self-hosted |
| --- | --- | --- |
| Intended use | Explore with non-confidential diagrams, images and chat | Review organizational architectures and IaC in an approved environment |
| Canvas, local validation, costs, resiliency baseline | Available | Available |
| AI chat, image transcription and review | Uses the operator's configured AI endpoint | Uses your configured AI endpoint |
| Repository/folder and ARM template import | Disabled | Enabled |
| API setting | `IAC_IMPORT_ENABLED=false` | `IAC_IMPORT_ENABLED=true` (default) |

Set the flag on the API process, or in `.env` when using Docker Compose, and
restart/recreate the API. Hosted mode hides IaC import controls and rejects
`/api/import/repo` and `/api/import/arm` before parsing request bodies. This is
a feature gate, not a content filter: users could still paste source into chat
or include sensitive information in an image. **Do not submit confidential
material to a shared demo.** Use an approved self-hosted deployment for IaC.

Self-hosting gives the organization control of the app, identity and configured
AI services. It does **not** automatically guarantee tenant isolation, private
networking, data residency or zero external traffic. Verify endpoint ownership,
model deployment/data-processing settings, access controls, logs and egress
policy. Keep authentication and least-privilege identity permissions in place;
the mode flag does not change them. In particular, live Azure import uses the
server's Azure identity, not the visitor's, so a demo identity must not have
access to confidential resource inventories.

### What leaves your computer

The app displays data-sharing notices, configured destination hosts, and a
persistent privacy status. Actions involving onward transfers ask for consent
before sending the action payload. ARM upload also asks before sending source
to the app server. You can remember a choice per action and destination, or
clear it with **Reset permissions**. A destination or disclosure change prompts
again. These browser controls do not authorize or audit direct API clients.

| Action | Data movement |
| --- | --- |
| Draw, import/export diagram JSON, export PNG/SVG, baseline validation/cost/resiliency | Local browser processing; no action payload uploaded |
| Local folder import (self-hosted configuration) | Previews paths and sizes, then reads selected IaC locally; **0 file-content bytes uploaded** |
| ARM template import | Full template and filename go to the app server for deterministic parsing |
| GitHub URL import | URL goes to the app server; it fetches matching IaC contents from `api.github.com` and `raw.githubusercontent.com` |
| AI prompt/modify, advisor and review | Prompt/message, relevant chat history and/or diagram go through the app server to its configured AI host |
| Diagram image import | Selected image and accompanying prompt go through the app server to its configured AI host; no Learn grounding for this action |
| Learn grounding | Derived search queries, potentially including prompt text or architecture names, go from the server to the configured Learn host (normally `learn.microsoft.com`) |
| Grounded resiliency refresh | Diagram goes to the app server; grounding can call the configured AI and Learn services |
| Generate IaC | Diagram and target format go to the app server; deterministic processing stays in that deployment |
| Azure resource-group import | Subscription ID and resource-group name go to the app server, which uses its own Azure identity to query Azure Resource Graph; resource metadata returns to the browser |

The transfer status reports browser request-body bytes, **not** measured total
network traffic or verified downstream delivery. Health checks, service/model
discovery, authentication and ordinary page/asset requests still make network
requests. Server-side Azure authentication/model discovery can also contact
Microsoft identity and management services. No credentials are exposed in the
privacy status. Labels describe the configured routes, not an independent audit
of the deployment. Diagrams, resource names, properties and chat are potentially
sensitive even when raw source files are not included. AI calls pass through the
app backend; they are not direct browser-to-model calls.

Folder selection may trigger a browser-owned "upload" warning. The application
does not upload the folder: it previews matching `.bicep`, `.tf` and candidate
ARM JSON files before reading them locally. Other file contents and common
dependency/build folders are ignored. Limits are 500 files, 2 MB per file and
20 MB total, with skip counts shown before parsing. Filename filtering is not
secret scanning. A later AI action can send the derived diagram. IaC imports
are best-effort resource/dependency diagrams, not verified runtime traffic maps.
The File System Access API picker remains deferred.

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
| `IAC_IMPORT_ENABLED` | `false` or `0` for hosted demo; `true` or `1` for self-hosted imports (default `true`). Set on the API, not the browser. |
| `LEARN_GROUNDING_ENABLED` | Set `false` to disable outbound Learn grounding/search (default enabled). |
| `LEARN_MCP_ENDPOINT` | Learn MCP destination (default `https://learn.microsoft.com/api/mcp`). |
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
For Azure setup, this resource ID may point to another subscription in the same
Microsoft Entra tenant; `infra/setup.ps1` derives the RBAC target from the ID.
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
templates. The setup script uses ACR Quick Build when available and falls back
to a local Docker engine if the managed build agent cannot download its context.

1. **[Install Azure infrastructure](docs/install-infrastructure.md)**: prepare
   the subscription and resource group, provision ACR and the managed identity,
   register the Entra sign-in application, and optionally grant Foundry access.
2. **[Deploy the application](docs/deploy-application.md)**: build the web and
   API images in ACR, deploy the remaining Container Apps infrastructure, finish
   the callback configuration, and verify sign-in and API access.

Azure deployments require Entra authentication by default. The public web app
proxies an internal API. Set **Assignment required** on the sign-in enterprise
application and assign a dedicated security group; manage approved users through
direct membership in that group. Users do not need their own Azure subscription.
Adding a user or guest to the tenant does not assign application access. Follow
[Manage user access](docs/manage-user-access.md) to onboard or remove users. The
application uses the host's managed identity and AI resources.

The setup script reads the three non-secret `AZURE_FOUNDRY_ENDPOINT`,
`AZURE_FOUNDRY_MODEL`, and `AZURE_FOUNDRY_RESOURCE_ID` values from `.env` when
explicit parameters and process environment variables are absent. It never
loads API keys. Manual Bicep and GitHub Actions deployments still require their
documented parameters or repository variables.

For a hosted demo, pass `iacImportEnabled=false` to the deployment of
`infra/main.bicep` (default `true`). Keep that value in subsequent deployments
to avoid re-enabling imports. This parameter does not disable Entra authentication.

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
