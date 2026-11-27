# Kinboard - Next.js Production Dockerfile
# Multi-stage build for optimal size

# ===================
# Stage 1: Dependencies
# ===================
FROM node:22-alpine AS deps
# Pinned to match `packageManager` in package.json — a floating major
# would eventually pull npm 12 and reintroduce lockfile drift.
RUN apk add --no-cache libc6-compat && npm install -g npm@11.19.0
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
FROM node:22-alpine AS builder
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY build
# arguments any more (RFC-024 §4.6 step 3): the browser reaches the API on
# its own origin and sends no key, so nothing in the app reads either name
# and a value in a source tree's .env.local has nothing to be baked into.
# Next still inlines any other `process.env.NEXT_PUBLIC_*` it finds; the
# guard in e2e/secrets-store.spec.ts keeps webapp/src free of such reads.

# Short git sha of the source being built; CI passes it (docker.yml), as do
# docker-compose.build.yml and start.sh. Empty is allowed: stamp-sw.sh then
# uses a timestamp, so a build is never mistaken for another one.
ARG BUILD_REVISION=

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production
# V8's default heap (~2 GB on 64-bit) isn't enough for next build's
# type-check + static-generation phase on this codebase. Without
# bumping it, the build OOMs silently and produces no .next/standalone
# output, which then fails the runner stage's COPY. Set 4 GB which fits
# in a typical 4 GB VM with swap available.
ENV NODE_OPTIONS="--max-old-space-size=4096"

# `set -e` ensures any failure (including OOM in the npm subprocess)
# fails the RUN step, instead of silently producing a partial build
# without .next/standalone (which then masquerades as a runner-stage
# COPY failure).
RUN set -e; \
  # Stamp the SW's CACHE_NAME with the package.json version AND this
  # build's revision, so every build serves a different sw.js. A changed
  # sw.js is the only way an open page learns of a deploy (updatefound);
  # with the version alone, rebuilds of one version were invisible to it.
  # The new name also evicts the previous build's static-chunk cache on
  # activation, preventing ChunkLoadError after auto-updates.
  KINBOARD_VERSION=$(node -p "require('./package.json').version"); \
  sh scripts/stamp-sw.sh public/sw.js "$KINBOARD_VERSION" "$BUILD_REVISION"; \
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
FROM node:22-alpine AS runner
WORKDIR /app

# curl: cron job health checks (existing). postgresql-client: provides
# `psql` + `pg_isready` for the entrypoint's migration-runner logic.
# su-exec: the entrypoint starts as root to own the uploaded-files directory,
# then runs the server as nextjs.
RUN apk add --no-cache curl postgresql-client su-exec

# The scheduled jobs (ofelia runs them with `docker exec`). Each calls its
# route through /app/cron-call.sh, which takes the cron secret from the
# environment or, failing that, from the secrets store (RFC-023 §4.1).
# Add sync script for cron jobs
RUN echo '#!/bin/sh' > /usr/local/bin/google-sync && \
    echo 'exec /app/cron-call.sh google-sync' >> /usr/local/bin/google-sync && \
    chmod +x /usr/local/bin/google-sync

# Add todo reminders cron script
RUN echo '#!/bin/sh' > /usr/local/bin/todo-reminders && \
    echo 'exec /app/cron-call.sh todo-reminders' >> /usr/local/bin/todo-reminders && \
    chmod +x /usr/local/bin/todo-reminders

# Add notification queue processor cron script
RUN echo '#!/bin/sh' > /usr/local/bin/process-notifications && \
    echo 'exec /app/cron-call.sh process-notifications' >> /usr/local/bin/process-notifications && \
    chmod +x /usr/local/bin/process-notifications

RUN echo '#!/bin/sh' > /usr/local/bin/evaluate-attention && \
    echo 'exec /app/cron-call.sh evaluate-attention' >> /usr/local/bin/evaluate-attention && \
    chmod +x /usr/local/bin/evaluate-attention

# Add repeating-events top-up cron script
RUN echo '#!/bin/sh' > /usr/local/bin/extend-event-series && \
    echo 'exec /app/cron-call.sh extend-event-series' >> /usr/local/bin/extend-event-series && \
    chmod +x /usr/local/bin/extend-event-series

# Add event-reminder scheduler cron script
RUN echo '#!/bin/sh' > /usr/local/bin/schedule-event-reminders && \
    echo 'exec /app/cron-call.sh schedule-event-reminders' >> /usr/local/bin/schedule-event-reminders && \
    chmod +x /usr/local/bin/schedule-event-reminders

# Add birthday-reminder scheduler cron script
RUN echo '#!/bin/sh' > /usr/local/bin/birthday-reminders && \
    echo 'exec /app/cron-call.sh birthday-reminders' >> /usr/local/bin/birthday-reminders && \
    chmod +x /usr/local/bin/birthday-reminders

