/**
 * CasaOS / ZimaOS app store: Apps/<Name>/docker-compose.yml with a top-level
 * `x-casaos` block (IceWhaleTech/CasaOS-AppStore,
 * docs/specs/compose-and-x-casaos.md; RFC-024 §5.3).
 *
 * Literal values throughout: CasaOS's import drops `${VAR:-default}`, and the
 * household edits the variables in CasaOS's own settings dialog. Images are
 * pinned by digest, and the listing's `version` changes with each release,
 * which is what offers the update.
 */
import { CASA_LOCALE, dumpYaml, generatedNotice, links, pinnedImages, rawUrl, volumePath } from "./common.mjs";
import { serviceModel } from "./model.mjs";

const localized = (obj) => Object.fromEntries(Object.entries(obj).map(([l, v]) => [CASA_LOCALE[l], v]));

export function casaos(src) {
  const { meta, images: names } = src;
  const images = pinnedImages(meta, names);
  const model = serviceModel(src, { name: "casaos", images, env: () => undefined });
  const l = links(meta);
  const web = meta.ports.web;

  const services = {};
  for (const [name, s] of Object.entries(model)) {
    const svc = { image: s.image };
    if (s.containerName) svc.container_name = s.containerName;
    if (s.entrypoint !== undefined) svc.entrypoint = s.entrypoint;
    if (s.command !== undefined) svc.command = s.command;
    if (s.restart !== undefined) svc.restart = s.restart;
    if (s.logging) svc.logging = s.logging;
    if (s.healthcheck) svc.healthcheck = s.healthcheck;
    if (Object.keys(s.dependsOn).length) svc.depends_on = s.dependsOn;
    if (s.ports.length) {
      svc.ports = s.ports.map((p) => ({
        target: meta.ports[p].container,
        published: String(meta.ports[p].host),
        protocol: meta.ports[p].protocol ?? "tcp",
      }));
    }
    if (Object.keys(s.environment).length) svc.environment = s.environment;
    if (s.volumes.length) {
      svc.volumes = s.volumes.map((v) => ({
        type: "bind",
        source: volumePath(meta, "casaos", v.volume),
        target: v.target,
        ...(v.readOnly ? { read_only: true } : {}),
      }));
    }
    svc.networks = [meta.slug];
    services[name] = svc;
  }

  const main = Object.keys(model).find((n) => model[n].ports.includes("web"));
  const doc = {
    name: meta.slug,
    services,
    networks: { [meta.slug]: {} },
    "x-casaos": {
      id: meta.id,
      main,
      index: "/",
      port_map: String(web.host),
      scheme: "http",
      icon: rawUrl(meta, meta.icon.svg),
      title: Object.fromEntries(Object.values(CASA_LOCALE).map((loc) => [loc, meta.name])),
      tagline: localized(meta.tagline),
      description: localized(meta.description.long),
      tips: { before_install: localized(meta.first_run) },
      screenshot_link: meta.screenshots.map((p) => rawUrl(meta, p)),
      author: meta.maintainer.name,
      developer: meta.maintainer.name,
      category: meta.store_categories.casaos,
      architectures: ["amd64", "arm64"],
      version: meta.release.version,
      website: l.website,
      repo: l.repo,
      support: l.support,
      docs: l.docs,
    },
  };
  const dir = `casaos/Apps/${meta.name}`;
  return { [`${dir}/docker-compose.yml`]: `${generatedNotice(src)}\n${dumpYaml(doc)}` };
}
