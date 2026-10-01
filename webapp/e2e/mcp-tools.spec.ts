import { test, expect } from "@playwright/test";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createKinboardMcpServer, TOOL_SCOPES } from "../src/lib/mcp/server";
import { IntegrationCallError, type CallOptions, type RouteHandler } from "../src/lib/mcp/call-integration";

/**
 * Tool behaviour (argument shaping, scope gating, error surfacing) tested
 * without a database or an HTTP round trip.
 *
 * The seam is `createKinboardMcpServer`'s third parameter: `callFn`, which
 * defaults to the real `callIntegration` but can be swapped for a stub that
 * records what it was asked to do and returns a canned answer. A registered
 * tool's handler is then reachable at
 * `(server as any)._registeredTools[name].handler` — a plain object property
 * the SDK stores on `McpServer`, not a private field — so it can be invoked
 * directly with the arguments a model would have sent.
 *
 * Later tasks (notes, meal plan, home control, …) should reuse this pattern
 * rather than re-deriving it.
 */

const ORIGIN = "https://kb.example.com";

type RecordedCall = Omit<CallOptions, "origin" | "token">;

function buildServer(scopes: string[], run?: (call: RecordedCall) => unknown) {
  const calls: RecordedCall[] = [];
  const callFn = async (_handler: RouteHandler, opts: CallOptions) => {
    const { origin: _o, token: _t, ...rest } = opts;
    calls.push(rest);
    if (run) return run(rest);
    return { ok: true };
  };
  const authInfo = { token: "kbi_test", clientId: "test-client", scopes } as AuthInfo;
  const server = createKinboardMcpServer(authInfo, ORIGIN, callFn);
  return { server, calls };
}

function tool(server: ReturnType<typeof createKinboardMcpServer>, name: string) {
  return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }> })._registeredTools[name];
}

test.describe("list_people", () => {
  test("reads /people with no arguments and is read-only", async () => {
    const { server, calls } = buildServer(["family:read"], () => ({ people: [{ id: "p1", name: "Mara", color: "#fff", is_child: true }] }));
    const t = tool(server, "list_people");
    expect(t.annotations?.readOnlyHint).toBe(true);
    const result = await t.handler({});
    expect(calls).toEqual([{ path: "/people" }]);
    expect(JSON.parse(result.content[0].text)).toEqual({ people: [{ id: "p1", name: "Mara", color: "#fff", is_child: true }] });
    expect(result.isError).toBeUndefined();
  });
});

test.describe("complete_task", () => {
  test("PATCHes status: completed and is an edit, not a create", async () => {
    const { server, calls } = buildServer(["tasks:write"]);
    const t = tool(server, "complete_task");
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await t.handler({ task_id: "11111111-1111-1111-1111-111111111111" });
    expect(calls).toEqual([{
      path: "/lists/tasks/11111111-1111-1111-1111-111111111111",
      params: { list: "tasks", item: "11111111-1111-1111-1111-111111111111" },
      method: "PATCH",
      body: { status: "completed" },
    }]);
  });

  test("is refused without tasks:write, naming the missing scope", async () => {
    const { server } = buildServer(["family:read"]);
    const result = await tool(server, "complete_task").handler({ task_id: "11111111-1111-1111-1111-111111111111" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("tasks:write");
  });
});

test.describe("reopen_task", () => {
  test("PATCHes status: needs_action", async () => {
    const { server, calls } = buildServer(["tasks:write"]);
    await tool(server, "reopen_task").handler({ task_id: "22222222-2222-2222-2222-222222222222" });
    expect(calls).toEqual([{
      path: "/lists/tasks/22222222-2222-2222-2222-222222222222",
      params: { list: "tasks", item: "22222222-2222-2222-2222-222222222222" },
      method: "PATCH",
      body: { status: "needs_action" },
    }]);
  });

  test("surfaces the route's 409 conflict as a tool error, not a crash", async () => {
    const { server } = buildServer(["tasks:write"], () => {
      throw new IntegrationCallError("recurring tasks can't be reopened", 409, "conflict");
    });
    const result = await tool(server, "reopen_task").handler({ task_id: "22222222-2222-2222-2222-222222222222" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("recurring tasks can't be reopened");
  });
});

test.describe("update_task", () => {
  test("sends only the fields supplied", async () => {
    const { server, calls } = buildServer(["tasks:write"]);
    await tool(server, "update_task").handler({ task_id: "33333333-3333-3333-3333-333333333333", title: "Bins out" });
    expect(calls).toEqual([{
      path: "/lists/tasks/33333333-3333-3333-3333-333333333333",
      params: { list: "tasks", item: "33333333-3333-3333-3333-333333333333" },
      method: "PATCH",
      body: { summary: "Bins out" },
    }]);
  });

  test("an explicit null clears due_date and person_id, distinct from omitting them", async () => {
    const { server, calls } = buildServer(["tasks:write"]);
    await tool(server, "update_task").handler({
      task_id: "33333333-3333-3333-3333-333333333333", due_date: null, person_id: null,
    });
    expect(calls[0].body).toEqual({ due: null, person_id: null });
  });

  test("is an edit annotation, like the other mutating task tools", async () => {
    const { server } = buildServer(["tasks:write"]);
    expect(tool(server, "update_task").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

test.describe("delete_task", () => {
  test("DELETEs with no body, and says it's recoverable", async () => {
    const { server, calls } = buildServer(["tasks:write"]);
    const t = tool(server, "delete_task");
    await t.handler({ task_id: "44444444-4444-4444-4444-444444444444" });
    expect(calls).toEqual([{
      path: "/lists/tasks/44444444-4444-4444-4444-444444444444",
      params: { list: "tasks", item: "44444444-4444-4444-4444-444444444444" },
      method: "DELETE",
    }]);
    expect(t.annotations?.destructiveHint).toBe(true);
  });
});

test("every new tool carries a real scope", () => {
  for (const name of ["list_people", "complete_task", "reopen_task", "update_task", "delete_task"]) {
    expect(TOOL_SCOPES).toHaveProperty(name);
  }
  expect(TOOL_SCOPES.list_people).toBe("family:read");
  expect(TOOL_SCOPES.complete_task).toBe("tasks:write");
  expect(TOOL_SCOPES.reopen_task).toBe("tasks:write");
  expect(TOOL_SCOPES.update_task).toBe("tasks:write");
  expect(TOOL_SCOPES.delete_task).toBe("tasks:write");
});
