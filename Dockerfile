# GroundWork — container for the Next.js SSR app (App Runner).
# Multi-stage: install+compile native deps, build the standalone server, then a
# slim runtime. Serves all three modes; Mode 3 (COA) auto-mints its token
# server-side (see src/lib/context/coa-token.ts), so no token is baked in.
#
# Base image: official Node.js from Docker Hub, pinned to an immutable digest.
# This is a public sample — customers build it in their own AWS accounts and
# cannot pull from an internal registry, so a public base image is required.

# ---- deps: install with native toolchain for better-sqlite3 -----------------
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS deps
WORKDIR /app
# better-sqlite3 compiles a native addon → needs python3 + build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next standalone server ------------------------------
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The SQLite DB is seeded by the CI step (see buildspec.yml) and arrives in the
# build context as groundwork.db — running tsx here segfaults on amd64, so we
# bake in the pre-seeded file instead. (Local `finch build` also works: run
# `npm run db:seed` first so the file exists.)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime: slim image with just the standalone output --------------------
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
# Next's standalone server binds to os.hostname() by default, which in a
# container is the internal instance hostname — unreachable by App Runner's
# health checker. Force it to listen on all interfaces.
ENV HOSTNAME=0.0.0.0
# Build toolchain to compile the native sqlite addon against THIS runtime, then
# removed. Hand-copying the addon from the build stage produced a broken native
# module that segfaulted at request time (exit 139) — compiling it here fixes it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next standalone bundle + static assets + public dir.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Seeded DB (Modes 1/2).
COPY --from=build /app/groundwork.db ./groundwork.db
# Install better-sqlite3 fresh. Prefer the PREBUILT binary (build_from_source
# =false) — a source compile in the build stage produced a native addon that
# segfaulted at request time on this amd64 runtime. The prebuilt binary matches
# the platform reliably. Verify it loads at build time so a bad binary fails the
# build instead of crashing the container.
COPY package.json ./package.json
RUN BSV=$(node -e "console.log(require('./package.json').dependencies['better-sqlite3'])") \
 && npm_config_build_from_source=false npm install better-sqlite3@"$BSV" --no-save --no-package-lock \
 && node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.prepare('select 1 as x').get();db.close();console.log('better-sqlite3 loads OK')"

USER nextjs
EXPOSE 8080
# Runtime:
#  - The app dir is read-only and SQLite WAL needs to write sidecar files, so
#    copy the seeded DB to a writable /tmp path and point DB_PATH at it. This is
#    what makes Modes 1/2 work in the container (empty/read-only DB → crash).
#  - Force HOSTNAME=0.0.0.0 so App Runner's health check can reach the server
#    (Next standalone otherwise binds to the container hostname).
ENV DB_PATH=/tmp/groundwork.db
# Liveness probe — the app serves GET /api/health (returns {"status":"ok"}).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["sh", "-c", "cp -f ./groundwork.db /tmp/groundwork.db 2>/dev/null || true; HOSTNAME=0.0.0.0 exec node server.js"]
