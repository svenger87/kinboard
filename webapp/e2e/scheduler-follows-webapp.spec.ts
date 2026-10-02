import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ofelia, the `cron` service, reads its jobs from the webapp container's
 * labels once, when it starts. `docker compose up -d` recreates the webapp
 * when its image changes but leaves `cron` alone, because cron's own
 * definition did not change -- so a job a release adds (RFC-014's weekly
 * school-holiday sync) would never be scheduled, and nothing would say so.
 *
 * Both paths that recreate the webapp on an upgrade -- Diun's
 * kinboard-self-update.sh and `./start.sh up` -- therefore recreate the
 * scheduler after it, and only when the webapp container is a new one.
 * (`./start.sh restart` always did.) These run the scripts' own functions
 * against a stub `docker` that records what it was asked to do.
 */

const SCRIPTS = [
  { file: "docker/kinboard-self-update.sh", shell: "sh", prelude: 'COMPOSE_FILES="-f docker-compose.yml"; LOG_FILE=/dev/null; log() { :; };' },
  { file: "docker/start.sh", shell: "bash", prelude: 'set -euo pipefail; COMPOSE="docker compose"; COMPOSE_FILES="-f docker-compose.yml";' },
] as const;

const fn = (name: string) => `sed -n '/^${name}() {/,/^}$/p'`;

/**
 * The docker calls the function made, given the webapp container before and
 * after `up -d` and the stack's services. Recorded to a file: the scripts
 * send docker's own output to the log or to /dev/null.
 */
function run(script: (typeof SCRIPTS)[number], before: string, after: string, services: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scheduler-"));
  const calls = join(dir, "calls");
  try {
    execFileSync(
      script.shell,
      [
        "-c",
        `${script.prelude}
         docker() {
           echo "docker $*" >> "$CALLS"
           case "$*" in
             *"ps -aq webapp"*) [ -n "$AFTER" ] && echo "$AFTER" ;;
             *"config --services"*) printf '%s\\n' $SERVICES ;;
           esac
           return 0
         }
         : > "$CALLS"
         eval "$(${fn("webapp_container")} "$1")"
         eval "$(${fn("recreate_scheduler_if_webapp_changed")} "$1")"
         recreate_scheduler_if_webapp_changed "$BEFORE" >/dev/null 2>&1`,
        "_",
        script.file,
      ],
      { encoding: "utf8", env: { ...process.env, BEFORE: before, AFTER: after, SERVICES: services.join(" "), CALLS: calls } },
    );
    return readFileSync(calls, "utf8").split("\n").filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const recreated = (calls: string[]) => calls.some((c) => /up -d --no-deps (--no-build )?--force-recreate cron$/.test(c));

for (const script of SCRIPTS) {
  test.describe(script.file, () => {
    test("a new webapp container is followed by a new scheduler", () => {
      expect(recreated(run(script, "aaa", "bbb", ["db", "webapp", "cron"]))).toBe(true);
    });

    test("a webapp left as it was leaves the scheduler alone (a no-op run stays one)", () => {
      expect(recreated(run(script, "aaa", "aaa", ["db", "webapp", "cron"]))).toBe(false);
    });

    test("no webapp, or no cron service, recreates nothing", () => {
      expect(recreated(run(script, "", "", ["db", "webapp", "cron"]))).toBe(false);
      expect(recreated(run(script, "aaa", "bbb", ["db", "webapp"]))).toBe(false);
    });

    test("the webapp is looked at before `up -d`, and the scheduler follows it", () => {
      const src = readFileSync(script.file, "utf8");
      // The whole stack's `up -d` (plain, or with the self-update's service list), not a single service's.
      const upDash = /\n[^#\n]*(docker compose|\$COMPOSE) \$COMPOSE_FILES up -d( --no-build \$SERVICES)? *(>>[^\n]*)?\n/.exec(src);
      expect(upDash, "could not find the stack's `up -d`").not.toBeNull();
      const call = /recreate_scheduler_if_webapp_changed "\$(\w+)"/.exec(src.slice(upDash!.index));
      expect(call, "`up -d` must be followed by recreate_scheduler_if_webapp_changed").not.toBeNull();
      expect(
        src.lastIndexOf(`${call![1]}="$(webapp_container)"`, upDash!.index),
        `$${call![1]} must hold the webapp container id from before \`up -d\``,
      ).toBeGreaterThan(-1);
    });
  });
}

test("`./start.sh restart` still recreates the scheduler", () => {
  const src = readFileSync("docker/start.sh", "utf8");
  const restart = src.slice(src.indexOf("\n  restart)"), src.indexOf("\n  logs)"));
  expect(restart).toContain("up -d --no-deps --force-recreate cron");
});
