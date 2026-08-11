# Progress Tracker

Live status for the Azure Architecture Review build. Mirrors the working plan.

**Legend:** ⬜ not started · 🟡 in progress · ✅ done · ⏸️ blocked/paused

---

## Phase 0 — Foundation & scaffolding

| #   | Task                                                        | Status |
| --- | ----------------------------------------------------------- | ------ |
| 0.1 | Verify toolchain (Node, pnpm, git)                          | ✅     |
| 0.2 | Monorepo root config (pnpm workspace, tsconfig, prettier)   | ✅     |
| 0.3 | `packages/shared` — Zod diagram schema                      | ✅     |
| 0.4 | `packages/shared` — Azure service catalog + barrel export   | ✅     |
| 0.5 | `apps/api` — Fastify app, `/healthz`, `/api/catalog`, config | ✅     |
| 0.6 | `apps/web` — Vite + React + Tailwind + shadcn theme shell   | ✅     |
| 0.7 | Docker (per-app) + docker-compose + `.dockerignore`         | ✅     |
| 0.8 | `infra` — Bicep skeleton for Container Apps                 | ✅     |
| 0.9 | OSS hygiene (LICENSE, README, CONTRIBUTING, TERMS, PROGRESS)| ✅     |
| 0.10| Install deps + verify build / tests / typecheck             | ✅     |

### Known follow-ups from Phase 0

- **nginx upstream** is hardcoded to the Compose service name (`api:8080`).
  Templatize it via env substitution so one web image works in both Compose and
  Container Apps (internal FQDN). See
  [ADR-0009](adr/0009-web-reverse-proxy-topology.md).
- Bundle the actual Microsoft Azure icon SVGs into
  `apps/web/src/assets/azure-icons/` (currently a README placeholder).
- **`docker compose up` not yet verified** — Docker daemon was not running in the
  build environment. `pnpm build`, `pnpm test`, and `pnpm typecheck` all pass.

---

## Phase 1 — Interactive canvas (first shippable milestone)

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 1.1 | React Flow canvas + custom Azure service node             | ✅     |
| 1.2 | Palette (drag/drop from shared catalog, categorized)      | ✅     |
| 1.3 | Groups/containers (subscription, RG, VNet, subnet)        | ✅     |
| 1.4 | Mini-map, controls, background, compound Dagre auto-layout| ✅     |
| 1.5 | Properties panel (edit node/group defaults)               | ✅     |
| 1.6 | Persistence: localStorage autosave + JSON import/export   | ✅     |
| 1.7 | Export to PNG / SVG                                        | ✅     |
| 1.8 | Command palette (cmdk) + keyboard shortcuts               | ✅     |
| 1.9 | Dark mode toggle + WCAG accessibility pass                | 🟡     |

---

## Phase 2 — AI prompt-to-diagram

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 2.1 | `/api/generate` with Azure OpenAI structured outputs      | ✅     |
| 2.2 | Guided Chat UI → diagram, Zod-validated at boundary       | ✅     |
| 2.3 | Merge/replace generated diagram into canvas               | ✅     |
| 2.4 | Contextual Ask mode with explicit Modify handoff           | ✅     |

---

## Phase 3 — IaC export (original roadmap; delivered as parity Phase 5)

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 3.1 | Map catalog `iac` hints → Bicep/AVM-aware scaffolding     | 🟡     |
| 3.2 | Terraform AzAPI target                                    | 🟡     |
| 3.3 | Preview/download generated files from the API             | ✅     |

Initial deterministic generation supports Storage, Key Vault, Managed Identity,
VNet, Log Analytics, Application Insights, Container Registry, and Cosmos DB.
Catalog coverage now also includes AKS, Container Apps, Static Web Apps, API
Management, PostgreSQL, Load Balancer, Front Door, Azure OpenAI, AI Search,
Event Hubs, Data Explorer, and Service Bus. The reference three-tier
architecture is also composed end to end: VNet/subnet
groups, Application Gateway with a public IP and App Service backend, App
Service Plan/App Service with VNet integration and managed identity, SQL
server/database, Azure Managed Redis and its default database, and Private
Endpoints resolved from diagram edges. Required SQL and gateway secrets are
secure inputs. Other catalog services emit explicit diagnostics until their
topology-specific inputs are modeled.

