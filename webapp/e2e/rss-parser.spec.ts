import { test, expect } from "@playwright/test";
import { parseFeed } from "../src/lib/rss-parser";
import {
  parentDomain,
  customFeedHosts,
  isCustomFeedId,
  customFeedAsProvider,
  CUSTOM_FEED_PREFIX,
} from "../src/lib/news-providers";

/**
 * Pure-logic tests for custom RSS feeds.
 *
 * No browser and no running stack — same arrangement as
 * calendar-layout.spec.ts, which explains why unit tests live under e2e/.
 *
 * Two things are being guarded here. The parser, because it now has to
 * cope with whatever a user pastes rather than eleven feeds the project
 * chose; and `parentDomain`, because it is the one piece of this feature
 * that widens what the server is willing to fetch, so its edges matter
 * more than its happy path.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <item>
      <title><![CDATA[First & foremost]]></title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 03 Aug 2026 08:00:00 +0000</pubDate>
      <description><![CDATA[<p>Body <b>text</b></p>]]></description>
      <media:content url="https://example.com/img.jpg" />
      <category>News</category>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Example</title>
  <link rel="self" href="https://example.org/feed.xml"/>
  <link rel="alternate" href="https://example.org/"/>
  <entry>
    <title type="text">Atom entry</title>
    <link rel="self" href="https://example.org/feed.xml#e1"/>
    <link rel="alternate" type="text/html" href="https://example.org/posts/1"/>
    <published>2026-08-01T10:00:00Z</published>
    <summary type="html">&lt;p&gt;Summary text&lt;/p&gt;</summary>
    <category term="Tech"/>
  </entry>
</feed>`;

test.describe("parseFeed", () => {
  test("parses RSS items with CDATA, entities and media images", () => {
    const feed = parseFeed(RSS);
    expect(feed).not.toBeNull();
    expect(feed!.title).toBe("Example Feed");
    expect(feed!.items).toHaveLength(2);

    const [first] = feed!.items;
    expect(first.title).toBe("First & foremost");
    expect(first.link).toBe("https://example.com/1");
    // HTML in the description is stripped, not escaped-and-shown.
    expect(first.description).toBe("Body text");
    expect(first.image).toBe("https://example.com/img.jpg");
    expect(first.category).toBe("News");
  });

  test("parses Atom entries — the shape the old inline parser missed", () => {
    const feed = parseFeed(ATOM);
    expect(feed).not.toBeNull();
    expect(feed!.title).toBe("Atom Example");
    expect(feed!.items).toHaveLength(1);
    expect(feed!.items[0].title).toBe("Atom entry");
    expect(feed!.items[0].description).toBe("Summary text");
    expect(feed!.items[0].pubDate).toBe("2026-08-01T10:00:00Z");
    expect(feed!.items[0].category).toBe("Tech");
  });

  test("takes the alternate Atom link, never rel=self", () => {
    // Taking rel="self" would send every 'read article' click back to
    // the XML document instead of the article.
    expect(parseFeed(ATOM)!.items[0].link).toBe("https://example.org/posts/1");
  });

  test("returns null for a web page so discovery knows to look for a link", () => {
    expect(parseFeed("<!doctype html><html><head><title>A site</title></head></html>")).toBeNull();
    expect(parseFeed("not xml at all")).toBeNull();
  });

  test("distinguishes an empty feed from a non-feed", () => {
    const empty = parseFeed('<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>');
    expect(empty).not.toBeNull();
    expect(empty!.items).toHaveLength(0);
  });

  test("skips items without a title rather than failing the document", () => {
    const feed = parseFeed(
      '<rss version="2.0"><channel><title>T</title>' +
        "<item><link>https://example.com/x</link></item>" +
        "<item><title>Kept</title><link>https://example.com/y</link></item>" +
        "</channel></rss>",
    );
    expect(feed!.items.map((i) => i.title)).toEqual(["Kept"]);
  });

  test("honours the item cap", () => {
    const items = Array.from(
      { length: 30 },
      (_, i) => `<item><title>Item ${i}</title><link>https://example.com/${i}</link></item>`,
    ).join("");
    const feed = parseFeed(`<rss version="2.0"><channel><title>T</title>${items}</channel></rss>`, 5);
    expect(feed!.items).toHaveLength(5);
  });
});

test.describe("reader-mode host scoping", () => {
  test("widens a feed subdomain to its parent domain", () => {
    // Articles almost never live on the host that serves the feed.
    expect(parentDomain("feeds.example.com")).toBe("example.com");
    expect(parentDomain("rss.news.example.org")).toBe("news.example.org");
  });

  test("refuses to widen to a public suffix", () => {
    // The bug this prevents: allowing `co.uk` would make reader mode
    // willing to fetch every British website.
    expect(parentDomain("bbc.co.uk")).toBeNull();
    expect(parentDomain("example.com")).toBeNull();
    expect(parentDomain("example.gouv.fr")).toBeNull();
    expect(parentDomain("localhost")).toBeNull();
  });

  test("still widens a subdomain of a two-part suffix", () => {
    expect(parentDomain("feeds.bbc.co.uk")).toBe("bbc.co.uk");
  });

  test("collects hosts from a family's feeds, skipping malformed URLs", () => {
    const hosts = customFeedHosts([
      { id: "custom:1", name: "A", url: "https://feeds.example.com/rss" },
      { id: "custom:2", name: "B", url: "not a url" },
      { id: "custom:3", name: "C", url: "https://example.org/feed" },
    ]);
    expect(hosts).toContain("feeds.example.com");
    expect(hosts).toContain("example.com");
    expect(hosts).toContain("example.org");
    expect(hosts).toHaveLength(3);
  });
});

test.describe("custom feed ids", () => {
  test("are namespaced so they cannot collide with catalog ids", () => {
    expect(isCustomFeedId(`${CUSTOM_FEED_PREFIX}abc`)).toBe(true);
    expect(isCustomFeedId("spiegel")).toBe(false);
  });

  test("present as a provider so the fetch path stays uniform", () => {
    const provider = customFeedAsProvider({
      id: "custom:1",
      name: "My blog",
      url: "https://example.com/feed.xml",
    });
    expect(provider.id).toBe("custom:1");
    expect(provider.name).toBe("My blog");
    expect(provider.homepage).toBe("https://example.com");
  });
});
