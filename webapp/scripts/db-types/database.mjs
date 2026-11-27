// A throwaway PostgreSQL with Kinboard's schema on it, for the type generator
// (RFC-024 §4.6 step 4).
//
// The schema a new install gets, built the way a new install builds it:
// the role bootstrap (docker/stock-postgres-bootstrap.sql), the base schema
// (docker/init.sql) in one transaction, then every migration through
// docker/migrate.sh, the one migration runner. The image is the base of
// kinboard-postgres, pinned by digest in docker/postgres/Dockerfile and read
// from there, so this never needs a second copy of the pin. Its one addition,
// safeupdate, changes no type: the bootstrap only names it in a role setting,
// which is read when authenticator logs in, never here.
//
// Nothing is published but a loopback port, the container is labelled
// `kb.db-types=1` and removed on the way out, however the run ends.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PASSWORD = "db-types-throwaway";

/** The `ARG BASE=` of kinboard-postgres's Dockerfile: image and digest. */
export function pinnedBaseImage(dockerDir) {
  const dockerfile = readFileSync(join(dockerDir, "postgres", "Dockerfile"), "utf8");
  const m = /^ARG BASE=(\S+@sha256:[0-9a-f]{64})$/m.exec(dockerfile);
  if (!m) throw new Error("docker/postgres/Dockerfile has no digest-pinned `ARG BASE=`");
  return m[1];
}

function docker(args, opts = {}) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
}

/** psql inside the container, SQL on stdin, as `user`. Throws on the first error. */
function psql(name, user, sql, extra = []) {
  const r = spawnSync("docker", ["exec", "-i", name, "psql", "-X", "-q", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extra], {
    input: sql,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`psql as ${user} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the database, apply the schema, hand `run(url)` a connection URL,
 * and remove the container afterwards whatever happens.
 */
export async function withMigratedDatabase(dockerDir, run, { log = () => {} } = {}) {
  const image = pinnedBaseImage(dockerDir);
  const name = `kb-db-types-${process.pid}-${Date.now().toString(36)}`;
  const cleanup = () => spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
  const onSignal = () => { cleanup(); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    log(`starting ${image.replace(/@sha256:(.{12}).*/, "@sha256:$1…")} as ${name}`);
    docker([
      "run", "-d", "--name", name, "--label", "kb.db-types=1",
      "-e", "POSTGRES_USER=supabase_admin", "-e", `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p", "127.0.0.1::5432", image,
    ]);

    // The official entrypoint runs its init on a socket-only server, then
    // restarts it listening on TCP: ready only once TCP answers.
    const deadline = Date.now() + 120_000;
    for (;;) {
      const r = spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "postgres"], { stdio: "ignore" });
      if (r.status === 0) break;
      if (Date.now() > deadline) throw new Error(`${name} did not accept TCP connections within 120 s:\n${docker(["logs", "--tail", "30", name])}`);
      await sleep(500);
    }

    log("role bootstrap, init.sql");
    const bootstrap = readFileSync(join(dockerDir, "stock-postgres-bootstrap.sql"), "utf8");
    psql(name, "supabase_admin", `BEGIN;\n${bootstrap}\nCOMMIT;\n`, ["-v", `pw=${PASSWORD}`]);
    psql(name, "supabase_admin", readFileSync(join(dockerDir, "init.sql"), "utf8"), ["--single-transaction"]);

    log("migrations (migrate.sh)");
    const migrate = spawnSync("sh", [join(dockerDir, "migrate.sh")], {
      encoding: "utf8",
      env: { ...process.env, MIGRATIONS_DIR: join(dockerDir, "migrations"), PSQL: `docker exec -i ${name} psql -U postgres -d postgres` },
    });
    if (migrate.status !== 0) throw new Error(`migrate.sh failed:\n${(migrate.stdout + migrate.stderr).split("\n").slice(-30).join("\n")}`);
    log((migrate.stdout.trim().split("\n").pop() ?? "").replace(/^\[migrate\] /, "migrations "));

    const port = docker(["port", name, "5432/tcp"]).trim().split("\n")[0].split(":").pop();
    return await run(`postgres://supabase_admin:${PASSWORD}@127.0.0.1:${port}/postgres`);
  } finally {
    cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
