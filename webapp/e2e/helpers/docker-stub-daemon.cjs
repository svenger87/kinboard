// A stub Docker daemon for kinboard-self-update.sh's container mode
// (RFC-023 §4.11.3, PR 14), driven by helpers/updater-container-stub.ts.
//
// One file of state ($STUB/state.json): containers as the Engine API
// describes them (GET /containers/{id}/json), images with their config,
// tags, the registry. Two entry points share it:
//
//   - `docker` (the CLI): inspect / image inspect with the Go templates the
//     script uses, ps with filters and --format, pull, tag, rename, stop,
//     start, rm, update, run, exec, logs. `docker compose` fails: container
//     mode has no file to give it.
//   - `curl`: with --unix-socket it is the Engine API (/_ping, container and
//     image inspect, POST /containers/create, POST /networks/{id}/connect);
//     without, the registry's manifest HEAD and token realm.
//
// POST /containers/create merges the image's config into the request the way
// the daemon does (daemon/container merge: Env, Labels, Entrypoint/Cmd,
// Healthcheck, User, WorkingDir, ExposedPorts, Volumes, StopSignal) and
// derives Mounts and networks from HostConfig and NetworkingConfig, so a
// create built from an inspect can be compared with that inspect.
//
// `docker start` refuses a host port another running container holds, as
// Docker does: a swap that started the new container before stopping the old
// one fails here as it would on a real host.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Read when called: the spec loads this module for create() and start() alone.
const stubDir = () => process.env.STUB;
const statePath = () => path.join(stubDir(), "state.json");

