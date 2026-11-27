import { test, expect } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rig, type Scenario, type Service } from "./helpers/self-update-stub";

/**
 * RFC-023 PR 12 (§4.11.3): kinboard-updater, compose.yml's `updater` service
 * under the `autoupdate` profile, keeps a one-file install (no git checkout)
 * up to date with images only.
 *
 * Until this, a folder without git got "this install has no git checkout;
 * update it with Pull and Up" and nothing else (#558): the owner's rule that
 * automatic updates work on every install shape was not met there.
 *
 * The whole kinboard-self-update.sh runs with KINBOARD_UPDATER=1 on the stub
 * harness (helpers/self-update-stub.ts), with a stub registry behind `curl`.
 */

const KB = "ghcr.io/svenger87/kinboard";
const NEXT = `${KB}:next`;
const PINNED = `${KB}:1.18.0`;
const PG = "supabase/postgres:15.14.1.159";
const REST = "postgrest/postgrest:v14.16";
const GO = "alexxit/go2rtc:1.9.14";
const UPD = "ghcr.io/svenger87/kinboard-updater:next";

const D1 = `sha256:${"1".repeat(64)}`;
const D2 = `sha256:${"2".repeat(64)}`;
const D3 = `sha256:${"3".repeat(64)}`;

const stackFor = (ref: string): Record<string, Service> => ({
  init: { ref },
  db: { ref: PG },
  "db-init": { ref },
  rest: { ref: REST },
  webapp: { ref },
  go2rtc: { ref: GO },
});
const running = (stack: Record<string, Service>, kbId = "sha256:web1") =>
  Object.fromEntries(
    Object.entries(stack).map(([svc, s]) => [
      svc,
      { ref: s.ref, id: s.ref.startsWith(KB + ":") || s.ref.startsWith(KB + "@") ? kbId : s.ref === UPD ? "sha256:upd1" : `sha256:${svc}` },
    ]),
  );

/** A one-file stack on `next`, running web1 (pulled as D1), the registry serving D1, file and image at revision 1. */
function rig(sc: Partial<Scenario> = {}, ref = NEXT) {
  const stack = stackFor(ref);
  const r = new Rig({
    updater: true,
    stack,
    containers: running(stack),
    images: { [ref]: "sha256:web1", [PG]: "sha256:db", [REST]: "sha256:rest", [GO]: "sha256:go2rtc" },
    registry: { [ref]: "sha256:web1" },
    ...sc,
  });
  r.setVersion("sha256:web1", "1.18.0");
  r.setVersion("sha256:web2", "1.18.1");
  r.setVersion("sha256:web3", "1.18.2");
  r.setDigests("sha256:web1", [`${KB}@${D1}`]);
  r.setDigests("sha256:web2", [`${KB}@${D2}`]);
  r.setDigests("sha256:web3", [`${KB}@${D3}`]);
  for (const id of ["sha256:web1", "sha256:web2", "sha256:web3"]) r.setImageRevision(id, "1");
  r.setFileRevision("1");
  r.setRemote(ref, D1);
  return r;
}

/** A first tick, so that the next one acts. */
function baseline(r: Rig) {
  const res = r.run(["--tick"]);
  expect(res.status, res.out).toBe(0);
  expect(res.log).toContain("baseline recorded");
  return res;
}

/** The registry now serves web2 under `next`. */
function publish(r: Rig, id = "sha256:web2", digest = D2, ref = NEXT) {
  r.setRegistry({ [ref]: id });
  r.setRemote(ref, digest);
}

const heads = (curls: string[]) => curls.filter((c) => c.includes(" -I "));
const BROKEN = { status: "restarting", restarts: 3, code: 1 };

