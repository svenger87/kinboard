import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET as mapConfig } from "../src/app/api/weather/map/route";
import { GET as tile } from "../src/app/api/weather/tile/[layer]/[z]/[x]/[y]/route";

/**
 * Covers the seam between the two halves of the weather map, which is
 * where it broke: `/api/weather/map` names the layers, `/api/weather/tile`
 * allowlists them, and each was tested on its own. The config emitted
 * OpenWeatherMap's internal names (`precipitation_new`) while the proxy
 * allowlisted the UI keys (`precipitation`), so every tile 404'd and the
 * map rendered blank — with both halves passing their own tests.
 *
 * So this test takes the URLs the config actually hands the browser and
 * feeds them to the route that actually serves them.
 */

function parseTileUrl(url: string) {
  const m = url.match(/^\/api\/weather\/tile\/([^/]+)\/\{z\}\/\{x\}\/\{y\}$/);
  if (!m) throw new Error(`unexpected tile URL shape: ${url}`);
  return m[1];
}

test("every layer the map config advertises is one the tile proxy serves", async () => {
  test.setTimeout(120_000);

  const res = await mapConfig(
    new NextRequest("http://localhost/api/weather/map?lat=52.52&lon=13.40"),
  );
  // 503 means this checkout has no OPENWEATHERMAP_API_KEY, which is the
  // normal state in CI. Skip rather than fail — the point of this test is
  // the layer names lining up, not whether a key is present.
  test.skip(res.status === 503, "no OPENWEATHERMAP_API_KEY configured");
  expect(res.status, "map config should be reachable").toBe(200);
  const config = await res.json();

  const layers = Object.entries(config.layers as Record<string, string>);
  expect(layers.length).toBeGreaterThan(0);

  for (const [name, url] of layers) {
    const layer = parseTileUrl(url);
    const tileRes = await tile(
      new NextRequest(`http://localhost${url}`),
      { params: Promise.resolve({ layer, z: "6", x: "33", y: "21" }) },
    );
    // 200 with a key configured, 503 without one — but never 404, which
    // is what an unknown layer returns and what shipped.
    expect(tileRes.status, `layer "${name}" (${layer})`).not.toBe(404);
    expect([200, 503]).toContain(tileRes.status);
  }
});

test("the config still refuses to hand out the API key", async () => {
  const res = await mapConfig(
    new NextRequest("http://localhost/api/weather/map?lat=52.52&lon=13.40"),
  );
  const body = JSON.stringify(await res.json());
  expect(body).not.toContain("appid");
  expect(body).not.toContain("tile.openweathermap.org");
});

test("a bad coordinate is a clean 400, not a crashed map", async () => {
  for (const q of ["lat=abc&lon=13.4", "lat=91&lon=0", "lat=0&lon=181"]) {
    const res = await mapConfig(new NextRequest(`http://localhost/api/weather/map?${q}`));
    expect(res.status, q).toBe(400);
  }
});
