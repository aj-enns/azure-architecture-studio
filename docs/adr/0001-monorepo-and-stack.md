# ADR-0001: pnpm monorepo with React + Fastify + TypeScript

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** Plan Phase 0; ADR-0002, ADR-0005

## Context

We are building an open-source, self-hostable Azure architecture diagram builder that
customers can run in their own environment for their ARB process. The app has a rich
interactive frontend (canvas, palette) and a backend that will talk to Azure OpenAI,
Azure Resource Graph, and the Azure Retail Prices API. We want a single language across
the stack to reduce context-switching and share the diagram model between client and
server.

## Decision

We will use a **pnpm workspace monorepo** with:

- `apps/web` — React + Vite + TypeScript frontend
- `apps/api` — Fastify + TypeScript backend
- `packages/shared` — TypeScript types, Zod schemas, and the Azure service catalog
- `infra/` — Bicep for deployment

TypeScript is the single language end-to-end. pnpm is the package manager (installed via
npm global since corepack could not write to the Program Files Node install on this host).

## Alternatives considered

- **Next.js full-stack** — one framework for UI + API. Rejected for MVP: the canvas is a
  heavy client-side SPA, and a dedicated Fastify API keeps the Azure SDK / AI calls cleanly
  separated and independently deployable as a container.
- **Python (FastAPI) backend** — good Azure SDK story, but would split the codebase across
  two languages and prevent sharing the diagram schema with the frontend.
- **Turborepo / Nx** — more tooling than needed at this stage; pnpm workspaces cover the
  build orchestration we need for MVP.

## Consequences

- One language and one shared schema package for web + api (see ADR-0002).
- Each app has its own Dockerfile and can be deployed independently to Container Apps.
- Requires pnpm on contributor machines; documented in README. corepack may fail on
  machines where the Node install dir is not user-writable — fall back to `npm i -g pnpm`.