test.describe("kinboard-updater: image-only updates of a one-file install", () => {
  test("the first tick only records a baseline: no registry, no pull, no backup, no recreate", () => {
    const r = rig();
    publish(r); // a newer image is already out: still nothing on the first look
    try {
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.curls, "not even a HEAD").toEqual([]);
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(res.log).toContain("=== tick: first run, baseline recorded; nothing pulled or recreated ===");
      expect(res.log).toContain(`tick baseline: webapp: ${NEXT} is watched in the registry from the next tick`);
      expect(res.log).toContain(`tick baseline: db: ${PG} moves only with the compose file`);
      expect(res.state).toMatch(/^baseline /m);
    } finally {
      r.cleanup();
    }
  });

  test("state, lock and log live in the config volume's updater/ folder; there is no git anywhere", () => {
    const r = rig();
    try {
      baseline(r);
      expect(existsSync(join(r.proj, ".git")), "the folder has no checkout").toBe(false);
      expect(readFileSync(join(r.updaterDir, "state"), "utf8")).toMatch(/^baseline /m);
      expect(existsSync(join(r.updaterDir, "kinboard-update.lock")), "the lock").toBe(true);
      expect(readFileSync(join(r.updaterDir, "update.log"), "utf8")).toContain("=== tick ===");
      const res = r.run(["--tick"]);
      expect(res.calls.some((c) => /\bgit\b/.test(c))).toBe(false);
      expect(res.log).not.toContain("no git checkout");
    } finally {
      r.cleanup();
    }
  });

  test("nothing new: one HEAD for the Kinboard image (shared by init, db-init and the webapp), no pull", () => {
    const r = rig();
    try {
      baseline(r);
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(heads(res.curls)).toHaveLength(1);
      expect(heads(res.curls)[0]).toContain("https://ghcr.io/v2/svenger87/kinboard/manifests/next");
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.log).toContain("=== tick: nothing to do ===");
    } finally {
      r.cleanup();
    }
  });

  test("a newer digest: verified backup (database, files, config), only the Kinboard services recreated, healthy, recorded; the next tick does nothing", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain(`tick: webapp runs ${NEXT}, and the registry has a newer image under it (${D2})`);
      expect(res.pulls).toBe(1);
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
      for (const svc of ["db", "rest", "go2rtc"]) expect(r.container(svc)?.id, svc).toBe(`sha256:${svc}`);
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web2" });
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(true);
      expect(res.runs).toContain("-v kinboard-storage:/data/storage:ro");
      expect(res.runs).toContain("-v kinboard-config:/config:ro");
      expect(res.log).toMatch(/backup: pre-upgrade-\d{8}-\d{6}-config\.tar\.gz/);
      expect(res.out).toContain("healthy: init db-init webapp");
      expect(res.out).toContain("smoke check passed");
      expect(res.record).toMatchObject({ status: "updated", from: "1.18.0", to: "1.18.1" });
      expect(String(res.record?.log_file)).toBe("updater/update.log in the Docker volume kinboard-config (also: docker logs kinboard-updater)");

      const again = r.run(["--tick"]);
      expect(again.status, again.out).toBe(0);
      expect(again.pulls).toBe(0);
      expect(again.recreated).toEqual([]);
      expect(again.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(again.log).toContain("=== tick: nothing to do ===");
    } finally {
      r.cleanup();
    }
  });

  test("a config folder on the host: the record names the log there", () => {
    const r = rig();
    try {
      r.setConfig({ mount: { svc: "webapp", source: "/srv/kinboard/config" } });
      baseline(r);
      publish(r);
      const res = r.run(["--tick"]);
      expect(res.record?.log_file).toBe("/srv/kinboard/config/updater/update.log");
    } finally {
      r.cleanup();
    }
  });

  test("a registry that wants a token gets one from its realm, without credentials", () => {
    const r = rig();
    try {
      baseline(r);
      r.setRemoteAuth(true);
      publish(r);
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      // The token request: its URL parsed, origin and path compared exactly.
      const tokenRequests = res.curls.map((c) => c.split(" ")).filter((args) => args.includes("-G"));
      expect(tokenRequests).toHaveLength(1);
      const realm = tokenRequests[0].filter((a) => /^https?:\/\//.test(a)).map((a) => new URL(a));
      expect(realm.map((u) => `${u.origin}${u.pathname}`)).toEqual(["https://auth.example/token"]);
      expect(tokenRequests[0]).toContain("scope=repository:x:pull");
      expect(res.curls.some((c) => c.includes("Authorization: Bearer stub-token"))).toBe(true);
      expect(res.curls.join("\n"), "no credentials of any kind").not.toMatch(/-u |--user|Basic /);
      expect(r.container("webapp")?.id).toBe("sha256:web2");
    } finally {
      r.cleanup();
    }
  });

  test("its own service (here in the stack, as with COMPOSE_PROFILES=autoupdate in .env) is never pulled or recreated", () => {
    const stack = { ...stackFor(NEXT), updater: { ref: UPD } };
    const r = rig({ stack, containers: running(stack) });
    try {
      baseline(r);
      publish(r);
      // its reference changed in the file too: still not its to apply
      r.setStack({ ...stack, updater: { ref: "ghcr.io/svenger87/kinboard-updater:latest" } });
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.recreated).toEqual(["db-init", "init", "webapp"]);
      expect(r.container("updater")).toEqual({ ref: UPD, id: "sha256:upd1" });
      expect(res.log).not.toMatch(/tick: updater runs/);
    } finally {
      r.cleanup();
    }
  });
});

