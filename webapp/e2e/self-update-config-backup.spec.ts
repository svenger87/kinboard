import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rig, SCRIPT, type Service } from "./helpers/self-update-stub";

/**
 * RFC-023 §6.5: the self-update's pre-upgrade backup gains a third archive,
 * the config folder, wherever the install has one. On the one-file layout
 * that folder holds the database password, the JWT secret and the VAPID pair
 * (kinboard-init, #548): a restored database directory cannot start without
 * it, and a restore with new VAPID keys silently ends every device's push.
 *
 * Two halves:
 *  - the archive and prune scripts themselves, extracted from the update
 *    script and run against real files with the real tar: modes, verification,
 *    rotation;
 *  - the whole update script on the stub harness (helpers/self-update-stub.ts):
 *    when the archive is taken, from where, and that a legacy install without
 *    a config folder backs up exactly what it did before.
 */

const script = readFileSync(SCRIPT, "utf8");

/** The text of a `NAME='…'` variable in the update script. */
function snippet(name: string): string {
  const m = script.match(new RegExp(`^${name}='\\n([\\s\\S]*?)^'$`, "m"));
  if (!m) throw new Error(`${name} not found in ${SCRIPT}`);
  return m[1];
}

const ARCHIVE = snippet("CONFIG_ARCHIVE_SH");
const PRUNE = snippet("PRUNE_SH");

function sh(code: string, args: string[], env: Record<string, string>, binDir?: string) {
  return spawnSync("sh", ["-c", code, "sh", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, ...(binDir ? { PATH: `${binDir}:${process.env.PATH}` } : {}) },
  });
}

const mode = (p: string) => (statSync(p).mode & 0o7777).toString(8);

/** A config folder as kinboard-init leaves it: secrets/ 0750, files 0640, a hard-linked .previous. */
function makeConfig(root: string) {
  const sec = join(root, "secrets");
  mkdirSync(sec, { recursive: true });
  const values: Record<string, string> = {
    postgres_password: "a".repeat(64),
    jwt_secret: "b".repeat(64),
    db_uri: "postgres://authenticator:pw@db:5432/postgres",
    cron_secret: "c".repeat(64),
    presence_sensor_token: "d".repeat(64),
    vapid_public_key: "BPub",
    vapid_private_key: "priv",
  };
  for (const [n, v] of Object.entries(values)) writeFileSync(join(sec, n), v);
  linkSync(join(sec, "jwt_secret"), join(sec, "jwt_secret.previous-20261126T100000Z"));
  writeFileSync(join(sec, "jwt_secret.new"), "e".repeat(64));
  rmSync(join(sec, "jwt_secret"));
  writeFileSync(join(sec, "jwt_secret"), "e".repeat(64));
  rmSync(join(sec, "jwt_secret.new"));
  for (const f of readdirSync(sec)) chmodSync(join(sec, f), 0o640);
  chmodSync(sec, 0o750);
  return Object.keys(values).length + 1;
}

