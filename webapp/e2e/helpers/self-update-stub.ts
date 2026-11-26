import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the whole kinboard-self-update.sh against a real git checkout (a bare
 * origin, a clone, optionally a release commit to pull) and a stub `docker`
 * that keeps its containers, images and registry in files.
 *
 * - A plain `up` (no --no-recreate) recreates every service it is given, as a
 *   mismatched Compose did on a real stack (#534).
 * - `compose pull` copies what the stub registry holds under each reference
 *   onto "disk"; with `offline` it fails as a daemon without network does.
 * - A container's state for the health wait comes from its image id
 *   (`health`), so a "broken release" is an image whose containers exit.
 * - `docker exec … psql` records the status record and answers the
 *   "Try again" question from `retry`.
 *
 * Used by self-update-recreates-only-changes.spec.ts and
 * self-update-health-rollback.spec.ts.
 */

export const SCRIPT = resolve("docker/kinboard-self-update.sh");

const STUB_DOCKER = String.raw`#!/bin/sh
echo "docker $*" >> "$STUB/calls"
esc() { printf '%s' "$1" | tr '/:@' '___'; }
now() { date -u +%Y-%m-%dT%H:%M:%S.000000000Z; }
make() { # service: a new container from the definition in ./stack.txt
  ref="$(awk -v s="$1" '$1 == s { print $2 }' ./stack.txt)"
  f="$STUB/images/$(esc "$ref")"
  # up pulls an image that is not on disk yet
  [ -f "$f" ] || { [ -f "$STUB/registry/$(esc "$ref")" ] && cp "$STUB/registry/$(esc "$ref")" "$f"; }
  id="$(cat "$f" 2>/dev/null || echo missing)"
  printf '%s|%s|%s\n' "$ref" "$id" "$(now)" > "$STUB/containers/$1"
  # a new container is a new id
  echo $(( $(cat "$STUB/gen-$1" 2>/dev/null || echo 0) + 1 )) > "$STUB/gen-$1"
}
cid() { printf '%s' "$1" | sed 's/^cid-//; s/-g[0-9]*$//'; }
if [ "$1" = compose ]; then
  shift
  while [ "$1" = -f ]; do shift 2; done
  sub="$1"; shift
  last=""; for a in "$@"; do last="$a"; done
  case "$sub" in
    config)
      case "$*" in
        --services) awk '{ print $1 }' ./stack.txt ;;
        --images) awk '{ print $2 }' ./stack.txt ;;
        --hash=*) [ -f "$STUB/hashfail" ] && exit 1; awk '{ print $1, $3 }' ./stack.txt ;;
        "") echo "name: t"; echo "services:"
            awk '{ print "  " $1 ":"; print "    environment:"; print "      NOTE: \"image: not-this\""; print "    image: " $2 }' ./stack.txt
            echo "networks:"; echo "  kinboard:"; echo "    image: not-a-service" ;;
      esac ;;
    ps) [ -f "$STUB/containers/$last" ] && echo "cid-$last-g$(cat "$STUB/gen-$last" 2>/dev/null || echo 0)" ;;
    pull)
      if [ -f "$STUB/offline" ]; then
        echo 'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host' >&2
        exit 1
      fi
      if [ -f "$STUB/ratelimit" ]; then
        echo 'Error response from daemon: toomanyrequests: retry-after: 0.001s' >&2
        exit 1
      fi
      for ref in $(awk '{ print $2 }' ./stack.txt); do
        r="$STUB/registry/$(esc "$ref")"
        [ -f "$r" ] && cp "$r" "$STUB/images/$(esc "$ref")"
      done
      echo pulled >> "$STUB/pulls" ;;
    up)
      svcs=""; skipnext=""
      for a in "$@"; do
        if [ -n "$skipnext" ]; then skipnext=""; continue; fi
        case "$a" in --pull) skipnext=1 ;; -*) ;; *) svcs="$svcs $a" ;; esac
      done
      for s in $svcs; do
        if [ ! -f "$STUB/containers/$s" ]; then make "$s"
        else case "$*" in
          *--no-recreate*) ;;
          *) make "$s"; echo "$s" >> "$STUB/recreated" ;;
        esac; fi
      done ;;
  esac
  exit 0
fi
case "$1" in
  inspect)
    f="$STUB/containers/$(cid "$4")"; [ -f "$f" ] || exit 1
    IFS='|' read -r ref id created < "$f"
    case "$3" in
      *State.Status*) cat "$STUB/health/$(esc "$id")" 2>/dev/null || echo "running|healthy|0|0|unless-stopped" ;;
      *Config.Image*) echo "$ref" ;;
      *Created*) echo "$created" ;;
      *.Image*) echo "$id" ;;
    esac ;;
  image)
    case "$4" in
      *Labels*) cat "$STUB/versions/$(esc "$5")" 2>/dev/null || echo "<no value>" ;;
      *RepoDigests*) echo "" ;;
      *)
        case "$5" in
          sha256:*) [ -f "$STUB/gone/$(esc "$5")" ] && exit 1; echo "$5" ;;
          *) f="$STUB/images/$(esc "$5")"; [ -f "$f" ] || exit 1; cat "$f" ;;
        esac ;;
    esac ;;
  tag) echo "$2" > "$STUB/images/$(esc "$3")"; echo "$2 $3" >> "$STUB/tags" ;;
  logs) for a in "$@"; do last="$a"; done; cat "$STUB/logs/$(cid "$last")" 2>/dev/null ;;
  container) exit 1 ;;
  exec)
    case "$*" in
      *curl*deep=1*)
        f="$STUB/containers/$(cid "$2")"; IFS='|' read -r ref id created < "$f"
        r="$(cat "$STUB/smoke/$(esc "$id")" 2>/dev/null || echo '200|{"deep":{"ok":true,"missing":[],"write":true}}')"
        printf '%s\n%s\n' "$(printf '%s' "$r" | cut -d'|' -f2-)" "$(printf '%s' "$r" | cut -d'|' -f1)" ;;
      *pg_dumpall*)
        echo "CREATE SCHEMA auth;"; i=0; while [ $i -lt 60 ]; do echo "CREATE TABLE t$i ();"; i=$((i + 1)); done ;;
      *psql*)
        case "$*" in *" -i "*) cat >> "$STUB/psql" ;; esac
        for a in "$@"; do case "$a" in v=*) printf '%s' "$a" | cut -c3- > "$STUB/status" ;; esac; done
        case "$*" in
          *"SELECT value"*update_retry*) cat "$STUB/retry" 2>/dev/null ;;
          *"DELETE"*update_retry*) rm -f "$STUB/retry" ;;
        esac ;;
    esac ;;
  run)
    case "$*" in *" -i "*) cat > /dev/null ;; esac
    case "$*" in *"grep -vc"* | *"wc -l"*) echo 0 ;; esac ;;
esac
exit 0
`;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: string) => s.replace(/[/:@]/g, "_");