// The script runs stub calls side by side: log_excerpt pipes `docker logs`
// into redact, which runs `docker exec` and `docker inspect` meanwhile. So a
// call that changed nothing writes nothing (it would put back a state another
// call had just changed), and a write goes through a temporary file of this
// process's own: with one shared name, the second of two renames found its
// file gone, the call died before printing, and a log line or a secret to
// redact was missing from the excerpt.
let loaded = null;
function load() {
  const s = JSON.parse(fs.readFileSync(statePath(), "utf8"));
  loaded = JSON.stringify(s, null, 1);
  return s;
}
function save(s) {
  const text = JSON.stringify(s, null, 1);
  if (text === loaded) return;
  const tmp = `${statePath()}.${process.pid}.${hex(4)}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, statePath());
  loaded = text;
}
function record(line) {
  fs.appendFileSync(path.join(stubDir(), "calls"), line.replace(/\n/g, " ") + "\n");
}
const hex = (n) => crypto.randomBytes(n).toString("hex");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- lookups

function findContainer(s, ref) {
  if (!ref) return null;
  const r = ref.replace(/^\//, "");
  for (const c of Object.values(s.containers)) {
    if (c.Id === r || c.Name === "/" + r) return c;
  }
  if (/^[0-9a-f]{12,}$/.test(r)) {
    const m = Object.values(s.containers).filter((c) => c.Id.startsWith(r));
    if (m.length === 1) return m[0];
  }
  return null;
}
function findImage(s, ref) {
  if (!ref) return null;
  if (s.images[ref]) return s.images[ref];
  if (s.tags[ref] && s.images[s.tags[ref]]) return s.images[s.tags[ref]];
  return null;
}

// ---------------------------------------------------------------- templates
// The subset of Go's text/template the script uses: .Field.Paths, index,
// join, eq, println, if/else/end, range/end, and ps's .Label "key".

function parseTemplate(t) {
  const toks = [];
  let i = 0;
  while (i < t.length) {
    const o = t.indexOf("{{", i);
    if (o < 0) {
      toks.push({ text: t.slice(i) });
      break;
    }
    if (o > i) toks.push({ text: t.slice(i, o) });
    const c = t.indexOf("}}", o);
    toks.push({ act: t.slice(o + 2, c).trim() });
    i = c + 2;
  }
  let p = 0;
  function block(stop) {
    const out = [];
    while (p < toks.length) {
      const k = toks[p];
      if (k.act !== undefined && stop.includes(k.act.split(/\s+/)[0])) return out;
      p++;
      if (k.text !== undefined) out.push(k);
      else if (/^if\s/.test(k.act)) {
        const node = { if: k.act.slice(3).trim(), then: block(["else", "end"]), else: [] };
        if (toks[p].act === "else") {
          p++;
          node.else = block(["end"]);
        }
        p++;
        out.push(node);
      } else if (/^range\s/.test(k.act)) {
        const node = { range: k.act.slice(6).trim(), body: block(["end"]) };
        p++;
        out.push(node);
      } else out.push({ expr: k.act });
    }
    return out;
  }
  return block([]);
}
function words(e) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m;
  while ((m = re.exec(e))) out.push(m[1] !== undefined ? { lit: m[1] } : { w: m[2] });
  return out;
}
function field(dot, w) {
  if (w === ".") return dot;
  let v = dot;
  for (const k of w.split(".").slice(1)) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}
function arg(dot, a) {
  return a.lit !== undefined ? a.lit : field(dot, a.w);
}
function evalExpr(dot, e) {
  const ws = words(e);
  const head = ws[0].w;
  if (head === "index") {
    const m = arg(dot, ws[1]);
    const v = m ? m[arg(dot, ws[2])] : undefined;
    return v === undefined ? "" : v;
  }
  if (head === "join") return (arg(dot, ws[1]) || []).join(arg(dot, ws[2]));
  if (head === "eq") return arg(dot, ws[1]) === arg(dot, ws[2]);
  if (head === "println") return (ws[1] ? show(arg(dot, ws[1])) : "") + "\n";
  if (head === "json") return JSON.stringify(arg(dot, ws[1]));
  const v = field(dot, head);
  if (typeof v === "function") return v(...ws.slice(1).map((a) => arg(dot, a)));
  return v;
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return !!v;
}
function show(v) {
  if (v === undefined) return "<no value>";
  if (v === null) return "<nil>";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function render(nodes, dot) {
  let out = "";
  for (const n of nodes) {
    if (n.text !== undefined) out += n.text;
    else if (n.expr !== undefined) {
      const v = evalExpr(dot, n.expr);
      out += typeof v === "string" ? v : show(v);
    } else if (n.if !== undefined) out += render(truthy(evalExpr(dot, n.if)) ? n.then : n.else, dot);
    else if (n.range !== undefined) for (const it of evalExpr(dot, n.range) || []) out += render(n.body, it);
  }
  return out;
}

// ---------------------------------------------------------------- the daemon

function mergeImage(cfg, img) {
  const ic = img.Config || {};
  const c = clone(cfg);
  if (!c.Env || c.Env.length === 0) c.Env = clone(ic.Env || []);
  else
    for (const ie of ic.Env || []) {
      const k = ie.split("=")[0];
      if (!c.Env.some((u) => u.split("=")[0] === k)) c.Env.push(ie);
    }
  if (!c.Labels) c.Labels = clone(ic.Labels || {});
  else for (const [k, v] of Object.entries(ic.Labels || {})) if (!(k in c.Labels)) c.Labels[k] = v;
  if (!c.Entrypoint || c.Entrypoint.length === 0) {
    if (!c.Cmd || c.Cmd.length === 0) c.Cmd = clone(ic.Cmd ?? null);
    c.Entrypoint = clone(ic.Entrypoint ?? null);
  }
  if (!c.User) c.User = ic.User || "";
  if (!c.WorkingDir) c.WorkingDir = ic.WorkingDir || "";
  if (!c.StopSignal && ic.StopSignal) c.StopSignal = ic.StopSignal;
  c.ExposedPorts = { ...(ic.ExposedPorts || {}), ...(c.ExposedPorts || {}) };
  if (Object.keys(c.ExposedPorts).length === 0) delete c.ExposedPorts;
  c.Volumes = { ...(ic.Volumes || {}), ...(c.Volumes || {}) };
  if (Object.keys(c.Volumes).length === 0) c.Volumes = null;
  if (!c.Healthcheck) c.Healthcheck = clone(ic.Healthcheck ?? null);
  else if (ic.Healthcheck) {
    const h = c.Healthcheck;
    if (!h.Test || h.Test.length === 0) h.Test = clone(ic.Healthcheck.Test);
    for (const k of ["Interval", "Timeout", "StartPeriod", "StartInterval", "Retries"]) if (!h[k] && ic.Healthcheck[k]) h[k] = ic.Healthcheck[k];
  }
  return c;
}

function endpoint(s, net, e, cid, name, hostname) {
  const n = s.networks[net] || Object.values(s.networks).find((x) => x.Id === net);
  if (!n) throw new Error(`network ${net} not found`);
  const ip = (e.IPAMConfig && e.IPAMConfig.IPv4Address) || `10.99.0.${(s.seq = (s.seq || 0) + 1) + 10}`;
  return [
    n.Name,
    {
      IPAMConfig: e.IPAMConfig ?? null,
      Links: e.Links ?? null,
      Aliases: e.Aliases ?? null,
      DriverOpts: e.DriverOpts ?? null,
      GwPriority: e.GwPriority ?? 0,
      NetworkID: n.Id,
      EndpointID: hex(32),
      IPAddress: ip,
      MacAddress: "02:42:" + hex(4).match(/../g).join(":"),
      DNSNames: [name, ...(e.Aliases || []), cid.slice(0, 12), ...(hostname && hostname !== cid.slice(0, 12) ? [hostname] : [])],
    },
  ];
}

function create(s, name, body) {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) return [400, { message: "invalid name" }];
  if (findContainer(s, name)) return [409, { message: `Conflict. The container name "/${name}" is already in use` }];
  // Someone pulled under the reference between the updater's pull and this create.
  if (s.moveTagOnCreate) {
    s.tags[body.Image] = s.moveTagOnCreate;
    delete s.moveTagOnCreate;
  }
  const img = findImage(s, body.Image);
  if (!img) return [404, { message: `No such image: ${body.Image}` }];
  const svc = (body.Labels || {})["com.docker.compose.service"] || "";
  if (s.fail && s.fail.create === svc) return [500, { message: "stub: create refused" }];
  const id = hex(32);
  const { HostConfig, NetworkingConfig, ...cfg } = clone(body);
  const c = mergeImage(cfg, img);
  if (!c.Hostname) c.Hostname = id.slice(0, 12);
  c.Image = body.Image;
  // What Docker reports for what was not set: false, "", null, or (for its
  // omitempty fields) nothing at all.
  for (const k of ["AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce"]) c[k] = !!c[k];
  c.Domainname = c.Domainname || "";
  for (const k of ["Cmd", "Entrypoint", "Volumes"]) if (c[k] === undefined) c[k] = null;
  if (!c.OnBuild) delete c.OnBuild;
  for (const k of ["Healthcheck", "StopSignal", "StopTimeout", "Shell", "NetworkDisabled", "ExposedPorts", "MacAddress", "ArgsEscaped"])
    if (c[k] === null || c[k] === undefined || c[k] === false || c[k] === "") delete c[k];
  const hc = HostConfig || {};
  const mounts = [];
  const taken = new Set();
  for (const b of hc.Binds || []) {
    const [src, dst, mode = ""] = b.split(":");
    taken.add(dst);
    if (src.startsWith("/")) mounts.push({ Type: "bind", Source: src, Destination: dst, Mode: mode, RW: !mode.split(",").includes("ro"), Propagation: "rprivate" });
    else mounts.push({ Type: "volume", Name: src, Source: `/var/lib/docker/volumes/${src}/_data`, Destination: dst, Driver: "local", Mode: mode, RW: !mode.split(",").includes("ro"), Propagation: "" });
  }
  for (const m of hc.Mounts || []) {
    taken.add(m.Target);
    if (m.Type === "volume") {
      const vname = m.Source || hex(32);
      if (!s.volumes.includes(vname)) s.volumes.push(vname);
      mounts.push({ Type: "volume", Name: vname, Source: `/var/lib/docker/volumes/${vname}/_data`, Destination: m.Target, Driver: "local", Mode: "z", RW: !m.ReadOnly, Propagation: "" });
    } else if (m.Type === "bind") mounts.push({ Type: "bind", Source: m.Source, Destination: m.Target, Mode: "", RW: !m.ReadOnly, Propagation: "rprivate" });
    else mounts.push({ Type: m.Type, Source: m.Source || "", Destination: m.Target, Mode: "", RW: !m.ReadOnly, Propagation: "" });
  }
  for (const v of Object.keys(c.Volumes || {})) {
    if (taken.has(v)) continue;
    const vname = hex(32);
    s.volumes.push(vname);
    mounts.push({ Type: "volume", Name: vname, Source: `/var/lib/docker/volumes/${vname}/_data`, Destination: v, Driver: "local", Mode: "", RW: true, Propagation: "" });
  }
  const networks = {};
  for (const [net, e] of Object.entries((NetworkingConfig && NetworkingConfig.EndpointsConfig) || {})) {
    const [n, ep] = endpoint(s, net, e, id, name, c.Hostname);
    networks[n] = ep;
  }
  s.containers[id] = {
    Id: id,
    Created: now(),
    Path: (c.Entrypoint || c.Cmd || [""])[0],
    Args: [...(c.Entrypoint || []), ...(c.Cmd || [])].slice(1),
    State: { Status: "created", Running: false, Paused: false, Restarting: false, OOMKilled: false, Dead: false, Pid: 0, ExitCode: 0, Error: "", StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" },
    Image: img.Id,
    ResolvConfPath: `/var/lib/docker/containers/${id}/resolv.conf`,
    HostnamePath: `/var/lib/docker/containers/${id}/hostname`,
    HostsPath: `/var/lib/docker/containers/${id}/hosts`,
    LogPath: `/var/lib/docker/containers/${id}/${id}-json.log`,
    Name: "/" + name,
    RestartCount: 0,
    Driver: "overlayfs",
    Platform: "linux",
    HostConfig: hc,
    Mounts: mounts,
    Config: c,
    NetworkSettings: { SandboxID: hex(32), SandboxKey: `/var/run/docker/netns/${hex(6)}`, Ports: {}, Networks: networks },
  };
  return [201, { Id: id, Warnings: [] }];
}

function hostPorts(c) {
  const out = [];
  for (const [p, bs] of Object.entries(c.HostConfig.PortBindings || {})) for (const b of bs || []) out.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort}/${p.split("/")[1] || "tcp"}`);
  return out;
}

