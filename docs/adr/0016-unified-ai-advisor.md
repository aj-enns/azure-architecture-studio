# ADR-0016: Unified AI advisor with explicit diagram modification

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Repository maintainers
- **Related:** [ADR-0010](0010-ai-prompt-to-diagram.md), [ADR-0013](0013-single-active-panel.md), [ADR-0014](0014-in-app-ai-architecture-review.md)

## Context

The original AI panel only generated or modified diagrams. It could not answer
architecture questions such as "Do I need a load balancer?" without turning the
answer into a canvas mutation. The full Architecture Review panel can synthesize a
report, but it is deliberately one-shot and too broad for focused questions and
follow-ups.

Advice and mutation need different safety semantics. An architecture answer should
explain assumptions and trade-offs without changing the design. A requested diagram
change should remain visible and deliberate. Adding a separate advisor panel would
also consume another toolbar action even though both workflows are forms of AI help.

## Decision

**The existing AI rail will become one assistant with explicit `Ask` and `Modify`
modes.**

- `Ask` sends the current question, the latest validated `Diagram`, and at most ten
  earlier user/assistant messages to stateless `POST /api/advise`. Conversation
  history belongs to the mounted browser component and is not persisted across page
  reloads or stored by the API.
- Every advisory request includes deterministic WAF, resiliency, and cost analysis.
  Microsoft Learn grounding is best-effort; unavailable grounding produces a warning
  but does not prevent an answer.
- The latest diagram is authoritative. Earlier turns provide conversational context
  but may describe a topology that has since changed.
- Advice never mutates the canvas. A structured response may include a nullable,
  self-contained `diagramPrompt`. The UI exposes it as `Modify diagram`, which only
  switches mode and pre-fills the prompt. The user must explicitly run the change.
- `Modify current` sends the existing diagram as context and expects the complete
  revised diagram. The validated result replaces the canvas. This supersedes the old
  append-and-merge behavior, which could duplicate nodes already returned by the
  model. `New diagram` remains a context-free replacement.
- Responses remain non-streaming structured outputs through the existing
  `generateJson` helper. The configured default inference model is used; model
  selection remains a concern of the full Review panel.

ADR-0010's one-shot diagram-generation contract remains in force. This decision adds
multi-turn context only to advisory Q&A; each individual API call is still stateless.

## Alternatives considered

- **A separate Advisor panel** - rejected. It separates related AI workflows and adds
  another right-rail destination without improving the mutation boundary.
- **Put questions in Architecture Review** - rejected. Focused Q&A and a fixed,
  comprehensive review have different interaction and output shapes.
- **Server-side conversation sessions** - rejected for the MVP. They require storage,
  expiry, scaling, and privacy decisions while the browser can safely replay a small
  bounded transcript.
- **Return a structured diagram diff with Apply** - deferred. It would provide a
  stronger preview but introduces a second mutation engine beside prompt-to-diagram.
- **Automatically run a recommended change** - rejected. Advice must not silently
  alter the artifact being evaluated.

## Consequences

- Users can ask contextual questions and follow-ups while keeping the current diagram
  visible.
- The API remains horizontally stateless and stores no chat transcripts.
- Transcript and diagram size are sent on each turn; the ten-message cap bounds this
  cost but does not perform token-aware summarization.
- Conversation is intentionally ephemeral and disappears on page reload.
- Diagram changes remain explicit, validated, and owned by one generation path.
- Streaming, persisted history, direct diffs, and automatic tool execution remain
  possible future increments rather than MVP requirements.