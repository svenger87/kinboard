import WebSocket from "ws";

/**
 * One command over Home Assistant's WebSocket API, then close.
 *
 * Kinboard talks to Home Assistant over REST everywhere else. `browse_media`
 * is the exception: HA exposes it on the WebSocket API **only**, with no REST
 * equivalent, so browsing a speaker's library means speaking that protocol.
 * RFC-003 §5.1 calls this the single largest cost in the media RFC, and this
 * file is deliberately the whole of it.
 *
 * Server-side only, always. The access token lives in `integration_secrets`
 * and must never reach a browser — the sentinel masking in
 * `lib/integration-secrets.ts` exists to keep it there. A socket opened from
 * the client would have to carry the token to be useful, which is the one
 * thing that machinery is built to prevent.
 *
 * **One connection per command, not a pool.** Browsing is a handful of
 * user-initiated taps, not a stream. A pool would need reconnection, liveness
 * and per-family isolation, and would hold an authenticated socket open to
 * somebody's house between requests. Opening and closing costs a round trip
 * nobody can feel at this rate, and leaves nothing behind to leak or go stale.
 *
 * `ws` rather than the built-in: the production image and CI run Node 20,
 * which has no global `WebSocket` (it arrived unflagged in 21, stable in 22).
 * Verified against `node:20-alpine` rather than assumed.
 */

/** The handshake and result frames we care about. Everything else is ignored. */
type HAFrame =
  | { type: "auth_required" }
  | { type: "auth_ok" }
  | { type: "auth_invalid"; message?: string }
  | { type: "result"; id: number; success: boolean; result?: unknown; error?: { message?: string } }
  | { type: string; [k: string]: unknown };

export class HAWebSocketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HAWebSocketError";
  }
}

/** `http(s)://host/…` → `ws(s)://host/api/websocket`. */
export function websocketUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  // HA serves the socket at a fixed path; anything already on the configured
  // URL is a base path the reverse proxy added, so append rather than replace.
  u.pathname = `${u.pathname.replace(/\/$/, "")}/api/websocket`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Authenticate, send one command, resolve its result, close.
 *
 * Rejects rather than hanging: a Home Assistant that accepts the connection
 * and then says nothing would otherwise hold a route handler open until the
 * platform killed it, and the household would see a spinner with no end.
 */
export async function haWebSocketCommand<T>(
  baseUrl: string,
  accessToken: string,
  command: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const url = websocketUrl(baseUrl);
  const socket = new WebSocket(url);

  return await new Promise<T>((resolve, reject) => {
    // One id is enough — this socket carries exactly one command.
    const commandId = 1;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing; nothing to salvage */
      }
      fn();
    };

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new HAWebSocketError(`Home Assistant did not answer within ${timeoutMs}ms`)),
        ),
      timeoutMs,
    );

    socket.on("error", (err: Error) =>
      finish(() => reject(new HAWebSocketError(err.message || "socket error"))),
    );

    // A close before the result is an answer too, and a silent one otherwise.
    socket.on("close", () =>
      finish(() => reject(new HAWebSocketError("Home Assistant closed the connection"))),
    );

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let frame: HAFrame;
      try {
        frame = JSON.parse(raw.toString()) as HAFrame;
      } catch {
        return; // not ours to interpret
      }

      switch (frame.type) {
        case "auth_required":
          socket.send(JSON.stringify({ type: "auth", access_token: accessToken }));
          return;

        case "auth_invalid":
          finish(() =>
            reject(
              new HAWebSocketError(
                (frame as { message?: string }).message ?? "Home Assistant rejected the token",
              ),
            ),
          );
          return;

        case "auth_ok":
          socket.send(JSON.stringify({ id: commandId, ...command }));
          return;

        case "result": {
          const r = frame as Extract<HAFrame, { type: "result" }>;
          if (r.id !== commandId) return;
          if (!r.success) {
            finish(() =>
              reject(new HAWebSocketError(r.error?.message ?? "Home Assistant refused the command")),
            );
            return;
          }
          finish(() => resolve(r.result as T));
          return;
        }
      }
    });
  });
}