function start(s, c) {
  const svc = (c.Config.Labels || {})["com.docker.compose.service"] || "";
  if (s.crash === `start:${svc}`) {
    delete s.crash;
    save(s);
    try {
      process.kill(process.ppid, "SIGKILL");
    } catch {}
    process.exit(137);
  }
  if (s.fail && s.fail.start === svc && c.Image !== s.fail.startSpare) return "Error response from daemon: stub: cannot start";
  for (const o of Object.values(s.containers)) {
    if (o.Id === c.Id || !o.State.Running) continue;
    const clash = hostPorts(c).filter((p) => hostPorts(o).includes(p));
    if (clash.length) return `Error response from daemon: driver failed programming external connectivity: Bind for ${clash[0]} failed: port is already allocated`;
  }
  const b = (s.behave && s.behave[c.Image]) || {};
  const oneshot = svc === "init" || svc === "db-init";
  const hasHc = c.Config.Healthcheck && c.Config.Healthcheck.Test && c.Config.Healthcheck.Test[0] !== "NONE";
  c.RestartCount = 0;
  c.State.StartedAt = now();
  if (oneshot) {
    const code = b[svc] ?? 0;
    Object.assign(c.State, { Status: "exited", Running: false, ExitCode: code, FinishedAt: now() });
  } else if (b.webapp === "exit") {
    Object.assign(c.State, { Status: "exited", Running: false, ExitCode: 1 });
    c.RestartCount = 0;
  } else if (b.webapp === "restarting") {
    Object.assign(c.State, { Status: "restarting", Running: true, Restarting: true, ExitCode: 1 });
    c.RestartCount = 5;
  } else {
    Object.assign(c.State, { Status: "running", Running: true, Restarting: false, ExitCode: 0 });
    if (hasHc) c.State.Health = { Status: b.webapp === "unhealthy" ? "unhealthy" : "healthy", FailingStreak: 0, Log: [] };
  }
  return "";
}

