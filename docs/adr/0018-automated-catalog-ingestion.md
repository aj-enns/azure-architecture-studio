# ADR-0018: Automated Azure resource-type catalog ingestion

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Repository maintainers
- **Related:** [ADR-0002](0002-diagram-schema-shared-source-of-truth.md), [ADR-0006](0006-azure-icon-licensing.md)

## Context

The service catalog is hand-authored (`packages/shared/src/catalog.ts`). Azure adds
new services regularly, and a missing service is silently mapped by the AI to the
nearest catalog id (e.g. Microsoft Fabric rendering as Functions). We want new
services to surface automatically without letting the catalog degrade into thousands
of unlabelled, icon-less resource types.

Constraints:

1. **No official "popular Azure resource types" feed exists.** Completeness sources
   (the ARM providers API, `bicep-types-az`) list ~3,000 types with no icons,
   categories, or curated metadata.
2. **Curated metadata is irreplaceable.** Each catalog entry carries an icon slug,
   category, defaults, pricing/IaC hints, plus hand-tuned cost, resiliency, and
   throughput models keyed by service id. None of this comes from the raw feed.
3. **Azure Verified Modules (AVM) are a natural curation filter.** Only ~171 resource
   modules are published — the mainstream, deployable services — and each maps to one
   ARM resource type.

## Decision

**A scheduled tool detects new services and opens a PR of draft candidates; humans
curate before promotion. The machine never edits the hand-authored catalog.**

- `tools/catalog-sync` lists published **AVM resource modules**, resolves each
  module's primary ARM type from its compiled `main.json`, matches an **official
  icon**, and emits candidates as `packages/shared/src/catalog.generated.ts` — a
  separate, machine-owned file. `catalog.ts` merges `[...core, ...generated]` (core
  wins on id) so generated entries render but stay clearly delineated.
- **Inclusion filter = has an AVM module AND an official icon.** The pool is ~171,
  so this is the curation gate, not a popularity cap.
- **Popularity (GitHub code-search frequency) is ordering + a badge only**, never an
  inclusion gate — at this pool size a hard top-N cap would drop borderline services
  the maintainers care about.
- **A pin list** (Microsoft Fabric, Service Fabric, Power BI Embedded) is always
  emitted regardless of rank, with explicit icon slugs, so known-wanted niche
  services can't be filtered out.
- Generated entries are `draft: true` and shown with a **"New" badge**; the diff
  against the catalog uses the **core-only** list so the tool is idempotent.
- The weekly workflow (`.github/workflows/catalog-sync.yml`) runs the sync, validates
  (build + test + typecheck), and opens a PR with a promotion checklist. All feeds are
  public; the only secret is the built-in `GITHUB_TOKEN`.

## Consequences

- New Azure services appear automatically as reviewable PRs, keeping the palette
  current without eroding quality; promotion (defaults + cost/resiliency/throughput
  models, official icon) stays a human step.
- Draft services lack the hand-tuned models, so they fall back to safe defaults
  (non-gating throughput, estimated SLA) and are excluded from coverage guards until
  promoted — the PR checklist flags exactly what to add.
- Placeholder icons are used for pinned services until the official SVG is dropped in,
  consistent with the bundle-and-disclose stance of [ADR-0006](0006-azure-icon-licensing.md);
  a maintainer can point the workflow at the official icon set via `AZURE_ICONS_DIR`.
