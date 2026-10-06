import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

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

function merge(file: string): { status: number; out: string } {
  const r = spawnSync("sh", [ENTRY_SH, "merge", file], { encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
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

  test("the tracked template is not where the route lives", () => {
    // Every install's kong.yml differs from the template (setup.sh writes its
    // keys in), so any change to the template makes `git pull --ff-only` refuse
    // — and the self-update would stop upgrading every one of them.
    expect(TEMPLATE).not.toContain("kinboard_entry");
    expect(readFileSync("../setup.sh", "utf8")).toContain('sh "$ENTRY_SH" merge "$KONG_YML"');
  });
});

/**
 * `switch` against a stub `docker` that plays the stack: whether Kong answers
 * `/` with the app, which host ports Kong ends up with, whether this is a
 * Traefik stack. Every docker call is recorded.
 */
interface Stack {
  probe: "app" | "kong404" | "other200" | "fail";
  /** Host ports Kong publishes after the switch. */
  kongPorts?: string;
  traefik?: boolean;
  /** When set, the probe only passes after `restart kong`. */
  needsRestart?: boolean;
}

function runSwitch(env: string, kongYml: string, stack: Stack) {
  const dir = tmp("entry-switch-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  writeFileSync(join(dir, ".env"), env);
  writeFileSync(join(dir, "kong.yml"), kongYml);
  const docker = `#!/bin/sh
echo "docker $*" >> "$CALLS"
case "$*" in
  *"exec -T webapp curl"*)
    if [ "$PROBE" = fail ]; then exit 7; fi
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
  *"ps -q kong"*) echo kongcid ;;
  *"inspect -f {{.State.StartedAt}}"*) echo "2020-01-01T00:00:00.000000000Z" ;;
  *"inspect -f"*) echo "$KONG_PORTS" ;;
  *" config"*) if [ -n "$TRAEFIK" ]; then echo '      traefik.enable: "true"'; else echo 'services:'; fi ;;
esac
exit 0
`;
  writeFileSync(join(bin, "docker"), docker);
  chmodSync(join(bin, "docker"), 0o755);
  try {
    const out = execFileSync("sh", [ENTRY_SH, "switch"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS: calls,
        DIR: dir,
        PROBE: stack.probe,
        KONG_PORTS: stack.kongPorts ?? "8100 3001 ",
        TRAEFIK: stack.traefik ? "1" : "",
        NEEDS_RESTART: stack.needsRestart ? "1" : "",
        ENTRY_PROBE_ATTEMPTS: "2",
        ENTRY_PROBE_INTERVAL: "0",
      },
    });
    return {
      out,
      env: readFileSync(join(dir, ".env"), "utf8"),
      calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      leftovers: execFileSync("ls", ["-A", dir], { encoding: "utf8" }).split("\n").filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXISTING_ENV = "POSTGRES_PASSWORD=s3cr3t\nAPI_EXTERNAL_URL=http://192.168.1.50:8100\nWEBAPP_PORT=3001\n";
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
    expect(r.out).toContain("staying on webapp: Kong did not get port 3001; .env restored");
    expect(r.leftovers).not.toContain(".env.pre-entry");
  });

  test("an explicit KINBOARD_ENTRY (the opt-out) is never touched", () => {
    for (const value of ["webapp", "kong"]) {
      const env = `${EXISTING_ENV}KINBOARD_ENTRY=${value}\n`;
      const r = runSwitch(env, WITH_ROUTE, { probe: "app" });
      expect(r.env).toBe(env);
      expect(r.calls).toEqual([]);
    }
  });

  test("a stack behind Traefik is left to opt in itself", () => {
    const r = runSwitch(EXISTING_ENV, WITH_ROUTE, { probe: "app", traefik: true });
    expect(r.env).toBe(EXISTING_ENV);
    expect(ups(r.calls)).toEqual([]);
    expect(r.out).toContain("behind Traefik");
  });

  test("a .env without a final newline gets the setting on a line of its own", () => {
    const env = EXISTING_ENV.trimEnd();
    const r = runSwitch(env, WITH_ROUTE, { probe: "app" });
    expect(r.env).toBe(`${env}\nKINBOARD_ENTRY=kong\n`);
  });
});

test.describe("the scripts that run the switch", () => {
  const selfUpdate = readFileSync("docker/kinboard-self-update.sh", "utf8");
  const start = readFileSync("docker/start.sh", "utf8");

  test("the self-update switches after Kong was restarted onto the merged route", () => {
    const restart = selfUpdate.indexOf("docker restart kinboard-kong");
    const sw = selfUpdate.indexOf("sh ./kinboard-entry.sh switch");
    expect(restart).toBeGreaterThan(0);
    expect(sw).toBeGreaterThan(restart);
    // ...and recreates the scheduler, since the switch recreates the webapp.
    expect(selfUpdate.indexOf('recreate_scheduler_if_webapp_changed "$WEBAPP_BEFORE"', sw)).toBeGreaterThan(sw);
  });

  test("start.sh up switches after the migrations, never failing the up", () => {
    const wait = start.indexOf("    wait_for_migrations\n");
    const sw = start.indexOf("sh ./kinboard-entry.sh switch || true");
    expect(wait).toBeGreaterThan(0);
    expect(sw).toBeGreaterThan(wait);
  });

  test("no `grep -qv` — on the Unraid host grep is ugrep, which gets its exit status wrong", () => {
    for (const f of ["docker/kinboard-entry.sh", "docker/kinboard-self-update.sh", "docker/start.sh", "../setup.sh"]) {
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

  test("a new install whose kong.yml cannot take the route stays on webapp", () => {
    const root = scratchRepo();
    try {
      const kong = join(root, "webapp", "docker", "kong.yml");
      writeFileSync(kong, readFileSync(kong, "utf8").replace("\nservices:\n", "\nservices: # x\n"));
      setup(root);
      expect(valueOf(envOf(root), "KINBOARD_ENTRY")).toBe("webapp");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
