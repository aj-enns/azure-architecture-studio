# ADR-0010: AI prompt-to-diagram via server-side structured output + layout

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0002, ADR-0003

## Context

Phase 2 adds "describe your architecture in words → get a diagram". The model must
produce something the canvas can render, and the result must be trustworthy: no
arbitrary/unsafe fields, only real catalog services, and always a valid `Diagram`
(ADR-0002). Two questions: (1) how do we call the model, and (2) what shape does it
return?

Considerations:

- The Azure OpenAI key is **bring-your-own and server-side only** (ADR-0003) — the
  browser must never see it, so generation happens in the API.
- LLMs are poor at pixel coordinates but good at logical graphs (which services,
  how they connect, how they nest).
- We want minimal dependencies and a stable contract that can't drift with the full
  `Diagram` schema.

## Decision

**The API owns AI generation end to end.** `POST /api/generate` takes a natural-language
prompt (plus optional current diagram for context) and returns a fully-validated
`Diagram`.

1. **No SDK — call the Azure OpenAI REST API with `fetch`** (Node 22 global fetch).
   Chat Completions with **`response_format: json_schema`** (structured outputs) so
   the model returns JSON matching a compact **AI spec**, not the full `Diagram`.
2. **The AI spec is intentionally loose and position-free** — the model emits
   `nodes` (model-chosen `key`, a catalog `serviceId`, `label`, optional `group`),
   `groups` (`key`, `kind`, `label`), and `edges` (`from`/`to` keys). It never sets
   coordinates or our internal id prefixes.
3. **The server maps spec → `Diagram`**: it drops any node whose `serviceId` is not
   in the catalog, assigns real ids (`n_`/`g_`/`e_`), runs a **deterministic layered
   grid layout** to place nodes/groups, then validates the result with
   `safeParseDiagram`. Only a schema-valid diagram is ever returned.
4. When Azure OpenAI is not configured, `/api/generate` returns **503** with a clear
   message; the web disables the AI panel and explains how to configure it.

## Alternatives considered

- **Tool/function calling** (the original Phase-2 note) — viable, but for a single
  one-shot diagram, structured outputs is simpler and equally reliable; no
  multi-turn tool loop to manage.
- **Have the model output full `Diagram` JSON (with positions)** — brittle: models
  place nodes poorly and can emit fields that fight the strict schema/id rules.
- **Generate in the browser** — would leak the API key to the client; rejected per
  ADR-0003.
- **Add the `openai` SDK** — extra dependency and Azure-config surface for a single
  REST call we can make directly.

## Consequences

- The AI can only ever produce real catalog services, and the response is guaranteed
  to satisfy the `Diagram` schema (ADR-0002) — safe to load straight onto the canvas.
- Layout quality is owned by our deterministic layout, not the model, so results are
  reproducible and predictable.
- The AI spec is a second (small) schema to maintain alongside `Diagram`, but it
  decouples the prompt contract from internal rendering details.
- Using raw `fetch` means we handle Azure OpenAI errors/timeouts ourselves; kept
  minimal with a clear 503/500 mapping.
- **Follow-up:** streaming responses and multi-turn refinement are out of scope for
  this phase (single request/response); revisit if the guided-chat UX needs it.
