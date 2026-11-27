import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * RFC-024 phase 5: the all-in-one image, kinboard-aio (webapp/image/aio/).
 *
 * What can be checked without Docker: the image is the webapp's own build
 * plus PostgreSQL, PostgREST and s6 (same pins as the compose shape); the s6
 * services start in the RFC's order and stop PostgreSQL with its fast
 * shutdown; the start steps' decisions about /data/db (initdb, refusals, the
 * rollback of an upgrade that never ran healthy, an interrupted switch); the
 * verified dump; migrate.sh's dry run; the entrypoint's start guarantees, off
 * for every compose install; `kinboard export` / `kinboard import`'s refusals;
 * kinboard-init's private modes. Each guard is also shown failing on the
 * mistake it is for. scripts/rigs/test-aio.sh runs all of it for real.
 */

const ROOT = join(__dirname, "..", "..");
const DOCKER = join(__dirname, "..", "docker");
const IMAGE = join(__dirname, "..", "image");
const AIO = join(IMAGE, "aio");
const LIB = join(AIO, "rootfs", "usr", "local", "lib", "kinboard-aio");
const S6 = join(AIO, "rootfs", "etc", "s6-overlay", "s6-rc.d");
const read = (p: string) => readFileSync(p, "utf8");
const run = (cmd: string, args: string[], env: Record<string, string> = {}, input?: string) =>
  spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, input });

test.describe("one build, two shapes (RFC-024 §2, §4.5)", () => {
  const dockerfile = read(join(AIO, "Dockerfile"));

  test("the all-in-one image is FROM the webapp image, with nothing of the webapp rebuilt", () => {
    expect(dockerfile).toMatch(/^ARG APP_IMAGE=/m);
    expect(dockerfile.match(/^FROM \$\{APP_IMAGE\}/gm)).toHaveLength(2);
    expect(dockerfile).not.toMatch(/npm (ci|run build)/);
  });

  test("safeupdate is the same pinned release and checksum as kinboard-postgres's", () => {
    const pg = read(join(IMAGE, "postgres", "Dockerfile"));
    for (const arg of ["SAFEUPDATE_VERSION", "SAFEUPDATE_SHA256"]) {
      const want = new RegExp(`^ARG ${arg}=(\\S+)$`, "m");
      expect(dockerfile.match(want)?.[1], arg).toBe(pg.match(want)?.[1]);
    }
    expect(dockerfile).toContain('sha256sum -c -');
  });

  test("PostgREST is the binary of the image compose.yml pins", () => {
    const compose = read(join(ROOT, "compose.yml"));
    const pinned = compose.match(/image: (postgrest\/postgrest:\S+)/)?.[1];
    expect(pinned).toBeTruthy();
    // The tag compose.yml runs, by the multi-arch index digest the store listings record for it.
    const arg = dockerfile.match(/^ARG POSTGREST_IMAGE=(\S+)$/m)?.[1] ?? "";
    const [tag, digest] = arg.split("@");
    expect(tag).toBe(pinned);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const listed = read(join(ROOT, "dist", "kinboard.yaml")).match(new RegExp(`^\\s+${pinned!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}: (sha256:\\S+)$`, "m"))?.[1];
    if (listed) expect(digest, "the digest dist/kinboard.yaml records for this tag").toBe(listed);
    // The image is not the same build on both architectures: a static binary on amd64, a glibc one on arm64,
    // which needs its loader and libraries from the same image (on musl it exits 127 without them).
    expect(dockerfile).toMatch(/^FROM postgrest-\$\{TARGETARCH\} AS postgrest$/m);
    expect(dockerfile).toContain("COPY --from=postgrest-image /bin/postgrest /out/usr/local/bin/postgrest");
    expect(dockerfile).toMatch(/^FROM \$\{POSTGREST_IMAGE\} AS postgrest-arm64-files$/m);
    expect(dockerfile).toContain("cp -L /usr/lib/ld-linux-aarch64.so.1 /out/lib/ld-linux-aarch64.so.1");
    expect(dockerfile).toContain("COPY --from=postgrest /out/ /");
    // The SBOM: those libraries' Debian packages, and only those, recorded by a Syft pinned by digest, in a
    // file the image's own SBOM scan reads (Syft reads *.syft.json); the Ubuntu files it reads stay out.
    expect(dockerfile).toMatch(/^ARG SYFT_IMAGE=anchore\/syft:v[\d.]+@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM \$\{SYFT_IMAGE\} AS postgrest-arm64-sbom$/m);
    expect(dockerfile).toContain('{ dpkg-query -s "$pkg"; echo; } >> /sbom/var/lib/dpkg/status');
    expect(dockerfile).toContain("COPY --from=postgrest-arm64-files /sbom /src");
    expect(dockerfile).toContain(
      "COPY --from=postgrest-arm64-sbom /postgrest-runtime.syft.json /out/usr/share/licenses/postgrest-runtime/postgrest-runtime.syft.json",
    );
    const arm64 = dockerfile.slice(dockerfile.indexOf("AS postgrest-arm64\n"), dockerfile.indexOf("AS postgrest\n"));
    expect(arm64, "only /out reaches the image, never /sbom").not.toContain("/sbom");
    // amd64's static binary needs nothing beside it, so its stage carries no runtime and no SBOM fragment.
    const amd64 = dockerfile.slice(dockerfile.indexOf("AS postgrest-amd64\n"), dockerfile.indexOf("AS postgrest-arm64-files\n"));
    expect(amd64).not.toMatch(/syft|licenses|aarch64/);
    // ...and the build itself runs it, and refuses another version than the pin.
    expect(dockerfile).toContain('test "$(/usr/local/bin/postgrest --version)" = "PostgREST $v"');
  });

  test("PostgreSQL 17, a health check, one /data, s6 as PID 1, a stop that stops the container on a failed start", () => {
    expect(dockerfile).toMatch(/^ARG PG_MAJOR=17$/m);
    expect(dockerfile).toMatch(/^ARG PG_PREVIOUS_MAJORS=$/m);
    expect(dockerfile).toMatch(/HEALTHCHECK [^\n]*\\\n\s+CMD curl -sf -o \/dev\/null "http:\/\/127\.0\.0\.1:3000\/api\/health"/);
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toContain('ENTRYPOINT ["/init"]');
    expect(dockerfile).toMatch(/S6_BEHAVIOUR_IF_STAGE2_FAILS=2/);
    expect(dockerfile).toMatch(/S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0/);
    // The kill grace is waited out in full on every stop; PostgreSQL's window is its timeout-down.
    const grace = Number(dockerfile.match(/S6_KILL_GRACETIME=(\d+)/)?.[1]);
    expect(grace).toBeLessThanOrEqual(10000);
    // The start guarantees (§4.7) are switched on here, and only here.
    expect(dockerfile).toMatch(/KINBOARD_MIGRATE_BACKUP_DIR=\/data\/backups/);
    expect(dockerfile).toMatch(/KINBOARD_START_STATE_DIR=\/data\/config\/updater/);
    expect(dockerfile).toMatch(/KINBOARD_SCHEDULER=internal/);
  });
});

