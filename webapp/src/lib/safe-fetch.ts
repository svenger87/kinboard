import { lookup } from "node:dns/promises";
import {
  validateExternalUrl,
  isPrivateOrLoopbackHostname,
} from "@/lib/validate-external-url";

/**
 * Fetch a URL the user typed, without letting it point back inside the
 * network Kinboard is running on.
 *
 * `validateExternalUrl` alone is not enough once a request URL comes
 * straight from the request body, as it does for feed discovery. Its own
 * header documents the two holes, and both are reachable here rather
 * than theoretical:
 *
 *  - **DNS.** The blocklist reads the hostname, not the address it
 *    resolves to. `feeds.attacker.com` is a perfectly ordinary hostname
 *    that can have an A record of `169.254.169.254`. The check passes,
 *    the server fetches the cloud metadata endpoint, and the discovery
 *    response helpfully reports the document's title.
 *
 *  - **Redirects.** `redirect: "follow"` hands the whole decision to the
 *    remote server. A public host answering `302 Location:
 *    http://10.0.0.1/admin` bypasses validation entirely, because
 *    nothing re-checks the hop.
 *
 * So: resolve every hop's hostname and test the resolved addresses, and
 * follow redirects by hand so each one is validated like the original.
 *
 * What this deliberately does NOT claim to solve is the rebinding race —
 * the address is checked, then fetch resolves the name again, and a
 * hostile DNS server with a one-second TTL can answer differently the
 * second time. Closing that needs the connection pinned to the address
 * that was checked, which Node's fetch gives no way to express without
 * replacing the agent and breaking TLS SNI. The window is small, it
 * requires an attacker-controlled nameserver, and the payoff is a title
 * string — so it's documented rather than papered over.
 */

export class BlockedAddressError extends Error {
  constructor(readonly host: string) {
    super(`Refusing to fetch ${host}: not a public address`);
    this.name = "BlockedAddressError";
  }
}

const MAX_REDIRECTS = 5;

/** Reject a URL whose hostname resolves to anything non-public. */
async function assertPublicAddress(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Literal IPs and `localhost` never reach the resolver.
  if (isPrivateOrLoopbackHostname(host)) throw new BlockedAddressError(host);

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    // A name that doesn't resolve can't be fetched either; let fetch
    // produce the error message so it reads like every other DNS failure.
    return;
  }

  // Every address, not just the first: a hostname with one public and
  // one private A record would otherwise get through on the public one
  // while fetch is free to connect to the other.
  for (const { address } of addresses) {
    if (isPrivateOrLoopbackHostname(address)) throw new BlockedAddressError(host);
  }
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * `fetch` for user-supplied URLs. Validates the address, then each
 * redirect hop, and returns the final response.
 */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<Response> {
  const first = validateExternalUrl(input);
  if (!first.ok) throw new BlockedAddressError(input);

  let current = first.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicAddress(current);

    const response = await fetch(current.href, {
      headers: options.headers,
      signal: options.signal,
      // Handled below rather than by fetch, so each hop is checked.
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return response;
    }

    const checked = validateExternalUrl(next.href);
    if (!checked.ok) throw new BlockedAddressError(next.hostname || location);

    current = checked.url;
  }

  throw new Error("Too many redirects");
}
