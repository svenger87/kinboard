import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Rig, SCRIPT, type Scenario, type Service } from "./helpers/self-update-stub";

/**
 * RFC-023 PR 10 (§4.8, §4.11.2, §5.2): the self-update on a git install that
 * runs the root compose.yml, and the guard for a folder with no git checkout.
 *
 * Until this, the script read COMPOSE_FILES from webapp/docker and nothing
 * else. On a stack started from the root compose.yml that finds no
 * containers (another Compose project), so every service looks missing and
 * the `up` that follows starts a second stack beside the first; the backup
 * looks for a DATA_DIR that compose.yml does not have; and setup.sh writes a
 * .env the stack does not read. Now the files come from the running stack's
 * own Compose labels.
 *
 * And on a folder without .git (a compose.yml pasted into a UI's stacks
 * folder, which may itself sit inside some other repository), the script
 * stopped at `git fetch origin main` under `set -e`, or fetched the
 * stranger's repository. Now it says so and changes nothing.
 *
 * Same harness as the other self-update specs: the whole script, a real git
 * checkout, a stub docker (helpers/self-update-stub.ts).
 */

const WEBAPP = "ghcr.io/svenger87/kinboard";
const NEXT = `${WEBAPP}:next`;
const PG = "supabase/postgres:15.14.1.159";
const REST = "postgrest/postgrest:v14.16";
const GO = "alexxit/go2rtc:1.9.14";

/** compose.yml's services: three of them run the Kinboard image. */
const STACK: Record<string, Service> = {
  init: { ref: NEXT },
  db: { ref: PG },
  "db-init": { ref: NEXT },
  rest: { ref: REST },
  webapp: { ref: NEXT },
  go2rtc: { ref: GO },
};
const IMAGES: Record<string, string> = { [PG]: "sha256:pg", [REST]: "sha256:rest", [GO]: "sha256:go", [NEXT]: "sha256:web1" };
const RUNNING = Object.fromEntries(Object.entries(STACK).map(([svc, s]) => [svc, { ref: s.ref, id: IMAGES[s.ref] }]));
/** The Diun overlay adds these two; the script never recreates them (it runs inside webhook). */
const WITH_OVERLAY: Record<string, Service> = { ...STACK, diun: { ref: "crazymax/diun:latest" }, webhook: { ref: "kinboard-webhook:local" } };

function rig(sc: Partial<Scenario> = {}) {
  const r = new Rig({ stack: STACK, containers: RUNNING, images: IMAGES, compose: {}, ...sc });
  r.setVersion("sha256:web1", "1.18.0");
  r.setVersion("sha256:web2", "1.18.1");
  return r;
}

/** An executable setup.sh at the checkout's root that leaves a mark when it runs. */
function markSetup(r: Rig) {
  const p = join(r.proj, "setup.sh");
  writeFileSync(p, `#!/bin/sh\ntouch "${join(r.dir, "setup-ran")}"\n`);
  chmodSync(p, 0o755);
  return () => existsSync(join(r.dir, "setup-ran"));
}

const ups = (calls: string[]) => calls.filter((c) => / compose .* up /.test(c));
const composeCalls = (calls: string[]) => calls.filter((c) => c.startsWith("docker compose "));
const BROKEN = { status: "restarting", restarts: 3, code: 1 };

