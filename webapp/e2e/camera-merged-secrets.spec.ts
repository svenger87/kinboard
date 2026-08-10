import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_FIELDS, mergeSecrets, splitSecrets } from "../src/lib/integration-secrets";

/**
 * A camera's password is a registered secret (`cameras.*.auth.password`), so
 * after a settings save it lives in `integration_secrets` and the `settings`
 * row carries everything about that camera except the one field the proxy
 * cannot work without.
 *
 * Both camera routes read the row directly, which worked only for as long as
 * the password happened to still be sitting inline — the pre-v1.4.0 shape.
 * The moment a household saved anything on Settings → Cameras, the proxy
 * started building `rtsp://user:@host` and go2rtc answered
 * "streams: wrong user/pass". Observed on a real instance: it reads as a
 * wrong password rather than a missing one, which sends you to the camera.
 *
 * `getMergedSetting` is the one call server routes should use, and these
 * tests are here because the type system cannot tell the two reads apart —
 * both hand back a CameraSettings that looks complete.
 */

const KEY = "cameras";

const camera = (password?: string) => ({
  id: "cam-1",
  name: "Carport",
  stream_type: "rtsp",
  stream_url: "rtsp://10.0.0.5:554/Streaming/Channels/101",
  auth: { username: "admin", type: "digest", ...(password === undefined ? {} : { password }) },
  enabled: true,
  position: 0,
});

test("camera passwords are a registered secret, so they leave the settings row", () => {
  expect(SECRET_FIELDS[KEY]).toContain("cameras.*.auth.password");

  const { publicValue, secretValue } = splitSecrets(KEY, { cameras: [camera("hunter2")] });

  // What a route reading `settings` directly would get back:
  const asStored = publicValue as { cameras: { auth: Record<string, unknown> }[] };
  expect(asStored.cameras[0].auth.password).toBeUndefined();
  expect(asStored.cameras[0].auth.username).toBe("admin"); // everything else intact
  expect((secretValue as any).cameras[0].auth.password).toBe("hunter2");
});

test("merging puts the password back", () => {
  const { publicValue, secretValue } = splitSecrets(KEY, { cameras: [camera("hunter2")] });

  const merged = mergeSecrets(KEY, publicValue, secretValue) as {
    cameras: { auth: Record<string, unknown> }[];
  };
  expect(merged.cameras[0].auth.password).toBe("hunter2");
});

test("both camera routes read the merged value, not the settings row", () => {
  // The failure this guards is silent at the type level: a raw read returns a
  // CameraSettings that looks complete and is missing exactly one field.
  for (const route of [
    "src/app/api/cameras/route.ts",
    "src/app/api/cameras/webrtc/route.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), route), "utf8");

    expect(source, `${route} must read merged settings`).toContain("getMergedSetting");
    expect(source, `${route} must not query the settings table directly`).not.toMatch(
      /from\(\s*["']settings["']\s*\)/,
    );
  }
});
