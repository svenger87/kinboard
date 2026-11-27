import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runs the whole kinboard-self-update.sh against a real git checkout (a bare
 * origin, a clone, optionally a release commit to pull) and a stub `docker`
 * that keeps its containers, images and registry in files.
 *
 * - A plain `up` (no --no-recreate) recreates every service it is given, as a
 *   mismatched Compose did on a real stack (#534).
 * - `compose pull` copies what the stub registry holds under each reference
 *   onto "disk"; with `offline` it fails as a daemon without network does.
 * - A container's state for the health wait comes from its image id
 *   (`health`), so a "broken release" is an image whose containers exit.
 * - `docker exec … psql` records the status record and answers the
 *   "Try again" question from `retry`.
 *
 * Used by self-update-recreates-only-changes.spec.ts and
 * self-update-health-rollback.spec.ts.
 *
 * For kinboard-updater (RFC-023 §4.11.3, `updater` in the scenario) it also
 * has a stub `curl` that answers the registry's manifest HEADs from `remote`
 * (with `offline`, `ratelimit` and a token realm), the RepoDigests each image
 * id was pulled as, the compose revision label of each image, and the
 * sibling container the updater runs its tick in.
 */

export const SCRIPT = resolve("docker/kinboard-self-update.sh");

const STUB_DOCKER = String.raw`#!/bin/sh
echo "docker $*" >> "$STUB/calls"
esc() { printf '%s' "$1" | tr '/:@' '___'; }
now() { date -u +%Y-%m-%dT%H:%M:%S.000000000Z; }
make() { # service: a new container from the definition in ./stack.txt
  ref="$(awk -v s="$1" '$1 == s { print $2 }' ./stack.txt)"
  f="$STUB/images/$(esc "$ref")"
  # up pulls an image that is not on disk yet
  [ -f "$f" ] || { [ -f "$STUB/registry/$(esc "$ref")" ] && cp "$STUB/registry/$(esc "$ref")" "$f"; }
  id="$(cat "$f" 2>/dev/null || echo missing)"
  printf '%s|%s|%s\n' "$ref" "$id" "$(now)" > "$STUB/containers/$1"
  # a new container is a new id
  echo $(( $(cat "$STUB/gen-$1" 2>/dev/null || echo 0) + 1 )) > "$STUB/gen-$1"
}
cid() { printf '%s' "$1" | sed 's/^cid-//; s/-g[0-9]*$//'; }
if [ "$1" = compose ]; then
  shift
  # Global flags: -f picks the folder whose stack.txt is the definition (the
  # first file's, as Compose takes the project folder from it).
  first=""
  while :; do
    case "$1" in
      -f) [ -n "$first" ] || first="$2"; shift 2 ;;
      -p | --project-directory | --env-file) echo "$1 $2" >> "$STUB/globals"; shift 2 ;;
      *) break ;;
    esac
  done
  printenv TZ >> "$STUB/tz" || echo "<unset>" >> "$STUB/tz"
  if [ -n "$first" ]; then cd "$(dirname "$first")" || exit 1; fi
  sub="$1"; shift
  last=""; for a in "$@"; do last="$a"; done
  case "$sub" in
    config)
      case "$*" in
        --services) awk '{ print $1 }' ./stack.txt ;;
        --images) awk '{ print $2 }' ./stack.txt ;;
        --hash=*) [ -f "$STUB/hashfail" ] && exit 1; awk '{ print $1, $3 }' ./stack.txt ;;
        "") echo "name: t"; echo "services:"
            rev="$(cat "$STUB/file-revision" 2>/dev/null || true)"
            awk -v rev="$rev" '{ print "  " $1 ":"; print "    environment:"
              if ($1 == "webapp" && rev != "") print "      KINBOARD_COMPOSE_REVISION: \"" rev "\""
              print "      NOTE: \"image: not-this\""; print "    image: " $2 }' ./stack.txt > "$STUB/cfg.tmp"
            # each service's volumes, as its container mounts them (or as cfgvol/ says the file now has them)
            awk -v stub="$STUB" '{ print }
              /^    image: / {
                f = stub "/cfgvol/" svc; g = stub "/mounts/" svc; src = ""
                if ((getline l < f) > 0) { src = f; close(f) } else if ((getline l < g) > 0) { src = g; close(g) }
                if (src != "") { print "    volumes:"
                  while ((getline l < src) > 0) { split(l, a, " "); t = (a[2] ~ /^\//) ? "bind" : "volume"
                    print "      - type: " t; print "        source: " a[2]; print "        target: " a[1] }
                  close(src) } }
              /^  [^ ][^ ]*:$/ { svc = substr($0, 3, length($0) - 3) }' "$STUB/cfg.tmp"
            echo "networks:"; echo "  kinboard:"; echo "    image: not-a-service" ;;
      esac ;;
    ps) [ -f "$STUB/containers/$last" ] && echo "cid-$last-g$(cat "$STUB/gen-$last" 2>/dev/null || echo 0)" ;;
    pull)
      if [ -f "$STUB/offline" ]; then
        echo 'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host' >&2
        exit 1
      fi
      if [ -f "$STUB/ratelimit" ] || [ -f "$STUB/pullfail" ]; then
        echo 'Error response from daemon: toomanyrequests: retry-after: 0.001s' >&2
        exit 1
      fi
      # The services named (all without any), as Compose pulls them; a
      # reference listed in unpullable is a tag the registry does not have.
      svcs=""; for a in "$@"; do case "$a" in -*) ;; *) svcs="$svcs $a" ;; esac; done
      if [ -n "$svcs" ]; then refs="$(for s in $svcs; do awk -v s="$s" '$1 == s { print $2 }' ./stack.txt; done)"
      else refs="$(awk '{ print $2 }' ./stack.txt)"; fi
      for ref in $refs; do
        if grep -qxF "$ref" "$STUB/unpullable" 2>/dev/null; then echo "Error response from daemon: manifest unknown: $ref" >&2; exit 1; fi
      done
      for ref in $refs; do
        r="$STUB/registry/$(esc "$ref")"
        [ -f "$r" ] && cp "$r" "$STUB/images/$(esc "$ref")"
      done
      echo "pulled$svcs" >> "$STUB/pulls" ;;
    up)
      svcs=""; skipnext=""
      for a in "$@"; do
        if [ -n "$skipnext" ]; then skipnext=""; continue; fi
        case "$a" in --pull) skipnext=1 ;; -*) ;; *) svcs="$svcs $a" ;; esac
      done
      for s in $svcs; do
        if [ ! -f "$STUB/containers/$s" ]; then make "$s"
        else case "$*" in
          *--no-recreate*) ;;
          *) make "$s"; echo "$s" >> "$STUB/recreated" ;;
        esac; fi
      done ;;
  esac
  exit 0
fi
case "$1" in
  ps)
    # docker ps [-a] -q --filter label=com.docker.compose.service=webapp
    for f in "$STUB"/labels/*; do
      [ -f "$f" ] || continue
      n="$(basename "$f")"
      case "$*" in *compose.service=*)
        want_svc="$(printf '%s' "$*" | sed -n 's/.*compose\.service=\([^ ]*\).*/\1/p')"
        [ "$n" = "$want_svc" ] || continue ;;
      esac
      case "$*" in *compose.project=*)
        want="$(printf '%s' "$*" | sed -n 's/.*compose\.project=\([^ ]*\).*/\1/p')"
        [ "$(cut -d'|' -f1 "$f")" = "$want" ] || continue ;;
      esac
      echo "cid-$n-g$(cat "$STUB/gen-$n" 2>/dev/null || echo 0)"
    done ;;
  inspect)
    case "$3" in
      *com.docker.compose.project*) cat "$STUB/labels/$(cid "$4")" 2>/dev/null || exit 1; exit 0 ;;
      *com.docker.compose.service*) cid "$4"; echo; exit 0 ;;
    esac
    # the updater's own container (the sibling's image)
    if [ "$(cid "$4")" = updater ] && [ ! -f "$STUB/containers/updater" ]; then echo "sha256:updater-image"; exit 0; fi
    f="$STUB/containers/$(cid "$4")"; [ -f "$f" ] || exit 1
    IFS='|' read -r ref id created < "$f"
    case "$3" in
      *"{{range .Mounts}}{{.Destination}} "*)
        awk '{ if ($2 ~ /^\//) print $1, "bind", $2; else print $1, "volume", $2 }' "$STUB/mounts/$(cid "$4")" 2>/dev/null ;;
      *Destination*)
        dest="$(printf '%s' "$3" | sed -n 's/.*eq .Destination "\([^"]*\)".*/\1/p')"
        awk -v d="$dest" '$1 == d { print $2 }' "$STUB/mounts/$(cid "$4")" 2>/dev/null ;;
      *State.Status*) cat "$STUB/health-svc/$(cid "$4")" 2>/dev/null || cat "$STUB/health/$(esc "$id")" 2>/dev/null || echo "running|healthy|0|0|unless-stopped" ;;
      *Config.Image*) echo "$ref" ;;
      *Created*) echo "$created" ;;
      *.Image*) echo "$id" ;;
    esac ;;
  image)
    case "$4" in
      *compose-revision*) cat "$STUB/revisions/$(esc "$5")" 2>/dev/null || echo "<no value>" ;;
      *Labels*) cat "$STUB/versions/$(esc "$5")" 2>/dev/null || echo "<no value>" ;;
      *"join .RepoDigests"*) cat "$STUB/digests/$(esc "$5")" 2>/dev/null || echo "" ;;
      *RepoDigests*) tr ' ' '\n' < "$STUB/digests/$(esc "$5")" 2>/dev/null || true ;;
      *)
        case "$5" in
          sha256:*) [ -f "$STUB/gone/$(esc "$5")" ] && exit 1; echo "$5" ;;
          *) f="$STUB/images/$(esc "$5")"; [ -f "$f" ] || exit 1; cat "$f" ;;
        esac ;;
    esac ;;
  tag) echo "$2" > "$STUB/images/$(esc "$3")"; echo "$2 $3" >> "$STUB/tags" ;;
  logs) for a in "$@"; do last="$a"; done; cat "$STUB/logs/$(cid "$last")" 2>/dev/null ;;
  container) exit 1 ;;
  exec)
    case "$*" in
      *curl*deep=1*)
        f="$STUB/containers/$(cid "$2")"; IFS='|' read -r ref id created < "$f"
        r="$(cat "$STUB/smoke/$(esc "$id")" 2>/dev/null || echo '200|{"deep":{"ok":true,"missing":[],"write":true}}')"
        printf '%s\n%s\n' "$(printf '%s' "$r" | cut -d'|' -f2-)" "$(printf '%s' "$r" | cut -d'|' -f1)" ;;
      */kinboard/secrets/*)
        cat "$STUB/stored-secrets" 2>/dev/null ;;
      *pg_dumpall*)
        [ -f "$STUB/dump" ] && { cat "$STUB/dump"; exit 0; }
        echo "CREATE SCHEMA auth;"; echo "CREATE TABLE public.families ("; echo ");"; i=0; while [ $i -lt 60 ]; do echo "CREATE TABLE t$i ();"; i=$((i + 1)); done ;;
      *psql*)
        case "$*" in *" -i "*) cat >> "$STUB/psql" ;; esac
        for a in "$@"; do case "$a" in v=*) printf '%s' "$a" | cut -c3- > "$STUB/status" ;; k=*) printf '%s' "$a" | cut -c3- > "$STUB/status-key" ;; esac; done
        case "$*" in
          *"DELETE"*update_retry*RETURNING*)
            [ -f "$STUB/retry-delete-fails" ] && exit 1
            cat "$STUB/retry" 2>/dev/null; rm -f "$STUB/retry" ;;
        esac ;;
    esac ;;
  run)
    echo "$*" >> "$STUB/runs"
    case "$*" in *app.kinboard.updater-tick=1*)
      # The updater's sibling: Docker refuses a bind mount of a path the host
      # does not have (a Portainer web-editor stack).
      # Without --mount it is container mode's sibling (RFC-023 PR 14), which starts.
      case "$*" in *--mount*) ;; *) exit "$(cat "$STUB/hop-rc" 2>/dev/null || echo 0)" ;; esac
      if [ -f "$STUB/hop-missing" ]; then echo 'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /data/compose/3' >&2; exit 125; fi
      exit "$(cat "$STUB/hop-rc" 2>/dev/null || echo 0)" ;;
    esac
    case "$*" in *" -i "*) cat > /dev/null ;; esac
    case "$*" in *"grep -vc"* | *"wc -l"*) echo 0 ;; esac
    case "$*" in *"[ -d /data/config ]"*) [ -f "$STUB/config-dir" ] && echo present ;; esac
    case "$*" in *"config backup:"*)
      [ -f "$STUB/config-fail" ] && { echo "files=7"; echo "config backup: boom" >&2; exit 1; }
      cat "$STUB/config-out" 2>/dev/null || echo "files=7" ;;
    esac ;;
esac
exit 0
`;

/** The registry, for the updater's manifest HEADs: what `curl -sS -I … <url>` prints. */
const STUB_CURL = String.raw`#!/bin/sh
echo "curl $*" >> "$STUB/curls"
url=""; auth=""; get=""
prev=""
for a in "$@"; do
  case "$prev" in -H) case "$a" in "Authorization: Bearer "*) auth="$(printf '%s' "$a" | sed 's/^Authorization: Bearer //')" ;; esac ;; esac
  case "$a" in -G) get=1 ;; http://* | https://*) url="$a" ;; esac
  prev="$a"
done
if [ -f "$STUB/offline" ]; then echo "curl: (6) Could not resolve host: ghcr.io" >&2; exit 6; fi
if [ -n "$get" ]; then
  # the token realm
  echo '{"token":"stub-token","access_token":"stub-token","expires_in":300}'
  exit 0
fi
if [ -f "$STUB/ratelimit" ]; then printf 'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\n\r\n'; exit 0; fi
key="$(printf '%s' "$url" | sed 's|^[a-z]*://||; s|/v2/|/|; s|/manifests/|:|' | tr '/:@' '___')"
if [ -f "$STUB/remote-auth" ] && [ "$auth" != stub-token ]; then
  printf 'HTTP/1.1 401 Unauthorized\r\nWww-Authenticate: Bearer realm="https://auth.example/token",service="registry.example",scope="repository:x:pull"\r\n\r\n'
  exit 0
fi
if [ -f "$STUB/remote/$key" ]; then
  printf 'HTTP/2 200\r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: %s\r\n\r\n' "$(cat "$STUB/remote/$key")"
else
  printf 'HTTP/2 404\r\n\r\n'
fi
exit 0
`;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: string) => s.replace(/[/:@]/g, "_");

