import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ownConfig, type Inspect, type State } from "./helpers/updater-container-stub";

/**
 * RFC-023 PR 14: container mode's copy of a container, CM_CREATE_JQ in
 * kinboard-self-update.sh, run with the real jq on `docker inspect` output
 * from real containers: the stack compose.yml makes, deployed through
 * Portainer CE 2.21's API (its Compose 2.32), captured in
 * e2e/fixtures/container-mode/ (init, db-init, webapp and their image).
 *
 * The create request it builds goes through the stub daemon's create
 * (helpers/docker-stub-daemon.cjs, which merges the image's config in as the
 * daemon does), and what comes back must be the same container but for its
 * id and its image.
 */

const script = readFileSync(resolve("docker/kinboard-self-update.sh"), "utf8");
const JQ = (() => {
  const m = script.match(/^CM_CREATE_JQ='\n([\s\S]*?)^'$/m);
  if (!m) throw new Error("CM_CREATE_JQ not found");
  return m[1];
})();
const daemon = createRequire(join(process.cwd(), "package.json"))(resolve("e2e/helpers/docker-stub-daemon.cjs")) as {
  create: (s: State, name: string, body: unknown) => [number, { Id: string; message?: string }];
};
const FIX = resolve("e2e/fixtures/container-mode");
const fixture = (n: string): Inspect => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8"));
const IMAGE = fixture("image");

type Spec = { name: string; body: Inspect; connect: { network: string; name: string; body: Inspect }[] };

