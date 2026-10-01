import { NextRequest } from "next/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { publicOrigin } from "@/lib/oauth/origin";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { createKinboardMcpServer } from "@/lib/mcp/server";
import { addSecuritySchemes } from "@/lib/mcp/security-schemes";
import { assistantsGate } from "@/lib/oauth/enabled";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint (RFC-010). Stateless: a server instance per request,
 * built for that request's token, so a tool can never see another caller's
 * scopes. Authentication runs before the SDK so the 401 carries the
 * resource_metadata pointer sign-in depends on.
 */
async function handle(request: NextRequest): Promise<Response> {
  // Absent until a family switches assistants on (lib/oauth/enabled.ts);
  // per-family refusal happens in authenticateMcpRequest.
  const off = await assistantsGate();
  if (off) return off;
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const auth = await authenticateMcpRequest(request, origin);
  if (!auth.ok) return auth.response;

  let isToolsList = false;
  if (request.method === "POST") {
    try {
      isToolsList = ((await request.clone().json()) as { method?: string })?.method === "tools/list";
    } catch {
      // The SDK answers malformed bodies itself.
    }
  }
  const handler = createMcpHandler(() => createKinboardMcpServer(auth.authInfo, origin));
  const response = await handler.fetch(request, { authInfo: auth.authInfo });
  return isToolsList ? addSecuritySchemes(response) : response;
}

export { handle as GET, handle as POST, handle as DELETE };
