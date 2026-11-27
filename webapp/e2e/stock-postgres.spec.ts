import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * Stock PostgreSQL for new installs (RFC-024 §4.2.1, phase 3), the parts that
 * can be checked without a database: the kinboard-postgres image's guard
 * against a data folder it did not create, its pinned build, the role
 * bootstrap's text, and where the image name and the gates are wired.
 *
 * The gates that need databases (the policy and grant comparison, the RLS
 * matrix, filterless writes, the guard on a real PostgreSQL 15 folder) are
 * scripts/rigs/test-stock-postgres.sh, run by ci.yml's stock-postgres job.
 */

const ROOT = join(__dirname, "..", "..");
const DOCKER = join(__dirname, "..", "docker");
const PG = join(DOCKER, "postgres");
const read = (p: string) => readFileSync(p, "utf8");

test.describe("kinboard-postgres-guard.sh", () => {
  const GUARD = join(PG, "kinboard-postgres-guard.sh");

  function guard(o: { version?: string; marker?: boolean; args?: string[] }) {
    const dir = mkdtempSync(join(tmpdir(), "kb-pgguard-"));
    try {
      const bin = join(dir, "bin");
      const data = join(dir, "data");
      mkdirSync(bin);
      mkdirSync(data);
      if (o.version !== undefined) writeFileSync(join(data, "PG_VERSION"), `${o.version}\n`);
      if (o.marker) writeFileSync(join(data, "KINBOARD_POSTGRES"), "kinboard-postgres\nmajor=17\n");
      // The official entrypoint, stubbed: reaching it means the guard let go.
      writeFileSync(join(bin, "docker-entrypoint.sh"), `#!/bin/sh\necho "ENTRY $*"\n`);
      chmodSync(join(bin, "docker-entrypoint.sh"), 0o755);
      const before = readdirSync(data).sort();
      const p = spawnSync("sh", [GUARD, ...(o.args ?? ["postgres"])], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, PGDATA: data, PG_MAJOR: "17" },
        encoding: "utf8",
      });
      return { status: p.status, out: p.stdout, err: p.stderr, untouched: JSON.stringify(readdirSync(data).sort()) === JSON.stringify(before) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("an empty data folder goes to the official entrypoint, which creates it", () => {
    const r = guard({});
    expect(r.status, r.err).toBe(0);
    expect(r.out.trim()).toBe("ENTRY postgres");
  });

  test("a PostgreSQL 15 folder (an existing compose install's) is refused, with the way back and the way forward", () => {
    const r = guard({ version: "15", marker: false });
    expect(r.status).toBe(1);
    expect(r.out).not.toContain("ENTRY");
    expect(r.err).toContain("REFUSED: the database folder was created by PostgreSQL 15");
    expect(r.err).toContain("supabase/postgres:15.14.1.159");
    expect(r.err).toContain("Nothing in");
    expect(r.err).toContain("wiki/Self-hosting#moving-an-install-to-postgresql-17");
    expect(r.untouched).toBe(true);
  });

  test("a PostgreSQL 17 folder this image did not write is refused too: another C library", () => {
    const r = guard({ version: "17", marker: false });
    expect(r.status).toBe(1);
    expect(r.err).toContain("not created by kinboard-postgres");
    expect(r.untouched).toBe(true);
  });

  test("its own folder starts", () => {
    const r = guard({ version: "17", marker: true });
    expect(r.status, r.err).toBe(0);
    expect(r.out.trim()).toBe("ENTRY postgres");
  });

  test("server flags count as starting the server; other commands (pg_dump, psql) are not checked", () => {
    expect(guard({ version: "15", args: ["-c", "shared_buffers=128MB"] }).status).toBe(1);
    const dump = guard({ version: "15", args: ["pg_dump", "-h", "elsewhere"] });
    expect(dump.status, dump.err).toBe(0);
    expect(dump.out.trim()).toBe("ENTRY pg_dump -h elsewhere");
  });

  test("the marker is written once, when the official entrypoint creates the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-pgmarker-"));
    try {
      const p = spawnSync("sh", ["-c", `. "${join(PG, "00-kinboard-marker.sh")}"`], {
        env: { ...process.env, PGDATA: dir, PG_MAJOR: "17" },
        encoding: "utf8",
      });
      expect(p.status, p.stderr).toBe(0);
      const marker = read(join(dir, "KINBOARD_POSTGRES"));
      expect(marker).toMatch(/^kinboard-postgres\nmajor=17\nlibc=musl\ncreated=\d{4}-/);
      expect(statSync(join(dir, "KINBOARD_POSTGRES")).mode & 0o777).toBe(0o600);
      // And the guard reads the same name.
      expect(read(join(PG, "kinboard-postgres-guard.sh"))).toContain('MARKER="$PGDATA/KINBOARD_POSTGRES"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("the kinboard-postgres image", () => {
  const dockerfile = read(join(PG, "Dockerfile"));

  test("the base is postgres:17-alpine pinned by digest", () => {
    expect(dockerfile).toMatch(/^ARG BASE=postgres:17-alpine@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toMatch(/^FROM \$\{BASE\} AS safeupdate$/m);
    expect(dockerfile).toMatch(/^FROM \$\{BASE\}$/m);
  });

  test("pg-safeupdate: at least 1.6, pinned to RFC-024's tarball checksum, checked before it is built", () => {
    const version = /^ARG SAFEUPDATE_VERSION=(\d+)\.(\d+)$/m.exec(dockerfile);
    expect(version).not.toBeNull();
    const [major, minor] = [Number(version![1]), Number(version![2])];
    // 1.6 is the release that no longer blocks pg_upgrade.
    expect(major > 1 || (major === 1 && minor >= 6)).toBe(true);
    expect(dockerfile).toContain("ARG SAFEUPDATE_SHA256=456aa0ceffc412292c41d88aad7c91ada33fb4af05f355ba78e5bcf2cdf56377");
    expect(dockerfile).toContain('echo "${SAFEUPDATE_SHA256}  safeupdate.tar.gz" | sha256sum -c -');
    expect(dockerfile.indexOf("sha256sum -c")).toBeLessThan(dockerfile.indexOf("make with_llvm=no"));
    expect(dockerfile).toContain("/usr/local/lib/postgresql/safeupdate.so");
  });

  test("the guard is the entrypoint, the marker script runs at initdb, the superuser is supabase_admin", () => {
    expect(dockerfile).toContain('ENTRYPOINT ["kinboard-postgres-guard.sh"]');
    expect(dockerfile).toContain("COPY 00-kinboard-marker.sh /docker-entrypoint-initdb.d/00-kinboard-marker.sh");
    expect(dockerfile).toMatch(/^ENV POSTGRES_USER=supabase_admin$/m);
    expect(read(join(PG, "kinboard-postgres-guard.sh"))).toContain('exec docker-entrypoint.sh "$@"');
  });
});

test.describe("the role bootstrap (stock-postgres-bootstrap.sql)", () => {
  const sql = codeOnly(read(join(DOCKER, "stock-postgres-bootstrap.sql")), { sql: true });
  const role = (name: string) => {
    const m = new RegExp(`CREATE ROLE ${name}\\s+([^;]+);`).exec(sql);
    expect(m, `CREATE ROLE ${name}`).not.toBeNull();
    return m![1].split(/\s+/).filter(Boolean);
  };

  test("the role attributes of RFC-024 §4.2.1, every one spelled out", () => {
    const want: Record<string, string[]> = {
      anon: ["NOSUPERUSER", "INHERIT", "NOCREATEROLE", "NOCREATEDB", "NOLOGIN", "NOREPLICATION", "NOBYPASSRLS"],
      authenticated: ["NOSUPERUSER", "INHERIT", "NOCREATEROLE", "NOCREATEDB", "NOLOGIN", "NOREPLICATION", "NOBYPASSRLS"],
      service_role: ["NOSUPERUSER", "INHERIT", "NOCREATEROLE", "NOCREATEDB", "NOLOGIN", "NOREPLICATION", "BYPASSRLS"],
      authenticator: ["NOSUPERUSER", "NOINHERIT", "NOCREATEROLE", "NOCREATEDB", "LOGIN", "NOREPLICATION", "NOBYPASSRLS"],
      postgres: ["NOSUPERUSER", "INHERIT", "CREATEROLE", "CREATEDB", "LOGIN", "REPLICATION", "BYPASSRLS"],
    };
    for (const [name, attrs] of Object.entries(want)) {
      expect(role(name).filter((a) => !/^PASSWORD$|^:'pw'$/.test(a)), name).toEqual(attrs);
    }
    expect([...sql.matchAll(/CREATE ROLE (\w+)/g)].map((m) => m[1]).sort()).toEqual(Object.keys(want).sort());
  });

  test("memberships without admin option, and authenticator in the three API roles only", () => {
    expect(sql).not.toMatch(/ADMIN OPTION/i);
    expect(sql).toContain("GRANT anon, authenticated, service_role TO authenticator;");
    expect(sql).toContain("GRANT anon, authenticated, service_role, pg_monitor, pg_read_all_data, pg_signal_backend TO postgres;");
    expect([...sql.matchAll(/^GRANT [^;]* TO (anon|authenticated|service_role)\b[^;]*;/gm)].filter((m) => !/ON SCHEMA/.test(m[0]))).toEqual([]);
  });

  test("safeupdate preloaded for authenticator, supautils not", () => {
    expect(sql).toContain("ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate';");
    expect(sql).not.toContain("supautils");
    expect(sql).toContain("ALTER ROLE anon          SET statement_timeout = '3s';");
    expect(sql).toContain("ALTER ROLE authenticated SET statement_timeout = '8s';");
    expect(sql).toContain("ALTER ROLE authenticator SET lock_timeout = '8s';");
  });

  test("uuid-ossp in its own schema; table privileges listed, never ALL (MAINTAIN from 17 on)", () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;');
    expect(sql).not.toMatch(/WITH SCHEMA public/);
    expect(sql).not.toMatch(/GRANT ALL ON TABLES/i);
    expect(sql.indexOf("CREATE SCHEMA extensions")).toBeLessThan(sql.indexOf('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'));
  });

  test("the publication is owned by postgres, the database too", () => {
    expect(sql).toContain("CREATE PUBLICATION supabase_realtime;");
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime OWNER TO postgres;");
    expect(sql).not.toMatch(/FOR ALL TABLES/i);
    expect(sql).toContain("ALTER DATABASE %I OWNER TO postgres");
  });

  test("it reaches the image next to init.sql, and kinboard-db-init runs it from there", () => {
    expect(read(join(DOCKER, "Dockerfile"))).toContain("COPY docker/stock-postgres-bootstrap.sql ./initdb/stock-postgres-bootstrap.sql");
    expect(read(join(DOCKER, "kinboard-db-init.sh"))).toContain('BOOTSTRAP_SQL="${KINBOARD_BOOTSTRAP_SQL:-/app/initdb/stock-postgres-bootstrap.sql}"');
  });
});

test.describe("what stays as it is", () => {
  test("init.sql creates pg_cron only where the image ships and preloads it", () => {
    const init = codeOnly(read(join(DOCKER, "init.sql")), { sql: true });
    expect(init).not.toMatch(/^CREATE EXTENSION IF NOT EXISTS "pg_cron";/m);
    expect(init).toMatch(/IF EXISTS \(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'\)\s+AND current_setting\('shared_preload_libraries'\)/);
  });

  test("compose.yml keeps supabase/postgres 15: a pasted file never moves an existing data folder (RFC-024 §11.4)", () => {
    const compose = read(join(ROOT, "compose.yml"));
    const db = compose.slice(compose.indexOf("\n  db:\n"), compose.indexOf("\n  db-init:\n"));
    expect(db).toContain("image: supabase/postgres:15.14.1.159");
    expect(compose).not.toContain("kinboard-postgres");
  });
});

test.describe("wiring", () => {
  const dockerYml = read(join(ROOT, ".github", "workflows", "docker.yml"));
  const ciYml = read(join(ROOT, ".github", "workflows", "ci.yml"));

  test("docker.yml names the image once and builds it like the webapp: labels, provenance, SBOM, the metadata check", () => {
    expect(dockerYml).toMatch(/^ {2}POSTGRES_IMAGE_NAME: \$\{\{ github\.repository_owner \}\}\/kinboard-postgres$/m);
    // The name itself, outside comments and job titles, appears once.
    const code = dockerYml.split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*name:/.test(l)).join("\n");
    expect(code.match(/kinboard-postgres/g)).toHaveLength(1);
    expect(code).toContain("images: ${{ env.REGISTRY }}/${{ env.POSTGRES_IMAGE_NAME }}");
    const jobs = dockerYml.slice(dockerYml.indexOf("\n  postgres-build:"), dockerYml.indexOf("\n  postgres-merge:"));
    expect(jobs).toContain("file: webapp/docker/postgres/Dockerfile");
    expect(jobs).toContain("provenance: mode=max");
    expect(jobs).toContain("sbom: true");
    const merge = dockerYml.slice(dockerYml.indexOf("\n  postgres-merge:"));
    expect(merge).toContain("scripts/ci/check-image-metadata.sh");
  });

  test("ci.yml runs the gates whenever what they guard changes", () => {
    const job = ciYml.slice(ciYml.indexOf("\n  stock-postgres-decide:"));
    expect(job).toContain("scripts/rigs/test-stock-postgres.sh");
    // The job has a deadline (one without ran for 57 minutes before it was cancelled).
    for (const name of ["stock-postgres"]) {
      const body = job.slice(job.indexOf(`\n  ${name}:`) + 1);
      const end = body.slice(1).search(/\n  [a-z][a-z-]*:\n/);
      expect(end === -1 ? body : body.slice(0, end + 1), name).toMatch(/\n {4}timeout-minutes: \d+\n/);
    }
    for (const path of ["webapp/docker/", "compose.yml", "scripts/rigs/test-stock-postgres.sh", "scripts/rigs/stock-postgres/", "webapp/e2e/rls-matrix.spec.ts"]) {
      expect(job, path).toContain(path);
    }
    expect(existsSync(join(ROOT, "scripts", "rigs", "stock-postgres", "expected-supabase15-vs-stock15.txt"))).toBe(true);
  });
});
