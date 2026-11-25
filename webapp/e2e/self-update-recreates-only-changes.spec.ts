import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The self-update runs the Compose installed in the webhook image (2.27);
 * `./start.sh up` runs the host's. Compose recreates a container whenever the
 * hash of its definition differs from the one stored on it, and the hash is
 * not the same across versions: 2.29 stopped hashing depends_on, 5.0
 * serialises bind mounts differently, and 5.4 records a different image
 * digest. On a throwaway stack, a self-update with nothing to do recreated
 * db, db-init, rest, webapp, cron and go2rtc, and the next `./start.sh up`
 * recreated all six again.
 *
 * So the script decides what to recreate itself and never lets `up` consult
 * the stored hash. These run the whole script, against a real git checkout
 * and a stub `docker` that keeps its containers in files. A plain `up` (no
 * --no-recreate) recreates every service it is given, as it did on that
 * stack, because the stored hashes came from another Compose.
 */

const SCRIPT = resolve("docker/kinboard-self-update.sh");
const script = readFileSync(SCRIPT, "utf8");

const STUB_DOCKER = String.raw`#!/bin/sh
echo "docker $*" >> "$STUB/calls"
esc() { printf '%s' "$1" | tr '/:@' '___'; }
now() { date -u +%Y-%m-%dT%H:%M:%S.000000000Z; }
make() { # service: a new container from the definition in ./stack.txt
  ref="$(awk -v s="$1" '$1 == s { print $2 }' ./stack.txt)"
  id="$(cat "$STUB/images/$(esc "$ref")" 2>/dev/null || echo missing)"
  printf '%s|%s|%s\n' "$ref" "$id" "$(now)" > "$STUB/containers/$1"
}
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
    ps) [ -f "$STUB/containers/$last" ] && echo "cid-$last" ;;
    up)
      svcs=""; for a in "$@"; do case "$a" in -*) ;; *) svcs="$svcs $a" ;; esac; done
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
    f="$STUB/containers/$(printf '%s' "$4" | sed 's/^cid-//')"; [ -f "$f" ] || exit 1
    IFS='|' read -r ref id created < "$f"
    case "$3" in
      *Config.Image*) echo "$ref" ;;
      *Created*) echo "$created" ;;
      *.Image*) echo "$id" ;;
    esac ;;
  image) f="$STUB/images/$(esc "$5")"; [ -f "$f" ] || exit 1; cat "$f" ;;
  container) exit 1 ;;
  exec) echo "CREATE SCHEMA auth;"; i=0; while [ $i -lt 60 ]; do echo "CREATE TABLE t$i ();"; i=$((i + 1)); done ;;
  run)
    case "$*" in *" -i "*) cat > /dev/null ;; esac
    case "$*" in *"grep -vc"* | *"wc -l"*) echo 0 ;; esac ;;
esac
exit 0
`;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

type Service = { ref: string; def?: string };
type Scenario = {
  /** The definition in the checkout when the run starts. */
  stack: Record<string, Service>;
  /** A newer definition on origin/main, which the run pulls. */
  pulled?: Record<string, Service>;
  /** The containers as they run: image reference, image id, created. */
  containers: Record<string, { ref: string; id: string; created?: string }>;
  /** Image reference -> id of the image on disk now. */
  images: Record<string, string>;
  /** Contents of .git/kinboard-update-hashes before the run, if any. */
  hashesFile?: string;
  /** Another run holds the lock. */
  locked?: boolean;
};

const stackTxt = (stack: Record<string, Service>) =>
  Object.entries(stack)
    .map(([svc, s]) => `${svc} ${s.ref} ${hash(`${svc}|${s.ref}|${s.def ?? ""}`)}\n`)
    .join("");

