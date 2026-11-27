/**
 * Our own checks over the generated listings, on top of each store's linter
 * (validate-upstream.sh). They read the listings back the way a store would,
 * not the generator's intermediate state, so a listing edited by hand, or a
 * generator that drifts from compose.yml or the metadata, fails here:
 *
 *   images     the app's services run docker.yml's app image; the database
 *              runs docker.yml's stock PostgreSQL image (safeupdate), never
 *              supabase/postgres, a plain postgres image or TrueNAS's
 *              postgres helper; the pinned stores pin every image by digest,
 *              the release's
 *   secrets    no secret value anywhere: no token, key or password literal;
 *              a secret's variable is empty, absent, or a path to a file
 *   updater    the Docker-socket updater only where the metadata keeps it
 *              (Portainer), under compose.yml's profile, with the
 *              template's switch off by default: the socket is mounted only
 *              once the household switches it on, and in no other store
 *   volumes    every mount compose.yml has, at the same target and mode,
 *              from where its store keeps data (CasaOS /DATA/AppData/…,
 *              Umbrel ${APP_DATA_DIR}/data/… with its folder committed,
 *              TrueNAS its storage questions, Portainer compose.yml's)
 *   env        every variable compose.yml gives a service (as a new store
 *              install resolves it) is there, with its value
 *   metadata   each listing's name, tagline and descriptions are the
 *              metadata's, in every language the store takes
 *   unraid     the template read back as CA documents it (a well-formed
 *              `<Container version="2">`; Name and Repository; Category, Icon,
 *              Overview, Project, Support, TemplateURL; every Config with the
 *              starter template's attributes and values in their allowed
 *              sets); the image docker.yml's all-in-one image on one of its
 *              channel tags, Beta exactly while there is no stable one; the
 *              web port and the one /data path; PUID/PGID Unraid's; the stop
 *              timeout above PostgreSQL's shutdown window; ca_profile.xml
 *              with a Profile
 */
import { CASA_LOCALE, links, pinnedImages, splitRef, volumePath } from "./common.mjs";
import { DOCKER_SOCKET, interpolate, serviceModel } from "./model.mjs";
import { parseXml, yaml } from "./sources.mjs";
import { umbrelHost } from "./umbrel.mjs";
import { aioEnv, unraidRepo } from "./unraid.mjs";

const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|PRIVATE|_KEY|_KEYS)$/;

/** A listing's services, read back: image, environment, mounts. */
function composeView(text) {
  const doc = yaml.load(text);
  const services = {};
  for (const [name, s] of Object.entries(doc?.services ?? {})) {
    const env = Array.isArray(s.environment)
      ? Object.fromEntries(s.environment.map((e) => String(e).split(/=(.*)/s).slice(0, 2)))
      : { ...(s.environment ?? {}) };
    const mounts = (s.volumes ?? []).map((v) => {
      if (typeof v === "object") return { source: v.source, target: v.target, readOnly: Boolean(v.read_only), long: true };
      const parts = String(v).match(/^(\$\{[^}]*\}|[^:]+):([^:]+)(?::(ro|rw))?$/);
      return parts ? { source: parts[1], target: parts[2], readOnly: parts[3] === "ro", long: false } : { source: String(v), target: "?", readOnly: false };
    });
    services[name] = { image: s.image, env, mounts, raw: s };
  }
  return { doc, services };
}

