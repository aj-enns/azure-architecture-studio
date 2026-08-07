# ADR-0003: Bring-your-own Azure OpenAI for AI generation

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** Plan Phase 2; ADR-0008

## Context

The tool generates diagrams from natural-language prompts (Guided Chat) and will offer
AI-assisted architecture validation. Because customers will **self-host this in their own
Azure environment** for their ARB process, they need the AI calls to use *their* model
deployment, keys, and data-residency boundary — not a hosted endpoint we control.

## Decision

AI features will call **Azure OpenAI using bring-your-own configuration**, supplied via
server-side environment variables:

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`

Keys live only on the API server and are **never** exposed to the browser. The API mediates
all model calls. Server-side Zod validation (ADR-0002) checks and retries malformed model
output before it reaches the client.

## Alternatives considered

- **Pluggable multi-provider abstraction (Azure OpenAI + OpenAI + Anthropic)** — more
  flexible but more surface area; deferred until there is demand. Keeping a thin provider
  seam makes this a later, non-breaking addition.
- **OpenAI only** — poor fit for enterprise self-host / data-residency requirements.
- **Client-side model calls** — would leak keys to the browser. Rejected outright.

## Consequences

- Enterprises keep model traffic inside their own Azure tenant and governance boundary.
- No AI credentials in the frontend; the API is the only place secrets live.
- Works with Azure API Management / AI Gateway in front of the model for orgs that want
  token limits, content safety, or caching.
- A future provider abstraction can be added behind the same API contract without breaking
  the frontend.
