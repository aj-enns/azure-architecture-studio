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
| 1.4 | Mini-map, controls, background, auto-layout               | 🟡     |
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

---

## Phase 3 — IaC export

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 3.1 | Map catalog `iac` hints → Bicep (Azure Verified Modules)  | ⬜     |
| 3.2 | Terraform target                                          | ⬜     |
| 3.3 | Download bundle from the API                              | ⬜     |

---

## Phase 4 — Pricing

| #   | Task                                                      | Status |
| --- | --------------------------------------------------------- | ------ |
| 4.1 | Azure Retail Prices API integration via catalog `pricing` | ⬜     |
| 4.2 | Per-node + total monthly estimate on canvas               | ⬜     |

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
| 6.1 | Rule engine over the diagram model                        | ⬜     |
| 6.2 | AI-assisted Well-Architected review                       | ⬜     |
| 6.3 | ARB report export                                         | ⬜     |

---

## Change log

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