test.describe("kinboard-updater: rollback and holds", () => {
  test("a broken release is rolled back; its digest is then held without pulling, and a newer one is applied", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setHealth("sha256:web2", BROKEN);
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("ROLLED BACK");
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web1" });
      expect(res.tags).toContain(`sha256:web1 ${NEXT}`);
      expect(res.record).toMatchObject({ status: "rolled_back", from: "1.18.0", to: "1.18.1" });
      // the hold carries the registry digest, so the next tick knows it without a pull
      const holds = res.state.split("\n").map((l) => l.split(" ")).filter((f) => f[0] === "held");
      expect(holds).toHaveLength(1);
      expect([holds[0][1], holds[0][2], holds[0][4], holds[0].length]).toEqual(["sha256:web2", NEXT, D2, 5]);

      const held = r.run(["--tick"]);
      expect(held.status, held.out).toBe(0);
      expect(held.pulls, "not pulled again").toBe(0);
      expect(held.recreated).toEqual([]);
      expect(held.log).toContain(`held webapp: the registry's ${NEXT} (${D2}) was rolled back before`);

      publish(r, "sha256:web3", D3);
      const newer = r.run(["--tick"]);
      expect(newer.status, newer.out).toBe(0);
      expect(r.container("webapp")?.id).toBe("sha256:web3");
      expect(newer.state, "the hold goes once a newer image is healthy").not.toMatch(/^held /m);
    } finally {
      r.cleanup();
    }
  });

  test("Try again in Settings releases a held digest", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setHealth("sha256:web2", BROKEN);
      r.run(["--tick"]);
      r.setHealth("sha256:web2", { status: "running", health: "healthy" });
      r.requestRetry();
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain('"Try again" was pressed in Settings');
      expect(r.container("webapp")?.id).toBe("sha256:web2");
    } finally {
      r.cleanup();
    }
  });

  test("a release that needs a newer compose file is held: no backup, no recreate, the tag back on what runs, Settings told once", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setImageRevision("sha256:web2", "2");
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.pulls).toBe(1);
      expect(res.recreated).toEqual([]);
      expect(res.calls.some((c) => c.includes("pg_dumpall")), "no backup").toBe(false);
      expect(res.tags).toEqual([`sha256:web1 ${NEXT}`]);
      expect(r.imageOnDisk(NEXT), "a hand-run `up` starts what runs, not the held release").toBe("sha256:web1");
      expect(res.log).toContain("held: Kinboard 1.18.1 (sha256:web2) is not applied: it needs compose file revision 2; this file declares 1");
      expect(res.log).toContain("=== tick: held for a newer compose file; nothing was changed ===");
      expect(res.record).toMatchObject({ status: "held_compose", from: "1.18.0", to: "1.18.1", file_revision: "1", needed_revision: "2" });
      expect(res.recordKey, "its own key: a rollback notice still showing stays").toBe("update_hold");
      expect(res.state).toContain(`compose_hold ${D2}|1|2|1.18.1|${NEXT}`);

      const again = r.run(["--tick"]);
      expect(again.status, again.out).toBe(0);
      expect(again.pulls, "the same digest is not pulled again").toBe(0);
      expect(again.record, "Settings is told once, not at every tick").toBeNull();
      expect(again.log).toContain(`held webapp: ${NEXT} (${D2}) needs a newer compose file than this one (revision 1)`);

      // The household replaced the file (revision 2) but did not start it yet: now it fits.
      r.setFileRevision("2");
      const fits = r.run(["--tick"]);
      expect(fits.status, fits.out).toBe(0);
      expect(fits.pulls).toBe(1);
      expect(r.container("webapp")?.id).toBe("sha256:web2");
      expect(fits.state).not.toContain("compose_hold");
      expect(fits.calls.some((c) => c.includes("DELETE FROM public.instance_settings WHERE key = 'update_hold'")), "the notice goes").toBe(true);
    } finally {
      r.cleanup();
    }
  });

  test("a tag changed to a pinned release that needs a newer file: held at every tick, Settings told once", () => {
    const r = rig({}, NEXT);
    try {
      baseline(r);
      const pin = `${KB}:1.19.0`;
      r.setStack(stackFor(pin));
      r.setRegistry({ [pin]: "sha256:web2" });
      r.setImageRevision("sha256:web2", "2");
      const first = r.run(["--tick"]);
      expect(first.recreated).toEqual([]);
      expect(first.record).toMatchObject({ status: "held_compose", needed_revision: "2" });
      expect(first.tags, "the new tag never named the running image: it is not pointed at it").toEqual([]);
      expect(r.imageOnDisk(pin)).toBe("sha256:web2");
      // A pin names one image for good: held by its name, not pulled again, Settings not told again.
      const second = r.run(["--tick"]);
      expect(second.recreated).toEqual([]);
      expect(second.pulls).toBe(0);
      expect(second.log).toContain(`held webapp: ${pin} (${pin}) needs a newer compose file`);
      expect(second.record, "a dismissed notice must not come back at every tick").toBeNull();
    } finally {
      r.cleanup();
    }
  });

  test("a newer file than the release is held too: only an equal revision is applied", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setFileRevision("3");
      const res = r.run(["--tick"]);
      expect(res.recreated).toEqual([]);
      expect(res.log).toContain("it needs compose file revision 1; this file declares 3");
    } finally {
      r.cleanup();
    }
  });

  test("the hold record stays valid JSON whatever the image's version label holds", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      const odd = 'v1 "quoted" back\\slash\\"';
      r.setVersion("sha256:web2", odd);
      r.setImageRevision("sha256:web2", "2");
      const res = r.run(["--tick"]);
      expect(res.record, res.out).toMatchObject({ status: "held_compose", to: odd });
    } finally {
      r.cleanup();
    }
  });

  test("an image that does not say which revision it needs is held", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setImageRevision("sha256:web2", "<no value>");
      const res = r.run(["--tick"]);
      expect(res.recreated).toEqual([]);
      expect(res.log).toContain("it does not say which compose file revision it needs");
      expect(res.record).toMatchObject({ status: "held_compose", needed_revision: "" });
    } finally {
      r.cleanup();
    }
  });
});