test.describe("s6-rc services (RFC-024 §4.2.2)", () => {
  const services = readdirSync(S6).filter((d) => d !== "user");
  const deps = (s: string) => (existsSync(join(S6, s, "dependencies.d")) ? readdirSync(join(S6, s, "dependencies.d")) : []);
  /** Every service s depends on, directly or not. */
  const closure = (s: string, seen = new Set<string>()): Set<string> => {
    for (const d of deps(s)) if (!seen.has(d)) { seen.add(d); closure(d, seen); }
    return seen;
  };

  test("the RFC's start order: perms, secrets, the cluster, PostgreSQL, db-init, PostgREST, the webapp", () => {
    const order = ["init-perms", "init-secrets", "init-db", "postgres", "db-ready", "postgrest", "webapp", "healthwatch"];
    for (let i = 1; i < order.length; i++) expect(deps(order[i]), order[i]).toContain(order[i - 1]);
    expect(closure("webapp")).toEqual(new Set(["base", ...order.slice(0, 6)]));
    for (const s of order) expect(read(join(S6, s, "type")).trim(), s).toBe(["postgres", "postgrest", "webapp", "healthwatch"].includes(s) ? "longrun" : "oneshot");
  });

  test("every service is in the user bundle, every log line goes out prefixed", () => {
    const bundle = readdirSync(join(S6, "user", "contents.d")).sort();
    expect(bundle).toEqual([...services].sort());
    for (const [svc, prefix] of [["postgres", "postgres"], ["postgrest", "rest"], ["webapp", "webapp"]]) {
      expect(read(join(S6, svc, "producer-for")).trim()).toBe(`${svc}-log`);
      expect(read(join(S6, `${svc}-log`, "consumer-for")).trim()).toBe(svc);
      expect(read(join(S6, `${svc}-log`, "run"))).toContain(`print "[${prefix}] " $0; fflush()`);
    }
  });

  test("PostgreSQL stops with SIGINT (fast shutdown) within 30 s, after the webapp and PostgREST", () => {
    expect(read(join(S6, "postgres", "down-signal")).trim()).toBe("SIGINT");
    expect(read(join(S6, "postgres", "timeout-down")).trim()).toBe("30000");
    // The worst case stays inside the listings' 60 s: the webapp, then PostgREST, then PostgreSQL, then the kill grace.
    const worst = ["webapp", "postgrest", "postgres"].reduce((n, sv) => n + Number(read(join(S6, sv, "timeout-down")).trim()), 0)
      + Number(read(join(AIO, "Dockerfile")).match(/S6_KILL_GRACETIME=(\d+)/)?.[1]);
    expect(worst).toBeLessThan(60000);
    // s6-rc stops in reverse dependency order: what depends on postgres goes first.
    expect(closure("postgrest").has("postgres")).toBe(true);
    expect(closure("webapp").has("postgres")).toBe(true);
    const run = read(join(LIB, "postgres-run.sh"));
    expect(run).toContain("listen_addresses=127.0.0.1");
    expect(run).toContain("unix_socket_permissions=0700");
    expect(read(join(LIB, "postgrest-run.sh"))).toContain("PGRST_SERVER_HOST=127.0.0.1");
  });

  test("a refusal stops the container: the webapp's finish halts on exit code 100", () => {
    const finish = read(join(LIB, "webapp-finish.sh"));
    expect(finish).toMatch(/if \[ "\$\{1:-0\}" = 100 \]; then\s+halt_container/);
  });

  test("only init-perms runs as root; every process is started through su-exec as PUID:PGID", () => {
    for (const f of ["init-secrets.sh", "db-ready.sh", "postgres-run.sh", "postgrest-run.sh"]) {
      expect(read(join(LIB, f)), f).toMatch(/exec su-exec "\$RUN_UID:\$RUN_GID"/);
    }
    expect(read(join(LIB, "init-db.sh"))).toMatch(/if \[ "\$\(id -u\)" = 0 \]; then exec su-exec "\$RUN_UID:\$RUN_GID" "\$0"/);
    const perms = read(join(LIB, "init-perms.sh"));
    expect(perms).toContain('PUID and PGID must not be 0');
    // root never follows a symlink the data folder's user planted.
    expect(perms).toContain('chown -R -h');
    expect(perms).toMatch(/if \[ -L "\$DATA\/\$d" \]/);
  });
});

/* ------------------------------------------------- init-db, on a fake /data */

