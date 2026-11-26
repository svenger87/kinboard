import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { Rig, type Scenario, type Service } from "./helpers/self-update-stub";

/**
 * RFC-023 §4.11.4 and §4.11.5, on the self-update git installs run today.
 *
 * Until this, a release that did not start stayed down: the script recreated
 * the webapp, logged "done" and left. And a KINBOARD_TAG put back to `next`
 * in .env after a deploy pinned to a sha-… tag changed nothing, because Diun
 * watches the tag the container runs, which never moves (the maintainer's
 * own install, 2026-11-26).
 *
 * Now every recreated service is waited for; one that does not come up goes
 * back to the exact image id it ran before, that version is held back until a
 * newer one appears, and a status record tells Settings. And a tick every 30
 * minutes brings what runs in line with what .env names, after a first tick
 * that only records a baseline.
 *
 * Same harness as self-update-recreates-only-changes.spec.ts: the whole
 * script, a real git checkout, a stub docker (helpers/self-update-stub.ts).
 */

const WEBAPP = "ghcr.io/svenger87/kinboard";
const NEXT = `${WEBAPP}:next`;
const PINNED = `${WEBAPP}:sha-abc1234`;

const STACK: Record<string, Service> = {
  db: { ref: "supabase/postgres:15.14.1.159" },
  webapp: { ref: NEXT },
  cron: { ref: "mcuadros/ofelia@sha256:efcb" },
};
const IMAGES: Record<string, string> = {
  "supabase/postgres:15.14.1.159": "sha256:pg",
  [NEXT]: "sha256:web1",
  "mcuadros/ofelia@sha256:efcb": "sha256:ofelia",
};
const RUNNING = Object.fromEntries(Object.entries(STACK).map(([svc, s]) => [svc, { ref: s.ref, id: IMAGES[s.ref] }]));
const BASELINE = "baseline 2026-11-01T00:00:00Z\n";

function rig(sc: Partial<Scenario> = {}) {
  const r = new Rig({ stack: STACK, containers: RUNNING, images: IMAGES, ...sc });
  r.setVersion("sha256:web1", "1.17.0");
  r.setVersion("sha256:web2", "1.18.0");
  r.setVersion("sha256:web3", "1.18.1");
  return r;
}

/** A broken release: the entrypoint exits, Docker restarts it, again and again. */
const BROKEN = { status: "restarting", restarts: 3, code: 1 };

const ups = (calls: string[]) => calls.filter((c) => / compose .* up /.test(c));
const dumped = (calls: string[]) => calls.some((c) => c.includes("pg_dumpall"));

