import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createKinboardClient } from "../src/client.js";

const TOKEN = `kbi_${"a".repeat(43)}`;

test("client requires a scoped token and an explicitly trusted HTTP origin", () => {
  assert.throws(() => createKinboardClient({ KINBOARD_URL: "http://house.local", KINBOARD_INTEGRATION_TOKEN: TOKEN }), /HTTPS/);
  assert.throws(() => createKinboardClient({ KINBOARD_URL: "https://user:pass@example.org", KINBOARD_INTEGRATION_TOKEN: TOKEN }), /origin/);
  assert.throws(() => createKinboardClient({ KINBOARD_URL: "https://example.org", KINBOARD_INTEGRATION_TOKEN: "wrong" }), /Integration API token/);
  assert.doesNotThrow(() => createKinboardClient({ KINBOARD_URL: "http://127.0.0.1:3000", KINBOARD_INTEGRATION_TOKEN: TOKEN }));
});

test("MCP advertises bounded tools and sends authenticated idempotent writes", async () => {
  const calls = [];
  const api = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ url: request.url, method: request.method, headers: request.headers, body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/integration/v1/family/summary") {
      response.end(JSON.stringify({ summary: { birthdays_upcoming: { name: "Mia", date: "2026-10-03", days_remaining: 6 } }, generated_at: "2026-09-27T10:00:00Z" }));
    } else if (request.url === "/api/integration/v1/lists/tasks" && request.method === "POST") {
      response.end(JSON.stringify({ id: "task-1", summary: JSON.parse(body).summary }));
    } else if (request.url === "/api/integration/v1/calendar/events" && request.method === "POST") {
      response.end(JSON.stringify({ event: { id: "event-1", title: JSON.parse(body).title } }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ code: "not_found" }));
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const port = api.address().port;
  const client = new Client({ name: "kinboard-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/server.js", import.meta.url).pathname],
    env: { ...process.env, KINBOARD_URL: `http://127.0.0.1:${port}/`, KINBOARD_INTEGRATION_TOKEN: TOKEN },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert(tools.some((tool) => tool.name === "get_solar_production" && tool.annotations?.readOnlyHint));
    assert(tools.some((tool) => tool.name === "create_task" && tool.annotations?.readOnlyHint === false));
    const birthday = await client.callTool({ name: "get_next_birthday", arguments: {} });
    assert.equal(JSON.parse(birthday.content[0].text).birthday.name, "Mia");
    const task = await client.callTool({ name: "create_task", arguments: { title: "Pack lunches" } });
    assert.equal(JSON.parse(task.content[0].text).summary, "Pack lunches");
    const invalid = await client.callTool({ name: "create_task", arguments: { title: "" } });
    assert.equal(invalid.isError, true);
    const event = await client.callTool({ name: "create_calendar_event", arguments: {
      calendar_id: "f1563352-af89-41e6-9173-cf9f616fbeb2",
      title: "Dentist", start_at: "2026-10-03T09:00:00+02:00", end_at: "2026-10-03T10:00:00+02:00",
    } });
    assert.equal(JSON.parse(event.content[0].text).event.title, "Dentist");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.match(calls[1].headers["idempotency-key"], /^[0-9a-f-]{36}$/);
    assert.match(calls[2].headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  } finally {
    await client.close();
    api.close();
    await once(api, "close");
  }
});
