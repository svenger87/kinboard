import { test, expect } from "@playwright/test";
import {
  isCimdClientId, parseClientMetadataDocument, parseRegistrationRequest, resolveClient, readBoundedJson, clientCacheSize,
  admitDcrRegistration, DCR_HOURLY_CAP, DCR_UNUSED_TTL_MS,
} from "../src/lib/oauth/clients";
import { sweepUnusedDcrClients, USED_DCR_IDS_LIMIT } from "../src/lib/oauth/store";

const URL_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";

test.describe("CIMD", () => {
  test("a client id is an https URL with a path", () => {
    expect(isCimdClientId(URL_ID)).toBe(true);
    expect(isCimdClientId("https://claude.ai/")).toBe(false);
    expect(isCimdClientId("http://claude.ai/x")).toBe(false);
    expect(isCimdClientId("kbclient_abc")).toBe(false);
  });
  test("the document must name itself and list acceptable redirects", () => {
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }))
      .toEqual({ clientId: URL_ID, clientName: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], kind: "cimd" });
    expect(parseClientMetadataDocument(URL_ID, { client_id: "https://evil.example/x", redirect_uris: ["https://a.example/cb"] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, redirect_uris: ["http://192.168.1.2/cb"] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, "not json")).toBeNull();
  });
  test("a missing name falls back to the host, a long one is cut", () => {
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, redirect_uris: ["https://claude.ai/cb"] })?.clientName).toBe("claude.ai");
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, client_name: "x".repeat(300), redirect_uris: ["https://claude.ai/cb"] })?.clientName).toHaveLength(100);
  });
});

