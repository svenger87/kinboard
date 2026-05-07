import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import DOMPurify from "isomorphic-dompurify";
import { NEWS_PROVIDERS } from "@/lib/news-providers";
import { isDemoMode, findDemoArticle } from "@/lib/demo-news";

// Extracts the main article content from a news URL using Mozilla
// Readability (the same library that powers Firefox Reader View),
// sanitizes the resulting HTML to drop scripts/handlers/dangerous
// protocols, and returns clean content the client can render in a
// Sheet without iframing the publisher's site.
//
// Why server-side: jsdom is heavy (~10 MB+) and CORS would block
// us from fetching arbitrary news sites client-side anyway.
//
// Cache: in-process, 60-min per URL — articles are mostly immutable
// after publication and our traffic is tiny.

interface ArticleResult {
  readable: boolean;
  url: string;
  title?: string;
  byline?: string | null;
  excerpt?: string | null;
  siteName?: string | null;
  publishedAt?: string | null;
  contentHtml?: string;
  textContent?: string;
  lengthChars?: number;
  /** When readable: false, the client should fall back to opening the URL in a new tab */
  reason?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const articleCache: Map<string, { data: ArticleResult; expiresAt: number }> = new Map();

const ALLOWED_HOSTS = new Set(
  NEWS_PROVIDERS.flatMap((p) => {
    try {
      const u = new URL(p.url);
      return [u.hostname];
    } catch {
      return [];
    }
  }),
);

// We also allow the canonical-content host of each provider in case the
// RSS uses a different subdomain than the article URL — e.g. RSS lives
// on `feeds.bbci.co.uk` but articles are on `www.bbc.com`. Pre-seed
// known mappings; unknown hosts are still allowed (any URL the user
// gets from /api/news has been through the catalog), but we log them.
const HOST_ALIASES: Record<string, string[]> = {
  "feeds.bbci.co.uk": ["www.bbc.com", "www.bbc.co.uk"],
  "rss.nytimes.com": ["www.nytimes.com"],
  "newsfeed.zeit.de": ["www.zeit.de"],
  "feeds.arstechnica.com": ["arstechnica.com"],
};
for (const [_, hosts] of Object.entries(HOST_ALIASES)) {
  for (const h of hosts) ALLOWED_HOSTS.add(h);
}

function isHostAllowed(host: string): boolean {
  // Exact match or one-level subdomain (`a.bbc.com` allowed if `bbc.com`).
  for (const h of ALLOWED_HOSTS) {
    if (host === h || host.endsWith("." + h)) return true;
  }
  return false;
}

async function fetchArticle(url: string): Promise<ArticleResult> {
  const cached = articleCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { readable: false, url, reason: "invalid-url" };
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { readable: false, url, reason: "invalid-protocol" };
  }
  if (!isHostAllowed(parsedUrl.hostname)) {
    return { readable: false, url, reason: "host-not-allowed" };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Kinboard reader-mode; +https://kinboard.app) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      // 12-sec budget per article fetch
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!response.ok) {
      return { readable: false, url, reason: `http-${response.status}` };
    }
    const html = await response.text();

    // Build a virtual DOM scoped to the article URL so relative links
    // resolve against the publisher's origin.
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return { readable: false, url, reason: "extraction-failed" };
    }

    const sanitized = DOMPurify.sanitize(article.content, {
      ALLOWED_TAGS: [
        "p",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "a",
        "strong",
        "em",
        "b",
        "i",
        "u",
        "blockquote",
        "code",
        "pre",
        "img",
        "figure",
        "figcaption",
        "hr",
        "div",
        "span",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
      ALLOWED_ATTR: ["href", "src", "alt", "title", "loading"],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
      // Force all <a> to open externally
      ADD_ATTR: ["target", "rel"],
    });

    // Post-process: ensure all anchors open in a new tab + add rel
    const result: ArticleResult = {
      readable: true,
      url,
      title: article.title ?? undefined,
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      siteName: article.siteName ?? null,
      publishedAt: article.publishedTime ?? null,
      contentHtml: sanitized.replace(
        /<a /g,
        '<a target="_blank" rel="noopener noreferrer" ',
      ),
      textContent: article.textContent?.trim() ?? "",
      lengthChars: article.length ?? sanitized.length,
    };
    articleCache.set(url, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    return {
      readable: false,
      url,
      reason: err instanceof Error ? err.message : "unknown-error",
    };
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { readable: false, error: "missing url param" },
      { status: 400 },
    );
  }

  // Demo deployments: serve canned content for our synthetic articles
  // and refuse to proxy any other URL (we don't want to be a public
  // article-fetching proxy on the demo box).
  if (isDemoMode()) {
    const article = findDemoArticle(url);
    if (!article) {
      return NextResponse.json({
        readable: false,
        url,
        error: "Reader mode is disabled in demo mode for non-demo URLs.",
      });
    }
    const html = article.body.map((p) => `<p>${p}</p>`).join("\n");
    return NextResponse.json({
      readable: true,
      url,
      title: article.title,
      byline: null,
      excerpt: article.description,
      siteName: article.sourceName,
      publishedAt: article.pubDate,
      contentHtml: html,
      textContent: article.body.join("\n\n"),
      lengthChars: article.body.join("").length,
    });
  }

  const result = await fetchArticle(url);
  return NextResponse.json(result);
}
