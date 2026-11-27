# kinboard-aio: the whole app in one container (RFC-024 §4.2, phase 5).
#
# Built FROM the webapp image itself (APP_IMAGE: the runner stage of
# webapp/docker/Dockerfile, by digest in CI), so the all-in-one image and the
# compose shape are the same build: the same webapp, migrations, secrets init
# step, base schema, role bootstrap, scheduler and /api/health (§2). This file
# adds only what one container needs on top:
#
#   - PostgreSQL ${PG_MAJOR} from Alpine's packages, plus uuid-ossp (contrib);
#   - pg-safeupdate, built here from the same pinned release and checksum as
#     webapp/docker/postgres/Dockerfile (e2e/aio-image.spec.ts holds the two
#     equal), for PostgREST's `authenticator` (§4.2.1, §11.12);
#   - PostgREST, the statically linked binary from the pinned
#     postgrest/postgrest image compose.yml runs;
#   - s6-overlay v3 as the supervisor, and the s6-rc services in rootfs/;
#   - the binaries of the previous PostgreSQL majors in PG_PREVIOUS_MAJORS,
#     for an in-place major upgrade at start (§4.3, §4.7). Empty while the
#     image is on its first major; scripts/rigs/test-aio.sh builds 18 over 17
#     to rehearse it.
#
# Not here: go2rtc (§4.2, §11.5). Everything lives under one /data (§4.2).
#
# Build (the webapp image first; never from a checkout with .env.local, see
# CLAUDE.md):
#   docker build -f webapp/docker/aio/Dockerfile --build-arg APP_IMAGE=<webapp image> webapp/docker/aio

ARG APP_IMAGE=ghcr.io/svenger87/kinboard:main
# The same PostgREST compose.yml pins; e2e/aio-image.spec.ts holds them equal.
ARG POSTGREST_IMAGE=postgrest/postgrest:v14.16

FROM ${POSTGREST_IMAGE} AS postgrest

# safeupdate for every PostgreSQL major the image carries, against Alpine's
# own -dev headers (the same Alpine as the webapp image: it is the base).
FROM ${APP_IMAGE} AS safeupdate
ARG PG_MAJOR=17
ARG PG_PREVIOUS_MAJORS=
# 1.7 at commit 37dbc9c4acf5e2504adf2b218e9c6b41751022f3; at least 1.6 is
# required, the release that no longer blocks pg_upgrade (its NEWS).
ARG SAFEUPDATE_VERSION=1.7
ARG SAFEUPDATE_SHA256=456aa0ceffc412292c41d88aad7c91ada33fb4af05f355ba78e5bcf2cdf56377
USER root
RUN set -eux; \
    apk add --no-cache --virtual .build-deps build-base curl; \
    mkdir -p /src; cd /src; \
    curl -fsSLo safeupdate.tar.gz "https://github.com/eradman/pg-safeupdate/archive/refs/tags/${SAFEUPDATE_VERSION}.tar.gz"; \
    echo "${SAFEUPDATE_SHA256}  safeupdate.tar.gz" | sha256sum -c -; \
    for v in ${PG_MAJOR} ${PG_PREVIOUS_MAJORS}; do \
      apk add --no-cache "postgresql${v}" "postgresql${v}-dev"; \
      rm -rf "/src/$v"; mkdir "/src/$v"; tar xzf safeupdate.tar.gz -C "/src/$v" --strip-components=1; \
      make -C "/src/$v" with_llvm=no PG_CONFIG="/usr/libexec/postgresql${v}/pg_config"; \
      install -D -m 0755 "/src/$v/safeupdate.so" "/out/$v/safeupdate.so"; \
    done; \
    install -D -m 0644 /src/$PG_MAJOR/LICENSE /out/LICENSE

FROM ${APP_IMAGE}
ARG PG_MAJOR=17
ARG PG_PREVIOUS_MAJORS=
ARG BUILD_REVISION=
USER root

