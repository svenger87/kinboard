import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * kinboard-self-update.sh in container mode (RFC-023 §4.11.3, PR 14): the
 * updater on a Portainer web-editor stack, whose compose file is inside
 * Portainer's volume and not on the host.
 *
 * The whole script runs against helpers/docker-stub-daemon.cjs, a stub daemon
 * behind both `docker` and `curl --unix-socket`, which keeps containers as the
 * Engine API describes them. The stack is created through that same stub's
 * POST /containers/create, from the requests Compose would send for
 * compose.yml (Portainer's labels: /data/compose/3/…), and given more
 * configuration than compose.yml has (a user, a second network with a fixed
 * address and aliases, an anonymous volume, a bind mount, tmpfs, capabilities,
 * extra hosts, DNS, a stop signal and timeout, log options, a label of the
 * household's own) so that every field the copy must keep is there to lose.
 */

export const SCRIPT = resolve("docker/kinboard-self-update.sh");
const DAEMON = resolve("e2e/helpers/docker-stub-daemon.cjs");
const daemon = createRequire(join(process.cwd(), "package.json"))(DAEMON) as {
  create: (s: State, name: string, body: unknown) => [number, { Id: string }];
  start: (s: State, c: Inspect) => string;
};

export const KB = "ghcr.io/svenger87/kinboard";
export const NEXT = `${KB}:next`;
export const PG = "supabase/postgres:15.14.1.159";
export const REST = "postgrest/postgrest:v14.16";
export const GO = "alexxit/go2rtc:1.9.14";
export const UPD = "ghcr.io/svenger87/kinboard-updater:next";
export const PROJECT = "kinboard";
export const NET = "kinboard_kinboard";
export const EXTRA = "kinboard_extra";
export const D1 = `sha256:${"1".repeat(64)}`;
export const D2 = `sha256:${"2".repeat(64)}`;
export const D3 = `sha256:${"3".repeat(64)}`;
/** Image ids, as Docker gives them. */
export const WEB1 = `sha256:${"a1".repeat(32)}`;
export const WEB2 = `sha256:${"b2".repeat(32)}`;
export const WEB3 = `sha256:${"c3".repeat(32)}`;

export type Inspect = Record<string, any>;
export type State = Record<string, any>;

const PATH_ENV = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** A Kinboard image as docker.yml labels it, with the ENV lines the image itself sets. */
export function kinboardImage(id: string, version: string, opts: { revision?: string; digest?: string } = {}) {
  return {
    Id: id,
    RepoTags: [],
    RepoDigests: opts.digest ? [`${KB}@${opts.digest}`] : [],
    Config: {
      User: "root",
      WorkingDir: "/app",
      Env: [PATH_ENV, "NODE_VERSION=22.23.2", `KINBOARD_VERSION=${version}`, "NODE_ENV=production"],
      Entrypoint: ["./webapp-entrypoint.sh"],
      Cmd: null,
      ExposedPorts: { "3000/tcp": {} },
      Healthcheck: { Test: ["CMD-SHELL", 'curl -sf -o /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1'], Interval: 30e9, Timeout: 10e9, StartPeriod: 120e9, Retries: 3 },
      Labels: {
        "app.kinboard.compose-revision": opts.revision ?? "1",
        "org.opencontainers.image.version": version,
        "org.opencontainers.image.revision": `rev-${version}`,
        "org.opencontainers.image.title": "Kinboard",
      },
      StopSignal: "",
    },
    Manifests: [
      { Kind: "image", Available: true, Descriptor: { digest: `sha256:${"e".repeat(48)}${id.slice(-16)}`, platform: { os: "linux", architecture: "amd64" } } },
      { Kind: "image", Available: false, Descriptor: { digest: `sha256:${"f".repeat(48)}${id.slice(-16)}`, platform: { os: "linux", architecture: "arm64" } } },
    ],
  };
}
const plainImage = (id: string, env: string[] = [PATH_ENV]) => ({ Id: id, RepoTags: [], RepoDigests: [], Config: { Env: env, Labels: {}, Entrypoint: null, Cmd: ["run"] } });

/** The Compose labels Portainer's stack 3 gives a service's container. */
function composeLabels(svc: string, imageLabel: string) {
  return {
    "com.docker.compose.config-hash": `hash-${svc}`,
    "com.docker.compose.container-number": "1",
    "com.docker.compose.depends_on": "",
    "com.docker.compose.image": imageLabel,
    "com.docker.compose.oneoff": "False",
    "com.docker.compose.project": PROJECT,
    "com.docker.compose.project.config_files": "/data/compose/3/docker-compose.yml",
    "com.docker.compose.project.environment_file": "/data/compose/3/stack.env",
    "com.docker.compose.project.working_dir": "/data/compose/3",
    "com.docker.compose.service": svc,
    "com.docker.compose.version": "2.27.0",
  };
}
const logging = { Type: "json-file", Config: { "max-file": "3", "max-size": "10m" } };
const endpoint = (name: string, svc: string, extra: string[] = []) => ({ [NET]: { Aliases: [name, svc, ...extra], IPAMConfig: {}, Links: null, DriverOpts: null, GwPriority: 0 } });

/** The create requests Compose sends for compose.yml, Portainer's way, richer where noted. */
function bodies(webImageLabel: string): Record<string, Inspect> {
  return {
    init: {
      Image: NEXT,
      Entrypoint: [
        "/bin/sh",
        "-c",
        'if [ -x /usr/local/bin/kinboard-init ]; then exec /app/webapp-entrypoint.sh kinboard-init; fi; echo "older than 1.18" >&2; exit 1',
      ],
      Env: ["POSTGRES_PASSWORD=", "JWT_SECRET=", "CRON_SECRET=", "VAPID_PUBLIC_KEY=", "VAPID_PRIVATE_KEY="],
      Healthcheck: { Test: ["NONE"] },
      Labels: composeLabels("init", webImageLabel),
      HostConfig: { Binds: ["kinboard-config:/kinboard:rw", "kinboard-db:/kinboard-db:ro"], NetworkMode: NET, RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-init", "init") },
    },
    db: {
      Image: PG,
      Env: ["POSTGRES_PASSWORD_FILE=/kinboard/secrets/postgres_password", "PGPORT=5432"],
      Healthcheck: { Test: ["CMD", "pg_isready", "-U", "postgres"], Interval: 5e9, Timeout: 5e9, Retries: 10 },
      Labels: composeLabels("db", "sha256:db"),
      HostConfig: { Binds: ["kinboard-db:/var/lib/postgresql/data:rw", "kinboard-config:/kinboard:ro"], NetworkMode: NET, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-db", "db") },
    },
    "db-init": {
      Image: NEXT,
      Cmd: ["kinboard-db-init"],
      Healthcheck: { Test: ["NONE"] },
      Labels: composeLabels("db-init", webImageLabel),
      HostConfig: { Binds: ["kinboard-config:/kinboard:ro"], NetworkMode: NET, RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-db-init", "db-init") },
    },
    rest: {
      Image: REST,
      Cmd: ["postgrest"],
      Env: ["PGRST_DB_URI=@/kinboard/secrets/db_uri"],
      Labels: composeLabels("rest", "sha256:rest"),
      HostConfig: { Binds: ["kinboard-config:/kinboard:ro"], NetworkMode: NET, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-rest", "rest") },
    },
    webapp: {
      Image: NEXT,
      // Richer than compose.yml: every field the copy has to keep.
      User: "0:0",
      StopSignal: "SIGINT",
      StopTimeout: 25,
      ExposedPorts: { "3000/tcp": {}, "9229/tcp": {} },
      Env: [
        "TZ=Europe/Berlin",
        "SITE_URL=",
        "KINBOARD_SCHEDULER=internal",
        "KINBOARD_COMPOSE_REVISION=1",
        "POSTGREST_URL=http://rest:3000",
        "FILES_DIR=/var/lib/storage/files",
        "POSTGRES_HOST=db",
        "WEBRTC_LAN_IP=192.168.1.20",
        "NODE_OPTIONS=--max-old-space-size=512",
      ],
      Healthcheck: { Test: ["CMD", "curl", "-sf", "http://localhost:3000/api/health"], Interval: 30e9, Timeout: 5e9, StartPeriod: 30e9, Retries: 3 },
      Labels: { ...composeLabels("webapp", webImageLabel), "traefik.enable": "true", "traefik.http.routers.kinboard.rule": "Host(`board.home`)" },
      HostConfig: {
        Binds: ["kinboard-storage:/var/lib/storage:rw", "kinboard-config:/kinboard:ro", "/srv/photos:/photos:ro"],
        Mounts: [{ Type: "volume", Target: "/app/.next/cache", VolumeOptions: {} }],
        Tmpfs: { "/run/kb": "size=1m" },
        CapAdd: ["NET_ADMIN"],
        ExtraHosts: ["ha.local:192.168.1.5"],
        Dns: ["192.168.1.1"],
        PortBindings: { "3000/tcp": [{ HostIp: "", HostPort: "3001" }], "9229/tcp": [{ HostIp: "127.0.0.1", HostPort: "9229" }] },
        NetworkMode: NET,
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        LogConfig: { Type: "json-file", Config: { "max-file": "3", "max-size": "10m", tag: "kinboard" } },
        Init: true,
      },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-webapp", "webapp", ["board"]) },
    },
    go2rtc: {
      Image: GO,
      Cmd: ["go2rtc", "-config", "{webrtc: {candidates: [':8555']}}"],
      Labels: composeLabels("go2rtc", "sha256:go2rtc"),
      HostConfig: { NetworkMode: NET, PortBindings: { "8555/udp": [{ HostIp: "", HostPort: "8555" }] }, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-go2rtc", "go2rtc") },
    },
    updater: {
      Image: UPD,
      Entrypoint: ["kinboard-updater"],
      Env: ["TZ=Europe/Berlin", "KINBOARD_UPDATER=1"],
      Labels: composeLabels("updater", "sha256:upd"),
      HostConfig: { Binds: ["/var/run/docker.sock:/var/run/docker.sock:rw", "kinboard-config:/kinboard:rw"], NetworkMode: NET, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, LogConfig: logging },
      NetworkingConfig: { EndpointsConfig: endpoint("kinboard-updater", "updater") },
    },
  };
}

export type RunResult = {
  status: number | null;
  out: string;
  log: string;
  calls: string[];
  pulls: string[];
  record: Record<string, unknown> | null;
  recordKey: string | null;
  tags: string[];
  state: string;
};

export class CmRig {
  readonly dir = mkdtempSync(join(tmpdir(), "updater-cm-"));
  readonly stub = join(this.dir, "stub");
  readonly bin = join(this.dir, "bin");
  readonly updaterDir = join(this.dir, "config", "updater");
  /** The container ids the stack started with, by service. */
  readonly original: Record<string, string> = {};

  constructor(opts: { webVersion?: string; services?: string[]; tag?: string } = {}) {
    mkdirSync(this.stub, { recursive: true });
    mkdirSync(this.bin, { recursive: true });
    for (const t of ["docker", "curl"]) {
      writeFileSync(join(this.bin, t), `#!/bin/sh\nexec node "${DAEMON}" ${t} "$@"\n`);
      chmodSync(join(this.bin, t), 0o755);
    }
    const ref = opts.tag ? `${KB}:${opts.tag}` : NEXT;
    const web1 = kinboardImage(WEB1, opts.webVersion ?? "1.18.0", { digest: D1 });
    const s: State = {
      containers: {},
      images: {
        [WEB1]: web1,
        "sha256:db": plainImage("sha256:db", [PATH_ENV, "PGDATA=/var/lib/postgresql/data"]),
        "sha256:rest": plainImage("sha256:rest"),
        "sha256:go2rtc": plainImage("sha256:go2rtc"),
        "sha256:upd": plainImage("sha256:upd"),
      },
      tags: { [ref]: WEB1, [PG]: "sha256:db", [REST]: "sha256:rest", [GO]: "sha256:go2rtc", [UPD]: "sha256:upd" },
      registry: { [ref]: WEB1 },
      remote: { [ref]: D1 },
      networks: { [NET]: { Id: "a".repeat(64), Name: NET }, [EXTRA]: { Id: "b".repeat(64), Name: EXTRA } },
      volumes: ["kinboard-db", "kinboard-storage", "kinboard-config"],
      behave: {},
      hop: "missing",
    };
    const b = bodies(web1.Manifests[0].Descriptor.digest);
    if (ref !== NEXT) for (const k of ["init", "db-init", "webapp"]) b[k].Image = ref;
    // The webapp is on a second network too, with a fixed address and an alias of its own.
    b.webapp.NetworkingConfig.EndpointsConfig[EXTRA] = { Aliases: ["kinboard-webapp", "webapp", "dashboard"], IPAMConfig: { IPv4Address: "10.239.9.50" }, Links: null, DriverOpts: null, GwPriority: 0 };
    const order = opts.services ?? ["init", "db", "db-init", "rest", "webapp", "go2rtc", "updater"];
    for (const svc of order) {
      const body = b[svc];
      // The daemon takes one network at create; Compose connects the others after.
      const eps = body.NetworkingConfig.EndpointsConfig;
      const rest = Object.fromEntries(Object.entries(eps).filter(([k]) => k !== NET));
      body.NetworkingConfig.EndpointsConfig = { [NET]: eps[NET] };
      const [code, res] = daemon.create(s, `kinboard-${svc}`, body);
      if (code !== 201) throw new Error(`create ${svc}: ${JSON.stringify(res)}`);
      const c = s.containers[res.Id];
      for (const [net, ep] of Object.entries(rest)) {
        c.NetworkSettings.Networks[net] = { ...(ep as object), NetworkID: s.networks[net].Id, EndpointID: "x", IPAddress: (ep as any).IPAMConfig?.IPv4Address ?? "10.99.1.2", MacAddress: "02:42:00:00:00:01", DNSNames: [] };
      }
      const err = daemon.start(s, c);
      if (err) throw new Error(err);
      this.original[svc] = res.Id;
    }
    this.save(s);
  }

  state(): State {
    return JSON.parse(readFileSync(join(this.stub, "state.json"), "utf8"));
  }
  save(s: State) {
    writeFileSync(join(this.stub, "state.json"), JSON.stringify(s, null, 1));
  }
  edit(f: (s: State) => void) {
    const s = this.state();
    f(s);
    this.save(s);
  }

  /** The container named kinboard-<svc> now, as the API describes it. */
  container(svc: string): Inspect | null {
    return (Object.values(this.state().containers) as Inspect[]).find((c) => c.Name === `/kinboard-${svc}`) ?? null;
  }
  /** Every container's name. */
  names(): string[] {
    return (Object.values(this.state().containers) as Inspect[]).map((c) => c.Name.slice(1)).sort();
  }

  /** The registry serves image id (pulled as digest) under ref, with this version. */
  publish(id: string, digest: string, version: string, opts: { revision?: string; ref?: string } = {}) {
    const ref = opts.ref ?? NEXT;
    this.edit((s) => {
      s.images[id] = kinboardImage(id, version, { digest, revision: opts.revision });
      s.registry[ref] = id;
      s.remote[ref] = digest;
    });
  }
  /** How containers of image id behave: the webapp "exit"s, or a one-shot exits with a code. */
  behave(id: string, b: Record<string, string | number>) {
    this.edit((s) => (s.behave[id] = b));
  }

  run(env: Record<string, string> = {}): RunResult {
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    for (const f of ["calls", "pulls", "status", "status-key", "tags", "runs", "curls"]) rmSync(join(this.stub, f), { force: true });
    const logFile = join(this.updaterDir, "update.log");
    const before = read(logFile).length;
    const res = spawnSync("sh", [SCRIPT, "--tick"], {
      encoding: "utf8",
      timeout: 120_000,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        PATH: `${this.bin}:${process.env.PATH}`,
        STUB: this.stub,
        STUB_SCRIPT: SCRIPT,
        KINBOARD_UPDATER: "1",
        KINBOARD_UPDATER_DIR: this.updaterDir,
        KINBOARD_SELF_CONTAINER: this.original.updater,
        LOG_FILE: "",
        PROJECT_DIR: "",
        COMPOSE_FILES: "",
        KINBOARD_HEALTH_TIMEOUT: "3",
        KINBOARD_HEALTH_POLL: "0.1",
        KINBOARD_SMOKE_TIMEOUT: "2",
        ...env,
      },
    });
    const status = read(join(this.stub, "status"));
    return {
      status: res.status,
      out: (res.stdout ?? "") + (res.stderr ?? ""),
      log: read(logFile).slice(before),
      calls: read(join(this.stub, "calls")).split("\n").filter(Boolean),
      pulls: read(join(this.stub, "pulls")).split("\n").filter(Boolean),
      record: status ? (JSON.parse(status) as Record<string, unknown>) : null,
      recordKey: read(join(this.stub, "status-key")).trim() || (status ? "update_status" : null),
      tags: read(join(this.stub, "tags")).split("\n").filter(Boolean),
      state: read(join(this.updaterDir, "state")),
    };
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * A container's configuration with what Docker derives from its id, its run
 * and its image left out: what must come through a recreate unchanged.
 */
export function ownConfig(c: Inspect) {
  const x = JSON.parse(JSON.stringify(c));
  for (const k of ["Id", "Created", "State", "Path", "Args", "ResolvConfPath", "HostnamePath", "HostsPath", "LogPath", "RestartCount", "Image"]) delete x[k];
  delete x.NetworkSettings.SandboxID;
  delete x.NetworkSettings.SandboxKey;
  for (const ep of Object.values(x.NetworkSettings.Networks) as Inspect[]) {
    for (const k of ["EndpointID", "MacAddress", "DNSNames"]) delete ep[k];
    // An address is the container's own only when it is fixed.
    if (!ep.IPAMConfig?.IPv4Address) delete ep.IPAddress;
  }
  if (x.Config.Hostname === c.Id.slice(0, 12)) delete x.Config.Hostname;
  // An anonymous volume is named once it exists; a copy names it explicitly,
  // so that the same volume is mounted again.
  for (const m of x.HostConfig.Mounts ?? []) {
    if (m.Type === "volume" && !m.Source) m.Source = c.Mounts.find((n: Inspect) => n.Destination === m.Target)?.Name;
  }
  x.Mounts = [...x.Mounts].sort((a: Inspect, b: Inspect) => a.Destination.localeCompare(b.Destination));
  return x;
}
