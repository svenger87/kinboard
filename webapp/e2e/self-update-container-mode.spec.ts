import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CmRig, D2, D3, EXTRA, KB, NET, NEXT, WEB1, WEB2, WEB3, ownConfig, type Inspect } from "./helpers/updater-container-stub";

/**
 * RFC-023 PR 14 (§4.11.3, decided in §11.3): kinboard-updater's container
 * mode, for a stack whose compose file is not on the host: Portainer's web
 * editor keeps it in Portainer's own volume (/data/compose/<id>/), and a
 * stack started from stdin or whose file was deleted has none either.
 *
 * Until this the updater logged "comes with a later release" and changed
 * nothing. Now it recreates the Kinboard containers (init, db-init, the
 * webapp) from their own configuration with only the image changed, in
 * order, with the backup, health wait, smoke check and rollback of #547.
 *
 * The whole script runs against a stub daemon (helpers/docker-stub-daemon.cjs)
 * that answers the CLI and the Engine API from one state.
 */

const KB_SERVICES = ["init", "db-init", "webapp"];
const OTHERS = ["db", "rest", "go2rtc", "updater"];

function rig(opts: ConstructorParameters<typeof CmRig>[0] = {}) {
  return new CmRig(opts);
}
function baseline(r: CmRig) {
  const res = r.run();
  expect(res.status, res.out).toBe(0);
  expect(res.log).toContain("baseline recorded");
  return res;
}
/** web2 (1.18.1) under `next`, pulled as D2. */
function publish2(r: CmRig) {
  r.publish(WEB2, D2, "1.18.1");
}

/**
 * ownConfig with what an image supplies taken out of Env and Labels: the
 * ENV lines and LABELs the container got from its image (those change with
 * the image, by design) and com.docker.compose.image (which says which image).
 */
function ownSettings(c: Inspect, image: Inspect) {
  const x = ownConfig(c);
  x.Config.Env = x.Config.Env.filter((e: string) => !(image.Config.Env ?? []).includes(e));
  x.Config.Labels = Object.fromEntries(
    Object.entries(x.Config.Labels as Record<string, string>).filter(([k, v]) => image.Config.Labels?.[k] !== v && k !== "com.docker.compose.image"),
  );
  return x;
}

