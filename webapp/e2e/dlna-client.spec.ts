import { test, expect } from "@playwright/test";
import {
  parseDeviceDescription,
  parseDidl,
  extractBrowseResult,
  browseEnvelope,
  assertDlnaUrl,
  reachableMediaUrl,
  browseItemMetadata,
} from "../src/lib/dlna-client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DIDL-Lite in the shapes real servers emit it. The differences between them
 * are the whole difficulty of this integration: MiniDLNA puts the control URL
 * at an absolute path, Jellyfin at a relative one; Synology publishes three
 * renditions per photo and Plex one; half of them namespace `dc:title` and the
 * other half also namespace the container.
 */

const MINIDLNA_DESC = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>Tower: minidlna</friendlyName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <controlURL>/ctl/ConnectionMgr</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>/ctl/ContentDir</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

const JELLYFIN_DESC = `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>http://10.10.10.4:8096/dlna/abc/</URLBase>
  <device>
    <friendlyName>Jellyfin - NAS</friendlyName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>contentdirectory/control</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

test.describe("parseDeviceDescription", () => {
  test("resolves an absolute control path against the description URL", () => {
    const r = parseDeviceDescription(MINIDLNA_DESC, "http://10.10.10.2:8200/rootDesc.xml");
    expect(r?.friendlyName).toBe("Tower: minidlna");
    expect(r?.controlUrl).toBe("http://10.10.10.2:8200/ctl/ContentDir");
  });

  test("prefers URLBase for a relative control path", () => {
    const r = parseDeviceDescription(JELLYFIN_DESC, "http://10.10.10.4:8096/dlna/abc/description.xml");
    expect(r?.friendlyName).toBe("Jellyfin - NAS");
    expect(r?.controlUrl).toBe("http://10.10.10.4:8096/dlna/abc/contentdirectory/control");
  });

  test("picks ContentDirectory, not the first service listed", () => {
    // ConnectionManager comes first in the MiniDLNA description above.
    const r = parseDeviceDescription(MINIDLNA_DESC, "http://x/rootDesc.xml");
    expect(r?.controlUrl).toContain("ContentDir");
  });

  test("a server with no ContentDirectory is not a photo source", () => {
    const xml = `<root><device><friendlyName>Printer</friendlyName><serviceList>
      <service><serviceType>urn:schemas-upnp-org:service:Printer:1</serviceType>
      <controlURL>/ctl</controlURL></service></serviceList></device></root>`;
    expect(parseDeviceDescription(xml, "http://x/d.xml")).toBeNull();
  });
});

test.describe("parseDidl", () => {
  test("reads containers with their child counts", () => {
    const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
        xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <container id="64" parentID="0" restricted="1" childCount="12">
        <dc:title>Pictures</dc:title><upnp:class>object.container.storageFolder</upnp:class>
      </container>
      <container id="65" parentID="0" restricted="1">
        <dc:title>Urlaub 2026</dc:title><upnp:class>object.container.album.photoAlbum</upnp:class>
      </container>
    </DIDL-Lite>`;
    const { containers, items } = parseDidl(didl);
    expect(containers).toEqual([
      { id: "64", title: "Pictures", childCount: 12 },
      { id: "65", title: "Urlaub 2026", childCount: null },
    ]);
    expect(items).toEqual([]);
  });

  test("picks the largest non-thumbnail rendition", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="64$1$3" parentID="64$1" restricted="1">
        <dc:title>IMG_1418</dc:title>
        <dc:date>2026-07-30</dc:date>
        <upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN" resolution="160x120" size="8123">http://nas:8200/thumb/3.jpg</res>
        <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG" resolution="4032x3024" size="4812345">http://nas:8200/full/3.jpg</res>
        <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_MED" resolution="1024x768" size="211234">http://nas:8200/med/3.jpg</res>
      </item>
    </DIDL-Lite>`;
    const { items } = parseDidl(didl);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "64$1$3",
      title: "IMG_1418",
      url: "http://nas:8200/full/3.jpg",
      thumbnailUrl: "http://nas:8200/thumb/3.jpg",
      mimeType: "image/jpeg",
      resolution: "4032x3024",
      size: 4812345,
      date: "2026-07-30",
    });
  });

  test("prefers upnp:albumArtURI as the thumbnail when offered", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="7"><dc:title>P</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <upnp:albumArtURI>http://nas/art/7.jpg</upnp:albumArtURI>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/full/7.jpg</res>
      </item></DIDL-Lite>`;
    expect(parseDidl(didl).items[0].thumbnailUrl).toBe("http://nas/art/7.jpg");
  });

  test("a photo with only a thumbnail still shows something", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="8"><dc:title>Only small</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN">http://nas/thumb/8.jpg</res>
      </item></DIDL-Lite>`;
    expect(parseDidl(didl).items[0].url).toBe("http://nas/thumb/8.jpg");
  });

  test("skips music and video sharing the container", () => {
    // A DLNA root mixes everything; the screensaver must not queue an mp3.
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="1"><dc:title>Song</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <res protocolInfo="http-get:*:audio/mpeg:*">http://nas/a.mp3</res></item>
      <item id="2"><dc:title>Film</dc:title><upnp:class>object.item.videoItem</upnp:class>
        <res protocolInfo="http-get:*:video/mp4:*">http://nas/v.mp4</res></item>
      <item id="3"><dc:title>Photo</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/p.jpg</res></item>
    </DIDL-Lite>`;
    const { items } = parseDidl(didl);
    expect(items.map((i) => i.title)).toEqual(["Photo"]);
  });

  test("an item with no res at all is dropped, not rendered broken", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="9"><dc:title>Ghost</dc:title><upnp:class>object.item.imageItem.photo</upnp:class></item>
    </DIDL-Lite>`;
    expect(parseDidl(didl).items).toEqual([]);
  });

  test("survives the XML servers actually emit", () => {
    // An unescaped ampersand in a filename — common, and fatal to a strict
    // parser. The file with the bare & is allowed to come out mangled; the
    // ones around it must not be lost.
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="1"><dc:title>Ben &amp; Jerry</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/1.jpg</res></item>
      <item id="2"><dc:title>Rock & Roll</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/2.jpg</res></item>
      <item id="3"><dc:title>Fine</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/3.jpg</res></item>
    </DIDL-Lite>`;
    const { items } = parseDidl(didl);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe("Ben & Jerry");
    expect(items[2].title).toBe("Fine");
  });

  test("decodes numeric and named entities in titles", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="1"><dc:title>Gr&#252;&#223;e &amp; K&#xFC;sse</dc:title>
        <upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/1.jpg</res></item>
    </DIDL-Lite>`;
    expect(parseDidl(didl).items[0].title).toBe("Grüße & Küsse");
  });

  test("handles CDATA titles literally", () => {
    const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
      <item id="1"><dc:title><![CDATA[100% <raw>]]></dc:title>
        <upnp:class>object.item.imageItem.photo</upnp:class>
        <res protocolInfo="http-get:*:image/jpeg:*">http://nas/1.jpg</res></item>
    </DIDL-Lite>`;
    expect(parseDidl(didl).items[0].title).toBe("100% <raw>");
  });

  test("an empty result is empty, not an exception", () => {
    expect(parseDidl(`<DIDL-Lite></DIDL-Lite>`)).toEqual({ containers: [], items: [] });
    expect(parseDidl("")).toEqual({ containers: [], items: [] });
  });
});