test.describe("kinboard-updater: registry trouble, pins and tag changes", () => {
  test("the registry unreachable: nothing pulled or touched, the next tick waits, then twice as long; it recovers", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setOffline(true);
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(res.log).toMatch(/tick skipped: the registry ghcr\.io could not be reached \(curl: \(6\) Could not resolve host: ghcr\.io\); nothing was changed\. Next try in 30 minutes \(failure 1 in a row\)/);
      expect(res.state).toMatch(/^failures 1$/m);

      const waiting = r.run(["--tick"]);
      expect(waiting.curls, "backing off: not even a HEAD").toEqual([]);
      expect(waiting.log).toContain("tick: backing off after 1 failed tick(s)");

      // the wait is over, still offline: twice as long
      r.run(["--tick"], {}); // still backing off
      const state = readFileSync(r.statePath, "utf8").replace(/^backoff_until \d+$/m, "backoff_until 1");
      writeFileSync(r.statePath, state);
      const second = r.run(["--tick"]);
      expect(second.log).toContain("Next try in 60 minutes (failure 2 in a row)");

      r.setOffline(false);
      writeFileSync(r.statePath, readFileSync(r.statePath, "utf8").replace(/^backoff_until \d+$/m, "backoff_until 1"));
      const back = r.run(["--tick"]);
      expect(back.status, back.out).toBe(0);
      expect(r.container("webapp")?.id).toBe("sha256:web2");
      expect(back.state).not.toMatch(/^failures /m);
    } finally {
      r.cleanup();
    }
  });

  test("a 429 is a rate limit: backed off, nothing touched", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setOffline(true, "ratelimit");
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.log).toContain("tick skipped: the registry is rate-limiting (HTTP 429 from ghcr.io); nothing was changed");
    } finally {
      r.cleanup();
    }
  });

  test("a reference change waits while the registry cannot be asked: one tick never does half", () => {
    const r = rig();
    try {
      baseline(r);
      // KINBOARD_TAG changed, and go2rtc's pin too; the Kinboard image's registry is down
      r.setStack({ ...stackFor(NEXT), go2rtc: { ref: "alexxit/go2rtc:1.9.15" } });
      r.setOffline(true);
      const res = r.run(["--tick"]);
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
      expect(res.log).toContain("tick skipped:");
    } finally {
      r.cleanup();
    }
  });

  test("a pinned version never moves, and is never asked about: three ticks", () => {
    for (const pin of [PINNED, `${KB}:sha-4c32738`, `${KB}:v1.18.0-rc.2`, `${KB}@${D1}`]) {
      const r = rig({}, pin);
      try {
        baseline(r);
        publish(r, "sha256:web2", D2, pin);
        for (let i = 0; i < 3; i++) {
          const res = r.run(["--tick"]);
          expect(res.status, `${pin}: ${res.out}`).toBe(0);
          expect(res.curls, pin).toEqual([]);
          expect(res.pulls, pin).toBe(0);
          expect(res.recreated, pin).toEqual([]);
        }
        expect(r.container("webapp")?.id).toBe("sha256:web1");
      } finally {
        r.cleanup();
      }
    }
  });

  test("a tag changed in .env (a pin back to next) is picked up: pulled, backed up, recreated", () => {
    const r = rig({}, PINNED);
    try {
      baseline(r);
      r.setStack(stackFor(NEXT));
      r.setRegistry({ [NEXT]: "sha256:web2" });
      r.setRemote(NEXT, D2);
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain(`tick: webapp runs ${PINNED}; the compose files and .env name ${NEXT}`);
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(true);
      expect(r.container("webapp")).toEqual({ ref: NEXT, id: "sha256:web2" });
    } finally {
      r.cleanup();
    }
  });

  test("KINBOARD_UPDATE_TICK=off in the stack's .env switches it off", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      appendFileSync(join(r.proj, ".env"), "KINBOARD_UPDATE_TICK=off\n");
      const res = r.run(["--tick"]);
      expect(res.log).toContain("switched off");
      expect(res.curls).toEqual([]);
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});

