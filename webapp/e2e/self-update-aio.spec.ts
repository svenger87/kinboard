import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ownConfig, type Inspect } from "./helpers/updater-container-stub";
import { AIO1, AIO2, AIO3, AioRig, D1, D2, D3, NAME, NEXT } from "./helpers/updater-aio-stub";

/**
 * RFC-024 §4.7: kinboard-updater keeps the all-in-one image up to date, the
 * way container mode (RFC-023 §4.11.3) does for a Portainer stack: one
 * container, found by the image's label, recreated with only the image
 * changed, after the image's own verified dump, with the health wait, the
 * smoke check, the rollback to the original container and the crash journal.
 *
 * The host is an Unraid box as its template leaves it: kinboard-aio as
 * "Kinboard" with dockerMan's labels and no Compose labels, the updater beside
 * it, and two containers of other apps. The whole script runs against
 * helpers/docker-stub-daemon.cjs.
 */

const OTHERS = ["kinboard-updater", "postgres", "plex"];

function baseline(r: AioRig, env: Record<string, string> = {}) {
  const res = r.run(env);
  expect(res.status, res.out).toBe(0);
  expect(res.log).toContain("baseline recorded");
  return res;
}
/** What a recreate must keep: everything but what Docker derives and what the image supplies. */
function ownSettings(c: Inspect, image: Inspect) {
  const x = ownConfig(c);
  x.Config.Env = x.Config.Env.filter((e: string) => !(image.Config.Env ?? []).includes(e));
  x.Config.Labels = Object.fromEntries(Object.entries(x.Config.Labels as Record<string, string>).filter(([k, v]) => image.Config.Labels?.[k] !== v));
  return x;
}
const changing = (calls: string[]) => calls.filter((c) => /^(api POST|docker (rename|stop|start|rm|update|tag|pull))/.test(c));