/** The TrueNAS template, read back from its library calls. */
function truenasView(template, ixValues) {
  const images = yaml.load(ixValues)?.images ?? {};
  const services = {};
  const byVar = {};
  for (const m of template.matchAll(/\{% set (\w+) = tpl\.add_container\("([^"]+)", "([^"]+)"\) %\}/g)) {
    const img = images[m[3]];
    services[m[2]] = { image: img ? `${img.repository}:${img.tag}` : `missing image key ${m[3]}`, env: {}, mounts: [], helperPostgres: false };
    byVar[m[1]] = services[m[2]];
  }
  for (const m of template.matchAll(/\{% do (\w+)\.environment\.add_env\("([^"]+)", (.+?)\) %\}/g)) {
    if (byVar[m[1]]) byVar[m[1]].env[m[2]] = m[3].startsWith('"') ? JSON.parse(m[3]) : `{{${m[3]}}}`;
  }
  for (const m of template.matchAll(/\{% do (\w+)\.add_storage\("([^"]+)", (.+?)\) %\}/g)) {
    const vol = /values\.storage\.(\w+)/.exec(m[3])?.[1];
    if (byVar[m[1]]) byVar[m[1]].mounts.push({ source: vol ? `storage.${vol}` : m[3], target: m[2], readOnly: /"read_only": true/.test(m[3]) });
  }
  return { services, usesPostgresHelper: /tpl\.deps\.postgres\(/.test(template) };
}

/**
 * Every problem with the generated listings, as sentences.
 * @param {Record<string, string>} files  by path under dist/
 * @param {ReturnType<typeof import("./sources.mjs").loadSources>} src
 */
export function listingProblems(files, src) {
  const { meta, images: names } = src;
  const p = [];
  const slug = meta.slug;
  const pinned = pinnedImages(meta, names);
  const l = links(meta);
  // compose.yml's services as a new install from each store resolves them.
  const expectedFor = (store) => serviceModel(src, { name: store, images: { app: "app", postgres: "postgres", other: (r) => r }, env: () => undefined });
  const updaterRef = src.compose[`x-${slug}-updater-image`];
  const dbName = Object.entries(expectedFor("casaos")).find(([, s]) => s.kind === "postgres")?.[0];

  const read = (path) => {
    if (!(path in files)) { p.push(`${path}: missing`); return null; }
    return files[path];
  };
  const listings = {};
  const casaPath = `casaos/Apps/${meta.name}/docker-compose.yml`;
  const umbrelDir = `umbrel/${slug}`;
  const tnDir = `truenas/ix-dev/community/${slug}`;
  if (read(casaPath) !== null) listings.casaos = composeView(files[casaPath]);
  if (read(`${umbrelDir}/docker-compose.yml`) !== null) listings.umbrel = composeView(files[`${umbrelDir}/docker-compose.yml`]);
  if (read("portainer/compose.yml") !== null) listings.portainer = composeView(files["portainer/compose.yml"]);
  if (read(`${tnDir}/templates/docker-compose.yaml`) !== null && read(`${tnDir}/ix_values.yaml`) !== null) {
    listings.truenas = truenasView(files[`${tnDir}/templates/docker-compose.yaml`], files[`${tnDir}/ix_values.yaml`]);
  }

  for (const [store, view] of Object.entries(listings)) {
    const where = `${store}`;
    const services = view.services;
    const expected = expectedFor(store);
    // The same services as compose.yml (Umbrel adds its app_proxy).
    const names_ = Object.keys(services).filter((n) => !(store === "umbrel" && n === "app_proxy"));
    for (const n of Object.keys(expected)) if (!names_.includes(n)) p.push(`${where}: service ${n} of compose.yml is missing`);
    for (const n of names_) {
      if (expected[n]) continue;
      const why = meta.omit_services?.[n]?.[store];
      p.push(why ? `${where}: service ${n} is left out of this store (${why})` : `${where}: service ${n} is not one of compose.yml's`);
    }

    for (const [name, exp] of Object.entries(expected)) {
      const s = services[name];
      if (!s) continue;
      // ---- images
      const image = store === "portainer" ? interpolate(s.image ?? "", () => undefined) : String(s.image ?? "");
      const repo = image.replace(/@.*$/, "").replace(/:[^:/]*$/, "");
      if (exp.kind === "app" && repo !== names.app) p.push(`${where}: ${name} runs ${repo}, not docker.yml's ${names.app}`);
      if (updaterRef && exp.image === updaterRef && repo !== names.updater) p.push(`${where}: ${name} runs ${repo}, not docker.yml's ${names.updater}`);
      // ---- opt-in: the same profiles as compose.yml, so it stays off until switched on
      const got = s.raw?.profiles ?? [];
      if (store !== "truenas" && JSON.stringify(got) !== JSON.stringify(exp.profiles)) {
        p.push(`${where}: ${name} has the profiles ${JSON.stringify(got)}, compose.yml ${JSON.stringify(exp.profiles)}${exp.profiles.length ? ": it would start without being switched on" : ""}`);
      }
      if (exp.kind === "postgres" && repo !== names.postgres) {
        p.push(`${where}: the database runs ${repo}, not the stock PostgreSQL image with safeupdate (${names.postgres})`);
      }
      if (store !== "portainer") {
        const want = exp.kind === "app" ? pinned.app : exp.kind === "postgres" ? pinned.postgres : (() => { try { return pinned.other(exp.image); } catch { return null; } })();
        if (!/@sha256:[0-9a-f]{64}$/.test(image)) p.push(`${where}: ${name}'s image ${image} is not pinned by digest`);
        else if (want && image !== want) p.push(`${where}: ${name} runs ${image}, not the release's ${want}`);
      }
      // ---- volumes: the same mounts as compose.yml, from the store's place
      for (const v of exp.volumes) {
        const m = s.mounts.find((x) => x.target === v.target);
        if (!m) { p.push(`${where}: ${name} does not mount ${v.socket ? "the Docker socket" : v.volume} at ${v.target}`); continue; }
        if (v.socket) {
          if (m.source !== DOCKER_SOCKET) p.push(`${where}: ${name} mounts ${m.source} at ${v.target}, not the Docker socket`);
          continue;
        }
        if (m.readOnly !== v.readOnly) p.push(`${where}: ${name} mounts ${v.target} ${m.readOnly ? "read-only" : "writable"}, compose.yml ${v.readOnly ? "read-only" : "writable"}`);
        const want = store === "casaos" ? volumePath(meta, "casaos", v.volume)
          : store === "umbrel" ? volumePath(meta, "umbrel", v.volume)
          : store === "truenas" ? `storage.${v.volume}`
          : null;
        if (want && m.source !== want) p.push(`${where}: ${name} mounts ${m.source} at ${v.target}, not ${want}`);
        if (store === "portainer" && !new RegExp(`^\\$\\{[A-Z0-9_]+:-${slug}-${v.volume}\\}$`).test(m.source)) {
          p.push(`${where}: ${name} mounts ${m.source} at ${v.target}, not compose.yml's ${slug}-${v.volume} volume`);
        }
        if (store === "umbrel" && !(`${umbrelDir}/data/${v.volume}/.gitkeep` in files)) p.push(`umbrel: data/${v.volume}/ is not committed (.gitkeep)`);
      }
      for (const m of s.mounts) {
        if (!exp.volumes.some((v) => v.target === m.target)) p.push(`${where}: ${name} mounts ${m.source} at ${m.target}, which compose.yml doesn't`);
        if (/docker\.sock/.test(m.source) && !(exp.volumes.some((v) => v.socket && v.target === m.target) && got.length > 0)) {
          p.push(`${where}: ${name} mounts the Docker socket`);
        }
        if (store === "casaos" && !String(m.source).startsWith(volumePath(meta, "casaos", ""))) p.push(`casaos: ${name} mounts ${m.source}, outside ${volumePath(meta, "casaos", "")}`);
        if (store === "umbrel" && (m.long || !String(m.source).startsWith("${APP_DATA_DIR}/data/"))) p.push(`umbrel: ${name} mounts ${m.source}; Umbrel wants short-syntax binds under \${APP_DATA_DIR}/data/`);
      }
      // ---- env: every variable compose.yml gives the service, as resolved
      const rawEnv = src.compose.services[name]?.environment ?? {};
      for (const [k, v] of Object.entries(store === "portainer" ? rawEnv : exp.environment)) {
        const auto = store === "truenas" && ["TZ", "PUID", "PGID"].includes(k);
        if (auto) continue;
        if (!(k in s.env)) { p.push(`${where}: ${name} lacks ${k}, which compose.yml sets`); continue; }
        let want = String(v);
        if (store === "umbrel") {
          for (const n of Object.keys(expected)) {
            want = want.replace(new RegExp(`^(https?://)${n}(:\\d+)`), `$1${umbrelHost(meta, n)}$2`);
            if (/_HOST$/.test(k) && want === n) want = umbrelHost(meta, n);
          }
        }
        const got = String(s.env[k]);
        if (store === "truenas" && got.startsWith("{{")) {
          if (got !== `{{values.${slug.replace(/-/g, "_")}.${k.toLowerCase()}}}` && !(k in meta.env)) p.push(`truenas: ${name}.${k} reads ${got}`);
        } else if (got !== want) {
          p.push(`${where}: ${name}.${k} is ${JSON.stringify(got)}, compose.yml resolves it to ${JSON.stringify(want)}`);
        }
      }
      if (store === "umbrel" && exp.kind === "app" && s.env.POSTGRES_HOST !== umbrelHost(meta, dbName)) {
        p.push(`umbrel: ${name} must reach the database as ${umbrelHost(meta, dbName)} (shared network), not ${s.env.POSTGRES_HOST}`);
      }
    }
    if (view.usesPostgresHelper) p.push("truenas: the template uses tpl.deps.postgres, whose stock postgres image can't load safeupdate");
  }

  // ---- secrets, in every generated file
  for (const [path, text] of Object.entries(files)) {
    const stripped = text.replace(/sha256:[0-9a-f]{64}/g, "");
    if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(stripped)) p.push(`${path}: carries a JWT`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(stripped)) p.push(`${path}: carries a private key`);
    if (/(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i.test(stripped.replace(/lib_version_hash: [0-9a-f]{64}/, ""))) p.push(`${path}: carries a long hex string (a secret?)`);
    if (/postgres(ql)?:\/\/[^:\s"']+:[^@\s"']+@/.test(stripped)) p.push(`${path}: carries a database URL with a password`);
  }
  for (const [store, view] of Object.entries(listings)) {
    for (const [name, s] of Object.entries(view.services)) {
      for (const [k, v] of Object.entries(s.env)) {
        const val = String(v ?? "");
        if (!SECRET_KEY.test(k) || val === "" || val.startsWith("{{")) continue;
        if (store === "portainer" && /^\$\{[A-Z0-9_]+:-\}$/.test(val)) continue;
        if (/^@?\//.test(val)) continue; // a path to a file in the secrets store
        p.push(`${store}: ${name}.${k} carries a value; secrets come from the init step, never the listing`);
      }
    }
  }

  // ---- texts: the metadata's, everywhere
  if (listings.casaos) {
    const x = listings.casaos.doc["x-casaos"] ?? {};
    for (const [loc, key] of Object.entries(CASA_LOCALE)) {
      if (x.title?.[key] !== meta.name) p.push(`casaos: title.${key} is not the metadata's name`);
      if (x.tagline?.[key] !== meta.tagline[loc]) p.push(`casaos: tagline.${key} differs from the metadata`);
      if (x.description?.[key] !== meta.description.long[loc]) p.push(`casaos: description.${key} differs from the metadata`);
      if (x.tips?.before_install?.[key] !== meta.first_run[loc]) p.push(`casaos: tips.before_install.${key} differs from the metadata`);
    }
    if (x.category !== meta.store_categories.casaos) p.push("casaos: category differs from the metadata");
    if (x.version !== meta.release.version) p.push("casaos: version is not the release's");
    if (x.id !== meta.id) p.push("casaos: id differs from the metadata");
  }
  const um = files[`${umbrelDir}/umbrel-app.yml`] ? yaml.load(files[`${umbrelDir}/umbrel-app.yml`]) : null;
  if (um) {
    if (um.name !== meta.name) p.push("umbrel: name differs from the metadata");
    if (um.tagline !== meta.tagline.en) p.push("umbrel: tagline differs from the metadata");
    if (!String(um.description).startsWith(meta.description.long.en)) p.push("umbrel: description differs from the metadata");
    if (um.version !== meta.release.version) p.push("umbrel: version is not the release's");
    if (um.port !== meta.ports.web.umbrel) p.push("umbrel: port differs from the metadata");
    if (um.id !== slug) p.push("umbrel: id differs from the metadata's slug");
  }
  const tnApp = files[`${tnDir}/app.yaml`] ? yaml.load(files[`${tnDir}/app.yaml`]) : null;
  if (tnApp) {
    if (tnApp.title !== meta.name) p.push("truenas: title differs from the metadata");
    if (tnApp.description !== meta.description.short) p.push("truenas: description differs from the metadata");
    const readme = files[`${tnDir}/README.md`] ?? "";
    const flat = (s) => s.replace(/\s+/g, " ").trim();
    if (!flat(readme).includes(flat(meta.description.long.en))) p.push("truenas: README.md lacks the metadata's description");
    if (tnApp.app_version !== splitRef(pinned.app).tag.split("@")[0]) p.push("truenas: app_version is not the release's tag");
  }
  const pt = files["portainer/templates.json"] ? JSON.parse(files["portainer/templates.json"]) : null;
  if (pt) {
    // The switch for the opt-in profiles: there exactly when the stack has
    // them, every profile among its choices, and off unless chosen.
    const stackProfiles = [...new Set(Object.values(listings.portainer?.services ?? {}).flatMap((x) => x.raw?.profiles ?? []))];
    // (stack templates only: the all-in-one template is one container, no profiles)
    for (const tpl of (pt.templates ?? []).filter((x) => x.type === 3)) {
      const f = (tpl.env ?? []).find((e) => e.name === "COMPOSE_PROFILES");
      if (!stackProfiles.length) { if (f) p.push(`portainer: template ${tpl.id} offers COMPOSE_PROFILES, and the stack has no profile`); continue; }
      if (!f) { p.push(`portainer: template ${tpl.id} has no switch for ${stackProfiles.join(", ")} (COMPOSE_PROFILES)`); continue; }
      const choices = f.select ?? [];
      const def = choices.filter((o) => o.default);
      if (f.default !== undefined || f.preset || def.length !== 1 || def[0].value !== "") {
        p.push(`portainer: template ${tpl.id}'s COMPOSE_PROFILES is not off by default`);
      }
      for (const pr of stackProfiles) if (!choices.some((o) => o.value === pr)) p.push(`portainer: template ${tpl.id}'s COMPOSE_PROFILES can't switch on ${pr}`);
      for (const o of choices) if (o.value !== "" && !stackProfiles.includes(o.value)) p.push(`portainer: template ${tpl.id}'s COMPOSE_PROFILES offers ${o.value}, no profile of the stack`);
      const o = src.meta.opt_in?.[stackProfiles[0]];
      if (o && (f.label !== o.label || f.description !== o.description)) p.push(`portainer: template ${tpl.id}'s COMPOSE_PROFILES label or description differs from the metadata`);
    }
    const t = pt.templates?.[0] ?? {};
    if (t.title !== meta.name) p.push("portainer: title differs from the metadata");
    if (t.description !== meta.description.short) p.push("portainer: description differs from the metadata");
    for (const tpl of (pt.templates ?? []).filter((x) => x.type !== 1)) {
      if (tpl.repository?.url !== l.repo) p.push(`portainer: template ${tpl.id} points at ${tpl.repository?.url}, not ${l.repo}`);
      if (!(tpl.repository?.stackfile?.replace(/^dist\//, "") in files)) p.push(`portainer: template ${tpl.id}'s stackfile ${tpl.repository?.stackfile} is not generated`);
    }
  }
  if (pt) {
    const aio = (pt.templates ?? []).find((t) => t.type === 1);
    if (!aio) p.push("portainer: no single-container template for the all-in-one image");
    else p.push(...aioImageProblems("portainer", aio.image, src));
    if (aio && !(aio.volumes ?? []).some((v) => v.container === meta.aio.data)) p.push(`portainer: the all-in-one template has no ${meta.aio.data} volume`);
  }
  const uPath = `unraid/${unraidRepo(meta).file}`;
  if (read(uPath) !== null) p.push(...unraidProblems(files[uPath], files["unraid/ca_profile.xml"], src));
  return p;
}

/** The all-in-one image reference: docker.yml's name, on one of its channel tags. */
function aioImageProblems(where, image, src) {
  const { images, channels } = src;
  const p = [];
  const m = /^(.*):([^:/@]+)$/.exec(String(image ?? ""));
  if (!m) return [`${where}: the all-in-one image ${image} has no tag`];
  if (m[1] !== images.aio) p.push(`${where}: runs ${m[1]}, not docker.yml's all-in-one image ${images.aio}`);
  const want = channels.aio.stable ?? channels.aio.next;
  if (m[2] !== want) p.push(`${where}: the all-in-one image's tag is ${m[2]}, docker.yml's ${channels.aio.stable ? "stable" : "only"} channel is ${want}`);
  return p;
}

const CA_CONFIG_ATTRS = ["Name", "Target", "Default", "Description", "Type", "Display", "Required", "Mask"];
const CA_ALLOWED = {
  Type: ["Port", "Path", "Variable", "Label", "Device"],
  Display: ["always", "always-hide", "advanced", "advanced-hide"],
  Required: ["true", "false"],
  Mask: ["true", "false"],
};

/**
 * The Unraid template and profile, read back as CA documents them.
 * @param {string} xml
 * @param {string | undefined} profileXml
 */
export function unraidProblems(xml, profileXml, src) {
  const { meta, channels } = src;
  const p = [];
  const at = "unraid";
  let doc;
  try { doc = parseXml(xml); } catch (err) { return [`${at}: the template is ${err.message}`]; }
  const root = doc.documentElement;
  if (root.tagName !== "Container" || root.getAttribute("version") !== "2") p.push(`${at}: the root is not <Container version="2">`);
  const one = (tag) => {
    const els = [...root.children].filter((e) => e.tagName === tag);
    if (els.length > 1) p.push(`${at}: <${tag}> appears ${els.length} times`);
    return els[0]?.textContent ?? null;
  };
  for (const tag of ["Name", "Repository", "Category", "Icon", "Overview", "Project", "Support", "TemplateURL", "WebUI", "Network"]) {
    if (!one(tag)?.trim()) p.push(`${at}: <${tag}> is missing or empty`);
  }
  if (one("Name") !== meta.name) p.push(`${at}: Name is not the metadata's`);
  p.push(...aioImageProblems(at, one("Repository"), src));
  const beta = one("Beta");
  if (!channels.aio.stable && beta !== "true") p.push(`${at}: no stable all-in-one channel yet, so <Beta>true</Beta> is required`);
  if (channels.aio.stable && beta !== null) p.push(`${at}: <Beta> on a stable channel`);
  if (one("TemplateURL") !== unraidRepo(meta).templateUrl) p.push(`${at}: TemplateURL is not the template repository's raw URL`);
  if (!String(one("Overview") ?? "").includes(meta.description.long.en)) p.push(`${at}: Overview lacks the metadata's description`);
  if (!String(one("Overview") ?? "").includes(meta.aio.note.en)) p.push(`${at}: Overview lacks the all-in-one note (go2rtc is not included)`);
  if (one("Category") !== meta.aio.unraid.category) p.push(`${at}: Category differs from the metadata`);
  if (one("License") !== meta.license) p.push(`${at}: License is not the metadata's`);
  if (!/^https:\/\//.test(one("Icon") ?? "")) p.push(`${at}: Icon is not an https URL`);
  const webui = /^http:\/\/\[IP\]:\[PORT:(\d+)\]\/?$/.exec(one("WebUI") ?? "");
  if (!webui || Number(webui[1]) !== meta.ports.web.container) p.push(`${at}: WebUI must be http://[IP]:[PORT:${meta.ports.web.container}] (the container port)`);
  const stop = /--stop-timeout=(\d+)/.exec(one("ExtraParams") ?? "");
  if (!stop || Number(stop[1]) < 45) p.push(`${at}: ExtraParams must set --stop-timeout above PostgreSQL's 30 s shutdown window`);
  if (/[;&|`$]/.test(one("ExtraParams") ?? "")) p.push(`${at}: ExtraParams carries a shell character (CA blacklists chained commands)`);

  const configs = [...root.children].filter((e) => e.tagName === "Config");
  for (const c of configs) {
    const name = c.getAttribute("Name") ?? "?";
    for (const a of CA_CONFIG_ATTRS) if (!c.hasAttribute(a)) p.push(`${at}: Config ${name} lacks ${a}`);
    for (const [a, allowed] of Object.entries(CA_ALLOWED)) {
      if (c.hasAttribute(a) && !allowed.includes(c.getAttribute(a))) p.push(`${at}: Config ${name}: ${a}="${c.getAttribute(a)}" is not one of ${allowed.join(", ")}`);
    }
    const type = c.getAttribute("Type");
    if (type === "Port" && !["tcp", "udp"].includes(c.getAttribute("Mode") ?? "")) p.push(`${at}: Config ${name}: a port's Mode is tcp or udp`);
    if (type === "Path" && !["rw", "ro", "rw,slave", "ro,slave", "rw,shared", "ro,shared"].includes(c.getAttribute("Mode") ?? "")) p.push(`${at}: Config ${name}: a path's Mode is rw or ro`);
    if (c.textContent !== c.getAttribute("Default")) p.push(`${at}: Config ${name}: its value differs from its Default`);
    if (/(PASSWORD|SECRET|TOKEN|_KEY)$/.test(c.getAttribute("Target") ?? "") && c.getAttribute("Mask") !== "true") p.push(`${at}: Config ${name} is a secret and not masked`);
  }
  const byTarget = (t) => configs.find((c) => c.getAttribute("Target") === t);
  const port = configs.find((c) => c.getAttribute("Type") === "Port" && c.getAttribute("Target") === String(meta.ports.web.container));
  if (!port) p.push(`${at}: no Port config for ${meta.ports.web.container}`);
  const paths = configs.filter((c) => c.getAttribute("Type") === "Path");
  if (paths.length !== 1 || paths[0].getAttribute("Target") !== meta.aio.data) p.push(`${at}: exactly one Path, at ${meta.aio.data} (the all-in-one image keeps everything there)`);
  const wantData = meta.aio.unraid.data_path.replaceAll("{slug}", meta.slug);
  if (paths[0] && paths[0].getAttribute("Default") !== wantData) p.push(`${at}: the data path defaults to ${paths[0].getAttribute("Default")}, not ${wantData}`);
  if (byTarget("PUID")?.getAttribute("Default") !== meta.aio.unraid.puid || byTarget("PGID")?.getAttribute("Default") !== meta.aio.unraid.pgid) {
    p.push(`${at}: PUID/PGID must default to Unraid's ${meta.aio.unraid.puid}:${meta.aio.unraid.pgid}`);
  }
  for (const name of Object.keys(aioEnv(meta))) if (!byTarget(name)) p.push(`${at}: the variable ${name} is not offered`);
  for (const name of meta.aio.env_exclude ?? []) if (byTarget(name)) p.push(`${at}: offers ${name}, which the all-in-one image does not read`);

  if (profileXml === undefined) p.push(`${at}: ca_profile.xml is missing`);
  else {
    try {
      const prof = parseXml(profileXml).documentElement;
      if (prof.tagName !== "CommunityApplications") p.push(`${at}: ca_profile.xml's root is not <CommunityApplications>`);
      const profile = [...prof.children].find((e) => e.tagName === "Profile");
      if (!profile?.textContent?.trim()) p.push(`${at}: ca_profile.xml has no Profile (CA requires a non-empty one)`);
    } catch (err) {
      p.push(`${at}: ca_profile.xml is ${err.message}`);
    }
  }
  return p;
}
