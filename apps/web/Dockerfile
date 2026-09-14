# syntax=docker/dockerfile:1

# ---- Base: pnpm on Node 22 ----------------------------------------------------
FROM node:22-alpine AS base
ARG NPM_REGISTRY=https://packagefeedproxy.microsoft.io/npm
ENV npm_config_registry=$NPM_REGISTRY
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@9.15.9
WORKDIR /app

# ---- Dependencies -------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# ---- Build --------------------------------------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @aar/shared build \
  && pnpm --filter @aar/web build

# ---- Runtime: nginx serving static assets -------------------------------------
FROM nginx:1.27-alpine AS runtime
# API_UPSTREAM defaults to the docker-compose service; Azure overrides it with
# the internal Container Apps name. nginx envsubst renders the template on start.
ENV API_UPSTREAM=http://api:8080
COPY apps/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