// ---------------------------------------------------------------- the API

function api(s, method, url, body) {
  const u = new URL(url, "http://localhost");
  const p = u.pathname.replace(/^\/v[0-9.]+/, "");
  record(`api ${method} ${p}${u.search}`);
  if (p === "/_ping") return [200, "OK"];
  let m;
  if (method === "GET" && (m = p.match(/^\/containers\/([^/]+)\/json$/))) {
    const c = findContainer(s, decodeURIComponent(m[1]));
    return c ? [200, c] : [404, { message: "No such container" }];
  }
  if (method === "GET" && (m = p.match(/^\/images\/(.+)\/json$/))) {
    const img = findImage(s, decodeURIComponent(m[1]));
    if (!img) return [404, { message: "No such image" }];
    const out = clone(img);
    if (u.searchParams.get("manifests") !== "1") delete out.Manifests;
    return [200, out];
  }
  if (method === "POST" && p === "/containers/create") {
    if (s.fail && s.fail.rawCreate) return [500, { message: "stub: daemon error" }];
    return create(s, u.searchParams.get("name"), JSON.parse(body));
  }
  if (method === "POST" && (m = p.match(/^\/networks\/([^/]+)\/connect$/))) {
    const req = JSON.parse(body);
    const c = findContainer(s, req.Container);
    if (!c) return [404, { message: "No such container" }];
    const svc = (c.Config.Labels || {})["com.docker.compose.service"] || "";
    if (s.fail && s.fail.connect === svc) return [500, { message: "stub: connect refused" }];
    const [n, ep] = endpoint(s, decodeURIComponent(m[1]), req.EndpointConfig || {}, c.Id, c.Name.slice(1), c.Config.Hostname);
    c.NetworkSettings.Networks[n] = ep;
    return [200, ""];
  }
  return [404, { message: `stub: no route ${method} ${p}` }];
}

