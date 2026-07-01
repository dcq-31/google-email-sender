# syntax=docker/dockerfile:1

# ── Stage 1: builder ─────────────────────────────────────────────────────────
# Full dependency set + TypeScript build (nest build → dist/).
FROM node:24-alpine AS builder
WORKDIR /app

# Enable the pinned pnpm from package.json via corepack.
RUN corepack enable

# Install with the lockfile first (cache-friendly: only re-runs when manifests change).
# --ignore-scripts: none of the flagged native deps (ssh2, cpu-features, protobufjs,
# unrs-resolver) need their build scripts at runtime — each has a pure-JS fallback and
# they're dev/test-only — and skipping them avoids pnpm's ERR_PNPM_IGNORED_BUILDS.
# Our own build runs as an explicit `pnpm build` below, unaffected by this flag.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the app.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# ── Stage 2: prod-deps ───────────────────────────────────────────────────────
# Lean, production-only node_modules. Keeps `typeorm` (a runtime dep) so its CLI
# is available for running migrations against the compiled dist/ data source.
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Run unprivileged (the base image ships a `node` user).
USER node

EXPOSE 3000

# Liveness via the app's /health endpoint. Uses Node so it works on alpine
# without curl/wget installed.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Default command starts the service only. Migrations run as a separate,
# ordered step (see the `migrate` service in docker-compose.yml) — the app
# never applies schema changes on boot (migrationsRun:false / synchronize:false).
CMD ["node", "dist/main.js"]
