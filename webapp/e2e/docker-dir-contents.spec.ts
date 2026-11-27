import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * webapp/docker is the folder every git install lives in: `cd webapp/docker &&
 * ./start.sh up` is how Kinboard is started and updated. Discussion #539
 * showed what a self-hoster sees there with `ls`: next to start.sh, a pile of
 * developer and CI files (test rigs, CI checks, a dev overlay), one of which,
 * test-upgrade.sh, he ran to update and got a throwaway copy of Kinboard
 * instead. The rigs went to scripts/rigs/ (#545, #551); the CI checks went to
 * scripts/ci/, the dev overlay to scripts/dev/, the build's sw.js stamp to
 * webapp/scripts/.
 *
 * This keeps it that way: the folder holds exactly the files below, each with
 * the reason an install needs it. A new file here is red until it is either
 * moved out or added with its reason. The second half checks the other
 * direction: everything an install runs, mounts or builds from is still here.
 */

const REPO = resolve(__dirname, "../..");
const DOCKER = join(REPO, "webapp/docker");

/** Top-level entries of webapp/docker (directories with a trailing /), and why an install needs each. */
const ALLOWED: Record<string, string> = {
  ".env.example": "the template setup.sh copies to .env",
  "start.sh": "how a git install starts and updates",
  "migrate.sh": "`./start.sh migrate`, and the image's migration runner",
  "migrations/": "the schema, applied by the image and migrate.sh",
  "init.sql": "the base schema, mounted into db",
  "go2rtc.yaml": "mounted into go2rtc",
  "kong.yml": "pre-1.15 installs hold it skip-worktree with their own keys; must not move",
  "diun/": "Diun's config and the webhook's hooks, mounted by docker-compose.diun.yml",
  "docker-compose.yml": "the stack",
  "docker-compose.image.yml": "named in older COMPOSE_FILES lines",
  "docker-compose.traefik.yml": "overlay named in COMPOSE_FILES",
  "docker-compose.build.yml": "overlay named in COMPOSE_FILES (build from source)",
  "docker-compose.diun.yml": "overlay named in COMPOSE_FILES (auto-update)",
  "docker-compose.diun.yml.example": "the copy the wiki tells you to make",
  "docker-compose.override.yml.example": "the copy the wiki tells you to make",
  "docker-compose.watchtower.yml.example": "deprecated, but documented as still working",
  "docker-compose.demo.yml.example": "the public demo's overlay; its copy mounts ofelia.demo.ini and seed-demo.sql from here",
  "ofelia.demo.ini": "mounted by the demo overlay",
  "seed-demo.sql": "`./start.sh seed-demo`, and mounted by the demo overlay",
  "Dockerfile": "the webapp image (docker-compose.build.yml)",
  "Dockerfile.webhook": "built by docker-compose.diun.yml",
  "kinboard-self-update.sh": "run by the webhook from this checkout",
  "kinboard-entry.sh": "called by start.sh and by older self-updates after a git pull",
  "webapp-entrypoint.sh": "COPYed into the image",
  "secrets-store.mjs": "COPYed into the image",
  "cron-call.sh": "COPYed into the image",
  "kinboard-init.mjs": "COPYed into the image",
  "kinboard-db-init.sh": "COPYed into the image",
  "stock-postgres-bootstrap.sql": "COPYed into the image",
  "postgres/": "the kinboard-postgres image",
  "test-upgrade.sh": "a stub that tells whoever ran the old rig how to update instead",
};

/** Tracked, and untracked-but-not-ignored, files directly under webapp/docker: what a checkout would carry. */
function entries(): string[] {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", REPO, ...args, "--", "webapp/docker"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const files = [...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  // Paths git lists for files deleted in the working tree but not yet committed are gone.
  const present = files.filter((f) => existsSync(join(REPO, f)));
  const top = present.map((f) => {
    const rest = f.slice("webapp/docker/".length);
    const slash = rest.indexOf("/");
    return slash === -1 ? rest : rest.slice(0, slash + 1);
  });
  return [...new Set(top)].sort();
}

test("webapp/docker holds only what an install needs", () => {
  const extra = entries().filter((e) => !(e in ALLOWED));
  expect(
    extra,
    "a file no install needs is in webapp/docker: move it to scripts/ci, scripts/dev or scripts/rigs, " +
      "or add it to ALLOWED with the reason an install needs it",
  ).toEqual([]);
});

test("everything on the list is there", () => {
  const have = new Set(entries());
  expect(Object.keys(ALLOWED).filter((e) => !have.has(e))).toEqual([]);
});

test.describe("nothing an install runs, mounts or builds from has left webapp/docker", () => {
  const read = (f: string) => readFileSync(join(DOCKER, f), "utf8");
  const code = (s: string) =>
    s
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");

  test("the compose files' bind mounts from this folder", () => {
    const missing: string[] = [];
    for (const f of readdirSync(DOCKER).filter((n) => /^docker-compose.*\.ya?ml(\.example)?$/.test(n))) {
      const src = code(read(f));
      for (const m of src.matchAll(/^\s*-\s*\.\/([^:\s]+):/gm)) if (!existsSync(join(DOCKER, m[1]))) missing.push(`${f}: ./${m[1]}`);
      for (const m of src.matchAll(/\$\{KINBOARD_PROJECT_DIR[^}]*\}\/webapp\/docker\/([^:\s"]+)/g)) {
        if (m[1].startsWith("data/")) continue; // created at runtime
        if (!existsSync(join(DOCKER, m[1]))) missing.push(`${f}: webapp/docker/${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("the Dockerfiles' sources", () => {
    const missing: string[] = [];
    // Dockerfile builds from webapp/ (docker-compose.build.yml: context ..).
    for (const m of code(read("Dockerfile")).matchAll(/^COPY (?:--\S+ )*(.+) \S+$/gm)) {
      for (const p of m[1].split(/\s+/)) if (p.startsWith("docker/") && !existsSync(join(REPO, "webapp", p))) missing.push(`Dockerfile: ${p}`);
    }
    for (const m of code(read("Dockerfile")).matchAll(/\bsh ((?:docker|scripts)\/\S+)/g)) {
      if (!existsSync(join(REPO, "webapp", m[1]))) missing.push(`Dockerfile: ${m[1]}`);
    }
    // Dockerfile.webhook builds from webapp/docker.
    for (const m of code(read("Dockerfile.webhook")).matchAll(/^COPY (?:--\S+ )*(.+) \S+$/gm)) {
      for (const p of m[1].split(/\s+/)) if (!existsSync(join(DOCKER, p))) missing.push(`Dockerfile.webhook: ${p}`);
    }
    expect(missing).toEqual([]);
  });

  test("the files the self-update, its hook and start.sh name", () => {
    const missing: string[] = [];
    for (const f of ["kinboard-self-update.sh", "diun/hooks.yaml"]) {
      for (const m of read(f).matchAll(/webapp\/docker\/([A-Za-z0-9_.\/-]+)/g)) {
        const p = m[1].replace(/[.,)]+$/, "");
        if (p === ".env" || p.startsWith("data/")) continue;
        if (!existsSync(join(DOCKER, p))) missing.push(`${f}: webapp/docker/${p}`);
      }
    }
    // Lines that run something, not the messages it prints (those name ../setup.sh).
    const startSh = code(read("start.sh"))
      .split("\n")
      .filter((l) => !/\becho\b/.test(l))
      .join("\n");
    for (const m of startSh.matchAll(/(?:\bsh |\.\/|< )([A-Za-z0-9_-]+\.(?:sh|sql))\b/g)) {
      if (!existsSync(join(DOCKER, m[1]))) missing.push(`start.sh: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
