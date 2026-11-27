import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Inspect, RunResult, State } from "./updater-container-stub";

/**
 * kinboard-self-update.sh beside the all-in-one image (RFC-024 §4.7): one
 * container, kinboard-aio, made by Unraid's template (no Compose labels at
 * all), next to kinboard-updater started the same way, and two containers
 * that are none of Kinboard's business (another app's PostgreSQL and a media
 * server). The same stub daemon as container mode
 * (helpers/docker-stub-daemon.cjs), the same script.
 */

const SCRIPT = resolve("docker/kinboard-self-update.sh");
const DAEMON = resolve("e2e/helpers/docker-stub-daemon.cjs");
const daemon = createRequire(join(process.cwd(), "package.json"))(DAEMON) as {
  create: (s: State, name: string, body: unknown) => [number, { Id: string }];
  start: (s: State, c: Inspect) => string;
};

export const AIO = "ghcr.io/svenger87/kinboard-aio";
export const NEXT = `${AIO}:next`;
export const UPD = "ghcr.io/svenger87/kinboard-updater:next";
export const NAME = "Kinboard";
export const D1 = `sha256:${"1".repeat(64)}`;
export const D2 = `sha256:${"2".repeat(64)}`;
export const D3 = `sha256:${"3".repeat(64)}`;
export const AIO1 = `sha256:${"a1".repeat(32)}`;
export const AIO2 = `sha256:${"b2".repeat(32)}`;
export const AIO3 = `sha256:${"c3".repeat(32)}`;

const PATH_ENV = "PATH=/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * An all-in-one image as webapp/image/aio/Dockerfile builds it: its ENV lines,
 * /init, the health check, and (unless `label: false`, an image published
 * before it) the app.kinboard.aio label.
 */
export function aioImage(id: string, version: string, opts: { digest?: string; pg?: string; label?: boolean } = {}) {
  return {
    Id: id,
    RepoTags: [],
    RepoDigests: opts.digest ? [`${AIO}@${opts.digest}`] : [],
    Config: {
      User: "root",
      WorkingDir: "/app",
      Env: [
        PATH_ENV,
        "NODE_ENV=production",
        "KINBOARD_AIO=1",
        "KINBOARD_DATA=/data",
        `PG_MAJOR=${opts.pg ?? "17"}`,
        "KINBOARD_SECRETS_DIR=/data/config/secrets",
        "KINBOARD_MIGRATE_BACKUP_DIR=/data/backups",
        "TZ=Europe/Berlin",
        "PUID=1000",
        "PGID=1000",
      ],
      Entrypoint: ["/init"],
      Cmd: null,
      ExposedPorts: { "3000/tcp": {} },
      Volumes: { "/data": {} },
      Healthcheck: { Test: ["CMD-SHELL", 'curl -sf -o /dev/null "http://127.0.0.1:3000/api/health" || exit 1'], Interval: 30e9, Timeout: 10e9, StartPeriod: 300e9, Retries: 3 },
      Labels: {
        ...(opts.label === false ? {} : { "app.kinboard.aio": "1" }),
        "app.kinboard.compose-revision": "1",
        "org.opencontainers.image.version": version,
        "org.opencontainers.image.title": "Kinboard (all-in-one)",
      },
      StopSignal: "SIGTERM",
    },
  };
}
const plainImage = (id: string, env: string[] = [PATH_ENV]) => ({ Id: id, RepoTags: [], RepoDigests: [], Config: { Env: env, Labels: {}, Entrypoint: null, Cmd: ["run"] } });

/** What Unraid's dockerMan sends for the template (xmlToCommand): its labels, no restart policy, a bind for /data. */
function aioBody(ref: string, name = NAME, data = "/mnt/user/appdata/kinboard", port = "3001") {
  return {
    Image: ref,
    Env: ["TZ=Europe/Berlin", "HOST_OS=Unraid", `HOST_HOSTNAME=tower`, `HOST_CONTAINERNAME=${name}`, "SITE_URL=", "PUID=99", "PGID=100", "INSTANCE_ADMIN_FAMILY_ID=", "GO2RTC_URL="],
    Labels: {
      "net.unraid.docker.managed": "dockerman",
      "net.unraid.docker.webui": "http://[IP]:[PORT:3000]/",
      "net.unraid.docker.icon": "https://raw.githubusercontent.com/svenger87/kinboard/main/assets/logos/kinboard-logo-icon-512.png",
    },
    StopTimeout: 60,
    HostConfig: {
      Binds: [`${data}:/data:rw`],
      PortBindings: { "3000/tcp": [{ HostIp: "", HostPort: port }] },
      NetworkMode: "bridge",
      RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      LogConfig: { Type: "json-file", Config: { "max-file": "1", "max-size": "50m" } },
    },
    NetworkingConfig: { EndpointsConfig: { bridge: { Aliases: null, IPAMConfig: null, Links: null, DriverOpts: null } } },
  };
}

