import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Discussion #539: on OpenMediaVault, a self-hoster added the Diun overlay the
 * way the wiki showed it, unquoted,
 *
 *   COMPOSE_FILES=-f docker-compose.yml -f docker-compose.diun.yml
 *
 * and `./start.sh up` ended with
 *
 *   ./.env: line 197: docker-compose.yml: command not found
 *
 * start.sh ran `set -a; . ./.env`, i.e. executed .env as a shell script, where
 * `KEY=two words` sets KEY for one command and runs the second word. Docker
 * Compose reads the same line as one value, so `docker compose` alone worked
 * and only start.sh failed. Any `$(…)` or backtick in a value ran too.
 *
 * start.sh now reads the keys it uses with env_file_value, which follows
 * Compose's own .env rules and runs nothing. These run that function against
 * fixture files, and start.sh itself with a `docker` that records its calls.
 */

const REPO = resolve(__dirname, "../..");
const START = join(REPO, "webapp/docker/start.sh");
const REPORTED = "COMPOSE_FILES=-f docker-compose.yml -f docker-compose.diun.yml";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "start-env-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const tool of ["docker", "docker-compose"]) {
    const p = join(bin, tool);
    writeFileSync(p, `#!/bin/sh\necho "${tool} $*" >> "${log}"\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  return { dir, bin, log };
}

/** The child's environment: the parent's, the stand-ins first on PATH, no stray KINBOARD_* or COMPOSE_FILES. */
function childEnv(bin: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, ...extra };
  for (const k of ["COMPOSE_FILES", "PROJECT_NAME", "KINBOARD_TAG", "KINBOARD_RIG", "DATA_DIR"]) if (!(k in extra)) delete env[k];
  return env;
}

/** env_file_value KEY over a .env holding `content`: [status, value]. */
function readKey(content: string, key: string, extra: Record<string, string> = {}): [number | null, string] {
  const sb = sandbox();
  try {
    const file = join(sb.dir, ".env");
    writeFileSync(file, content);
    const r = spawnSync(
      "bash",
      ["-c", `eval "$(sed -n '/^env_file_value() {/,/^}$/p' "$1")"; env_file_value "$2" "$3"`, "_", START, key, file],
      { encoding: "utf8", cwd: sb.dir, env: childEnv(sb.bin, extra) },
    );
    expect(r.stderr, "the reader wrote to stderr").toBe("");
    return [r.status, r.stdout];
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

/** `./start.sh <cmd>` in a copy of webapp/docker whose .env is `content`. */
function startSh(content: string, cmd = "status", files: Record<string, string> = {}) {
  const sb = sandbox();
  try {
    const docker = join(sb.dir, "webapp/docker");
    mkdirSync(docker, { recursive: true });
    copyFileSync(START, join(docker, "start.sh"));
    writeFileSync(join(docker, ".env"), content);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(docker, name), body);
    const r = spawnSync("bash", [join(docker, "start.sh"), cmd], { encoding: "utf8", cwd: docker, env: childEnv(sb.bin), timeout: 20_000 });
    // start.sh prefers a standalone docker-compose when there is one; both are stubbed, and the same call.
    const calls = readFileSync(sb.log, "utf8").split("\n").filter(Boolean).map((c) => c.replace(/^docker-compose /, "docker compose "));
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

test.describe("env_file_value reads .env as Compose does", () => {
  const cases: [name: string, content: string, key: string, want: string][] = [
    ["the reported line: unquoted, with spaces (#539)", `${REPORTED}\n`, "COMPOSE_FILES", "-f docker-compose.yml -f docker-compose.diun.yml"],
    ["double quotes, as Quick start and prod's .env have it", `COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"\n`, "COMPOSE_FILES", "-f docker-compose.yml -f docker-compose.diun.yml"],
    ["single quotes keep everything as written", `COMPOSE_FILES='-f a.yml  -f b.yml'\nX='\${HOME} $(id)'\n`, "X", "${HOME} $(id)"],
    ["CRLF line ends (an .env saved on Windows)", `PROJECT_NAME=kinboard\r\nCOMPOSE_FILES="-f docker-compose.yml"\r\nDATA_DIR=/srv/kb\r\n`, "DATA_DIR", "/srv/kb"],
    ["CRLF, quoted", `COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"\r\n`, "COMPOSE_FILES", "-f docker-compose.yml -f docker-compose.diun.yml"],
    ["comment lines, and a comment after a value", `# COMPOSE_FILES=-f nope.yml\n  # indented\nKINBOARD_TAG=next # the RC channel\n`, "KINBOARD_TAG", "next"],
    ["a # with no space before it is part of the value", `PROJECT_NAME=kin#board\n`, "PROJECT_NAME", "kin#board"],
    ["a # inside quotes is part of the value", `DATA_DIR="/srv/a # b" # comment\n`, "DATA_DIR", "/srv/a # b"],
    ["export before the key", `export KINBOARD_TAG=latest\n`, "KINBOARD_TAG", "latest"],
    ["spaces around = and the value", `  PROJECT_NAME =  kinboard  \n`, "PROJECT_NAME", "kinboard"],
    ["the last of two lines wins", `KINBOARD_TAG=latest\nKINBOARD_TAG=next\n`, "KINBOARD_TAG", "next"],
    ["an empty value is set, and empty", `KINBOARD_TAG=\n`, "KINBOARD_TAG", ""],
    ["${VAR} from an earlier line, and a default", `BASE=/srv\nDATA_DIR=\${BASE}/kb\nX=\${KB_SURELY_UNSET:-dflt}\n`, "DATA_DIR", "/srv/kb"],
    ["${VAR:-default} for an unset name", `X=\${KB_SURELY_UNSET:-dflt}\n`, "X", "dflt"],
    ["$$ is one dollar", `X=a$$b\n`, "X", "a$b"],
    ["double quotes span lines and take \\n, \\\" and \\$", `X="one\ntwo"\nY="a\\nb \\"c\\" \\$d"\n`, "Y", 'a\nb "c" $d'],
  ];
  for (const [name, content, key, want] of cases) {
    test(name, () => {
      expect(readKey(content, key)).toEqual([0, want]);
    });
  }

  test("a key the file does not set is status 1, not an empty value", () => {
    expect(readKey(`PROJECT_NAME=kinboard\n# KINBOARD_TAG=next\n`, "KINBOARD_TAG")).toEqual([1, ""]);
  });

  test("$(…) and backticks are text, and run nothing", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "pwned-")), "pwned");
    try {
      const content = [
        `PROJECT_NAME=$(touch ${marker})`,
        `DATA_DIR=\`touch ${marker}\``,
        `KINBOARD_TAG="$(touch ${marker}) \`touch ${marker}\`"`,
        `COMPOSE_FILES=-f docker-compose.yml; touch ${marker}`,
        `touch ${marker}`,
        "",
      ].join("\n");
      expect(readKey(content, "PROJECT_NAME")).toEqual([0, `$(touch ${marker})`]);
      expect(readKey(content, "DATA_DIR")).toEqual([0, `\`touch ${marker}\``]);
      expect(readKey(content, "KINBOARD_TAG")).toEqual([0, `$(touch ${marker}) \`touch ${marker}\``]);
      expect(readKey(content, "COMPOSE_FILES")).toEqual([0, `-f docker-compose.yml; touch ${marker}`]);
      expect(existsSync(marker), "a value in .env was run as a command").toBe(false);
    } finally {
      rmSync(resolve(marker, ".."), { recursive: true, force: true });
    }
  });
});

