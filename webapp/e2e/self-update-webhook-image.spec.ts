import { test, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rig, SCRIPT, type Scenario, type Service } from "./helpers/self-update-stub";

/**
 * The Diun overlay's webhook runs a published image (#539).
 *
 * Every git install with the overlay used to build kinboard-webhook:local on
 * its own machine at the first `up`. On an OpenMediaVault host dockerd
 * crashed in that build (a SIGSEGV in the network hook of `RUN apk add`), so
 * the webhook never existed and nothing ever updated. The overlay now pulls
 * ghcr.io/svenger87/kinboard-webhook under the webapp's tag, and the
 * self-update keeps the webhook on what the compose files name:
 *
 *   - an update pulls every service but the webhook, then the webhook on its
 *     own, so a webhook image that can't be pulled never holds up a release;
 *   - when the webhook runs another image than the files name (the switch
 *     from kinboard-webhook:local, a KINBOARD_TAG changed, a newer image
 *     under the tag), it starts a short-lived container from the new image
 *     that recreates the webhook once the run has released its lock. The run
 *     can't do that itself: it executes inside the webhook.
 *
 * The first part drives the whole script against the stub daemon
 * (helpers/self-update-stub.ts). The second runs the recreating container's
 * own script with a stub `docker` and a real lock.
 */

const WEBAPP = "ghcr.io/svenger87/kinboard";
const HOOK = "ghcr.io/svenger87/kinboard-webhook";
const PG = "supabase/postgres:15.14.1.159";
const REST = "postgrest/postgrest:v14.16";
const DIUN = "crazymax/diun:latest";
const LOCAL = "kinboard-webhook:local";

/** The legacy stack with the Diun overlay, on 1.17 (the webhook built here). */
const OLD: Record<string, Service> = {
  db: { ref: PG },
  rest: { ref: REST },
  webapp: { ref: `${WEBAPP}:latest` },
  diun: { ref: DIUN },
  webhook: { ref: LOCAL },
};
/** The same after the release that publishes the webhook. */
const NEW: Record<string, Service> = { ...OLD, webhook: { ref: `${HOOK}:latest` } };
const IMAGES: Record<string, string> = {
  [PG]: "sha256:pg",
  [REST]: "sha256:rest",
  [`${WEBAPP}:latest`]: "sha256:web1",
  [DIUN]: "sha256:diun",
  [LOCAL]: "sha256:local",
};
const RUNNING = Object.fromEntries(Object.entries(OLD).map(([svc, s]) => [svc, { ref: s.ref, id: IMAGES[s.ref] }]));

function rig(sc: Partial<Scenario> = {}) {
  const r = new Rig({ stack: OLD, pulled: NEW, containers: RUNNING, images: IMAGES, legacyLabels: true, ...sc });
  r.setVersion("sha256:web1", "1.17.0");
  r.setVersion("sha256:web2", "1.18.0");
  return r;
}
/** As the overlay's webhook runs the script: its own container, the overlay's COMPOSE_FILES and secret. */
const AS_WEBHOOK = {
  KINBOARD_SELF_CONTAINER: "cid-webhook-g0",
  COMPOSE_FILES: "-f docker-compose.yml -f docker-compose.diun.yml",
  DIUN_WEBHOOK_SECRET: "s3cret",
};
const pullCalls = (calls: string[]) => calls.filter((c) => / pull( |$)/.test(c));
const refreshRuns = (runs: string) => runs.split("\n").filter((l) => l.includes("app.kinboard.webhook-refresh=1"));