test.describe("extractBrowseResult", () => {
  test("unwraps the escaped DIDL-Lite from the SOAP envelope", () => {
    const soap = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
 <s:Body>
  <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
   <Result>&lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"&gt;&lt;container id="64" childCount="3"&gt;&lt;dc:title&gt;Pictures&lt;/dc:title&gt;&lt;/container&gt;&lt;/DIDL-Lite&gt;</Result>
   <NumberReturned>1</NumberReturned>
   <TotalMatches>7</TotalMatches>
   <UpdateID>2</UpdateID>
  </u:BrowseResponse>
 </s:Body>
</s:Envelope>`;
    const { didl, totalMatches } = extractBrowseResult(soap);
    expect(totalMatches).toBe(7);
    // And the unwrapped payload is itself parseable — the round trip is the point.
    expect(parseDidl(didl).containers).toEqual([
      { id: "64", title: "Pictures", childCount: 3 },
    ]);
  });

  test("a SOAP fault yields nothing rather than throwing", () => {
    const fault = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
      <s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring></s:Fault>
    </s:Body></s:Envelope>`;
    expect(extractBrowseResult(fault)).toEqual({ didl: "", totalMatches: 0 });
  });
});

test.describe("browseEnvelope", () => {
  test("asks for the direct children of a container", () => {
    const env = browseEnvelope("64$1", "BrowseDirectChildren", 0, 200);
    expect(env).toContain("<ObjectID>64$1</ObjectID>");
    expect(env).toContain("<BrowseFlag>BrowseDirectChildren</BrowseFlag>");
    expect(env).toContain("<RequestedCount>200</RequestedCount>");
  });

  test("escapes an object id rather than breaking the envelope", () => {
    // Object ids are server-chosen and have contained & before now.
    expect(browseEnvelope("a&b", "BrowseMetadata", 0, 1)).toContain("<ObjectID>a&amp;b</ObjectID>");
  });
});