export type Service = { ref: string; def?: string };
export type Container = { ref: string; id: string; created?: string };
export type Scenario = {
  /** The definition in the checkout when the run starts. */
  stack: Record<string, Service>;
  /** A newer definition on origin/main, which the run pulls. */
  pulled?: Record<string, Service>;
  /** The containers as they run: image reference, image id, created. */
  containers: Record<string, Container>;
  /** Image reference -> id of the image on disk now. */
  images: Record<string, string>;
  /** Image reference -> id the registry serves under it. */
  registry?: Record<string, string>;
  /** Contents of .git/kinboard-update-hashes before the run, if any. */
  hashesFile?: string;
  /** Contents of .git/kinboard-update-state before the run, if any. */
  stateFile?: string;
  /** Another run holds the lock. */
  locked?: boolean;
  /** A tick holds the lock for about a second when the run starts. */
  tickRunning?: boolean;
  /**
   * The checkout runs the root compose.yml (RFC-023 §5.2), not
   * webapp/docker/docker-compose.yml: the definition (stack.txt) is at the
   * root, beside compose.yml and the root's .env. `overlay` adds the Diun
   * overlay, named by absolute path. `labels` is what the containers' Compose
   * labels say ("compose", the default here; "none"). Off: the legacy layout.
   */
  compose?: { overlay?: boolean; labels?: "compose" | "none"; project?: string };
  /** The containers carry the Compose labels of a legacy stack started from webapp/docker. */
  legacyLabels?: boolean;
  /** PROJECT_DIR has no .git: a compose.yml in a plain folder. */
  noGit?: boolean;
  /**
   * kinboard-updater (RFC-023 §4.11.3): the run is the published updater's,
   * KINBOARD_UPDATER=1, with its own container (service `updater`) labelled
   * as part of a compose.yml stack and its state in a config folder. Implies
   * compose and no git.
   */
  updater?: boolean;
};