# Add meal-prep-reminder scheduler cron script
RUN echo '#!/bin/sh' > /usr/local/bin/meal-prep-reminders && \
    echo 'exec /app/cron-call.sh meal-prep-reminders' >> /usr/local/bin/meal-prep-reminders && \
    chmod +x /usr/local/bin/meal-prep-reminders

# Add ICS feed sync cron script
RUN echo '#!/bin/sh' > /usr/local/bin/sync-ics && \
    echo 'exec /app/cron-call.sh sync-ics' >> /usr/local/bin/sync-ics && \
    chmod +x /usr/local/bin/sync-ics

# Add CalDAV sync cron script
RUN echo '#!/bin/sh' > /usr/local/bin/sync-caldav && \
    echo 'exec /app/cron-call.sh sync-caldav' >> /usr/local/bin/sync-caldav && \
    chmod +x /usr/local/bin/sync-caldav

# Reads each family's Bring! list into its shopping list (#407).
RUN echo '#!/bin/sh' > /usr/local/bin/sync-bring && \
    echo 'exec /app/cron-call.sh sync-bring' >> /usr/local/bin/sync-bring && \
    chmod +x /usr/local/bin/sync-bring

# Syncs school holidays from OpenHolidays for families that turned it on and
# have not synced for a week (RFC-014 §5.2).
RUN echo '#!/bin/sh' > /usr/local/bin/sync-school-holidays && \
    echo 'exec /app/cron-call.sh sync-school-holidays' >> /usr/local/bin/sync-school-holidays && \
    chmod +x /usr/local/bin/sync-school-holidays

# Add pocket-money cron scripts
RUN echo '#!/bin/sh' > /usr/local/bin/pocket-money-accrue-interest && \
    echo 'exec /app/cron-call.sh accrue-interest' >> /usr/local/bin/pocket-money-accrue-interest && \
    chmod +x /usr/local/bin/pocket-money-accrue-interest

RUN echo '#!/bin/sh' > /usr/local/bin/pocket-money-commit-interest && \
    echo 'exec /app/cron-call.sh commit-interest' >> /usr/local/bin/pocket-money-commit-interest && \
    chmod +x /usr/local/bin/pocket-money-commit-interest

RUN echo '#!/bin/sh' > /usr/local/bin/pocket-money-process-allowance && \
    echo 'exec /app/cron-call.sh process-allowance' >> /usr/local/bin/pocket-money-process-allowance && \
    chmod +x /usr/local/bin/pocket-money-process-allowance

# Add recycle-bin purge cron script
RUN echo '#!/bin/sh' > /usr/local/bin/close-task-days && \
    echo 'exec /app/cron-call.sh close-task-days' >> /usr/local/bin/close-task-days && \
    chmod +x /usr/local/bin/close-task-days
RUN echo '#!/bin/sh' > /usr/local/bin/purge-recycle-bin && \
    echo 'exec /app/cron-call.sh purge-recycle-bin' >> /usr/local/bin/purge-recycle-bin && \
    chmod +x /usr/local/bin/purge-recycle-bin

# Trims the domain event outbox. A catch-up log, not an archive — see the
# route's comment for why 30 days and why it is not per-family configurable.
RUN echo '#!/bin/sh' > /usr/local/bin/purge-domain-events && \
    echo 'exec /app/cron-call.sh purge-domain-events' >> /usr/local/bin/purge-domain-events && \
    chmod +x /usr/local/bin/purge-domain-events

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

# Licences the standalone trace leaves behind (RFC-014 §8): Next copies only
# what the server imports, and a LICENSE file is never imported. The holiday
# data is CC BY-SA 3.0, not PolyForm, and its notice travels with it. NOTICE
# is webapp/NOTICE, a copy of the repository's (the build context is webapp/).
COPY --from=builder /app/NOTICE ./licenses/NOTICE
COPY --from=builder /app/src/lib/holidays/data/LICENSE ./licenses/date-holidays-LICENSE
COPY --from=builder /app/src/lib/emoji/data/LICENSE ./licenses/emojibase-LICENSE
# The fonts in .next/static/media are SIL OFL 1.1; the licence travels with them.
COPY --from=builder /app/src/assets/fonts/bricolage-grotesque/OFL.txt ./licenses/fonts/bricolage-grotesque-OFL.txt
COPY --from=builder /app/src/assets/fonts/hanken-grotesk/OFL.txt ./licenses/fonts/hanken-grotesk-OFL.txt
COPY --from=builder /app/src/assets/fonts/space-mono/OFL.txt ./licenses/fonts/space-mono-OFL.txt
COPY --from=builder /app/src/assets/fonts/fredoka/OFL.txt ./licenses/fonts/fredoka-OFL.txt
COPY --from=builder /app/src/assets/fonts/quicksand/OFL.txt ./licenses/fonts/quicksand-OFL.txt
COPY --from=builder /app/src/assets/fonts/inter/OFL.txt ./licenses/fonts/inter-OFL.txt
COPY --from=builder /app/src/assets/fonts/fraunces/OFL.txt ./licenses/fonts/fraunces-OFL.txt
COPY --from=builder /app/src/assets/fonts/noto-sans-sc/OFL.txt ./licenses/fonts/noto-sans-sc-OFL.txt
COPY --from=builder /app/src/assets/fonts/noto-serif-sc/OFL.txt ./licenses/fonts/noto-serif-sc-OFL.txt
COPY --from=builder /app/src/assets/fonts/zcool-kuaile/OFL.txt ./licenses/fonts/zcool-kuaile-OFL.txt
RUN test -f ./licenses/NOTICE && test -f ./licenses/date-holidays-LICENSE && test -f ./licenses/emojibase-LICENSE \
 && test -f ./licenses/fonts/bricolage-grotesque-OFL.txt && test -f ./licenses/fonts/hanken-grotesk-OFL.txt \
 && test -f ./licenses/fonts/space-mono-OFL.txt \
 && test -f ./licenses/fonts/fredoka-OFL.txt && test -f ./licenses/fonts/quicksand-OFL.txt \
 && test -f ./licenses/fonts/inter-OFL.txt && test -f ./licenses/fonts/fraunces-OFL.txt \
 && test -f ./licenses/fonts/noto-sans-sc-OFL.txt && test -f ./licenses/fonts/noto-serif-sc-OFL.txt \
 && test -f ./licenses/fonts/zcool-kuaile-OFL.txt

