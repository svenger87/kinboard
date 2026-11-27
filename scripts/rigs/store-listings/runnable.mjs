#!/usr/bin/env node
/**
 * The compose file a store would run, made runnable on this machine for the
 * rehearsal (scripts/rigs/test-store-listings.sh). Every change is the rig's,
 * never the store's, and each is printed:
 *
 *   - the store's data root (CasaOS /DATA/AppData/<app>, TrueNAS's test
 *     volumes) moves into the rig's own folder;
 *   - the published web and WebRTC ports move to the rig's ports;
 *   - PostgREST is published on loopback, for the row-level-security
 *     matrix's service-role checks (no listing publishes it);
 *   - the webapp's session rate limit is raised, because the specs create
 *     and join many families from one address (as CI's do);
 *   - Umbrel: what umbrelOS itself does to the file before it starts it,
 *     as its packaging guide describes: every container named
 *     <app>_<service>_1, and the app on a network shared with other apps
 *     (the rig's, with a decoy answering to `db` and `rest`). app_proxy is
 *     not a container in umbrelOS 2.0; the rig publishes the web port
 *     instead, where app_proxy would have routed.
 *
 *   node runnable.mjs <store> <in> <out> <json options>
 *     options: { dataRoot, data, webPort, restPort, webrtcPort, slug, network }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const yaml = createRequire(join(ROOT, "webapp", "package.json"))("js-yaml");

export function runnable(store, doc, o) {
  const changes = [];
  const services = doc.services;
  const webService = Object.keys(services).find((n) => (services[n].ports ?? []).some((p) => String(p.target ?? p).endsWith("3000")))
    ?? "webapp";
  if (store === "umbrel") {
    delete services.app_proxy;
    changes.push("app_proxy removed (umbrelOS 2.0 runs no such container; the web port is published instead)");
    for (const [name, s] of Object.entries(services)) s.container_name = `${o.slug}_${name}_1`;
    changes.push(`every container named ${o.slug}_<service>_1, as umbrelOS names them`);
    doc.networks = { default: { name: o.network, external: true } };
    changes.push(`default network: ${o.network} (external, shared with a decoy)`);
  }
  for (const [name, s] of Object.entries(services)) {
    // Data roots into the rig's folder.
    s.volumes = (s.volumes ?? []).map((v) => {
      if (typeof v === "object" && typeof v.source === "string" && o.dataRoot && v.source.startsWith(o.dataRoot)) {
        return { ...v, source: v.source.replace(o.dataRoot, o.data) };
      }
      if (typeof v === "string" && o.dataRoot && v.startsWith(o.dataRoot)) return v.replace(o.dataRoot, o.data);
      return v;
    });
    // Ports.
    const ports = [];
    for (const p of s.ports ?? []) {
      const target = Number(typeof p === "object" ? p.target : String(p).split(":").pop().split("/")[0]);
      const protocol = typeof p === "object" ? p.protocol ?? "tcp" : (String(p).split("/")[1] ?? "tcp");
      const hostIp = typeof p === "object" ? p.host_ip : undefined;
      if (hostIp === "::") continue; // TrueNAS binds v4 and v6; one is enough here
      const published = protocol === "udp" ? o.webrtcPort : o.webPort;
      ports.push(`127.0.0.1:${published}:${target}/${protocol}`);
    }
    if (name === "rest") ports.push(`127.0.0.1:${o.restPort}:3000/tcp`);
    if (store === "umbrel" && name === webService) ports.push(`127.0.0.1:${o.webPort}:3000/tcp`);
    if (ports.length) s.ports = ports; else delete s.ports;
    if (name === webService) {
      if (Array.isArray(s.environment)) s.environment.push("SESSION_RATE_LIMIT_PER_MINUTE=1000");
      else s.environment = { ...(s.environment ?? {}), SESSION_RATE_LIMIT_PER_MINUTE: "1000" };
    }
  }
  if (o.dataRoot) changes.push(`data root ${o.dataRoot} → ${o.data}`);
  changes.push(`ports on loopback: web ${o.webPort}, rest ${o.restPort}, webrtc ${o.webrtcPort}/udp`);
  changes.push(`${webService}: SESSION_RATE_LIMIT_PER_MINUTE=1000`);
  return { doc, changes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [store, input, output, opts] = process.argv.slice(2);
  const { doc, changes } = runnable(store, yaml.load(readFileSync(input, "utf8")), JSON.parse(opts));
  writeFileSync(output, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
  for (const c of changes) process.stdout.write(`     rig change: ${c}\n`);
}
