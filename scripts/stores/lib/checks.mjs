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
 *   volumes    every mount compose.yml has, at the same target and mode,
 *              from where its store keeps data (CasaOS /DATA/AppData/…,
 *              Umbrel ${APP_DATA_DIR}/data/… with its folder committed,
 *              TrueNAS its storage questions, Portainer compose.yml's)
 *   env        every variable compose.yml gives a service (as a new store
 *              install resolves it) is there, with its value
 *   metadata   each listing's name, tagline and descriptions are the
 *              metadata's, in every language the store takes
 */
import { CASA_LOCALE, links, pinnedImages, splitRef, volumePath } from "./common.mjs";
import { interpolate, serviceModel } from "./model.mjs";
import { yaml } from "./sources.mjs";
import { umbrelHost } from "./umbrel.mjs";

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
  // compose.yml's services as a new store install resolves them.
  const expected = serviceModel(src, { images: { app: "app", postgres: "postgres", other: (r) => r }, env: () => undefined });
  const dbName = Object.keys(expected).find((n) => expected[n].kind === "postgres");

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
    // The same services as compose.yml (Umbrel adds its app_proxy).
    const names_ = Object.keys(services).filter((n) => !(store === "umbrel" && n === "app_proxy"));
    for (const n of Object.keys(expected)) if (!names_.includes(n)) p.push(`${where}: service ${n} of compose.yml is missing`);
    for (const n of names_) if (!expected[n]) p.push(`${where}: service ${n} is not one of compose.yml's`);

    for (const [name, exp] of Object.entries(expected)) {
      const s = services[name];
      if (!s) continue;
      // ---- images
      const image = store === "portainer" ? interpolate(s.image ?? "", () => undefined) : String(s.image ?? "");
      const repo = image.replace(/@.*$/, "").replace(/:[^:/]*$/, "");
      if (exp.kind === "app" && repo !== names.app) p.push(`${where}: ${name} runs ${repo}, not docker.yml's ${names.app}`);
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
        if (!m) { p.push(`${where}: ${name} does not mount ${v.volume} at ${v.target}`); continue; }
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
        if (/docker\.sock/.test(m.source)) p.push(`${where}: ${name} mounts the Docker socket`);
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
    const t = pt.templates?.[0] ?? {};
    if (t.title !== meta.name) p.push("portainer: title differs from the metadata");
    if (t.description !== meta.description.short) p.push("portainer: description differs from the metadata");
    for (const tpl of pt.templates ?? []) {
      if (tpl.repository?.url !== l.repo) p.push(`portainer: template ${tpl.id} points at ${tpl.repository?.url}, not ${l.repo}`);
      if (!(tpl.repository?.stackfile?.replace(/^dist\//, "") in files)) p.push(`portainer: template ${tpl.id}'s stackfile ${tpl.repository?.stackfile} is not generated`);
    }
  }
  return p;
}
