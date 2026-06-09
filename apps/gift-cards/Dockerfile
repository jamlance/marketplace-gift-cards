# Multi-stage build for Pre-orders.
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/gift-cards ./apps/gift-cards
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/gift-cards
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/gift-cards/package.json ./apps/gift-cards/package.json
COPY --from=builder /work/apps/gift-cards/node_modules ./apps/gift-cards/node_modules
COPY --from=builder /work/apps/gift-cards/dist ./apps/gift-cards/dist
COPY apps/gift-cards/server.js ./apps/gift-cards/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/gift-cards
CMD ["node", "--import", "@opentelemetry/auto-instrumentations-node/register", "server.js"]
