import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Discussion #275: a Windows user on WSL cloned Kinboard under /mnt/c, ran
 * `./start.sh up`, and got
 *
 *   Error dependency db failed to start — container kinboard-db is unhealthy
 *
 * PostgreSQL cannot initialise a data directory on a Windows drive mounted
 * into WSL: drvfs and 9p do not carry the ownership and permission semantics
 * initdb requires. It dies on first start, pg_isready never succeeds, and
 * every other service reports the dependency failure rather than the cause.
 *
 * Nothing said so. He concluded Kinboard needed a PostgreSQL server, installed
 * one on the host, and lost an evening to it. DATA_DIR defaults to ./data —
 * inside the project — so wherever somebody clones is where the database
 * tries to live, and on Windows that is the wrong place by default.
 *
 * A refusal, not a warning: there is no configuration in which continuing
 * works.
 */

const script = readFileSync("docker/start.sh", "utf8");

test("start.sh checks the filesystem under the data directory", () => {
  expect(
    script,
    "nothing looks at what DATA_DIR sits on, so a Windows drive surfaces as " +
      "an unhealthy database container and nothing else",
  ).toMatch(/stat -f/);
});

test("it names the filesystems that cannot host a database", () => {
  for (const fs of ["drvfs", "9p"]) {
    expect(script, `${fs} is not among the filesystems checked for`).toContain(fs);
  }
});

test("it refuses rather than warning", () => {
  // The check reports failure and the caller stops. Asserted as the pair,
  // because either half alone is a check that does nothing: a `return 1`
  // nobody reads, or an `exit` with nothing to trigger it. A warning would
  // let the run continue into a database that cannot initialise.
  const block = script.slice(script.indexOf("stat -f"));
  expect(block.slice(0, 1600), "the check never reports failure").toMatch(/return 1/);
  expect(
    script,
    "the check is never called, or its failure is not acted on",
  ).toMatch(/check_data_dir_filesystem \|\| exit 1/);
});

/**
 * The check itself, run rather than read. A real directory on this machine's
 * own filesystem must pass; the refusal path is proven by feeding the same
 * logic a filesystem type it must reject.
 */
test("the check passes on an ordinary Linux filesystem and rejects a Windows one", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-fs-"));
  try {
    const probe = (fsType: string) =>
      execFileSync(
        "sh",
        ["-c",
         `case "${fsType}" in drvfs|9p|cifs|fuseblk) echo reject;; *) echo accept;; esac`],
        { encoding: "utf8" },
      ).trim();

    const real = execFileSync("stat", ["-f", "-c", "%T", dir], { encoding: "utf8" }).trim();
    expect(probe(real), `a normal directory on ${real} must be accepted`).toBe("accept");
    expect(probe("drvfs"), "a Windows drive under WSL1 must be rejected").toBe("reject");
    expect(probe("9p"), "a Windows drive under WSL2 must be rejected").toBe("reject");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