export class AioRig {
  readonly dir = mkdtempSync(join(tmpdir(), "updater-aio-"));
  readonly stub = join(this.dir, "stub");
  readonly bin = join(this.dir, "bin");
  readonly updaterDir = join(this.dir, "kinboard", "updater");
  /** The ids the host started with, by container name. */
  readonly original: Record<string, string> = {};

  constructor(opts: { label?: boolean; updaterVolume?: boolean; secondAio?: boolean; tag?: string } = {}) {
    mkdirSync(this.stub, { recursive: true });
    mkdirSync(this.bin, { recursive: true });
    for (const t of ["docker", "curl"]) {
      writeFileSync(join(this.bin, t), `#!/bin/sh\nexec node "${DAEMON}" ${t} "$@"\n`);
      chmodSync(join(this.bin, t), 0o755);
    }
    const ref = opts.tag ? `${AIO}:${opts.tag}` : NEXT;
    const s: State = {
      containers: {},
      images: {
        [AIO1]: aioImage(AIO1, "1.18.0", { digest: D1, label: opts.label }),
        "sha256:upd": plainImage("sha256:upd", [PATH_ENV, "KINBOARD_UPDATER=1"]),
        "sha256:pg": plainImage("sha256:pg", [PATH_ENV, "PGDATA=/var/lib/postgresql/data", "KINBOARD_AIO=0"]),
        "sha256:plex": plainImage("sha256:plex"),
      },
      tags: { [ref]: AIO1, [UPD]: "sha256:upd", "postgres:16": "sha256:pg", "plexinc/pms-docker:latest": "sha256:plex" },
      registry: { [ref]: AIO1 },
      remote: { [ref]: D1 },
      networks: { bridge: { Id: "c".repeat(64), Name: "bridge" } },
      volumes: [],
      behave: {},
    };
    const bodies: Record<string, Inspect> = {
      [NAME]: aioBody(ref),
      "kinboard-updater": {
        Image: UPD,
        Entrypoint: ["kinboard-updater"],
        Env: ["TZ=Europe/Berlin", "KINBOARD_UPDATER=1"],
        Labels: { "net.unraid.docker.managed": "dockerman" },
        HostConfig: {
          Binds: ["/var/run/docker.sock:/var/run/docker.sock:rw", ...(opts.updaterVolume === false ? [] : [`${join(this.dir, "kinboard")}:${join(this.dir, "kinboard")}:rw`])],
          NetworkMode: "bridge",
          RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
        },
        NetworkingConfig: { EndpointsConfig: { bridge: {} } },
      },
      postgres: {
        Image: "postgres:16",
        Env: ["POSTGRES_PASSWORD=hunter2hunter2"],
        HostConfig: { Binds: ["/mnt/user/appdata/postgres:/var/lib/postgresql/data:rw"], NetworkMode: "bridge", RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 } },
        NetworkingConfig: { EndpointsConfig: { bridge: {} } },
      },
      plex: {
        Image: "plexinc/pms-docker:latest",
        HostConfig: { NetworkMode: "bridge", RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 } },
        NetworkingConfig: { EndpointsConfig: { bridge: {} } },
      },
    };
    if (opts.secondAio) bodies["Kinboard-Grandma"] = aioBody(ref, "Kinboard-Grandma", "/mnt/user/appdata/kinboard-grandma", "3002");
    for (const [name, body] of Object.entries(bodies)) {
      const [code, res] = daemon.create(s, name, body);
      if (code !== 201) throw new Error(`create ${name}: ${JSON.stringify(res)}`);
      const err = daemon.start(s, s.containers[res.Id]);
      if (err) throw new Error(err);
      this.original[name] = res.Id;
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
  container(name: string): Inspect | null {
    return (Object.values(this.state().containers) as Inspect[]).find((c) => c.Name === `/${name}`) ?? null;
  }
  names(): string[] {
    return (Object.values(this.state().containers) as Inspect[]).map((c) => c.Name.slice(1)).sort();
  }
  /** The registry serves image id (pulled as digest) under ref. */
  publish(id: string, digest: string, version: string, opts: { pg?: string; ref?: string } = {}) {
    const ref = opts.ref ?? NEXT;
    this.edit((s) => {
      s.images[id] = aioImage(id, version, { digest, pg: opts.pg });
      s.registry[ref] = id;
      s.remote[ref] = digest;
    });
  }
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
        KINBOARD_SELF_CONTAINER: this.original["kinboard-updater"],
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
