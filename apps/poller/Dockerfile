# Multi-stage build for the poller. Final image is ~150MB on Alpine.
FROM node:20-alpine AS base
RUN corepack enable

# ---- deps ----
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/poller/package.json apps/poller/
RUN pnpm install --frozen-lockfile || pnpm install

# ---- build ----
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/poller ./apps/poller
RUN pnpm --filter @slickalerts/poller build

# ---- runtime ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /repo/apps/poller/dist ./dist
COPY --from=build /repo/apps/poller/package.json ./
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/node_modules ./node_modules

EXPOSE 8080
CMD ["node", "dist/index.js"]