test.describe("a git install on the root compose.yml", () => {
  test("a new image: the Kinboard services are recreated against compose.yml and nothing else; a second run does nothing", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    const setupRan = markSetup(r);
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.recreated, "init and db-init run the same image as the webapp").toEqual(["db-init", "init", "webapp"]);
      expect(r.container("db")).toEqual({ ref: PG, id: "sha256:pg" });
      // Every compose call carries the labelled project, folder and .env, and the file by absolute path.
      for (const c of composeCalls(res.calls)) {
        expect(c).toContain(`docker compose -p kbt --project-directory ${r.proj} --env-file ${join(r.proj, ".env")} -f ${join(r.proj, "compose.yml")} `);
      }
      expect(res.globals.sort()).toEqual([`--env-file ${join(r.proj, ".env")}`, `--project-directory ${r.proj}`, "-p kbt"].sort());
      expect(res.log).toContain("this stack runs compose.yml");
      expect(setupRan(), "setup.sh writes webapp/docker/.env, which compose.yml does not read").toBe(false);
      expect(res.log).toContain("not running setup.sh");
      expect(res.calls.filter((c) => c.startsWith("docker container inspect")), "no services retired in 1.15 to look for").toEqual([]);
      // The backup, from the containers' mounts: no DATA_DIR in compose.yml.
      expect(res.runs).toContain("-v kinboard-storage:/data/storage:ro");
      expect(res.runs).toContain("-v kinboard-backups:/out");
      expect(res.runs, "the config archive").toContain("-v kinboard-config:/config:ro");
      expect(res.log).toMatch(/backup: pre-upgrade-\d{8}-\d{6}-config\.tar\.gz \(7 file\(s\) from kinboard-config/);
      expect(res.out).toContain("healthy: init db-init webapp");
      expect(res.out).toContain("smoke check passed");
      expect(res.out).toContain("this stack has no cron service to refresh");
      expect(res.record).toMatchObject({ status: "updated", from: "1.18.0", to: "1.18.1", backup_dir: "kinboard-backups" });

      const again = r.run();
      expect(again.status, again.out).toBe(0);
      expect(again.recreated).toEqual([]);
      expect(again.calls.some((c) => c.includes("pg_dumpall")), "no backup when nothing changes").toBe(false);
      expect(again.out).toContain("no service changed; none recreated");
    } finally {
      r.cleanup();
    }
  });

  test("the time zone comes from the stack's .env, not from the webhook container's TZ", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run([], { TZ: "Etc/UTC" });
      expect(res.status, res.out).toBe(0);
      expect(res.tz).toEqual(["<unset>"]);
    } finally {
      r.cleanup();
    }
  });

  test("with the Diun overlay given by absolute path: both files, and webhook and diun are never recreated", () => {
    const r = rig({
      stack: WITH_OVERLAY,
      containers: { ...RUNNING, diun: { ref: "crazymax/diun:latest", id: "sha256:diun1" }, webhook: { ref: "kinboard-webhook:local", id: "sha256:hook" } },
      images: { ...IMAGES, "crazymax/diun:latest": "sha256:diun1", "kinboard-webhook:local": "sha256:hook" },
      registry: { [NEXT]: "sha256:web2", "crazymax/diun:latest": "sha256:diun2" },
      compose: { overlay: true },
    });
    try {
      // As the overlay's webhook runs it: its own labels, and the overlay's
      // default COMPOSE_FILES, which names the legacy files.
      const res = r.run([], {
        KINBOARD_SELF_CONTAINER: "cid-webhook-g0",
        COMPOSE_FILES: "-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.diun.yml",
      });
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
      for (const c of composeCalls(res.calls)) {
        expect(c).toContain(` -f ${join(r.proj, "compose.yml")} -f ${join(r.proj, "webapp", "docker", "docker-compose.diun.yml")} `);
        expect(c).not.toContain("docker-compose.image.yml");
      }
      expect(res.log).toContain("COMPOSE_FILES (-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.diun.yml) names the legacy files and is not used");
      for (const up of ups(res.calls)) expect(up).not.toMatch(/ (webhook|diun)( |$)/);
    } finally {
      r.cleanup();
    }
  });

  test("COMPOSE_FILES naming compose.yml by absolute path is used as given", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" }, compose: { labels: "none" } });
    try {
      const files = `-f ${join(r.proj, "compose.yml")} -f ${join(r.proj, "webapp", "docker", "docker-compose.diun.yml")}`;
      const res = r.run([], { COMPOSE_FILES: files });
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
      for (const c of composeCalls(res.calls)) expect(c).toContain(`--project-directory ${r.proj} ${files} `);
      expect(res.globals, "no labels to read a project name from: Compose's own default").not.toContain("-p kbt");
    } finally {
      r.cleanup();
    }
  });

  test("COMPOSE_FILES as the RFC writes it, relative to webapp/docker, is made absolute", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run([], { COMPOSE_FILES: "-f ../../compose.yml -f docker-compose.diun.yml" });
      expect(res.status, res.out).toBe(0);
      for (const c of composeCalls(res.calls)) {
        expect(c).toContain(`-p kbt --project-directory ${r.proj} --env-file ${join(r.proj, ".env")} -f ${r.proj}/compose.yml -f ${r.proj}/webapp/docker/docker-compose.diun.yml `);
      }
    } finally {
      r.cleanup();
    }
  });

  test("a definition changed by the pull (a new PostgREST pin in compose.yml) recreates that service", () => {
    const r = rig({ pulled: { ...STACK, rest: { ref: "postgrest/postgrest:v14.17" } }, registry: { "postgrest/postgrest:v14.17": "sha256:rest17" } });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["rest"]);
      expect(r.container("rest")).toEqual({ ref: "postgrest/postgrest:v14.17", id: "sha256:rest17" });
    } finally {
      r.cleanup();
    }
  });

  test("a broken image is rolled back on compose.yml: the one-shots and the webapp go back together", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setHealth("sha256:web2", BROKEN);
    r.setLogs("webapp", "[entrypoint] boom\n");
    try {
      const res = r.run();
      expect(res.status, "a rollback is not a success").toBe(1);
      for (const svc of ["init", "db-init", "webapp"]) expect(r.container(svc)).toEqual({ ref: NEXT, id: "sha256:web1" });
      // init alone first, then the rest, on the way there and on the way back.
      const [up1, up2, back1, back2] = ups(res.calls).slice(-4);
      expect(up1).toMatch(/--no-deps --force-recreate init$/);
      expect(up2).toMatch(/--no-deps --force-recreate db-init webapp$/);
      for (const back of [back1, back2]) {
        expect(back).toContain(`docker compose -p kbt --project-directory ${r.proj}`);
        expect(back).toContain("--pull never");
      }
      expect(back1).toMatch(/--force-recreate init$/);
      expect(back2).toMatch(/--force-recreate db-init webapp$/);
      expect(res.state).toMatch(new RegExp(`^held sha256:web2 ${NEXT} `, "m"));
      // One reference, three services: tagged back once, held once, and no
      // service blamed on its definition because another was tagged back first.
      expect(res.tags).toEqual([`sha256:web1 ${NEXT}`]);
      expect(res.out.match(/holding back /g)).toHaveLength(1);
      expect(res.out).not.toContain("runs the same image as before");
      expect(res.record).toMatchObject({ status: "rolled_back", from: "1.18.0", to: "1.18.1", backup_dir: "kinboard-backups" });

      // The next run finds the version held: no backup, nothing recreated,
      // the tag pointed back once.
      r.setRegistry({ [NEXT]: "sha256:web2" });
      const held = r.run();
      expect(held.status, held.out).toBe(0);
      expect(held.out).toContain("held webapp (image)");
      expect(held.recreated).toEqual([]);
      expect(held.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(held.tags).toEqual([`sha256:web1 ${NEXT}`]);
    } finally {
      r.cleanup();
    }
  });

  test("the secrets kept as files are taken out of the log excerpt too", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    // A VAPID private key is base64url: no shape-based rule would catch it.
    const vapid = "Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k";
    r.setStoredSecrets([vapid, "postgres://authenticator:pw@db:5432/postgres"]);
    r.setHealth("sha256:web2", BROKEN);
    r.setLogs("webapp", `[push] key ${vapid} rejected\n`);
    try {
      const res = r.run();
      expect(res.record).toMatchObject({ status: "rolled_back" });
      expect(String(res.record!.log)).toContain("[push] key [redacted] rejected");
      expect(JSON.stringify(res.record)).not.toContain(vapid);
    } finally {
      r.cleanup();
    }
  });

  test("the secrets kept as files cannot be read (the database container's exec fails): no log excerpt is stored, a note says why", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    const vapid = "Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k";
    r.setStoredSecrets([vapid]);
    r.setStoredSecretsUnreadable();
    r.setHealth("sha256:web2", BROKEN);
    r.setLogs("webapp", `[push] key ${vapid} rejected\n`);
    try {
      const res = r.run();
      expect(res.record).toMatchObject({
        status: "rolled_back",
        log: "log excerpt withheld: could not read the containers' settings to hide secrets; see the update log on the host",
      });
      expect(JSON.stringify(res.record)).not.toContain(vapid);
      expect(JSON.stringify(res.record)).not.toContain("[push]");
    } finally {
      r.cleanup();
    }
  });

  test("uploaded files in a host folder (KINBOARD_STORAGE_DIR): backed up next to it, as $DATA_DIR/backups is", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setMount("webapp", "/var/lib/storage", "/srv/kinboard/storage");
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toContain("-v /srv/kinboard/storage:/data/storage:ro");
      expect(res.runs).toContain("-v /srv/kinboard/backups:/out");
      expect(res.runs, "the archive has the same storage/ prefix as a legacy one").toMatch(/-C \/data storage/);
    } finally {
      r.cleanup();
    }
  });

  test("KINBOARD_BACKUP_DIR in the stack's .env names the backup folder", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    writeFileSync(join(r.proj, ".env"), "KINBOARD_TAG=next\nKINBOARD_BACKUP_DIR=/srv/backups/kinboard\n");
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toContain("-v /srv/backups/kinboard:/out");
    } finally {
      r.cleanup();
    }
  });

  test("a webapp with nothing at /var/lib/storage: no backup, nothing recreated", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setMount("webapp", "/var/lib/storage", "");
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("mounts nothing at /var/lib/storage");
      expect(res.out).toContain("ABORTED: no verified backup");
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("the running stack is legacy but COMPOSE_FILES names compose.yml: refused before anything is touched", () => {
    const r = rig({ compose: undefined, legacyLabels: true, registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run([], { COMPOSE_FILES: "-f ../../compose.yml" });
      expect(res.status).toBe(1);
      expect(res.out).toContain("Running one against the other would start a second stack");
      expect(res.out).toContain("=== self-update skipped ===");
      expect(composeCalls(res.calls)).toEqual([]);
      expect(res.out).not.toContain("git fetch");
      expect(res.hashesFile).toBeNull();
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a labelled file this container cannot read: refused before anything is touched", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setLabels(`kbt|${r.proj}|${join(r.proj, "compose.yml")},/elsewhere/traefik.yml|${join(r.proj, ".env")}`);
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("the stack was started with /elsewhere/traefik.yml, which cannot be read here");
      expect(composeCalls(res.calls)).toEqual([]);
      expect(res.hashesFile).toBeNull();
    } finally {
      r.cleanup();
    }
  });

  test("the tick on compose.yml: a tag changed in the stack's .env is applied with the same files", () => {
    const r = rig({ stateFile: "baseline 2026-11-01T00:00:00Z\n", registry: { [`${WEBAPP}:1.18.1`]: "sha256:web2" } });
    // What `docker compose config` names after KINBOARD_TAG=1.18.1 in the root .env.
    r.setStack({ ...STACK, init: { ref: `${WEBAPP}:1.18.1` }, "db-init": { ref: `${WEBAPP}:1.18.1` }, webapp: { ref: `${WEBAPP}:1.18.1` } });
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
      for (const c of composeCalls(res.calls)) expect(c).toContain("-p kbt --project-directory");
      expect(res.out, "a tick never runs git").not.toContain("git fetch");
    } finally {
      r.cleanup();
    }
  });

  test("KINBOARD_UPDATE_TICK=off in the root .env stops the tick", () => {
    const r = rig({ stateFile: "baseline 2026-11-01T00:00:00Z\n" });
    writeFileSync(join(r.proj, ".env"), "KINBOARD_UPDATE_TICK=off\n");
    try {
      const res = r.run(["--tick"]);
      expect(res.status).toBe(0);
      expect(res.out).toContain("switched off");
      expect(res.calls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});

test.describe("no git checkout (RFC-023 §4.8)", () => {
  for (const args of [[], ["--tick"]]) {
    test(`${args.length ? "a tick" : "an update"} in a folder without .git says so, exits 0, and touches nothing`, () => {
      const r = rig({ noGit: true, registry: { [NEXT]: "sha256:web2" } });
      const setupRan = markSetup(r);
      try {
        const before = readdirSync(r.proj).sort();
        const res = r.run(args);
        expect(res.status, res.out).toBe(0);
        expect(res.out).toContain("this install has no git checkout");
        expect(res.out).toContain("docker compose pull && docker compose up -d");
        expect(res.calls, "not one docker call").toEqual([]);
        expect(setupRan()).toBe(false);
        expect(res.out).not.toContain("git fetch");
        expect(readdirSync(r.proj).sort(), "nothing written into the folder").toEqual(before);
        expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web1" });
      } finally {
        r.cleanup();
      }
    });
  }

  test("the tick loop does not even start", () => {
    const r = rig({ noGit: true });
    try {
      const t0 = Date.now();
      const res = r.run(["--tick-loop"], { KINBOARD_TICK_FIRST: "30" });
      expect(res.status).toBe(0);
      expect(Date.now() - t0, "it would sleep 30 s before its first tick").toBeLessThan(10_000);
      expect(res.out).toContain("this install has no git checkout");
    } finally {
      r.cleanup();
    }
  });

  test("a folder inside someone else's repository is not that repository's checkout", () => {
    // A UI that keeps every stack in one folder under version control: the
    // pasted compose.yml's folder has no .git, its parent does.
    const r = rig({ noGit: true });
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: r.dir, stdio: "pipe" });
    git("init", "-q");
    git("remote", "add", "origin", join(r.dir, "origin.git"));
    try {
      const res = r.run();
      expect(res.status).toBe(0);
      expect(res.out).toContain("this install has no git checkout");
      expect(existsSync(join(r.dir, ".git", "FETCH_HEAD")), "the parent repository was never fetched").toBe(false);
      expect(res.calls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a PROJECT_DIR that is not there is an error, not 'no git'", () => {
    const r = rig();
    try {
      const res = r.run([], { PROJECT_DIR: join(r.dir, "missing") });
      expect(res.status).toBe(1);
      expect(res.out).toContain("is not a folder here");
      expect(res.calls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});

test.describe("legacy git installs are unchanged", () => {
  const LEGACY: Record<string, Service> = { db: { ref: PG }, webapp: { ref: NEXT }, cron: { ref: "mcuadros/ofelia@sha256:efcb" } };
  const LEGACY_IMAGES = { [PG]: "sha256:pg", [NEXT]: "sha256:web1", "mcuadros/ofelia@sha256:efcb": "sha256:ofelia" };
  const LEGACY_RUNNING = Object.fromEntries(Object.entries(LEGACY).map(([svc, s]) => [svc, { ref: s.ref, id: LEGACY_IMAGES[s.ref as keyof typeof LEGACY_IMAGES] }]));

  for (const labels of [false, true]) {
    test(`${labels ? "with" : "without"} legacy Compose labels: COMPOSE_FILES as given, setup.sh, DATA_DIR and no extra flags`, () => {
      const r = new Rig({ stack: LEGACY, containers: LEGACY_RUNNING, images: LEGACY_IMAGES, registry: { [NEXT]: "sha256:web2" }, legacyLabels: labels });
      const setupRan = markSetup(r);
      try {
        const res = r.run([], { TZ: "Etc/UTC", ...(labels ? { KINBOARD_SELF_CONTAINER: "cid-webhook-g0" } : {}) });
        expect(res.status, res.out).toBe(0);
        expect(res.recreated).toEqual(["cron", "webapp"]);
        expect(res.globals, "no -p, --project-directory or --env-file").toEqual([]);
        for (const c of composeCalls(res.calls)) expect(c).toMatch(/^docker compose -f docker-compose\.yml /);
        expect(setupRan()).toBe(true);
        expect(res.calls, "the services retired in 1.15 are looked for, as before").toContain("docker container inspect kinboard-kong");
        expect(res.runs).toContain(`-v ${join(r.dir, "data")}:/data:ro`);
        expect(res.runs).toContain(`-v ${join(r.dir, "data")}/backups:/out`);
        expect(res.log).not.toContain("compose.yml:");
        expect(res.tz, "the environment is left as it is").toEqual(["Etc/UTC"]);
      } finally {
        r.cleanup();
      }
    });
  }

  test("a legacy install's run logs no line it did not log before", () => {
    // The script's own log, minus timestamps, for an update on main's script
    // and on this one would be the same; here: none of the new lines appear.
    const r = new Rig({ stack: LEGACY, containers: LEGACY_RUNNING, images: LEGACY_IMAGES, registry: { [NEXT]: "sha256:web2" }, legacyLabels: true });
    try {
      const res = r.run([], { KINBOARD_SELF_CONTAINER: "cid-webhook-g0" });
      for (const s of ["this stack runs compose.yml", "not running setup.sh", "no git checkout", "Compose labels"]) expect(res.log).not.toContain(s);
    } finally {
      r.cleanup();
    }
  });
});

test("the script still parses as POSIX sh", () => {
  execFileSync("sh", ["-n", SCRIPT]);
});

test.describe("the Diun overlay on compose.yml (RFC-023 §4.11.2)", () => {
  // The webhook's build context moved to its own overlay when the webhook became a published image.
  const overlays = ["docker/docker-compose.diun.yml", "docker/docker-compose.webhook-build.yml"];
  /** Each path as the overlays name it now, and as it did before (relative to webapp/docker). */
  const MOVED: [string, string][] = [
    ["- ${KINBOARD_PROJECT_DIR}/webapp/docker/diun/diun.yml:/diun.yml:ro", "- ./diun/diun.yml:/diun.yml:ro"],
    ["- ${KINBOARD_PROJECT_DIR}/webapp/docker/data/diun:/data", "- ./data/diun:/data"],
    ["context: ${KINBOARD_PROJECT_DIR}/webapp/docker\n", "context: .\n"],
    ["- ${KINBOARD_PROJECT_DIR}/webapp/docker/diun:/etc/webhook:ro", "- ./diun:/etc/webhook:ro"],
  ];

  // A relative path in an overlay is read from the folder of the FIRST compose
  // file: webapp/docker for docker-compose.yml, but the checkout's root for
  // compose.yml, where ./diun does not exist.
  {
    test(`${overlays.join(" and ")} name their own files by absolute path, from KINBOARD_PROJECT_DIR`, () => {
      const text = overlays.map((file) => readFileSync(file, "utf8")).join("\n");
      const sources = [...text.matchAll(/^\s+- ([^:\s#][^:\s]*):\/[^\s]*$/gm)].map((m) => m[1]);
      const contexts = [...text.matchAll(/^\s+context: (\S+)$/gm)].map((m) => m[1]);
      expect(sources.length + contexts.length, "found no volume or build context").toBeGreaterThan(3);
      // The same folders the relative paths named, read from webapp/docker.
      for (const [abs] of MOVED) expect(text).toContain(abs);
      for (const p of [...sources, ...contexts]) {
        expect(p, `${p} is relative to whichever compose file comes first`).toMatch(/^(\/|\$\{KINBOARD_PROJECT_DIR\})/);
      }
    });
  }

  test("for docker-compose.yml the absolute paths are the same folders the relative ones were", () => {
    test.skip(spawnSync("docker", ["compose", "version"]).status !== 0, "no docker compose here");
    const dir = mkdtempSync(join(tmpdir(), "diun-overlay-"));
    try {
      let old = readFileSync("docker/docker-compose.diun.yml", "utf8");
      for (const [abs, rel] of MOVED) old = old.replace(abs, rel);
      writeFileSync(join("docker", `.diun-relative-${process.pid}.yml`), old);
      const env = { ...process.env, KINBOARD_PROJECT_DIR: resolve(".."), DIUN_WEBHOOK_SECRET: "x", POSTGRES_PASSWORD: "x", JWT_SECRET: "x", DATA_DIR: dir };
      const cfg = (overlay: string) =>
        execFileSync("docker", ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml", "-f", overlay, "config", "--hash=*"], { cwd: "docker", env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
          .split("\n")
          .filter(Boolean)
          .sort();
      const before = cfg(`.diun-relative-${process.pid}.yml`);
      const after = cfg("docker-compose.diun.yml");
      expect(after.some((l) => l.startsWith("diun "))).toBe(true);
      expect(after, "no service of a legacy stack changes, diun and webhook included").toEqual(before);
    } finally {
      rmSync(join("docker", `.diun-relative-${process.pid}.yml`), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("the smoke check's secret on compose.yml", () => {
  // The command the script runs inside the webapp container, as written.
  const line = readFileSync(SCRIPT, "utf8").split("\n").find((l) => l.includes("api/health?deep=1") && l.includes("docker exec"));
  const inner = line?.match(/sh -c '([^']+)'/)?.[1];

  function bearer(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "smoke-"));
    try {
      // `cat` of the store's file and `curl` stand in for the container's.
      writeFileSync(join(dir, "cat"), `#!/bin/sh\n[ "$1" = /kinboard/secrets/cron_secret ] && printf from-the-store\n`);
      writeFileSync(join(dir, "curl"), `#!/bin/sh\nfor a in "$@"; do case "$a" in Authorization:*) echo "$a" ;; esac; done\n`);
      chmodSync(join(dir, "cat"), 0o755);
      chmodSync(join(dir, "curl"), 0o755);
      const { CRON_SECRET: _drop, ...rest } = process.env;
      return execFileSync("sh", ["-c", inner!], { encoding: "utf8", env: { ...rest, PATH: `${dir}:${process.env.PATH}`, ...env } }).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("no CRON_SECRET in the container's environment: the secrets store's file", () => {
    expect(inner, "could not find the smoke check's command").toBeTruthy();
    expect(bearer({})).toBe("Authorization: Bearer from-the-store");
  });

  test("CRON_SECRET in the environment (a legacy install): that, as before", () => {
    expect(bearer({ CRON_SECRET: "from-the-env" })).toBe("Authorization: Bearer from-the-env");
  });
});

test.describe("which stack, which order, which folder", () => {
  test("init is recreated alone and must have finished before db-init and the webapp start", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      const u = ups(res.calls).filter((c) => c.includes("--force-recreate"));
      expect(u.map((c) => c.replace(/.*--force-recreate /, ""))).toEqual(["init", "db-init webapp"]);
      // init was looked at (and found done) between the two.
      const i1 = res.calls.indexOf(u[0]);
      const i2 = res.calls.indexOf(u[1]);
      expect(res.calls.slice(i1, i2).some((c) => c.includes("State.Status") && c.includes("cid-init"))).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  test("an init that fails stops the update before the webapp is started on the new image, and is rolled back", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setServiceHealth("init", { status: "exited", code: 1, policy: "no" });
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("init: exited with code 1");
      const forced = ups(res.calls).filter((c) => c.includes("--force-recreate") && !c.includes("--pull never"));
      expect(forced.map((c) => c.replace(/.*--force-recreate /, "")), "db-init and the webapp never got the new image").toEqual(["init"]);
      expect(res.out).toContain("ROLLBACK DID NOT COME UP EITHER"); // init still exits 1 on the old image in the stub
    } finally {
      r.cleanup();
    }
  });

  test("Compose v1 labels, relative to webapp/docker, are a legacy stack", () => {
    const LEGACY: Record<string, Service> = { db: { ref: PG }, webapp: { ref: NEXT } };
    const r = new Rig({ stack: LEGACY, containers: { db: { ref: PG, id: "sha256:pg" }, webapp: { ref: NEXT, id: "sha256:web1" } }, images: IMAGES, registry: { [NEXT]: "sha256:web2" } });
    r.setLabels(`docker|${join(r.proj, "webapp", "docker")}|docker-compose.yml,docker-compose.diun.yml|`);
    try {
      const res = r.run([], { KINBOARD_SELF_CONTAINER: "cid-webhook-g0" });
      expect(res.status, res.out).toBe(0);
      expect(res.globals).toEqual([]);
      expect(res.recreated).toEqual(["webapp"]);
    } finally {
      r.cleanup();
    }
  });

  test("compose.yml labels relative to the project folder are made absolute against it", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setLabels(`kbt|${r.proj}|compose.yml|.env`);
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      for (const c of composeCalls(res.calls)) expect(c).toContain(`--env-file ${r.proj}/.env -f ${r.proj}/compose.yml `);
    } finally {
      r.cleanup();
    }
  });

  test("this container's labels count only when its project is a Kinboard stack", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    // Another project's container (no webapp in it) running the script.
    writeFileSync(join(r.stub, "labels", "stranger"), `other|/srv/other|/srv/other/compose.yml|\n`);
    try {
      const res = r.run([], { KINBOARD_SELF_CONTAINER: "cid-stranger-g0" });
      expect(res.status, res.out).toBe(0);
      expect(res.globals, "the Kinboard stack found by its folder instead").toContain("-p kbt");
      expect(res.calls.join("\n")).not.toContain("/srv/other");
    } finally {
      r.cleanup();
    }
  });

  test("a git checkout that is not Kinboard's (a Compose UI's own stacks repository) is left alone", () => {
    const r = rig({ noGit: true, registry: { [NEXT]: "sha256:web2" } });
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: r.proj, stdio: "pipe" });
    git("init", "-q");
    git("add", "compose.yml");
    git("commit", "-qm", "my stacks");
    git("remote", "add", "origin", join(r.dir, "origin.git"));
    try {
      const res = r.run();
      expect(res.status).toBe(0);
      expect(res.out).toContain("is a git checkout, but not of Kinboard");
      expect(res.calls).toEqual([]);
      expect(existsSync(join(r.proj, ".git", "FETCH_HEAD"))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  test("uploaded files in a folder not called storage: backups beside it, not in a parent's shared backups/", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setMount("webapp", "/var/lib/storage", "/mnt/user/appdata/kinboard-storage");
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toContain("-v /mnt/user/appdata/kinboard-storage-backups:/out");
      expect(res.runs).not.toContain("/mnt/user/appdata/backups");
    } finally {
      r.cleanup();
    }
  });

  test("the root .env's tick switch wins over an old webapp/docker/.env", () => {
    const r = rig({ stateFile: "baseline 2026-11-01T00:00:00Z\n", registry: { [`${WEBAPP}:1.18.1`]: "sha256:web2" } });
    r.addEnv("KINBOARD_UPDATE_TICK=off"); // webapp/docker/.env, left from before the move
    writeFileSync(join(r.proj, ".env"), "KINBOARD_UPDATE_TICK=on\n");
    r.setStack({ ...STACK, init: { ref: `${WEBAPP}:1.18.1` }, "db-init": { ref: `${WEBAPP}:1.18.1` }, webapp: { ref: `${WEBAPP}:1.18.1` } });
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.out).not.toContain("switched off");
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
    } finally {
      r.cleanup();
    }
  });

  test("services on one reference that ran different images: the rollback tags it back to the webapp's", () => {
    // `config --services` gives no fixed order (three calls, three orders on
    // a real host): here the webapp comes first.
    const { webapp, ...others } = STACK;
    const r = rig({
      stack: { webapp, ...others },
      containers: { ...RUNNING, init: { ref: NEXT, id: "sha256:web0" }, "db-init": { ref: NEXT, id: "sha256:web0" } },
      images: { ...IMAGES, "sha256:web0": "sha256:web0" },
      registry: { [NEXT]: "sha256:web2" },
    });
    r.setHealth("sha256:web2", BROKEN);
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.tags.at(-1)).toBe(`sha256:web1 ${NEXT}`);
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web1" });
    } finally {
      r.cleanup();
    }
  });
});
