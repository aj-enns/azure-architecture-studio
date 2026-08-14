# Azure Architecture Review

An open-source, self-hostable **Azure architecture diagram builder** for your
Architecture Review Board (ARB) process. Design Azure architectures on an
interactive canvas, generate them from natural language, export Infrastructure
as Code, estimate cost, and validate against Well-Architected principles — all
running inside your own environment.

> Inspired by the Azure Architecture Diagram Builder, rebuilt open-source with a
> significantly upgraded UI and bring-your-own Azure OpenAI so enterprises can
> self-host it for ARB reviews.

## Status

Early development. See [docs/PROGRESS.md](docs/PROGRESS.md) for the live roadmap
and [docs/adr/](docs/adr/README.md) for the architecture decision records.

## Architecture

A pnpm monorepo (see [ADR-0001](docs/adr/0001-monorepo-and-stack.md)):

| Path              | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `apps/web`        | React + Vite + TypeScript, Tailwind + shadcn/ui, React Flow canvas |
| `apps/api`        | Fastify + TypeScript API (health, catalog, AI, IaC, pricing)      |
| `packages/shared` | Zod diagram schema + Azure service catalog (single source of truth)|
| `infra`           | Bicep for Azure Container Apps                                     |

The AI layer computes Well-Architected, resiliency, and cost analysis with
deterministic functions in `packages/shared` and uses a single model call to
synthesise the cross-pillar review — rather than separate per-pillar agents. See
[ADR-0019](docs/adr/0019-single-synthesizer-over-multi-agent.md) for what was
considered and why, and [docs/architecture-flow.md](docs/architecture-flow.md)
for a diagram of the prompt, AI, and deterministic calls.

## Prerequisites

- **Node.js** ≥ 20 (22 recommended)
- **pnpm** ≥ 9 — `npm install -g pnpm@9` (corepack also works where it can write
  to the Node install directory)
- **Docker** (optional, for containerized runs)

## Getting started

```bash
pnpm install
cp .env.example .env   # optional: fill in Azure OpenAI to enable AI features
pnpm dev               # runs web (5173) and api (8080) together
```

- Web: <http://localhost:5173>
- API health: <http://localhost:8080/healthz>

### Run with Docker

```bash
docker compose up --build
# app on http://localhost:8080 (web reverse-proxies /api and /healthz to the API)
```

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

For keyless authentication, leave `AZURE_OPENAI_API_KEY` blank and authenticate
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

Infrastructure is Bicep, targeting Azure Container Apps (ADR-0004):

| File | What it provisions |
| ---- | ------------------ |
| [infra/registry.bicep](infra/registry.bicep) | Azure Container Registry + a user-assigned identity with `AcrPull` |
| [infra/main.bicep](infra/main.bicep) | Log Analytics, Container Apps environment, internal API app, external web app |

The web container reverse-proxies the internal API (ADR-0009); nginx's upstream is
injected as `API_UPSTREAM` at container start (the internal app name in Azure,
`http://api:8080` in Docker Compose).

### CI/CD (GitHub Actions)

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) provisions the
registry, builds both images with `az acr build` (tagged by commit SHA), then
deploys the apps — keyless via **OIDC** (no stored service-principal secret).

Configure once:

- **Secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- **Variables:** `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, and optionally
  `AZURE_FOUNDRY_ENDPOINT` / `AZURE_FOUNDRY_MODEL` (and `AZURE_FOUNDRY_RESOURCE_ID`
  to enable review model discovery).
- Grant the federated app registration **Owner** on the resource group (or
  **Contributor** + **User Access Administrator** — the latter is needed to create
  the `AcrPull` role assignment).

AI runs **keyless**: the app's user-assigned identity (`aar-id-*`) authenticates to
Foundry via `DefaultAzureCredential` (ADR-0011). Grant it access on your Foundry
resource once — either with [infra/foundry-roles.bicep](infra/foundry-roles.bicep)
(deploy into the Foundry account's resource group):

```bash
az deployment group create -g <foundry-rg> -f infra/foundry-roles.bicep \
  -p foundryAccountName=<account> principalId=<identity-principal-id>
```

or the equivalent CLI role assignments:

```bash
az role assignment create --assignee <identity-client-id> \
  --role "Cognitive Services OpenAI User" --scope <foundry-resource-id>   # inference
az role assignment create --assignee <identity-client-id> \
  --role "Reader" --scope <foundry-resource-id>                          # model discovery
```

## Security

The app ships **open (unauthenticated) by default**
([ADR-0008](docs/adr/0008-app-auth-open-by-default.md)). Do **not** expose it
publicly as-is — front it with Entra ID / your reverse proxy / Container Apps
built-in auth for any non-trivial deployment.

## License

MIT for all source code — see [LICENSE](LICENSE). Bundled Microsoft Azure icons
are © Microsoft under Microsoft's icon terms; see [TERMS.md](TERMS.md).
