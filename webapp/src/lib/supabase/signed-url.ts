import { browserApiUrl } from "@/lib/supabase/api-base";

/**
 * Make a signed storage URL reachable from a browser.
 *
 * `createAdminClient()` is constructed with the internal `http://kong:8000`
 * so its own calls stay in-network, and `createSignedUrl` builds the URL it
 * returns from that same base — so a signed URL handed straight to the client
 * names a host only the container can resolve.
 *
 * `publicStorageUrl` next door fixes the public-bucket case by constructing
 * the URL from scratch. That is not available here: the signature is the
 * whole point of a signed URL, so the path and query are kept exactly as
 * issued and only the origin is swapped.
 *
 * The anon key has to be attached as well. Kong's key-auth plugin guards the
 * catchall `/storage/v1/` route; kong.yml splits `/storage/v1/object/public/`
 * off specifically so a browser <img> can load a public-bucket image without
 * carrying a key, and signed URLs get no such exemption. Without it every one
 * of them comes back
 *
 *   401 {"message":"No API key found in request"}
 *
 * which shows up as a broken image with nothing in the storage logs to
 * explain it. The key is public by design — it is inlined into the client
 * bundle, and every other Supabase call the browser makes already sends it —
 * so putting it in the URL discloses nothing that was not already shipped.
 * The signed token, not the anon key, is what authorises the object.
 */
export function toBrowserStorageUrl(
  signedUrl: string,
  // The browser's API address, or none when it is the page's own origin
  // (RFC-018) — the URL then stays relative and resolves against it.
  externalBase: string | undefined = browserApiUrl() ?? undefined,
  anonKey: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
): string {
  let parsed: URL;
  try {
    parsed = new URL(signedUrl);
  } catch {
    // Already relative — same origin, nothing to swap.
    return signedUrl;
  }

  // Appended rather than set, so an upstream that already supplies one wins.
  if (anonKey && !parsed.searchParams.has("apikey")) {
    parsed.searchParams.set("apikey", anonKey);
  }

  const pathAndQuery = `${parsed.pathname}${parsed.search}`;

  // Same origin (RFC-018), and the same choice publicStorageUrl makes: a
  // relative URL resolves against the address the page was opened from.
  if (!externalBase) return pathAndQuery;

  return `${externalBase.replace(/\/$/, "")}${pathAndQuery}`;
}