test.describe("./start.sh with either form of COMPOSE_FILES", () => {
  test("the reported unquoted line reaches docker compose as two -f files (#539)", () => {
    const r = startSh(`PROJECT_NAME=kinboard\n${REPORTED}\n`);
    expect(r.out).not.toContain("command not found");
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual(["docker compose -f docker-compose.yml -f docker-compose.diun.yml ps"]);
  });

  test("quoted, single-quoted and CRLF give the same call", () => {
    for (const line of [
      `COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"\n`,
      `COMPOSE_FILES='-f docker-compose.yml -f docker-compose.diun.yml'\n`,
      `COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"\r\n`,
      `${REPORTED}\r\n`,
    ]) {
      const r = startSh(`PROJECT_NAME=kinboard\r\n${line}`);
      expect(r.code, `${JSON.stringify(line)}: ${r.out}`).toBe(0);
      expect(r.calls, JSON.stringify(line)).toEqual(["docker compose -f docker-compose.yml -f docker-compose.diun.yml ps"]);
    }
  });

  test("no COMPOSE_FILES line: the default file", () => {
    const r = startSh(`PROJECT_NAME=kinboard\n`);
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual(["docker compose -f docker-compose.yml ps"]);
  });

  test("an unquoted PROJECT_NAME with a space names the containers", () => {
    const r = startSh(`PROJECT_NAME=family board\n`, "seed-demo", { "seed-demo.sql": "" });
    expect(r.out).not.toContain("command not found");
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual(["docker exec -i family board-db psql -U postgres -d postgres"]);
  });

  test("a $(…) in .env does not run when start.sh reads it", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "pwned-")), "pwned");
    try {
      const r = startSh(`PROJECT_NAME=kinboard\nKINBOARD_TAG=$(touch ${marker})\nSOMETHING_ELSE=\`touch ${marker}\`\n`);
      expect(r.code, r.out).toBe(0);
      expect(existsSync(marker), "start.sh ran a value from .env").toBe(false);
    } finally {
      rmSync(resolve(marker, ".."), { recursive: true, force: true });
    }
  });

  test("start.sh never sources .env", () => {
    const code = readFileSync(START, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/(^|[;&|\s])(\.|source)\s+["']?(\.\/)?\.env\b/m);
  });
});