test.describe("kinboard-updater: finding the stack", () => {
  test("files not readable here: the tick runs in a sibling that mounts their folders read-only at the same path", () => {
    const r = rig();
    try {
      r.setLabels(`kbt|/srv/stacks/kinboard|/srv/stacks/kinboard/compose.yml|/srv/stacks/kinboard/.env`);
      r.setHop({ rc: 3 });
      const res = r.run(["--tick"]);
      expect(res.status, "the sibling's status").toBe(3);
      const hop = res.runs.split("\n").find((l) => l.includes("app.kinboard.updater-tick=1")) ?? "";
      expect(hop).toContain("--rm --name kbt-updater-tick --network container:cid-updater-g0 --volumes-from cid-updater-g0");
      expect(hop).toContain("--mount type=bind,source=/srv/stacks/kinboard,target=/srv/stacks/kinboard,readonly");
      expect(hop).toContain("-e KINBOARD_UPDATER=1 -e KINBOARD_UPDATER_SIBLING=1 -e KINBOARD_SELF_CONTAINER=cid-updater-g0");
      expect(hop).toMatch(/--entrypoint sh sha256:updater-image \/usr\/local\/bin\/kinboard-self-update\.sh --tick$/);
      expect(hop, "no read-write mount of the household's folder").not.toMatch(/source=\/srv[^ ]*(?<!readonly)( |$)/);
      expect(existsSync(r.statePath), "the sibling keeps the state, not this one").toBe(false);
      expect(res.pulls).toBe(0);
    } finally {
      r.cleanup();
    }
  });

  // What container mode then does is self-update-container-mode.spec.ts's,
  // against a stub daemon with the Engine API; this stub has none.
  test("a compose file that is not on the host (Portainer's web editor) is container mode, in a sibling without the folders; no docker compose", () => {
    const r = rig();
    try {
      r.setLabels(`kbt|/data/compose/3|/data/compose/3/docker-compose.yml|`);
      r.setHop({ missing: true });
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      const hops = res.runs.split("\n").filter((l) => l.includes("app.kinboard.updater-tick=1"));
      expect(hops).toHaveLength(2);
      expect(hops[0]).toContain("--mount type=bind,source=/data/compose/3,target=/data/compose/3,readonly");
      expect(hops[1]).not.toContain("--mount");
      expect(hops[1]).toContain("-e KINBOARD_CONTAINER_MODE_WHY=the stack's files (/data/compose/3/docker-compose.yml) are not on this host's disk");
      expect(res.calls.filter((c) => c.startsWith("docker compose"))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a stack started from the legacy files is refused", () => {
    const r = rig();
    try {
      const d = join(r.proj, "webapp", "docker");
      r.setLabels(`docker|${d}|${join(d, "docker-compose.yml")}|${join(d, ".env")}`);
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("kinboard-updater updates a stack started from compose.yml");
      expect(res.pulls).toBe(0);
    } finally {
      r.cleanup();
    }
  });

  test("without labels it changes nothing", () => {
    const r = rig();
    try {
      rmSync(join(r.stub, "labels"), { recursive: true, force: true });
      mkdirSync(join(r.stub, "labels"));
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("the updater cannot read its own Compose labels");
      expect(res.calls.filter((c) => c.startsWith("docker compose"))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a plain run (docker exec … kinboard-self-update.sh) is a tick, never the git path", () => {
    const r = rig();
    try {
      const res = r.run([]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("=== tick ===");
      expect(res.log).not.toContain("git fetch");
    } finally {
      r.cleanup();
    }
  });
});

test.describe("kinboard-updater: what the independent review found", () => {
  test("a file Unraid's Compose Manager calls docker-compose.yml (or OMV <name>.yml) is the one-file stack too", () => {
    for (const name of ["docker-compose.yml", "kinboard.yml"]) {
      const r = rig();
      try {
        const f = join(r.proj, name);
        writeFileSync(f, "# stub\n");
        r.setLabels(`kbt|${r.proj}|${f}|${join(r.proj, ".env")}`);
        baseline(r);
        publish(r);
        const res = r.run(["--tick"]);
        expect(res.status, `${name}: ${res.out}`).toBe(0);
        expect(r.container("webapp")?.id, name).toBe("sha256:web2");
      } finally {
        r.cleanup();
      }
    }
  });

  test("a stack whose webapp declares no compose revision is not the one-file stack: refused", () => {
    const r = rig();
    try {
      baseline(r);
      r.setFileRevision(null);
      publish(r);
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("declares no KINBOARD_COMPOSE_REVISION");
      expect(res.pulls).toBe(0);
    } finally {
      r.cleanup();
    }
  });

  test("beside the Diun overlay's webhook (a git install on compose.yml), it leaves the stack to that one", () => {
    const r = rig();
    try {
      writeFileSync(join(r.stub, "labels", "webhook"), readFileSync(join(r.stub, "labels", "webapp"), "utf8"));
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("also runs the Diun overlay's webhook");
      expect(res.state, "not even a baseline").toBe("");
    } finally {
      r.cleanup();
    }
  });

  test("a webapp someone stopped: init and db-init are not updated on their own", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setServiceHealth("webapp", { status: "exited", code: 0, policy: "unless-stopped" });
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("the webapp is not running; nothing is updated until it is");
      expect(res.pulls).toBe(0);
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a 404 or 401 for the tag is about that reference only: a warning, no backoff", () => {
    const r = rig();
    try {
      baseline(r);
      rmSync(join(r.stub, "remote"), { recursive: true });
      mkdirSync(join(r.stub, "remote"));
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain(`WARN: cannot watch ${NEXT}: the registry ghcr.io answered HTTP 404`);
      expect(res.state).not.toMatch(/^failures /m);
      // and a tag the household changed is still applied (a pin needs no registry answer)
      r.setStack(stackFor(PINNED));
      r.setRegistry({ [PINNED]: "sha256:web2" });
      const changed = r.run(["--tick"]);
      expect(changed.status, changed.out).toBe(0);
      expect(r.container("webapp")).toEqual({ ref: PINNED, id: "sha256:web2" });
    } finally {
      r.cleanup();
    }
  });

  test("a pull that keeps failing after the registry answered: the wait still doubles", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setPullFails(true);
      const first = r.run(["--tick"]);
      expect(first.log).toContain("Next try in 30 minutes (failure 1 in a row)");
      writeFileSync(r.statePath, readFileSync(r.statePath, "utf8").replace(/^backoff_until \d+$/m, "backoff_until 1"));
      const second = r.run(["--tick"]);
      expect(second.log).toContain("Next try in 60 minutes (failure 2 in a row)");
      expect(second.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a tag changed to a floating one whose release needs a newer file: the new tag is not pointed at the old image, and not pulled again", () => {
    const r = rig({}, PINNED);
    try {
      baseline(r);
      r.setStack(stackFor(NEXT));
      publish(r);
      r.setImageRevision("sha256:web2", "2");
      const first = r.run(["--tick"]);
      expect(first.recreated).toEqual([]);
      expect(first.tags).toEqual([]);
      expect(r.imageOnDisk(NEXT), "next still names next's image").toBe("sha256:web2");
      const second = r.run(["--tick"]);
      expect(second.pulls).toBe(0);
      expect(second.log).toContain(`held webapp: ${NEXT} (${D2}) needs a newer compose file`);
    } finally {
      r.cleanup();
    }
  });

  test("the database's pin changed in the file without Up: not the updater's to apply", () => {
    const r = rig();
    try {
      baseline(r);
      r.setStack({ ...stackFor(NEXT), db: { ref: "supabase/postgres:17.0.0" } });
      const res = r.run(["--tick"]);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("tick: db runs supabase/postgres:15.14.1.159; the file names supabase/postgres:17.0.0, which changes only with your own Up (not applied here)");
      expect(res.pulls).toBe(0);
      expect(r.container("db")?.id).toBe("sha256:db");
    } finally {
      r.cleanup();
    }
  });

  test("the file would give the webapp other data (variables only a shell had): nothing backed up or recreated, the tag back", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setConfigMounts("webapp", ["/kinboard kinboard-config", "/var/lib/storage kinboard-storage-other"]);
      const res = r.run(["--tick"]);
      expect(res.status).toBe(1);
      expect(res.log).toContain("webapp would be recreated with other folders or volumes than it has now");
      expect(res.recreated).toEqual([]);
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(r.imageOnDisk(NEXT)).toBe("sha256:web1");
    } finally {
      r.cleanup();
    }
  });
});

test.describe("kinboard-updater: a compose hold it cannot recognise by digest", () => {
  test("an image pulled without registry digests is pulled again at each tick, and Settings is still told once", () => {
    const r = rig();
    try {
      baseline(r);
      publish(r);
      r.setDigests("sha256:web2", []);
      r.setImageRevision("sha256:web2", "2");
      const first = r.run(["--tick"]);
      expect(first.recordKey).toBe("update_hold");
      const second = r.run(["--tick"]);
      expect(second.pulls, "the hold is keyed by the image id, which a HEAD cannot match").toBe(1);
      expect(second.recreated).toEqual([]);
      expect(second.record, "told once").toBeNull();
    } finally {
      r.cleanup();
    }
  });
});