/** CM_CREATE_JQ on container c and image i. */
function build(c: Inspect, i: Inspect = IMAGE, composeimage = "sha256:new"): Spec {
  const dir = mkdtempSync(join(tmpdir(), "cm-copy-"));
  try {
    writeFileSync(join(dir, "c.json"), JSON.stringify(c));
    writeFileSync(join(dir, "i.json"), JSON.stringify(i));
    const out = execFileSync("jq", ["-n", "--slurpfile", "c", join(dir, "c.json"), "--slurpfile", "i", join(dir, "i.json"), "--arg", "ref", c.Config.Image, "--arg", "composeimage", composeimage, JQ], { encoding: "utf8" });
    return JSON.parse(out) as Spec;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The stub daemon with this image under the container's reference, and the container's networks. */
function daemonFor(c: Inspect): State {
  const networks: Record<string, Inspect> = {};
  for (const [name, ep] of Object.entries(c.NetworkSettings.Networks as Record<string, Inspect>)) networks[name] = { Id: ep.NetworkID, Name: name };
  return { containers: {}, images: { [IMAGE.Id]: IMAGE }, tags: { [c.Config.Image]: IMAGE.Id }, networks, volumes: [] };
}

/** Created through the stub daemon from the request, as the updater does: create, then connect. */
function roundTrip(c: Inspect): Inspect {
  const s = daemonFor(c);
  const spec = build(c, IMAGE, c.Config.Labels["com.docker.compose.image"]);
  const [code, res] = daemon.create(s, spec.name, spec.body);
  expect(code, JSON.stringify(res)).toBe(201);
  const made = s.containers[res.Id];
  for (const k of spec.connect) {
    const ep = k.body.EndpointConfig;
    made.NetworkSettings.Networks[k.name] = { ...ep, NetworkID: k.network, IPAddress: ep.IPAMConfig?.IPv4Address ?? "x" };
  }
  return made;
}

/** What Docker reports about a container that a create request controls. */
function settings(c: Inspect) {
  const x = ownConfig(c);
  // Fields the API reports but a create does not take, or that describe the run.
  for (const k of ["Driver", "Platform", "MountLabel", "ProcessLabel", "AppArmorProfile", "ExecIDs", "ImageManifestDescriptor", "Storage"]) delete x[k];
  delete x.NetworkSettings.Ports;
  for (const k of Object.keys(x.NetworkSettings)) if (k !== "Networks") delete x.NetworkSettings[k];
  for (const ep of Object.values(x.NetworkSettings.Networks) as Inspect[]) {
    for (const k of Object.keys(ep)) if (!["IPAMConfig", "Links", "Aliases", "DriverOpts", "GwPriority", "NetworkID"].includes(k)) delete ep[k];
    if (ep.Aliases) ep.Aliases = ep.Aliases.filter((a: string) => !/^[0-9a-f]{12}$/.test(a));
  }
  x.Mounts = x.Mounts.map((m: Inspect) => ({ Type: m.Type, Name: m.Name, Source: m.Type === "bind" ? m.Source : undefined, Destination: m.Destination, RW: m.RW }));
  return x;
}

test.describe("container mode's copy of a real container (RFC-023 PR 14)", () => {
  for (const svc of ["init", "db-init", "webapp"]) {
    test(`${svc}: inspect → create request → created again gives the same container, image and id aside`, () => {
      const before = fixture(svc);
      const after = roundTrip(before);
      expect(settings(after)).toEqual(settings(before));
    });
  }

  test("each field, spelled out, on the webapp", () => {
    const c = fixture("webapp");
    const { body, name, connect } = build(c);
    expect(name).toBe("kbpt-webapp");
    // Only what the image did not supply, every one of them.
    const fromImage = new Set(IMAGE.Config.Env);
    expect(body.Env).toEqual(c.Config.Env.filter((e: string) => !fromImage.has(e)));
    expect(body.Env).toEqual(expect.arrayContaining(["KINBOARD_COMPOSE_REVISION=1", "POSTGREST_URL=http://rest:3000", "TZ=Europe/Berlin", "SITE_URL="]));
    expect(body.Env.some((e: string) => e.startsWith("NODE_VERSION=") || e.startsWith("KINBOARD_RIG_BUILD="))).toBe(false);
    for (const k of Object.keys(c.Config.Labels)) {
      if (k === "com.docker.compose.image") expect(body.Labels[k]).toBe("sha256:new");
      else if (IMAGE.Config.Labels?.[k] === c.Config.Labels[k]) expect(body.Labels[k], k).toBeUndefined();
      else expect(body.Labels[k], k).toBe(c.Config.Labels[k]);
    }
    expect(body.Labels["com.docker.compose.project"]).toBe("kbpt");
    expect(body.Labels["com.docker.compose.service"]).toBe("webapp");
    expect(body.HostConfig).toEqual(c.HostConfig);
    expect(body.HostConfig.RestartPolicy).toEqual({ Name: "unless-stopped", MaximumRetryCount: 0 });
    expect(body.HostConfig.LogConfig).toEqual({ Type: "json-file", Config: { "max-file": "3", "max-size": "10m" } });
    expect(body.HostConfig.PortBindings).toEqual({ "3000/tcp": [{ HostIp: "", HostPort: "3078" }] });
    expect(body.Healthcheck).toEqual(c.Config.Healthcheck);
    expect(body.Entrypoint).toBeNull();
    expect(body.Cmd).toBeNull();
    expect(body.User).toBe("");
    expect(body.Hostname).toBe("");
    expect(body.Image).toBe(c.Config.Image);
    const net = c.HostConfig.NetworkMode;
    expect(Object.keys(body.NetworkingConfig.EndpointsConfig)).toEqual([net]);
    expect(body.NetworkingConfig.EndpointsConfig[net].Aliases).toEqual(["kbpt-webapp", "webapp"]);
    expect(connect).toEqual([]);
  });

  test("init and db-init: their entrypoint and command as Compose set them, the healthcheck off", () => {
    const init = build(fixture("init")).body;
    expect(init.Entrypoint).toEqual(fixture("init").Config.Entrypoint);
    expect(init.Entrypoint[0]).toBe("/bin/sh");
    expect(init.Cmd).toBeNull();
    expect(init.Healthcheck.Test).toEqual(["NONE"]);
    const dbinit = build(fixture("db-init")).body;
    expect(dbinit.Entrypoint).toBeNull();
    expect(dbinit.Cmd).toEqual(["kinboard-db-init"]);
  });

  test("a volume from volumes_from is not mounted a second time (Docker would refuse the duplicate)", () => {
    const c = fixture("webapp");
    c.HostConfig.VolumesFrom = ["other"];
    c.Mounts.push({ Type: "volume", Name: "f".repeat(64), Source: "/var/lib/docker/volumes/x/_data", Destination: "/shared", Driver: "local", RW: true });
    const { body } = build(c);
    expect(body.HostConfig.VolumesFrom).toEqual(["other"]);
    expect((body.HostConfig.Mounts ?? []).filter((m: Inspect) => m.Target === "/shared")).toEqual([]);
  });

  test("an image's anonymous VOLUME is mounted again by its name", () => {
    const c = fixture("webapp");
    c.Config.Volumes = { "/cache": {} };
    c.Mounts.push({ Type: "volume", Name: "a".repeat(64), Source: "/var/lib/docker/volumes/a/_data", Destination: "/cache", Driver: "local", RW: true });
    const { body } = build(c);
    expect(body.HostConfig.Mounts.filter((m: Inspect) => m.Target === "/cache")).toEqual([{ Type: "volume", Source: "a".repeat(64), Target: "/cache", ReadOnly: false }]);
    expect(body.HostConfig.Mounts.slice(0, -1), "the stack's own mounts as they were").toEqual(c.HostConfig.Mounts);
  });

  test("network_mode default is the bridge network, not a second one to connect", () => {
    const c = fixture("webapp");
    const ep = c.NetworkSettings.Networks[c.HostConfig.NetworkMode];
    c.HostConfig.NetworkMode = "default";
    c.NetworkSettings.Networks = { bridge: { ...ep, Aliases: null } };
    const { body, connect } = build(c);
    expect(Object.keys(body.NetworkingConfig.EndpointsConfig)).toEqual(["bridge"]);
    expect(connect).toEqual([]);
  });

  test("network_mode container:<id> takes no hostname", () => {
    const c = fixture("webapp");
    c.HostConfig.NetworkMode = `container:${"9".repeat(64)}`;
    c.Config.Hostname = "somehost";
    expect(build(c).body.Hostname).toBe("");
  });
});