function fakeData(pgMajor = "17") {
  const dir = mkdtempSync(join(tmpdir(), "kb-aio-"));
  const data = join(dir, "data");
  mkdirSync(join(data, "config", "updater"), { recursive: true });
  mkdirSync(join(data, "config", "secrets"), { recursive: true });
  writeFileSync(join(dir, "build"), `version=9.9.9\nrevision=test\npg_major=${pgMajor}\npg_previous_majors=\n`);
  const cluster = (name: string, major: string, marker = true) => {
    mkdirSync(join(data, name), { recursive: true });
    writeFileSync(join(data, name, "PG_VERSION"), `${major}\n`);
    writeFileSync(join(data, name, "base.dat"), `cluster ${major}`);
    if (marker) writeFileSync(join(data, name, "KINBOARD_AIO"), `kinboard-aio\nmajor=${major}\n`);
  };
  const env = { KINBOARD_DATA: data, KINBOARD_AIO_BUILD: join(dir, "build"), PUID: String(process.getuid?.() ?? 1000), PGID: String(process.getgid?.() ?? 1000) };
  const initDb = () => run("sh", [join(LIB, "init-db.sh")], env);
  const lib = (script: string) => run("sh", ["-c", `. "${join(LIB, "common.sh")}"; . "${join(LIB, "pg-lib.sh")}"; ${script}`], env);
  const ls = () => readdirSync(data).sort();
  const version = (name: string) => (existsSync(join(data, name, "PG_VERSION")) ? read(join(data, name, "PG_VERSION")).trim() : null);
  const state = (body: string) => writeFileSync(join(data, "config", "updater", "pg-upgrade"), body);
  return { dir, data, cluster, initDb, lib, ls, version, state, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test.describe("init-db: what /data/db holds decides (RFC-024 §4.3, §4.4, §4.7)", () => {
  test("this image's major with its marker: start as is", () => {
    const f = fakeData();
    try {
      f.cluster("db", "17");
      const r = f.initDb();
      expect(r.status, r.stderr).toBe(0);
      expect(f.ls()).toEqual(["config", "db"]);
    } finally { f.done(); }
  });

  test("a compose install's folder (no marker) is refused and not touched", () => {
    const f = fakeData();
    try {
      f.cluster("db", "15", false);
      const r = f.initDb();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("that this image did not create");
      expect(r.stderr).toContain("kinboard export");
      expect(f.version("db")).toBe("15");
      // Red: the same folder WITH a marker of this major would start. The refusal is the marker's absence.
      writeFileSync(join(f.data, "db", "PG_VERSION"), "17\n");
      writeFileSync(join(f.data, "db", "KINBOARD_AIO"), "kinboard-aio\n");
      expect(f.initDb().status).toBe(0);
    } finally { f.done(); }
  });

  test("init-perms refuses a compose install's data folder before creating or handing over anything in it", () => {
    // A compose install's DATA_DIR has db/ (supabase/postgres 15) and storage/
    // where the all-in-one image looks. Before this, init-perms gave both to
    // PUID and only init-db refused, two steps later (and init-secrets first,
    // with a message about a missing password): the old install's
    // PostgreSQL then no longer started on its own folder.
    const f = fakeData();
    try {
      rmSync(join(f.data, "config"), { recursive: true });
      f.cluster("db", "15", false);
      mkdirSync(join(f.data, "storage", "files"), { recursive: true });
      chmodSync(join(f.data, "db"), 0o750);
      const env = { KINBOARD_DATA: f.data, KINBOARD_AIO_BUILD: join(f.dir, "build"), PUID: String(process.getuid?.() ?? 1000), PGID: String(process.getgid?.() ?? 1000) };
      const r = run("sh", [join(LIB, "init-perms.sh")], env);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stderr).toContain("that this image did not create");
      expect(r.stderr).toContain("kinboard export");
      expect(r.stderr).toContain("Nothing in");
      expect(f.ls(), "nothing created beside the compose install's folders").toEqual(["db", "storage"]);
      expect(statSync(join(f.data, "db")).mode & 0o777, "the cluster's mode untouched").toBe(0o750);
      // The image's own cluster (with its marker) is not refused here; it goes
      // on to the folders (unprivileged, this run then stops at the socket
      // folder in /run, which only root may create).
      writeFileSync(join(f.data, "db", "KINBOARD_AIO"), "kinboard-aio\nmajor=15\n");
      const ok = run("sh", [join(LIB, "init-perms.sh")], env);
      expect(ok.stderr).not.toContain("did not create");
      expect(f.ls()).toEqual(["backups", "config", "db", "storage"]);
    } finally { f.done(); }
  });

  test("init-perms: the refusal never puts a file's content in the log (a PG_VERSION swapped for a link)", () => {
    // root tests the folder; the major is read as the data's owner, 16 bytes,
    // digits and dots. Unprivileged here, so what is checked is the content
    // filter: a PG_VERSION with more than a number in it, and a link to
    // another file, give no more than the number in the message.
    for (const plant of ["file", "link"]) {
      const f = fakeData();
      try {
        rmSync(join(f.data, "config"), { recursive: true });
        f.cluster("db", "15", false);
        const canary = join(f.dir, "canary");
        writeFileSync(canary, "15\nCANARY-SECRET-VALUE\n");
        rmSync(join(f.data, "db", "PG_VERSION"));
        if (plant === "file") writeFileSync(join(f.data, "db", "PG_VERSION"), read(canary));
        else spawnSync("ln", ["-s", canary, join(f.data, "db", "PG_VERSION")]);
        const env = { KINBOARD_DATA: f.data, KINBOARD_AIO_BUILD: join(f.dir, "build"), PUID: String(process.getuid?.() ?? 1000), PGID: String(process.getgid?.() ?? 1000) };
        const r = run("sh", [join(LIB, "init-perms.sh")], env);
        expect(r.status, plant).toBe(1);
        expect(r.stderr, plant).toContain("that this image did not create");
        expect(r.stderr + r.stdout, plant).not.toContain("CANARY");
      } finally { f.done(); }
    }
    const perms = read(join(LIB, "init-perms.sh"));
    expect(perms).toContain(`as_user head -c 16 "$DB/PG_VERSION"`);
    expect(perms).not.toMatch(/<\s*"\$DB\/PG_VERSION"/);
  });

  test("files without a cluster are refused; an empty folder would be initialised", () => {
    const f = fakeData();
    try {
      mkdirSync(join(f.data, "db"));
      writeFileSync(join(f.data, "db", "stray"), "x");
      const r = f.initDb();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("holds files but no PostgreSQL cluster");
      expect(readdirSync(join(f.data, "db"))).toEqual(["stray"]);
    } finally { f.done(); }
  });

  test("an older major this image has no programs for is refused, never upgraded blindly", () => {
    const f = fakeData();
    try {
      f.cluster("db", "15");
      const r = f.initDb();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("cannot upgrade it");
      expect(f.ls()).toEqual(["config", "db"]);
    } finally { f.done(); }
  });

  test("going back before the first healthy minute puts the previous cluster back; after it, refused", () => {
    const f = fakeData("17");
    try {
      f.cluster("db", "18");
      f.cluster("db.old", "17");
      const now = Math.floor(Date.now() / 1000);
      // Red first: switched more than a day ago, never confirmed: not on its own.
      f.state(`phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nat=x\nswitched_at=x\nswitched_epoch=${now - 90000}\nconfirmed_at=\n`);
      const old = f.initDb();
      expect(old.status).toBe(1);
      expect(old.stderr).toContain("more than 24 hours old");
      expect(f.version("db")).toBe("18");
      f.state(`phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nat=x\nswitched_at=x\nswitched_epoch=${now - 60}\nconfirmed_at=\n`);
      const r = f.initDb();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain("never ran healthy for a minute");
      expect(f.version("db")).toBe("17");
      const aside = f.ls().find((n) => n.startsWith("db.failed-pg18-"));
      expect(aside, "the 18 cluster is set aside, not deleted").toBeTruthy();
      expect(f.version(aside!)).toBe("18");
      expect(read(join(f.data, "config", "updater", "pg-upgrade"))).toContain("phase=rolled_back");
    } finally { f.done(); }
  });

  test("red: once confirmed, the newer cluster is never swapped out; going back is refused with the dump", () => {
    const f = fakeData("17");
    try {
      f.cluster("db", "18");
      f.cluster("db.old", "17");
      f.state("phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nat=x\nswitched_at=x\nconfirmed_at=2026-11-27T00:00:00Z\n");
      const r = f.initDb();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("newer than this image's 17");
      expect(r.stderr).toContain("pre-pg18-upgrade-x.sql.gz");
      expect(f.version("db")).toBe("18");
      expect(f.version("db.old")).toBe("17");
      // Nor when the record is from another upgrade (16 -> 18), or the old folder is not ours.
      f.state("phase=switched\nfrom=16\nto=18\nconfirmed_at=\n");
      expect(f.initDb().status).toBe(1);
      f.state("phase=switched\nfrom=17\nto=18\nconfirmed_at=\n");
      rmSync(join(f.data, "db.old", "KINBOARD_AIO"));
      expect(f.initDb().status).toBe(1);
      expect(f.version("db")).toBe("18");
    } finally { f.done(); }
  });

  test("a switch cut off between its renames is put back before anything else", () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.cluster("db.new", "18");
      f.state("phase=switching\nfrom=17\nto=18\n");
      const r = f.lib("recover_switch");
      expect(r.status, r.stderr).toBe(0);
      expect(f.version("db")).toBe("17");
      expect(f.ls()).not.toContain("db.old");
      expect(read(join(f.data, "config", "updater", "pg-upgrade"))).toContain("reason=interrupted switch");
      // init-db then removes the leftover db.new, never having used it.
      const r2 = f.initDb();
      expect(r2.status, r2.stderr).toBe(0);
      expect(f.ls()).toEqual(["config", "db"]);
      // Red: with db present, recover_switch moves nothing.
      f.cluster("db.old", "16");
      f.lib("recover_switch");
      expect(f.version("db")).toBe("17");
      expect(f.version("db.old")).toBe("16");
    } finally { f.done(); }
  });

  test("the upgrade order: a verified dump, pg_upgrade --copy into db.new, checks, then the renames", () => {
    const lib = read(join(LIB, "pg-lib.sh"));
    const at = (s: string) => { const i = lib.indexOf(s); expect(i, s).toBeGreaterThan(0); return i; };
    const order = [
      "Room for a second copy",
      "sh /app/kinboard-backup.sh",
      '"$new_bin/initdb" -D "$DB_NEW"',
      "run_upgrade --check",
      "REINDEX DATABASE postgres",
      "LOAD 'safeupdate'",
      'mv "$DB" "$DB_OLD"',
      'mv "$DB_NEW" "$DB"',
    ];
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
    expect(lib).toContain("--copy");
    expect(lib).not.toMatch(/--link\b/);
  });
});

/* ------------------------------------------------------ the verified dump */

