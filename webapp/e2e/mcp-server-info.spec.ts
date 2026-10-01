import { test, expect } from "@playwright/test";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createKinboardMcpServer } from "../src/lib/mcp/server";

/**
 * What an assistant learns about Kinboard in the `initialize` handshake.
 * ChatGPT showed a blank placeholder where Kinboard's logo belongs because
 * serverInfo carried no icons. This drives a real initialize through the
 * SDK's HTTP handler — the same path /api/mcp uses — rather than reading the
 * object the server was constructed with, so it fails if the SDK drops a
 * field on the way out.
 */

const authInfo = { token: "kbi_test", clientId: "test-client", scopes: ["family:read"] } as AuthInfo;

async function initialize(origin: string) {
  const handler = createMcpHandler(() => createKinboardMcpServer(authInfo, origin));
  const response = await handler.fetch(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spec", version: "0" } },
      }),
    }),
    { authInfo },
  );
  const text = await response.text();
  // The handler may answer as JSON or as a one-event SSE stream.
  const json = text.trimStart().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return json.result.serverInfo as {
    name: string;
    title?: string;
    websiteUrl?: string;
    icons?: { src: string; mimeType?: string; sizes?: string[] }[];
  };
}

test("initialize announces Kinboard's title, website and icons as absolute https URLs", async () => {
  const info = await initialize("https://kb.example.com");
  expect(info.name).toBe("kinboard");
  expect(info.title).toBe("Kinboard");
  expect(info.websiteUrl).toBe("https://kb.example.com");
  expect(info.icons).toEqual([
    { src: "https://kb.example.com/icons/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
    { src: "https://kb.example.com/icons/icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
  ]);
  for (const icon of info.icons ?? []) expect(new URL(icon.src).protocol).toBe("https:");
});

test("a trailing slash on the origin does not double up in the icon URLs", async () => {
  const info = await initialize("https://kb.example.com/");
  expect(info.icons?.[0].src).toBe("https://kb.example.com/icons/icon-512.png");
});

test("the icons are files that exist and that the proxy lets through without a session", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  for (const file of ["icon-512.png", "icon-192.png"]) {
    expect(fs.existsSync(path.join(__dirname, "..", "public", "icons", file)), file).toBe(true);
  }
  // proxy.ts's matcher excludes static images, so no session check runs for them.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "proxy.ts"), "utf8");
  const matcher = /"(\/\(\(\?!.*?\)\.\*\))"/.exec(source)?.[1];
  expect(matcher, "proxy matcher").toBeTruthy();
  const re = new RegExp(`^${matcher!.replace(/\\\\/g, "\\")}$`);
  expect(re.test("/icons/icon-512.png")).toBe(false);
  expect(re.test("/icons/icon-192.png")).toBe(false);
  expect(re.test("/shopping")).toBe(true);
});
