import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SCRIPT, hashLines, runOnce, type Service } from "./helpers/self-update-stub";

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
 * and a stub `docker` that keeps its containers in files
 * (helpers/self-update-stub.ts). A plain `up` (no --no-recreate) recreates
 * every service it is given, as it did on that stack, because the stored
 * hashes came from another Compose.
 */

const script = readFileSync(SCRIPT, "utf8");
const run = runOnce;

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
    ).toMatch(/--no-recreate|--no-deps --force-recreate (\$RECREATE|\$others|init)\b/);
  }
  // recreate_services: compose.yml's init alone first, then the others.
  expect(ups.join("\n"), "what did change is never recreated").toMatch(/--no-deps --force-recreate \$others/);
});