export type Service = { ref: string; def?: string };
export type Container = { ref: string; id: string; created?: string };
export type Scenario = {
  /** The definition in the checkout when the run starts. */
  stack: Record<string, Service>;
  /** A newer definition on origin/main, which the run pulls. */
  pulled?: Record<string, Service>;
  /** The containers as they run: image reference, image id, created. */
  containers: Record<string, Container>;
  /** Image reference -> id of the image on disk now. */
  images: Record<string, string>;
  /** Image reference -> id the registry serves under it. */
  registry?: Record<string, string>;
  /** Contents of .git/kinboard-update-hashes before the run, if any. */
  hashesFile?: string;
  /** Contents of .git/kinboard-update-state before the run, if any. */
  stateFile?: string;
  /** Another run holds the lock. */
  locked?: boolean;
  /** A tick holds the lock for about a second when the run starts. */
  tickRunning?: boolean;
};

export type Health = { status: string; health?: string; restarts?: number; code?: number; policy?: string };

export type RunResult = {
  status: number | null;
  out: string;
  /** Services the stub recreated in this run, sorted. */
  recreated: string[];
  calls: string[];
  /** Number of `compose pull`s that got through in this run. */
  pulls: number;
  hashesFile: string | null;
  state: string;
  /** The status record written in this run, parsed, if any. */
  record: Record<string, unknown> | null;
  /** `docker tag` calls in this run: "<id> <reference>". */
  tags: string[];
  log: string;
};