export type Health = { status: string; health?: string; restarts?: number; code?: number; policy?: string };

export type RunResult = {
  status: number | null;
  out: string;
  /** Services the stub recreated in this run, sorted. */
  recreated: string[];
  calls: string[];
  /** Number of `compose pull`s that got through in this run. */
  pulls: number;
  hashesFile: string | null;
  state: string;
  /** The status record written in this run, parsed, if any. */
  record: Record<string, unknown> | null;
  /** The instance_settings key the record was written under (update_status, or the updater's update_hold). */
  recordKey: string | null;
  /** `docker tag` calls in this run: "<id> <reference>". */
  tags: string[];
  log: string;
  /** Every `docker run` in this run, its arguments on one line (a multi-line script spans several). */
  runs: string;
  /** The global flags (-p, --project-directory, --env-file) `docker compose` was called with, de-duplicated. */
  globals: string[];
  /** The TZ every `docker compose` call saw ("<unset>" when none), de-duplicated. */
  tz: string[];
  /** Every `curl` (the updater's registry HEADs and token requests), its arguments on one line. */
  curls: string[];
};

export const stackTxt = (stack: Record<string, Service>) =>
  Object.entries(stack)
    .map(([svc, s]) => `${svc} ${s.ref} ${hash(`${svc}|${s.ref}|${s.def ?? ""}`)}\n`)
    .join("");

