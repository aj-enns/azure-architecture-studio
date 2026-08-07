# ADR-0005: React Flow + shadcn/ui + Tailwind for the UI

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0001; Plan Phase 1

## Context

A core goal is to **improve the UI significantly** over the reference tool. The centerpiece
is an interactive node-graph canvas (drag/drop Azure services, groups, edges, mini-map,
auto-layout). We also want a polished, accessible design system with dark mode, a command
palette, and keyboard-first flows, targeting WCAG accessibility.

## Decision

We will build the UI with:

- **React Flow (`@xyflow/react`, MIT)** for the canvas — nodes, edges, groups, mini-map,
  controls. It is the de-facto standard the reference tool also uses.
- **shadcn/ui + Tailwind CSS** for the component/design system (owned components, easy
  theming, strong accessibility defaults).
- **cmdk** for the command palette; a theme provider for light/dark.
- **elk / dagre** for automatic graph layout.

## Alternatives considered

- **tldraw / custom canvas** — more control but far more work to reach parity with React
  Flow's node/edge/group features.
- **MUI / Chakra / Ant Design** — heavier, more opinionated, harder to fully restyle; we
  want to own the components for the "much better UI" goal. shadcn/ui gives us the source.
- **Plain CSS / CSS Modules** — slower to build a consistent, themeable system than Tailwind.

## Consequences

- Fast path to a rich canvas with a large community and MIT licensing.
- Owned, themeable components support dark mode and WCAG work as first-class concerns.
- The persisted diagram model (ADR-0002) stays independent of React Flow via an adapter.
