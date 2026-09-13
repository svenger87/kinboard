import { test, expect } from "@playwright/test";
import { websocketUrl } from "../src/lib/ha-websocket";
import { browseNodesFromHa } from "../src/plugins/media/drivers/home-assistant";

/**
 * RFC-003 M3. Home Assistant exposes `browse_media` on its WebSocket API only,
 * so browsing is the one thing Kinboard cannot do over the REST path every
 * other Home Assistant feature uses. These are the two pure pieces of that:
 * where the socket points, and what its answer becomes.
 */

test.describe("websocketUrl", () => {
  test("upgrades the scheme rather than guessing at one", () => {
    expect(websocketUrl("http://homeassistant.local:8123")).toBe(
      "ws://homeassistant.local:8123/api/websocket",
    );
    expect(websocketUrl("https://ha.example.com")).toBe("wss://ha.example.com/api/websocket");
  });

  test("keeps a base path a reverse proxy added", () => {
    // Someone serving HA at /ha through Traefik still has to reach
    // /ha/api/websocket, not /api/websocket.
    expect(websocketUrl("https://example.com/ha")).toBe("wss://example.com/ha/api/websocket");
    expect(websocketUrl("https://example.com/ha/")).toBe("wss://example.com/ha/api/websocket");
  });

  test("drops query and hash", () => {
    // They are not ours to forward, and HA rejects the handshake with them.
    expect(websocketUrl("http://ha.local:8123/?x=1#y")).toBe("ws://ha.local:8123/api/websocket");
  });
});

test.describe("browseNodesFromHa", () => {
  const node = (o: Record<string, unknown>) => ({
    title: "t",
    media_content_id: "id",
    media_content_type: "music",
    can_play: true,
    can_expand: false,
    ...o,
  });

  test("returns the children, not the level itself", () => {
    // The node asked for is the breadcrumb the household is already standing
    // on; returning it too makes every level render itself as its first row.
    const out = browseNodesFromHa({
      title: "Library",
      media_content_id: "root",
      children: [node({ title: "Album", media_content_id: "a1" })],
    });
    expect(out.map((n) => n.id)).toEqual(["a1"]);
  });

  test("playable and expandable are independent", () => {
    // An album is usually both — which is why the UI needs the two flags and
    // not a single `type`.
    const out = browseNodesFromHa({
      children: [
        node({ media_content_id: "album", can_play: true, can_expand: true }),
        node({ media_content_id: "folder", can_play: false, can_expand: true }),
        node({ media_content_id: "track", can_play: true, can_expand: false }),
      ],
    });
    expect(out.find((n) => n.id === "album")).toMatchObject({ playable: true, expandable: true });
    expect(out.find((n) => n.id === "folder")).toMatchObject({ playable: false, expandable: true });
    expect(out.find((n) => n.id === "track")).toMatchObject({ playable: true, expandable: false });
  });

  test("drops a row that would do nothing when tapped", () => {
    // HA uses these as labels in its own UI. Here they are a row a household
    // taps and nothing happens.
    const out = browseNodesFromHa({
      children: [
        node({ media_content_id: "label", can_play: false, can_expand: false }),
        node({ media_content_id: "real" }),
      ],
    });
    expect(out.map((n) => n.id)).toEqual(["real"]);
  });

  test("drops rows with nothing to identify or show them by", () => {
    const out = browseNodesFromHa({
      children: [
        node({ media_content_id: "", title: "no id" }),
        node({ media_content_id: "x", title: "" }),
        node({ media_content_id: "ok", title: "ok" }),
      ],
    });
    expect(out.map((n) => n.id)).toEqual(["ok"]);
  });

  test("carries the thumbnail through as a driver-relative path", () => {
    // It is a path on the HA host needing the token, so it goes to the
    // artwork proxy rather than to the browser's <img> directly.
    const out = browseNodesFromHa({
      children: [node({ thumbnail: "/api/media_proxy/abc.jpg" })],
    });
    expect(out[0].artworkUrl).toBe("/api/media_proxy/abc.jpg");
    expect(browseNodesFromHa({ children: [node({ thumbnail: null })] })[0].artworkUrl).toBeUndefined();
  });

  test("an empty or absent answer is an empty level, not a crash", () => {
    expect(browseNodesFromHa(undefined)).toEqual([]);
    expect(browseNodesFromHa(null)).toEqual([]);
    expect(browseNodesFromHa({})).toEqual([]);
    expect(browseNodesFromHa({ children: null })).toEqual([]);
  });
});
