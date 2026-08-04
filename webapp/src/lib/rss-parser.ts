import DOMPurify from "isomorphic-dompurify";

/**
 * Feed parsing, shared by the news list, feed discovery and reader mode.
 *
 * This lived inline in `api/news/route.ts` and understood exactly one
 * shape: RSS `<item>`. That was fine while every source came from the
 * curated catalog, which is all RSS. Custom feeds aren't — a good share
 * of the web (anything Blogger, Hugo's default, most GitHub feeds) is
 * Atom, and those would have parsed as zero items with no error to show
 * for it. So Atom `<entry>` and RDF (RSS 1.0) are handled here too.
 *
 * Deliberately still regex-based rather than a real XML parser. Feeds in
 * the wild are frequently not well-formed, and a strict parser fails the
 * whole document on one stray ampersand where this degrades to skipping
 * the item it appeared in. Nothing here is rendered as HTML — titles and
 * descriptions go through `stripHtml` and are rendered as React text.
 */

/**
 * Default ceiling when a caller doesn't specify one. The news route sets
 * its own; this only bounds ad-hoc parses such as feed discovery.
 */
const MAX_ITEMS_PER_FEED = 50;

export interface ParsedFeedItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  image: string;
  category: string;
}

export interface ParsedFeed {
  /** The feed's own title, used to pre-fill the name field on save. */
  title: string;
  items: ParsedFeedItem[];
}

export function decodeHtmlEntities(text: string): string {
  // Decode `&amp;` LAST. Decoding it first would convert `&amp;lt;`
  // (literal "&lt;" — which the original feed wanted shown as text)
  // into `&lt;` and then into `<`, double-decoding past the original
  // intent. Doing it last preserves single-pass-decode semantics.
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function stripHtml(text: string): string {
  // DOMPurify with empty allow-lists strips ALL tags + attributes
  // robustly — including pathological inputs like `<scr<x>ipt>` that
  // a single-pass regex (`<[^>]*>`) leaves dangerous after one
  // replacement.
  const stripped = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return stripped.replace(/\s+/g, " ").trim();
}

/**
 * Read a simple element's text, CDATA or not, tolerating attributes.
 * Atom writes `<title type="text">`, RSS usually writes a bare `<title>`.
 */
function tag(xml: string, name: string): string {
  const cdata = xml.match(
    new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"),
  );
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return plain ? plain[1] : "";
}

/** Attribute lookup on the first matching self-closing-ish element. */
function attr(xml: string, element: string, name: string): string {
  const m = xml.match(new RegExp(`<${element}[^>]*\\s${name}=["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
}

function pickImage(itemXml: string, description: string): string {
  const enclosure =
    itemXml.match(/<enclosure[^>]*url=["']([^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)?.[1] ||
    itemXml.match(/<enclosure[^>]*type=["']image\/[^"']*["'][^>]*url=["']([^"']*)["']/i)?.[1] ||
    itemXml.match(/<enclosure[^>]*url=["']([^"']*)["'][^>]*type=["']image\//i)?.[1] ||
    "";
  const mediaContent = attr(itemXml, "media:content", "url");
  const mediaThumb = attr(itemXml, "media:thumbnail", "url");
  const inDescription =
    description.match(/src=["']([^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)?.[1] || "";
  return enclosure || mediaContent || mediaThumb || inDescription || "";
}

/**
 * The Atom `<link>` we want is the alternate HTML one. Atom feeds carry
 * several — `rel="self"` points at the feed itself, and taking that
 * would send every "read article" click back to the XML.
 */
function atomLink(entryXml: string): string {
  const links = entryXml.match(/<link\b[^>]*>/gi) ?? [];
  let fallback = "";
  for (const link of links) {
    const href = link.match(/href=["']([^"']*)["']/i)?.[1];
    if (!href) continue;
    const rel = link.match(/rel=["']([^"']*)["']/i)?.[1]?.toLowerCase();
    if (rel === "alternate" || !rel) return href;
    if (rel !== "self" && rel !== "hub" && !fallback) fallback = href;
  }
  return fallback || tag(entryXml, "link").trim();
}

function parseItems(xml: string, maxItems: number): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];

  // RSS 2.0 / RDF `<item>` first, then Atom `<entry>`. A document is
  // one or the other in practice; running both costs a failed regex.
  const blocks: Array<{ xml: string; atom: boolean }> = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    blocks.push({ xml: m[1], atom: false });
  }
  if (blocks.length === 0) {
    for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
      blocks.push({ xml: m[1], atom: true });
    }
  }

  for (const block of blocks) {
    const title = tag(block.xml, "title");
    if (!title.trim()) continue;

    const description = block.atom
      ? tag(block.xml, "summary") || tag(block.xml, "content")
      : tag(block.xml, "description") || tag(block.xml, "content:encoded");

    const link = block.atom ? atomLink(block.xml) : tag(block.xml, "link").trim();

    const pubDate = block.atom
      ? tag(block.xml, "published") || tag(block.xml, "updated")
      : tag(block.xml, "pubDate") || tag(block.xml, "dc:date");

    const category = block.atom
      ? attr(block.xml, "category", "term")
      : tag(block.xml, "category");

    items.push({
      title: stripHtml(decodeHtmlEntities(title)),
      link: decodeHtmlEntities(link).trim(),
      pubDate: pubDate.trim(),
      description: stripHtml(decodeHtmlEntities(description)),
      image: pickImage(block.xml, description),
      category: stripHtml(decodeHtmlEntities(category)),
    });

    if (items.length >= maxItems) break;
  }

  return items;
}

/**
 * Parse a feed document.
 *
 * Returns `null` when the input isn't a feed at all — that's the signal
 * discovery uses to decide "this is a web page, go looking for a
 * `<link rel=alternate>`". A real feed that happens to be empty returns
 * an empty item list, which is a different thing and reported as such.
 */
export function parseFeed(xml: string, maxItems = MAX_ITEMS_PER_FEED): ParsedFeed | null {
  const head = xml.slice(0, 4096);
  const isFeed =
    /<rss[\s>]/i.test(head) ||
    /<rdf:RDF[\s>]/i.test(head) ||
    /<feed[\s>]/i.test(head);
  if (!isFeed) return null;

  // The feed title is the first <title> outside any item/entry, so read
  // it from the document with item blocks removed.
  const withoutItems = xml
    .replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, "")
    .replace(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi, "");

  return {
    title: stripHtml(decodeHtmlEntities(tag(withoutItems, "title"))),
    items: parseItems(xml, maxItems),
  };
}
