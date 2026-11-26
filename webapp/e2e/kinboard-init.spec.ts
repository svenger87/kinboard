import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webpush from "web-push";

/**
 * RFC-023 PR 2: kinboard-init fills in the secrets store; kinboard-db-init
 * aligns authenticator's password and applies init.sql to an empty database.
 *
 * kinboard-init runs here against temporary directories: its paths, the
 * mount table and the clock are parameters. Ownership (root:0) needs root and
 * is checked on a real stack, not here; modes are checked here.
 *
 * Imported dynamically: Playwright's require hook mangles a statically
 * imported .mjs (see secrets-store.spec.ts).
 */
interface Mount { mountPoint: string; fsType: string; source: string }
interface Write { file: string; value: string; previous: boolean }
interface Plan { writes: Write[]; lines: string[]; warnings: string[]; errors: string[] }
interface Result { ok: boolean; lines: string[]; warnings: string[]; errors: string[] }
interface Gen { hex: () => string; vapid: () => { publicKey: string; privateKey: string } }
interface InitModule {
  DIR_MODE: number;
  FILE_MODE: number;
  parseMountinfo(text: string): Mount[];
  mountOf(path: string, mounts: Mount[]): Mount | null;
  checkFilesystems(o: { dbDir: string; configDir: string; mounts: Mount[] }): string[];
  randomHex(): string;
  generateVapid(): { publicKey: string; privateKey: string };
  vapidPairMatches(pub: string, priv: string): boolean;
  dbUri(password: string): string;
  needsRewrite(raw: string): boolean;
  postgrestCanEnter(st: { mode: number; uid: number; gid: number }): boolean;
  planSecrets(o: { env: Record<string, string | undefined>; current: Record<string, string | null>; cluster: boolean; gen?: Gen }): Plan;
  runInit(o: {
    env?: Record<string, string | undefined>; configDir?: string; dbDir?: string; mountinfo?: string | null;
    now?: Date; asRoot?: boolean; gen?: Gen; chmod?: (path: string, mode: number) => void;
  }): Result;
}
interface StoreModule {
  resolveSecrets(env: Record<string, string>, opts?: { dir?: string }): { values: Record<string, string>; errors: string[] };
  fileValue(content: string): string;
}
const init: Promise<InitModule> = import("../docker/kinboard-init.mjs");
const store: Promise<StoreModule> = import("../docker/secrets-store.mjs");

const DOCKER = join(__dirname, "..", "docker");
const SECRET_FILES = ["postgres_password", "jwt_secret", "cron_secret", "presence_sensor_token", "vapid_public_key", "vapid_private_key"];
const ENV_OF: Record<string, string> = {
  postgres_password: "POSTGRES_PASSWORD", jwt_secret: "JWT_SECRET", cron_secret: "CRON_SECRET",
  presence_sensor_token: "PRESENCE_SENSOR_TOKEN", vapid_public_key: "VAPID_PUBLIC_KEY", vapid_private_key: "VAPID_PRIVATE_KEY",
};
/** A mount table with everything on one ordinary disk. */
const EXT4 = "22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw\n";

