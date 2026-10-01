import { TOOL_SCOPES, toolScopes } from "@/lib/mcp/server";

/**
 * ChatGPT reads a per-tool `securitySchemes` from tools/list to know which
 * scope each tool needs; the SDK drops unknown tool fields when it
 * serializes, so the list response is patched on the way out. A tool that
 * any of several scopes unlocks gets one scheme per scope: the schemes are
 * alternatives. Responses may
 * be JSON or a single-shot SSE stream; anything else passes through.
 */
function patch(payload: unknown): unknown {
  const tools = (payload as { result?: { tools?: { name: string; securitySchemes?: unknown }[] } })?.result?.tools;
  if (!Array.isArray(tools)) return payload;
  for (const tool of tools) {
    const name = tool.name as keyof typeof TOOL_SCOPES;
    if (TOOL_SCOPES[name]) tool.securitySchemes = toolScopes(name).map((scope) => ({ type: "oauth2", scopes: [scope] }));
  }
  return payload;
}

export async function addSecuritySchemes(response: Response): Promise<Response> {
  const mime = response.headers.get("content-type") ?? "";
  let body: string;
  if (mime.includes("application/json")) {
    body = JSON.stringify(patch(await response.json()));
  } else if (mime.includes("text/event-stream")) {
    body = (await response.text()).replace(/^data: (.+)$/gm, (line, json: string) => {
      try {
        return `data: ${JSON.stringify(patch(JSON.parse(json)))}`;
      } catch {
        return line;
      }
    });
  } else {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, headers });
}
