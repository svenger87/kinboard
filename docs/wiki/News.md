# News

The news page (`/news`) and the dashboard news widget pull headlines from RSS and Atom feeds. Kinboard ships with a small catalog of publishers, and from v1.0.x you can add any feed of your own — a local paper, a sports club, a subreddit, a blog, a GitHub project's releases.

Everything is read-only and anonymous: Kinboard's server fetches the feeds, so the publisher never sees your household's devices, and nothing about what you read leaves the box.

---

## Choosing sources

Go to **Settings → News sources** (`/settings/news`).

The page has two halves. **Your own feeds** at the top, and the **built-in sources** below — currently *Spiegel*, *Tagesschau*, *Zeit*, *heise*, *Süddeutsche*, *BBC*, *The Guardian*, *New York Times*, *Hacker News* and *Ars Technica*, grouped by language.

Each source has a switch. Changes save immediately; there is no save button. With nothing switched on, the news widget and `/news` stay empty and tell you so.

---

## Adding your own feed

1. Press **Add feed**.
2. Paste an address and press **Test**.
3. If it works, give it a name (the feed's own title is filled in for you) and press **Add**.

A feed you just added arrives switched on.

### You don't need to find the feed URL

Paste the site itself — `example.com` works, so does `https://example.com`. Kinboard looks for the feed the way a browser extension would:

1. If the address *is* a feed, it's used directly.
2. Otherwise the page is checked for a `<link rel="alternate">` feed declaration, which is how most sites advertise theirs.
3. Failing that, the conventional paths are tried: `/feed`, `/rss`, `/feed.xml`, `/index.xml`, `/atom.xml`. Plenty of sites have a working feed and never advertise it — Ars Technica is one.

When a feed is found this way, the test result says so and the address is replaced with the one that actually worked.

### Why Test comes before Add

A feed that returns nothing looks exactly like a working one until the news page is empty a day later and nobody knows which source is at fault. The test reports how many articles were found and the newest headline, so you can see it working before you commit to it.

Both RSS and Atom are supported. Feeds requiring a login or an API key are not.

---

## Reader mode

Clicking a headline opens the article inside Kinboard — extracted with the same library as Firefox's Reader View, stripped of scripts, ads and trackers, and rendered in your theme. This works for your own feeds as well as the built-in ones.

There's a limit worth knowing: reader mode only fetches from hosts Kinboard already has reason to trust — the built-in publishers, plus the hosts of feeds *your family* added. A custom feed also covers the domain the feed sits under, since articles usually live on `example.com` while the feed is served from `feeds.example.com`.

If a feed links to articles on some third domain entirely, those open in a browser tab instead of the reader. That is a deliberate trade: your server fetches those pages on your behalf, so the set of addresses it will fetch stays something you chose rather than something a feed can extend on its own. See [Security & threat model](Security-and-Threat-Model).

Some publishers defeat extraction regardless — paywalls, consent walls, or articles built entirely in JavaScript. Kinboard says so and offers the original link.

---

## Limits and behaviour

| | |
|---|---|
| Custom feeds per family | 20 |
| Articles per source | 15 |
| Articles shown in total | 40, newest first |
| Refresh | Every 10 minutes per source |
| Feed size | 3 MB |
| Timeout | 12 seconds |

Sources are fetched in parallel and cached separately, so one slow publisher doesn't hold up the others. If a feed fails, the last articles that did load are kept rather than blanking the page — a feed that's briefly down doesn't cost you the news.

Duplicate articles are removed by link, so overlapping sources don't show the same story twice.

---

## What's allowed as a feed address

Feeds must be reachable on the public internet over http or https. Addresses on your own network — `192.168.x.x`, `10.x.x.x`, `localhost`, link-local — are refused, and so are non-web schemes like `file://`.

This is different from [CalDAV](CalDAV) and [Home Assistant](Home-Assistant), where a LAN address is the whole point. Those are configured against a server you run; a news feed is a public resource, so accepting private addresses would only ever make Kinboard useful as a tool for probing your own network from the outside.

The check goes past the address you typed. Kinboard resolves the hostname and tests what it actually points at — a name like `feeds.example.com` can perfectly legally carry an A record for `127.0.0.1` — and validates each redirect along the way, since a public host is free to redirect to a private one. Feed URLs are re-checked every time they're fetched, not only when they're added.

---

## Demo instances

On the public demo (`demo.kinboard.app`), news is synthetic — real publisher content isn't re-served to anonymous visitors, and reader mode declines any URL that isn't part of the demo data. Self-hosted households never hit this.

---

## Troubleshooting

**"No RSS or Atom feed found at that address"** — the site doesn't advertise a feed and none of the conventional paths worked. Look for an RSS icon on the site, or search `<site name> rss feed`, and paste the feed address directly.

**"That domain doesn't resolve"** — a typo in the address, or the site is gone.

**"HTTP 403 — the feed may have moved or require a login"** — some publishers block server-side fetching outright, or the feed is subscriber-only.

**The feed works but the news page doesn't show it** — check the switch is on in Settings → News sources. Also give it up to 10 minutes: sources are cached, so a newly-added feed can take one refresh cycle to appear on the dashboard widget.

**Articles open in a browser tab instead of the reader** — see [Reader mode](#reader-mode) above; the article is on a domain unrelated to the feed's own.