test.describe("the self-update moves the webhook onto its published image", () => {
  test("from kinboard-webhook:local: the release is applied, then a container recreates the webhook after the run", () => {
    const r = rig({ registry: { [`${WEBAPP}:latest`]: "sha256:web2", [`${HOOK}:latest`]: "sha256:hook2" } });
    try {
      const res = r.run([], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("=== self-update done ===");
      // The webapp's release, as before; the webhook is never recreated by the run itself.
      expect(res.recreated).toEqual(["webapp"]);
      // The main pull leaves the webhook out; the webhook's own pull follows.
      const pulls = pullCalls(res.calls);
      expect(pulls[0]).toMatch(/ pull --ignore-buildable db rest webapp diun\s*$/);
      expect(pulls[1]).toMatch(/ pull --ignore-buildable webhook$/);
      expect(r.imageOnDisk(`${HOOK}:latest`)).toBe("sha256:hook2");
      // The container that does it: the new image, the webhook's mounts, this run's lock and stack.
      const runs = refreshRuns(res.runs);
      expect(runs).toHaveLength(1);
      const run = runs[0];
      expect(run).toContain("--rm -d --name docker-webhook-refresh");
      expect(run).toContain("--network none --no-healthcheck");
      expect(run).toContain("--volumes-from cid-webhook-g0");
      expect(run).toContain(`-w ${join(r.proj, "webapp", "docker")}`);
      expect(run).toContain(`KB_LOCK=${join(r.proj, ".git", "kinboard-update.lock")}`);
      expect(run).toContain(`KB_WANT=${HOOK}:latest -e KB_WANT_ID=sha256:hook2 -e KB_OLD_ID=sha256:local`);
      expect(run).toContain("KB_ARGS=-f docker-compose.yml -f docker-compose.diun.yml");
      // The webhook's own interpolated values, handed on unchanged.
      expect(run).toContain("COMPOSE_FILES=-f docker-compose.yml -f docker-compose.diun.yml");
      expect(run).toContain("DIUN_WEBHOOK_SECRET=s3cret");
      expect(run).toContain("--entrypoint sh sha256:hook2 -c");
      expect(res.log).toContain(`the webhook runs ${LOCAL} (sha256:local); it is recreated on ${HOOK}:latest (sha256:hook2) once this run has ended`);
      // Nothing builds: no `build`, and every up says --no-build.
      expect(res.calls.filter((c) => c.startsWith("docker ") && / build( |$)/.test(c))).toEqual([]);
      // (The recreating container's script is one long `docker run` argument: its lines are not calls.)
      for (const up of res.calls.filter((c) => c.startsWith("docker compose ") && / up /.test(c))) {
        expect(up).toContain("--no-build");
        expect(up).not.toMatch(/ webhook( |$)/);
      }
    } finally {
      r.cleanup();
    }
  });

  test("the webhook's image can't be pulled (a pin older than it): the release goes on, the webhook stays", () => {
    const r = rig({ registry: { [`${WEBAPP}:latest`]: "sha256:web2" } });
    r.setUnpullable([`${HOOK}:latest`]);
    try {
      const res = r.run([], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("=== self-update done ===");
      expect(res.recreated).toEqual(["webapp"]);
      expect(r.container("webapp")?.id).toBe("sha256:web2");
      expect(res.log).toContain(`WARN: could not pull the webhook's image ${HOOK}:latest; the webhook stays on ${LOCAL}`);
      expect(res.log).toContain("KINBOARD_WEBHOOK_TAG=latest");
      expect(refreshRuns(res.runs)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a webhook already on its image: nothing is started", () => {
    const running = { ...RUNNING, webhook: { ref: `${HOOK}:latest`, id: "sha256:hook2" } };
    const r = rig({
      stack: NEW,
      pulled: undefined,
      containers: running,
      images: { ...IMAGES, [`${HOOK}:latest`]: "sha256:hook2" },
      registry: { [`${HOOK}:latest`]: "sha256:hook2" },
    });
    try {
      const res = r.run([], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      expect(pullCalls(res.calls).some((c) => / webhook$/.test(c))).toBe(true);
      expect(refreshRuns(res.runs)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a newer image under the webhook's tag: an update applies it after the run", () => {
    const running = { ...RUNNING, webhook: { ref: `${HOOK}:latest`, id: "sha256:hook1" } };
    const r = rig({
      stack: NEW,
      pulled: undefined,
      containers: running,
      images: { ...IMAGES, [`${HOOK}:latest`]: "sha256:hook1" },
      registry: { [`${HOOK}:latest`]: "sha256:hook2" },
    });
    try {
      const res = r.run([], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      const runs = refreshRuns(res.runs);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toContain("KB_WANT_ID=sha256:hook2 -e KB_OLD_ID=sha256:hook1");
    } finally {
      r.cleanup();
    }
  });

  test("a tick follows a KINBOARD_TAG changed to a sha- pin: the webapp and the webhook", () => {
    const LATEST = { ...RUNNING, webhook: { ref: `${HOOK}:latest`, id: "sha256:hook1" } };
    const PIN = "sha-abc1234";
    const pinned: Record<string, Service> = { ...NEW, webapp: { ref: `${WEBAPP}:${PIN}` }, webhook: { ref: `${HOOK}:${PIN}` } };
    const r = rig({
      stack: NEW,
      pulled: undefined,
      containers: LATEST,
      images: { ...IMAGES, [`${HOOK}:latest`]: "sha256:hook1" },
      registry: { [`${WEBAPP}:${PIN}`]: "sha256:webpin", [`${HOOK}:${PIN}`]: "sha256:hookpin" },
      stateFile: "baseline 2026-11-26T00:00:00Z\n",
    });
    r.setVersion("sha256:webpin", "1.18.0");
    try {
      r.setStack(pinned);
      const res = r.run(["--tick"], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["webapp"]);
      expect(r.container("webapp")?.ref).toBe(`${WEBAPP}:${PIN}`);
      expect(pullCalls(res.calls).some((c) => / pull --ignore-buildable webhook$/.test(c))).toBe(true);
      const runs = refreshRuns(res.runs);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toContain(`KB_WANT=${HOOK}:${PIN} -e KB_WANT_ID=sha256:hookpin`);
      // Once that container has done its work, the next tick has nothing to do.
      writeFileSync(join(r.stub, "containers", "webhook"), `${HOOK}:${PIN}|sha256:hookpin|2026-11-27T00:00:00.000000000Z\n`);
      const quiet = r.run(["--tick"], AS_WEBHOOK);
      expect(quiet.log).toContain("=== tick: nothing to do ===");
      expect(refreshRuns(quiet.runs)).toEqual([]);
      expect(pullCalls(quiet.calls)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a webhook on what the files name, kinboard-webhook:local (built here on purpose): nothing happens", () => {
    // docker-compose.webhook-build.yml names kinboard-webhook:local; `pull --ignore-buildable` skips it on a real stack.
    const r = rig({ stack: OLD, pulled: undefined, registry: {} });
    try {
      const res = r.run([], AS_WEBHOOK);
      expect(res.status, res.out).toBe(0);
      expect(refreshRuns(res.runs)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("on a git checkout that runs compose.yml: the container gets the stack's own flags", () => {
    const NEXT = `${WEBAPP}:next`;
    const stack: Record<string, Service> = {
      init: { ref: NEXT },
      db: { ref: PG },
      "db-init": { ref: NEXT },
      rest: { ref: REST },
      webapp: { ref: NEXT },
      diun: { ref: DIUN },
      webhook: { ref: `${HOOK}:next` },
    };
    const images = { [PG]: "sha256:pg", [REST]: "sha256:rest", [NEXT]: "sha256:web1", [DIUN]: "sha256:diun", [LOCAL]: "sha256:local" };
    const containers = Object.fromEntries(Object.entries(stack).map(([svc, s]) => [svc, { ref: s.ref, id: images[s.ref as keyof typeof images] ?? "" }]));
    containers.webhook = { ref: LOCAL, id: "sha256:local" };
    const r = new Rig({ stack, containers, images, compose: { overlay: true }, registry: { [`${HOOK}:next`]: "sha256:hooknext" } });
    try {
      const res = r.run([], { KINBOARD_SELF_CONTAINER: "cid-webhook-g0", COMPOSE_FILES: "-f docker-compose.yml -f docker-compose.image.yml -f docker-compose.diun.yml" });
      expect(res.status, res.out).toBe(0);
      const runs = refreshRuns(res.runs);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toContain(
        `KB_ARGS=-p kbt --project-directory ${r.proj} --env-file ${join(r.proj, ".env")} -f ${join(r.proj, "compose.yml")} -f ${join(r.proj, "webapp", "docker", "docker-compose.diun.yml")} `,
      );
      expect(runs[0]).toContain("--name kbt-webhook-refresh");
      expect(runs[0]).toContain(`-w ${join(r.proj, "webapp", "docker")} `);
    } finally {
      r.cleanup();
    }
  });

  test("kinboard-updater never starts one: it has no webhook", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const fn = src.slice(src.indexOf("webhook_refresh() {"), src.indexOf("\n}\n", src.indexOf("webhook_refresh() {")));
    expect(fn).toContain('[ -z "$UPDATER" ] && [ "$STACK_MODE" != container ] || return 0');
  });
});

/**
 * The recreating container's script (WEBHOOK_REFRESH_SH), run as the
 * container would: a stub `docker` that records what it is asked and
 * reports the new webhook's state, and the run's real lock file.
 */
const REFRESH_SH = (() => {
  const src = readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("WEBHOOK_REFRESH_SH='\n") + "WEBHOOK_REFRESH_SH='\n".length;
  return src.slice(start, src.indexOf("\n'\n", start));
})();

function refreshRig() {
  const dir = mkdtempSync(join(tmpdir(), "webhook-refresh-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // State: "running|0|<image>" by default; a file `state` overrides it.
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
echo "$(date +%s.%N) docker $*" >> "${dir}/calls"
case "$*" in
  *" ps -q webhook"*) echo cid-new ;;
  "inspect "*) cat "${dir}/state" 2>/dev/null || echo "running|0|sha256:new" ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, "docker"), 0o755);
  const lock = join(dir, "kinboard-update.lock");
  const log = join(dir, "update.log");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    KB_ARGS: "-f docker-compose.yml -f docker-compose.diun.yml",
    KB_LOCK: lock,
    KB_LOG: log,
    KB_WANT: `${HOOK}:latest`,
    KB_WANT_ID: "sha256:new",
    KB_OLD_ID: "sha256:old",
    KB_FROM: `${LOCAL} (sha256:old)`,
    KB_WAIT: "20",
    KB_SETTLE: "0",
  };
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  return { dir, lock, env, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test.describe("the container that recreates the webhook", () => {
  test.skip(spawnSync("sh", ["-c", "command -v flock && command -v timeout"]).status !== 0, "needs flock and timeout");

  test("waits for the run's lock, then recreates only the webhook, without building or pulling", async () => {
    const r = refreshRig();
    try {
      // The update run: holds the lock for 1.5 s, then records when it let go.
      const holder = spawn("sh", ["-c", `exec 9>"${r.lock}"; flock 9; echo held > "${r.dir}/held"; sleep 1.5; date +%s.%N > "${r.dir}/released"`]);
      for (let i = 0; i < 50 && !existsSync(join(r.dir, "held")); i++) await new Promise((res) => setTimeout(res, 20));
      const res = spawnSync("sh", ["-c", REFRESH_SH], { env: r.env, encoding: "utf8", timeout: 30_000 });
      await new Promise((res) => holder.on("exit", res));
      expect(res.status, r.read("update.log")).toBe(0);
      const calls = r.read("calls").split("\n").filter(Boolean);
      const up = calls.find((c) => c.includes(" up "));
      expect(up).toContain("docker compose -f docker-compose.yml -f docker-compose.diun.yml up -d --no-deps --no-build --pull never --force-recreate webhook");
      // Not one call before the run let go.
      expect(Number(calls[0].split(" ")[0])).toBeGreaterThanOrEqual(Number(r.read("released").trim()));
      expect(calls.some((c) => / (build|pull|tag) /.test(c))).toBe(false);
      expect(r.read("update.log")).toContain(`done: the webhook runs ${HOOK}:latest`);
    } finally {
      r.cleanup();
    }
  });

  test("a new webhook that doesn't stay up: the image it ran before goes back under the reference", () => {
    const r = refreshRig();
    writeFileSync(join(r.dir, "state"), "restarting|3|sha256:new\n");
    try {
      const res = spawnSync("sh", ["-c", REFRESH_SH], { env: r.env, encoding: "utf8", timeout: 30_000 });
      expect(res.status).toBe(1);
      const calls = r.read("calls").split("\n").filter(Boolean).map((c) => c.replace(/^\S+ /, ""));
      expect(calls.filter((c) => c.includes(" up "))).toHaveLength(2);
      const tag = calls.indexOf(`docker tag sha256:old ${HOOK}:latest`);
      const ups = calls.map((c, i) => (c.includes(" up ") ? i : -1)).filter((i) => i >= 0);
      expect(tag).toBeGreaterThan(ups[0]);
      expect(tag).toBeLessThan(ups[1]);
      expect(r.read("update.log")).toContain("did not stay up; going back to the image it ran before (sha256:old)");
    } finally {
      r.cleanup();
    }
  });

  test("a run that never lets go: nothing is touched once the wait is over", async () => {
    const r = refreshRig();
    try {
      const holder = spawn("sh", ["-c", `exec 9>"${r.lock}"; flock 9; echo held > "${r.dir}/held"; sleep 5`]);
      for (let i = 0; i < 50 && !existsSync(join(r.dir, "held")); i++) await new Promise((res) => setTimeout(res, 20));
      const res = spawnSync("sh", ["-c", REFRESH_SH], { env: { ...r.env, KB_WAIT: "1" }, encoding: "utf8", timeout: 30_000 });
      holder.kill();
      expect(res.status).toBe(1);
      expect(r.read("calls")).toBe("");
      expect(r.read("update.log")).toContain("still held its lock after 1s; the webhook was not recreated");
    } finally {
      r.cleanup();
    }
  });
});

/**
 * The run's own lock, with the flock the webhook image has: busybox's, which
 * has no -w. A Diun run that found a tick holding the lock was meant to wait
 * for it; with `flock -w` it failed at once ("unrecognized option"), logged
 * "another self-update is running" and dropped the release's git pull and
 * setup.sh. The script's lock block runs here, as it is, inside alpine:3.20
 * (the image's base), while another process holds the lock as a tick.
 */
test.describe("the run's lock inside the webhook image (busybox flock)", () => {
  test.skip(spawnSync("docker", ["image", "inspect", "alpine:3.20"]).status !== 0, "needs docker and alpine:3.20");

  const lockBlock = (() => {
    const src = readFileSync(SCRIPT, "utf8");
    const start = src.indexOf('TICK_MARKER="$GIT_DIR_ABS/kinboard-update.tick"');
    const warn = src.indexOf('log "WARN: no flock here', start);
    return src.slice(start, src.indexOf("\nfi\n", warn) + 4);
  })();

  /** A tick holds the lock for `holdS` seconds; a Diun run waits up to `waitS`. */
  const race = (holdS: number, waitS: number) => {
    const dir = mkdtempSync(join(tmpdir(), "lock-busybox-"));
    try {
      writeFileSync(join(dir, "block.sh"), lockBlock);
      const sh = `set -eu
GIT_DIR_ABS=/w; MODE=update; KINBOARD_LOCK_WAIT=${waitS}
log() { echo "LOG $*"; }
( exec 9>/w/kinboard-update.lock; flock 9; touch /w/held; sleep ${holdS} ) &
while [ ! -f /w/held ]; do sleep 0.1; done
echo 1 > /w/kinboard-update.tick
t0=$(date +%s)
trap 'echo "ELAPSED $(( $(date +%s) - t0 ))s"' EXIT
. /w/block.sh
echo "GOT-LOCK after $(( $(date +%s) - t0 ))s"
`;
      const r = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${dir}:/w`, "alpine:3.20", "sh", "-c", sh], { encoding: "utf8", timeout: 60_000 });
      return r.stdout + r.stderr;
    } finally {
      spawnSync("docker", ["run", "--rm", "-v", `${dir}:/w`, "alpine:3.20", "rm", "-rf", "/w/held", "/w/kinboard-update.lock", "/w/kinboard-update.tick", "/w/block.sh"]);
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a Diun run that meets a tick waits for it, then runs", () => {
    const out = race(2, 20);
    expect(out).toContain("LOG a reconciliation tick is running; waiting for it to finish");
    expect(out).not.toContain("another self-update is running");
    expect(out).toMatch(/GOT-LOCK after [1-9]\d*s/);
  });

  test("a tick that outlasts KINBOARD_LOCK_WAIT: the run gives up, after waiting that long", () => {
    const out = race(8, 2);
    expect(out).toContain("LOG another self-update is running; leaving it to finish");
    expect(out).not.toContain("GOT-LOCK");
    // It waited its 2 s first; busybox's flock refusing -w gave up at once.
    expect(Number(/ELAPSED (\d+)s/.exec(out)?.[1] ?? -1), out).toBeGreaterThanOrEqual(2);
  });
});
