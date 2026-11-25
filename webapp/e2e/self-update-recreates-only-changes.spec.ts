import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * So the script decides what to recreate itself -- a definition that changed
 * in this run (hashed before and after `git pull` by one Compose), or a
 * container on another image than its reference now names -- and never lets
 * `up` consult the stored hash. These run its own functions against a stub
 * `docker`.
 */

const SCRIPT = "docker/kinboard-self-update.sh";
const script = readFileSync(SCRIPT, "utf8");
const fn = (name: string) => `sed -n '/^${name}() {/,/^}$/p'`;

type Stack = {
  /** "service hash" pairs before `git pull` and setup.sh. */
  before: Record<string, string>;
  /** ... and after them. */
  now: Record<string, string>;
  /** service -> [image the container runs, image its reference names now]. */
  containers: Record<string, [string, string]>;
};

function recreate(stack: Stack, services = Object.keys(stack.now)): string[] {
  const dir = mkdtempSync(join(tmpdir(), "recreate-"));
  mkdirSync(join(dir, "webapp", "docker"), { recursive: true });
  const lines = (o: Record<string, string>) => Object.entries(o).map(([s, h]) => `${s} ${h}`).join("\n");
  const pairs = (i: 0 | 1) => Object.entries(stack.containers).map(([s, imgs]) => `${s}:${imgs[i]}`).join(" ");
  try {
    const out = execFileSync(
      "sh",
      [
        "-c",
        `set -eu
         COMPOSE_FILES="-f docker-compose.yml"
         lookup() { for p in $2; do [ "\${p%%:*}" = "$1" ] && echo "\${p#*:}"; done; return 0; }
         docker() {
           case "$*" in
             *"config --hash"*) printf '%s\\n' "$NOW" ;;
             *"ps -aq "*) [ -n "$(lookup "$6" "$RUNNING")" ] && echo "cid-$6" ;;
             "inspect -f {{.Config.Image}} "*) echo "ref-\${4#cid-}" ;;
             "inspect -f {{.Image}} "*) lookup "\${4#cid-}" "$RUNNING" ;;
             # Like docker: an image that is not on disk is an error.
             "image inspect -f {{.Id}} "*) w="$(lookup "\${5#ref-}" "$WANTED")"; [ -n "$w" ] || return 1; echo "$w" ;;
           esac
           return 0
         }
         eval "$(${fn("config_hashes")} "$1")"
         eval "$(${fn("services_to_recreate")} "$1")"
         services_to_recreate "$SERVICES"`,
        "_",
        SCRIPT,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PROJECT_DIR: dir,
          HASHES_BEFORE: lines(stack.before),
          NOW: lines(stack.now),
          RUNNING: pairs(0),
          WANTED: pairs(1),
          SERVICES: services.join(" "),
        },
      },
    );
    return out.split("\n").filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HASHES = { db: "h-db", rest: "h-rest", webapp: "h-web", go2rtc: "h-go" };
const CURRENT: Stack["containers"] = {
  db: ["img-pg", "img-pg"],
  rest: ["img-rest", "img-rest"],
  webapp: ["img-web", "img-web"],
  go2rtc: ["img-go", "img-go"],
};

test("nothing changed: nothing is recreated, whichever Compose created the containers", () => {
  expect(recreate({ before: HASHES, now: HASHES, containers: CURRENT })).toEqual([]);
});

test("a definition changed by the pull recreates that service and no other", () => {
  expect(recreate({ before: HASHES, now: { ...HASHES, rest: "h-rest-v14.17" }, containers: CURRENT })).toEqual(["rest"]);
});

test("a new image under the same reference recreates that service, the database included", () => {
  expect(
    recreate({ before: HASHES, now: HASHES, containers: { ...CURRENT, db: ["img-pg", "img-pg-new"], webapp: ["img-web", "img-web-new"] } }),
  ).toEqual(["db", "webapp"]);
});

test("a service with no hash from before is recreated, as `up` would have", () => {
  const { go2rtc: _, ...before } = HASHES;
  expect(recreate({ before, now: HASHES, containers: CURRENT })).toEqual(["go2rtc"]);
});

test("an image no longer on disk leaves that service alone and the rest still checked", () => {
  // Under the script's `set -e`, one failed lookup must not end the loop early
  // and silently drop every service after it.
  expect(
    recreate({ before: HASHES, now: HASHES, containers: { ...CURRENT, db: ["img-pg", ""], webapp: ["img-web", "img-web-new"] } }),
  ).toEqual(["webapp"]);
});

test("a service without a container is left to the up to create", () => {
  const { go2rtc: _, ...containers } = CURRENT;
  expect(recreate({ before: HASHES, now: { ...HASHES, go2rtc: "h-go-2" }, containers })).toEqual([]);
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
