# kinboard-postgres: stock PostgreSQL plus pg-safeupdate (RFC-024 §4.2.1).
#
# The database of a NEW install on stock PostgreSQL. Existing compose installs
# keep supabase/postgres 15 (RFC-024 §11.4) and never run this image: a data
# directory written by another image is refused at start (kinboard-postgres-guard.sh).
#
# What it adds to postgres:17-alpine, and nothing else:
#   - safeupdate.so, built from source at a pinned release and checksum, so
#     every session through PostgREST's `authenticator` refuses an UPDATE or
#     DELETE without a WHERE clause, as supabase/postgres does today. The role
#     bootstrap in kinboard-db-init preloads it for that role only.
#   - POSTGRES_USER=supabase_admin, so the image's own superuser has the name
#     backups, restores and the slot cleanup already connect as.
#   - the guard in front of the official entrypoint, and the marker it checks.
#
# Built and published by .github/workflows/docker.yml under the name set there
# (POSTGRES_IMAGE_NAME). BASE is pinned by digest; the comparison rig builds the
# same file on postgres:15-alpine to separate the image's differences from the
# major version's (RFC-024 §6.5).

ARG BASE=postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73

FROM ${BASE} AS safeupdate
# 1.7 at commit 37dbc9c4acf5e2504adf2b218e9c6b41751022f3. At least 1.6 is
# required: 1.6 is the release that no longer blocks pg_upgrade (its NEWS).
ARG SAFEUPDATE_VERSION=1.7
ARG SAFEUPDATE_SHA256=456aa0ceffc412292c41d88aad7c91ada33fb4af05f355ba78e5bcf2cdf56377
RUN set -eux; \
    apk add --no-cache --virtual .build-deps build-base curl; \
    mkdir -p /src; cd /src; \
    curl -fsSLo safeupdate.tar.gz "https://github.com/eradman/pg-safeupdate/archive/refs/tags/${SAFEUPDATE_VERSION}.tar.gz"; \
    echo "${SAFEUPDATE_SHA256}  safeupdate.tar.gz" | sha256sum -c -; \
    tar xzf safeupdate.tar.gz --strip-components=1; \
    # The official image is built with LLVM JIT; its bitcode step would want a
    # matching clang, which nothing here needs.
    make with_llvm=no; \
    install -D -m 0755 safeupdate.so /out/safeupdate.so; \
    install -D -m 0644 LICENSE /out/LICENSE

FROM ${BASE}
COPY --from=safeupdate /out/safeupdate.so /usr/local/lib/postgresql/safeupdate.so
COPY --from=safeupdate /out/LICENSE /usr/local/share/licenses/pg-safeupdate/LICENSE
COPY kinboard-postgres-guard.sh /usr/local/bin/kinboard-postgres-guard.sh
COPY 00-kinboard-marker.sh /docker-entrypoint-initdb.d/00-kinboard-marker.sh
RUN chmod 0755 /usr/local/bin/kinboard-postgres-guard.sh \
 && chmod 0644 /docker-entrypoint-initdb.d/00-kinboard-marker.sh \
 # Fail the build, not a household's first start, if the library is missing.
 && test -f "$(pg_config --pkglibdir)/safeupdate.so"

ENV POSTGRES_USER=supabase_admin

# Over the socket, as the image's own superuser. Compose files may set their own.
HEALTHCHECK --interval=5s --timeout=5s --retries=10 CMD pg_isready -U "$POSTGRES_USER" -d postgres || exit 1

ENTRYPOINT ["kinboard-postgres-guard.sh"]
CMD ["postgres"]