// ---------------------------------------------------------------- curl

function curl(argv) {
  record("curl " + argv.join(" "));
  const s = load();
  let sock = "",
    method = "GET",
    out = "",
    wfmt = "",
    data = "",
    url = "",
    head = false,
    get = false;
  const hdrs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unix-socket") sock = argv[++i];
    else if (a === "-X") method = argv[++i];
    else if (a === "-o") out = argv[++i];
    else if (a === "-w") wfmt = argv[++i];
    else if (a === "--data-binary") data = argv[++i];
    else if (a === "-H") hdrs.push(argv[++i]);
    else if (a === "-I") head = true;
    else if (a === "-G") get = true;
    else if (["-m", "--proto", "--data-urlencode"].includes(a)) i++;
    else if (/^https?:\/\//.test(a)) url = a;
  }
  if (sock || /^http:\/\/(127\.0\.0\.1|localhost):2375/.test(url)) {
    if (s.apiDown) {
      process.stderr.write("curl: (7) Couldn't connect to server\n");
      process.exit(7);
    }
    const body = data.startsWith("@") ? fs.readFileSync(data.slice(1), "utf8") : data;
    let code, res;
    try {
      [code, res] = api(s, method, url, body);
    } catch (e) {
      [code, res] = [500, { message: String(e.message || e) }];
    }
    save(s);
    const text = typeof res === "string" ? res : JSON.stringify(res);
    if (out) fs.writeFileSync(out, text);
    else process.stdout.write(text);
    if (wfmt) process.stdout.write(wfmt.replace("%{http_code}", String(code)));
    process.exit(0);
  }
  // the registry
  fs.appendFileSync(path.join(stubDir(), "curls"), "curl " + argv.join(" ") + "\n");
  if (s.offline) {
    process.stderr.write("curl: (6) Could not resolve host: ghcr.io\n");
    process.exit(6);
  }
  if (get) {
    process.stdout.write('{"token":"stub-token"}\n');
    process.exit(0);
  }
  const key = url.replace(/^[a-z]+:\/\//, "").replace("/v2/", "/").replace("/manifests/", ":");
  const d = (s.remote || {})[key];
  if (d) process.stdout.write(`HTTP/2 200\r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: ${d}\r\n\r\n`);
  else process.stdout.write("HTTP/2 404\r\n\r\n");
  process.exit(0);
}

// ---------------------------------------------------------------- docker

function docker(argv) {
  record("docker " + argv.join(" "));
  const s = load();
  const done = (code = 0, out = "", err = "") => {
    save(s);
    if (out) process.stdout.write(out);
    if (err) process.stderr.write(err);
    process.exit(code);
  };
  const cmd = argv[0];
  const fmt = () => {
    const i = argv.indexOf("-f") >= 0 ? argv.indexOf("-f") : argv.indexOf("--format");
    return i >= 0 ? argv[i + 1] : null;
  };
  if (cmd === "compose") return done(1, "", "stub: container mode must not run docker compose\n");
  if (cmd === "inspect" || (cmd === "container" && argv[1] === "inspect")) {
    const f = fmt();
    const names = argv.slice(1).filter((a, i, all) => a !== "inspect" && a !== "-f" && a !== "--format" && all[i - 1] !== "-f" && all[i - 1] !== "--format");
    let out = "";
    const found = [];
    for (const n of names) {
      const c = findContainer(s, n);
      if (!c) return done(1, out, `Error: No such object: ${n}\n`);
      found.push(c);
      if (f) out += render(parseTemplate(f), c) + "\n";
    }
    return done(0, f ? out : JSON.stringify(found, null, 1) + "\n");
  }
  if (cmd === "image" && argv[1] === "inspect") {
    const f = fmt();
    const name = argv[argv.length - 1];
    const img = findImage(s, name);
    if (!img) return done(1, "", `Error: No such image: ${name}\n`);
    return done(0, f ? render(parseTemplate(f), img) + "\n" : JSON.stringify([img]) + "\n");
  }
  if (cmd === "ps") {
    const short = argv.filter((a) => /^-[a-z]+$/.test(a)).join("");
    const all = short.includes("a");
    const q = short.includes("q");
    const trunc = !argv.includes("--no-trunc");
    const filters = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === "--filter") filters.push(argv[++i]);
    const f = fmt();
    let out = "";
    for (const c of Object.values(s.containers)) {
      if (!all && !c.State.Running) continue;
      const labels = c.Config.Labels || {};
      const ok = filters.every((fl) => {
        const m = fl.match(/^label=([^=]+)(?:=(.*))?$/);
        if (!m) return true;
        return m[2] === undefined ? m[1] in labels : labels[m[1]] === m[2];
      });
      if (!ok) continue;
      const row = { ID: trunc ? c.Id.slice(0, 12) : c.Id, Names: c.Name.slice(1), Image: c.Config.Image, Label: (k) => labels[k] ?? "" };
      out += q || !f ? row.ID + "\n" : render(parseTemplate(f), row) + "\n";
    }
    return done(0, out);
  }
  if (cmd === "pull") {
    const ref = argv[argv.length - 1];
    if (s.pullFails) return done(1, "", "Error response from daemon: toomanyrequests: retry-after: 0.001s\n");
    const id = (s.registry || {})[ref];
    if (!id) return done(1, "", `Error response from daemon: manifest for ${ref} not found\n`);
    s.tags[ref] = id;
    fs.appendFileSync(path.join(stubDir(), "pulls"), ref + "\n");
    // A container changed under the updater's feet after it decided (another image now).
    if (s.onPull) {
      for (const c of Object.values(s.containers)) {
        if (c.Name !== `/${s.onPull.name}`) continue;
        if (s.onPull.image) c.Config.Image = s.onPull.image;
        // Replaced by something that is not the all-in-one image any more.
        if (s.onPull.notAio) {
          delete c.Config.Labels["app.kinboard.aio"];
          c.Config.Env = c.Config.Env.filter((e) => e !== "KINBOARD_AIO=1");
        }
      }
      delete s.onPull;
    }
    return done(0, `${ref}\n`);
  }
  if (cmd === "tag") {
    const img = findImage(s, argv[1]);
    if (!img) return done(1, "", "no such image\n");
    s.tags[argv[2]] = img.Id;
    fs.appendFileSync(path.join(stubDir(), "tags"), `${img.Id} ${argv[2]}\n`);
    return done(0);
  }
  if (cmd === "rename") {
    const c = findContainer(s, argv[1]);
    if (!c) return done(1, "", "Error: No such container\n");
    if (findContainer(s, argv[2])) return done(1, "", "Error response from daemon: Conflict. The name is already in use\n");
    if (s.fail && s.fail.rename === argv[1]) return done(1, "", "stub: rename refused\n");
    c.Name = "/" + argv[2];
    for (const ep of Object.values(c.NetworkSettings.Networks || {})) if (ep.DNSNames) ep.DNSNames[0] = argv[2];
    return done(0);
  }
  if (cmd === "update") {
    const pol = (argv.find((a) => a.startsWith("--restart=")) || "").slice(10);
    const c = findContainer(s, argv[argv.length - 1]);
    if (!c) return done(1, "", "no such container\n");
    const [Name, n] = pol.split(":");
    c.HostConfig.RestartPolicy = { Name, MaximumRetryCount: n ? Number(n) : 0 };
    return done(0, c.Id + "\n");
  }
  if (cmd === "stop") {
    const c = findContainer(s, argv[argv.length - 1]);
    if (!c) return done(1, "", "no such container\n");
    if (s.fail && s.fail.stop) return done(1, "", "stub: stop refused\n");
    Object.assign(c.State, { Status: "exited", Running: false, Restarting: false, ExitCode: 0, FinishedAt: now() });
    delete c.State.Health;
    return done(0, argv[argv.length - 1] + "\n");
  }
  if (cmd === "start") {
    const c = findContainer(s, argv[argv.length - 1]);
    if (!c) return done(1, "", "no such container\n");
    const err = start(s, c);
    return err ? done(1, "", err + "\n") : done(0, argv[argv.length - 1] + "\n");
  }
  if (cmd === "rm") {
    if (argv.includes("-v") || argv.includes("--volumes")) s.volumesRemoved = (s.volumesRemoved || 0) + 1;
    const c = findContainer(s, argv[argv.length - 1]);
    if (!c) return done(1, "", "no such container\n");
    if (c.State.Running && !argv.includes("-f")) return done(1, "", "Error response from daemon: cannot remove a running container\n");
    delete s.containers[c.Id];
    s.removed = [...(s.removed || []), c.Id];
    return done(0, c.Id + "\n");
  }
  if (cmd === "logs") {
    const c = findContainer(s, argv[argv.length - 1]);
    return done(0, (c && (s.logs || {})[(c.Config.Labels || {})["com.docker.compose.service"]]) || "");
  }
  if (cmd === "exec") {
    const line = argv.join(" ");
    if (/curl.*deep=1/.test(line)) {
      const c = findContainer(s, argv[1]);
      const r = ((s.smoke || {})[c ? c.Image : ""] || '200|{"deep":{"ok":true,"missing":[],"write":true}}').split("|");
      return done(0, `${r.slice(1).join("|")}\n${r[0]}\n`);
    }
    if (/\/kinboard\/secrets\//.test(line)) return done(0, "");
    if (/ test -s \/data\/backups\//.test(line)) return s.dumpMissing ? done(1) : done(0);
    // The all-in-one image's own verified dump (kinboard-backup.sh).
    if (/kinboard-backup\.sh/.test(line)) {
      if (s.backupFails) return done(1, "", "[backup] NOT VERIFIED: the dump has only 3 tables (at least 50 expected)\n");
      return done(0, "/data/backups/pre-update-20261127T101500Z.sql.gz\n", "[backup] verified: /data/backups/pre-update-20261127T101500Z.sql.gz (61 tables, 52345 bytes)\n");
    }
    if (/pg_dumpall/.test(line)) {
      const custom = path.join(stubDir(), "dump");
      if (fs.existsSync(custom)) return done(0, fs.readFileSync(custom, "utf8"));
      let o = "CREATE SCHEMA auth;\nCREATE TABLE public.families (\n);\n";
      for (let i = 0; i < 60; i++) o += `CREATE TABLE t${i} ();\n`;
      return done(0, o);
    }
    if (/psql/.test(line)) {
      if (argv.includes("-i")) fs.readFileSync(0);
      for (const a of argv) {
        if (a.startsWith("v=")) fs.writeFileSync(path.join(stubDir(), "status"), a.slice(2));
        if (a.startsWith("k=")) fs.writeFileSync(path.join(stubDir(), "status-key"), a.slice(2));
      }
      return done(0);
    }
    return done(0);
  }
  if (cmd === "run") {
    const line = argv.join(" ");
    fs.appendFileSync(path.join(stubDir(), "runs"), line + "\n");
    if (line.includes("app.kinboard.updater-tick=1")) {
      if (argv.includes("--mount")) {
        if (s.hop === "missing") return done(125, "", 'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /data/compose/3\n');
        return done(Number(s.hopRc || 0));
      }
      // Container mode's sibling: the script itself, with the -e variables
      // the updater gave it. Its own calls change the state: not saved here.
      const env = { ...process.env };
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "-e") {
          const [k, ...v] = argv[++i].split("=");
          env[k] = v.join("=");
        }
      }
      const r = require("node:child_process").spawnSync("sh", [process.env.STUB_SCRIPT, "--tick"], { env, stdio: "inherit" });
      process.exit(r.status === null ? 137 : r.status);
    }
    // The all-in-one image's record of a PostgreSQL major upgrade.
    if (line.includes("/data/config/updater/pg-upgrade")) {
      if (s.pgReadFails) return done(125, "", "docker: Error response from daemon: No such image\n");
      return done(0, s.pgUpgrade ?? "phase=none\n");
    }
    // Unraid's update status, written in place.
    if (line.includes("unraid-update-status")) {
      if (s.unraidStatusMissing) return done(125, "", "docker: Error response from daemon: invalid mount config for type \"bind\": bind source path does not exist\n");
      const env = {};
      for (let i = 0; i < argv.length; i++) if (argv[i] === "-e") { const [k, ...v] = argv[++i].split("="); env[k] = v.join("="); }
      s.unraidStatus = { ...(s.unraidStatus || {}), [env.K]: { local: env.D, remote: env.D, status: "true" } };
      return done(0);
    }
    if (argv.includes("-i")) fs.readFileSync(0);
    if (/grep -vc|wc -l/.test(line)) return done(0, "0\n");
    if (line.includes("config backup:")) return done(0, "files=7\n");
    return done(0);
  }
  return done(0);
}

module.exports = { docker, curl, create, start, load, save, api, parseTemplate, render };

if (require.main === module) {
  const which = process.argv[2];
  const argv = process.argv.slice(3);
  if (which === "docker") docker(argv);
  else curl(argv);
}
