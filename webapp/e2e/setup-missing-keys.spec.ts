import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * setup.sh runs under `set -euo pipefail`, and it read existing keys with
 * `$(grep -E "^KEY=" .env | head -n1 | cut …)`. When the key isn't in the
 * file at all, grep exits 1, pipefail carries that out of the substitution,
 * and `set -e` ends the script on the spot — no message, exit 1, half the
 * .env written. An .env from before a key existed, or one written by hand
 * without ANON_KEY, hit it. Every such read now ends in `|| true`, so a
 * missing key is minted like an empty one.
 *
 * This runs the real script on a copy of the repository, so it covers the
 * pipelines as they are, not a reimplementation of them.
 */

const repo = resolve(__dirname, "../..");

function freshCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "setup-keys-"));
  // The tracked files as they are in the working tree, so an uncommitted
  // setup.sh is what runs.
  execFileSync("bash", ["-c", `cd "$1" && git ls-files -z | tar --null -T - -c | tar -x -C "$2"`, "_", repo, dir]);
  return dir;
}

function runSetup(dir: string) {
  return spawnSync("./setup.sh", ["--non-interactive"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
}

test("setup.sh mints keys that are missing from an existing .env instead of exiting silently", () => {
  test.setTimeout(240_000);
  const dir = freshCopy();
  try {
    expect(runSetup(dir).status).toBe(0);
    const envPath = join(dir, "webapp/docker/.env");
    const removed = ["ANON_KEY", "SERVICE_ROLE_KEY", "VAPID_PUBLIC_KEY"];
    const kept = readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => !removed.some((k) => l.startsWith(`${k}=`)))
      .join("\n");
    writeFileSync(envPath, kept);

    const second = runSetup(dir);
    expect(second.status, second.stdout + second.stderr).toBe(0);

    const env = readFileSync(envPath, "utf8");
    for (const key of removed) expect(env).toMatch(new RegExp(`^${key}=.+`, "m"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
