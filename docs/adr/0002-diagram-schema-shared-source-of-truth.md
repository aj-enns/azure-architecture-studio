# ADR-0002: Zod diagram schema in `packages/shared` as the single source of truth

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0001; Plan Phases 1–6

## Context

The diagram model is consumed by many parts of the system: the canvas renders it, the
import/export round-trips it, the AI generation endpoint must **produce** it, the IaC
exporter maps it to Bicep, pricing walks its nodes, and validation inspects it. If each
component defined its own shape, they would drift and AI output could not be trusted.

## Decision

We will define the diagram model **once**, as Zod schemas in `packages/shared/src/schema.ts`,
and derive TypeScript types from them via `z.infer`. The schema is intentionally
**UI-library-agnostic** — no React Flow types leak into it — so the same model can drive
rendering, AI generation, IaC export, pricing, and validation. A `version` literal is
included for forward-compatible migrations.

## Alternatives considered

- **Hand-written TypeScript interfaces** — no runtime validation, so imported JSON and AI
  output could not be safely validated at the boundary. Rejected.
- **JSON Schema + codegen** — heavier toolchain; Zod gives us runtime validation and static
  types from one definition with less ceremony.
- **Reuse React Flow's node/edge types directly** — couples the persisted model to a UI
  library and complicates server-side use (AI, IaC, pricing). Rejected.

## Consequences

- All untrusted input (imported files, AI responses) is validated with `safeParseDiagram`
  at the boundary — critical for trusting AI-generated diagrams (Phase 2).
- The web app adapts the shared model to React Flow's structures in an adapter layer, not
  in the schema itself.
- Schema changes are versioned; a bump to `version` signals a migration is needed.
