# Gift Cards (INK-1092). Coolify: base_directory "/", dockerfile_location "/Dockerfile", port 3000.
FROM node:20-slim AS base
# git: pnpm fetches @inkress/app-kit and @inkress/app-bridge from GitHub.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Pin pnpm 9 as the default too: pnpm prepares git dependencies (app-kit, app-bridge) with a nested install that
# ignores this package.json, and a newer default pnpm refuses their build scripts.
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app
EXPOSE 3000
CMD ["node", "server.mjs"]
