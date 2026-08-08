import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { API_ERROR_CODES } from "../src/lib/api-error";
import { INTEGRATION_SCOPES } from "../src/lib/integration-auth";
import {
  DEFERRED_SERVICES,
  IMPLEMENTED_SERVICES,
} from "../src/app/api/integration/v1/services/[service]/route";

/**
 * The OpenAPI spec, checked against the code.
 *
 * RFC-001 §11.1 decided the Home Assistant component ships from its own
 * repository. The counter-argument was drift, and the answer given was this
 * spec plus contract tests — the component pins a version and validates
 * against it, so drift fails a build rather than a household. The Bridge will
 * be a third consumer and cannot live in either repository, so the contract
 * has to stand alone regardless.
 *
 * That promise is only worth anything if the spec matches the server. A spec
 * nobody checks is a spec that is wrong, usually within a month. So this file
 * asserts the two agree in every direction that can be checked without a
 * running instance.
 */

const SPEC_PATH = join(__dirname, "..", "openapi", "integration-v1.yaml");
const ROUTES_ROOT = join(__dirname, "..", "src", "app", "api", "integration", "v1");

interface Spec {
  paths: Record<string, Record<string, { "x-required-scope"?: string }>>;
  components: {
    schemas: Record<
      string,
      { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
    >;
  };
}

const spec = yaml.load(readFileSync(SPEC_PATH, "utf8")) as Spec;

/** Route files on disk, as OpenAPI-style paths: `/services/{service}`. */
function routePaths(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Next's [param] is OpenAPI's {param}.
        const segment = entry.startsWith("[") ? `{${entry.slice(1, -1)}}` : entry;
        walk(full, `${prefix}/${segment}`);
      } else if (entry === "route.ts") {
        found.push(prefix === "" ? "/" : prefix);
      }
    }
  };
  walk(ROUTES_ROOT, "");
  return found.sort();
}

test.describe("every route is documented and every document is a route", () => {
  test("the spec parses and is version 1", () => {
    // If this ever fails the rest is meaningless, so it is checked first.
    expect(spec.paths).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  test("paths match the routes on disk exactly", () => {
    // Both directions. A route missing from the spec is an undocumented
    // surface a consumer cannot use; a spec path with no route is a promise
    // that 404s.
    expect(routePaths()).toEqual(Object.keys(spec.paths).sort());
  });
});

test.describe("the enums match the server's own lists", () => {
  test("Scope matches INTEGRATION_SCOPES", () => {
    const documented = spec.components.schemas.Scope.enum ?? [];
    expect([...documented].sort()).toEqual([...INTEGRATION_SCOPES].sort());
  });

  test("every x-required-scope is a real scope", () => {
    const used: string[] = [];
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        if (op["x-required-scope"]) used.push(op["x-required-scope"]);
      }
    }
    // Documenting a scope the server does not know would send an integrator
    // to create a token they cannot create.
    expect(used.length).toBeGreaterThan(0);
    for (const scope of used) {
      expect(INTEGRATION_SCOPES as readonly string[]).toContain(scope);
    }
  });

  test("ServiceName covers what the server implements and defers, and nothing else", () => {
    const documented = spec.components.schemas.ServiceName.enum ?? [];
    const actual = [...IMPLEMENTED_SERVICES, ...DEFERRED_SERVICES];
    expect([...documented].sort()).toEqual([...actual].sort());
  });

  test("the error codes the spec lists are the codes the server can send", () => {
    const documented = new Set(spec.components.schemas.Error.properties?.code?.enum ?? []);
    for (const code of API_ERROR_CODES) {
      expect(documented.has(code), `\`${code}\` is missing from the spec`).toBe(true);
    }
    // not_implemented is sent by the services route directly rather than
    // through apiError, so it is expected in the spec but not in the array.
    expect(documented.has("not_implemented")).toBe(true);
  });

  test("EventType matches the events the triggers actually emit", () => {
    // Read from the migration rather than a hand-kept list: the triggers are
    // the only thing that decides what an event type is, and a spec listing an
    // event nothing emits is a promise no automation will ever see fulfilled.
    const migration = readFileSync(
      join(__dirname, "..", "docker", "migration_zzy_domain_events.sql"),
      "utf8",
    );
    const emitted = new Set([...migration.matchAll(/'(kinboard_[a-z_]+)'/g)].map((m) => m[1]));
    const documented = new Set(spec.components.schemas.EventType.enum ?? []);

    // Everything emitted must be documented. The reverse is deliberately not
    // asserted: the contract names seven events, and two of them wait on
    // features that do not exist yet (announcements, context).
    for (const type of emitted) {
      expect(documented.has(type), `${type} is emitted but not in the spec`).toBe(true);
    }
    expect(emitted.size).toBeGreaterThanOrEqual(5);
  });
});

test.describe("the spec says the things a consumer has to get right", () => {
  test("writes require an Idempotency-Key, and it is marked required", () => {
    const post = (spec.paths["/services/{service}"] as Record<string, unknown>).post as {
      parameters: { name: string; required?: boolean }[];
    };
    const key = post.parameters.find((p) => p.name === "Idempotency-Key");
    expect(key, "Idempotency-Key must be documented").toBeTruthy();
    expect(key?.required).toBe(true);
  });

  test("the events endpoint documents its limit ceiling", () => {
    // A consumer that does not know the cap will believe it received
    // everything when it received 200 of 5,000.
    const get = (spec.paths["/events"] as Record<string, unknown>).get as {
      parameters: { name: string; schema?: { maximum?: number } }[];
    };
    const limit = get.parameters.find((p) => p.name === "limit");
    expect(limit?.schema?.maximum).toBe(200);
  });
});
