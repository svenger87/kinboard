import { test, expect } from "@playwright/test";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createKinboardMcpServer, registeredTools, TOOL_SCOPES } from "../src/lib/mcp/server";
import { IntegrationCallError, type CallOptions, type RouteHandler } from "../src/lib/mcp/call-integration";

/**
 * Tool behaviour (argument shaping, scope gating, error surfacing) tested
 * without a database or an HTTP round trip.
 *
 * The seam is `createKinboardMcpServer`'s third parameter: `callFn`, which
 * defaults to the real `callIntegration` but can be swapped for a stub that
 * records what it was asked to do and returns a canned answer. A registered
 * tool's handler is then reachable through `registeredTools(server)[name]` —
 * the public `RegisteredTool` (with `.handler` and `.annotations`)
 * `server.registerTool(...)` itself returns, not the SDK's own private
 * per-tool registry — so it can be invoked directly with the arguments a
 * model would have sent.
 *
 * Later tasks (meal plan, home control, …) should reuse this pattern rather
 * than re-deriving it.
 */

const ORIGIN = "https://kb.example.com";

type RecordedCall = Omit<CallOptions, "origin" | "token">;
type ToolHandler = (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

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
  const found = registeredTools(server)[name];
  if (!found) throw new Error(`tool ${name} was not registered`);
  return found as unknown as { handler: ToolHandler; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
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

test.describe("check_shopping_item", () => {
  test("PATCHes status: completed on the shopping list", async () => {
    const { server, calls } = buildServer(["shopping:write"]);
    const t = tool(server, "check_shopping_item");
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await t.handler({ shopping_item_id: "55555555-5555-5555-5555-555555555555" });
    expect(calls).toEqual([{
      path: "/lists/shopping/55555555-5555-5555-5555-555555555555",
      params: { list: "shopping", item: "55555555-5555-5555-5555-555555555555" },
      method: "PATCH",
      body: { status: "completed" },
    }]);
  });

  test("is refused without shopping:write, naming the missing scope", async () => {
    const { server } = buildServer(["family:read"]);
    const result = await tool(server, "check_shopping_item").handler({ shopping_item_id: "55555555-5555-5555-5555-555555555555" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("shopping:write");
  });
});

test.describe("uncheck_shopping_item", () => {
  test("PATCHes status: needs_action on the shopping list", async () => {
    const { server, calls } = buildServer(["shopping:write"]);
    await tool(server, "uncheck_shopping_item").handler({ shopping_item_id: "66666666-6666-6666-6666-666666666666" });
    expect(calls).toEqual([{
      path: "/lists/shopping/66666666-6666-6666-6666-666666666666",
      params: { list: "shopping", item: "66666666-6666-6666-6666-666666666666" },
      method: "PATCH",
      body: { status: "needs_action" },
    }]);
  });
});

test.describe("rename_shopping_item", () => {
  test("PATCHes summary with the new name", async () => {
    const { server, calls } = buildServer(["shopping:write"]);
    const t = tool(server, "rename_shopping_item");
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await t.handler({ shopping_item_id: "77777777-7777-7777-7777-777777777777", name: "Oat milk" });
    expect(calls).toEqual([{
      path: "/lists/shopping/77777777-7777-7777-7777-777777777777",
      params: { list: "shopping", item: "77777777-7777-7777-7777-777777777777" },
      method: "PATCH",
      body: { summary: "Oat milk" },
    }]);
  });

  test("its input schema rejects an empty name, so the SDK refuses the call before the handler runs", async () => {
    const { server } = buildServer(["shopping:write"]);
    const t = tool(server, "rename_shopping_item") as unknown as { inputSchema: { parse: (v: unknown) => unknown } };
    expect(() => t.inputSchema.parse({ shopping_item_id: "77777777-7777-7777-7777-777777777777", name: "" })).toThrow();
  });
});

test.describe("delete_shopping_item", () => {
  test("DELETEs with no body, and is an edit annotation", async () => {
    const { server, calls } = buildServer(["shopping:write"]);
    const t = tool(server, "delete_shopping_item");
    await t.handler({ shopping_item_id: "88888888-8888-8888-8888-888888888888" });
    expect(calls).toEqual([{
      path: "/lists/shopping/88888888-8888-8888-8888-888888888888",
      params: { list: "shopping", item: "88888888-8888-8888-8888-888888888888" },
      method: "DELETE",
    }]);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  test("is refused without shopping:write, naming the missing scope", async () => {
    const { server } = buildServer(["family:read"]);
    const result = await tool(server, "delete_shopping_item").handler({ shopping_item_id: "88888888-8888-8888-8888-888888888888" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("shopping:write");
  });
});

test.describe("update_note", () => {
  test("sends only the fields supplied", async () => {
    const { server, calls } = buildServer(["notes:write"]);
    await tool(server, "update_note").handler({ note_id: "99999999-9999-9999-9999-999999999999", content: "Buy milk" });
    expect(calls).toEqual([{
      path: "/notes/99999999-9999-9999-9999-999999999999",
      params: { id: "99999999-9999-9999-9999-999999999999" },
      method: "PATCH",
      body: { content: "Buy milk" },
    }]);
  });

  test("pinned alone, and both together", async () => {
    const { server, calls } = buildServer(["notes:write"]);
    await tool(server, "update_note").handler({ note_id: "99999999-9999-9999-9999-999999999999", pinned: true });
    await tool(server, "update_note").handler({ note_id: "99999999-9999-9999-9999-999999999999", content: "Buy milk", pinned: false });
    expect(calls[0].body).toEqual({ pinned: true });
    expect(calls[1].body).toEqual({ content: "Buy milk", pinned: false });
  });

  test("is an edit annotation", async () => {
    const { server } = buildServer(["notes:write"]);
    expect(tool(server, "update_note").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  test("its input schema rejects content over 2000 characters, so the SDK refuses the call before the handler runs", async () => {
    const { server } = buildServer(["notes:write"]);
    const t = tool(server, "update_note") as unknown as { inputSchema: { parse: (v: unknown) => unknown } };
    expect(() => t.inputSchema.parse({ note_id: "99999999-9999-9999-9999-999999999999", content: "a".repeat(2001) })).toThrow();
  });

  test("is refused without notes:write, naming the missing scope", async () => {
    const { server } = buildServer(["notes:read"]);
    const result = await tool(server, "update_note").handler({ note_id: "99999999-9999-9999-9999-999999999999", content: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("notes:write");
  });
});

test.describe("delete_note", () => {
  test("DELETEs with no body, and says it's recoverable", async () => {
    const { server, calls } = buildServer(["notes:write"]);
    const t = tool(server, "delete_note");
    await t.handler({ note_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    expect(calls).toEqual([{
      path: "/notes/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      params: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      method: "DELETE",
    }]);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  test("surfaces the route's 404 as a tool error, not a crash", async () => {
    const { server } = buildServer(["notes:write"], () => {
      throw new IntegrationCallError("no such note", 404, "not_found");
    });
    const result = await tool(server, "delete_note").handler({ note_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("no such note");
  });

  test("is refused without notes:write, naming the missing scope", async () => {
    const { server } = buildServer(["notes:read"]);
    const result = await tool(server, "delete_note").handler({ note_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("notes:write");
  });
});

test("every new tool carries a real scope", () => {
  for (const name of [
    "list_people", "complete_task", "reopen_task", "update_task", "delete_task",
    "check_shopping_item", "uncheck_shopping_item", "rename_shopping_item", "delete_shopping_item",
    "update_note", "delete_note",
  ]) {
    expect(TOOL_SCOPES).toHaveProperty(name);
  }
  expect(TOOL_SCOPES.list_people).toBe("family:read");
  expect(TOOL_SCOPES.complete_task).toBe("tasks:write");
  expect(TOOL_SCOPES.reopen_task).toBe("tasks:write");
  expect(TOOL_SCOPES.update_task).toBe("tasks:write");
  expect(TOOL_SCOPES.delete_task).toBe("tasks:write");
  expect(TOOL_SCOPES.check_shopping_item).toBe("shopping:write");
  expect(TOOL_SCOPES.uncheck_shopping_item).toBe("shopping:write");
  expect(TOOL_SCOPES.rename_shopping_item).toBe("shopping:write");
  expect(TOOL_SCOPES.delete_shopping_item).toBe("shopping:write");
  expect(TOOL_SCOPES.update_note).toBe("notes:write");
  expect(TOOL_SCOPES.delete_note).toBe("notes:write");
});