# PostgreSQL (server, client, contrib for uuid-ossp) for this major and every
# previous one the image can upgrade from; s6-overlay; tzdata for TZ.
# postgresql-common's default-version switch is pointed at PG_MAJOR, so a
# plain `psql` or `pg_dump` is the newest client, which reads every older
# server.
RUN set -eux; \
    pkgs="s6-overlay tzdata"; \
    for v in ${PG_MAJOR} ${PG_PREVIOUS_MAJORS}; do pkgs="$pkgs postgresql${v} postgresql${v}-contrib"; done; \
    apk add --no-cache $pkgs; \
    pg_versions set-default "${PG_MAJOR}"; \
    postgres -V | grep -q " ${PG_MAJOR}\."

COPY --from=safeupdate /out/ /tmp/safeupdate/
RUN set -eux; \
    for v in ${PG_MAJOR} ${PG_PREVIOUS_MAJORS}; do \
      lib="$(/usr/libexec/postgresql${v}/pg_config --pkglibdir)"; \
      install -m 0755 "/tmp/safeupdate/$v/safeupdate.so" "$lib/safeupdate.so"; \
      test -f "$lib/safeupdate.so"; \
      test -f "$(/usr/libexec/postgresql${v}/pg_config --sharedir)/extension/uuid-ossp.control"; \
    done; \
    install -D -m 0644 /tmp/safeupdate/LICENSE /usr/share/licenses/pg-safeupdate/LICENSE; \
    rm -rf /tmp/safeupdate

COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
RUN /usr/local/bin/postgrest --version

COPY rootfs/ /
RUN set -eux; \
    chmod 0755 /usr/local/lib/kinboard-aio/*.sh; \
    find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name finish \) -exec chmod 0755 {} +; \
    mkdir -p /etc/kinboard-aio /data; \
    { \
      echo "version=$(node -p 'require("/app/package.json").version')"; \
      echo "revision=${BUILD_REVISION}"; \
      echo "pg_major=${PG_MAJOR}"; \
      echo "pg_previous_majors=${PG_PREVIOUS_MAJORS}"; \
    } > /etc/kinboard-aio/build; \
    cat /etc/kinboard-aio/build

# Where everything is. These are the image's own wiring, not settings: the
# s6 services, `docker exec … kinboard export` and the webapp read the same
# values. Nothing must be set to start (§3).
ENV KINBOARD_AIO=1 \
    KINBOARD_DATA=/data \
    PG_MAJOR=${PG_MAJOR} \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT=5432 \
    POSTGRES_USER=postgres \
    POSTGRES_DB=postgres \
    KINBOARD_SECRETS_DIR=/data/config/secrets \
    KINBOARD_MIGRATE_BACKUP_DIR=/data/backups \
    KINBOARD_START_STATE_DIR=/data/config/updater \
    FILES_DIR=/data/storage/files \
    POSTGREST_URL=http://127.0.0.1:3010 \
    KINBOARD_SCHEDULER=internal \
    TZ=Europe/Berlin \
    PUID=1000 \
    PGID=1000 \
    UMASK=022
# s6-overlay (https://github.com/just-containers/s6-overlay): stop the
# container when a start step fails (a refusal, an upgrade that did not
# complete), with the reason in the log; and wait for the services however
# long a first start or an upgrade takes.
#
# Shutdown (§4.2.2): `docker stop` sends SIGTERM, and s6-rc stops the services
# in reverse order, the webapp, then PostgREST, then PostgreSQL with SIGINT
# (its fast shutdown: a checkpoint, no recovery at the next start) within the
# 30 s of its timeout-down. Only after that does S6_KILL_GRACETIME apply, to
# whatever is left (the log forwarders): s6 waits it out in full on every
# stop, measured, so it stays short. The RFC's "raise it to match" would add
# 30 s to every stop without giving PostgreSQL any more time. Every listing
# sets the container's stop timeout to 60 s, above the 30 s plus the rest.
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_KILL_GRACETIME=5000 \
    S6_KEEP_ENV=1 \
    S6_VERBOSITY=1

VOLUME ["/data"]
EXPOSE 3000

# One probe for all three processes: /api/health checks the database with a
# timeout, and the webapp answers only once PostgREST and PostgreSQL are up
# (§4.2.2). A first start (initdb, every migration) or a PostgreSQL major
# upgrade on a Raspberry Pi takes minutes, hence the long start period.
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
  CMD curl -sf -o /dev/null "http://127.0.0.1:3000/api/health" || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/init"]
CMD []