test.describe("kinboard-updater and the all-in-one image (RFC-024 §4.7)", () => {
  test("found by its label, with no Compose labels anywhere; the first tick runs in a sibling and only records a baseline", () => {
    const r = new AioRig();
    try {
      r.publish(AIO2, D2, "1.18.1"); // already out: still nothing on the first look
      const res = baseline(r);
      expect(res.log).toContain(`all-in-one: ${NAME} runs the all-in-one image`);
      expect(res.log).toContain(`tick baseline: aio: ${NEXT} is watched in the registry from the next tick`);
      expect(res.calls.some((c) => c.includes("app.kinboard.updater-tick=1") && c.includes(`--name ${NAME}-updater-tick`)), "the tick runs in a sibling").toBe(true);
      expect(changing(res.calls)).toEqual([]);
      expect(res.pulls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("an image published before the label is found by KINBOARD_AIO=1; another app's container is not, whatever it is called", () => {
    const r = new AioRig({ label: false });
    try {
      const res = baseline(r);
      expect(res.log).toContain(`all-in-one: ${NAME} runs the all-in-one image`);
      expect(res.log).not.toContain("postgres runs");
    } finally {
      r.cleanup();
    }
  });

  test("two all-in-one containers and no name: refused; KINBOARD_AIO_CONTAINER picks one", () => {
    const r = new AioRig({ secondAio: true });
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toMatch(/this Docker runs 2 all-in-one Kinboard containers \((Kinboard Kinboard-Grandma|Kinboard-Grandma Kinboard)\); set KINBOARD_AIO_CONTAINER/);
      expect(changing(res.calls)).toEqual([]);
      const named = baseline(r, { KINBOARD_AIO_CONTAINER: "Kinboard-Grandma" });
      expect(named.log).toContain("all-in-one: Kinboard-Grandma runs the all-in-one image");
    } finally {
      r.cleanup();
    }
  });

  test("KINBOARD_AIO_CONTAINER naming another app's container, or nothing: refused, nothing touched", () => {
    const r = new AioRig();
    try {
      const other = r.run({ KINBOARD_AIO_CONTAINER: "postgres" });
      expect(other.status).toBe(1);
      expect(other.log).toContain("KINBOARD_AIO_CONTAINER names postgres, which does not run the all-in-one image");
      const none = r.run({ KINBOARD_AIO_CONTAINER: "kinbaord" });
      expect(none.status).toBe(1);
      expect(none.log).toContain("KINBOARD_AIO_CONTAINER names kinbaord, and there is no container of that name");
      const bad = r.run({ KINBOARD_AIO_CONTAINER: "x;rm -rf /" });
      expect(bad.log).toContain("is not a container name");
      const flag = r.run({ KINBOARD_AIO_CONTAINER: "-f" });
      expect(flag.log).toContain("KINBOARD_AIO_CONTAINER=-f is not a container name");
      for (const res of [other, none, bad, flag]) expect(changing(res.calls)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("without a volume for its folder the updater refuses: the journal would not survive it", () => {
    const r = new AioRig({ updaterVolume: false });
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("which is not on a volume or folder of its container");
      expect(res.log).not.toContain("baseline recorded");
    } finally {
      r.cleanup();
    }
  });

  test("a newer digest: the image's own verified dump as PUID:PGID first, then only the all-in-one container recreated, with every setting but the image; healthy, smoke-checked, recorded, Unraid told; the next tick does nothing", () => {
    const r = new AioRig();
    try {
      baseline(r);
      const before = r.container(NAME)!;
      r.publish(AIO2, D2, "1.18.1");
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.pulls).toEqual([NEXT]);

      // The backup: the image's kinboard-backup.sh, inside it, as the data's owner, before anything is renamed.
      const backup = res.calls.findIndex((c) => c.includes("kinboard-backup.sh"));
      expect(backup).toBeGreaterThan(-1);
      expect(res.calls[backup]).toContain(`docker exec -u 99:100 -e PGHOST=/run/postgresql -e PGUSER=supabase_admin`);
      expect(res.calls[backup]).toContain(r.original[NAME]);
      expect(res.calls[backup]).toContain("pre-update");
      expect(res.calls.findIndex((c) => c.startsWith("docker rename"))).toBeGreaterThan(backup);
      expect(res.log).toContain("backup: pre-update-20261127T101500Z.sql.gz in /mnt/user/appdata/kinboard/backups");

      const after = r.container(NAME)!;
      expect(after.Id).not.toBe(r.original[NAME]);
      expect(after.Image).toBe(AIO2);
      expect(after.Config.Image).toBe(NEXT);
      const s = r.state();
      expect(ownSettings(after, s.images[AIO2])).toEqual(ownSettings(before, s.images[AIO1]));
      expect(after.Config.Env).toEqual(expect.arrayContaining(["PUID=99", "PGID=100", "HOST_CONTAINERNAME=Kinboard"]));
      expect(after.Config.Labels["net.unraid.docker.managed"]).toBe("dockerman");
      expect(after.HostConfig.Binds).toEqual(["/mnt/user/appdata/kinboard:/data:rw"]);
      expect(after.HostConfig.PortBindings).toEqual({ "3000/tcp": [{ HostIp: "", HostPort: "3001" }] });
      expect(after.Config.StopTimeout).toBe(60);
      expect(after.Config.Labels["org.opencontainers.image.version"], "the new image's own label").toBe("1.18.1");

      for (const n of OTHERS) expect(r.container(n)?.Id, `${n} untouched`).toBe(r.original[n]);
      for (const n of OTHERS) {
        expect(changing(res.calls).filter((c) => c.includes(r.original[n]) || c.includes(r.original[n].slice(0, 12)) || new RegExp(` ${n}( |$)`).test(c)), n).toEqual([]);
      }
      expect(s.removed).toEqual([r.original[NAME]]);
      expect(s.volumesRemoved ?? 0).toBe(0);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(false);
      expect(res.log).toContain("smoke check passed");
      expect(res.record).toMatchObject({ status: "updated", from: "1.18.0", to: "1.18.1", services: "aio", backup: "pre-update-20261127T101500Z.sql.gz" });
      expect(s.unraidStatus).toEqual({ [NEXT]: { local: D2, remote: D2, status: "true" } });
      // Nothing about a webapp, a cron container or Diun: none of them exists here (the Unraid test, 2026-11-27).
      for (const line of ["webapp recreated", "webapp not recreated", "scheduler", "diun"]) expect(res.log, line).not.toContain(line);

      const again = r.run();
      expect(again.log).toContain("=== tick: nothing to do ===");
      expect(again.pulls).toEqual([]);
      expect(changing(again.calls)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("no verified dump, no update: nothing renamed, created or stopped", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.18.1");
      r.edit((s) => (s.backupFails = true));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain(`the verified dump in ${NAME} failed`);
      expect(res.log).toContain("self-update ABORTED: no verified backup");
      expect(res.calls.filter((c) => /^(api POST|docker (rename|stop|start|rm|update))/.test(c))).toEqual([]);
      expect(r.container(NAME)!.Id).toBe(r.original[NAME]);
    } finally {
      r.cleanup();
    }
  });

  test("a dump that is gone once verified, or BACKUP_KEEP=0 (which would prune it): no update on the first, five kept on the second", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.18.1");
      r.edit((s) => (s.dumpMissing = true));
      const gone = r.run();
      expect(gone.status).toBe(1);
      expect(gone.log).toContain("is not there after it was verified — refusing to update");
      expect(r.container(NAME)!.Id).toBe(r.original[NAME]);
      r.edit((s) => (s.dumpMissing = false));
      const zero = r.run({ BACKUP_KEEP: "0" });
      expect(zero.status, zero.out).toBe(0);
      expect(zero.calls.find((c) => c.includes("kinboard-backup.sh"))).toContain("-e BACKUP_KEEP=5 ");
    } finally {
      r.cleanup();
    }
  });

  test("replaced, between the look and the swap, by a container that is not the all-in-one image: nothing recreated", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.18.1");
      r.edit((s) => (s.onPull = { name: NAME, notAio: true }));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain(`${NAME} is not the all-in-one image any more; nothing was changed`);
      expect(res.calls.filter((c) => /^(api POST|docker (rename|stop|start|rm|update))/.test(c))).toEqual([]);
      expect(r.container(NAME)!.Id).toBe(r.original[NAME]);
    } finally {
      r.cleanup();
    }
  });

  test("a broken release: the original container back (same id), the release held, the tag pointed back; a newer one is applied", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.18.1");
      r.behave(AIO2, { webapp: "exit" });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain(`container mode: aio: the original ${NAME} (${r.original[NAME].slice(0, 12)}) is back`);
      expect(res.log).toContain("ROLLED BACK");
      const c = r.container(NAME)!;
      expect(c.Id).toBe(r.original[NAME]);
      expect(c.State.Running).toBe(true);
      expect(c.HostConfig.RestartPolicy.Name).toBe("no");
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(res.tags).toContain(`${AIO1} ${NEXT}`);
      expect(res.state).toMatch(new RegExp(`^held ${AIO2} ${NEXT} .* ${D2}$`, "m"));
      expect(res.record).toMatchObject({ status: "rolled_back", from: "1.18.0", to: "1.18.1" });
      expect(r.state().unraidStatus, "Unraid is told nothing about a release that did not stay").toBeUndefined();

      const held = r.run();
      expect(held.log).toContain("was rolled back before; waiting for a newer one");
      expect(held.pulls).toEqual([]);

      r.publish(AIO3, D3, "1.18.2");
      const newer = r.run();
      expect(newer.status, newer.out).toBe(0);
      expect(r.container(NAME)!.Image).toBe(AIO3);
    } finally {
      r.cleanup();
    }
  });

  // The new container is down exactly when the excerpt matters: after a
  // failed update. Its secrets are read from its mounts then, by a container
  // of its image with no network and the mounts read-only; until this the
  // excerpt was always withheld here, because an exec into it fails.
  const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n-----END PRIVATE KEY-----\n";
  for (const [how, what] of [
    ["exit", "has exited"],
    ["restarting", "is restarting (Docker runs no exec in it)"],
    ["created", "was never started"],
  ] as const) {
    test(`a broken release whose new container ${what}: the log excerpt is stored, with the secrets kept as files taken out`, () => {
      const r = new AioRig();
      try {
        baseline(r);
        r.publish(AIO2, D2, "1.18.1");
        r.behave(AIO2, { webapp: how });
        r.edit((s) => {
          s.storedSecrets = ["Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k", PEM];
          s.logs = { [AIO2]: "[push] key Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k rejected\npem line BKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\nmigrations: 3 applied\n" };
        });
        const res = r.run();
        expect(res.record?.status, res.out).toBe("rolled_back");
        const log = String(res.record?.log);
        expect(log).toContain("[push] key [redacted] rejected");
        expect(log).toContain("pem line [redacted]");
        expect(log).toContain("migrations: 3 applied");
        expect(JSON.stringify(res.record)).not.toContain("Zx3_kQ9");
        expect(JSON.stringify(res.record)).not.toContain("BKcwggSj");
        // Read beside it, not in it: its own image, no network, its mounts read-only.
        const runs = res.calls.filter((c) => c.includes("app.kinboard.secrets-read=1"));
        expect(runs.length).toBeGreaterThan(0);
        for (const c of runs) {
          expect(c).toContain("--network none");
          expect(c).toMatch(/--volumes-from [0-9a-f]{64}:ro /);
          expect(c).toContain(` --entrypoint sh ${AIO2} `);
          expect(c).toContain("KINBOARD_SECRETS_DIR=/data/config/secrets");
        }
      } finally {
        r.cleanup();
      }
    });
  }

  test("a broken release whose secrets cannot be read even beside it (the folder unreadable, or not on a mount): still withheld", () => {
    for (const how of ["unreadable", "not on a mount"] as const) {
      const r = new AioRig();
      try {
        if (how === "not on a mount") {
          // A store in the container's own layer: a container beside it sees nothing there.
          r.edit((s) => {
            const c = Object.values(s.containers).find((x: any) => x.Name === `/${NAME}`) as Inspect;
            c.Config.Env.push("KINBOARD_SECRETS_DIR=/secrets");
          });
        }
        baseline(r);
        r.publish(AIO2, D2, "1.18.1");
        r.behave(AIO2, { webapp: "exit" });
        r.edit((s) => {
          s.storedSecrets = ["Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k"];
          s.logs = { [AIO2]: "[push] key Zx3_kQ9-wPq7mN2bV5cL8aR1tY4uI6oE0sD3fG7hJ9k rejected\n" };
          if (how === "unreadable") s.secretsUnreadable = true;
        });
        const res = r.run();
        expect(res.record?.status, `${how}: ${res.out}`).toBe("rolled_back");
        expect(res.record?.log, how).toBe("log excerpt withheld: could not read the containers' settings to hide secrets; see the update log on the host");
        expect(JSON.stringify(res.record), how).not.toContain("Zx3_kQ9");
      } finally {
        r.cleanup();
      }
    }
  });

  test("killed in the middle of the swap: the next check puts the original back, and the one after updates", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.18.1");
      // The tick dies as the new container starts (the updater's container
      // was stopped, the host rebooted): the original is set aside and stopped.
      r.edit((s) => (s.crash = "start:"));
      const cut = r.run();
      expect(cut.status).not.toBe(0);
      expect(r.names()).toContain(`${NAME}-before-update`);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(true);

      const next = r.run();
      expect(next.log).toContain("an update was cut short while it recreated containers (aio ); putting the originals back");
      const c = r.container(NAME)!;
      expect(c.Id).toBe(r.original[NAME]);
      expect(c.State.Running).toBe(true);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(false);
      expect(next.state, "cut short is not a failure: nothing held").not.toMatch(/^held /m);
      // A stop the killed tick had asked for may still be running in the
      // daemon: the original is stopped (which waits for it), then started.
      const orig = r.original[NAME];
      const stop = next.calls.findIndex((c) => c === `docker stop ${orig}`);
      const start = next.calls.findIndex((c) => c === `docker start ${orig}`);
      expect(stop, next.calls.join("\n")).toBeGreaterThan(-1);
      expect(start).toBeGreaterThan(stop);

      const then = r.run();
      expect(then.status, then.out).toBe(0);
      expect(r.container(NAME)!.Image).toBe(AIO2);
    } finally {
      r.cleanup();
    }
  });

  test("a PostgreSQL major in the new image: the wait is the upgrade's (an hour), not ten minutes", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      const res = r.run({ KINBOARD_HEALTH_TIMEOUT: "600" });
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain(`the new image runs PostgreSQL 18, ${NAME} runs 17: the container upgrades the database itself`);
      expect(res.log).toContain("waiting up to 3600s for aio to come up healthy");
      const same = new AioRig();
      try {
        baseline(same);
        same.publish(AIO2, D2, "1.18.1");
        const plain = same.run({ KINBOARD_HEALTH_TIMEOUT: "600" });
        expect(plain.log).toContain("waiting up to 600s for aio to come up healthy");
        expect(plain.log).not.toContain("upgrades the database itself");
      } finally {
        same.cleanup();
      }
    } finally {
      r.cleanup();
    }
  });

  test("a PostgreSQL major that failed before its first healthy minute: the original goes back (and puts the old database back itself)", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      r.behave(AIO2, { webapp: "exit" });
      r.edit((s) => (s.pgUpgrade = "phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nconfirmed_at=\n"));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("ROLLED BACK");
      expect(r.container(NAME)!.Id).toBe(r.original[NAME]);
      expect(res.calls.some((c) => c.includes("/data/config/updater/pg-upgrade") && c.includes("--user 0:0") && c.includes(":/data:ro"))).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  test("a PostgreSQL major that ran healthy for a minute and then failed its check: final, so the new version is kept and started again, not a rollback onto a database the old image refuses", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      r.edit((s) => {
        s.smoke = { [AIO2]: '500|{"deep":{"ok":false,"missing":["todos.done"]}}' };
        s.pgUpgrade = "phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nswitched_at=2026-11-27T10:00:00Z\nconfirmed_at=2026-11-27T10:01:05Z\n";
      });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("NOT ROLLED BACK: the database in Kinboard was upgraded to PostgreSQL 18");
      // Stopped before the record was read, then started again.
      const stop = res.calls.findIndex((c) => /^docker stop -t 60 /.test(c));
      const read = res.calls.findIndex((c) => c.includes("/data/config/updater/pg-upgrade"));
      expect(stop).toBeGreaterThan(-1);
      expect(read).toBeGreaterThan(stop);
      const c = r.container(NAME)!;
      expect(c.Image).toBe(AIO2);
      expect(c.State.Running).toBe(true);
      expect(r.names().some((n) => n.endsWith("-before-update")), "the original, which would refuse, is gone").toBe(false);
      expect(existsSync(join(r.updaterDir, "swap")), "no journal left to restore it").toBe(false);
      expect(res.tags.at(-1)).toBe(`${AIO2} ${NEXT}`);
      expect(res.record).toMatchObject({ status: "rollback_failed", severe: true });
    } finally {
      r.cleanup();
    }
  });

  test("a PostgreSQL major whose record cannot be read: the new version is kept, not a rollback that might meet a database the old image refuses", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      r.edit((s) => {
        s.smoke = { [AIO2]: '500|{"deep":{"ok":false}}' };
        s.pgReadFails = true;
      });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("its upgrade record could not be read");
      expect(r.container(NAME)!.Image).toBe(AIO2);
      expect(r.container(NAME)!.State.Running).toBe(true);
      expect(res.record).toMatchObject({ status: "rollback_failed", severe: true });
    } finally {
      r.cleanup();
    }
  });

  test("a PostgreSQL major whose swap fails before the new container exists: the original, running again, is never stopped", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      r.edit((s) => (s.fail = { create: "" }));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.calls.filter((c) => /^docker stop -t 60/.test(c))).toEqual([]);
      expect(res.calls.some((c) => c.includes("/data/config/updater/pg-upgrade"))).toBe(false);
      const c = r.container(NAME)!;
      expect(c.Id).toBe(r.original[NAME]);
      expect(c.State.Running).toBe(true);
      expect(res.log).toContain("ROLLED BACK");
    } finally {
      r.cleanup();
    }
  });

  test("cut short during a PostgreSQL major upgrade that had become final: the next check keeps the new container instead of starting the original on a database it refuses", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.publish(AIO2, D2, "1.19.0", { pg: "18" });
      r.edit((s) => {
        s.crash = "start:";
        s.pgUpgrade = "phase=switched\nfrom=17\nto=18\nconfirmed_at=2026-11-27T10:01:05Z\n";
      });
      const cut = r.run();
      expect(cut.status).not.toBe(0);
      const made = r.container(NAME)!;
      expect(made.Image).toBe(AIO2);
      const next = r.run();
      expect(next.log).toContain("the upgrade is final; the image that ran before would refuse it, so the new container is kept and started");
      const c = r.container(NAME)!;
      expect(c.Id).toBe(made.Id);
      expect(c.State.Running).toBe(true);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(false);
    } finally {
      r.cleanup();
    }
    // Not final: the original goes back, as for any update cut short.
    const u = new AioRig();
    try {
      baseline(u);
      u.publish(AIO2, D2, "1.19.0", { pg: "18" });
      u.edit((s) => {
        s.crash = "start:";
        s.pgUpgrade = "phase=switched\nfrom=17\nto=18\nconfirmed_at=\n";
      });
      u.run();
      const next = u.run();
      expect(next.log).toContain(`container mode: aio: the original ${NAME} (${u.original[NAME].slice(0, 12)}) is back`);
      expect(u.container(NAME)!.Id).toBe(u.original[NAME]);
    } finally {
      u.cleanup();
    }
  });

  test("a pinned tag never asks the registry; a stopped container is left alone", () => {
    const r = new AioRig({ tag: "1.18.0" });
    try {
      baseline(r);
      const res = r.run();
      expect(res.log).toContain("=== tick: nothing to do ===");
      expect(readFileSync(join(r.stub, "calls"), "utf8")).not.toMatch(/manifests/);
    } finally {
      r.cleanup();
    }
    const s = new AioRig();
    try {
      baseline(s);
      s.publish(AIO2, D2, "1.18.1");
      s.edit((st) => {
        const c = Object.values(st.containers as Record<string, Inspect>).find((x) => x.Name === `/${NAME}`)!;
        Object.assign(c.State, { Status: "exited", Running: false });
      });
      const res = s.run();
      expect(res.log).toContain(`=== tick: ${NAME} is not running; nothing is updated until it is ===`);
      expect(res.pulls).toEqual([]);
    } finally {
      s.cleanup();
    }
  });

  test("Unraid's status file is only written for a container Unraid manages, and a missing one is never created", () => {
    const r = new AioRig();
    try {
      baseline(r);
      r.edit((s) => (s.unraidStatusMissing = true));
      r.publish(AIO2, D2, "1.18.1");
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("could not record the update in Unraid's /var/lib/docker/unraid-update-status.json");
      const run = readFileSync(join(r.stub, "runs"), "utf8").split("\n").find((l) => l.includes("unraid-update-status"))!;
      expect(run).toContain("--mount type=bind,source=/var/lib/docker/unraid-update-status.json,target=/status.json");
      expect(run).not.toMatch(/ -v [^ ]*unraid-update-status/);
    } finally {
      r.cleanup();
    }
  });
});