/** A bin folder whose `tar` (or another tool) is a wrapper, to break one step on purpose. */
function wrapper(dir: string, name: string, body: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const real = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(bin, name), `#!/bin/sh\nREAL=${real}\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
  return bin;
}

test.describe("the config archive (CONFIG_ARCHIVE_SH, real tar)", () => {
  let dir: string;
  let src: string;
  let out: string;
  let files: number;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "config-backup-"));
    src = join(dir, "config");
    out = join(dir, "backups");
    mkdirSync(out);
    files = makeConfig(src);
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (bin?: string) => sh(ARCHIVE, ["pre-upgrade-x-config.tar.gz"], { KB_SRC: src, KB_OUT: out }, bin);

  test("writes a verified archive readable by its owner only, and says how many files it holds", () => {
    const res = run();
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(`files=${files}`);
    const archive = join(out, "pre-upgrade-x-config.tar.gz");
    expect(mode(archive)).toBe("600");
    expect(readdirSync(out), "no half-written file left behind").toEqual(["pre-upgrade-x-config.tar.gz"]);
  });

  test("leaves out updater/, kinboard-updater's state and log, which it writes while this runs (RFC-023 §4.11.3)", () => {
    const upd = join(src, "updater");
    mkdirSync(upd);
    writeFileSync(join(upd, "state"), "baseline 2026-11-26T00:00:00Z\n");
    writeFileSync(join(upd, "update.log"), "[…] === tick ===\n");
    // Not a plain file: archived, it would refuse the whole backup.
    symlinkSync("/dev/null", join(upd, "lock-link"));
    const res = run();
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim(), "the secrets only").toBe(`files=${files}`);
    const list = spawnSync("tar", ["-tzf", join(out, "pre-upgrade-x-config.tar.gz")], { encoding: "utf8" }).stdout;
    expect(list).toContain("./secrets/jwt_secret");
    expect(list).not.toContain("updater");
  });

  test("never world-readable, even under a permissive umask and while it is written", () => {
    // umask 000 outside: the script sets its own before the first byte.
    const res = spawnSync("sh", ["-c", `umask 000; sh -c "$0" sh pre-upgrade-x-config.tar.gz`, ARCHIVE], {
      encoding: "utf8",
      env: { ...process.env, KB_SRC: src, KB_OUT: out },
    });
    expect(res.status, res.stderr).toBe(0);
    expect(mode(join(out, "pre-upgrade-x-config.tar.gz"))).toBe("600");
    // The partial file is created under the same umask: stop tar right after it wrote, and look.
    const bin = wrapper(dir, "tar", `case "$*" in *-czf*) "$REAL" "$@"; stat -c %a "${"$"}{KB_OUT}"/.*.partial > "${dir}/partial-mode"; exit 0 ;; esac; exec "$REAL" "$@"`);
    rmSync(join(out, "pre-upgrade-x-config.tar.gz"));
    const res2 = spawnSync("sh", ["-c", `umask 000; sh -c "$0" sh pre-upgrade-x-config.tar.gz`, ARCHIVE], {
      encoding: "utf8",
      env: { ...process.env, KB_SRC: src, KB_OUT: out, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(res2.status, res2.stderr).toBe(0);
    expect(readFileSync(join(dir, "partial-mode"), "utf8").trim()).toBe("600");
  });

  test("a restore puts back the same modes, never wider", () => {
    expect(run().status).toBe(0);
    const back = join(dir, "restored");
    mkdirSync(back);
    // As permissive as an operator's shell can be: the modes come from the archive.
    const res = spawnSync("sh", ["-c", `umask 000; tar -xzpf "$0" -C "$1"`, join(out, "pre-upgrade-x-config.tar.gz"), back], {
      encoding: "utf8",
    });
    expect(res.status, res.stderr).toBe(0);
    expect(mode(join(back, "secrets"))).toBe("750");
    for (const f of readdirSync(join(back, "secrets"))) {
      expect(mode(join(back, "secrets", f)), f).toBe("640");
      expect(readFileSync(join(back, "secrets", f))).toEqual(readFileSync(join(src, "secrets", f)));
    }
  });

  test("a file missing from the archive fails the backup, and no archive is left", () => {
    const bin = wrapper(dir, "tar", `case "$*" in *-czf*) exec "$REAL" --exclude=./secrets/postgres_password "$@" ;; esac; exec "$REAL" "$@"`);
    const res = run(bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("secrets/postgres_password is missing from the archive");
    expect(readdirSync(out)).toEqual([]);
  });

  test("a file whose bytes differ in the archive fails the backup", () => {
    const bin = wrapper(
      dir,
      "tar",
      `case "$*" in *-xzpf*) "$REAL" "$@" || exit 1; for a; do last="$a"; done; printf x >> "$last/secrets/jwt_secret"; exit 0 ;; esac; exec "$REAL" "$@"`,
    );
    const res = run(bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("secrets/jwt_secret differs in the archive (its contents)");
    expect(readdirSync(out)).toEqual([]);
  });

  test("a file whose mode would come back differently fails the backup", () => {
    const bin = wrapper(
      dir,
      "tar",
      `case "$*" in *-xzpf*) "$REAL" "$@" || exit 1; for a; do last="$a"; done; chmod 644 "$last/secrets/vapid_private_key"; exit 0 ;; esac; exec "$REAL" "$@"`,
    );
    const res = run(bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/secrets\/vapid_private_key differs in the archive \(regular file 640 .* restored\)/);
    expect(readdirSync(out)).toEqual([]);
  });

  test("an archive that does not extract fails the backup", () => {
    const bin = wrapper(dir, "tar", `case "$*" in *-xzpf*) exit 2 ;; esac; exec "$REAL" "$@"`);
    const res = run(bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("the archive does not extract");
    expect(readdirSync(out)).toEqual([]);
  });

  test("no folder at the source is a failure, not an empty archive", () => {
    rmSync(src, { recursive: true });
    const res = run();
    expect(res.status).not.toBe(0);
    expect(readdirSync(out)).toEqual([]);
  });

  test("a backup folder that does not keep mode 0600 is a refusal, and the archive is removed", () => {
    // A share that ignores chmod: the archive would be readable by others.
    const bin = wrapper(dir, "stat", `case "$*" in *"-c %a "*) echo 644; exit 0 ;; esac; exec "$REAL" "$@"`);
    const res = run(bin);
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain("files=");
    expect(res.stderr).toContain("the archive is mode 644, not 600");
    expect(readdirSync(out)).toEqual([]);
  });

  test("a symlink in the folder is a refusal: the backup would hold a link, not the secret", () => {
    rmSync(join(src, "secrets", "cron_secret"));
    symlinkSync("/etc/hostname", join(src, "secrets", "cron_secret"));
    const res = run();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("./secrets/cron_secret is not a plain file or folder");
    expect(readdirSync(out)).toEqual([]);
  });
});

test.describe("rotation (PRUNE_SH, real files)", () => {
  test("keeps BACKUP_KEEP runs and removes the older ones' storage and config archives with them", () => {
    const out = mkdtempSync(join(tmpdir(), "config-prune-"));
    try {
      const base = Date.now() / 1000 - 1000;
      const stamps = Array.from({ length: 7 }, (_, i) => `2026112${i}-030000`);
      stamps.forEach((s, i) => {
        // Runs 2 and 3 were taken before the install had a config folder; the rest have a config archive,
        // among them the two oldest, which the prune removes.
        const names = [`pre-upgrade-${s}.sql.gz`, `pre-upgrade-${s}-storage.tar.gz`];
        if (i !== 2 && i !== 3) names.push(`pre-upgrade-${s}-config.tar.gz`);
        for (const n of names) {
          writeFileSync(join(out, n), n);
          utimesSync(join(out, n), base + i * 10, base + i * 10);
        }
      });
      writeFileSync(join(out, ".pre-upgrade-20261120-030000-config.tar.gz.partial"), "cut short");
      writeFileSync(join(out, "my-own-notes.txt"), "not ours");
      const res = sh(PRUNE, ["5"], { KB_OUT: out });
      expect(res.status, res.stderr).toBe(0);
      const left = readdirSync(out).sort();
      const expected = ["my-own-notes.txt"];
      stamps.slice(2).forEach((s, k) => {
        expected.push(`pre-upgrade-${s}.sql.gz`, `pre-upgrade-${s}-storage.tar.gz`);
        if (k >= 2) expected.push(`pre-upgrade-${s}-config.tar.gz`);
      });
      expect(left).toEqual(expected.sort());
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("never prunes to empty", () => {
    const out = mkdtempSync(join(tmpdir(), "config-prune-"));
    try {
      writeFileSync(join(out, "pre-upgrade-1.sql.gz"), "");
      writeFileSync(join(out, "pre-upgrade-1-config.tar.gz"), "");
      expect(sh(PRUNE, ["1"], { KB_OUT: out }).status).toBe(0);
      expect(readdirSync(out).sort()).toEqual(["pre-upgrade-1-config.tar.gz", "pre-upgrade-1.sql.gz"]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

const WEBAPP = "ghcr.io/svenger87/kinboard";
const NEXT = `${WEBAPP}:next`;
const STACK: Record<string, Service> = {
  db: { ref: "supabase/postgres:15.14.1.159" },
  webapp: { ref: NEXT },
};
const IMAGES: Record<string, string> = { "supabase/postgres:15.14.1.159": "sha256:pg", [NEXT]: "sha256:web1" };
const RUNNING = Object.fromEntries(Object.entries(STACK).map(([svc, s]) => [svc, { ref: s.ref, id: IMAGES[s.ref] }]));

function rig() {
  return new Rig({ stack: STACK, containers: RUNNING, images: IMAGES, registry: { [NEXT]: "sha256:web2" } });
}

/** The `docker run` calls that write into the backup folder, without the config ones. */
const writes = (runs: string) =>
  runs
    .split("\n")
    .filter((l) => l.startsWith("run ") && l.includes(":/out"))
    .map((l) => l.replace(/pre-upgrade-\d{8}-\d{6}/g, "pre-upgrade-STAMP").replace(/\/tmp\/self-update-[^/]+/g, "RIG"));

test.describe("when the update takes the config archive (stub harness)", () => {
  test("a legacy install (no config folder): the same backup as before, and no config archive", () => {
    const r = rig();
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).not.toContain(":/config");
      expect(res.runs).not.toContain("config backup:");
      expect(res.log).not.toMatch(/config/i);
      // What the backup writes into the backup folder, in order: as before.
      const w = writes(res.runs);
      expect(w).toHaveLength(5);
      expect(w[0]).toContain("sh -c mkdir -p /out");
      expect(w[1]).toContain("cat > /out/pre-upgrade-STAMP.sql.gz");
      expect(w[2]).toContain("-czf /out/pre-upgrade-STAMP-storage.tar.gz -C /data storage");
      expect(w[3]).toContain("tar -tzf /out/pre-upgrade-STAMP-storage.tar.gz");
      expect(w[4]).toMatch(/^run --rm -v RIG\/data\/backups:\/out --entrypoint sh /);
      expect(res.recreated).toEqual(["webapp"]);
    } finally {
      r.cleanup();
    }
  });

  test("$DATA_DIR/config exists: archived from there, logged with its count", () => {
    const r = rig();
    r.setConfig({ dataDir: true });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toMatch(/run --rm --user 0:0 --entrypoint sh --tmpfs \/tmp:rw,mode=0700 -v \S+\/data\/config:\/config:ro -v \S+\/data\/backups:\/out /);
      expect(res.runs).toMatch(/ sh pre-upgrade-\d{8}-\d{6}-config\.tar\.gz/);
      expect(res.log).toMatch(/backup: pre-upgrade-\d{8}-\d{6}-config\.tar\.gz \(7 file\(s\) from \S+\/data\/config, readable by root only\)/);
      // Before anything is recreated.
      expect(res.log.indexOf("-config.tar.gz")).toBeLessThan(res.log.indexOf("--force-recreate webapp"));
      expect(res.recreated).toEqual(["webapp"]);
    } finally {
      r.cleanup();
    }
  });

  test("the stack mounts a config volume at /kinboard: that volume is archived", () => {
    const r = rig();
    r.setConfig({ mount: { svc: "webapp", source: "kinboard-config" } });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toContain("-v kinboard-config:/config:ro");
      expect(res.runs, "the mount wins; no need to look in DATA_DIR").not.toContain("[ -d /data/config ]");
      expect(res.log).toContain("from kinboard-config, readable by root only");
    } finally {
      r.cleanup();
    }
  });

  test("an archive that cannot be verified stops the update before anything is recreated", () => {
    const r = rig();
    r.setConfig({ dataDir: true, fail: true });
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("could not archive and verify the config folder");
      expect(res.out).toContain("ABORTED: no verified backup");
      expect(res.recreated).toEqual([]);
      expect(r.container("webapp")!.id).toBe("sha256:web1");
    } finally {
      r.cleanup();
    }
  });

  test("an archive step that does not confirm its count stops the update too", () => {
    const r = rig();
    r.setConfig({ dataDir: true, out: "" });
    try {
      const res = r.run();
      expect(res.status).toBe(1);
      expect(res.out).toContain("the config archive was not confirmed");
      expect(res.recreated).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  test("an empty config folder: archived, with a warning that it holds no secrets", () => {
    const r = rig();
    r.setConfig({ dataDir: true, out: "files=0\n" });
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("holds no files; the backup has no secrets to restore");
      expect(res.recreated).toEqual(["webapp"]);
    } finally {
      r.cleanup();
    }
  });

  test("the prune is told how many to keep", () => {
    const r = rig();
    try {
      const res = r.run([], { BACKUP_KEEP: "3" });
      expect(res.status, res.out).toBe(0);
      expect(res.runs).toMatch(/ sh 3$/m);
    } finally {
      r.cleanup();
    }
  });
});

test("the update script never copies .env into a backup (RFC-023 §11.7)", () => {
  const backup = script.slice(script.indexOf("take_backup() {"), script.indexOf("\nBACKUP_FILE=\"\""));
  expect(backup.length).toBeGreaterThan(1000);
  expect(backup).not.toMatch(/\.env["'\s]*\S*\s*\/out/);
  // Read for DATA_DIR, nothing else.
  const uses = backup.split("\n").filter((l) => l.includes(".env") && !/^\s*(#|log )/.test(l));
  expect(uses).toHaveLength(1);
  expect(uses[0]).toContain("grep -E '^DATA_DIR='");
  expect(existsSync(SCRIPT)).toBe(true);
});