test.describe("health wait and rollback", () => {
  test("a healthy update: recreated, waited for, recorded for Settings", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["cron", "webapp"]);
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web2" });
      expect(res.out).toContain("healthy: webapp");
      expect(res.tags, "nothing is rolled back").toEqual([]);
      expect(res.record).toMatchObject({ status: "updated", from: "1.17.0", to: "1.18.0", services: "webapp", severe: false });
      expect(res.record!.backup).toMatch(/^pre-upgrade-\d{8}-\d{6}\.sql\.gz$/);
    } finally {
      r.cleanup();
    }
  });

  test("the image ids are recorded before anything is recreated", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      const res = r.run();
      expect(res.state).toContain(`previous webapp sha256:web1 ${NEXT}`);
      const recorded = res.log.indexOf("before recreating: webapp runs sha256:web1");
      const recreate = res.log.indexOf("--force-recreate webapp");
      expect(recorded, res.log).toBeGreaterThan(-1);
      expect(recorded).toBeLessThan(recreate);
    } finally {
      r.cleanup();
    }
  });

  test("an update that does not start goes back to the exact image it replaced", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setHealth("sha256:web2", BROKEN);
    r.setLogs("webapp", "[entrypoint] waiting for postgres\nboom\n");
    try {
      const res = r.run();
      expect(res.status, "a rollback is not a success").toBe(1);
      expect(r.container("webapp"), "the previous image id, under the same reference").toEqual({ ref: NEXT, id: "sha256:web1" });
      expect(res.tags).toEqual([`sha256:web1 ${NEXT}`]);
      const rollbackUp = ups(res.calls).at(-2); // the last is cron, after the webapp
      expect(rollbackUp).toContain("--pull never");
      expect(rollbackUp).toMatch(/--force-recreate webapp$/);
      expect(res.state).toMatch(new RegExp(`^held sha256:web2 ${NEXT} `, "m"));
      expect(res.out).toContain("webapp: restarted 3 times");
      expect(res.out).toContain("ROLLED BACK");
      expect(res.record).toMatchObject({ status: "rolled_back", from: "1.17.0", to: "1.18.0", migration: "", severe: false });
      expect(String(res.record!.log)).toContain("boom");
      expect(res.record!.backup, "the backup from before the update is named").toMatch(/^pre-upgrade-/);
      expect(res.recreated, "the scheduler follows the webapp back").toContain("cron");
    } finally {
      r.cleanup();
    }
  });

  test("an update still not healthy at the limit is rolled back too", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setHealth("sha256:web2", { status: "running", health: "starting" });
    try {
      const res = r.run([], { KINBOARD_HEALTH_TIMEOUT: "1" });
      expect(res.status).toBe(1);
      expect(res.out).toContain("webapp: not healthy after 1s");
      expect(r.container("webapp")!.id).toBe("sha256:web1");
    } finally {
      r.cleanup();
    }
  });

  test("healthy but missing what its code needs (a renamed column): the smoke check fails it, and it is rolled back", () => {
    // What the rehearsal for #542 found: health stayed healthy and 200, a write through /rest/v1 failed.
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setSmoke("sha256:web2", 503, '{"deep":{"ok":false,"missing":["todos.title"],"write":false}}');
    try {
      const res = r.run([], { KINBOARD_SMOKE_TIMEOUT: "1" });
      expect(res.status).toBe(1);
      expect(res.out).toContain("webapp: the smoke check failed (HTTP 503)");
      expect(res.out).toContain("todos.title");
      expect(r.container("webapp")!.id).toBe("sha256:web1");
      expect(res.state).toMatch(/^held sha256:web2 /m);
      expect(res.record).toMatchObject({ status: "rolled_back", to: "1.18.0" });
    } finally {
      r.cleanup();
    }
  });

  test("a smoke check that gets no answer at all fails, and is rolled back", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setSmoke("sha256:web2", 0, "");
    try {
      const res = r.run([], { KINBOARD_SMOKE_TIMEOUT: "1" });
      expect(res.status).toBe(1);
      expect(res.out).toContain("webapp: the smoke check failed");
      expect(r.container("webapp")!.id).toBe("sha256:web1");
    } finally {
      r.cleanup();
    }
  });

  test("a smoke check refused for want of CRON_SECRET passes with a warning, never rolls every release back", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setSmoke("sha256:web2", 401, '{"error":"unauthorized"}');
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain("WARN: smoke check refused (HTTP 401");
      expect(r.container("webapp")!.id).toBe("sha256:web2");
    } finally {
      r.cleanup();
    }
  });

  test("a log excerpt with carriage returns and backslashes still makes a record Settings can read", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setHealth("sha256:web2", BROKEN);
    r.setLogs("webapp", 'progress\r50%\r100%\nC:\\path "quoted"\t\u001b[31mred\u001b[0m\n');
    try {
      const res = r.run();
      expect(res.record, "the stub parses what the script wrote").not.toBeNull();
      expect(String(res.record!.log)).toContain('C:\\path "quoted"');
    } finally {
      r.cleanup();
    }
  });

  test("an image without the deep check is judged by its health check alone", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setSmoke("sha256:web2", 200, '{"status":"ok","db":true}');
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain("has no deep health check");
      expect(r.container("webapp")!.id).toBe("sha256:web2");
    } finally {
      r.cleanup();
    }
  });

  test("a migration that failed partway: rolled back, named, and marked severe", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" } });
    r.setHealth("sha256:web2", { status: "exited", code: 1 });
    r.setLogs("webapp", "[migrate] applying 094_tags.sql\n[migrate] FAILED: 094_tags.sql\n[entrypoint] GIVING UP after 6 attempts\n");
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(r.container("webapp")!.id).toBe("sha256:web1");
      expect(res.record).toMatchObject({ status: "rolled_back", migration: "094_tags.sql", severe: true });
      expect(res.out).toContain(
        "rolled back after migration 094_tags.sql failed; the database may hold part of it; the older version runs on it because migrations are additive",
      );
    } finally {
      r.cleanup();
    }
  });

  test("a rolled-back version is not retried until a newer one appears", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" }, stateFile: BASELINE });
    r.setHealth("sha256:web2", BROKEN);
    try {
      expect(r.run().status).toBe(1);

      // Diun fires again, twice: the same broken image is on the registry.
      for (let i = 0; i < 2; i++) {
        const again = r.run();
        expect(again.status, again.out).toBe(0);
        expect(again.recreated).toEqual([]);
        expect(again.out).toContain("held webapp (image)");
        expect(dumped(again.calls), "nothing will change, so no backup").toBe(false);
        expect(r.container("webapp")!.id).toBe("sha256:web1");
        expect(r.imageOnDisk(NEXT), "the tag points at what runs, not at the held image").toBe("sha256:web1");
      }
      // And the tick leaves it alone too: the reference is the one .env names.
      expect(r.run(["--tick"]).out).toContain("=== tick: nothing to do ===");

      // A newer image under the same tag is applied, and the hold goes.
      r.setRegistry({ [NEXT]: "sha256:web3" });
      const newer = r.run();
      expect(newer.status, newer.out).toBe(0);
      expect(newer.recreated).toEqual(["cron", "webapp"]);
      expect(r.container("webapp")!.id).toBe("sha256:web3");
      expect(newer.state).not.toMatch(/^held /m);
      expect(newer.record).toMatchObject({ status: "updated", to: "1.18.1" });
    } finally {
      r.cleanup();
    }
  });

  test("\"Try again now\" in Settings releases a held version", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" }, stateFile: BASELINE });
    r.setHealth("sha256:web2", BROKEN);
    try {
      expect(r.run().status).toBe(1);
      r.setHealth("sha256:web2", { status: "running", health: "healthy" }); // it was the household's disk, say
      r.requestRetry();
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain('"Try again" was pressed in Settings');
      expect(res.recreated).toContain("webapp");
      expect(r.container("webapp")!.id).toBe("sha256:web2");
    } finally {
      r.cleanup();
    }
  });
});

