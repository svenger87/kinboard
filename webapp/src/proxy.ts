import { NextResponse, type NextRequest } from "next/server";
import {
  CORRELATION_HEADER,
  newCorrelationId,
  sanitiseCorrelationId,
} from "@/lib/correlation";

export async function proxy(request: NextRequest) {
  // Correlation ID. This proxy used to also refresh Supabase auth cookies on
  // every request; nothing here has ever had a GoTrue session to refresh
  // (lib/require-session.ts is how the app authenticates), so that went with
  // the auth container in 1.15.
  //
  // This lives here rather than in a middleware.ts of its own: Next 16 renamed
  // middleware to proxy, and having both files is a hard build error —
  //   "Both middleware file and proxy file are detected."
  // One file per project, so the ID is set here.
  //
  // An inbound header is honoured rather than replaced, so an ID minted by
  // Home Assistant, the Bridge or a reverse proxy survives the hop and one ID
  // covers the whole chain. Sanitised first: it is echoed into log lines and
  // into a response header, so an unbounded caller-controlled string would be
  // a log-injection and header-splitting vector.
  const correlationId =
    sanitiseCorrelationId(request.headers.get(CORRELATION_HEADER)) ?? newCorrelationId();
  request.headers.set(CORRELATION_HEADER, correlationId);

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Back to the caller too, so a client can log the ID without parsing a body
  // — including on responses that have none.
  response.headers.set(CORRELATION_HEADER, correlationId);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
