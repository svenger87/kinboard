import { test, expect } from "@playwright/test";
import {
  INTEGRATION_SCOPES,
  TOKEN_PREFIX,
  bearerFrom,
  evaluateToken,
  generateIntegrationToken,
  hasScope,
  hashIntegrationToken,
  hashesEqual,
  isIntegrationScope,
  requireIntegrationAuth,
  shouldRefreshLastUsed,
} from "../src/lib/integration-auth";

/**
 * Pure logic — no browser, no database. The rules live in small functions
 * precisely so they can be tested like this; a scope check that can only be
 * exercised by booting a stack is a scope check nobody re-tests after changing
 * it.
 *
 * RFC-001 §10 requires the negative case to be *proved*: a token scoped
 * `shopping:write` must be shown unable to create a task. That is the last
 * describe block.
 */

const NOW = new Date("2026-08-08T12:00:00Z");

function row(over: Partial<Parameters<typeof evaluateToken>[0]> = {}) {
  const hash = hashIntegrationToken("kbi_example");
  return {
    id: "tok-1",
    family_id: "fam-1",
    name: "Home Assistant",
    scopes: ["family:read"],
    token_hash: hash,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    oauth_client_id: null,
    ...over,
  };
}

test.describe("token minting", () => {
  test("carries the prefix, so it is recognisable and scannable", () => {
    const { token } = generateIntegrationToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    // Long enough that guessing is not a strategy.
    expect(token.length).toBeGreaterThan(40);
  });

  test("is base64url — survives a header, a YAML file and a copy-paste", () => {
    for (let i = 0; i < 20; i++) {
      const { token } = generateIntegrationToken();
      expect(token.slice(TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("the hash matches the token, and never equals it", () => {
    const { token, hash } = generateIntegrationToken();
    expect(hash).toBe(hashIntegrationToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateIntegrationToken().token));
    expect(seen.size).toBe(500);
  });
});

test.describe("bearer parsing", () => {
  const req = (headers: Record<string, string>) =>
    ({ headers: new Headers(headers) }) as unknown as Parameters<typeof bearerFrom>[0];

  test("accepts the shapes people actually send", () => {
    expect(bearerFrom(req({ authorization: "Bearer kbi_abc" }))).toBe("kbi_abc");
    expect(bearerFrom(req({ authorization: "bearer kbi_abc" }))).toBe("kbi_abc");
    expect(bearerFrom(req({ authorization: "  Bearer   kbi_abc  " }))).toBe("kbi_abc");
  });

  test("returns null rather than throwing on anything else", () => {
    // Unauthenticated, not "bad request" — which of the two it was is free
    // information about the endpoint.
    expect(bearerFrom(req({}))).toBeNull();
    expect(bearerFrom(req({ authorization: "" }))).toBeNull();
    expect(bearerFrom(req({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerFrom(req({ authorization: "Bearer" }))).toBeNull();
    expect(bearerFrom(req({ authorization: "Bearer   " }))).toBeNull();
  });
});

test.describe("hash comparison", () => {
  test("matches identical digests and rejects different ones", () => {
    const a = hashIntegrationToken("one");
    const b = hashIntegrationToken("two");
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, b)).toBe(false);
  });

  test("rejects mismatched or empty input instead of throwing", () => {
    // timingSafeEqual throws on length mismatch; that must never reach a route.
    expect(hashesEqual("abcd", "")).toBe(false);
    expect(hashesEqual("", "")).toBe(false);
    expect(hashesEqual("abcd", "abcdef")).toBe(false);
  });
});

test.describe("token evaluation", () => {
  const hash = hashIntegrationToken("kbi_example");

  test("accepts a live token", () => {
    expect(evaluateToken(row(), hash, NOW).ok).toBe(true);
  });

  test("rejects an unknown token", () => {
    const r = evaluateToken(null, hash, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("unknown");
  });

  test("rejects a revoked token", () => {
    const r = evaluateToken(row({ revoked_at: "2026-08-01T00:00:00Z" }), hash, NOW);
    expect(r.ok === false && r.reason).toBe("revoked");
  });

  test("rejects an expired token, and accepts one expiring later", () => {
    expect(evaluateToken(row({ expires_at: "2026-08-07T00:00:00Z" }), hash, NOW).ok).toBe(false);
    expect(evaluateToken(row({ expires_at: "2026-08-09T00:00:00Z" }), hash, NOW).ok).toBe(true);
  });

  test("treats expiry as inclusive — a token expiring now is spent", () => {
    expect(evaluateToken(row({ expires_at: NOW.toISOString() }), hash, NOW).ok).toBe(false);
  });

  test("rejects a row whose stored hash does not match what was presented", () => {
    // Guards against a lookup that matched on something other than the hash.
    const r = evaluateToken(row({ token_hash: hashIntegrationToken("different") }), hash, NOW);
    expect(r.ok === false && r.reason).toBe("unknown");
  });
});

test.describe("last_used_at is a heartbeat, not an access log", () => {
  test("writes when never used", () => {
    expect(shouldRefreshLastUsed(null, NOW)).toBe(true);
  });

  test("does not write again within the hour", () => {
    expect(shouldRefreshLastUsed("2026-08-08T11:30:00Z", NOW)).toBe(false);
  });

  test("writes once the hour has passed", () => {
    expect(shouldRefreshLastUsed("2026-08-08T10:30:00Z", NOW)).toBe(true);
  });
});

test.describe("scopes", () => {
  test("the list matches RFC-001 §4 and the HA component's const.py, plus the assistant scopes", () => {
    expect([...INTEGRATION_SCOPES].sort()).toEqual(
      [
        "announcements:write",
        "birthdays:write",
        "calendar:write",
        "energy:read",
        "events:read",
        "family:read",
        "home:control",
        "home:read",
        "meals:write",
        "notes:read",
        "notes:write",
        "pocket_money:write",
        "shopping:write",
        "tasks:write",
        "timers:write",
        "vehicles:read",
      ].sort(),
    );
  });

  test("rejects anything not on the list, including near-misses", () => {
    expect(isIntegrationScope("family:read")).toBe(true);
    expect(isIntegrationScope("family:write")).toBe(false);
    expect(isIntegrationScope("shopping:read")).toBe(false);
    expect(isIntegrationScope("*")).toBe(false);
    expect(isIntegrationScope("")).toBe(false);
  });

  test("grants exactly what is listed", () => {
    expect(hasScope(["shopping:write"], "shopping:write")).toBe(true);
    expect(hasScope([], "family:read")).toBe(false);
  });

  test("no scope implies another", () => {
    // A hierarchy is convenient until someone has to answer "what can this
    // token do?" from the list in Settings. Write does not imply read.
    expect(hasScope(["tasks:write"], "family:read")).toBe(false);
    expect(hasScope(["family:read"], "tasks:write")).toBe(false);
    // And nothing is a wildcard.
    expect(hasScope(["*"], "tasks:write")).toBe(false);
  });
});

/**
 * RFC-001 §10, stated as an acceptance criterion:
 *
 *   "A write service cannot act outside its scopes." — a token scoped
 *   shopping:write must be PROVED unable to create a task.
 */
test.describe("a token cannot act outside its scopes", () => {
  const shoppingOnly = ["shopping:write"];

  test("shopping:write can add a shopping item", () => {
    expect(hasScope(shoppingOnly, "shopping:write")).toBe(true);
  });

  test("shopping:write CANNOT create a task", () => {
    expect(hasScope(shoppingOnly, "tasks:write")).toBe(false);
  });

  test("shopping:write CANNOT create a note or an announcement", () => {
    expect(hasScope(shoppingOnly, "notes:write")).toBe(false);
    expect(hasScope(shoppingOnly, "announcements:write")).toBe(false);
  });

  test("shopping:write CANNOT read the family", () => {
    expect(hasScope(shoppingOnly, "family:read")).toBe(false);
  });

  test("an unrecognised scope in the database grants nothing", () => {
    // Rows are filtered through isIntegrationScope before this check, so a
    // stale or typo'd value cannot become an accidental grant.
    const stored = ["tasks:writ", "TASKS:WRITE", "tasks:write "];
    const usable = stored.filter(isIntegrationScope);
    expect(usable).toEqual([]);
    expect(hasScope(usable, "tasks:write")).toBe(false);
  });
});

/**
 * lib/integration-limits.ts' edit/delete budget applies only to assistant
 * (OAuth-issued) connections — a manually created token like Home Assistant
 * or Bridge must never be limited. `context.assistant` is the one place that
 * distinction is decided, from `oauth_client_id` on the token row.
 */
test.describe("requireIntegrationAuth sets context.assistant from oauth_client_id", () => {
  const authReq = () =>
    ({ headers: new Headers({ authorization: "Bearer kbi_example" }) }) as unknown as Parameters<
      typeof requireIntegrationAuth
    >[0];

  test("a manually created token (no oauth_client_id) is not an assistant", async () => {
    const result = await requireIntegrationAuth(
      authReq(),
      "family:read",
      async () => row({ oauth_client_id: null }),
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.context.assistant).toBe(false);
  });

  test("an OAuth-issued token (has oauth_client_id) is an assistant", async () => {
    const result = await requireIntegrationAuth(
      authReq(),
      "family:read",
      async () => row({ oauth_client_id: "https://claude.ai/meta" }),
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.context.assistant).toBe(true);
  });
});

/**
 * A route several features share takes a list of scopes, any one of which is
 * enough (`GET /actions/{id}`: home:control or pocket_money:write).
 */
test.describe("requireIntegrationAuth with a list of scopes", () => {
  const authReq = () =>
    ({ headers: new Headers({ authorization: "Bearer kbi_example" }) }) as unknown as Parameters<
      typeof requireIntegrationAuth
    >[0];
  const anyOf = ["home:control", "pocket_money:write"] as const;

  for (const scopes of [["home:control"], ["pocket_money:write"], ["family:read", "pocket_money:write"]]) {
    test(`${scopes.join(" + ")} is enough`, async () => {
      const result = await requireIntegrationAuth(authReq(), anyOf, async () => row({ scopes }), NOW);
      expect(result.ok).toBe(true);
    });
  }

  test("none of them is a 401, and an empty list admits nobody", async () => {
    const without = await requireIntegrationAuth(authReq(), anyOf, async () => row({ scopes: ["home:read", "family:read"] }), NOW);
    expect(without.ok).toBe(false);
    expect(!without.ok && without.response.status).toBe(401);
    const empty = await requireIntegrationAuth(authReq(), [], async () => row({ scopes: ["home:control"] }), NOW);
    expect(empty.ok).toBe(false);
  });
});
