import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `kinboard-updater` as a command (webapp/docker/kinboard-updater.sh, the
 * image's /usr/local/bin/kinboard-updater). Until this, it ignored its
 * arguments and started the update loop on every call: on an Unraid test
 * install (7.3.4, the all-in-one image, 2026-11-27) `docker exec
 * kinboard-updater kinboard-updater --help` started a second loop beside the
 * container's own. Now:
 *
 *   --help        usage, exit 0, nothing run
 *   --check-now   one check (kinboard-self-update.sh --tick: the loop's own
 *                 check, through the same lock), then exit
 *   --loop        the loop, asked for by name
 *   (none)        the loop only as the container's main process; from a
 *                 shell or docker exec, the usage and exit 2
 *   anything else the usage on stderr, exit 2, nothing run
 *
 * The main-process case needs a real container (PID 1); it was checked in one
 * when this was written (see the PR). Here the wrapper runs next to a stub of
 * the script that records how it was called.
 */

const DOCKER = resolve(__dirname, "../docker");

function rig() {
  const dir = mkdtempSync(join(tmpdir(), "kb-updater-cli-"));
  const wrapper = join(dir, "kinboard-updater");
  copyFileSync(join(DOCKER, "kinboard-updater.sh"), wrapper);
  chmodSync(wrapper, 0o755);
  const calls = join(dir, "calls");
  // The stub: what the wrapper handed on, and whether it marked the run as the updater's.
  writeFileSync(join(dir, "kinboard-self-update.sh"), `echo "KINBOARD_UPDATER=$KINBOARD_UPDATER $*" >> "${calls}"\n`);
  const run = (...args: string[]) => {
    const r = spawnSync("sh", [wrapper, ...args], { encoding: "utf8", env: { ...process.env, KINBOARD_UPDATER: "" } });
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      calls: existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : [],
    };
  };
  return { run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test.describe("kinboard-updater's arguments", () => {
  test("--help (and -h): the usage on stdout, exit 0, nothing run", () => {
    const r = rig();
    try {
      for (const flag of ["--help", "-h"]) {
        const res = r.run(flag);
        expect(res.status, flag).toBe(0);
        expect(res.stdout).toContain("usage: kinboard-updater [--check-now | --loop | --help]");
        for (const word of ["--check-now", "--loop", "update.log"]) expect(res.stdout).toContain(word);
        expect(res.stderr).toBe("");
      }
      expect(r.run().calls, "the stub never ran").toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("--check-now: one check, the loop's own (--tick, as the updater), and nothing else", () => {
    const r = rig();
    try {
      const res = r.run("--check-now");
      expect(res.status).toBe(0);
      expect(res.calls).toEqual(["KINBOARD_UPDATER=1 --tick"]);
    } finally {
      r.cleanup();
    }
  });

  test("--loop: the loop, asked for by name", () => {
    const r = rig();
    try {
      expect(r.run("--loop").calls).toEqual(["KINBOARD_UPDATER=1 --tick-loop"]);
    } finally {
      r.cleanup();
    }
  });

  test("no argument outside the container's main process (docker exec, a shell): the usage, exit 2, no loop", () => {
    const r = rig();
    try {
      const res = r.run();
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("usage: kinboard-updater");
      expect(res.calls).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("an unknown argument, or one too many: the usage on stderr, exit 2, nothing run", () => {
    const r = rig();
    try {
      for (const args of [["--bogus"], ["help"], ["--tick-loop"], ["--check-now", "--loop"], ["--help", "x"], [""]]) {
        const res = r.run(...args);
        expect(res.status, args.join(" ")).toBe(2);
        expect(res.stderr, args.join(" ")).toContain("usage: kinboard-updater");
        expect(res.stdout, args.join(" ")).toBe("");
      }
      expect(r.run("--help").calls, "none of them reached the script").toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("the image carries it as kinboard-updater, next to the script it runs", () => {
    const df = readFileSync(join(DOCKER, "Dockerfile.webhook"), "utf8");
    expect(df).toContain("COPY kinboard-self-update.sh /usr/local/bin/kinboard-self-update.sh");
    expect(df).toContain("COPY kinboard-updater.sh /usr/local/bin/kinboard-updater");
    expect(df).toMatch(/chmod 0755 .*\/usr\/local\/bin\/kinboard-updater/);
    // The healthcheck still finds the loop the wrapper execs.
    expect(readFileSync(join(DOCKER, "kinboard-updater.sh"), "utf8")).toContain('exec sh "$SCRIPT" --tick-loop');
    expect(df).toContain("kinboard-self-update[.]sh --tick-loop");
  });
});