test.describe("assertDlnaUrl", () => {
  test("accepts LAN http, which is the whole point", () => {
    expect(assertDlnaUrl("http://10.10.10.2:8200/rootDesc.xml").hostname).toBe("10.10.10.2");
    expect(assertDlnaUrl("https://nas.local/desc.xml").protocol).toBe("https:");
  });

  test("rejects anything that is not http(s)", () => {
    for (const bad of ["file:///etc/passwd", "ftp://nas/x", "not a url"]) {
      expect(() => assertDlnaUrl(bad), bad).toThrow();
    }
  });
});

test.describe("reachableMediaUrl", () => {
  test("rewrites a host the client cannot reach", () => {
    // Caught with a real MiniDLNA: it advertised its Docker bridge address
    // while answering on a different network, so every image timed out.
    expect(
      reachableMediaUrl(
        "http://172.17.0.8:8200/MediaItems/23.jpg",
        "http://10.205.0.15:8200/ctl/ContentDir",
      ),
    ).toBe("http://10.205.0.15:8200/MediaItems/23.jpg");
  });

  test("keeps the media port, which is often not the control port", () => {
    expect(
      reachableMediaUrl("http://10.0.0.5:8300/img/1.jpg", "http://nas.local:8200/ctl"),
    ).toBe("http://nas.local:8300/img/1.jpg");
  });

  test("keeps the query string", () => {
    expect(
      reachableMediaUrl(
        "http://172.17.0.8:8200/Resized/23.jpg?width=160,height=160",
        "http://10.205.0.15:8200/ctl",
      ),
    ).toContain("?width=160,height=160");
  });

  test("leaves a URL that already matches alone", () => {
    const url = "http://nas.local:8200/MediaItems/1.jpg";
    expect(reachableMediaUrl(url, "http://nas.local:8200/ctl")).toBe(url);
  });

  test("garbage in, garbage out — but not an exception", () => {
    expect(reachableMediaUrl("not a url", "http://nas/ctl")).toBe("not a url");
  });
});


test.describe("browseItemMetadata", () => {
  /**
   * The image proxy is built on this call: the browser sends an object id and
   * the server is asked where that object lives. If it ever came back with an
   * address the request supplied instead, the proxy would be forgeable again —
   * so these check that the question is asked of the media server and the
   * answer comes from its reply.
   */
  const METADATA = readFileSync(
    join(__dirname, "fixtures/dlna/browse-metadata.xml"),
    "utf8",
  );

  async function withFetch(
    handler: (url: string, init: RequestInit) => Response,
    run: () => Promise<void>,
  ) {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init ?? {})) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  test("asks the server to describe one object, and returns what it says", async () => {
    let askedUrl = "";
    let body = "";

    await withFetch(
      (url, init) => {
        askedUrl = url;
        body = String(init.body ?? "");
        return new Response(METADATA, { status: 200 });
      },
      async () => {
        const item = await browseItemMetadata("http://nas.local:8200/ctl/ContentDir", "64$0$0");

        expect(askedUrl).toBe("http://nas.local:8200/ctl/ContentDir");
        expect(body).toContain("<BrowseFlag>BrowseMetadata</BrowseFlag>");
        expect(body).toContain("<ObjectID>64$0$0</ObjectID>");

        expect(item?.id).toBe("64$0$0");
        expect(item?.title).toBe("kinder");
        // Straight out of the server's own answer — which is the property the
        // image proxy rests on. (This capture publishes only JPEG_SM and
        // JPEG_TN renditions, so the "largest non-thumbnail" rule has nothing
        // to pick and falls back to the first; that choice is parseDidl's and
        // is tested above.)
        expect(item?.url).toBe("http://172.17.0.8:8200/MediaItems/23.jpg");
        expect(item?.mimeType).toBe("image/jpeg");
      },
    );
  });

  test("returns null when the id names nothing describable", async () => {
    const empty = METADATA.replace(/&lt;item id=[\s\S]*&lt;\/item&gt;/, "");
    await withFetch(
      () => new Response(empty, { status: 200 }),
      async () => {
        expect(await browseItemMetadata("http://nas.local:8200/ctl", "nope")).toBeNull();
      },
    );
  });

  test("refuses a control URL that is not http", async () => {
    await expect(browseItemMetadata("file:///etc/passwd", "1")).rejects.toThrow(
      /unsupported scheme/,
    );
  });

  test("reports a server that answers with an error", async () => {
    await withFetch(
      () => new Response("nope", { status: 500 }),
      async () => {
        await expect(
          browseItemMetadata("http://nas.local:8200/ctl", "64$0$0"),
        ).rejects.toThrow(/metadata returned 500/);
      },
    );
  });
});
