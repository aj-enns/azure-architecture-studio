# ADR-0007: localStorage + JSON files for MVP persistence (no database)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0002; Plan Phase 1

## Context

Diagrams need to persist between sessions and move between machines/users. A full team
history store (versions, sharing, audit) would be valuable for an ARB process eventually,
but adds a database, migrations, and auth to the MVP before the core experience is proven.

## Decision

For the MVP, persistence is **client-side only**:

- Autosave the working diagram to **localStorage**.
- **JSON file import/export** for portability, backup, and sharing (round-trips through the
  Zod schema in ADR-0002).
- **PNG/SVG export** for embedding diagrams in documents.

No database, no server-side storage in MVP.

## Alternatives considered

- **Add Postgres/Cosmos now** for team ARB history and versioning. Deferred — too much
  scope before the canvas and AI experience are validated.
- **Pluggable storage adapter now** — premature abstraction; we will introduce a storage
  seam only when a backend store is actually added.

## Consequences

- Zero backend state to operate for MVP; trivial to self-host.
- Sharing is manual (export/send the JSON file) until a backend store exists.
- A future ADR will cover a server-side store (versioning, multi-user ARB history) and will
  supersede this one for that scope.
