import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The auto-update webhook must run the script that is on disk now, not the
 * one that was there when its container started.
 *
 * It did not. hooks.yaml executed /scripts/kinboard-self-update.sh, which the
 * overlay bind-mounted as a single FILE:
 *
 *   - ./kinboard-self-update.sh:/scripts/kinboard-self-update.sh:ro
 *
 * A single-file bind mount is pinned to the inode that was at that path when
 * the container started. `git pull` replaces a file by writing a new one and
 * renaming it over the old — a new inode — so the container went on seeing
 * the old file indefinitely. Measured on a production host whose webhook had
 * been up since 2026-09-13:
 *
 *                     checkout (host)     /scripts in the container
 *   inode             41138306            24930952
 *   size              16531 bytes         7246 bytes
 *   date              17 Sep              5 Aug
 *   take_backup       present             absent
 *
 * and the update for v1.11.0-rc.2 ran without either of the pre-upgrade
 * backup's log lines, because the code that writes them had never been
 * loaded. The self-update excludes webhook and diun from its own recreate so
 * it does not kill itself, which means nothing ever refreshed that mount:
 * every change to the script since a host's webhook last started — the
 * pre-upgrade backup among them — had never run there.
 *
 * The same container mounts the whole project as a DIRECTORY at the same
 * path inside as out, and a directory mount does see replaced files. So the
 * hook runs the script through that, and hooks.yaml itself comes in as part
 * of a directory for the same reason.
 */

const hooks = readFileSync("docker/diun/hooks.yaml", "utf8");
const overlays = ["docker/docker-compose.diun.yml", "docker/docker-compose.diun.yml.example"];

test("the hook runs the script through the project directory mount", () => {
  const cmd = hooks.match(/execute-command:\s*(.+)/);
  expect(cmd, "could not find execute-command in hooks.yaml").toBeTruthy();
  expect(
    cmd![1],
    "the hook runs a single-file-mounted copy of the script, which stays at " +
      "whatever version was on disk when the webhook container started",
  ).toContain('getenv "PROJECT_DIR"');
  expect(cmd![1]).toContain("/webapp/docker/kinboard-self-update.sh");
});

for (const file of overlays) {
  test(`${file} mounts neither the script nor hooks.yaml as a single file`, () => {
    const src = readFileSync(file, "utf8");
    expect(
      src,
      "the script is still bind-mounted as a single file — that copy never " +
        "updates, and anything pointed at it runs stale code",
    ).not.toMatch(/kinboard-self-update\.sh:\/scripts\//);
    expect(
      src,
      "hooks.yaml is still bind-mounted as a single file, so a change to the " +
        "hook definition never reaches a running webhook either",
    ).not.toMatch(/diun\/hooks\.yaml:\/etc\/webhook\/hooks\.yaml/);
  });
}