export const hashLines = (stack: Record<string, Service>) =>
  stackTxt(stack)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(" "))
    .map(([svc, , h]) => `${svc} ${h}`)
    .join("\n");

/** A checkout and a stub daemon that persist across several runs. */
export class Rig {
  readonly dir = mkdtempSync(join(tmpdir(), "self-update-"));
  readonly stub = join(this.dir, "stub");
  readonly proj = join(this.dir, "proj");
  private readonly bin = join(this.dir, "bin");
  private readonly logFile = join(this.dir, "update.log");

  constructor(private readonly sc: Scenario, opts: { failHashes?: boolean } = {}) {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...args], {
        cwd,
        stdio: "pipe",
      });
    if (sc.updater) {
      sc.compose ??= {};
      sc.noGit = true;
    }
    for (const d of ["containers", "images", "registry", "health", "health-svc", "versions", "logs", "gone", "smoke", "mounts", "labels", "remote", "digests", "revisions"]) mkdirSync(join(this.stub, d), { recursive: true });
    mkdirSync(this.bin, { recursive: true });
    writeFileSync(join(this.bin, "docker"), STUB_DOCKER);
    chmodSync(join(this.bin, "docker"), 0o755);
    writeFileSync(join(this.bin, "curl"), STUB_CURL);
    chmodSync(join(this.bin, "curl"), 0o755);
    if (opts.failHashes) writeFileSync(join(this.stub, "hashfail"), "");
    for (const [ref, id] of Object.entries(sc.images)) writeFileSync(join(this.stub, "images", esc(ref)), `${id}\n`);
    this.setRegistry(sc.registry ?? {});
    for (const [svc, c] of Object.entries(sc.containers)) {
      writeFileSync(join(this.stub, "containers", svc), `${c.ref}|${c.id}|${c.created ?? "2026-01-01T00:00:00.000000000Z"}\n`);
    }

    git(this.dir, "init", "-q", "--bare", "origin.git");
    git(this.dir, "clone", "-q", join(this.dir, "origin.git"), "proj");
    mkdirSync(join(this.proj, "webapp", "docker"), { recursive: true });
    writeFileSync(join(this.proj, this.stackDir, "stack.txt"), stackTxt(sc.stack));
    // The files the stub's `-r` checks and the labels name; their content is
    // stack.txt's business.
    writeFileSync(join(this.proj, "compose.yml"), "# stub\n");
    writeFileSync(join(this.proj, "webapp", "docker", "docker-compose.yml"), "# stub\n");
    writeFileSync(join(this.proj, "webapp", "docker", "docker-compose.diun.yml"), "# stub\n");
    // Tracked, as in every Kinboard checkout: the script checks for it.
    writeFileSync(join(this.proj, "webapp", "docker", "kinboard-self-update.sh"), "# the checkout's copy; the run uses SCRIPT\n");
    // The real one: the run calls it to remove the services 1.15 retired.
    writeFileSync(join(this.proj, "webapp", "docker", "kinboard-entry.sh"), readFileSync(resolve("docker/kinboard-entry.sh")));
    git(this.proj, "add", "-A");
    git(this.proj, "commit", "-qm", "stack");
    git(this.proj, "push", "-q", "origin", "main");
    if (sc.pulled) {
      git(this.dir, "clone", "-q", join(this.dir, "origin.git"), "pusher");
      writeFileSync(join(this.dir, "pusher", this.stackDir, "stack.txt"), stackTxt(sc.pulled));
      git(join(this.dir, "pusher"), "commit", "-qam", "release");
      git(join(this.dir, "pusher"), "push", "-q", "origin", "main");
    }
    writeFileSync(join(this.proj, "webapp", "docker", ".env"), `DATA_DIR=${join(this.dir, "data")}\n`);
    if (sc.compose) {
      writeFileSync(join(this.proj, ".env"), "KINBOARD_TAG=next\n");
      if (sc.compose.labels !== "none") {
        const files = [join(this.proj, "compose.yml")];
        if (sc.compose.overlay) files.push(join(this.proj, "webapp", "docker", "docker-compose.diun.yml"));
        this.setLabels(`${sc.compose.project ?? "kbt"}|${this.proj}|${files.join(",")}|${join(this.proj, ".env")}`);
      }
      // init is a one-shot: done, exit 0, never restarted.
      if (sc.containers.init) this.setServiceHealth("init", { status: "exited", code: 0, policy: "no" });
      // compose.yml's named volumes
      for (const svc of Object.keys(sc.containers)) {
        if (svc === "webapp") this.setMount("webapp", "/var/lib/storage", "kinboard-storage");
        if (svc === "webapp" || svc === "db") this.setMount(svc, "/kinboard", "kinboard-config");
      }
    }
    if (sc.legacyLabels) {
      const d = join(this.proj, "webapp", "docker");
      this.setLabels(`docker|${d}|${join(d, "docker-compose.yml")},${join(d, "docker-compose.diun.yml")}|${join(d, ".env")}`);
    }
    if (sc.noGit) rmSync(join(this.proj, ".git"), { recursive: true, force: true });
    if (sc.hashesFile !== undefined) writeFileSync(this.hashesPath, sc.hashesFile);
    if (sc.stateFile !== undefined) writeFileSync(this.statePath, sc.stateFile);
  }

  /** Where stack.txt lives: beside the first compose file. */
  get stackDir() {
    return this.sc.compose ? "" : join("webapp", "docker");
  }

  /** Compose labels, "project|working_dir|config_files|environment_file", on every container (and the webhook's). */
  /** What pg_dumpall prints; unset, a supabase/postgres-shaped dump of 61 tables. */
  setDump(text: string) {
    writeFileSync(join(this.stub, "dump"), text);
  }
  setLabels(line: string) {
    // The webhook's labels on a git install (the overlay), the updater's on a one-file one.
    const own = this.sc.updater ? "updater" : "webhook";
    for (const svc of new Set([...Object.keys(this.sc.containers), own])) writeFileSync(join(this.stub, "labels", svc), `${line}\n`);
  }
  /** What service svc's container mounts at dest: a volume name or a host folder. */
  setMount(svc: string, dest: string, source: string) {
    const p = join(this.stub, "mounts", svc);
    const kept = existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l && !l.startsWith(`${dest} `)) : [];
    writeFileSync(p, [...kept, `${dest} ${source}`].join("\n") + "\n");
  }
  /** The files in the config folder's secrets/, as the database container would cat them. */
  setStoredSecrets(values: string[]) {
    writeFileSync(join(this.stub, "stored-secrets"), values.map((v) => `STORED_SECRET=${v}`).join("\n") + "\n");
  }

  get hashesPath() {
    return join(this.proj, ".git", "kinboard-update-hashes");
  }
  get statePath() {
    return this.sc.updater ? join(this.updaterDir, "state") : join(this.proj, ".git", "kinboard-update-state");
  }
  /** The updater's folder in the config volume (state, lock, log). */
  get updaterDir() {
    return join(this.dir, "config", "updater");
  }

  /** The registry's digest for reference ref now (the updater's manifest HEAD). */
  setRemote(ref: string, digest: string) {
    writeFileSync(join(this.stub, "remote", esc(ref)), `${digest}\n`);
  }
  /** The registry digests image id was pulled as ("repo@sha256:…"). */
  setDigests(id: string, digests: string[]) {
    writeFileSync(join(this.stub, "digests", esc(id)), `${digests.join(" ")}\n`);
  }
  /** The compose revision image id says it ships (its app.kinboard.compose-revision label). */
  setImageRevision(id: string, revision: string) {
    writeFileSync(join(this.stub, "revisions", esc(id)), `${revision}\n`);
  }
  /** The KINBOARD_COMPOSE_REVISION the stack's file declares for the webapp; null for none. */
  setFileRevision(revision: string | null) {
    const p = join(this.stub, "file-revision");
    if (revision === null) rmSync(p, { force: true });
    else writeFileSync(p, `${revision}\n`);
  }
  /** The registry asks for a token first (as GHCR and Docker Hub do), from its realm, without credentials. */
  setRemoteAuth(on: boolean) {
    const p = join(this.stub, "remote-auth");
    if (on) writeFileSync(p, "");
    else rmSync(p, { force: true });
  }
  /** The pull fails while the registry still answers its HEADs (a 429 on the layers, a full disk). */
  setPullFails(on: boolean) {
    const p = join(this.stub, "pullfail");
    if (on) writeFileSync(p, "");
    else rmSync(p, { force: true });
  }
  /** References the registry has no tag for: a pull naming one fails, as Compose's does ("manifest unknown"). */
  setUnpullable(refs: string[]) {
    writeFileSync(join(this.stub, "unpullable"), refs.map((r) => `${r}\n`).join(""));
  }
  /** What the compose file says service svc mounts now ("dest source" lines), unlike its container. */
  setConfigMounts(svc: string, lines: string[]) {
    mkdirSync(join(this.stub, "cfgvol"), { recursive: true });
    writeFileSync(join(this.stub, "cfgvol", svc), lines.join("\n") + "\n");
  }
  /** The sibling's `docker run`: refused as for a path the host lacks, or ending with this status. */
  setHop(h: { missing?: boolean; rc?: number }) {
    if (h.missing) writeFileSync(join(this.stub, "hop-missing"), "");
    if (h.rc !== undefined) writeFileSync(join(this.stub, "hop-rc"), String(h.rc));
  }

  /** The stack as .env and the compose files name it now, without a commit (a hand edit of .env). */
  setStack(stack: Record<string, Service>) {
    writeFileSync(join(this.proj, this.stackDir, "stack.txt"), stackTxt(stack));
  }
  setRegistry(registry: Record<string, string>) {
    for (const [ref, id] of Object.entries(registry)) writeFileSync(join(this.stub, "registry", esc(ref)), `${id}\n`);
  }
  /** The state a container from this image id reaches. */
  setHealth(id: string, h: Health) {
    writeFileSync(
      join(this.stub, "health", esc(id)),
      `${h.status}|${h.health ?? ""}|${h.restarts ?? 0}|${h.code ?? 0}|${h.policy ?? "unless-stopped"}\n`,
    );
  }
  /** The state service svc's container reaches, whatever its image (a one-shot's). */
  setServiceHealth(svc: string, h: Health) {
    writeFileSync(
      join(this.stub, "health-svc", svc),
      `${h.status}|${h.health ?? ""}|${h.restarts ?? 0}|${h.code ?? 0}|${h.policy ?? "unless-stopped"}\n`,
    );
  }
  /** What `/api/health?deep=1` answers inside a webapp container of this image: HTTP code and body. */
  setSmoke(id: string, code: number, body: string) {
    writeFileSync(join(this.stub, "smoke", esc(id)), `${code}|${body}\n`);
  }
  setVersion(id: string, version: string) {
    writeFileSync(join(this.stub, "versions", esc(id)), `${version}\n`);
  }
  /**
   * The config folder (RFC-023 §6.5): `dataDir` makes $DATA_DIR/config exist;
   * `mount` is what a service's container has at /kinboard (a volume name or a
   * host folder); `out` is what the archive step prints; `fail` makes it fail.
   */
  setConfig(c: { dataDir?: boolean; mount?: { svc: string; source: string }; out?: string; fail?: boolean }) {
    if (c.dataDir) writeFileSync(join(this.stub, "config-dir"), "");
    if (c.mount) this.setMount(c.mount.svc, "/kinboard", c.mount.source);
    if (c.out !== undefined) writeFileSync(join(this.stub, "config-out"), c.out);
    if (c.fail) writeFileSync(join(this.stub, "config-fail"), "");
  }
  setLogs(svc: string, text: string) {
    writeFileSync(join(this.stub, "logs", svc), text);
  }
  setOffline(on: boolean, kind: "offline" | "ratelimit" = "offline") {
    const p = join(this.stub, kind);
    if (on) writeFileSync(p, "");
    else rmSync(p, { force: true });
  }
  /** "Try again now" pressed in Settings. */
  requestRetry() {
    writeFileSync(join(this.stub, "retry"), "2026-11-26T10:00:00Z\n");
  }
  /** A line added to webapp/docker/.env. */
  addEnv(line: string) {
    const p = join(this.proj, "webapp", "docker", ".env");
    writeFileSync(p, readFileSync(p, "utf8") + line + "\n");
  }
  /** The database refuses to delete the "Try again" request. */
  failRetryDelete() {
    writeFileSync(join(this.stub, "retry-delete-fails"), "");
  }
  removeOrigin() {
    rmSync(join(this.dir, "origin.git"), { recursive: true, force: true });
  }
  /** The container a service runs now: [reference, image id]. */
  container(svc: string): { ref: string; id: string } | null {
    const p = join(this.stub, "containers", svc);
    if (!existsSync(p)) return null;
    const [ref, id] = readFileSync(p, "utf8").trim().split("|");
    return { ref, id };
  }
  imageOnDisk(ref: string): string | null {
    const p = join(this.stub, "images", esc(ref));
    return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
  }

  run(args: string[] = [], env: Record<string, string> = {}): RunResult {
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    for (const f of ["recreated", "calls", "pulls", "status", "status-key", "tags", "psql", "runs", "globals", "tz", "curls"]) rmSync(join(this.stub, f), { force: true });
    const logFile = this.sc.updater ? join(this.updaterDir, "update.log") : this.logFile;
    const logBefore = read(logFile).length;
    const lock = join(this.proj, ".git", "kinboard-update.lock");
    const res = spawnSync(
      "sh",
      [
        "-c",
        this.sc.locked
          ? `exec 9>"$LOCK"; flock -n 9 || exit 99; sh "$SCRIPT" "$@"`
          : this.sc.tickRunning
            ? `echo 1 > "$LOCK.tick-marker"; mv "$LOCK.tick-marker" "$(dirname "$LOCK")/kinboard-update.tick"; ( exec 9>"$LOCK"; flock 9; sleep 1 ) & sleep 0.3; sh "$SCRIPT" "$@"`
            : `sh "$SCRIPT" "$@"`,
        "_",
        ...args,
      ],
      {
        encoding: "utf8",
        // A run that never ends (a loop the guard should have stopped) fails
        // the test instead of hanging the whole suite.
        timeout: 60_000,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          PATH: `${this.bin}:${process.env.PATH}`,
          STUB: this.stub,
          SCRIPT,
          LOCK: lock,
          PROJECT_DIR: this.proj,
          COMPOSE_FILES: "-f docker-compose.yml",
          LOG_FILE: this.logFile,
          KINBOARD_HEALTH_TIMEOUT: "3",
          KINBOARD_HEALTH_POLL: "0.1",
          ...(this.sc.updater
            ? {
                KINBOARD_UPDATER: "1",
                KINBOARD_UPDATER_DIR: this.updaterDir,
                KINBOARD_SELF_CONTAINER: "cid-updater-g0",
                // The default, the config volume's updater/update.log.
                LOG_FILE: "",
                PROJECT_DIR: "",
                COMPOSE_FILES: "",
              }
            : {}),
          ...env,
        },
      },
    );
    const status = read(join(this.stub, "status"));
    return {
      status: res.status,
      out: res.stdout + res.stderr,
      recreated: read(join(this.stub, "recreated")).split("\n").filter(Boolean).sort(),
      calls: read(join(this.stub, "calls")).split("\n").filter(Boolean),
      pulls: read(join(this.stub, "pulls")).split("\n").filter(Boolean).length,
      hashesFile: existsSync(this.hashesPath) ? readFileSync(this.hashesPath, "utf8") : null,
      state: read(this.statePath),
      record: status ? (JSON.parse(status) as Record<string, unknown>) : null,
      recordKey: read(join(this.stub, "status-key")).trim() || (status ? "update_status" : null),
      tags: read(join(this.stub, "tags")).split("\n").filter(Boolean),
      log: read(logFile).slice(logBefore),
      runs: read(join(this.stub, "runs")),
      globals: [...new Set(read(join(this.stub, "globals")).split("\n").filter(Boolean))],
      tz: [...new Set(read(join(this.stub, "tz")).split("\n").filter(Boolean))],
      curls: read(join(this.stub, "curls")).split("\n").filter(Boolean),
    };
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** One run on a fresh rig. */
export function runOnce(sc: Scenario, opts: { failHashes?: boolean } = {}): RunResult {
  const rig = new Rig(sc, opts);
  try {
    return rig.run();
  } finally {
    rig.cleanup();
  }
}