test.describe("kinboard-backup.sh: a verified dump or nothing (RFC-024 §4.7)", () => {
  function stub(dir: string, body: string) {
    const p = join(dir, "pg_dumpall");
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  }
  const good = 'echo "CREATE ROLE authenticator;"; i=0; while [ $i -lt 60 ]; do echo "CREATE TABLE public.t$i (id int);"; i=$((i+1)); done; echo "CREATE TABLE public.families (id uuid);"';

  test("a good dump: verified, 0600, under its final name, its path printed", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-bk-"));
    try {
      const r = run("sh", [join(IMAGE, "kinboard-backup.sh"), join(dir, "out"), "pre-migrate"], { PG_DUMPALL: stub(dir, good) });
      expect(r.status, r.stderr).toBe(0);
      const file = r.stdout.trim();
      expect(file).toMatch(/\/pre-migrate-\d{8}T\d{6}Z\.sql\.gz$/);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(run("gzip", ["-t", file]).status).toBe(0);
      expect(readdirSync(join(dir, "out"))).toEqual([file.split("/").pop()]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  for (const [label, body, why] of [
    ["pg_dumpall fails", 'echo "CREATE TABLE public.families (id uuid);"; exit 1', "pg_dumpall failed"],
    ["too few tables", 'echo "CREATE ROLE authenticator;"; echo "CREATE TABLE public.families (id uuid);"', "only 1 tables"],
    ["no families table", good.replace('echo "CREATE TABLE public.families (id uuid);"', "true"), "no public.families"],
    ["not a whole-cluster dump (no roles)", good.replace('echo "CREATE ROLE authenticator;"; ', ""), "no authenticator role"],
  ] as const) {
    test(`red: ${label} -> no file, non-zero`, () => {
      const dir = mkdtempSync(join(tmpdir(), "kb-bk-"));
      try {
        const r = run("sh", [join(IMAGE, "kinboard-backup.sh"), join(dir, "out"), "pre-migrate"], { PG_DUMPALL: stub(dir, body) });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(why);
        expect(r.stdout).toBe("");
        expect(readdirSync(join(dir, "out"))).toEqual([]);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test("red: a backup folder that is a file is refused; the newest five are kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-bk-"));
    try {
      writeFileSync(join(dir, "file"), "x");
      expect(run("sh", [join(IMAGE, "kinboard-backup.sh"), join(dir, "file"), "pre-migrate"], { PG_DUMPALL: stub(dir, good) }).status).toBe(1);
      const out = join(dir, "out");
      mkdirSync(out);
      for (let i = 0; i < 6; i++) writeFileSync(join(out, `pre-migrate-2020010${i}T000000Z.sql.gz`), "old");
      writeFileSync(join(out, "pre-pg18-upgrade-20200101T000000Z.sql.gz"), "another prefix");
      expect(run("sh", [join(IMAGE, "kinboard-backup.sh"), out, "pre-migrate"], { PG_DUMPALL: stub(dir, good) }).status).toBe(0);
      const left = readdirSync(out).sort();
      expect(left.filter((n) => n.startsWith("pre-migrate-"))).toHaveLength(5);
      expect(left).toContain("pre-pg18-upgrade-20200101T000000Z.sql.gz");
      expect(left).not.toContain("pre-migrate-20200100T000000Z.sql.gz");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/* -------------------------------------------------- migrate.sh --pending */

test.describe("migrate.sh --pending: what would apply, applying nothing (RFC-024 §4.7)", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "kb-mig-"));
    const mig = join(dir, "migrations");
    mkdirSync(mig);
    writeFileSync(join(mig, "001_one.sql"), "SELECT 'ONE_APPLIED';\n");
    writeFileSync(join(mig, "002_two.sql"), "SELECT 'TWO_APPLIED';\n");
    const sum = run("sha256sum", [join(mig, "001_one.sql")]).stdout.slice(0, 64);
    // A psql that answers the bookkeeping query with 001 recorded, and keeps every script it is fed.
    const psql = join(dir, "psql");
    writeFileSync(psql, `#!/bin/sh\ncat >> "${dir}/fed"\ncase "$*" in *"-F"*) echo "001_one.sql ${sum}" ;; esac\n`);
    chmodSync(psql, 0o755);
    return { dir, env: { MIGRATIONS_DIR: mig, PSQL: psql } };
  }

  test("lists only the file not yet recorded, and feeds no migration to the database", () => {
    const s = setup();
    try {
      const r = run("sh", [join(DOCKER, "migrate.sh"), "--pending"], s.env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe("002_two.sql\n");
      const fed = read(join(s.dir, "fed"));
      expect(fed).not.toContain("TWO_APPLIED");
      expect(fed).not.toContain("INSERT INTO kinboard.schema_migrations");
    } finally { rmSync(s.dir, { recursive: true, force: true }); }
  });

  test("red: without --pending the same run does apply it (the stub can see an application)", () => {
    const s = setup();
    try {
      const r = run("sh", [join(DOCKER, "migrate.sh")], s.env);
      expect(r.status, r.stderr).toBe(0);
      expect(read(join(s.dir, "fed"))).toContain("TWO_APPLIED");
    } finally { rmSync(s.dir, { recursive: true, force: true }); }
  });

  test("a failed file is recorded for the start record", () => {
    const s = setup();
    try {
      writeFileSync(join(s.dir, "psql"), `#!/bin/sh\nin="$(cat)"\ncase "$in" in *TWO_APPLIED*) exit 3 ;; esac\ncase "$*" in *"-F"*) : ;; esac\n`);
      const r = run("sh", [join(DOCKER, "migrate.sh")], { ...s.env, MIGRATE_FAILED_FILE: join(s.dir, "failed") });
      expect(r.status).toBe(1);
      expect(read(join(s.dir, "failed")).trim()).toBe("002_two.sql");
    } finally { rmSync(s.dir, { recursive: true, force: true }); }
  });
});

/* ----------------------------------------------- the entrypoint's guarantees */

test.describe("the entrypoint's start guarantees (RFC-024 §4.7), off for compose", () => {
  const entry = read(join(IMAGE, "webapp-entrypoint.sh"));

  test("a verified dump before the migrations run, or exit 100", () => {
    const gate = entry.indexOf('if [ -n "${KINBOARD_MIGRATE_BACKUP_DIR:-}" ]');
    const loop = entry.indexOf('MIGRATE_FAILED_FILE="$failed_note" sh /app/migrate.sh; do');
    expect(gate).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(gate);
    const block = entry.slice(gate, loop);
    expect(block).toContain("sh /app/migrate.sh --pending");
    expect(block).toContain("sh /app/kinboard-backup.sh");
    expect(block).toMatch(/REFUSING to migrate without a verified backup[^\n]*\n\s+exit 100/);
    // The dump is reused only by a retry of the same version on the same pending files, and
    // forgotten once they applied: a later pending migration always gets a dump of its own.
    expect(block).toContain('if [ -n "$START_STATE" ] && [ "$(state_get pre-migrate key)" = "$key" ]; then');
    expect(entry.indexOf("state_rm pre-migrate")).toBeGreaterThan(loop);
  });

  test("a failed migration names the last healthy version; the version that runs again records the rollback", () => {
    expect(entry).toContain("The last version that ran healthy on this data is $good");
    expect(entry).toMatch(/status: "rolled_back"/);
    // As a psql variable, never pasted into the SQL.
    expect(entry).toContain("VALUES ('update_status', :'v')");
  });

  test("no compose file sets them, so existing installs run exactly as before", () => {
    for (const f of ["compose.yml", "webapp/docker/docker-compose.yml", "webapp/docker/.env.example", "dist/portainer/compose.yml"]) {
      const text = read(join(ROOT, f));
      expect(text, f).not.toContain("KINBOARD_MIGRATE_BACKUP_DIR");
      expect(text, f).not.toContain("KINBOARD_START_STATE_DIR");
    }
  });

  test("`kinboard` passes through the entrypoint like the one-shot steps", () => {
    expect(entry).toMatch(/kinboard-init \| kinboard-db-init \| kinboard\)/);
    const df = read(join(IMAGE, "Dockerfile"));
    expect(df).toContain("exec node /app/kinboard-transfer.mjs");
    expect(df).toContain("COPY image/kinboard-transfer.mjs image/kinboard-backup.sh image/storage-api-move.sh ./");
  });
});

/* --------------------------------------------- kinboard export / import */

interface TransferModule {
  safeRelative(p: string): boolean;
  archiveEntryProblems(listing: string): string[];
  manifestProblems(m: unknown): string[];
  targetProblems(m: unknown, t: unknown): string[];
  checksumSelect(t: { schema: string; table: string; columns: string[] }): string;
  ident(s: string): string;
  literal(s: string): string;
  TRANSFERRED_SECRETS: string[];
  FORMAT: string;
}
const transferMod = import("../image/kinboard-transfer.mjs") as unknown as Promise<TransferModule>;

const manifest = () => ({
  format: "kinboard-export",
  formatVersion: 1,
  kinboard: { version: "1.18.0" },
  migrations: [{ name: "001_base.sql", checksum: "a" }, { name: "002_x.sql", checksum: "b" }],
  tables: [{ schema: "public", table: "families", columns: ["id", "name"], rows: 2, checksum: "0123456789abcdef0123456789abcdef", file: "data/0001.copy" }],
  sequences: [{ schema: "public", name: "s", last_value: "12" }],
  files: [{ path: "family-photos/a.jpg", size: 3, sha256: "a".repeat(64) }],
  secrets: ["JWT_SECRET", "VAPID_PUBLIC_KEY"],
});
const target = () => ({
  migrations: [{ name: "002_x.sql", checksum: "b" }, { name: "001_base.sql", checksum: "a" }],
  tables: [{ schema: "public", table: "families", columns: ["id", "name"] }],
  sequences: [],
  families: 0,
  devices: 0,
});

test.describe("kinboard export / import (RFC-024 §4.4)", () => {
  test("a well-formed manifest and a matching fresh target pass", async () => {
    const t = await transferMod;
    expect(t.manifestProblems(manifest())).toEqual([]);
    expect(t.targetProblems(manifest(), target())).toEqual([]);
  });

  test("never the database password: the target keeps its own", async () => {
    const t = await transferMod;
    expect(t.TRANSFERRED_SECRETS).not.toContain("POSTGRES_PASSWORD");
    expect(t.TRANSFERRED_SECRETS).toEqual(expect.arrayContaining(["JWT_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]));
    expect(t.manifestProblems({ ...manifest(), secrets: ["POSTGRES_PASSWORD"] })).toEqual(["secret POSTGRES_PASSWORD is not one that travels"]);
  });

  test("red: another version, a family already there, other columns, a missing table", async () => {
    const t = await transferMod;
    const other = { ...target(), migrations: [...target().migrations, { name: "003_new.sql", checksum: "c" }] };
    expect(t.targetProblems(manifest(), other).join()).toContain("another version");
    expect(t.targetProblems(manifest(), { ...target(), families: 1 }).join()).toContain("fresh install only");
    expect(t.targetProblems(manifest(), { ...target(), devices: 2 }).join()).toContain("fresh install only");
    const cols = { ...target(), tables: [{ schema: "public", table: "families", columns: ["id", "name", "added"] }] };
    expect(t.targetProblems(manifest(), cols).join()).toContain("other columns here");
    const extra = { ...target(), tables: [...target().tables, { schema: "public", table: "todos", columns: ["id"] }] };
    expect(t.targetProblems(manifest(), extra).join()).toContain("public.todos is in this install but not in the archive");
  });

  test("red: a manifest that is not ours, or whose paths and values could escape", async () => {
    const t = await transferMod;
    const m = manifest();
    expect(t.manifestProblems({ ...m, format: "x" }).join()).toContain("not a Kinboard export");
    expect(t.manifestProblems({ ...m, tables: [{ ...m.tables[0], file: "../etc/passwd" }] }).join()).toContain("is not data/NNNN.copy");
    expect(t.manifestProblems({ ...m, tables: [{ ...m.tables[0], checksum: "x'; DROP TABLE families; --" }] }).join()).toContain("no checksum");
    expect(t.manifestProblems({ ...m, tables: [{ ...m.tables[0], rows: -1 }] }).join()).toContain("no row count");
    expect(t.manifestProblems({ ...m, sequences: [{ schema: "public", name: "s", last_value: "1); DROP" }] }).join()).toContain("not a number");
    expect(t.manifestProblems({ ...m, files: [{ ...m.files[0], path: "../../x" }] }).join()).toContain("not a plain relative path");
  });

  test("archive entries: only plain files and folders under the four names", async () => {
    const t = await transferMod;
    const line = (mode: string, name: string) => `${mode} root/root 3 2026-11-27 00:00:00 ${name}`;
    const ok = [line("-rw-------", "manifest.json"), line("drwx------", "data/"), line("-rw-------", "data/0001.copy"), line("-rw-r--r--", "files/family-photos/a.jpg"), line("-rw-------", "secrets/jwt_secret")].join("\n");
    expect(t.archiveEntryProblems(ok)).toEqual([]);
    expect(t.archiveEntryProblems(line("lrwxrwxrwx", "files/x -> /etc/passwd")).join()).toContain("not a plain file or folder");
    expect(t.archiveEntryProblems(line("-rw-r--r--", "files/../../escaped")).join()).toContain("not a plain relative path");
    expect(t.archiveEntryProblems(line("-rw-r--r--", "/etc/cron.d/x")).join()).toContain("not a plain relative path");
    expect(t.archiveEntryProblems(line("-rw-r--r--", "bin/sh")).join()).toContain("unexpected entry");
    expect(t.archiveEntryProblems(line("hrw-r--r--", "files/hard")).join()).toContain("not a plain file or folder");
  });

  test("identifiers and literals are quoted; the checksum covers every listed column", async () => {
    const t = await transferMod;
    expect(t.ident('we"ird')).toBe('"we""ird"');
    expect(t.literal("it's")).toBe("'it''s'");
    const sel = t.checksumSelect({ schema: "public", table: "todos", columns: ["id", "title"] });
    expect(sel).toBe(`SELECT count(*)::bigint AS n, coalesce(md5(string_agg(md5(ROW("id", "title")::text), '' ORDER BY md5(ROW("id", "title")::text))), '') AS h FROM "public"."todos"`);
  });

  test("export: every tar invocation has one -C (busybox tar honours only the last one)", () => {
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const calls = [...src.matchAll(/\[("-czf"[^\]]*)\]/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c.split('"-C"').length - 1, c).toBe(1);
  });

  test("the import runs nothing from the archive as SQL: rows only through COPY into the target's own catalog", () => {
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const imp = src.slice(src.indexOf("export function importArchive"));
    expect(imp).toContain("SET LOCAL session_replication_role = replica;");
    expect(imp).toMatch(/\\\\copy \$\{qualified\(h\)\} \(\$\{h\.columns\.map\(ident\)/);
    expect(imp).not.toContain("pg_restore");
    // Verified inside the transaction, before COMMIT.
    expect(imp.indexOf("RAISE EXCEPTION 'table % differs after the import")).toBeLessThan(imp.indexOf('"COMMIT;"'));
  });
});

/* ------------------------------------------- kinboard-init's private modes */

interface InitModule {
  runInit(o: Record<string, unknown>): { ok: boolean; warnings: string[]; errors: string[] };
  PRIVATE_MODES: { dir: number; file: number; postgrest: boolean };
  SHARED_MODES: { dir: number; file: number; postgrest: boolean };
}
const initMod = import("../image/kinboard-init.mjs") as unknown as Promise<InitModule>;

test.describe("kinboard-init in the all-in-one image: 0600 secrets in a 0700 folder (RFC-024 §6.3)", () => {
  for (const kind of ["PRIVATE_MODES", "SHARED_MODES"] as const) {
    test(kind, async () => {
      const m = await initMod;
      const dir = mkdtempSync(join(tmpdir(), "kb-init-"));
      try {
        mkdirSync(join(dir, "config"), { mode: 0o700 });
        mkdirSync(join(dir, "db"));
        const r = m.runInit({ env: {}, configDir: join(dir, "config"), dbDir: join(dir, "db"), mountinfo: "", asRoot: false, modes: m[kind] });
        expect(r.ok, r.errors.join()).toBe(true);
        const secrets = join(dir, "config", "secrets");
        expect(statSync(secrets).mode & 0o777).toBe(m[kind].dir);
        for (const f of readdirSync(secrets)) expect(statSync(join(secrets, f)).mode & 0o777, f).toBe(m[kind].file);
        // The all-in-one's PostgREST is the folder's owner: no warning about PostgREST's own uid there.
        if (kind === "PRIVATE_MODES") expect(r.warnings.filter((w) => w.includes("PostgREST"))).toEqual([]);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

/* ------------------------------ root never writes through a planted link */

/**
 * The data folder belongs to PUID; root (s6's start steps, the entrypoint
 * before it drops privileges, `docker exec … kinboard import`) must never
 * write, move or read through a symlink that user planted there. These run
 * unprivileged, so they test the mechanism: a write that follows a link
 * changes the canary it points at, one that does not leaves it alone.
 * scripts/rigs/test-aio.sh's `symlinks` phase runs the same as root.
 */
test("PUID/PGID: a leading zero is refused (\"000\" is root to su-exec, not to a string test)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-puid-"));
  try {
    writeFileSync(join(dir, "build"), "version=1\nrevision=x\npg_major=17\n");
    for (const [puid, pgid] of [["000", "1000"], ["1000", "0100"], ["0", "100"]]) {
      const r = run("sh", [join(LIB, "init-perms.sh")], { KINBOARD_DATA: join(dir, "data"), KINBOARD_AIO_BUILD: join(dir, "build"), PUID: puid, PGID: pgid });
      expect(r.status, `${puid}:${pgid}`).toBe(1);
      expect(r.stderr, `${puid}:${pgid}`).toMatch(/without leading zeros|must not be 0/);
      expect(existsSync(join(dir, "data")), "nothing created").toBe(false);
    }
    expect(read(join(IMAGE, "webapp-entrypoint.sh"))).toContain("*[!0-9]* | 0?* )");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.describe("no write through a planted symlink", () => {
  function sandbox() {
    const dir = mkdtempSync(join(tmpdir(), "kb-link-"));
    const canary = join(dir, "canary");
    writeFileSync(canary, "canary");
    return { dir, canary, done: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const link = (target: string, at: string) => spawnSync("ln", ["-s", target, at]);

  test("kv_write: a link at the record or at a temporary name is never written through", () => {
    const sb = sandbox();
    try {
      const state = join(sb.dir, "data", "config", "updater");
      mkdirSync(state, { recursive: true });
      writeFileSync(join(sb.dir, "build"), "version=1\nrevision=x\npg_major=17\n");
      const env = { KINBOARD_DATA: join(sb.dir, "data"), KINBOARD_AIO_BUILD: join(sb.dir, "build") };
      const kv = (file: string) => run("sh", ["-c", `. "${join(LIB, "common.sh")}"; kv_write "$1" phase=x`, "sh", file], env);
      // A link at the record itself: refused.
      link(sb.canary, join(state, "pg-upgrade"));
      expect(kv(join(state, "pg-upgrade")).status).not.toBe(0);
      expect(read(sb.canary)).toBe("canary");
      // A link at the old fixed temporary name: written around (a fresh mktemp name).
      link(sb.canary, join(state, "last-good.tmp"));
      expect(kv(join(state, "last-good")).status).toBe(0);
      expect(read(sb.canary)).toBe("canary");
      expect(read(join(state, "last-good"))).toBe("phase=x\n");
    } finally { sb.done(); }
  });

  test("the entrypoint's records: written by the run user through a new name and a rename, never `>` as root", () => {
    const entry = read(join(IMAGE, "webapp-entrypoint.sh"));
    const block = entry.slice(entry.indexOf("as_run_user() {"), entry.indexOf("if [ -n \"${KINBOARD_MIGRATE_BACKUP_DIR:-}\" ]"));
    // Nothing redirects into, moves within or removes from START_STATE except these helpers.
    const rest = entry.replace(block, "");
    expect(rest).not.toMatch(/>\s*"\$START_STATE/);
    expect(rest).not.toMatch(/\b(mv|rm|cp|chown|chmod)\b[^\n]*"\$START_STATE/);
    expect(entry).not.toContain("own_state");
    // The failed migration's name goes to a root-only temporary file, not the data folder.
    expect(entry).toContain('MIGRATE_FAILED_FILE="$failed_note"');
    // And the helpers themselves, run unprivileged against planted links.
    const sb = sandbox();
    try {
      const state = join(sb.dir, "updater");
      mkdirSync(state);
      for (const n of ["attempt", ".attempt.tmp.1", "failed"]) link(sb.canary, join(state, n));
      const sh = `${block}\nprintf 'version=9\\n' | state_write attempt\nprintf 'x=1\\n' | state_write failed\nstate_get attempt version`;
      const r = run("sh", ["-c", sh], { START_STATE: state, RUN_AS: "nobody:nobody" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe("9");
      expect(read(sb.canary)).toBe("canary");
      expect(statSync(join(state, "attempt")).isFile()).toBe(true);
    } finally { sb.done(); }
  });

  test("init-perms: the interrupted-switch recovery runs as the data's owner, and every folder root touches is checked for links first", () => {
    const perms = read(join(LIB, "init-perms.sh"));
    expect(perms).toMatch(/as_user sh -c '[^']*recover_switch'/);
    expect(perms).not.toMatch(/^recover_switch$/m);
    const checked = perms.match(/for d in ([^;]+); do\n\s+if \[ -L "\$DATA\/\$d" \]/)?.[1].split(/\s+/) ?? [];
    for (const d of ["db", "db.old", "db.new", "db.init", "storage", "storage/files", "config", "config/secrets", "config/updater", "backups"]) {
      expect(checked, d).toContain(d);
    }
    expect(perms).not.toMatch(/chown (-R )?"\$owner"/);
    expect(read(join(LIB, "healthwatch.sh"))).toMatch(/if \[ "\$\(id -u\)" = 0 \]; then exec su-exec "\$RUN_UID:\$RUN_GID" "\$0"/);
  });

  test("kinboard import: a files folder holding a link is refused; a linked folder is never written into", async () => {
    const t = (await transferMod) as TransferModule & { oddEntries(d: string): string[]; asOwnerOf<T>(d: string, fn: () => T): T };
    const sb = sandbox();
    try {
      const files = join(sb.dir, "files");
      mkdirSync(join(files, "family-photos"), { recursive: true });
      expect(t.oddEntries(files)).toEqual([]);
      link(sb.dir, join(files, "family-photos", "escape"));
      expect(t.oddEntries(files)).toEqual([join(files, "family-photos", "escape")]);
      link(files, join(sb.dir, "linked-files"));
      expect(() => t.asOwnerOf(join(sb.dir, "linked-files"), () => writeFileSync(join(sb.dir, "linked-files", "x"), "x"))).toThrow(/not a plain folder/);
      expect(existsSync(join(files, "x"))).toBe(false);
      const src = read(join(IMAGE, "kinboard-transfer.mjs"));
      const imp = src.slice(src.indexOf("export function importArchive"));
      expect(imp).toContain("...oddEntries(filesDir), ...oddEntries(secretsDir)");
      expect(imp).toContain('writeFileSync(dst, bytes, { flag: "wx", mode: 0o644 })');
      expect(imp).not.toMatch(/copyFileSync|spawnSync\("chown"/);
    } finally { sb.done(); }
  });
});

/* ------------------------------------ second review: links, races, resuming */

test.describe("storage-api-move.sh: as the server's user, sources only inside the old tree", () => {
  function tree() {
    const dir = mkdtempSync(join(tmpdir(), "kb-move-"));
    const legacy = join(dir, "storage");
    const files = join(legacy, "files");
    const secret = join(dir, "root-only");
    mkdirSync(files, { recursive: true });
    mkdirSync(join(secret, "a.jpg"), { recursive: true });
    writeFileSync(join(secret, "a.jpg", "v1"), "SECRET");
    const put = (rel: string, body = "photo") => { mkdirSync(dirname(join(legacy, rel)), { recursive: true }); writeFileSync(join(legacy, rel), body); };
    const move = (rows: string) => run("sh", [join(IMAGE, "storage-api-move.sh"), files, legacy], {}, rows);
    return { dir, legacy, files, secret, put, move, done: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const dirname = (p: string) => p.slice(0, p.lastIndexOf("/"));

  test("a plain object is moved (hard-linked) into the files tree", () => {
    const t = tree();
    try {
      t.put("stub/stub/family-photos/a.jpg/v1");
      const r = t.move("family-photos\ta.jpg\tv1\n");
      expect(r.stdout.trim(), r.stderr).toBe("1 0 0");
      expect(read(join(t.files, "family-photos", "a.jpg"))).toBe("photo");
      expect(statSync(join(t.files, "family-photos", "a.jpg")).nlink).toBe(2);
    } finally { t.done(); }
  });

  test("red: a linked PARENT folder of a source (to a root-only folder) is never followed", () => {
    const t = tree();
    try {
      mkdirSync(join(t.legacy, "stub", "stub"), { recursive: true });
      spawnSync("ln", ["-s", t.secret, join(t.legacy, "stub", "stub", "family-photos")]);
      const r = t.move("family-photos\ta.jpg\tv1\n");
      expect(r.stdout.trim()).toBe("0 0 1");
      expect(r.stderr).toContain("leads outside");
      expect(existsSync(join(t.files, "family-photos", "a.jpg"))).toBe(false);
      // and nothing anywhere in the files tree holds the secret
      expect(listFilesUnder(t.files).map((f) => read(f))).not.toContain("SECRET");
    } finally { t.done(); }
  });

  test("red: a linked source file, a linked destination folder, a linked stub: skipped", () => {
    const t = tree();
    try {
      mkdirSync(join(t.legacy, "stub", "stub", "b"), { recursive: true });
      spawnSync("ln", ["-s", join(t.secret, "a.jpg", "v1"), join(t.legacy, "stub", "stub", "b", "x")]);
      expect(t.move("b\tx\t\n").stdout.trim()).toBe("0 0 1");
      t.put("stub/stub/c/y", "ok");
      spawnSync("ln", ["-s", t.secret, join(t.files, "c")]);
      expect(t.move("c\ty\t\n").stdout.trim()).toBe("0 0 0");
      expect(existsSync(join(t.secret, "y"))).toBe(false);
      rmSync(join(t.legacy, "stub"), { recursive: true });
      spawnSync("ln", ["-s", t.secret, join(t.legacy, "stub")]);
      const r = t.move("a.jpg\tv1\t\n");
      expect(r.stdout.trim()).toBe("0 0 0");
      expect(r.stderr).toContain("is not a plain folder");
    } finally { t.done(); }
  });

  test("the entrypoint runs it as the server's user, and hands the old tree over without following links", () => {
    const entry = read(join(IMAGE, "webapp-entrypoint.sh"));
    expect(entry).toContain('su-exec "$RUN_AS" sh /app/storage-api-move.sh "$FILES_DIR" "$legacy" <"$list"');
    expect(entry).toMatch(/if \[ -d "\$legacy\/stub" \] && \[ ! -L "\$legacy\/stub" \]; then\n\s+chown -R -h "\$RUN_AS" "\$legacy\/stub"/);
    expect(entry).not.toMatch(/\bln "\$src"|cp -p "\$src"/);
  });
});

function listFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else out.push(p); } };
  walk(root);
  return out;
}

interface Transfer2 {
  readPlain(p: string, enc?: string): string | Buffer;
  takeOver(x: string): void;
  undoPlaced(rec: unknown, filesDir: string, secretsDir: string): void;
  resumeLeftover(o: { filesDir: string; secretsDir: string; families: number; dbNonce?: string }): string;
  PENDING: string;
}

test.describe("kinboard import: nothing read through a link, and resumable", () => {
  test("readPlain refuses a link and a hard link where readFileSync would follow (red)", async () => {
    const t = (await transferMod) as unknown as Transfer2;
    const dir = mkdtempSync(join(tmpdir(), "kb-rp-"));
    try {
      writeFileSync(join(dir, "canary"), "ROOT ONLY");
      writeFileSync(join(dir, "ok"), "value");
      spawnSync("ln", ["-s", join(dir, "canary"), join(dir, "swapped")]);
      spawnSync("ln", [join(dir, "canary"), join(dir, "hard")]);
      expect(t.readPlain(join(dir, "ok"), "utf8")).toBe("value");
      // The old read follows the swapped-in link; the new one refuses it.
      expect(readFileSync(join(dir, "swapped"), "utf8")).toBe("ROOT ONLY");
      expect(() => t.readPlain(join(dir, "swapped"), "utf8")).toThrow();
      expect(() => t.readPlain(join(dir, "hard"), "utf8")).toThrow(/hard link/);
    // The hashing of uploaded files (root, in a folder its owner can change) opens the same way.
    expect(read(join(IMAGE, "kinboard-transfer.mjs"))).toMatch(/function sha256File\(path\) \{\n[^}]*openSync\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("takeOver: the extracted tree checked after it is made root's: a planted link or hard link refuses it", async () => {
    const t = (await transferMod) as unknown as Transfer2;
    for (const plant of ["symlink", "hardlink"]) {
      const dir = mkdtempSync(join(tmpdir(), "kb-to-"));
      try {
        const x = join(dir, "x");
        mkdirSync(join(x, "secrets"), { recursive: true });
        writeFileSync(join(dir, "canary"), "ROOT ONLY");
        if (plant === "symlink") spawnSync("ln", ["-s", join(dir, "canary"), join(x, "secrets", "jwt_secret")]);
        else spawnSync("ln", [join(dir, "canary"), join(x, "secrets", "jwt_secret")]);
        expect(() => t.takeOver(x), plant).toThrow(/refusing this archive/);
        rmSync(join(x, "secrets", "jwt_secret"));
        writeFileSync(join(x, "secrets", "jwt_secret"), "plain");
        t.takeOver(x);
        expect(statSync(x).mode & 0o777).toBe(0o700);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const imp = src.slice(src.indexOf("export function importArchive"));
    // root's every read of the archive goes through readPlain, after takeOver.
    expect(imp.indexOf("takeOver(x);")).toBeLessThan(imp.indexOf('readPlain(join(x, "manifest.json")'));
    expect(imp).not.toMatch(/readFileSync\(join\(x/);
    expect(imp).toMatch(/if \(ids\.uid === UNPACK\)/);
    expect(read(join(LIB, "init-perms.sh"))).toContain('[ "$RUN_UID" = 65534 ] || [ "$RUN_GID" = 65534 ]');
  });

  test("an import cut off before its commit is undone by the next: files out, secrets back", async () => {
    const t = (await transferMod) as unknown as Transfer2;
    const dir = mkdtempSync(join(tmpdir(), "kb-pend-"));
    try {
      const files = join(dir, "files"); const secrets = join(dir, "secrets");
      mkdirSync(join(files, "family-photos"), { recursive: true }); mkdirSync(secrets);
      writeFileSync(join(files, "family-photos", "a.jpg"), "x");
      writeFileSync(join(secrets, "jwt_secret"), "imported");
      writeFileSync(join(secrets, "jwt_secret.previous-20261127T000000Z"), "original");
      writeFileSync(join(secrets, "vapid_public_key"), "imported, nothing before");
      t.undoPlaced({ files: ["family-photos", "../escape"], secrets: [
        { file: "jwt_secret", keep: join(secrets, "jwt_secret.previous-20261127T000000Z") },
        { file: "vapid_public_key", keep: null },
        { file: "../../etc/passwd", keep: null },
      ] }, files, secrets);
      expect(readdirSync(files)).toEqual([]);
      expect(read(join(secrets, "jwt_secret"))).toBe("original");
      expect(existsSync(join(secrets, "vapid_public_key"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const imp = src.slice(src.indexOf("export function importArchive"));
    const at = (needle: string) => { const i = imp.indexOf(needle); expect(i, needle).toBeGreaterThan(0); return i; };
    // The record first, then the files and secrets, then the commit, then the record goes.
    expect(at("writeSecretFile(secretsDir, PENDING, JSON.stringify(record), null)")).toBeLessThan(at("renameSync(join(stage, n), join(filesDir, n))"));
    expect(imp).not.toContain("join(filesDir, PENDING)");
    // The nonce is committed with the data, so "did it commit" is never a guess.
    expect(at("'import_nonce'")).toBeLessThan(at('"COMMIT;"'));
    expect(at("writeSecretFile(secretsDir, file, value, like)")).toBeLessThan(at('"COMMIT;"'));
    // (the record's last removal, after the commit; the first is the undo's)
    expect(at('"COMMIT;"')).toBeLessThan(imp.lastIndexOf("rmSync(join(secretsDir, PENDING)"));
  });

  test("export: no child is spawned while the effective user is dropped (it could not take a gid)", () => {
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const exp = src.slice(src.indexOf("export function exportArchive"), src.indexOf("export function archiveEntryProblems"));
    expect(exp).not.toMatch(/asOwnerOf\([^;]*\(ids\) =>/);
    expect(exp).toContain("const as = ownerIds(parent);");
  });
});

test.describe("init-db and recover_switch: never a new cluster beside the real one", () => {
  test("an empty db with a cluster in db.old or db.failed-* is refused", () => {
    for (const other of ["db.old", "db.failed-pg18-20261127T000000Z"]) {
      const f = fakeData();
      try {
        mkdirSync(join(f.data, "db"));
        f.cluster(other, "17");
        const r = f.initDb();
        expect(r.status, other).toBe(1);
        expect(r.stderr).toContain("Kinboard does not create a new database beside it");
        expect(readdirSync(join(f.data, "db"))).toEqual([]);
      } finally { f.done(); }
    }
  });

  test("recover_switch fails, and says so, when it cannot rename db.old back", () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.state("phase=switching\nfrom=17\nto=18\n");
      chmodSync(f.data, 0o500);
      const r = f.lib("recover_switch");
      chmodSync(f.data, 0o700);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("could not rename");
      expect(f.version("db.old")).toBe("17");
    } finally { f.done(); }
  });

  test("a clock that went backwards is outside the rollback window", () => {
    const f = fakeData("17");
    try {
      f.cluster("db", "18");
      f.cluster("db.old", "17");
      const future = Math.floor(Date.now() / 1000) + 3 * 86400;
      f.state(`phase=switched\nfrom=17\nto=18\nswitched_epoch=${future}\nconfirmed_at=\n`);
      const r = f.initDb();
      expect(r.status).toBe(1);
      expect(f.version("db")).toBe("18");
    } finally { f.done(); }
  });
});

test.describe("third review: the import's record, the secrets reader", () => {
  function dirs() {
    const dir = mkdtempSync(join(tmpdir(), "kb-rec-"));
    const files = join(dir, "files"); const secrets = join(dir, "secrets");
    mkdirSync(files); mkdirSync(secrets);
    writeFileSync(join(secrets, "jwt_secret"), "the install's own");
    return { dir, files, secrets, done: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test("red: a record forged in FILES_DIR (the server's user's folder) touches no secret", async () => {
    const t = (await transferMod) as unknown as Transfer2;
    const d = dirs();
    try {
      const forged = { nonce: "x", files: [], secrets: [{ file: "jwt_secret", keep: null }] };
      writeFileSync(join(d.files, t.PENDING), JSON.stringify(forged));
      // What the previous code did with a record found there: the secret is gone.
      const victim = dirs();
      try {
        t.undoPlaced(forged, victim.files, victim.secrets);
        expect(existsSync(join(victim.secrets, "jwt_secret"))).toBe(false);
      } finally { victim.done(); }
      // Now: only a record in the secrets folder counts; this one is ignored.
      expect(t.resumeLeftover({ filesDir: d.files, secretsDir: d.secrets, families: 0 })).toBe("");
      expect(read(join(d.secrets, "jwt_secret"))).toBe("the install's own");
    } finally { d.done(); }
  });

  test("a record in the secrets folder: undone when uncommitted, removed when its nonce committed, refused when a family came since", async () => {
    const t = (await transferMod) as unknown as Transfer2;
    const d = dirs();
    try {
      const rec = { nonce: "n1", files: ["family-photos"], secrets: [{ file: "jwt_secret", keep: `${d.secrets}/jwt_secret.previous-20261127T000000Z` }] };
      mkdirSync(join(d.files, "family-photos"));
      writeFileSync(join(d.secrets, "jwt_secret.previous-20261127T000000Z"), "the install's own");
      writeFileSync(join(d.secrets, "jwt_secret"), "imported");
      writeFileSync(join(d.secrets, t.PENDING), JSON.stringify(rec));
      // a family since, and the nonce not committed: refused, nothing changed
      expect(() => t.resumeLeftover({ filesDir: d.files, secretsDir: d.secrets, families: 1, dbNonce: "other" })).toThrow(/has a family since/);
      expect(read(join(d.secrets, "jwt_secret"))).toBe("imported");
      // committed (the nonce is the database's): only the record goes
      expect(t.resumeLeftover({ filesDir: d.files, secretsDir: d.secrets, families: 1, dbNonce: "n1" })).toContain("had committed");
      expect(read(join(d.secrets, "jwt_secret"))).toBe("imported");
      expect(existsSync(join(d.secrets, t.PENDING))).toBe(false);
      // uncommitted on a fresh install, with a trailing slash in the folder's name: undone
      writeFileSync(join(d.secrets, t.PENDING), JSON.stringify(rec));
      expect(t.resumeLeftover({ filesDir: d.files, secretsDir: `${d.secrets}/`, families: 0, dbNonce: "" })).toContain("taken out again");
      expect(read(join(d.secrets, "jwt_secret"))).toBe("the install's own");
      expect(existsSync(join(d.files, "family-photos"))).toBe(false);
    } finally { d.done(); }
  });

  test("the secrets reader refuses a symlink where readFileSync would follow it (red)", async () => {
    const m = (await import("../image/secrets-store.mjs" as string)) as { resolveSecrets(env: Record<string, string>, o: { dir: string }): { values: Record<string, string>; errors: string[] } };
    const d = dirs();
    try {
      writeFileSync(join(d.dir, "root-only"), "ROOT ONLY");
      writeFileSync(join(d.secrets, "postgres_password"), "pw");
      writeFileSync(join(d.secrets, "jwt_secret"), "j");
      spawnSync("ln", ["-s", join(d.dir, "root-only"), join(d.secrets, "cron_secret")]);
      expect(readFileSync(join(d.secrets, "cron_secret"), "utf8")).toBe("ROOT ONLY");
      const r = m.resolveSecrets({}, { dir: d.secrets });
      // Refused (the entrypoint then does not start), and the target's content is nowhere.
      expect(r.errors.join()).toContain("is a symlink");
      expect(Object.values(r.values)).not.toContain("ROOT ONLY");
    } finally { d.done(); }
  });

  test("init-perms: the 0700 chmods run as the owner; takeOver checks before it takes over", () => {
    const perms = read(join(LIB, "init-perms.sh"));
    expect(perms).toContain('as_user chmod 0700 "$DATA/db" "$DATA/config"');
    expect(perms).not.toMatch(/^chmod 0700 "\$DATA/m);
    const src = read(join(IMAGE, "kinboard-transfer.mjs"));
    const to = src.slice(src.indexOf("export function takeOver"));
    expect(to.indexOf("checkExtracted(x);")).toBeLessThan(to.indexOf('"chown"'));
  });
});
