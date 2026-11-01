import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getRealtimeHub, type HubMessage } from "@/lib/realtime/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime — the family's row changes, as Server-Sent Events.
 *
 * Replaces the Supabase Realtime socket. The database announces each change
 * (migrations/084_change_feed.sql), the process's one LISTEN connection
 * receives it (lib/realtime/hub.ts), and this stream passes on the changes of
 * the session's family and no other. The family comes from the session, never
 * from the request, so a screen cannot ask for someone else's.
 *
 * Events:
 *   change  {table, eventType, new, old} — the shape use-realtime.ts handles
 *   resync  the server lost its database connection and has it back; changes
 *           in between are lost, so refetch everything
 *   down    the server has lost its database connection; changes are not
 *           arriving until the next resync
 *
 * A comment line every 25 s keeps proxies (Kong's 60 s read timeout among
 * them) from closing an idle stream and lets the server notice a gone client.
 * The session is checked again every five minutes, so a device removed in
 * Settings stops receiving within that time; the stream then ends, and the
 * screen's reconnect is answered with a 401.
 */

const HEARTBEAT_MS = 25_000;
const RECHECK_SESSION_MS = 5 * 60_000;

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { familyId } = auth.session;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      const onMessage = (message: HubMessage) => {
        if (message.kind === "change") {
          const { table, op, new: next, old } = message.change;
          send(`event: change\ndata: ${JSON.stringify({ table, eventType: op, new: next ?? {}, old: old ?? {} })}\n\n`);
        } else {
          send(`event: ${message.kind}\ndata: {}\n\n`);
        }
      };

      const unsubscribe = getRealtimeHub().subscribe(familyId, onMessage);

      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      const recheck = setInterval(() => {
        void verifySession(token).then((session) => {
          if (!session || session.familyId !== familyId) cleanup();
        });
      }, RECHECK_SESSION_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(recheck);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      request.signal.addEventListener("abort", cleanup);

      // Tell the browser how long to wait before reconnecting on its own, and
      // flush the headers through any buffering proxy straight away.
      send("retry: 3000\n: open\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