# Bake migrations, their runner and the entrypoint (with the secrets-store
# reader it runs first, RFC-023 §4.1) into the image. The
# entrypoint applies migrations against the db before exec'ing the Next.js
# server — see webapp/docker/webapp-entrypoint.sh. This is the path every
# self-hoster update relies on; `./start.sh migrate` runs the same migrate.sh
# from the host.
COPY --chown=nextjs:nodejs docker/migrations/ ./migrations/
COPY --chown=nextjs:nodejs docker/migrate.sh docker/webapp-entrypoint.sh docker/secrets-store.mjs docker/cron-call.sh ./
# The one-shot steps of a one-file install (RFC-023 PR 2): kinboard-init fills
# in the secrets store, kinboard-db-init aligns authenticator's password and
# applies the base schema to an empty database. init.sql is the same file the
# legacy compose file bind-mounts into the db container, copied byte for byte
# (e2e/kinboard-init.spec.ts and test-fresh-install.sh check that).
COPY docker/kinboard-init.mjs docker/kinboard-db-init.sh ./
COPY docker/init.sql ./initdb/init.sql
# The role bootstrap kinboard-db-init runs on stock PostgreSQL only (RFC-024 §4.2.1).
COPY docker/stock-postgres-bootstrap.sql ./initdb/stock-postgres-bootstrap.sql
# Moving between the compose shape and the all-in-one image (RFC-024 §4.4):
# `kinboard export` and `kinboard import`, the same command in both images.
# kinboard-backup.sh is the verified dump the all-in-one image takes before a
# pending migration or a PostgreSQL major upgrade (§4.7); nothing in the
# compose shape calls it.
COPY docker/kinboard-transfer.mjs docker/kinboard-backup.sh docker/storage-api-move.sh ./
USER root
RUN chmod +x ./webapp-entrypoint.sh ./migrate.sh ./cron-call.sh ./kinboard-db-init.sh ./kinboard-backup.sh \
 && printf '#!/bin/sh\nexec node /app/kinboard-init.mjs "$@"\n' > /usr/local/bin/kinboard-init \
 && printf '#!/bin/sh\nexec sh /app/kinboard-db-init.sh "$@"\n' > /usr/local/bin/kinboard-db-init \
 && printf '#!/bin/sh\nexec node /app/kinboard-transfer.mjs "$@"\n' > /usr/local/bin/kinboard \
 && chmod +x /usr/local/bin/kinboard-init /usr/local/bin/kinboard-db-init /usr/local/bin/kinboard
# No `USER nextjs` here: webapp-entrypoint.sh drops to it before starting the
# server, after the steps that need root (the uploaded-files directory). With
# PUID/PGID set it drops to those ids instead (RFC-024 §6.3).

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# The image's own health check (RFC-024 §6), so `docker run`, Portainer and
# any orchestrator see healthy/unhealthy without a compose file. /api/health
# probes the database with a 3 s timeout and answers 503 only when it is
# unreachable, so this marks the webapp unhealthy when it, or its database,
# is gone. Timings are for a Raspberry Pi: a first start waits up to 60 s for
# PostgreSQL and then runs every migration, so failures in the first 120 s do
# not count; the probe gets 10 s, and three misses in a row (90 s) make it
# unhealthy. A compose file's own `healthcheck:` replaces these values.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -sf -o /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

# Which compose.yml revision this release ships (RFC-023 §4.6): the newest in
# src/lib/compose-revision.ts, which e2e/compose-file.spec.ts holds this to.
# kinboard-updater reads it before it applies an image to a one-file install,
# and holds a release whose revision is not the household's file's (§4.11.3).
LABEL app.kinboard.compose-revision="1"

ENTRYPOINT ["./webapp-entrypoint.sh"]
