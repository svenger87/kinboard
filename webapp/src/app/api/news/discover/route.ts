import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { validateExternalUrl } from "@/lib/validate-external-url";
import { parseFeed } from "@/lib/rss-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validate a URL a user typed on /settings/news, before it's saved.
 *
 * Two jobs, because they're the same round-trip:
 *
 *  1. **Test** — fetch and parse, and report the item count plus the
 *     first headline. Same affordance /settings/ics has, for the same
 *     reason: a feed that returns nothing is indistinguishable from a
 *     working one until the news page is empty and nobody knows why.
 *
 *  2. **Autodiscovery** — most people paste a site's homepage, not its
 *     feed. Nobody should have to know that heise's feed lives at
 *     /rss/heise-atom.xml. If the URL isn't a feed, look for
 *     `<link rel="alternate" type="application/rss+xml">` and follow it.
 *
 * SSRF: unlike CalDAV, where a LAN address is the entire use case, RSS
 * feeds are public internet resources. So `validateExternalUrl` applies
 * here in full — private, loopback and link-local hosts are refused.
 * The same check runs again at fetch time; a stored URL is not trusted
 * just because it passed once.
 */

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (Kinboard feed discovery; +https://kinboard.app) AppleWebKit/537.36";

interface DiscoverResult {
  ok: boolean;
  /** The URL that actually parsed as a feed — may differ from the input. */
  url?: string;
  title?: string;
  itemCount?: number;
  firstItemTitle?: string | null;
  /** True when the input was a page and we followed a <link> to the feed. */
  discovered?: boolean;
  error?: string;
}

async function fetchText(url: string): Promise<{ body: string; contentType: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_BYTES) {
    throw new Error("Feed is too large");
  }
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("Feed is too large");

  return { body, contentType: response.headers.get("content-type") ?? "" };
}

/**
 * Paths to try when a page advertises no feed.
 *
 * Plenty of sites have a perfectly good feed and simply never put a
 * `<link rel="alternate">` in their markup — Ars Technica is one, and
 * every static-site generator has its own default. Guessing a handful of
 * conventional paths turns "no feed found" into a working feed often
 * enough to be worth four extra requests, and they only happen when
 * autodiscovery has already failed.
 */
const WELL_KNOWN_FEED_PATHS = ["/feed", "/rss", "/feed.xml", "/index.xml", "/atom.xml"];

/** Find a feed link in an HTML page, resolved against the page URL. */
function findFeedLink(html: string, pageUrl: string): string | null {
  const dom = new JSDOM(html, { url: pageUrl });
  const links = dom.window.document.querySelectorAll(
    'link[rel~="alternate"][type="application/rss+xml"], link[rel~="alternate"][type="application/atom+xml"], link[rel~="alternate"][type="application/feed+json"]',
  );
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href");
    if (!href) continue;
    try {
      // href may be relative; JSDOM's url option makes this resolve.
      return new URL(href, pageUrl).href;
    } catch {
      continue;
    }
  }
  return null;
}

/** Try the conventional feed paths on a site's origin. */
async function probeWellKnown(pageUrl: URL): Promise<string | null> {
  for (const path of WELL_KNOWN_FEED_PATHS) {
    const candidate = new URL(path, pageUrl.origin).href;
    try {
      const { body } = await fetchText(candidate);
      if (parseFeed(body)) return candidate;
    } catch {
      // A 404 here is the expected case, not an error worth reporting.
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return NextResponse.json({ ok: false, error: "A URL is required" }, { status: 400 });
  }

  // Accept "example.com" as well as a full URL — people paste both. Only
  // a *missing* scheme is filled in: prefixing something that already has
  // one turns `file:///etc/passwd` into `https://file:///etc/passwd`,
  // which parses as a host called "file" and reports a DNS failure
  // instead of the refusal it deserves.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:/i.test(raw)) {
    return NextResponse.json({
      ok: false,
      error: "Only http and https addresses can be used as feeds.",
    } satisfies DiscoverResult);
  }
  const candidate = hasScheme ? raw : `https://${raw}`;

  const validated = validateExternalUrl(candidate);
  if (!validated.ok) {
    const message =
      validated.reason === "private-or-loopback-host"
        ? "That address is on a private network. News feeds need to be reachable on the public internet."
        : "That doesn't look like a valid http(s) URL.";
    return NextResponse.json({ ok: false, error: message } satisfies DiscoverResult);
  }

  let result: DiscoverResult;
  try {
    const { body: text, contentType } = await fetchText(validated.url.href);

    const parsed = parseFeed(text);
    if (parsed) {
      result = {
        ok: true,
        url: validated.url.href,
        title: parsed.title,
        itemCount: parsed.items.length,
        firstItemTitle: parsed.items[0]?.title ?? null,
      };
    } else if (contentType.includes("html") || /<html[\s>]/i.test(text)) {
      // Looks like a page — try to find the feed it advertises.
      const feedUrl =
        findFeedLink(text, validated.url.href) ?? (await probeWellKnown(validated.url));
      if (!feedUrl) {
        result = {
          ok: false,
          error: "No RSS or Atom feed found at that address, and the page doesn't advertise one.",
        };
      } else {
        const feedCheck = validateExternalUrl(feedUrl);
        if (!feedCheck.ok) {
          result = { ok: false, error: "The feed this page points to isn't reachable on the public internet." };
        } else {
          const { body: feedText } = await fetchText(feedCheck.url.href);
          const feed = parseFeed(feedText);
          result = feed
            ? {
                ok: true,
                url: feedCheck.url.href,
                title: feed.title,
                itemCount: feed.items.length,
                firstItemTitle: feed.items[0]?.title ?? null,
                discovered: true,
              }
            : { ok: false, error: "Found a feed link on that page, but it didn't parse as RSS or Atom." };
        }
      }
    } else {
      result = { ok: false, error: "That address didn't return RSS or Atom." };
    }
  } catch (err) {
    result = { ok: false, error: describe(errorDetail(err)) };
  }

  return NextResponse.json(result);
}

/**
 * Undici reports every transport failure as a bare `TypeError: fetch
 * failed` and hides the real reason on `cause`, so "check the address"
 * and "the certificate was rejected" both surfaced as the same useless
 * string until this walked the chain.
 */
function errorDetail(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as NodeJS.ErrnoException).code;
    if (code) parts.push(code);
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" ") || String(err);
}

/** Turn a transport failure into something a person can act on. */
function describe(raw: string): string {
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return "That domain doesn't resolve — check the address.";
  if (/ECONNREFUSED/i.test(raw)) return "Connection refused.";
  if (/certificate|self.signed|SSL|TLS/i.test(raw)) return "The site's TLS certificate was rejected.";
  if (/abort|timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(raw))
    return "The site took too long to respond.";
  if (/ECONNRESET|EPIPE/i.test(raw)) return "The connection was closed before the feed loaded.";
  if (/HTTP 4\d\d/.test(raw)) return `${raw} — the feed may have moved or require a login.`;
  if (/HTTP 5\d\d/.test(raw)) return `${raw} — the site is having trouble right now.`;
  if (/fetch failed/i.test(raw)) return "Could not reach that address.";
  return raw;
}
