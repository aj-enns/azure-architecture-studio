# ADR-0009: Web container reverse-proxies the API (same-origin)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** ADR-0004, ADR-0008

## Context

The SPA calls `/api/*` and `/healthz` as **same-origin** relative paths. In local
dev, Vite's dev server proxies these to the API. In containers, the web image is
nginx serving static assets, so something must route `/api` to the API service.
We want to avoid CORS complexity and avoid exposing the API publicly by default
(ADR-0008).

## Decision

The **web container (nginx) reverse-proxies** `/api/*` and `/healthz` to the API,
so the browser only ever talks to one public origin (the web app). The API runs
with **internal ingress** and is not exposed publicly.

- **docker-compose:** nginx proxies to `http://api:8080` (compose service DNS).
- **Container Apps:** the API uses internal ingress; the web app must proxy to the
  API's internal FQDN.

## Alternatives considered

- **Expose the API publicly and use CORS** — larger attack surface and CORS config
  burden; conflicts with "API not public by default" (ADR-0008).
- **Single container running both** — couples web and API scaling/lifecycle; loses
  the independent-deploy benefit from ADR-0001.

## Consequences

- Same-origin frontend: no CORS needed in the browser path; simplest security model.
- The nginx upstream differs between Compose (`api:8080`) and Container Apps
  (internal FQDN). **Follow-up:** make the nginx upstream configurable at container
  start (env-substituted `nginx.conf` template) so one image works in both. Until
  then the committed `nginx.conf` targets the Compose service name and the Bicep
  path needs the upstream templated — tracked in docs/PROGRESS.md.