function run(sc: Scenario, opts: { failHashes?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "self-update-"));
  const stub = join(dir, "stub");
  const bin = join(dir, "bin");
  const proj = join(dir, "proj");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...args], {
      cwd,
      stdio: "pipe",
    });
  try {
    for (const d of [join(stub, "containers"), join(stub, "images"), bin]) mkdirSync(d, { recursive: true });
    writeFileSync(join(bin, "docker"), STUB_DOCKER);
    chmodSync(join(bin, "docker"), 0o755);
    if (opts.failHashes) writeFileSync(join(stub, "hashfail"), "");
    for (const [ref, id] of Object.entries(sc.images)) writeFileSync(join(stub, "images", ref.replace(/[/:@]/g, "_")), `${id}\n`);
    for (const [svc, c] of Object.entries(sc.containers)) {
      writeFileSync(join(stub, "containers", svc), `${c.ref}|${c.id}|${c.created ?? "2026-01-01T00:00:00.000000000Z"}\n`);
    }

    // origin, and the checkout the update runs in
    git(dir, "init", "-q", "--bare", "origin.git");
    git(dir, "clone", "-q", join(dir, "origin.git"), "proj");
    mkdirSync(join(proj, "webapp", "docker"), { recursive: true });
    writeFileSync(join(proj, "webapp", "docker", "stack.txt"), stackTxt(sc.stack));
    git(proj, "add", "-A");
    git(proj, "commit", "-qm", "stack");
    git(proj, "push", "-q", "origin", "main");
    if (sc.pulled) {
      git(dir, "clone", "-q", join(dir, "origin.git"), "pusher");
      writeFileSync(join(dir, "pusher", "webapp", "docker", "stack.txt"), stackTxt(sc.pulled));
      git(join(dir, "pusher"), "commit", "-qam", "release");
      git(join(dir, "pusher"), "push", "-q", "origin", "main");
    }
    writeFileSync(join(proj, "webapp", "docker", ".env"), `DATA_DIR=${join(dir, "data")}\n`);
    const hashesFile = join(proj, ".git", "kinboard-update-hashes");
    if (sc.hashesFile !== undefined) writeFileSync(hashesFile, sc.hashesFile);

    const log = join(dir, "update.log");
    const lock = join(proj, ".git", "kinboard-update.lock");
    const res = spawnSync(
      "sh",
      [
        "-c",
        sc.locked
          ? `exec 9>"$LOCK"; flock -n 9 || exit 99; sh "$SCRIPT"`
          : `sh "$SCRIPT"`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          STUB: stub,
          SCRIPT,
          LOCK: lock,
          PROJECT_DIR: proj,
          COMPOSE_FILES: "-f docker-compose.yml",
          LOG_FILE: log,
        },
      },
    );
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      status: res.status,
      out: res.stdout + res.stderr,
      recreated: read(join(stub, "recreated")).split("\n").filter(Boolean).sort(),
      calls: read(join(stub, "calls")).split("\n").filter(Boolean),
      hashesFile: existsSync(hashesFile) ? readFileSync(hashesFile, "utf8") : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STACK: Record<string, Service> = {
  db: { ref: "supabase/postgres:15.14.1.159" },
  rest: { ref: "postgrest/postgrest:v14.16" },
  go2rtc: { ref: "alexxit/go2rtc:1.9.14" },
  cron: { ref: "mcuadros/ofelia@sha256:efcb" },
};
const IMAGES: Record<string, string> = {
  "supabase/postgres:15.14.1.159": "sha256:pg",
  "postgrest/postgrest:v14.16": "sha256:rest16",
  "postgrest/postgrest:v14.17": "sha256:rest17",
  "alexxit/go2rtc:1.9.14": "sha256:go",
  "mcuadros/ofelia@sha256:efcb": "sha256:ofelia",
};
const RUNNING = Object.fromEntries(Object.entries(STACK).map(([svc, s]) => [svc, { ref: s.ref, id: IMAGES[s.ref] }]));

const hashLines = (stack: Record<string, Service>) =>
  stackTxt(stack)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(" "))
    .map(([svc, , h]) => `${svc} ${h}`)
    .join("\n");

test("nothing changed: nothing is recreated, whichever Compose created the containers", () => {
  const r = run({ stack: STACK, containers: RUNNING, images: IMAGES });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual([]);
  expect(r.hashesFile, "the hash file is removed after a clean run").toBeNull();
});

test("a definition changed by the pull recreates that service and no other", () => {
  const r = run({ stack: STACK, pulled: { ...STACK, rest: { ref: "postgrest/postgrest:v14.17" } }, containers: RUNNING, images: IMAGES });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual(["rest"]);
});

