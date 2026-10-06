import { test, expect } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { browserApiUrl } from "../src/lib/supabase/api-base";

/**
 * RFC-018: Kong is the front door. A catch-all route in kong.yml sends every
 * page to the webapp, and KINBOARD_ENTRY=kong moves port 3001 from the webapp
 * to Kong.
 *
 * Two things here can take a household's Kinboard down, and both are tested
 * against the real scripts:
 *
 * - The merge. An installed kong.yml is the install's own file, holding its
 *   real keys. The route has to go in as whole new lines with every other
 *   byte left exactly as it was, and a second run must change nothing.
 * - The switch. If Kong took 3001 without serving the app, every bookmark
 *   would land on a Kong 404. An existing install moves only after a request
 *   through Kong reaches the app; any failure leaves it on the webapp with
 *   .env byte-for-byte as it was.
 *
 * KINBOARD_ENTRY_SH points the spec at another copy of the script, which is
 * how its guards were proven to fail when broken.
 */

const ENTRY_SH = resolve(process.env.KINBOARD_ENTRY_SH ?? "docker/kinboard-entry.sh");
const TEMPLATE = readFileSync("docker/kong.yml", "utf8");

// What an installed kong.yml looks like after setup.sh: real-looking JWTs in
// place of the placeholders, the origin pinned, a hand-added LAN origin under
// it (the wiki tells people to do that), and a comment of the owner's own.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.c2VjcmV0LWFub24ta2V5LXNpZw";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2VydmljZS1yb2xlLXNlY3JldA$+/=";
function installedKongYml(): string {
  return TEMPLATE.replaceAll("REPLACE_WITH_ANON_KEY", ANON)
    .replaceAll("REPLACE_WITH_SERVICE_ROLE_KEY", SERVICE)
    .replaceAll("- REPLACE_WITH_WEBAPP_ORIGIN  # webapp_origin", "- https://kinboard.example.com  # webapp_origin\n            - http://192.168.1.20:3001")
    .replace("_transform: true\n", "_transform: true\n# my own note, keep me   \n");
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function merge(file: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("sh", [ENTRY_SH, "merge", file], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

type KongDoc = { services: { name: string; url: string; routes: { paths: string[] }[] }[]; [k: string]: unknown };

/** The installed kong.yml re-emitted in another list style. */
function restyled(style: "0-space" | "4-space"): string {
  // PyYAML's default dump puts a mapping's list items at the mapping's own
  // indent; a 4-space style is the installed file with every indent doubled.
  if (style === "0-space") return yaml.dump(yaml.load(installedKongYml()), { indent: 2, noArrayIndent: true, lineWidth: 200 });
  return [
    '_format_version: "2.1"',
    "keyauth_credentials:",
    "    - consumer: anon",
    `      key: ${ANON}`,
    "services:",
    "    ## PostgREST",
    "    - name: rest-v1",
    "      url: http://rest:3000/",
    "      routes:",
    "          - name: rest-v1-route",
    "            strip_path: true",
    "            paths:",
    "                - /rest/v1/",
    "    - name: auth-v1",
    "      url: http://auth:9999/",
    "      routes:",
    "          - name: auth-v1-route",
    "            paths:",
    "                - /auth/v1/",
    "",
  ].join("\n");
}

/** The route block exactly as the script inserts it. */
function routeBlock(): string {
  const dir = tmp("entry-block-");
  try {
    const f = join(dir, "k.yml");
    writeFileSync(f, "services:\n");
    expect(merge(f).status).toBe(0);
    return readFileSync(f, "utf8").slice("services:\n".length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe("merging the front-door route into an installed kong.yml", () => {
  test("every existing byte stays; the only difference is the route below `services:`", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      const before = installedKongYml();
      writeFileSync(file, before);
      const r = merge(file);
      expect(r.status, r.out).toBe(0);
      const after = readFileSync(file, "utf8");

      const at = before.indexOf("\nservices:\n") + "\nservices:\n".length;
      expect(after).toBe(before.slice(0, at) + routeBlock() + before.slice(at));
      // The secrets are still there, once each, untouched.
      expect(after.split(ANON).length - 1).toBe(1);
      expect(after.split(SERVICE).length - 1).toBe(1);
      expect(after).toContain("# my own note, keep me   \n");
      expect(after).toContain("            - http://192.168.1.20:3001\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a second run changes nothing", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      writeFileSync(file, installedKongYml());
      expect(merge(file).status).toBe(0);
      const once = readFileSync(file);
      const r = merge(file);
      expect(r.status).toBe(0);
      expect(r.out).toContain("already has the front-door route");
      expect(readFileSync(file).equals(once)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CRLF line ends and a missing final newline survive byte for byte", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      const before = installedKongYml().replaceAll("\n", "\r\n").replace(/\r\n$/, "");
      writeFileSync(file, before);
      expect(merge(file).status).toBe(0);
      const after = readFileSync(file, "utf8");
      const head = before.indexOf("\r\nservices:\r\n") + "\r\nservices:\r\n".length;
      expect(after).toBe(before.slice(0, head) + routeBlock() + before.slice(head));
      expect(after.endsWith("apikey")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the result is valid YAML, and the route is the lowest-priority catch-all to the webapp", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      writeFileSync(file, installedKongYml());
      expect(merge(file).status).toBe(0);
      type Route = { name: string; paths: string[]; strip_path?: boolean; preserve_host?: boolean; response_buffering?: boolean };
      type Service = { name: string; url: string; routes: Route[]; plugins?: unknown[] };
      const doc = yaml.load(readFileSync(file, "utf8")) as { services: Service[]; keyauth_credentials: { key: string }[] };
      const entry = doc.services.find((s) => s.name === "webapp-entry");
      expect(entry?.url).toBe("http://webapp:3000");
      expect(entry?.plugins).toBeUndefined(); // no key-auth on the app's own pages
      expect(entry?.routes).toEqual([
        { name: "webapp-entry-route", strip_path: false, preserve_host: true, response_buffering: false, paths: ["/"] },
      ]);
      // Every API route is a longer prefix than "/", so Kong prefers it.
      const apiPaths = doc.services.filter((s) => s !== entry).flatMap((s) => s.routes.flatMap((r) => r.paths));
      expect(apiPaths.sort()).toEqual(
        ["/auth/v1/", "/realtime/v1/", "/rest/v1/", "/rest/v1/rpc/", "/storage/v1/", "/storage/v1/object/public/"].sort(),
      );
      expect(doc.keyauth_credentials.map((c) => c.key)).toEqual([SERVICE, ANON]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file it cannot place the route in is left exactly as it was, and says so", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      const odd = installedKongYml().replace("\nservices:\n", "\nservices: # moved\n");
      writeFileSync(file, odd);
      const r = merge(file);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("no top-level 'services:' line");
      expect(readFileSync(file, "utf8")).toBe(odd);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const style of ["0-space", "4-space"] as const) {
    test(`a kong.yml written in ${style} list style gets the route at its own indent and still parses`, () => {
      const dir = tmp("entry-merge-");
      try {
        const file = join(dir, "kong.yml");
        const before = restyled(style);
        const indent = style === "0-space" ? "" : "    ";
        expect(before).toContain(`\n${indent}- name: rest-v1\n`);
        writeFileSync(file, before);
        const r = merge(file);
        expect(r.status, r.out).toBe(0);
        const after = readFileSync(file, "utf8");
        expect(after).toContain(`\nservices:\n${indent}## Front door`);
        expect(after).toContain(`\n${indent}- name: webapp-entry  # kinboard_entry\n`);
        const a = yaml.load(before) as KongDoc;
        const b = yaml.load(after) as KongDoc;
        expect(b.services.length).toBe(a.services.length + 1);
        expect(b.services.find((x) => x.name === "webapp-entry")?.routes[0].paths).toEqual(["/"]);
        expect(b.services.filter((x) => x.name !== "webapp-entry")).toEqual(a.services);
        for (const k of Object.keys(a)) if (k !== "services") expect(b[k]).toEqual(a[k]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test("tab indentation is refused and the file left alone", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      const tabbed = "_format_version: \"2.1\"\nservices:\n\t- name: rest-v1\n\t  url: http://rest:3000/\n";
      writeFileSync(file, tabbed);
      const r = merge(file);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("tabs");
      expect(readFileSync(file, "utf8")).toBe(tabbed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * With the Kong image on the machine, Kong itself has the last word: a
   * stub `docker` stands in for `kong config parse` and says no.
   */
  test("when `kong config parse` rejects the result, kong.yml is left as it was and no key-holding temp file remains", () => {
    const dir = tmp("entry-merge-");
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "docker"), '#!/bin/sh\ncase "$*" in "image inspect"*) exit 0 ;; run*) cat >/dev/null; echo "parse failed" >&2; exit 1 ;; esac\nexit 0\n');
      chmodSync(join(bin, "docker"), 0o755);
      const file = join(dir, "kong.yml");
      const before = installedKongYml();
      writeFileSync(file, before);
      const r = merge(file, { PATH: `${bin}:${process.env.PATH}`, ENTRY_KONG_IMAGE: "kong:3.9.3" });
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("did not validate");
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(execFileSync("ls", ["-A", dir], { encoding: "utf8" }).split("\n").filter(Boolean).sort()).toEqual(["bin", "kong.yml"]);

      // ...and when it accepts, that is what the merge reports.
      writeFileSync(join(bin, "docker"), '#!/bin/sh\ncase "$*" in run*) cat >/dev/null ;; esac\nexit 0\n');
      const ok = merge(file, { PATH: `${bin}:${process.env.PATH}`, ENTRY_KONG_IMAGE: "kong:3.9.3" });
      expect(ok.status, ok.out).toBe(0);
      expect(ok.out).toContain("checked by kong config parse (kong:3.9.3)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the merge keeps the file's mode", () => {
    const dir = tmp("entry-merge-");
    try {
      const file = join(dir, "kong.yml");
      writeFileSync(file, installedKongYml());
      chmodSync(file, 0o640);
      expect(merge(file).status).toBe(0);
      expect(statSync(file).mode & 0o777).toBe(0o640);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the tracked template is not where the route lives", () => {
    // Every install's kong.yml differs from the template (setup.sh writes its
    // keys in), so any change to the template makes `git pull --ff-only` refuse
    // — and the self-update would stop upgrading every one of them.
    expect(TEMPLATE).not.toContain("kinboard_entry");
    expect(readFileSync("../setup.sh", "utf8")).toContain('sh "$ENTRY_SH" merge "$KONG_YML"');
  });
});

/**
 * The entry commands against a stub `docker` that plays the stack: whether
 * Kong answers `/` with the app, which host ports Kong ends up with, whether
 * this is a Traefik stack. Every docker call is recorded. `killOn` makes the
 * stub kill the script (SIGTERM) the first time a matching call is made.
 */
interface Stack {
  probe: "app" | "kong404" | "other200" | "fail";
  /** Host ports Kong publishes after the switch. */
  kongPorts?: string;
  traefik?: boolean;
  /** When set, the probe only passes after `restart kong`. */
  needsRestart?: boolean;
  killOn?: string;
  /** A .env.pre-entry left behind by an earlier run. */
  preEntry?: string;
  /** A .env.entry-state (the back-off after an undone move). */
  state?: string;
  /** No webapp container running (`compose ps -q webapp` prints nothing). */
  webappDown?: boolean;
  /** Each failing probe takes a second, like a real `compose exec` would. */
  slowProbe?: boolean;
  /** A plain `compose up -d` fails (a pull or port error mid-upgrade). */
  upFails?: boolean;
  extraEnv?: Record<string, string>;
}

function runEntry(cmd: string, env: string, kongYml: string, stack: Stack) {
  const dir = tmp("entry-switch-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  writeFileSync(join(dir, ".env"), env);
  writeFileSync(join(dir, "kong.yml"), kongYml);
  if (stack.preEntry !== undefined) writeFileSync(join(dir, ".env.pre-entry"), stack.preEntry);
  if (stack.state !== undefined) writeFileSync(join(dir, ".env.entry-state"), stack.state);
  writeStub(bin);
  try {
    const r = spawnSync("sh", [ENTRY_SH, cmd], {
      cwd: dir,
      encoding: "utf8",
      env: stubEnv(dir, bin, calls, stack),
    });
    const files = execFileSync("ls", ["-A", dir], { encoding: "utf8" }).split("\n").filter(Boolean);
    return {
      status: r.status,
      out: `${r.stdout}${r.stderr}`,
      env: readFileSync(join(dir, ".env"), "utf8"),
      calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      leftovers: files.filter((f) => !["killed", "restarted"].includes(f)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function stubEnv(dir: string, bin: string, calls: string, stack: Stack): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CALLS: calls,
    DIR: dir,
    PROBE: stack.probe,
    KONG_PORTS: stack.kongPorts ?? "8100 3001 ",
    TRAEFIK: stack.traefik ? "1" : "",
    NEEDS_RESTART: stack.needsRestart ? "1" : "",
    KILL_ON: stack.killOn ?? "",
    WEBAPP_DOWN: stack.webappDown ? "1" : "",
    SLOW_PROBE: stack.slowProbe ? "1" : "",
    UP_FAILS: stack.upFails ? "1" : "",
    ENTRY_PROBE_ATTEMPTS: "2",
    ENTRY_CONFIRM_ATTEMPTS: "2",
    ENTRY_PROBE_INTERVAL: "0",
    ...(stack.extraEnv ?? {}),
  };
}

function writeStub(bin: string) {
  const docker = `#!/bin/sh
echo "docker $*" >> "$CALLS"
if [ -n "$KILL_ON" ] && [ ! -f "$DIR/killed" ]; then
  case "$*" in *"$KILL_ON"*) touch "$DIR/killed"; kill -TERM $PPID; sleep 1; exit 1 ;; esac
fi
case "$*" in
  *"exec -T webapp curl"*)
    if [ "$PROBE" = fail ]; then [ -n "$SLOW_PROBE" ] && sleep 1; exit 7; fi
    if [ -n "$NEEDS_RESTART" ] && [ ! -f "$DIR/restarted" ]; then
      printf 'HTTP/1.1 404 Not Found\\r\\nServer: kong/3.9.3\\r\\n\\r\\n'; exit 0
    fi
    if [ "$PROBE" = app ]; then
      printf 'HTTP/1.1 200 OK\\r\\nx-correlation-id: abc123\\r\\ncontent-type: text/html\\r\\n\\r\\n'
    elif [ "$PROBE" = other200 ]; then
      printf 'HTTP/1.1 200 OK\\r\\ncontent-type: text/html\\r\\n\\r\\n'
    else
      printf 'HTTP/1.1 404 Not Found\\r\\nServer: kong/3.9.3\\r\\n\\r\\n'
    fi ;;
  *"restart kong"*) touch "$DIR/restarted" ;;
  *"up -d --no-deps"*) ;;
  *" up -d"*) [ -n "$UP_FAILS" ] && exit 1 ;;
  *"ps -q kong"*) echo kongcid ;;
  *"ps -q webapp"*) [ -z "$WEBAPP_DOWN" ] && echo webcid ;;
  *"inspect -f {{.State.StartedAt}}"*) echo "2020-01-01T00:00:00.000000000Z" ;;
  *"inspect -f"*) echo "$KONG_PORTS" ;;
  *" config"*) if [ -n "$TRAEFIK" ]; then echo '      traefik.enable: "true"'; else echo 'services:'; fi ;;
esac
exit 0
`;
  writeFileSync(join(bin, "docker"), docker);
  chmodSync(join(bin, "docker"), 0o755);
}
const runSwitch = (env: string, kongYml: string, stack: Stack) => runEntry("switch", env, kongYml, stack);

// What a 1.12 install looks like: the old prompt wrote both addresses on the
// same host, Kong's port and the webapp's.
const EXISTING_ENV =
  "POSTGRES_PASSWORD=s3cr3t\nAPI_EXTERNAL_URL=http://192.168.1.50:8100\nSITE_URL=http://192.168.1.50:3001\nWEBAPP_PORT=3001\n";
const WITH_ROUTE = (() => {
  const dir = tmp("entry-route-");
  try {
    const f = join(dir, "kong.yml");
    writeFileSync(f, installedKongYml());
    merge(f);
    return readFileSync(f, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const ups = (calls: string[]) => calls.filter((c) => / up -d /.test(c)).map((c) => c.replace(/.* up -d --no-deps --no-build /, ""));

test.describe("moving an existing install to Kong only after the check", () => {
  test("Kong serves the app: KINBOARD_ENTRY=kong is written, the webapp lets go of the port before Kong takes it", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app" });
    expect(r.env).toBe(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
    expect(ups(r.calls)).toEqual(["webapp", "kong"]);
    expect(r.out).toContain("switched");
    expect(r.leftovers.sort()).toEqual([".env", "bin", "calls", "kong.yml"]);
  });

  test("Kong answers / with its own 404: the install stays on webapp, .env untouched, nothing recreated", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "kong404" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
    expect(r.out).toContain("staying on webapp: a request through Kong to / did not reach the app");
  });

  test("a 200 from something that is not Kinboard (no x-correlation-id) does not count", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "other200" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
  });

  test("the probe cannot run at all (webapp down): stays on webapp", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "fail" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
  });

  test("kong.yml without the route: not even probed", () => {
    const r = runSwitch(EXISTING_ENV, installedKongYml(), { probe: "app" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(r.calls.some((c) => c.includes("curl"))).toBe(false);
    expect(r.out).toContain("kong.yml has no front-door route");
  });

  test("a Kong started before the route was merged is restarted once, then the check passes", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", needsRestart: true });
    expect(r.calls.some((c) => c.endsWith("restart kong"))).toBe(true);
    expect(r.env).toBe(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
  });

  test("Kong does not get the port: .env is restored byte for byte and the old layout put back", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", kongPorts: "8100 " });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual(["webapp", "kong", "kong", "webapp"]);
    expect(r.out).toContain("staying on webapp: Kong did not get port 3001; KINBOARD_ENTRY restored");
    expect(r.leftovers).not.toContain(".env.pre-entry");
  });

  test("an explicit KINBOARD_ENTRY (the opt-out) is never touched, in any form a shell accepts", () => {
    for (const line of ["KINBOARD_ENTRY=webapp", "export KINBOARD_ENTRY=webapp", "  KINBOARD_ENTRY=webapp", 'KINBOARD_ENTRY="webapp"', "KINBOARD_ENTRY=kong"]) {
      const env = `${EXISTING_ENV}${line}\n`;
      const r = runSwitch(env, WITH_ROUTE, { probe: "app" });
      expect(r.calls.filter((c) => !c.includes(" config")), line).toEqual([]);
      expect(r.env.match(/KINBOARD_ENTRY=/g)?.length, line).toBe(1);
      expect(r.env, line).toMatch(/^KINBOARD_ENTRY=(webapp|kong)$/m);
    }
  });

  test("a stack behind Traefik is left to opt in itself", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", traefik: true });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
    expect(r.out).toContain("behind Traefik");
  });

  test("a separate API host stays on webapp: a proxy may send the app's host to webapp:3000", () => {
    const env = "API_EXTERNAL_URL=https://api.kinboard.example.com\nSITE_URL=https://kinboard.example.com\nWEBAPP_PORT=3001\n";
    const r = runSwitch(env, WITH_ROUTE, { probe: "app" });
    expect(r.env).toBe(env);
    expect(ups(r.calls)).toEqual([]);
    expect(r.out).toContain("staying on webapp: separate API host");
    // ...and no SITE_URL at all is not taken as "same host".
    expect(runSwitch("API_EXTERNAL_URL=http://nas:8100\n", WITH_ROUTE, { probe: "app" }).out).toContain("separate API host");
  });

  test("the same host on another port, an empty API_EXTERNAL_URL or `same-origin` all move", () => {
    for (const api of ["http://192.168.1.50:8100", "", "same-origin", "HTTP://192.168.1.50:8100/"]) {
      const env = `API_EXTERNAL_URL=${api}\nSITE_URL=http://192.168.1.50:3001\n`;
      expect(runSwitch(env, WITH_ROUTE, { probe: "app" }).env, api).toContain("KINBOARD_ENTRY=kong");
    }
  });

  test("a .env without a final newline gets the setting on a line of its own", () => {
    const env = EXISTING_ENV.trimEnd();
    const r = runSwitch(env, WITH_ROUTE, { probe: "app" });
    expect(r.env).toBe(`${env}\nKINBOARD_ENTRY=kong\n`);
  });
});

test.describe("a move that is interrupted", () => {
  test("killed while Kong is being recreated: .env comes back and the webapp gets the port back", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", killOn: "up -d --no-deps --no-build kong" });
    expect(r.status).not.toBe(0);
    expect(r.env).toBe(EXISTING_ENV);
    // webapp (moved off), kong (killed), then the recovery: kong lets go, webapp takes it.
    expect(ups(r.calls)).toEqual(["webapp", "kong", "kong", "webapp"]);
    expect(r.leftovers).not.toContain(".env.pre-entry");
    expect(r.leftovers.some((f) => f.includes("entry-tmp"))).toBe(false);
  });

  test("killed hard (no trap runs): the next run finds .env.pre-entry and puts KINBOARD_ENTRY back", () => {
    const r = runSwitch(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "app", preEntry: "" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual(["kong", "webapp"]);
    expect(r.out).toContain("did not finish");
    expect(r.leftovers).not.toContain(".env.pre-entry");
    expect(r.leftovers).toContain(".env.entry-state");
  });

  test("the recovery restores only KINBOARD_ENTRY; what setup.sh or a person wrote since stays", () => {
    // The move appended KINBOARD_ENTRY=kong; then setup.sh filled a new key
    // and someone changed SITE_URL, then the run was killed.
    const now = EXISTING_ENV.replace("SITE_URL=http://192.168.1.50:3001", "SITE_URL=https://kinboard.example.com")
      + "KINBOARD_ENTRY=kong\nNEW_SECRET=filled-by-setup\n";
    const want = EXISTING_ENV.replace("SITE_URL=http://192.168.1.50:3001", "SITE_URL=https://kinboard.example.com")
      + "NEW_SECRET=filled-by-setup\n";
    for (const cmd of ["switch", "prepare", "recover"]) {
      // The legacy full-copy form of .env.pre-entry must not be pasted back either.
      for (const pre of ["", EXISTING_ENV]) {
        expect(runEntry(cmd, now, WITH_ROUTE, { probe: "app", preEntry: pre }).env, `${cmd} ${pre.length}`).toBe(want);
      }
    }
  });

  test("an explicit value that existed before the move is what comes back", () => {
    const r = runEntry("recover", `${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "app", preEntry: "export KINBOARD_ENTRY=webapp\n" });
    expect(r.env).toBe(`${EXISTING_ENV}export KINBOARD_ENTRY=webapp\n`);
  });

  test("before an `up`, prepare puts only KINBOARD_ENTRY back, leaves the containers to that up, and backs off", () => {
    const r = runEntry("prepare", `${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "app", preEntry: "" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
    expect(r.leftovers).toContain(".env.entry-state");
  });
});

test.describe("backing off after an undone move", () => {
  const recent = () => `undone_at=${Math.floor(Date.now() / 1000) - 60}\n`;
  const old = () => `undone_at=${Math.floor(Date.now() / 1000) - 2 * 86400}\n`;

  test("within a day of an undone move nothing tries again, and says when it will", () => {
    for (const cmd of ["switch", "prepare"]) {
      const r = runEntry(cmd, EXISTING_ENV, WITH_ROUTE, { probe: "app", state: recent() });
      expect(r.env, cmd).toBe(EXISTING_ENV);
      expect(r.calls.filter((c) => c.includes("curl") || / up -d /.test(c)), cmd).toEqual([]);
      expect(r.out, cmd).toMatch(/undone recently; trying again in \d+ min \(delete .*\.env\.entry-state to try now\)/);
    }
  });

  test("after the window it tries again, and a confirmed move clears the state", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", state: old() });
    expect(r.env).toBe(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
    expect(r.leftovers).not.toContain(".env.entry-state");
  });

  test("a switch right after a confirmed move says the setting is there, not that something was undone", () => {
    const r = runSwitch(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "app" });
    expect(r.out).toContain("KINBOARD_ENTRY=kong is set in .env; leaving it");
    expect(r.out).not.toContain("undone");
  });
});

/**
 * N2 of the re-review: ./start.sh calls `entry confirm || true` and then
 * `entry switch`. A Ctrl-C during confirm used to restore the old layout,
 * exit 130 "normally", and let bash carry on into switch, which moved the
 * port straight back: four `up -d` calls. The interrupt is now re-raised, so
 * the calling shell stops, and the back-off would stop switch anyway.
 */
test.describe("Ctrl-C while a move is being confirmed", () => {
  test("puts the old layout back once, and nothing moves it again in the same run", async () => {
    const dir = tmp("entry-sigint-");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const calls = join(dir, "calls");
    writeFileSync(calls, "");
    writeFileSync(join(dir, ".env"), `${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
    writeFileSync(join(dir, ".env.pre-entry"), "");
    writeFileSync(join(dir, "kong.yml"), WITH_ROUTE);
    writeStub(bin);
    writeFileSync(
      join(dir, "caller.sh"),
      `set -euo pipefail\nentry() { sh ${JSON.stringify(ENTRY_SH)} "$@" || true; }\nentry confirm\necho CALLER-CONTINUED\nentry switch\n`,
    );
    try {
      const env = stubEnv(dir, bin, calls, { probe: "fail", slowProbe: true, extraEnv: { ENTRY_CONFIRM_ATTEMPTS: "30" } });
      const child = spawn("bash", [join(dir, "caller.sh")], { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      // Wait until confirm is probing, then Ctrl-C the whole process group, as a terminal does.
      for (let i = 0; i < 100 && !readFileSync(calls, "utf8").includes("curl"); i++) await new Promise((r) => setTimeout(r, 100));
      process.kill(-child.pid!, "SIGINT");
      await new Promise((r) => child.on("exit", r));
      const ran = readFileSync(calls, "utf8").split("\n").filter(Boolean);
      expect(ups(ran)).toEqual(["kong", "webapp"]);
      expect(out).not.toContain("CALLER-CONTINUED");
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(EXISTING_ENV);
      const left = execFileSync("ls", ["-A", dir], { encoding: "utf8" });
      expect(left).not.toContain(".env.pre-entry");
      expect(left).toContain(".env.entry-state");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * N5 of the re-review: prepare has written KINBOARD_ENTRY=kong, then the `up`
 * itself fails. start.sh (under set -e) must not leave that unconfirmed.
 */
test.describe("a failed `up` after the move was decided", () => {
  test("./start.sh up puts KINBOARD_ENTRY and the old layout back and exits non-zero", () => {
    const dir = tmp("entry-upfail-");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const calls = join(dir, "calls");
    writeFileSync(calls, "");
    for (const f of ["start.sh"]) copyFileSync(join("docker", f), join(dir, f));
    copyFileSync(ENTRY_SH, join(dir, "kinboard-entry.sh"));
    const env = `${EXISTING_ENV}COMPOSE_FILES="-f docker-compose.yml"\nDATA_DIR=${dir}/data\n`;
    writeFileSync(join(dir, ".env"), env);
    writeFileSync(join(dir, "kong.yml"), WITH_ROUTE);
    writeStub(bin);
    try {
      const r = spawnSync("bash", [join(dir, "start.sh"), "up"], {
        cwd: dir,
        encoding: "utf8",
        env: stubEnv(dir, bin, calls, { probe: "app", upFails: true }),
      });
      expect(r.status).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain("docker compose up failed");
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(env);
      const ran = readFileSync(calls, "utf8").split("\n").filter(Boolean);
      expect(ups(ran)).toEqual(["kong", "webapp"]);
      const left = execFileSync("ls", ["-A", dir], { encoding: "utf8" });
      expect(left).not.toContain(".env.pre-entry");
      expect(left).toContain(".env.entry-state");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the self-update does the same", () => {
    const src = readFileSync("docker/kinboard-self-update.sh", "utf8");
    expect(src).toMatch(/if ! docker compose \$COMPOSE_FILES up -d --no-build \$SERVICES[^\n]*; then\n(?:\s*#[^\n]*\n)*\s*entry recover --restart --mark\n/);
  });
});

test.describe("deciding before the upgrade's `up` (one webapp restart, not two)", () => {
  test("prepare writes the setting and keeps the old .env; it touches no container", () => {
    const r = runEntry("prepare", EXISTING_ENV, WITH_ROUTE, { probe: "app" });
    expect(r.env).toBe(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
    expect(r.leftovers).toContain(".env.pre-entry");
    expect(ups(r.calls)).toEqual([]);
  });

  test("prepare does not probe a stack that is not running (no three-minute wait before the first up)", () => {
    const t0 = Date.now();
    const r = runEntry("prepare", EXISTING_ENV, WITH_ROUTE, {
      probe: "fail",
      webappDown: true,
      slowProbe: true,
      extraEnv: { ENTRY_PROBE_ATTEMPTS: "36", ENTRY_PROBE_INTERVAL: "5" },
    });
    expect(r.calls.some((c) => c.includes("curl"))).toBe(false);
    expect(r.out).toContain("the stack is not running");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  test("prepare probes a running stack only briefly; the full wait is for after the up", () => {
    const r = runEntry("prepare", EXISTING_ENV, WITH_ROUTE, {
      probe: "fail",
      extraEnv: { ENTRY_PROBE_ATTEMPTS: "36", ENTRY_PREPARE_ATTEMPTS: "3" },
    });
    // One probe, then (Kong predates the route) a restart and three more.
    expect(r.calls.filter((c) => c.includes("curl")).length).toBe(4);
    expect(r.env).toBe(EXISTING_ENV);
  });

  test("prepare without a passing check changes nothing", () => {
    const r = runEntry("prepare", EXISTING_ENV, WITH_ROUTE, { probe: "kong404" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(r.leftovers).not.toContain(".env.pre-entry");
  });

  test("confirm after the up: done when Kong has the port and the app answers", () => {
    const r = runEntry("confirm", `${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "app", preEntry: "" });
    expect(r.env).toBe(`${EXISTING_ENV}KINBOARD_ENTRY=kong\n`);
    expect(r.leftovers).not.toContain(".env.pre-entry");
    expect(ups(r.calls)).toEqual([]);
  });

  test("confirm after the up: otherwise .env and the old layout come back", () => {
    const r = runEntry("confirm", `${EXISTING_ENV}KINBOARD_ENTRY=kong\n`, WITH_ROUTE, { probe: "kong404", preEntry: "" });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual(["kong", "webapp"]);
    expect(r.out).toContain("staying on webapp: the webapp did not answer through Kong after the move");
    expect(r.leftovers).toContain(".env.entry-state");
  });
});

test.describe("a KINBOARD_ENTRY that compose would choke on", () => {
  for (const [line, want] of [
    ["KINBOARD_ENTRY=Kong", "kong"],
    ["KINBOARD_ENTRY= WEBAPP ", "webapp"],
    ["KINBOARD_ENTRY=traefik", "webapp"],
    ["export KINBOARD_ENTRY=kong", "kong"],
    ["KINBOARD_ENTRY=kong\nKINBOARD_ENTRY=Kong", "kong"],
  ] as const) {
    test(`${JSON.stringify(line)} becomes KINBOARD_ENTRY=${want}`, () => {
      const r = runEntry("normalise", `A=1\n${line}\nB=2\n`, WITH_ROUTE, { probe: "app" });
      expect(r.env).toBe(`A=1\nKINBOARD_ENTRY=${want}\nB=2\n`);
    });
  }

  test("a valid line is left byte for byte", () => {
    const env = "A=1\nKINBOARD_ENTRY=kong\nB=2\n";
    expect(runEntry("normalise", env, WITH_ROUTE, { probe: "app" }).env).toBe(env);
  });
});

test.describe("the scripts that run the switch", () => {
  const selfUpdate = readFileSync("docker/kinboard-self-update.sh", "utf8");
  const start = readFileSync("docker/start.sh", "utf8");

  test("the self-update decides before its one `up`, confirms after it, and keeps switch as the fallback", () => {
    const at = (needle: string, from = 0) => selfUpdate.indexOf(needle, from);
    const normalise = at("entry normalise");
    const pull = at("pull --ignore-buildable >>");
    const backup = at("take_backup; then");
    const prepare = at("entry prepare");
    const up = at("up -d --no-build $SERVICES >>");
    const confirm = at("entry confirm");
    const sw = at("entry switch");
    expect(normalise).toBeGreaterThan(0);
    // Every compose command after the setting is normalised; the decision
    // after the backup (an aborted upgrade must not leave .env changed) and
    // before the only up.
    expect(pull).toBeGreaterThan(normalise);
    expect(prepare).toBeGreaterThan(backup);
    expect(up).toBeGreaterThan(prepare);
    expect(confirm).toBeGreaterThan(up);
    expect(sw).toBeGreaterThan(confirm);
    // ...and the scheduler follows a webapp the fallback recreated.
    expect(at('recreate_scheduler_if_webapp_changed "$WEBAPP_BEFORE"', sw)).toBeGreaterThan(sw);
  });

  test("start.sh normalises before any compose command, decides before the up, confirms after the migrations", () => {
    const at = (needle: string) => start.indexOf(needle);
    expect(at("sh ./kinboard-entry.sh normalise")).toBeGreaterThan(0);
    expect(at("sh ./kinboard-entry.sh normalise")).toBeLessThan(at("$COMPOSE $COMPOSE_FILES"));
    // A shell copy of KINBOARD_ENTRY would beat the rewritten .env in compose.
    expect(at("unset KINBOARD_ENTRY")).toBeGreaterThan(at("source ./.env"));
    const prepare = at("    entry prepare\n");
    const up = at("    $COMPOSE $COMPOSE_FILES up -d\n    up_status=$?\n");
    const wait = at("    wait_for_migrations\n");
    const confirm = at("    entry confirm\n");
    const sw = at("    entry switch\n");
    expect(prepare).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(prepare);
    expect(wait).toBeGreaterThan(up);
    expect(confirm).toBeGreaterThan(wait);
    expect(sw).toBeGreaterThan(confirm);
    expect(start).toContain('sh ./kinboard-entry.sh "$@" || true');
  });

  test("no `grep -qv` — on the Unraid host grep is ugrep, which gets its exit status wrong", () => {
    for (const f of ["docker/kinboard-entry.sh", "docker/kinboard-self-update.sh", "docker/start.sh", "docker/test-entry-switch.sh", "../setup.sh"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/grep\s+-[a-zA-Z]*q[a-zA-Z]*v|grep\s+-[a-zA-Z]*v[a-zA-Z]*q/);
    }
  });
});

/**
 * setup.sh end to end, in a scratch copy of the files it touches. A stub npx
 * stands in for the VAPID key generator so nothing is downloaded.
 */
function scratchRepo(): string {
  const root = tmp("entry-setup-");
  mkdirSync(join(root, "webapp", "docker", "diun"), { recursive: true });
  copyFileSync("../setup.sh", join(root, "setup.sh"));
  chmodSync(join(root, "setup.sh"), 0o755);
  copyFileSync("docker/.env.example", join(root, "webapp", "docker", ".env.example"));
  copyFileSync(".env.example", join(root, "webapp", ".env.example"));
  copyFileSync("docker/kong.yml", join(root, "webapp", "docker", "kong.yml"));
  copyFileSync(ENTRY_SH, join(root, "webapp", "docker", "kinboard-entry.sh"));
  copyFileSync("docker/diun/diun.yml", join(root, "webapp", "docker", "diun", "diun.yml"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "npx"), '#!/bin/sh\necho \'{"publicKey":"pub","privateKey":"priv"}\'\n');
  chmodSync(join(root, "bin", "npx"), 0o755);
  return root;
}

function setup(root: string, args: string[] = []): string {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` };
  delete env.KINBOARD_URL;
  delete env.KINBOARD_API_URL;
  return execFileSync("bash", [join(root, "setup.sh"), "--non-interactive", ...args], {
    cwd: root,
    encoding: "utf8",
    input: "",
    env,
  });
}

const envOf = (root: string) => readFileSync(join(root, "webapp", "docker", ".env"), "utf8");
const valueOf = (env: string, key: string) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

test.describe("setup.sh", () => {
  test("a new install is same-origin with Kong in front, and asks for no address", () => {
    const root = scratchRepo();
    try {
      const out = setup(root);
      const env = envOf(root);
      expect(valueOf(env, "KINBOARD_ENTRY")).toBe("kong");
      expect(valueOf(env, "API_EXTERNAL_URL")).toBe("");
      expect(valueOf(env, "SITE_URL")).toBe("http://localhost:3001");
      expect(readFileSync(join(root, "webapp", "docker", "kong.yml"), "utf8")).toContain("# kinboard_entry");
      expect(out).not.toContain("error:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--url names the address the family opens; the old :8100 habit still lands on 3001", () => {
    const root = scratchRepo();
    try {
      setup(root, ["--url", "http://192.168.1.50:8100"]);
      const env = envOf(root);
      expect(valueOf(env, "SITE_URL")).toBe("http://192.168.1.50:3001");
      expect(valueOf(env, "API_EXTERNAL_URL")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--api-url still gives a separate API host", () => {
    const root = scratchRepo();
    try {
      setup(root, ["--api-url", "https://api.kinboard.example.com/"]);
      expect(valueOf(envOf(root), "API_EXTERNAL_URL")).toBe("https://api.kinboard.example.com");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an existing install keeps its address, gets the route, and is not switched by setup.sh", () => {
    const root = scratchRepo();
    try {
      setup(root);
      const envFile = join(root, "webapp", "docker", ".env");
      // Make it look like a 1.12 install: a pinned API address and no KINBOARD_ENTRY.
      const old = readFileSync(envFile, "utf8")
        .replace(/^KINBOARD_ENTRY=.*\n/m, "")
        .replace(/^API_EXTERNAL_URL=.*$/m, "API_EXTERNAL_URL=http://192.168.1.50:8100")
        .replace(/^SITE_URL=.*$/m, "SITE_URL=http://192.168.1.50:3001");
      writeFileSync(envFile, old);
      const kong = join(root, "webapp", "docker", "kong.yml");
      writeFileSync(kong, installedKongYml());

      const out = setup(root);
      const env = envOf(root);
      expect(valueOf(env, "KINBOARD_ENTRY")).toBeUndefined();
      expect(valueOf(env, "API_EXTERNAL_URL")).toBe("http://192.168.1.50:8100");
      expect(valueOf(env, "SITE_URL")).toBe("http://192.168.1.50:3001");
      expect(out).toContain("still answers on the webapp container");
      const merged = readFileSync(kong, "utf8");
      expect(merged).toContain("# kinboard_entry");

      // And again: nothing moves.
      setup(root);
      expect(readFileSync(kong, "utf8")).toBe(merged);
      expect(envOf(root)).toBe(env);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a re-run keeps SITE_URL, even when Kong is not on 8100", () => {
    // It used to be re-derived from API_EXTERNAL_URL on every run, which for a
    // Kong port other than 8100 turned SITE_URL into the API's own address.
    const root = scratchRepo();
    try {
      setup(root);
      const envFile = join(root, "webapp", "docker", ".env");
      writeFileSync(
        envFile,
        readFileSync(envFile, "utf8")
          .replace(/^API_EXTERNAL_URL=.*$/m, "API_EXTERNAL_URL=http://10.0.0.5:8391")
          .replace(/^SITE_URL=.*$/m, "SITE_URL=http://10.0.0.5:3391"),
      );
      setup(root);
      expect(valueOf(envOf(root), "SITE_URL")).toBe("http://10.0.0.5:3391");
      setup(root, ["--url", "https://kinboard.example.com"]);
      expect(valueOf(envOf(root), "SITE_URL")).toBe("https://kinboard.example.com");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a new install whose kong.yml cannot take the route stays on webapp, with an API address that works", () => {
    const root = scratchRepo();
    try {
      const kong = join(root, "webapp", "docker", "kong.yml");
      writeFileSync(kong, readFileSync(kong, "utf8").replace("\nservices:\n", "\nservices: # x\n"));
      setup(root);
      const env = envOf(root);
      expect(valueOf(env, "KINBOARD_ENTRY")).toBe("webapp");
      // The outcome, not the variable: the browser is sent to Kong's own port
      // on the page's host, which this layout publishes, not to /rest on the
      // webapp (a 404 on every call).
      const browser = browserApiUrl({
        KINBOARD_ENTRY: valueOf(env, "KINBOARD_ENTRY"),
        API_EXTERNAL_URL: valueOf(env, "API_EXTERNAL_URL"),
        SITE_URL: valueOf(env, "SITE_URL"),
      });
      expect(browser).toBe(`http://localhost:${valueOf(env, "KONG_HTTP_PORT")}`);
      // ...and a domain without a port keeps the old one-name answer.
      setup(root, ["--url", "https://kinboard.example.com"]);
      expect(valueOf(envOf(root), "API_EXTERNAL_URL")).toBe("https://kinboard.example.com");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("API_EXTERNAL_URL=same-origin: kept on a Kong install; on one not moved yet, a working address that the move then ignores", () => {
    const root = scratchRepo();
    try {
      setup(root);
      const envFile = join(root, "webapp", "docker", ".env");
      const edit = (f: (e: string) => string) => writeFileSync(envFile, f(readFileSync(envFile, "utf8")));
      const lan = (e: string) => e.replace(/^SITE_URL=.*$/m, "SITE_URL=http://192.168.1.50:3001").replace(/^ADDITIONAL_REDIRECT_URLS=.*$/m, "ADDITIONAL_REDIRECT_URLS=http://192.168.1.50:3001");

      // Kong in front: a deliberate same-origin is left exactly as written.
      edit((e) => lan(e).replace(/^API_EXTERNAL_URL=.*$/m, "API_EXTERNAL_URL=same-origin"));
      setup(root);
      expect(valueOf(envOf(root), "API_EXTERNAL_URL")).toBe("same-origin");

      // Not moved yet (no KINBOARD_ENTRY, i.e. the webapp layout): the old
      // address on SITE_URL's host, and a warning.
      edit((e) => e.replace(/^KINBOARD_ENTRY=.*\n/m, ""));
      const out = spawnSync("bash", [join(root, "setup.sh"), "--non-interactive"], {
        cwd: root, encoding: "utf8", input: "", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
      });
      const env = envOf(root);
      expect(valueOf(env, "API_EXTERNAL_URL")).toBe("http://192.168.1.50:8100");
      expect(out.stderr).toContain("same-origin only works once Kong is the front door");
      // It works now (webapp layout: that address)...
      const vars = { API_EXTERNAL_URL: valueOf(env, "API_EXTERNAL_URL"), SITE_URL: valueOf(env, "SITE_URL") };
      expect(browserApiUrl({ KINBOARD_ENTRY: "webapp", ...vars })).toBe("http://192.168.1.50:8100");
      // ...and after the move the browser uses the page's own address.
      expect(browserApiUrl({ KINBOARD_ENTRY: "kong", ...vars })).toBeNull();

      // An empty address on a not-moved install gets the same.
      edit((e) => e.replace(/^API_EXTERNAL_URL=.*$/m, "API_EXTERNAL_URL="));
      setup(root);
      expect(valueOf(envOf(root), "API_EXTERNAL_URL")).toBe("http://192.168.1.50:8100");

      // Behind Traefik one domain serves both: left alone.
      edit((e) => e.replace(/^API_EXTERNAL_URL=.*$/m, "API_EXTERNAL_URL=") + 'COMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml"\n');
      setup(root);
      expect(valueOf(envOf(root), "API_EXTERNAL_URL")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a KINBOARD_ENTRY typo is fixed by setup.sh before anything reads it", () => {
    const root = scratchRepo();
    try {
      setup(root);
      const envFile = join(root, "webapp", "docker", ".env");
      writeFileSync(envFile, readFileSync(envFile, "utf8").replace(/^KINBOARD_ENTRY=.*$/m, "export KINBOARD_ENTRY=Kong"));
      const out = setup(root);
      const env = envOf(root);
      expect(env.match(/^\s*(export\s+)?KINBOARD_ENTRY=/gm)?.length).toBe(1);
      expect(valueOf(env, "KINBOARD_ENTRY")).toBe("kong");
      expect(out).toContain("KINBOARD_ENTRY written as KINBOARD_ENTRY=kong");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