/** A config volume and a database volume in a temporary directory. */
function rig() {
  const root = mkdtempSync(join(tmpdir(), "kb-init-"));
  const configDir = join(root, "config");
  const dbDir = join(root, "db");
  mkdirSync(configDir);
  mkdirSync(dbDir);
  const secrets = join(configDir, "secrets");
  return {
    root, configDir, dbDir, secrets,
    cluster: () => writeFileSync(join(dbDir, "PG_VERSION"), "15\n"),
    put: (file: string, content: string) => {
      mkdirSync(secrets, { recursive: true });
      writeFileSync(join(secrets, file), content);
    },
    read: (file: string) => readFileSync(join(secrets, file), "utf8"),
    files: () => (existsSync(secrets) ? readdirSync(secrets).sort() : []),
    /** Every file's name, inode, mode, size, mtime, ctime and content hash. */
    snapshot: () => {
      const out: Record<string, string> = {};
      const dirSt = statSync(secrets);
      out["."] = `${dirSt.ino} ${dirSt.mode} ${dirSt.mtimeMs} ${dirSt.ctimeMs}`;
      for (const n of readdirSync(secrets).sort()) {
        const st = statSync(join(secrets, n));
        out[n] = `${st.ino} ${st.mode} ${st.size} ${st.mtimeMs} ${st.ctimeMs} ` +
          createHash("sha256").update(readFileSync(join(secrets, n))).digest("hex");
      }
      return out;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
type Rig = ReturnType<typeof rig>;

async function run(r: Rig, env: Record<string, string | undefined> = {}, extra: Partial<Parameters<InitModule["runInit"]>[0]> = {}) {
  const { runInit } = await init;
  return runInit({ env, configDir: r.configDir, dbDir: r.dbDir, mountinfo: EXT4, asRoot: false, ...extra });
}

let r: Rig;
test.beforeEach(() => { r = rig(); });
test.afterEach(() => r.cleanup());

test.describe("generation: a fresh install with no .env", () => {
  test("every secret is generated in the RFC's format, plus db_uri, and one line per secret", async () => {
    const res = await run(r);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(r.files()).toEqual([...SECRET_FILES, "db_uri"].sort());
    for (const f of ["postgres_password", "jwt_secret", "cron_secret", "presence_sensor_token"]) {
      expect(r.read(f), f).toMatch(/^[0-9a-f]{64}$/);
    }
    // Every value its own.
    expect(new Set(["postgres_password", "jwt_secret", "cron_secret", "presence_sensor_token"].map(r.read)).size).toBe(4);
    for (const f of SECRET_FILES) expect(res.lines).toContain(`${f}: generated`);
    expect(res.lines).toContain("db_uri: written from postgres_password");
    expect(r.read("db_uri")).toBe(`postgres://authenticator:${r.read("postgres_password")}@db:5432/postgres`);
  });

  test("the VAPID pair is web-push's format, belongs together, and web-push accepts it", async () => {
    await run(r);
    const pub = r.read("vapid_public_key");
    const priv = r.read("vapid_private_key");
    expect(Buffer.from(pub, "base64url")).toHaveLength(65);
    expect(Buffer.from(priv, "base64url")).toHaveLength(32);
    expect(pub).not.toMatch(/[=+/]/);
    const { vapidPairMatches } = await init;
    expect(vapidPairMatches(pub, priv)).toBe(true);
    expect(() => webpush.setVapidDetails("mailto:test@example.invalid", pub, priv)).not.toThrow();
    const headers = webpush.getVapidHeaders("https://push.example.invalid", "mailto:test@example.invalid", pub, priv, "aes128gcm");
    expect(String(headers.Authorization)).toContain(`k=${pub}`);
  });

  test("a private key with leading zero bytes is still 32 bytes", async () => {
    const { generateVapid } = await init;
    for (let i = 0; i < 300; i++) {
      const { privateKey, publicKey } = generateVapid();
      expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
      expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);
    }
  });

  test("the webapp's reader reads back exactly what was generated", async () => {
    await run(r);
    const { resolveSecrets } = await store;
    const { values, errors } = resolveSecrets({}, { dir: r.secrets });
    expect(errors).toEqual([]);
    for (const f of SECRET_FILES) expect(values[ENV_OF[f]], f).toBe(r.read(f));
  });

  test("an awkward password is URL-encoded in db_uri, and decodes back to itself", async () => {
    const { dbUri } = await init;
    const pw = `p@ss:w/rd?#%&'" ü`;
    const uri = dbUri(pw);
    const u = new URL(uri);
    expect(decodeURIComponent(u.password)).toBe(pw);
    expect(u.username).toBe("authenticator");
    expect(u.host).toBe("db:5432");
    expect(u.pathname).toBe("/postgres");
  });
});

test.describe("mirroring .env", () => {
  test("every value in the environment is written into its file (taken from .env)", async () => {
    const env = Object.fromEntries(SECRET_FILES.map((f) => [ENV_OF[f], `env-${f}`]));
    // A real pair, so the pair check stays quiet.
    const { generateVapid } = await init;
    const pair = generateVapid();
    env.VAPID_PUBLIC_KEY = pair.publicKey;
    env.VAPID_PRIVATE_KEY = pair.privateKey;
    const res = await run(r, env);
    expect(res.errors).toEqual([]);
    for (const f of SECRET_FILES) {
      expect(r.read(f), f).toBe(env[ENV_OF[f]]);
      expect(res.lines).toContain(`${f}: taken from .env`);
    }
    expect(res.warnings).toEqual([]);
  });

  test("an existing install's database, adopted with POSTGRES_PASSWORD in .env and no file: taken from .env", async () => {
    r.cluster();
    const res = await run(r, { POSTGRES_PASSWORD: "the-old-password" });
    expect(res.errors).toEqual([]);
    expect(r.read("postgres_password")).toBe("the-old-password");
    expect(r.read("db_uri")).toBe("postgres://authenticator:the-old-password@db:5432/postgres");
  });

  test("an empty environment value counts as unset (compose's ${X:-} with X unset)", async () => {
    r.put("jwt_secret", "stored");
    const res = await run(r, { JWT_SECRET: "" });
    expect(r.read("jwt_secret")).toBe("stored");
    expect(res.lines).toContain("jwt_secret: kept");
  });

  test("the same value in .env and the file: kept, the file not touched", async () => {
    await run(r);
    const pw = r.read("postgres_password");
    const before = r.snapshot();
    const res = await run(r, { POSTGRES_PASSWORD: pw });
    expect(res.lines).toContain("postgres_password: kept");
    expect(r.snapshot()).toEqual(before);
  });

  for (const f of SECRET_FILES.filter((f) => f !== "postgres_password" && !f.startsWith("vapid"))) {
    test(`${f}: a different value in .env wins; the old file is kept as .previous-<time>, with a warning`, async () => {
      r.put(f, "old-value\n");
      const now = new Date("2026-11-26T10:20:30.456Z");
      const res = await run(r, { [ENV_OF[f]]: "new-value" }, { now });
      expect(res.ok).toBe(true);
      expect(r.read(f)).toBe("new-value");
      expect(r.read(`${f}.previous-20261126T102030Z`)).toBe("old-value\n");
      expect(res.lines).toContain(`${f}: replaced from .env (previous kept)`);
      expect(res.warnings.join("\n")).toContain(f);
      expect(res.warnings.join("\n")).not.toContain("old-value");
      expect(res.warnings.join("\n")).not.toContain("new-value");
    });
  }

  test("a value with a line break in .env is refused: the two readers would disagree on it", async () => {
    const res = await run(r, { JWT_SECRET: "abc\r" });
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("JWT_SECRET");
    expect(r.files()).toEqual([]);
  });
});

test.describe("the database password guard", () => {
  test("a different POSTGRES_PASSWORD in .env than the stored one: refused, naming both, nothing changed", async () => {
    await run(r);
    r.cluster();
    const before = r.snapshot();
    const stored = r.read("postgres_password");
    const res = await run(r, { POSTGRES_PASSWORD: "something-else", JWT_SECRET: "would-be-new" });
    expect(res.ok).toBe(false);
    const msg = res.errors.join("\n");
    expect(msg).toContain("POSTGRES_PASSWORD in the environment");
    expect(msg).toContain("secrets/postgres_password");
    expect(msg).toContain("will not guess");
    // Never a value.
    expect(msg).not.toContain(stored);
    expect(msg).not.toContain("something-else");
    // Not even the JWT secret, which on its own would have been replaced.
    expect(r.snapshot()).toEqual(before);
  });

  test("refused before the database exists too: the RFC refuses on any disagreement", async () => {
    r.put("postgres_password", "stored");
    const res = await run(r, { POSTGRES_PASSWORD: "different" });
    expect(res.ok).toBe(false);
    expect(r.read("postgres_password")).toBe("stored");
  });

  test("a cluster exists, the file is gone and .env has no password: refused, saying to restore it", async () => {
    r.cluster();
    const res = await run(r);
    expect(res.ok).toBe(false);
    const msg = res.errors.join("\n");
    expect(msg).toContain("already holds a PostgreSQL cluster");
    expect(msg).toContain("Restore");
    expect(msg).toContain("POSTGRES_PASSWORD");
    expect(r.files()).toEqual([]);
    expect(existsSync(r.secrets), "a refusal created the secrets folder").toBe(false);
  });

  test("an empty password file with a cluster is the same as a missing one", async () => {
    r.cluster();
    r.put("postgres_password", "\n");
    const res = await run(r);
    expect(res.ok).toBe(false);
    expect(r.read("postgres_password")).toBe("\n");
  });

  test("a cluster with its file: nothing to refuse, the password kept", async () => {
    r.put("postgres_password", "stored");
    r.cluster();
    const res = await run(r);
    expect(res.ok).toBe(true);
    expect(r.read("postgres_password")).toBe("stored");
  });

  test("the other secrets, missing next to an existing cluster, are generated", async () => {
    r.put("postgres_password", "stored");
    r.cluster();
    const res = await run(r);
    expect(res.lines).toContain("jwt_secret: generated");
    expect(r.read("jwt_secret")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an unreadable database volume is an error, never a guess that it is empty", async () => {
    test.skip(process.getuid?.() === 0, "root reads anything");
    chmodSync(r.dbDir, 0o000);
    try {
      const res = await run(r);
      expect(res.ok).toBe(false);
      expect(res.errors.join("\n")).toContain("Cannot tell whether");
      expect(r.files()).toEqual([]);
    } finally {
      chmodSync(r.dbDir, 0o755);
    }
  });

  test("no database volume mounted: refused, it could not tell new from existing", async () => {
    rmSync(r.dbDir, { recursive: true });
    const res = await run(r);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("not mounted");
  });
});

test.describe("modes", () => {
  test("the folder is 0750 and every file 0640, whatever the umask or the old modes", async () => {
    r.put("jwt_secret", "x");
    chmodSync(join(r.secrets, "jwt_secret"), 0o666);
    chmodSync(r.secrets, 0o777);
    const old = process.umask(0o000);
    try {
      const res = await run(r);
      expect(res.ok).toBe(true);
      expect(res.warnings).toEqual([]);
    } finally {
      process.umask(old);
    }
    expect(statSync(r.secrets).mode & 0o777).toBe(0o750);
    for (const f of r.files()) expect((statSync(join(r.secrets, f)).mode & 0o777).toString(8), f).toBe("640");
  });

  test("a .previous file is a secret too: 0640", async () => {
    r.put("cron_secret", "old");
    chmodSync(join(r.secrets, "cron_secret"), 0o644);
    await run(r, { CRON_SECRET: "new" }, { now: new Date("2026-11-26T00:00:00Z") });
    expect(statSync(join(r.secrets, "cron_secret.previous-20261126T000000Z")).mode & 0o777).toBe(0o640);
  });

  test("modes that do not stick are a warning naming the files, not a refusal (RFC-023 §6.3)", async () => {
    r.put("jwt_secret", "j");
    chmodSync(join(r.secrets, "jwt_secret"), 0o644);
    chmodSync(r.secrets, 0o755);
    // A share that ignores chmod: every call succeeds and changes nothing.
    const res = await run(r, {}, { chmod: () => {} });
    expect(res.ok).toBe(true);
    const warning = res.warnings.join("\n");
    expect(warning).toContain("did not keep their permissions");
    expect(warning).toContain(`${r.secrets} (0755`);
    expect(warning).toContain(`${join(r.secrets, "jwt_secret")} (0644`);
    expect(warning).not.toContain('"j"');
  });
});

test.describe("filesystems", () => {
  const line = (mp: string, type: string, src = "/dev/x") => `40 22 0:50 / ${mp} rw - ${type} ${src} rw\n`;

  for (const [type, words] of [
    ["vfat", "FAT filesystem"], ["msdos", "FAT filesystem"], ["exfat", "FAT filesystem"],
    ["cifs", "network share"], ["smb3", "network share"],
    ["9p", "Windows drive"], ["drvfs", "Windows drive"], ["fuseblk", "Windows drive"],
    ["ntfs", "Windows drive"], ["ntfs3", "Windows drive"], ["vboxsf", "VirtualBox"],
    ["tmpfs", "next reboot"], ["ramfs", "next reboot"],
  ] as const) {
    test(`a database on ${type} is refused, saying why, and nothing is written`, async () => {
      const res = await run(r, {}, { mountinfo: EXT4 + line(r.dbDir, type) });
      expect(res.ok).toBe(false);
      expect(res.errors.join("\n")).toContain(words);
      expect(res.errors.join("\n")).toContain("KINBOARD_DB_DIR");
      expect(existsSync(r.secrets), "a refusal created the secrets folder").toBe(false);
    });
  }

  for (const type of ["ext4", "xfs", "btrfs", "zfs", "overlay", "fuse.shfs", "nfs4", "fuse.mergerfs"]) {
    test(`a database on ${type} is fine`, async () => {
      const res = await run(r, {}, { mountinfo: EXT4 + line(r.dbDir, type) });
      expect(res.errors).toEqual([]);
    });
  }

  test("config on tmpfs is refused (the secrets would be gone after a reboot); config on vfat is not", async () => {
    let res = await run(r, {}, { mountinfo: EXT4 + line(r.configDir, "tmpfs") });
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("KINBOARD_CONFIG_DIR");
    res = await run(r, {}, { mountinfo: EXT4 + line(r.configDir, "vfat") });
    expect(res.ok).toBe(true);
  });

  test("the mount that counts is the longest one containing the path; the last of stacked mounts wins", async () => {
    const { parseMountinfo, mountOf } = await init;
    const mounts = parseMountinfo(
      EXT4 + line("/kinboard", "tmpfs") + line("/kinboard-db", "vfat") + line("/kinboard-db", "ext4") + line("/kinboard/sub", "xfs"),
    );
    expect(mountOf("/kinboard-db", mounts)?.fsType).toBe("ext4");
    expect(mountOf("/kinboard", mounts)?.fsType).toBe("tmpfs");
    expect(mountOf("/kinboard/sub/x", mounts)?.fsType).toBe("xfs");
    expect(mountOf("/kinboardx", mounts)?.fsType).toBe("ext4");
  });

  test("mountinfo's escapes and optional fields are read correctly", async () => {
    const { parseMountinfo } = await init;
    const [m] = parseMountinfo("36 35 98:0 /mnt1 /mnt\\040two rw,noatime master:1 shared:2 - fuse.shfs shfs rw\n");
    expect(m).toEqual({ mountPoint: "/mnt two", fsType: "fuse.shfs", source: "shfs" });
  });

  test("this machine's own mount table parses, and / has a type", async () => {
    const { parseMountinfo, mountOf } = await init;
    const mounts = parseMountinfo(readFileSync("/proc/self/mountinfo", "utf8"));
    expect(mounts.length).toBeGreaterThan(0);
    expect(mountOf("/", mounts)?.fsType).toBeTruthy();
  });
});

test.describe("what a file holds: a byte-order mark or a Windows line ending is rewritten away", () => {
  test("needsRewrite is true exactly where the database and the webapp would read different values", async () => {
    const { needsRewrite } = await init;
    expect(needsRewrite("abc")).toBe(false);
    expect(needsRewrite("abc\n")).toBe(false);
    expect(needsRewrite("abc\n\n")).toBe(false);
    expect(needsRewrite(" abc \t")).toBe(false); // spaces are part of the value for both
    expect(needsRewrite("﻿abc")).toBe(true);
    expect(needsRewrite("﻿abc\r\n")).toBe(true);
    expect(needsRewrite("abc\r\n")).toBe(true);
    expect(needsRewrite("abc\r")).toBe(true);
  });

  for (const [what, raw] of [["a byte-order mark", "﻿secret-pw\n"], ["a Windows line ending", "secret-pw\r\n"], ["both", "﻿secret-pw\r\n"]] as const) {
    test(`postgres_password saved with ${what}: rewritten as its value before db reads it`, async () => {
      r.put("postgres_password", raw);
      const res = await run(r);
      expect(res.ok).toBe(true);
      const bytes = readFileSync(join(r.secrets, "postgres_password"));
      expect(bytes.toString("utf8")).toBe("secret-pw");
      expect(bytes[0]).not.toBe(0xef);
      expect(res.lines.find((l) => l.startsWith("postgres_password:"))).toMatch(/^postgres_password: kept \(rewritten/);
      // And what the database's file_env would read is the same value.
      const viaBash = spawnSync("bash", ["-c", 'v="$(< "$1")"; printf %s "$v"', "_", join(r.secrets, "postgres_password")], { encoding: "utf8" });
      expect(viaBash.stdout).toBe("secret-pw");
    });
  }

  test("without the rewrite the two readers really do disagree (why it is needed)", async () => {
    r.put("jwt_secret", "﻿v\r\n");
    const { fileValue } = await store;
    const viaBash = spawnSync("bash", ["-c", 'v="$(< "$1")"; printf %s "$v"', "_", join(r.secrets, "jwt_secret")], { encoding: "utf8" });
    expect(viaBash.stdout).not.toBe(fileValue(r.read("jwt_secret")));
  });

  test("a file that only has a trailing \\n is left alone", async () => {
    r.put("jwt_secret", "j\n");
    await run(r);
    expect(r.read("jwt_secret")).toBe("j\n");
  });

  test("the same value in .env as a BOM file: kept, and the file rewritten", async () => {
    r.put("cron_secret", "﻿c");
    const res = await run(r, { CRON_SECRET: "c" });
    expect(r.read("cron_secret")).toBe("c");
    expect(res.lines.find((l) => l.startsWith("cron_secret:"))).toMatch(/kept \(rewritten/);
  });
});

test.describe("the VAPID pair", () => {
  test("one half stored, the other missing: both generated, the old half kept, a warning", async () => {
    const { generateVapid, vapidPairMatches } = await init;
    const old = generateVapid();
    r.put("vapid_public_key", old.publicKey);
    const res = await run(r, {}, { now: new Date("2026-11-26T00:00:00Z") });
    expect(res.ok).toBe(true);
    expect(r.read("vapid_public_key")).not.toBe(old.publicKey);
    expect(vapidPairMatches(r.read("vapid_public_key"), r.read("vapid_private_key"))).toBe(true);
    expect(r.read("vapid_public_key.previous-20261126T000000Z")).toBe(old.publicKey);
    expect(res.warnings.join("\n")).toContain("enable notifications again");
  });

  test("one half in .env, the other nowhere: refused, a pair cannot be completed", async () => {
    const { generateVapid } = await init;
    const res = await run(r, { VAPID_PUBLIC_KEY: generateVapid().publicKey });
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("are a pair");
  });

  test("a pair that does not belong together is a warning, and left as it is", async () => {
    const { generateVapid } = await init;
    const a = generateVapid();
    const b = generateVapid();
    const res = await run(r, { VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: b.privateKey });
    expect(res.ok).toBe(true);
    expect(res.warnings.join("\n")).toContain("does not belong");
    expect(r.read("vapid_public_key")).toBe(a.publicKey);
  });
});

test.describe("idempotence", () => {
  test("a second run writes nothing and touches no file: same inodes, modes, times and bytes", async () => {
    const first = await run(r);
    expect(first.ok).toBe(true);
    const before = r.snapshot();
    const second = await run(r);
    expect(second.ok).toBe(true);
    expect(r.snapshot()).toEqual(before);
    for (const f of SECRET_FILES) expect(second.lines).toContain(`${f}: kept`);
    expect(second.lines).toContain("db_uri: kept");
  });

  test("also with every secret coming from .env", async () => {
    const env = { POSTGRES_PASSWORD: "p", JWT_SECRET: "j", CRON_SECRET: "c" };
    await run(r, env);
    const before = r.snapshot();
    await run(r, env);
    expect(r.snapshot()).toEqual(before);
  });

  test("a temporary file from an interrupted run is cleared, the real files unharmed", async () => {
    await run(r);
    writeFileSync(join(r.secrets, ".jwt_secret.init-tmp"), "half");
    const jwt = r.read("jwt_secret");
    await run(r);
    expect(r.files()).not.toContain(".jwt_secret.init-tmp");
    expect(r.read("jwt_secret")).toBe(jwt);
  });

  test("db_uri follows postgres_password: a changed password file rewrites it on the next run", async () => {
    await run(r);
    r.put("postgres_password", "changed-by-hand");
    const res = await run(r);
    expect(r.read("db_uri")).toBe("postgres://authenticator:changed-by-hand@db:5432/postgres");
    expect(res.lines).toContain("db_uri: written from postgres_password");
  });
});

test.describe("as a process", () => {
  const SCRIPT = join(DOCKER, "kinboard-init.mjs");
  const exec = (env: Record<string, string>) =>
    spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, KINBOARD_CONFIG_ROOT: r.configDir, KINBOARD_DB_MOUNT: r.dbDir, ...env },
      encoding: "utf8",
    });

  test("exits 0, logs one line per secret, never a value", () => {
    const p = exec({ POSTGRES_PASSWORD: "", JWT_SECRET: "jwt-from-env-xyz" });
    expect(p.status, p.stderr).toBe(0);
    const out = p.stdout + p.stderr;
    expect(out).toContain("[kinboard-init] secret jwt_secret: taken from .env");
    expect(out).toContain("[kinboard-init] secret postgres_password: generated");
    expect(out).toContain("[kinboard-init] done");
    for (const f of r.files()) expect(out, f).not.toContain(r.read(f));
    expect(out).not.toContain("jwt-from-env-xyz");
  });

  test("a refusal exits non-zero and says the stack will not start", () => {
    r.cluster();
    const p = exec({ POSTGRES_PASSWORD: "" });
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("already holds a PostgreSQL cluster");
    expect(p.stderr).toContain("refusing to continue");
  });
});

test.describe("wiring", () => {
  const entry = readFileSync(join(DOCKER, "webapp-entrypoint.sh"), "utf8");
  const dockerfile = readFileSync(join(DOCKER, "Dockerfile"), "utf8");

  test("the entrypoint hands kinboard-init and kinboard-db-init off before it reads a secret", () => {
    const dispatch = entry.indexOf("kinboard-init | kinboard-db-init)");
    expect(dispatch).toBeGreaterThan(0);
    expect(dispatch).toBeLessThan(entry.indexOf("node /app/secrets-store.mjs"));
    expect(dispatch).toBeLessThan(entry.indexOf("PUID"));
  });

  test("the image carries both commands and init.sql, at the paths the scripts use", () => {
    expect(dockerfile).toMatch(/\nCOPY docker\/kinboard-init\.mjs docker\/kinboard-db-init\.sh \.\/\n/);
    expect(dockerfile).toMatch(/\nCOPY docker\/init\.sql \.\/initdb\/init\.sql\n/);
    expect(dockerfile).toContain(`exec node /app/kinboard-init.mjs "$@"\\n' > /usr/local/bin/kinboard-init`);
    expect(dockerfile).toContain(`exec sh /app/kinboard-db-init.sh "$@"\\n' > /usr/local/bin/kinboard-db-init`);
    // kinboard-init imports the reader from its own directory.
    expect(readFileSync(join(DOCKER, "kinboard-init.mjs"), "utf8")).toContain('from "./secrets-store.mjs"');
    expect(dockerfile).toMatch(/COPY [^\n]*docker\/secrets-store\.mjs [^\n]*\.\/\n/);
  });

  test("init.sql reaches the build context: .dockerignore does not exclude it", () => {
    const ignore = readFileSync(join(__dirname, "..", ".dockerignore"), "utf8")
      .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    // A .dockerignore pattern as a regex: every regex character escaped, then `*` as one path segment's worth.
    const asRegex = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^/]*")}(/.*)?$`);
    // The matcher itself: it must see the lines that would exclude the file, and only those.
    for (const p of ["docker/init.sql", "docker/*.sql", "docker", "*", "docker/*"]) expect(asRegex(p).test("docker/init.sql"), p).toBe(true);
    for (const p of ["docker/.env*", "docker/init+sql", "docker/init.sq", "init.sql", "docker/(init).sql"]) expect(asRegex(p).test("docker/init.sql"), p).toBe(false);
    const hits = ignore.filter((p) => !p.startsWith("!") && asRegex(p).test("docker/init.sql"));
    expect(hits).toEqual([]);
  });

  test("the rig compares the built image's init.sql with the repository's, byte for byte", () => {
    const rigSh = readFileSync(join(__dirname, "..", "..", "scripts", "rigs", "test-fresh-install.sh"), "utf8");
    expect(rigSh).toContain("/app/initdb/init.sql");
    // Against the repository's file, by a variable the rig actually sets.
    expect(rigSh).toContain('| cmp -s - "$DOCKER_DIR/init.sql"');
    expect(rigSh).toMatch(/\nDOCKER_DIR="\$REPO_ROOT\/webapp\/docker"\n/);
  });

  test("the legacy compose file has no init service, and its db-init keeps its own image and script", () => {
    const legacy = readFileSync(join(DOCKER, "docker-compose.yml"), "utf8");
    expect(legacy).not.toMatch(/kinboard-init|kinboard-db-init/);
    expect(legacy).not.toMatch(/^ {2}init:/m);
    const dbInit = legacy.slice(legacy.indexOf("\n  db-init:"), legacy.indexOf("\n  rest:"));
    expect(dbInit).toContain("image: supabase/postgres:");
    expect(dbInit).toContain("ALTER USER authenticator WITH PASSWORD");
    expect(legacy).toContain("./init.sql:/docker-entrypoint-initdb.d/zz-init.sql");
  });
});

test.describe("kinboard-db-init", () => {
  const SCRIPT = join(DOCKER, "kinboard-db-init.sh");
  const source = readFileSync(SCRIPT, "utf8");

  /** Runs the real script with psql stubbed: it records every call and answers from a scenario. */
  function dbInit(o: { families: "t" | "f" | "error"; initFails?: boolean; password?: string; authenticatorAfter?: number }) {
    const dir = mkdtempSync(join(tmpdir(), "kb-dbinit-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      mkdirSync(join(dir, "secrets"));
      writeFileSync(join(dir, "secrets", "postgres_password"), (o.password ?? "pw") + "\n");
      const log = join(dir, "calls");
      writeFileSync(join(dir, "count"), "0");
      const stub = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      };
      stub("psql", [
        `stdin=""; if [ ! -t 0 ]; then stdin="$(cat)"; fi`,
        `printf 'CALL PGPASSWORD=%s ARGS=%s\\nSTDIN=%s\\n' "$PGPASSWORD" "$*" "$stdin" >> "${log}"`,
        `case "$*" in`,
        `  *"rolname = 'authenticator'"*) n=$(cat "${join(dir, "count")}"); echo $((n+1)) > "${join(dir, "count")}"; [ "$n" -ge ${o.authenticatorAfter ?? 0} ] && echo 1; exit 0 ;;`,
        `  *"to_regclass('public.families')"*) ${o.families === "error" ? "exit 2" : `echo ${o.families}`}; exit 0 ;;`,
        `  *"--single-transaction -f"*) ${o.initFails ? "echo 'ERROR: boom' >&2; exit 3" : "exit 0"} ;;`,
        `esac`,
        `exit 0`,
      ].join("\n"));
      stub("sleep", "exit 0");
      const p = spawnSync("sh", [SCRIPT], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, KINBOARD_SECRETS_DIR: join(dir, "secrets"),
          KINBOARD_SECRETS_READER: join(DOCKER, "secrets-store.mjs"), POSTGRES_PASSWORD: "", KINBOARD_INIT_SQL: "/x/init.sql" },
        encoding: "utf8",
      });
      return { status: p.status, out: p.stdout + p.stderr, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("the password comes from the store, reaches psql through the environment, and never enters the SQL text", () => {
    const pw = `it's "q" \`id\` $HOME; DROP TABLE x; --`;
    const res = dbInit({ families: "t", password: pw });
    expect(res.status, res.out).toBe(0);
    const alter = res.calls.split("CALL ").find((c) => c.includes("ALTER ROLE authenticator"));
    expect(alter, res.calls).toBeTruthy();
    expect(alter).toContain(`PGPASSWORD=${pw}`);
    expect(alter).toContain("\\getenv pw PGPASSWORD");
    expect(alter).toContain("ALTER ROLE authenticator WITH PASSWORD :'pw';");
    for (const off of ["log_statement = 'none'", "log_min_error_statement = 'panic'", "log_min_duration_statement = -1", "pg_stat_statements.track_utility = off"]) {
      expect(alter, off).toContain(`SET LOCAL ${off};`);
    }
    expect(alter!.indexOf("SET LOCAL log_min_error_statement")).toBeLessThan(alter!.indexOf("ALTER ROLE"));
    // The SQL and the arguments: no trace of the value.
    expect(alter!.slice(alter!.indexOf("ARGS="))).not.toContain("DROP TABLE");
    expect(res.out).not.toContain("DROP TABLE");
  });

  test("an existing schema: init.sql is not applied", () => {
    const res = dbInit({ families: "t" });
    expect(res.status).toBe(0);
    expect(res.calls).not.toContain("--single-transaction");
    expect(res.out).toContain("init.sql not applied");
  });

  test("an empty database: init.sql applied as supabase_admin, in one transaction, stopping at the first error", () => {
    const res = dbInit({ families: "f" });
    expect(res.status, res.out).toBe(0);
    const apply = res.calls.split("CALL ").find((c) => c.includes("-f /x/init.sql"));
    expect(apply).toContain("-U supabase_admin");
    expect(apply).toContain("--single-transaction");
    expect(apply).toContain("ON_ERROR_STOP=1");
    // The password is aligned before the schema is looked at.
    expect(res.calls.indexOf("ALTER ROLE")).toBeLessThan(res.calls.indexOf("to_regclass"));
  });

  test("init.sql failing: exits non-zero, saying it was rolled back", () => {
    const res = dbInit({ families: "f", initFails: true });
    expect(res.status).toBe(1);
    expect(res.out).toContain("rolled back");
  });

  test("the schema check failing: exits non-zero, never applies init.sql on a guess", () => {
    const res = dbInit({ families: "error" });
    expect(res.status).toBe(1);
    expect(res.calls).not.toContain("--single-transaction");
  });

  test("waits for authenticator to exist before aligning it", () => {
    const res = dbInit({ families: "t", authenticatorAfter: 3 });
    expect(res.status, res.out).toBe(0);
    expect(res.out.match(/waiting for the database's roles/g)).toHaveLength(3);
  });

  test("no password anywhere: exits before connecting", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-dbinit-"));
    try {
      const p = spawnSync("sh", [SCRIPT], {
        env: { ...process.env, KINBOARD_SECRETS_DIR: join(dir, "none"), KINBOARD_SECRETS_READER: join(DOCKER, "secrets-store.mjs"), POSTGRES_PASSWORD: "" },
        encoding: "utf8",
      });
      expect(p.status).toBe(1);
      expect(p.stderr).toContain("did kinboard-init run?");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("never interpolates the password into SQL (no ${...} inside a heredoc it feeds psql)", () => {
    expect(source).toContain("<<'SQL'");
    expect(source).not.toMatch(/PASSWORD '\$/);
  });
});

test.describe("after review: crashes, odd filesystems and odd files", () => {
  test("a filesystem that refuses chmod (EPERM) is a warning, not a failure", async () => {
    r.put("jwt_secret", "j");
    chmodSync(join(r.secrets, "jwt_secret"), 0o644);
    let calls = 0;
    const res = await run(r, {}, { chmod: () => { calls++; throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } });
    expect(calls, "chmod was never called, so this proves nothing").toBeGreaterThan(0);
    expect(res.ok, res.errors.join("\n")).toBe(true);
    expect(res.warnings.join("\n")).toContain("did not keep their permissions");
  });

  test("a stored secret that is a symlink is refused, never followed", async () => {
    const target = join(r.root, "elsewhere");
    writeFileSync(target, "outside");
    mkdirSync(r.secrets);
    symlinkSync(target, join(r.secrets, "jwt_secret"));
    const res = await run(r);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("not a plain file");
    expect(readFileSync(target, "utf8")).toBe("outside");
    expect((statSync(target).mode & 0o777).toString(8)).not.toBe("640");
  });

  test("a dangling symlink among the files: refused if it is a secret's name, left alone otherwise", async () => {
    mkdirSync(r.secrets);
    symlinkSync(join(r.root, "gone"), join(r.secrets, "unrelated"));
    const res = await run(r);
    expect(res.ok, res.errors.join("\n")).toBe(true);
    expect(res.warnings.join("\n")).toContain("Left alone");
    // A second run is still fine: the link breaks nothing.
    expect((await run(r)).ok).toBe(true);
  });

  test("the secrets folder itself a symlink: refused", async () => {
    const real = join(r.root, "real-secrets");
    mkdirSync(real);
    symlinkSync(real, r.secrets);
    const res = await run(r);
    expect(res.ok).toBe(false);
    expect(readdirSync(real)).toEqual([]);
  });

  test("a temporary file over a missing postgres_password is never deleted: it may be the only copy", async () => {
    mkdirSync(r.secrets);
    writeFileSync(join(r.secrets, ".postgres_password.init-tmp"), "the-only-copy");
    r.cluster();
    const res = await run(r);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain("rename it to postgres_password");
    expect(readFileSync(join(r.secrets, ".postgres_password.init-tmp"), "utf8")).toBe("the-only-copy");
  });

  test("replacing from .env never leaves the live file missing: the previous copy is a link", async () => {
    r.put("cron_secret", "old");
    await run(r, { CRON_SECRET: "new" }, { now: new Date("2026-11-26T00:00:00Z") });
    expect(r.read("cron_secret")).toBe("new");
    expect(r.read("cron_secret.previous-20261126T000000Z")).toBe("old");
  });

  test("two replacements in the same second keep both previous values", async () => {
    const now = new Date("2026-11-26T00:00:00Z");
    r.put("cron_secret", "first");
    await run(r, { CRON_SECRET: "second" }, { now });
    await run(r, { CRON_SECRET: "third" }, { now });
    expect(r.read("cron_secret")).toBe("third");
    expect(r.read("cron_secret.previous-20261126T000000Z")).toBe("first");
    expect(r.read("cron_secret.previous-20261126T000000Z-2")).toBe("second");
  });

  test("no mount table: a warning that the filesystem checks were skipped", async () => {
    const { runInit } = await init;
    // mountinfo null makes it read /proc/self/mountinfo, which exists here; an
    // empty table stands for one with nothing in it, which is not a warning.
    const res = runInit({ env: {}, configDir: r.configDir, dbDir: r.dbDir, mountinfo: "", asRoot: false });
    expect(res.ok).toBe(true);
    const src = readFileSync(join(DOCKER, "kinboard-init.mjs"), "utf8");
    expect(src).toContain("/proc/self/mountinfo is missing; the filesystem checks were skipped.");
  });

  test("whether PostgREST (uid 1000, group 0) can enter the config folder", async () => {
    const { postgrestCanEnter } = await init;
    expect(postgrestCanEnter({ mode: 0o755, uid: 0, gid: 0 })).toBe(true);
    expect(postgrestCanEnter({ mode: 0o750, uid: 0, gid: 0 })).toBe(true); // group 0
    expect(postgrestCanEnter({ mode: 0o700, uid: 0, gid: 0 })).toBe(false);
    expect(postgrestCanEnter({ mode: 0o750, uid: 99, gid: 100 })).toBe(false); // Unraid's nobody:users, others have nothing
    expect(postgrestCanEnter({ mode: 0o751, uid: 99, gid: 100 })).toBe(true);
    expect(postgrestCanEnter({ mode: 0o700, uid: 1000, gid: 1000 })).toBe(true); // its own folder
    expect(postgrestCanEnter({ mode: 0o077, uid: 1000, gid: 0 })).toBe(false); // owner bits win for the owner
  });

  test("the run warns when it cannot, naming the folder", () => {
    const src = readFileSync(join(DOCKER, "kinboard-init.mjs"), "utf8");
    expect(src).toMatch(/if \(!postgrestCanEnter\(top\)\) \{\n\s+warnings\.push\(`\$\{configDir\} is/);
  });
});

test.describe("the real entrypoint dispatch", () => {
  for (const cmd of ["kinboard-init", "kinboard-db-init"]) {
    test(`${cmd}: handed off with its arguments, before any secret is read`, () => {
      const dir = mkdtempSync(join(tmpdir(), "kb-dispatch-"));
      try {
        writeFileSync(join(dir, cmd), `#!/bin/sh\necho "RAN ${cmd} $*"\n`);
        chmodSync(join(dir, cmd), 0o755);
        const p = spawnSync("sh", [join(DOCKER, "webapp-entrypoint.sh"), cmd, "a", "b"], {
          // No secrets at all: reaching the reader would refuse with exit 1.
          env: { ...process.env, KINBOARD_BIN_DIR: dir, POSTGRES_PASSWORD: "", JWT_SECRET: "", KINBOARD_SECRETS_DIR: join(dir, "none") },
          encoding: "utf8",
        });
        expect(p.status, p.stderr).toBe(0);
        expect(p.stdout.trim()).toBe(`RAN ${cmd} a b`);
        expect(p.stderr).not.toContain("[entrypoint]");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test("any other argument (or none) is not dispatched: the server path runs as before", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-dispatch-"));
    try {
      writeFileSync(join(dir, "kinboard-init"), "#!/bin/sh\necho DISPATCHED\n");
      chmodSync(join(dir, "kinboard-init"), 0o755);
      for (const args of [[], ["kinboard-initX"], ["node"]]) {
        const p = spawnSync("sh", [join(DOCKER, "webapp-entrypoint.sh"), ...args], {
          env: { ...process.env, KINBOARD_BIN_DIR: dir, POSTGRES_PASSWORD: "", JWT_SECRET: "", KINBOARD_SECRETS_DIR: join(dir, "none"), PATH: process.env.PATH ?? "" },
          encoding: "utf8",
        });
        expect(p.stdout).not.toContain("DISPATCHED");
        // It went on to the secrets reader (at /app, so not found here), and stopped there.
        expect(p.status).not.toBe(0);
        expect(p.stderr).toContain("/app/secrets-store.mjs");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
