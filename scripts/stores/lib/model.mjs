/**
 * compose.yml, read as the services a store listing runs.
 *
 * The listings don't restate what runs: each one is compose.yml's services
 * with four changes, so a command, health check or variable added there
 * reaches every store at the next generation, and CI says so until it does:
 *
 *   1. the database runs the stock PostgreSQL image with safeupdate
 *      (docker.yml's POSTGRES_IMAGE_NAME), never supabase/postgres and never a
 *      store's own postgres helper, which can't load the library
 *      (RFC-024 §4.2.1, §4.5, §5.2);
 *   2. the services in the metadata's `omit_services` are left out (the
 *      Docker-socket updater: every store updates its own way);
 *   3. `${VAR:-default}` becomes a value: the store's own setting for the
 *      variables the metadata offers, compose.yml's default for the rest, and
 *      gone when that default is empty (the secrets an existing install would
 *      carry across; a store install is always new);
 *   4. volumes and ports become logical ({volume: "db", target, readOnly},
 *      {port: "web"}), for each store to place.
 */

/** `${VAR}`, `${VAR:-default}`, `${VAR-default}`; `$$` is compose's literal `$`. */
const VAR = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}/g;

/**
 * The variable names a compose string reads.
 * @param {string} s
 */
export function variablesIn(s) {
  return [...String(s).matchAll(VAR)].filter((m) => m[0] !== "$$").map((m) => m[1]);
}

/**
 * Interpolates like compose does. `lookup(name)` returns a value or
 * undefined (unset). `$$` is kept as is: the result is still a compose value.
 * @param {string} s
 * @param {(name: string) => string | undefined} lookup
 */
export function interpolate(s, lookup) {
  return String(s).replace(VAR, (all, name, op, def) => {
    if (all === "$$") return all;
    const v = lookup(name);
    if (op === ":-") return v === undefined || v === "" ? def : v;
    if (op === "-") return v === undefined ? def : v;
    return v ?? "";
  });
}

/** A compose volume entry's parts: "src:target[:ro]". */
function splitVolume(entry) {
  const parts = String(entry).split(":");
  // A source may itself be `${X:-y}`, whose `:-` would split; rejoin it.
  const joined = [];
  for (const part of parts) {
    const last = joined[joined.length - 1];
    if (last !== undefined && (last.match(/\$\{/g)?.length ?? 0) > (last.match(/\}/g)?.length ?? 0)) {
      joined[joined.length - 1] = `${last}:${part}`;
    } else {
      joined.push(part);
    }
  }
  const [source, target, mode] = joined;
  return { source, target, readOnly: mode === "ro" };
}

/**
 * The logical model of compose.yml's services for one store.
 *
 * @param {ReturnType<typeof import("./sources.mjs").loadSources>} src
 * @param {{
 *   images: { app: string, postgres: string, other: (ref: string) => string },
 *   env: (name: string) => string | undefined,
 * }} store
 *   images: the full reference for each kind of image;
 *   env:    the store's value for a variable the metadata offers, or
 *           undefined for compose.yml's default.
 */
export function serviceModel(src, store) {
  const { meta, compose } = src;
  const slug = meta.slug;
  const appImage = compose[`x-${slug}-image`];
  if (typeof appImage !== "string") throw new Error(`compose.yml has no x-${slug}-image`);
  const services = compose.services ?? {};
  const volumeNames = Object.fromEntries(
    Object.entries(compose.volumes ?? {}).map(([key, v]) => [key, v?.name ?? key]),
  );
  const logicalVolume = (source) => {
    // `${<SLUG>_DB_DIR:-<slug>-db}` → its default names the volume.
    const m = /^\$\{[A-Za-z0-9_]+:-([^}]+)\}$/.exec(source) ?? [null, source];
    const name = volumeNames[m[1]] ?? m[1];
    if (!name.startsWith(`${slug}-`)) return null;
    const id = name.slice(slug.length + 1);
    return meta.volumes[id] ? id : null;
  };
  const offered = new Set(Object.keys(meta.env));
  const lookup = (name) => (offered.has(name) ? store.env(name) ?? meta.env[name].default : undefined);

  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, svc] of Object.entries(services)) {
    if (meta.omit_services && name in meta.omit_services) continue;
    if (svc.profiles) throw new Error(`compose.yml service ${name} has profiles; list it in omit_services or drop the profile`);
    let kind;
    let image;
    if (svc.image === appImage) {
      kind = "app";
      image = store.images.app;
    } else if (name === "db") {
      kind = "postgres";
      image = store.images.postgres;
    } else {
      kind = "other";
      image = store.images.other(svc.image);
    }
    const environment = {};
    for (const [k, v] of Object.entries(svc.environment ?? {})) {
      const reads = variablesIn(v);
      const value = interpolate(v, lookup);
      // A variable the store doesn't offer, whose compose.yml default is
      // empty: unset, as compose.yml leaves it for a new install.
      if (value === "" && reads.length > 0 && reads.every((r) => !offered.has(r))) continue;
      environment[k] = value;
    }
    const volumes = (svc.volumes ?? []).map((entry) => {
      const { source, target, readOnly } = splitVolume(entry);
      const volume = logicalVolume(source);
      if (!volume) throw new Error(`compose.yml service ${name}: volume ${entry} is not one of the metadata's volumes`);
      return { volume, target, readOnly };
    });
    const ports = (svc.ports ?? []).map((entry) => {
      const m = /:(\d+)(?:\/(tcp|udp))?$/.exec(String(entry));
      if (!m) throw new Error(`compose.yml service ${name}: port ${entry} not understood`);
      const container = Number(m[1]);
      const protocol = m[2] ?? "tcp";
      const port = Object.keys(meta.ports).find((p) => meta.ports[p].container === container && (meta.ports[p].protocol ?? "tcp") === protocol);
      if (!port) throw new Error(`compose.yml service ${name}: port ${entry} is not one of the metadata's ports`);
      return port;
    });
    const dependsOn = Object.fromEntries(
      Object.entries(svc.depends_on ?? {}).filter(([dep]) => !(meta.omit_services && dep in meta.omit_services)),
    );
    out[name] = {
      kind,
      image,
      entrypoint: svc.entrypoint,
      command: svc.command,
      restart: svc.restart,
      healthcheck: svc.healthcheck,
      logging: svc.logging,
      dependsOn,
      environment,
      volumes,
      ports,
      containerName: svc.container_name,
      oneShot: svc.restart === "no",
    };
  }
  if (!Object.values(out).some((s) => s.kind === "postgres")) throw new Error("compose.yml has no `db` service");
  return out;
}

/** Compose's `$$` back to `$`, for a store whose tooling escapes it itself. */
export const unescapeDollar = (s) => String(s).replaceAll("$$", "$");