test.describe("kinboard-updater, container mode (RFC-023 PR 14)", () => {
  test("detected when Docker cannot mount the compose file's folder (Portainer's /data/compose/3): the first tick is a baseline and touches nothing", () => {
    const r = rig();
    try {
      const res = baseline(r);
      expect(res.log).toContain("container mode: the stack's files (/data/compose/3/docker-compose.yml,/data/compose/3/stack.env) are not on this host's disk");
      expect(res.calls.some((c) => c.startsWith("docker compose")), "container mode never runs docker compose").toBe(false);
      expect(res.calls.filter((c) => /^api POST|^docker (rename|stop|start|rm|pull|update)/.test(c))).toEqual([]);
      expect(res.pulls).toEqual([]);
      for (const [svc, id] of Object.entries(r.original)) expect(r.container(svc)?.Id, svc).toBe(id);
    } finally {
      r.cleanup();
    }
  });

  test("detected in the sibling too, when the folder exists but the file does not (a stack started from stdin: config_files is -)", () => {
    const r = rig();
    try {
      const wd = join(r.dir, "gone");
      mkdirSync(wd);
      r.edit((s) => {
        for (const c of Object.values(s.containers) as Inspect[]) {
          c.Config.Labels["com.docker.compose.project.working_dir"] = wd;
          c.Config.Labels["com.docker.compose.project.config_files"] = "-";
          delete c.Config.Labels["com.docker.compose.project.environment_file"];
        }
      });
      const res = r.run({ KINBOARD_UPDATER_SIBLING: "1" });
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain(`container mode: the stack's compose file (-, in ${wd}) is not on this host's disk`);
      expect(res.log).toContain("baseline recorded");
    } finally {
      r.cleanup();
    }
  });

  test("nothing new: one HEAD, no pull, nothing recreated", () => {
    const r = rig();
    try {
      baseline(r);
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("=== tick: nothing to do ===");
      expect(res.pulls).toEqual([]);
      expect(res.calls.filter((c) => c.startsWith("api POST"))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a newer digest: backup, then init, db-init and the webapp recreated in that order with the new image; nothing else touched; the originals removed, never their volumes; the next tick does nothing", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.pulls).toEqual([NEXT]);
      expect(res.log).toMatch(/backup: pre-upgrade-.*\.sql\.gz \(60 tables\)/);
      expect(res.log).toContain("healthy: ");
      expect(res.log).toContain("smoke check passed");
      // The backup comes before anything is renamed or created.
      const firstBackup = res.calls.findIndex((c) => c.includes("pg_dumpall"));
      const firstRename = res.calls.findIndex((c) => c.startsWith("docker rename"));
      expect(firstBackup).toBeGreaterThan(-1);
      expect(firstRename).toBeGreaterThan(firstBackup);

      // Order: each one is created and started, and a one-shot has exited 0, before the next is created.
      const creates = res.calls.filter((c) => c.startsWith("api POST /containers/create"));
      expect(creates).toEqual(["init", "db-init", "webapp"].map((s) => `api POST /containers/create?name=kinboard-${s}`));
      const at = (re: RegExp) => res.calls.findIndex((c) => re.test(c));
      expect(at(/create\?name=kinboard-db-init/)).toBeGreaterThan(at(/^docker start /));
      const startInit = res.calls.findIndex((c, i) => i > at(/create\?name=kinboard-init/) && c.startsWith("docker start"));
      expect(at(/create\?name=kinboard-db-init/)).toBeGreaterThan(startInit);

      for (const svc of KB_SERVICES) {
        const c = r.container(svc)!;
        expect(c.Image, svc).toBe(WEB2);
        expect(c.Id, svc).not.toBe(r.original[svc]);
        expect(c.Config.Image, svc).toBe(NEXT);
      }
      expect(r.container("webapp")!.State.Status).toBe("running");
      expect(r.container("init")!.State).toMatchObject({ Status: "exited", ExitCode: 0 });
      for (const svc of OTHERS) expect(r.container(svc)?.Id, `${svc} untouched`).toBe(r.original[svc]);
      const changing = res.calls.filter((c) => /^(api POST|docker (rename|stop|start|rm|update|tag))/.test(c));
      for (const svc of OTHERS) {
        expect(changing.filter((c) => c.includes(r.original[svc]) || c.includes(r.original[svc].slice(0, 12)) || new RegExp(` kinboard-${svc}( |$)`).test(c)), svc).toEqual([]);
      }

      const s = r.state();
      expect(s.removed.sort()).toEqual(KB_SERVICES.map((x) => r.original[x]).sort());
      expect(s.volumesRemoved ?? 0, "no docker rm -v").toBe(0);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(false);
      expect(res.record).toMatchObject({ status: "updated", from: "1.18.0", to: "1.18.1", services: "db-init init webapp" });

      const again = r.run();
      expect(again.log).toContain("=== tick: nothing to do ===");
      expect(again.pulls).toEqual([]);
      expect(again.calls.filter((c) => c.startsWith("api POST"))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("the copy keeps every setting of each container: env, mounts (named, bind, anonymous by name, tmpfs), both networks with their aliases and fixed address, labels with the Compose ones, restart policy, healthcheck, user, command and entrypoint, ports, log options, the rest of HostConfig", () => {
    const r = rig();
    try {
      baseline(r);
      const before = Object.fromEntries(KB_SERVICES.map((s) => [s, r.container(s)!]));
      publish2(r);
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      const s = r.state();
      for (const svc of KB_SERVICES) {
        const after = r.container(svc)!;
        expect(ownSettings(after, s.images[WEB2]), svc).toEqual(ownSettings(before[svc], s.images[WEB1]));
      }
      const w0 = before.webapp;
      const w = r.container("webapp")!;
      // Spelled out, so a regression names the field it lost.
      expect(w.Config.Env).toEqual(expect.arrayContaining(["WEBRTC_LAN_IP=192.168.1.20", "NODE_OPTIONS=--max-old-space-size=512", "KINBOARD_COMPOSE_REVISION=1", "SITE_URL="]));
      expect(w.NetworkSettings.Networks[NET].Aliases).toEqual(["kinboard-webapp", "webapp", "board"]);
      expect(w.NetworkSettings.Networks[EXTRA].Aliases).toEqual(["kinboard-webapp", "webapp", "dashboard"]);
      expect(w.NetworkSettings.Networks[EXTRA].IPAMConfig).toEqual({ IPv4Address: "10.239.9.50" });
      expect(w.NetworkSettings.Networks[EXTRA].IPAddress).toBe("10.239.9.50");
      expect(w.Config.Labels).toMatchObject({
        "com.docker.compose.project": "kinboard",
        "com.docker.compose.service": "webapp",
        "com.docker.compose.project.config_files": "/data/compose/3/docker-compose.yml",
        "com.docker.compose.config-hash": "hash-webapp",
        "traefik.http.routers.kinboard.rule": "Host(`board.home`)",
      });
      expect(w.HostConfig.RestartPolicy).toEqual({ Name: "unless-stopped", MaximumRetryCount: 0 });
      expect(w.Config.Healthcheck).toEqual(w0.Config.Healthcheck);
      expect(w.Config.User).toBe("0:0");
      expect(w.Config.StopSignal).toBe("SIGINT");
      expect(w.Config.StopTimeout).toBe(25);
      expect(w.HostConfig.PortBindings).toEqual(w0.HostConfig.PortBindings);
      expect(w.HostConfig.LogConfig).toEqual({ Type: "json-file", Config: { "max-file": "3", "max-size": "10m", tag: "kinboard" } });
      expect(w.HostConfig.Tmpfs).toEqual({ "/run/kb": "size=1m" });
      expect(w.HostConfig.CapAdd).toEqual(["NET_ADMIN"]);
      expect(w.HostConfig.ExtraHosts).toEqual(["ha.local:192.168.1.5"]);
      expect(w.HostConfig.Init).toBe(true);
      const vol = (c: Inspect, d: string) => c.Mounts.find((m: Inspect) => m.Destination === d);
      expect(vol(w, "/app/.next/cache").Name, "the anonymous volume is the same one, not a new empty one").toBe(vol(w0, "/app/.next/cache").Name);
      expect(vol(w, "/var/lib/storage").Name).toBe("kinboard-storage");
      expect(vol(w, "/photos")).toMatchObject({ Type: "bind", Source: "/srv/photos", RW: false });
      const init = r.container("init")!;
      expect(init.Config.Entrypoint).toEqual(before.init.Config.Entrypoint);
      expect(init.Config.Cmd).toBeNull();
      expect(init.Config.Healthcheck.Test).toEqual(["NONE"]);
      expect(init.HostConfig.RestartPolicy.Name).toBe("no");
      expect(r.container("db-init")!.Config.Cmd).toEqual(["kinboard-db-init"]);
      expect(r.container("db-init")!.Config.Entrypoint).toEqual(["./webapp-entrypoint.sh"]);

      // What the image supplies comes from the new image, not the old one.
      expect(w.Config.Env).toContain("KINBOARD_VERSION=1.18.1");
      expect(w.Config.Env).not.toContain("KINBOARD_VERSION=1.18.0");
      expect(w.Config.Labels["org.opencontainers.image.version"]).toBe("1.18.1");
      expect(w.Config.Labels["com.docker.compose.image"], "Compose's image label names the new image's own manifest").toBe(s.images[WEB2].Manifests[0].Descriptor.digest);
      expect(w.Config.Hostname).toBe(w.Id.slice(0, 12));
      expect(w.NetworkSettings.Networks[NET].Aliases).not.toContain(w0.Id.slice(0, 12));
    } finally {
      r.cleanup();
    }
  });

  test("a broken release: the exact containers from before run again (same ids, names, state), the new ones are gone, the digest is held and the tag points back", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.behave(WEB2, { webapp: "exit" });
      const res = r.run();
      expect(res.status, res.out).toBe(1);
      expect(res.log).toContain("ROLLED BACK");
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
      expect(r.container("webapp")!.State.Status).toBe("running");
      expect(r.container("webapp")!.HostConfig.RestartPolicy.Name, "its restart policy back").toBe("unless-stopped");
      expect(r.container("init")!.State).toMatchObject({ Status: "exited", ExitCode: 0 });
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(Object.keys(r.state().containers)).toHaveLength(7);
      expect(r.state().tags[NEXT]).toBe(WEB1);
      expect(res.state).toMatch(new RegExp(`^held ${WEB2} `, "m"));
      expect(res.record).toMatchObject({ status: "rolled_back", from: "1.18.0", to: "1.18.1" });
      expect(r.state().volumesRemoved ?? 0).toBe(0);

      const next = r.run();
      expect(next.log).toMatch(/held webapp: .* rolled back before/);
      expect(next.pulls).toEqual([]);

      // A newer release is applied.
      r.publish(WEB3, D3, "1.18.2");
      const third = r.run();
      expect(third.status, third.out).toBe(0);
      expect(r.container("webapp")!.Image).toBe(WEB3);
    } finally {
      r.cleanup();
    }
  });

  test("init exits non-zero: db-init and the webapp are never touched, init's original is back", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.behave(WEB2, { init: 1 });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("init: exited with code 1");
      expect(res.calls.filter((c) => c.startsWith("api POST /containers/create"))).toEqual(["api POST /containers/create?name=kinboard-init"]);
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  for (const [what, set] of [
    ["Docker refuses the create", (s: Record<string, any>) => (s.fail = { create: "webapp" })],
    ["Docker cannot connect the second network", (s: Record<string, any>) => (s.fail = { connect: "webapp" })],
    ["Docker cannot start the new webapp", (s: Record<string, any>) => (s.fail = { start: "webapp", startSpare: WEB1 })],
  ] as const) {
    test(`${what}: the original webapp is back under its name at once, running, and the one-shots too; nothing half-made is left`, () => {
      const r = rig();
      try {
        baseline(r);
        publish2(r);
        r.edit(set);
        const res = r.run();
        expect(res.status, res.out).toBe(1);
        for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
        expect(r.container("webapp")!.State.Running).toBe(true);
        expect(r.container("webapp")!.HostConfig.RestartPolicy.Name).toBe("unless-stopped");
        expect(r.names()).toEqual(["db", "db-init", "go2rtc", "init", "rest", "updater", "webapp"].map((s) => `kinboard-${s}`));
        expect(existsSync(join(r.updaterDir, "swap")), "the journal is empty").toBe(false);
        expect(r.state().volumesRemoved ?? 0).toBe(0);
      } finally {
        r.cleanup();
      }
    });
  }

  test("the reference moved between the pull and the create (a pull by hand): the container made from it is removed, the original stays", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.moveTagOnCreate = WEB3));
      r.edit((s) => (s.images[WEB3] = JSON.parse(JSON.stringify(s.images[WEB1]))));
      r.edit((s) => (s.images[WEB3].Id = WEB3));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain(`runs ${WEB3}, not ${WEB2}`);
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
      expect(Object.values(r.state().containers).some((c: any) => c.Image === WEB3), "nothing runs the image the update did not pull").toBe(false);
    } finally {
      r.cleanup();
    }
  });

  test("a container that runs another image by the time it is recreated is not touched (checked again right before each one)", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.onPull = { name: "kinboard-init", image: "supabase/postgres:15.14.1.159" }));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("init runs supabase/postgres:15.14.1.159, not the Kinboard image");
      expect(res.calls.filter((c) => /^api POST|^docker rename/.test(c))).toEqual([]);
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
    } finally {
      r.cleanup();
    }
  });

  test("an updater killed mid-swap: the next tick puts the originals back first, and the one after updates again", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.crash = "start:webapp"));
      const res = r.run();
      expect(res.status).not.toBe(0);
      // Killed with the new webapp created and the old one stopped and aside.
      expect(r.names()).toContain("kinboard-webapp-before-update");
      expect(readFileSync(join(r.updaterDir, "swap"), "utf8")).toMatch(/^phase updating\ninit /);

      const rec = r.run();
      expect(rec.status, rec.out).toBe(0);
      expect(rec.log).toContain("an update was cut short while it recreated containers");
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
      expect(r.container("webapp")!.State.Running).toBe(true);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
      expect(existsSync(join(r.updaterDir, "swap"))).toBe(false);

      const upd = r.run();
      expect(upd.status, upd.out).toBe(0);
      expect(r.container("webapp")!.Image).toBe(WEB2);
    } finally {
      r.cleanup();
    }
  });

  test("an updater killed after the update came up healthy: the next tick only removes the originals", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      expect(r.run().status).toBe(0);
      // As if cut short between "healthy" and the cleanup: an original set aside, the journal done.
      const webapp = r.container("webapp")!;
      r.edit((s) => {
        const old = JSON.parse(JSON.stringify(webapp));
        old.Id = "f".repeat(64);
        old.Name = "/kinboard-webapp-before-update";
        old.State = { Status: "exited", Running: false, ExitCode: 0 };
        old.Image = WEB1;
        s.containers[old.Id] = old;
      });
      writeFileSync(join(r.updaterDir, "swap"), `phase done\nwebapp ${"f".repeat(64)} kinboard-webapp false unless-stopped ${WEB1} ${NEXT} ${webapp.Id} ${WEB2} 2026-11-27T00:00:00\n`);
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("came up healthy but was cut short");
      expect(r.container("webapp")!.Id).toBe(webapp.Id);
      expect(r.names().some((n) => n.endsWith("-before-update"))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  test("a container already named <name>-before-update that the journal does not know: nothing is renamed or created", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => {
        const c = JSON.parse(JSON.stringify(Object.values(s.containers).find((x: any) => x.Name === "/kinboard-init")));
        c.Id = "9".repeat(64);
        c.Name = "/kinboard-init-before-update";
        c.Config.Labels = { other: "x" };
        s.containers[c.Id] = c;
      });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("a container named kinboard-init-before-update is in the way");
      expect(res.calls.filter((c) => /^api POST|^docker rename/.test(c))).toEqual([]);
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
    } finally {
      r.cleanup();
    }
  });

  test("a release that needs a newer compose file is held here too: nothing backed up or recreated", () => {
    const r = rig();
    try {
      baseline(r);
      r.publish(WEB2, D2, "1.19.0", { revision: "2" });
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("needs compose file revision 2; this file declares 1");
      expect(res.calls.some((c) => c.includes("pg_dumpall"))).toBe(false);
      expect(res.calls.filter((c) => c.startsWith("api POST"))).toEqual([]);
      expect(r.state().tags[NEXT]).toBe(WEB1);
    } finally {
      r.cleanup();
    }
  });

  test("a pinned tag is never asked about and never moves", () => {
    const r = rig({ tag: "1.18.0" });
    try {
      baseline(r);
      r.publish(WEB2, D2, "1.18.1", { ref: `${KB}:1.18.0` });
      for (let i = 0; i < 2; i++) {
        const res = r.run();
        expect(res.log).toContain("=== tick: nothing to do ===");
        expect(res.calls.filter((c) => c.startsWith("curl") && !c.includes("--unix-socket"))).toEqual([]);
      }
      expect(r.container("webapp")!.Image).toBe(WEB1);
    } finally {
      r.cleanup();
    }
  });

  test("the Docker API unreachable: refused before anything is pulled", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.apiDown = true));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("container mode cannot reach the Docker API");
      expect(res.pulls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a stack whose webapp declares no compose revision is not the one-file stack: refused", () => {
    const r = rig();
    try {
      r.edit((s) => {
        const w = Object.values(s.containers).find((x: any) => x.Name === "/kinboard-webapp") as Inspect;
        w.Config.Env = w.Config.Env.filter((e: string) => !e.startsWith("KINBOARD_COMPOSE_REVISION="));
      });
      baseline(r);
      publish2(r);
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("declares no KINBOARD_COMPOSE_REVISION");
      expect(res.calls.filter((c) => c.startsWith("api POST"))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("a git install's legacy stack is never container mode, even with its files gone", () => {
    const r = rig();
    try {
      r.edit((s) => {
        for (const c of Object.values(s.containers) as Inspect[]) {
          c.Config.Labels["com.docker.compose.project.working_dir"] = "/srv/kinboard/webapp/docker";
          c.Config.Labels["com.docker.compose.project.config_files"] = "/srv/kinboard/webapp/docker/docker-compose.yml";
        }
      });
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("kinboard-updater updates a stack started from compose.yml");
      expect(res.log).not.toContain("container mode:");
    } finally {
      r.cleanup();
    }
  });

  // --- what the independent review found -----------------------------------

  test("the tick runs in a sibling without the folders, so recreating the updater does not cut it short", () => {
    const r = rig();
    try {
      baseline(r);
      const runs = readFileSync(join(r.stub, "runs"), "utf8").split("\n").filter((l) => l.includes("app.kinboard.updater-tick=1"));
      expect(runs).toHaveLength(2);
      expect(runs[0]).toContain("--mount type=bind,source=/data/compose/3,target=/data/compose/3,readonly");
      expect(runs[1]).not.toContain("--mount");
      expect(runs[1]).toContain(`--volumes-from ${r.original.updater}`);
      expect(runs[1]).toContain("KINBOARD_CONTAINER_MODE_WHY=the stack's files (/data/compose/3/docker-compose.yml,/data/compose/3/stack.env) are not on this host's disk");
    } finally {
      r.cleanup();
    }
  });

  test("killed mid-swap, then redeployed from the UI (the original removed, a new webapp up): the next tick leaves the household's webapp alone and forgets the swap", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.crash = "start:webapp"));
      expect(r.run().status).not.toBe(0);
      // Portainer's redeploy: Compose removes both webapp containers it finds and creates its own.
      let redeployed = "";
      r.edit((s) => {
        for (const c of Object.values(s.containers) as Inspect[]) if (c.Name.startsWith("/kinboard-webapp")) delete s.containers[c.Id];
        const old = JSON.parse(JSON.stringify(r.container("db")));
        old.Id = "d".repeat(64);
        old.Name = "/kinboard-webapp";
        old.Image = WEB1;
        old.Config.Labels["com.docker.compose.service"] = "webapp";
        old.State = { Status: "running", Running: true };
        s.containers[old.Id] = old;
        redeployed = old.Id;
      });
      const res = r.run();
      expect(res.log).toContain("the original kinboard-webapp");
      expect(res.log).toContain("the stack was changed outside the updater");
      expect(r.container("webapp")!.Id, "the household's webapp is not removed").toBe(redeployed);
      expect(res.calls.filter((c) => c.startsWith("docker rm") && c.includes(redeployed))).toEqual([]);
      expect(res.calls.filter((c) => c.startsWith("api POST"))).toEqual([]);
      // Nothing left for a later tick to act on.
      const journal = join(r.updaterDir, "swap");
      expect(existsSync(journal) ? readFileSync(journal, "utf8") : "").not.toMatch(/^webapp /m);
      const again = r.run();
      expect(r.container("webapp")!.Id).toBe(redeployed);
      expect(again.calls.filter((c) => c.startsWith("docker rm") && c.includes(redeployed))).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("killed mid-swap, then a webapp redeployed under the name while the original is still aside: the household's stays, the stopped original goes (never its volumes)", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      r.edit((s) => (s.crash = "start:webapp"));
      expect(r.run().status).not.toBe(0);
      let theirs = "";
      r.edit((s) => {
        // The new one the update made is replaced by one the household made, from the image it wanted, long before.
        for (const c of Object.values(s.containers) as Inspect[]) if (c.Name === "/kinboard-webapp") delete s.containers[c.Id];
        const c = JSON.parse(JSON.stringify(Object.values(s.containers).find((x: any) => x.Name === "/kinboard-webapp-before-update")));
        c.Id = "e".repeat(64);
        c.Name = "/kinboard-webapp";
        c.State = { Status: "running", Running: true };
        s.containers[c.Id] = c;
        theirs = c.Id;
      });
      const res = r.run();
      expect(res.log).toContain("which this update did not make");
      expect(r.container("webapp")!.Id).toBe(theirs);
      expect(r.names()).not.toContain("kinboard-webapp-before-update");
      expect(r.state().volumesRemoved ?? 0).toBe(0);
    } finally {
      r.cleanup();
    }
  });

  test("the journal cannot be written (a full config volume): nothing is renamed or created", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      mkdirSync(join(r.updaterDir, "swap.tmp"));
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.log).toContain("could not record the swap");
      expect(res.calls.filter((c) => /^api POST|^docker (rename|stop|start)/.test(c))).toEqual([]);
      for (const svc of [...KB_SERVICES, ...OTHERS]) expect(r.container(svc)?.Id, svc).toBe(r.original[svc]);
    } finally {
      r.cleanup();
    }
  });

  test("a journal it cannot deal with stops every tick, and nothing is swapped", () => {
    const r = rig();
    try {
      baseline(r);
      publish2(r);
      writeFileSync(join(r.updaterDir, "swap"), "phase updating\nwebapp not-a-valid-line\n");
      for (let i = 0; i < 2; i++) {
        const res = r.run();
        expect(res.status).toBe(1);
        expect(res.log).toContain("still lists containers it could not deal with");
        expect(res.calls.filter((c) => /^api POST|^docker (rename|stop|start|rm)/.test(c))).toEqual([]);
        expect(res.pulls).toEqual([]);
      }
    } finally {
      r.cleanup();
    }
  });

  test("a secret given to the webapp in the UI's variables is taken out of the log excerpt Settings shows", () => {
    const r = rig();
    try {
      r.edit((s) => {
        const w = Object.values(s.containers).find((x: any) => x.Name === "/kinboard-webapp") as Inspect;
        w.Config.Env.push("KINBOARD_SERVICE_ROLE_KEY=Zm9vYmFyLXNlcnZpY2Utcm9sZQ");
        s.logs = { webapp: "boot with key Zm9vYmFyLXNlcnZpY2Utcm9sZQ\n" };
      });
      baseline(r);
      publish2(r);
      r.behave(WEB2, { webapp: "exit" });
      const res = r.run();
      expect(res.record?.status).toBe("rolled_back");
      expect(String(res.record?.log)).toContain("boot with key [redacted]");
      expect(JSON.stringify(res.record)).not.toContain("Zm9vYmFyLXNlcnZpY2Utcm9sZQ");
    } finally {
      r.cleanup();
    }
  });

  test("compose-file mode with one file missing (the .env gone, the compose file there) is reported, not container mode", () => {
    const r = rig();
    try {
      const wd = join(r.dir, "stack");
      mkdirSync(wd);
      writeFileSync(join(wd, "compose.yml"), "# there\n");
      r.edit((s) => {
        for (const c of Object.values(s.containers) as Inspect[]) {
          c.Config.Labels["com.docker.compose.project.working_dir"] = wd;
          c.Config.Labels["com.docker.compose.project.config_files"] = join(wd, "compose.yml");
          c.Config.Labels["com.docker.compose.project.environment_file"] = join(wd, ".env");
        }
      });
      const res = r.run({ KINBOARD_UPDATER_SIBLING: "1" });
      expect(res.status).toBe(1);
      expect(res.log).toContain(`the stack was started with the env file ${join(wd, ".env")}, which cannot be read here`);
      expect(res.log).not.toContain("container mode");
    } finally {
      r.cleanup();
    }
  });
});