VM, VM Scale Set, Functions, Logic Apps, and AI Foundry remain diagnostic-only
until their multi-resource dependencies (NICs/credentials, storage/plan, or
associated workspace resources) are modeled.

---

## Phase 4 — Pricing

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 4.1 | Curated regional fallback + live Retail Prices refinement | 🟡     |
| 4.2 | Per-node + total monthly estimate on canvas               | ✅     |

---

## Phase 5 — Import from live Azure

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 5.1 | Resource Graph query via `@azure/identity`                | ⬜     |
| 5.2 | Map live resources → diagram model                        | ⬜     |

---

## Phase 6 — WAF / ARB validation

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 6.1 | Rule engine over the diagram model                        | ✅     |
| 6.2 | AI-assisted Well-Architected review                       | ✅     |
| 6.3 | ARB report export                                         | ⬜     |

---

## Phase 7 — Resiliency (SLA / RPO / RTO)

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 7.1 | Baseline SLA table + three-gate zone-redundancy model      | ✅     |
| 7.2 | Composite SLA, weakest link, target comparison             | ✅     |
| 7.3 | Canvas SLA overlay (badge, heat-map tint, weakest ring)    | ✅     |
| 7.4 | Microsoft Learn grounded refresh with citations            | ✅     |
| 7.5 | Per-node region modelling for true multi-region topologies | ⬜     |

---

## Change log

- **2026-08-11** — The AI rail is now a unified assistant with explicit `Ask` and
  `Modify` modes (ADR-0016). `POST /api/advise` answers focused architecture
  questions using the latest diagram, a bounded client-owned transcript,
  deterministic WAF/resiliency/cost analysis, and best-effort Microsoft Learn
  grounding. Advice returns Markdown, citations, and an optional self-contained
  modification prompt; it never mutates the canvas. The UI supports follow-ups,
  starter questions, retry, clear, source links, and a `Modify diagram` handoff that
  only pre-fills the existing generator. `Modify current` now replaces the canvas
  with the model's complete revised diagram, removing the duplicate-prone append
  merge path. Advisor API tests and web/API typechecks pass.