test.describe("DCR request", () => {
  test("accepts a public client with acceptable redirects", () => {
    expect(parseRegistrationRequest({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none" }))
      .toEqual({ ok: true, clientName: "ChatGPT", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] });
  });
  test("refuses missing or unacceptable redirects", () => {
    expect(parseRegistrationRequest({ client_name: "x" })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistrationRequest({ redirect_uris: ["http://10.0.0.1/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistrationRequest(null)).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });
});

test.describe("resolveClient", () => {
  const doc = { client_id: URL_ID, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
  test("fetches a CIMD client once and caches it", async () => {
    let fetches = 0;
    const deps = { fetchDocument: async () => { fetches++; return doc; }, findRegistered: async () => null };
    expect((await resolveClient(URL_ID, deps, 1_000))?.clientName).toBe("Claude");
    expect((await resolveClient(URL_ID, deps, 2_000))?.clientName).toBe("Claude");
    expect(fetches).toBe(1);
    await resolveClient(URL_ID, deps, 1_000 + 11 * 60_000);
    expect(fetches).toBe(2);
  });
  test("a failed fetch is no client, not an exception", async () => {
    const deps = { fetchDocument: async () => { throw new Error("blocked"); }, findRegistered: async () => null };
    expect(await resolveClient("https://other.example/meta", deps)).toBeNull();
  });
  test("a non-URL id is looked up as a registered client", async () => {
    const deps = { fetchDocument: async () => { throw new Error("unused"); }, findRegistered: async (id: string) => id === "kbclient_x" ? { clientId: id, clientName: "ChatGPT", redirectUris: [], kind: "dcr" as const } : null };
    expect((await resolveClient("kbclient_x", deps))?.clientName).toBe("ChatGPT");
    expect(await resolveClient("kbclient_y", deps)).toBeNull();
  });
  test("cache never exceeds 100 entries when resolving 150 distinct CIMD ids", async () => {
    const deps = {
      fetchDocument: async (url: string) => ({ client_id: url, redirect_uris: ["https://example.com/cb"] }),
      findRegistered: async () => null,
    };
    for (let i = 0; i < 150; i++) {
      const clientId = `https://example.com/client-${i}`;
      await resolveClient(clientId, deps, 1_000);
      expect(clientCacheSize()).toBeLessThanOrEqual(100);
    }
  });
});

test.describe("readBoundedJson", () => {
  test("parses a small JSON body", async () => {
    const body = JSON.stringify({ ok: true });
    const response = new Response(body);
    const result = await readBoundedJson(response, 1024);
    expect(result).toEqual({ ok: true });
  });
  test("rejects a body exceeding maxBytes", async () => {
    const body = "x".repeat(2048);
    const response = new Response(body);
    await expect(readBoundedJson(response, 1024)).rejects.toThrow("too large");
  });
  test("rejects a content-length header exceeding maxBytes without reading", async () => {
    const response = new Response(null, { headers: { "content-length": "2048" } });
    await expect(readBoundedJson(response, 1024)).rejects.toThrow("too large");
  });
  test("rejects a body with lying small content-length but large stream", async () => {
    const largeBody = "x".repeat(2048);
    const response = new Response(largeBody, { headers: { "content-length": "10" } });
    await expect(readBoundedJson(response, 1024)).rejects.toThrow("too large");
  });
  test("rejects null body", async () => {
    const response = new Response(null);
    await expect(readBoundedJson(response, 1024)).rejects.toThrow("no response body");
  });
});

test.describe("DCR admission (install-wide cap and sweep)", () => {
  const NOW = Date.parse("2026-10-01T12:00:00Z");

  test("admits under the hourly cap and refuses at it, counting from one hour back", async () => {
    const since: string[] = [];
    const deps = (count: number) => ({
      countSince: async (iso: string) => { since.push(iso); return count; },
      sweepUnused: async () => {},
    });
    expect(await admitDcrRegistration(deps(DCR_HOURLY_CAP - 1), NOW)).toBe(true);
    expect(await admitDcrRegistration(deps(DCR_HOURLY_CAP), NOW)).toBe(false);
    expect(since[0]).toBe("2026-10-01T11:00:00.000Z");
  });

  test("sweeps clients older than a week, and a failed sweep does not block registration", async () => {
    const swept: string[] = [];
    expect(await admitDcrRegistration({ countSince: async () => 0, sweepUnused: async (iso) => { swept.push(iso); } }, NOW)).toBe(true);
    expect(swept).toEqual([new Date(NOW - DCR_UNUSED_TTL_MS).toISOString()]);
    expect(await admitDcrRegistration({ countSince: async () => 0, sweepUnused: async () => { throw new Error("db down"); } }, NOW)).toBe(true);
  });

  test("a count that cannot be read refuses rather than guessing", async () => {
    await expect(admitDcrRegistration({ countSince: async () => { throw new Error("db down"); }, sweepUnused: async () => {} }, NOW)).rejects.toThrow("db down");
  });
});

test.describe("the unused-client sweep never deletes on a partial exclusion list", () => {
  /** A stand-in for the admin client: answers the used-ids read, records the candidate read and the delete. */
  function fakeDb(used: { rows: number; count: number | null }) {
    const log: string[] = [];
    const chain = (table: string, result: () => unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "like", "limit", "lt", "not", "order", "in", "delete"]) {
        c[m] = (...args: unknown[]) => {
          log.push(`${table}.${m}${m === "limit" ? `(${String(args[0])})` : ""}`);
          return c;
        };
      }
      c.then = (resolve: (v: unknown) => void) => resolve(result());
      return c;
    };
    return {
      log,
      from(table: string) {
        if (table === "integration_tokens") {
          return chain(table, () => ({
            data: Array.from({ length: used.rows }, (_, i) => ({ oauth_client_id: `kbc_used${i}` })),
            error: null,
            count: used.count,
          }));
        }
        return chain(table, () => ({ data: [{ client_id: "kbc_old" }], error: null }));
      },
    };
  }

  test("a complete list: the read is bounded, and unused old clients are deleted", async () => {
    const db = fakeDb({ rows: 3, count: 3 });
    await sweepUnusedDcrClients("2026-10-01T00:00:00Z", db);
    expect(db.log).toContain(`integration_tokens.limit(${USED_DCR_IDS_LIMIT})`);
    expect(db.log).toContain("oauth_clients.delete");
  });

  for (const [label, used] of [
    ["the count reaches the limit", { rows: USED_DCR_IDS_LIMIT, count: USED_DCR_IDS_LIMIT }],
    ["more exist than came back (a max-rows cap)", { rows: 1000, count: 1500 }],
    ["no count at all", { rows: 3, count: null }],
  ] as const) {
    test(`skipped entirely when ${label}`, async () => {
      const db = fakeDb(used);
      await sweepUnusedDcrClients("2026-10-01T00:00:00Z", db);
      expect(db.log.some((l) => l.startsWith("oauth_clients."))).toBe(false);
    });
  }
});