test("a new image under the same reference recreates that service, the database included", () => {
  const r = run({ stack: STACK, containers: RUNNING, images: { ...IMAGES, "supabase/postgres:15.14.1.159": "sha256:pg-new" } });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual(["db"]);
});

test("a checkout already ahead of the containers: the reference they run is not the one named now", () => {
  // `git pull` by hand, or a release deployed with `up -d webapp` only: the
  // tag moved before this run, so before and after hash the same.
  const r = run({ stack: { ...STACK, rest: { ref: "postgrest/postgrest:v14.17" } }, containers: RUNNING, images: IMAGES });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual(["rest"]);
});

test("no hashes from Compose: unknown, not changed -- nothing recreated, no 1-byte hash file", () => {
  const r = run({ stack: STACK, pulled: { ...STACK, go2rtc: { ref: "alexxit/go2rtc:1.9.14", def: "x" } }, containers: RUNNING, images: IMAGES }, { failHashes: true });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual([]);
  expect(r.out).toContain("WARN: docker compose config --hash gave nothing");
  expect(r.hashesFile).toBeNull();
});

test("a 1-byte hash file left by an earlier version is ignored, not read as every service changed", () => {
  const r = run({ stack: STACK, containers: RUNNING, images: IMAGES, hashesFile: "\n" });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual([]);
});

test("an interrupted run's hashes carry its definition change over to the next run", () => {
  const old = { ...STACK, db: { ...STACK.db, def: "old-env" } };
  const r = run({
    stack: STACK,
    containers: RUNNING, // created 2026-01-01, before the file
    images: IMAGES,
    hashesFile: `head abc\nwritten 2026-06-01T00:00:00\n${hashLines(old)}\n`,
  });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual(["db"]);
  expect(r.hashesFile).toBeNull();
});

test("a stale hash file does not recreate what a `./start.sh up` has applied since", () => {
  const old = { ...STACK, db: { ...STACK.db, def: "old-env" } };
  const r = run({
    stack: STACK,
    containers: { ...RUNNING, db: { ...RUNNING.db, created: "2026-07-01T00:00:00.000000000Z" } },
    images: IMAGES,
    hashesFile: `head abc\nwritten 2026-06-01T00:00:00\n${hashLines(old)}\n`,
  });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual([]);
});

test("a service it cannot judge keeps the hash file for the next run", () => {
  const { "alexxit/go2rtc:1.9.14": _, ...images } = IMAGES;
  const r = run({ stack: STACK, containers: RUNNING, images });
  expect(r.status, r.out).toBe(0);
  expect(r.recreated).toEqual([]);
  expect(r.out).toContain("skip go2rtc (image-not-on-disk)");
  expect(r.hashesFile).not.toBeNull();
});

test("a second run while one is going exits cleanly and touches nothing", () => {
  const r = run({ stack: STACK, containers: RUNNING, images: { ...IMAGES, "supabase/postgres:15.14.1.159": "sha256:pg-new" }, locked: true });
  expect(r.status, r.out).toBe(0);
  expect(r.out).toContain("another self-update is running");
  expect(r.calls.filter((c) => / up /.test(c))).toEqual([]);
  expect(r.recreated).toEqual([]);
});

test("no `up` lets Compose decide by the hash it stored", () => {
  const ups = script
    .split("\n")
    .filter((l) => /^\s*(if ! )?docker compose \$COMPOSE_FILES up -d/.test(l) && !/\bcron\b/.test(l));
  expect(ups.length, "could not find the stack's `up` calls").toBeGreaterThan(0);
  for (const up of ups) {
    expect(
      up,
      "a plain `up -d` recreates every container whose stored config hash differs, " +
        "and that hash differs between the webhook's Compose and the host's: use " +
        "--no-recreate for the stack and --no-deps --force-recreate for what changed",
    ).toMatch(/--no-recreate|--no-deps --force-recreate \$RECREATE/);
  }
  expect(ups.join("\n"), "what did change is never recreated").toMatch(/--no-deps --force-recreate \$RECREATE/);
});
