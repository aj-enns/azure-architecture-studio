# ADR-0013: One analysis panel open at a time

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Repository maintainers
- **Related:** [ADR-0005](0005-ui-stack-react-flow-shadcn.md), [ADR-0012](0012-resiliency-sla-rpo-rto-modelling.md)

## Context

Panel visibility lived as one `useState` boolean per panel in `App.tsx`, and every
panel is a fixed-width `w-80` sibling of the canvas. With AI, Validation, Cost, and
IaC that already allowed four open at once; adding the Resiliency panel made five,
squeezing the canvas to the point where the diagram under review is barely visible.

Nothing in the workflow calls for two analysis panels side by side — they all answer
questions about the same diagram, one at a time.

## Decision

**We will track a single `activePanel` in the UI store.**

`useUiStore` gains `activePanel: PanelId | null` plus `togglePanel` and `closePanel`,
persisted alongside the existing `showProperties` and `showGrid` preferences. Panels
keep their `{ open, onClose }` prop shape; `App.tsx` derives `open` from
`activePanel === '<id>'`. Opening one panel closes the previous one.

The Properties panel is unaffected — it is a separate, independently toggled rail.

## Alternatives considered

- **Leave the booleans as they are** — rejected. Five simultaneous `w-80` panels leave
  almost no canvas, and the state was already duplicated five times in `App.tsx`.
- **Tabs within a single analysis panel** — rejected for now. It is a larger UI change
  and the toolbar buttons already act as the tab strip in practice.
- **Make panels resizable or floating** — rejected as scope. It solves a different
  problem (panel width) and adds layout state we do not otherwise need.

## Consequences

- The canvas keeps a predictable amount of room regardless of how many analyses exist,
  so future panels cost nothing in layout.
- Panel choice now survives a reload, which was not previously true.
- Comparing two analyses side by side is no longer possible; the toolbar makes
  switching a single click, which we judge an acceptable trade.
- `Toolbar` no longer takes four `onToggle*` props, only `onOpenCommand`.