export const stackTxt = (stack: Record<string, Service>) =>
  Object.entries(stack)
    .map(([svc, s]) => `${svc} ${s.ref} ${hash(`${svc}|${s.ref}|${s.def ?? ""}`)}\n`)
    .join("");

export const hashLines = (stack: Record<string, Service>) =>
  stackTxt(stack)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(" "))
    .map(([svc, , h]) => `${svc} ${h}`)
    .join("\n");

/** A checkout and a stub daemon that persist across several runs. */
export class Rig {
  readonly dir = mkdtempSync(join(tmpdir(), "self-update-"));
  readonly stub = join(this.dir, "stub");
  readonly proj = join(this.dir, "proj");
  private readonly bin = join(this.dir, "bin");
  private readonly logFile = join(this.dir, "update.log");

  constructor(private readonly sc: Scenario, opts: { failHashes?: boolean } = {}) {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...args], {
        cwd,
        stdio: "pipe",
      });
    for (const d of ["containers", "images", "registry", "health", "versions", "logs", "gone", "smoke"]) mkdirSync(join(this.stub, d), { recursive: true });
    mkdirSync(this.bin, { recursive: true });
    writeFileSync(join(this.bin, "docker"), STUB_DOCKER);
    chmodSync(join(this.bin, "docker"), 0o755);
    if (opts.failHashes) writeFileSync(join(this.stub, "hashfail"), "");
    for (const [ref, id] of Object.entries(sc.images)) writeFileSync(join(this.stub, "images", esc(ref)), `${id}\n`);
    this.setRegistry(sc.registry ?? {});
    for (const [svc, c] of Object.entries(sc.containers)) {
      writeFileSync(join(this.stub, "containers", svc), `${c.ref}|${c.id}|${c.created ?? "2026-01-01T00:00:00.000000000Z"}\n`);
    }

    git(this.dir, "init", "-q", "--bare", "origin.git");
    git(this.dir, "clone", "-q", join(this.dir, "origin.git"), "proj");
    mkdirSync(join(this.proj, "webapp", "docker"), { recursive: true });
    writeFileSync(join(this.proj, "webapp", "docker", "stack.txt"), stackTxt(sc.stack));
    git(this.proj, "add", "-A");
    git(this.proj, "commit", "-qm", "stack");
    git(this.proj, "push", "-q", "origin", "main");
    if (sc.pulled) {
      git(this.dir, "clone", "-q", join(this.dir, "origin.git"), "pusher");
      writeFileSync(join(this.dir, "pusher", "webapp", "docker", "stack.txt"), stackTxt(sc.pulled));
      git(join(this.dir, "pusher"), "commit", "-qam", "release");
      git(join(this.dir, "pusher"), "push", "-q", "origin", "main");
    }
    writeFileSync(join(this.proj, "webapp", "docker", ".env"), `DATA_DIR=${join(this.dir, "data")}\n`);
    if (sc.hashesFile !== undefined) writeFileSync(this.hashesPath, sc.hashesFile);
    if (sc.stateFile !== undefined) writeFileSync(this.statePath, sc.stateFile);
  }

  get hashesPath() {
    return join(this.proj, ".git", "kinboard-update-hashes");
  }
  get statePath() {
    return join(this.proj, ".git", "kinboard-update-state");
  }

  /** The stack as .env and the compose files name it now, without a commit (a hand edit of .env). */
  setStack(stack: Record<string, Service>) {
    writeFileSync(join(this.proj, "webapp", "docker", "stack.txt"), stackTxt(stack));
  }
  setRegistry(registry: Record<string, string>) {
    for (const [ref, id] of Object.entries(registry)) writeFileSync(join(this.stub, "registry", esc(ref)), `${id}\n`);
  }
  /** The state a container from this image id reaches. */
  setHealth(id: string, h: Health) {
    writeFileSync(
      join(this.stub, "health", esc(id)),
      `${h.status}|${h.health ?? ""}|${h.restarts ?? 0}|${h.code ?? 0}|${h.policy ?? "unless-stopped"}\n`,
    );
  }
  /** What `/api/health?deep=1` answers inside a webapp container of this image: HTTP code and body. */
  setSmoke(id: string, code: number, body: string) {
    writeFileSync(join(this.stub, "smoke", esc(id)), `${code}|${body}\n`);
  }
  setVersion(id: string, version: string) {
    writeFileSync(join(this.stub, "versions", esc(id)), `${version}\n`);
  }
  setLogs(svc: string, text: string) {
    writeFileSync(join(this.stub, "logs", svc), text);
  }
  setOffline(on: boolean, kind: "offline" | "ratelimit" = "offline") {
    const p = join(this.stub, kind);
    if (on) writeFileSync(p, "");
    else rmSync(p, { force: true });
  }
  /** "Try again now" pressed in Settings. */
  requestRetry() {
    writeFileSync(join(this.stub, "retry"), "2026-11-26T10:00:00Z\n");
  }
  /** A line added to webapp/docker/.env. */
  addEnv(line: string) {
    const p = join(this.proj, "webapp", "docker", ".env");
    writeFileSync(p, readFileSync(p, "utf8") + line + "\n");
  }
  removeOrigin() {
    rmSync(join(this.dir, "origin.git"), { recursive: true, force: true });
  }
  /** The container a service runs now: [reference, image id]. */
  container(svc: string): { ref: string; id: string } | null {
    const p = join(this.stub, "containers", svc);
    if (!existsSync(p)) return null;
    const [ref, id] = readFileSync(p, "utf8").trim().split("|");
    return { ref, id };
  }
  imageOnDisk(ref: string): string | null {
    const p = join(this.stub, "images", esc(ref));
    return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
  }

  run(args: string[] = [], env: Record<string, string> = {}): RunResult {
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    for (const f of ["recreated", "calls", "pulls", "status", "tags", "psql"]) rmSync(join(this.stub, f), { force: true });
    const logBefore = read(this.logFile).length;
    const lock = join(this.proj, ".git", "kinboard-update.lock");
    const res = spawnSync(
      "sh",
      [
        "-c",
        this.sc.locked
          ? `exec 9>"$LOCK"; flock -n 9 || exit 99; sh "$SCRIPT" "$@"`
          : this.sc.tickRunning
            ? `echo 1 > "$LOCK.tick-marker"; mv "$LOCK.tick-marker" "$(dirname "$LOCK")/kinboard-update.tick"; ( exec 9>"$LOCK"; flock 9; sleep 1 ) & sleep 0.3; sh "$SCRIPT" "$@"`
            : `sh "$SCRIPT" "$@"`,
        "_",
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${this.bin}:${process.env.PATH}`,
          STUB: this.stub,
          SCRIPT,
          LOCK: lock,
          PROJECT_DIR: this.proj,
          COMPOSE_FILES: "-f docker-compose.yml",
          LOG_FILE: this.logFile,
          KINBOARD_HEALTH_TIMEOUT: "3",
          KINBOARD_HEALTH_POLL: "0.1",
          ...env,
        },
      },
    );
    const status = read(join(this.stub, "status"));
    return {
      status: res.status,
      out: res.stdout + res.stderr,
      recreated: read(join(this.stub, "recreated")).split("\n").filter(Boolean).sort(),
      calls: read(join(this.stub, "calls")).split("\n").filter(Boolean),
      pulls: read(join(this.stub, "pulls")).split("\n").filter(Boolean).length,
      hashesFile: existsSync(this.hashesPath) ? readFileSync(this.hashesPath, "utf8") : null,
      state: read(this.statePath),
      record: status ? (JSON.parse(status) as Record<string, unknown>) : null,
      tags: read(join(this.stub, "tags")).split("\n").filter(Boolean),
      log: read(this.logFile).slice(logBefore),
    };
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** One run on a fresh rig. */
export function runOnce(sc: Scenario, opts: { failHashes?: boolean } = {}): RunResult {
  const rig = new Rig(sc, opts);
  try {
    return rig.run();
  } finally {
    rig.cleanup();
  }
}