test.describe("no network", () => {
  test("a tick that cannot reach the registry touches nothing, and backs off", () => {
    // .env names next; the container still runs a pinned sha: the tick has something to pull.
    const r = rig({
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      registry: { [NEXT]: "sha256:web2" },
      stateFile: BASELINE,
    });
    r.setOffline(true);
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(ups(res.calls)).toEqual([]);
      expect(dumped(res.calls), "no backup").toBe(false);
      expect(res.tags).toEqual([]);
      expect(r.container("webapp")).toEqual({ ref: PINNED, id: "sha256:web1" });
      expect(res.out).toContain("tick skipped: the pull failed");
      expect(res.out).toContain("nothing was changed");
      expect(res.state).toMatch(/^failures 1$/m);

      // The first wait is one interval (a minute short, so the jittered tick that
      // lands on it runs); a second failure in a row doubles it.
      const until1 = Number(/^backoff_until (\d+)$/m.exec(res.state)![1]);
      expect(until1 - Date.now() / 1000).toBeGreaterThan(1700);
      expect(until1 - Date.now() / 1000).toBeLessThan(1800);

      const waiting = r.run(["--tick"]);
      expect(waiting.out).toContain("backing off");
      expect(waiting.calls.filter((c) => c.includes(" pull")), "a tick inside the back-off does not even pull").toEqual([]);

      // Time passes; it fails again: twice as long.
      writeFileSync(r.statePath, res.state.replace(/^backoff_until .*$/m, "backoff_until 0"));
      const second = r.run(["--tick"]);
      expect(second.state).toMatch(/^failures 2$/m);
      const until2 = Number(/^backoff_until (\d+)$/m.exec(second.state)![1]);
      expect(until2 - Date.now() / 1000).toBeGreaterThan(3500);

      // The network is back: the update goes through, and the back-off is cleared.
      r.setOffline(false);
      writeFileSync(r.statePath, second.state.replace(/^backoff_until .*$/m, "backoff_until 0"));
      const back = r.run(["--tick"]);
      expect(back.status, back.out).toBe(0);
      expect(back.recreated).toContain("webapp");
      expect(back.state).not.toMatch(/^(failures|backoff_until) /m);
    } finally {
      r.cleanup();
    }
  });

  test("a rate-limited registry is named in the log", () => {
    const r = rig({
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      stateFile: BASELINE,
    });
    r.setOffline(true, "ratelimit");
    try {
      const res = r.run(["--tick"]);
      expect(res.out).toContain("the registry is rate-limiting");
      expect(ups(res.calls)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a Diun run whose git fetch or pull fails touches nothing", () => {
    const fetchFails = rig({ registry: { [NEXT]: "sha256:web2" } });
    try {
      fetchFails.removeOrigin();
      const res = fetchFails.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("git fetch failed");
      expect(ups(res.calls)).toEqual([]);
      expect(dumped(res.calls)).toBe(false);
    } finally {
      fetchFails.cleanup();
    }
    const pullFails = rig({ registry: { [NEXT]: "sha256:web2" } });
    pullFails.setOffline(true);
    try {
      const res = pullFails.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("the pull failed");
      expect(ups(res.calls)).toEqual([]);
      expect(dumped(res.calls)).toBe(false);
      expect(pullFails.container("webapp")!.id).toBe("sha256:web1");
    } finally {
      pullFails.cleanup();
    }
  });
});

test.describe("the reconciliation tick", () => {
  test("the first tick only records a baseline: no pull, no backup, no recreate", () => {
    // .env says next, the container still runs a pinned sha, and next has moved:
    // everything a later tick would act on.
    const r = rig({
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      registry: { [NEXT]: "sha256:web2" },
    });
    try {
      const first = r.run(["--tick"]);
      expect(first.status, first.out).toBe(0);
      expect(first.pulls).toBe(0);
      expect(first.calls.filter((c) => c.includes(" pull"))).toEqual([]);
      expect(ups(first.calls)).toEqual([]);
      expect(dumped(first.calls)).toBe(false);
      expect(first.state).toMatch(/^baseline \d{4}-\d\d-\d\dT/m);
      expect(first.out).toContain(`webapp: the compose files and .env name ${NEXT}; the next tick applies it`);
      expect(r.container("webapp")).toEqual({ ref: PINNED, id: "sha256:web1" });

      const second = r.run(["--tick"]);
      expect(second.status, second.out).toBe(0);
      expect(second.recreated).toContain("webapp");
    } finally {
      r.cleanup();
    }
  });

  test("a pinned tag never moves, over three ticks", () => {
    const pinned = { ...STACK, webapp: { ref: PINNED } };
    const r = rig({
      stack: pinned,
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      // Every channel has moved on; the pinned tag has not, because it never does.
      registry: { [PINNED]: "sha256:web1", [NEXT]: "sha256:web2", [`${WEBAPP}:latest`]: "sha256:web3" },
      stateFile: BASELINE,
    });
    try {
      for (let i = 0; i < 3; i++) {
        const res = r.run(["--tick"]);
        expect(res.status, res.out).toBe(0);
        expect(res.recreated).toEqual([]);
        expect(dumped(res.calls)).toBe(false);
        expect(res.out).toContain("=== tick: nothing to do ===");
        expect(r.container("webapp")).toEqual({ ref: PINNED, id: "sha256:web1" });
      }
    } finally {
      r.cleanup();
    }
  });

  test("a tag changed in .env is picked up by the tick, not left for Diun", () => {
    const r = rig({
      stack: { ...STACK, webapp: { ref: PINNED } },
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      registry: { [PINNED]: "sha256:web1", [NEXT]: "sha256:web2" },
      stateFile: BASELINE,
    });
    try {
      expect(r.run(["--tick"]).recreated).toEqual([]);

      r.setStack(STACK); // KINBOARD_TAG=next again, by hand
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain("recreate webapp (image-reference)");
      expect(res.recreated).toEqual(["cron", "webapp"]);
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web2" });
      expect(dumped(res.calls), "backed up first, as any update").toBe(true);
      expect(
        res.calls.filter((c) => c.includes("--no-recreate")),
        "a tick starts nothing that is stopped and removes no orphan",
      ).toEqual([]);
      expect(res.record).toMatchObject({ status: "updated", from: "1.17.0", to: "1.18.0" });

      const after = r.run(["--tick"]);
      expect(after.recreated).toEqual([]);
      expect(after.out).toContain("nothing to do");
    } finally {
      r.cleanup();
    }
  });

  test("a newer image under the same tag is left to Diun: the tick does not even ask the registry", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" }, stateFile: BASELINE });
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain("=== tick: nothing to do ===");
      expect(res.calls.filter((c) => c.includes(" pull")), "no pull").toEqual([]);
      expect(r.container("webapp")!.id).toBe("sha256:web1");
    } finally {
      r.cleanup();
    }
  });

  test("a service someone stopped stays stopped, whatever .env names", () => {
    const r = rig({
      stack: { ...STACK, cron: { ref: "mcuadros/ofelia@sha256:f00d" } },
      images: { ...IMAGES, "mcuadros/ofelia@sha256:f00d": "sha256:ofelia2" },
      stateFile: BASELINE,
    });
    r.setHealth("sha256:ofelia", { status: "exited", code: 0, policy: "unless-stopped" });
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.out).toContain("=== tick: nothing to do ===");
    } finally {
      r.cleanup();
    }
  });

  test("KINBOARD_UPDATE_TICK=off in .env stops the tick, read at every tick", () => {
    const r = rig({
      containers: { ...RUNNING, webapp: { ref: PINNED, id: "sha256:web1" } },
      images: { ...IMAGES, [PINNED]: "sha256:web1" },
      registry: { [NEXT]: "sha256:web2" },
      stateFile: BASELINE,
    });
    r.addEnv("KINBOARD_UPDATE_TICK=off");
    try {
      const res = r.run(["--tick"]);
      expect(res.out).toContain("switched off");
      expect(res.calls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a Diun run that finds a tick running waits for it instead of giving up", () => {
    const r = rig({ registry: { [NEXT]: "sha256:web2" }, tickRunning: true });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain("a reconciliation tick is running; waiting for it to finish");
      expect(res.out).not.toContain("=== self-update skipped ===");
      expect(res.recreated).toContain("webapp");
    } finally {
      r.cleanup();
    }
  });

  test("a tick does no git pull and runs no setup.sh", () => {
    const r = rig({ pulled: { ...STACK, db: { ref: "supabase/postgres:15.14.1.160" } }, stateFile: BASELINE });
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.out).not.toContain("git fetch");
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});
