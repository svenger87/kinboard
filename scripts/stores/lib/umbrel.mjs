/**
 * Umbrel app store: <id>/umbrel-app.yml and <id>/docker-compose.yml with
 * Umbrel's `app_proxy` (getumbrel/umbrel-apps, its README and
 * .agents/skills/umbrel-package-app/SKILL.md; RFC-024 §5.4).
 *
 * What Umbrel changes about compose.yml's services, each from that guide:
 *
 *   - no container_name: umbrelOS names every container <id>_<service>_1;
 *   - no top-level networks: umbrelOS puts every app on one shared network,
 *     where a bare service name such as `db` can answer from another app's
 *     database. So every host the services use is the injected container
 *     name (<id>_db_1, <id>_rest_1, …), as the store's apps do;
 *   - bind mounts under ${APP_DATA_DIR}/data/<volume>, each committed as an
 *     empty folder (.gitkeep), never named volumes;
 *   - restart: on-failure for the long-running services; the one-shots keep
 *     compose.yml's "no";
 *   - the web UI only through app_proxy, behind Umbrel's login. The app's
 *     API (/api/*) is let through, because the Home Assistant integration
 *     and calendar feeds call it without Umbrel's cookie; the API checks its
 *     own tokens. Only go2rtc's WebRTC port is published, being UDP;
 *   - every image pinned tag@sha256 (index digest), amd64 and arm64.
 */
import { dumpYaml, generatedNotice, links, pinnedImages, volumePath } from "./common.mjs";
import { serviceModel } from "./model.mjs";

/** Umbrel's injected container name for a service. */
export const umbrelHost = (meta, service) => `${meta.slug}_${service}_1`;

export function umbrel(src) {
  const { meta, images: names } = src;
  const images = pinnedImages(meta, names);
  const model = serviceModel(src, { name: "umbrel", images, env: () => undefined });
  const l = links(meta);
  const names_ = Object.keys(model);
  const dbService = names_.find((n) => model[n].kind === "postgres");

  /** http://rest:3000 → http://<id>_rest_1:3000; `db` as a host value → <id>_db_1. */
  const rehost = (key, value) => {
    let v = String(value);
    for (const n of names_) {
      v = v.replace(new RegExp(`^(https?://)${n}(:\\d+)`), `$1${umbrelHost(meta, n)}$2`);
      if (/_HOST$/.test(key) && v === n) v = umbrelHost(meta, n);
    }
    return v;
  };

  const services = {
    app_proxy: {
      environment: {
        APP_HOST: umbrelHost(meta, names_.find((n) => model[n].ports.includes("web"))),
        APP_PORT: meta.ports.web.container,
        PROXY_AUTH_WHITELIST: "/api/*",
      },
    },
  };
  for (const [name, s] of Object.entries(model)) {
    const svc = { image: s.image };
    if (s.entrypoint !== undefined) svc.entrypoint = s.entrypoint;
    if (s.command !== undefined) svc.command = s.command;
    svc.restart = s.oneShot ? "no" : "on-failure";
    if (s.logging) svc.logging = s.logging;
    if (s.healthcheck) svc.healthcheck = s.healthcheck;
    if (Object.keys(s.dependsOn).length) svc.depends_on = s.dependsOn;
    // The web port goes through app_proxy; anything else is published as is.
    const published = s.ports.filter((p) => p !== "web");
    if (published.length) {
      svc.ports = published.map((p) => `${meta.ports[p].host}:${meta.ports[p].container}${meta.ports[p].protocol ? `/${meta.ports[p].protocol}` : ""}`);
    }
    const env = Object.fromEntries(Object.entries(s.environment).map(([k, v]) => [k, rehost(k, v)]));
    // Every service that runs the app's image reaches the database by name.
    if (s.kind === "app") env.POSTGRES_HOST = umbrelHost(meta, dbService);
    if (Object.keys(env).length) svc.environment = env;
    if (s.volumes.length) {
      svc.volumes = s.volumes.map((v) => `${volumePath(meta, "umbrel", v.volume)}:${v.target}${v.readOnly ? ":ro" : ""}`);
    }
    services[name] = svc;
  }

  const description = `${meta.description.long.en}\n\n\n${meta.first_run.en}`;
  const manifest = {
    manifestVersion: 1,
    id: meta.slug,
    category: meta.store_categories.umbrel,
    name: meta.name,
    version: meta.release.version,
    tagline: meta.tagline.en,
    description,
    releaseNotes: "",
    developer: meta.maintainer.name,
    website: l.website,
    dependencies: [],
    repo: l.repo,
    support: l.support,
    port: meta.ports.web.umbrel,
    // Umbrel's team makes the gallery and the icon at review (the guide).
    gallery: [],
    path: "",
    // No default login: the first device creates the family.
    defaultUsername: "",
    defaultPassword: "",
    submitter: meta.maintainer.name,
    // Set to the pull request when the owner submits (RFC-024 §11.1).
    submission: `${l.repo}/blob/main/dist/README.md`,
  };

  const dir = `umbrel/${meta.slug}`;
  const files = {
    [`${dir}/umbrel-app.yml`]: `${generatedNotice(src)}\n${dumpYaml(manifest)}`,
    [`${dir}/docker-compose.yml`]: `${generatedNotice(src)}\n${dumpYaml({ services })}`,
  };
  // Umbrel creates the bind-mount sources from the package's own folders.
  for (const v of new Set(Object.values(model).flatMap((s) => s.volumes.map((x) => x.volume)))) {
    files[`${dir}/data/${v}/.gitkeep`] = "";
  }
  return files;
}
