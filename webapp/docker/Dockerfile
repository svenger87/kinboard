# Kinboard - Next.js Production Dockerfile
# Multi-stage build for optimal size

# ===================
# Stage 1: Dependencies
# ===================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat && npm install -g npm@11
# Suppress npm's "new major version available" notice on every command
# (the upgrade above doesn't help — Alpine's bundled npm 10 still
# prints the notice from any subprocess that invokes it).
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install dependencies based on lockfile
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "No lockfile found." && npm install; \
  fi

# ===================
# Stage 2: Builder
# ===================
FROM node:20-alpine AS builder
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env for Next.js. NEXT_PUBLIC_* values are inlined into the
# client JS bundle by `next build`, so they must be present at this stage
# (NOT just at runtime). docker-compose can pass them via build.args.
# When NOT provided, the build falls back to .env.local in the source —
# which is the normal flow for prod. When provided (e.g. by the
# screenshot demo stack), they override .env.local.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production
# V8's default heap (~2 GB on 64-bit) isn't enough for next build's
# type-check + static-generation phase on this codebase. Without
# bumping it, the build OOMs silently and produces no .next/standalone
# output, which then fails the runner stage's COPY. Set 4 GB which fits
# in a typical 4 GB VM with swap available.
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Conditionally export the build-time NEXT_PUBLIC_* if a non-empty value
# was passed via --build-arg. Inline `export` keeps the ARGs out of the
# final image's env when unused. If unset, Next.js reads .env.local as
# usual.
#
# `set -e` ensures any failure (including OOM in the npm subprocess)
# fails the RUN step, instead of silently producing a partial build
# without .next/standalone (which then masquerades as a runner-stage
# COPY failure).
RUN set -e; \
  if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ]; then \
      export NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"; \
  fi; \
  if [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then \
      export NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"; \
  fi; \
  # Substitute the SW's CACHE_NAME placeholder with the package.json
  # version. This evicts the previous release's static-chunk cache on
  # SW activation, preventing ChunkLoadError after auto-updates.
  KINBOARD_VERSION=$(node -p "require('./package.json').version"); \
  sed -i "s/__KINBOARD_VERSION__/${KINBOARD_VERSION}/g" public/sw.js; \
  if [ -f yarn.lock ]; then yarn build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm build; \
  else npm run build; \
  fi; \
  # Belt-and-suspenders: refuse to proceed if standalone wasn't produced.
  test -d .next/standalone || { \
    echo "ERROR: next build completed but .next/standalone is missing."; \
    echo "       Verify next.config.mjs has output: 'standalone'."; \
    exit 1; \
  }

# ===================
# Stage 3: Runner
# ===================
FROM node:20-alpine AS runner
WORKDIR /app

# curl: cron job health checks (existing). postgresql-client: provides
# `psql` + `pg_isready` for the entrypoint's migration-runner logic.
RUN apk add --no-cache curl postgresql-client

# Add sync script for cron jobs
RUN echo '#!/bin/sh' > /usr/local/bin/google-sync && \
    echo 'curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/google-sync' >> /usr/local/bin/google-sync && \
    chmod +x /usr/local/bin/google-sync

# Add todo reminders cron script
RUN echo '#!/bin/sh' > /usr/local/bin/todo-reminders && \
    echo 'curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/todo-reminders' >> /usr/local/bin/todo-reminders && \
    chmod +x /usr/local/bin/todo-reminders

# Add notification queue processor cron script
RUN echo '#!/bin/sh' > /usr/local/bin/process-notifications && \
    echo 'curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/process-notifications' >> /usr/local/bin/process-notifications && \
    chmod +x /usr/local/bin/process-notifications

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Set correct permissions for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Bake migrations + entrypoint script into the image. The entrypoint
# applies migrations against the db before exec'ing the Next.js
# server — see webapp/docker/webapp-entrypoint.sh. This is the path
# Watchtower-driven self-hoster updates rely on (the alternative,
# webapp/docker/start.sh's run_migrations(), is host-driven and only
# fires when the operator manually invokes the script).
COPY --chown=nextjs:nodejs docker/migration*.sql ./migrations/
COPY --chown=nextjs:nodejs docker/webapp-entrypoint.sh ./webapp-entrypoint.sh
USER root
RUN chmod +x ./webapp-entrypoint.sh
USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["./webapp-entrypoint.sh"]
