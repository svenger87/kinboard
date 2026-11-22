import { publicOrigin } from "@/lib/oauth/origin";

/** Where Google sends the browser back to after consent. */
export const GOOGLE_CALLBACK_PATH = "/api/google/callback";

/**
 * The redirect URI this install asks Google for, and the one the callback
 * must repeat when it trades the code for tokens: GOOGLE_REDIRECT_URI when
 * the operator set one, otherwise the callback on the address this request
 * came in on (the same origin logic as the assistants' OAuth, lib/oauth/origin.ts).
 *
 * It used to fall back to http://localhost:3000/api/google/callback, and the
 * Docker setup never passed GOOGLE_REDIRECT_URI into the container, so every
 * Docker install asked Google for that address whatever had been registered:
 * redirect_uri_mismatch (#503). Following the request means the address shown
 * in Settings -> Google Calendar is the one that works from this screen.
 */
export function googleRedirectUri(
  headers: Headers,
  fallbackOrigin: string,
  configured: string | undefined = process.env.GOOGLE_REDIRECT_URI,
): string {
  const fixed = configured?.trim();
  if (fixed) return fixed;
  return `${publicOrigin(headers, fallbackOrigin)}${GOOGLE_CALLBACK_PATH}`;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Names that only resolve at home: Google wants a public top-level domain. */
const PRIVATE_TLD = /\.(?:local|lan|home|internal|localdomain|home\.arpa|fritz\.box|box)$/i;

/**
 * Whether Google lets a web OAuth client register this redirect URI: https
 * on a public domain name, or plain http on localhost. A LAN address
 * (http://192.168.1.20:3001, http://server.local) is refused in Cloud Console,
 * however it is typed, so Settings says so before anyone tries.
 */
export function googleAcceptsRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;
  if (IPV4.test(host) || host.startsWith("[")) return false;
  if (!host.includes(".") || PRIVATE_TLD.test(host)) return false;
  return true;
}
