# quick-mcp-proxy — container for App Runner.
#
# Much simpler than GroundWork's image: pure TypeScript→JS, no native addons,
# no database, no Next.js. Multi-stage: compile with devDeps, then a slim
# runtime with only production deps + the compiled dist/.
#
# Public base image pinned by digest (same policy as GroundWork's Dockerfile):
# this is buildable in any AWS account without an internal registry.

# ---- build: compile TypeScript ----------------------------------------------
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production deps + dist only -----------------------------------
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# App Runner routes to the container port; the server reads PORT.
ENV PORT=8080
# Inside the container, listen on the container network so the platform's
# front door can reach it. The server REFUSES to start on a non-loopback bind
# unless OAuth JWT verification (QUICK_OAUTH_ISSUER + client id/audience) is
# configured, so this image never serves /mcp unauthenticated. For local
# `docker run`, publish to loopback only: -p 127.0.0.1:8080:8080
ENV BIND_HOST=0.0.0.0

# Non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nodeuser

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Bake in the hero-answer cache so scripted demo questions are instant even
# before any live COA call. Copied from the repo's src/data/coa-cache at build.
COPY coa-cache ./coa-cache
ENV COA_CACHE_DIR=/app/coa-cache

USER nodeuser
EXPOSE 8080
# Liveness probe — the server serves GET /health → {"ok":true}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.js"]
