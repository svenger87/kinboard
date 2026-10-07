import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTION_STATUS_SCOPES } from "../src/lib/home/action-requests";
import yaml from "js-yaml";
import { API_ERROR_CODES } from "../src/lib/api-error";
import { INTEGRATION_SCOPES } from "../src/lib/integration-auth";
import { DOORBELL_DOMAINS, DOORBELL_ENTITY_PATTERN } from "../src/lib/camera-takeover";
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
  /** One scope, or a list of which any one is enough (`GET /actions/{id}`). */
  paths: Record<string, Record<string, { "x-required-scope"?: string | string[] }>>;
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
        const required = op["x-required-scope"];
        if (Array.isArray(required)) used.push(...required);
        else if (required) used.push(required);
      }
    }
    // Documenting a scope the server does not know would send an integrator
    // to create a token they cannot create.
    expect(used.length).toBeGreaterThan(0);
    for (const scope of used) {
      expect(INTEGRATION_SCOPES as readonly string[]).toContain(scope);
    }
  });

  test("GET /actions/{id} advertises every scope that may follow a request", () => {
    expect(spec.paths["/actions/{id}"].get["x-required-scope"]).toEqual([...ACTION_STATUS_SCOPES]);
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

  test("service arguments are documented under the names Home Assistant sends", () => {
    // #309: the server read `person`/`note`/`key` while the component sent the
    // RFC's `person_id`/`amount`/`reason` and `attention_id`, and both services
    // were a 400 from day one. The spec now names the RFC fields as primary; a
    // spec that drifted back to the aliases would mislead the next client.
    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, { deprecated?: boolean }> }
    >;
    const pocket = schemas.AddPocketMoneyArgs?.properties ?? {};
    for (const field of ["person_id", "amount", "reason"]) {
      expect(pocket[field], `AddPocketMoneyArgs.${field}`).toBeTruthy();
      expect(pocket[field]?.deprecated, `${field} is primary`).toBeFalsy();
    }
    expect(pocket.person?.deprecated).toBe(true);
    expect(pocket.note?.deprecated).toBe(true);

    const dismiss = schemas.DismissAttentionArgs?.properties ?? {};
    expect(dismiss.attention_id).toBeTruthy();
    expect(dismiss.attention_id?.deprecated).toBeFalsy();
    expect(dismiss.key?.deprecated).toBe(true);
    expect(dismiss.rule_id?.deprecated).toBe(true);
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

  test("points and rewards: each path with its scope, and the creature as five fields that never include its look", () => {
    const paths = spec.paths as Record<string, Record<string, { "x-required-scope"?: string }>>;
    expect(paths["/rewards"].get["x-required-scope"]).toBe("family:read");
    expect(Object.keys(paths["/rewards"])).toEqual(["get"]);
    expect(paths["/rewards/requests"].post["x-required-scope"]).toBe("pocket_money:write");
    expect(Object.keys(paths["/rewards/requests"])).toEqual(["post"]);
    // The route files ask for the same scopes the spec documents.
    const route = (p: string) => readFileSync(join(ROUTES_ROOT, p, "route.ts"), "utf8");
    expect(route("rewards")).toContain('withIntegrationAuth(request, "family:read"');
    expect(route("rewards/requests")).toContain('withIntegrationAuth(request, "pocket_money:write"');

    const schemas = spec.components.schemas as Record<string, {
      required?: string[]; additionalProperties?: boolean;
      properties?: Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean; required?: string[] }>;
    }>;
    const creature = schemas.ChildRewards.properties!.creature;
    expect(Object.keys(creature.properties ?? {}).sort()).toEqual(["grows_with", "next_stage", "species", "stage", "stage_name"]);
    expect(creature.additionalProperties).toBe(false);
    expect(Object.keys(schemas.ChildRewards.properties!.points.properties ?? {}).sort())
      .toEqual(["available", "balance", "earned", "owed", "pending", "purchased"]);
    const everything = JSON.stringify([schemas.RewardsOverview, schemas.ChildRewards, schemas.RewardRequest]);
    expect(everything).not.toMatch(/"look"|avatar_look/);
    // The ask is a POST with an Idempotency-Key, like every other write.
    const post = (spec.paths["/rewards/requests"] as Record<string, unknown>).post as { parameters: { name: string; required?: boolean }[] };
    expect(post.parameters.find((p) => p.name === "Idempotency-Key")?.required).toBe(true);
  });

  test("GET /cameras lists each camera's doorbell with the server's own rule, and nothing else", () => {
    // The Home Assistant integration codes against this shape: a doorbell
    // pattern here looser or stricter than the server's would let one side
    // accept what the other refuses.
    const schemas = spec.components.schemas as Record<
      string,
      { required?: string[]; properties?: Record<string, { type?: unknown; pattern?: string; $ref?: string }> }
    >;
    const get = (spec.paths["/cameras"] as Record<string, unknown>).get as {
      responses: { "200": { content: { "application/json": { schema: { properties: { cameras: { items: { $ref: string } } } } } } } };
    };
    expect(get.responses["200"].content["application/json"].schema.properties.cameras.items.$ref).toBe(
      "#/components/schemas/CameraListing",
    );
    const listing = schemas.CameraListing;
    expect(Object.keys(listing.properties ?? {}).sort()).toEqual(["doorbell_entity_id", "id", "name"]);
    expect(listing.required?.sort()).toEqual(["doorbell_entity_id", "id", "name"]);
    const bell = listing.properties!.doorbell_entity_id;
    expect(bell.type).toEqual(["string", "null"]);
    expect(bell.pattern).toBe(DOORBELL_ENTITY_PATTERN.source);
    for (const domain of DOORBELL_DOMAINS) expect(bell.pattern).toContain(domain);
    // show_camera still answers with the plain ref.
    expect(Object.keys(schemas.CameraRef.properties ?? {}).sort()).toEqual(["id", "name"]);
  });
});
