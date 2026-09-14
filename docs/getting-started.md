# Getting started

This guide walks you from a fresh clone to a running Azure Architecture Review
instance — first locally for development, then containerized. For a high-level
tour of what the app does, see the [README](../README.md); for contributor
workflow and ground rules, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

| Tool        | Version           | Notes                                                              |
| ----------- | ----------------- | ------------------------------------------------------------------ |
| **Node.js** | ≥ 20 (22 recommended) | Check with `node --version`.                                   |
| **pnpm**    | ≥ 9               | This repo pins `pnpm@9.15.9`. Install with `npm install -g pnpm@9`. |
| **Git**     | any recent        | To clone the repository.                                           |
| **Docker**  | optional          | Only needed for the containerized run.                            |

AI features are **optional** and bring-your-own — the canvas, validation,
resiliency, cost, and IaC export all work without them. See
[Enable AI features](#4-enable-ai-features-optional) below.

The API accepts 120 requests per client per minute by default. Override
`RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` in `.env` when needed for local load
testing.

## 1. Clone and install

```bash
git clone https://github.com/aj-enns/azure-architecture-review.git
cd azure-architecture-review
pnpm install
```

`pnpm install` bootstraps every workspace package (`apps/*`, `packages/*`,
`tools/*`) in one pass.

## 2. Run in development

```bash
pnpm dev
```

This starts the web app and API together:

- Web: <http://localhost:5173>
- API health: <http://localhost:8080/healthz>

The Vite dev server proxies `/api` and `/healthz` to the API, so the browser
talks to a single origin. Both processes reload on save.

Open <http://localhost:5173> and you should see the canvas with the service
palette on the left. Drag a service onto the canvas to confirm everything is
wired up.

## 3. Capture your architecture

**Recommended:** the most robust and reproducible way to capture an existing
design is to define it as a **diagram JSON file** and import it via
**File → Import JSON** — the model is schema-validated and laid out by the same
engine the app uses, so it is deterministic and reviewable in a pull request.
Copy [docs/examples/solution-deployment-topology.json](examples/solution-deployment-topology.json)
as a starting point, edit the `nodes`, `groups`, and `edges`, and import the
result. See [Diagram your design](../README.md#diagram-your-design) for details.

Other ways to get started — the AI prompt, a pasted screenshot, and importing
from ARM/Bicep, a Git repository, or a live Azure resource group — are great for
exploration, but treat their output as a **best-effort draft** to review and
refine.

## 4. Enable AI features (optional)

AI generation, the advisor, and the AI review need a **Microsoft Foundry** or
**Azure OpenAI** endpoint. Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Then restart `pnpm dev`. At minimum set one of:

- **Microsoft Foundry** — `AZURE_FOUNDRY_ENDPOINT` and `AZURE_FOUNDRY_MODEL`.
- **Azure OpenAI** — `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT`.

Leave the API-key variables blank to authenticate **keyless** with Entra ID:
run `az login` locally, then grant your identity the **Cognitive Services OpenAI
User** role on the resource. The full variable reference lives in the
[README configuration table](../README.md#configuration), and the auth rationale
is in [ADR-0011](adr/0011-entra-id-keyless-azure-openai-auth.md).

If AI is left unconfigured, AI-backed endpoints return `503` and the AI panels
show a hint — every other feature keeps working.

## 5. Run with Docker (optional)

To run the production-style container image (web reverse-proxies the API):

```bash
docker compose up --build
```

- App: <http://localhost:8080>

AI env vars are read from your shell or `.env` and passed through to the API
container (see [docker-compose.yml](../docker-compose.yml)).

## Verify your setup

Run the workspace checks from the repo root:

```bash
pnpm build       # build all packages and apps
pnpm test        # unit tests (vitest)
pnpm typecheck   # type-check without emitting
```

All three should pass on a clean clone. The full script list is in
[CONTRIBUTING.md](../CONTRIBUTING.md#development-setup).

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| `pnpm: command not found` | Install pnpm: `npm install -g pnpm@9`, or enable Corepack with `corepack enable`. |
| Port 5173 or 8080 already in use | Stop the other process, or change `PORT` / `VITE_API_BASE_URL` in `.env`. The web dev server uses `strictPort`, so it fails fast rather than picking a new port. |
| AI panels show a 503 / "not configured" hint | Expected when no AI endpoint is set. Fill in `.env` and restart `pnpm dev`. |
| Keyless AI returns an auth error | Run `az login`, and confirm your identity has **Cognitive Services OpenAI User** on the resource ([ADR-0011](adr/0011-entra-id-keyless-azure-openai-auth.md)). |
| `docker compose up` can't reach the API | The web container waits for the API health check; give it a few seconds on first build. |

## Next steps

- **Deploy to Azure** — see the [README deploy section](../README.md#deploy-to-azure).
- **Understand the design** — browse the [ADRs](adr/README.md).
- **Track progress** — see [PROGRESS.md](PROGRESS.md).
- **Contribute** — read [CONTRIBUTING.md](../CONTRIBUTING.md).
