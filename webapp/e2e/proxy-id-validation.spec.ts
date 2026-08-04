import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Both proxies build their URL as `<trusted base from settings>/<path>/<id>`,
 * where the id comes straight off the query string. The host is safe — it's
 * the family's stored, PIN-protected Home Assistant / Immich address — but
 * the path wasn't: an id like "../../states" walks out of the intended
 * endpoint and reaches others on that same service, carrying the family's
 * token or API key with it.
 *
 * Bounded (same host, GET, the family's own credentials) but the app was
 * letting a request reach endpoints it never meant to expose.
 */

const ha = readFileSync(join(__dirname, "..", "src", "app", "api", "homeassistant", "camera", "route.ts"), "utf8");
const immich = readFileSync(join(__dirname, "..", "src", "app", "api", "immich", "image", "route.ts"), "utf8");

const HA_ENTITY = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const IMMICH_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

test.describe("Home Assistant entity ids", () => {
  test("real entity ids still pass", () => {
    // The first is straight off the live install.
    for (const id of [
      "sensor.roborock_s7_maxv_batterie",
      "camera.front_door",
      "binary_sensor.motion_1",
      "light.kitchen_2",
    ]) {
      expect(HA_ENTITY.test(id), id).toBe(true);
    }
  });

  test("path traversal and separators are rejected", () => {
    for (const id of [
      "../../states",
      "camera.front/../../states",
      "camera.front_door/extra",
      "camera.front_door?foo=bar",
      "camera.front_door#frag",
      "camera.front_door%2f..",
      "..%2f..%2fstates",
      "@evil.example.com/",
      "camera.front_door ",
      "",
    ]) {
      expect(HA_ENTITY.test(id), JSON.stringify(id)).toBe(false);
    }
  });

  test("uppercase and dots beyond one are not entity ids", () => {
    expect(HA_ENTITY.test("Camera.Front")).toBe(false);
    expect(HA_ENTITY.test("a.b.c")).toBe(false);
    expect(HA_ENTITY.test("nodot")).toBe(false);
  });

  test("the route enforces it before building the URL", () => {
    const guard = ha.indexOf("invalid entity_id");
    const buildsUrl = ha.indexOf("${haSettings.url}/api/camera_proxy");
    expect(guard).toBeGreaterThan(-1);
    expect(buildsUrl).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(buildsUrl);
  });
});

test.describe("Immich asset ids", () => {
  test("a real UUID passes", () => {
    expect(IMMICH_UUID.test("29b63c67-59c2-4bda-aeee-2e89915b4a01")).toBe(true);
    expect(IMMICH_UUID.test("29B63C67-59C2-4BDA-AEEE-2E89915B4A01")).toBe(true);
  });

  test("anything that could leave the path is rejected", () => {
    for (const id of [
      "../../users",
      "29b63c67-59c2-4bda-aeee-2e89915b4a01/../../users",
      "29b63c67-59c2-4bda-aeee-2e89915b4a01?x=1",
      "not-a-uuid",
      "",
    ]) {
      expect(IMMICH_UUID.test(id), JSON.stringify(id)).toBe(false);
    }
  });

  test("the route enforces it before building the URL", () => {
    const guard = immich.indexOf("invalid asset_id");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(immich.indexOf("/api/assets/"));
  });

  test("size is restricted to the three Immich understands", () => {
    // It lands in the query string, so an unchecked value could append
    // parameters of the caller's choosing.
    const pick = (s: string) => (["thumbnail", "preview", "original"].includes(s) ? s : "preview");
    expect(pick("original")).toBe("original");
    expect(pick("thumbnail")).toBe("thumbnail");
    expect(pick("preview&foo=bar")).toBe("preview");
    expect(pick("../../")).toBe("preview");
    expect(immich).toContain('["thumbnail", "preview", "original"].includes(sizeParam)');
  });
});