- **2026-08-11** — AI architecture review (Phase 6.2) landed: `POST /api/review`
  runs the model with the `waf-architecture-review` skill methodology as the system
  prompt (`apps/api/src/ai/review.ts`), fed the deterministic WAF + resiliency + cost
  analysis and optional Microsoft Learn grounding, and returns a Markdown review.
  503 when the model is unconfigured (like `/api/generate`), 400 for an empty
  diagram, soft-fail grounding. Web: a `review` panel (part of the single
  `activePanel` rail) with a run button, Learn toggle, and `react-markdown` +
  `remark-gfm` rendering; Toolbar `Review` button. Reuses the generalized
  `generateJson` helper. `pnpm typecheck` clean; 27 API tests pass (3 new: 503
  unconfigured, 400 empty). ADR-0014 recorded. The API embeds a copy of the skill
  methodology that must be kept in sync with the SKILL.md (noted in `review.ts`).
  Live model run and browser click-through unverified here (no credentials; the
  animating canvas blocks Playwright's stability check).

- **2026-08-11** — Phase 7 resiliency landed: `packages/shared/src/resiliency.ts`
  adds a curated per-service SLA/RPO/RTO baseline for all 32 catalog services with
  provenance (`source.kind`, url, `verifiedOn`, `confidence`), plus `AZ_REGIONS`.
  Zone redundancy resolves through three gates — availability-zone region,
  service/SKU capability, and the user's `zoneRedundant` flag — downgrading the tier
  and naming the blocking gate when any fails. Composite SLA is the product of
  request-path services per WAF guidance, excluding management/identity/devops
  categories. New `POST /api/resiliency` always returns the deterministic baseline
  and, with `grounded: true`, refreshes figures from the Microsoft Learn reliability
  guides over a single MCP session plus one structured-output call, returning
  citations; grounding failure degrades to the baseline and never 5xxs.
  `learnGrounding.ts` refactored for session reuse (`searchLearnDocsBatch`,
  `searchLearnDocsCached`) and no longer caches empty results for the full TTL;
  `openai.ts` gained a reusable `generateJson`. Web: `ResiliencyPanel` (target
  editor, composite + downtime, weakest link, worst-first list, Learn refresh with
  citations, CSV export), opt-in canvas SLA overlay, editable diagram region with a
  no-zones warning, and `diagramMetadataSchema.resiliency`. `zoneRedundant` /
  `multiRegion` added to catalog defaults where the service supports them, and the
  Bicep/Terraform emitters now read `zoneRedundant` instead of hardcoding `false`.
  Panels moved to a single persisted `activePanel`. `pnpm test`/`typecheck` green
  (78 tests: 53 shared + 25 api). ADRs 0012–0013 recorded. Grounded refresh is
  unverified against a live model (no credentials configured here). Repo-wide
  `lint` (eslint not installed) and `format:check` were already failing before this
  change and remain so.

- **2026-08-06** — Phase 0 complete: shared schema + catalog, api, web shell,
  Docker, Bicep, OSS hygiene. `pnpm build`/`test`/`typecheck` green (9 shared+api
  tests). ADRs 0001–0009 recorded. Docker compose run pending (daemon offline).
  Starting Phase 1 (interactive canvas).
- **2026-08-06** — Phase 1 interactive canvas landed: Zustand diagram store with
  localStorage autosave + JSON import/export; React Flow canvas with custom
  `AzureNode` + resizable `GroupNode`; model↔flow adapter; drag-drop Palette;
  Properties panel; Toolbar (New/Import/JSON/PNG/SVG/theme); cmdk command palette
  (Ctrl/Cmd+K); PNG/SVG export via html-to-image; ThemeProvider wired in
  `main.tsx`. `pnpm build`/`test`/`typecheck` green. Follow-ups (1.4/1.9): true
  auto-layout and a formal WCAG audit still open; group parent/child nesting is
  render-order only (nodes are not yet re-parented on drop into a group).
- **2026-08-06** — Phase 2 AI prompt-to-diagram landed: API `POST /api/generate`
  calls Azure OpenAI Chat Completions via `fetch` with `json_schema` structured
  outputs (no SDK — ADR-0010); server drops unknown service ids, assigns ids, runs
  a deterministic layered-grid layout, and Zod-validates the result. Returns 503
  when Azure OpenAI is unconfigured (bring-your-own). Web: `api.ts` client,
  `mergeDiagram` store action (offsets appended content), and a Guided Chat
  `AiPanel` (replace/append modes, examples, Ctrl/Cmd+Enter, health-gated).
  `pnpm typecheck`/`test`/`build` green (13 tests: 7 shared + 6 api). Live Azure
  OpenAI call unverified (no credentials configured in this environment).
- **2026-08-11** — Foundry-first parity phases 1–4 complete: Microsoft Learn
  grounding, deterministic WAF review, compound Dagre layout with nested groups,
  and regional cost estimates with node badges, summary panel, CSV, and API.
  Live Retail Prices API remains an optional accuracy refinement.
- **2026-08-11** — IaC generation started (parity Phase 5): shared deterministic
  Bicep and Terraform/AzAPI bundle generator, `POST /api/iac`, diagnostics for
  resources requiring additional inputs, and an editor preview/download panel.
  Initial supported resource set is listed under Phase 3 above.
- **2026-08-11** — IaC composition expanded to cover the saved three-tier
  reference diagram (11 non-conceptual resources) in both targets. Bicep
  compiles and Terraform validates with AzAPI v2.12.0; Entra ID remains an
  informational tenant-scoped omission.
- **2026-08-11** — IaC catalog coverage broadened to 26 services: added AKS,
  Container Apps, Static Web Apps, API Management, PostgreSQL, Load Balancer,
  Front Door, Azure OpenAI, AI Search, Event Hubs, Data Explorer, and Service
  Bus. All new services compile in Bicep and validate in Terraform (AzAPI
  v2.12.0) with zero diagnostics. VM, VMSS, Functions, Logic Apps, and AI
  Foundry stay diagnostic-only pending multi-resource dependency modeling.
