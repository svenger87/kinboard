import { test, expect } from "@playwright/test";
import {
  splitSecrets,
  applySentinels,
  mergeSecrets,
  SECRET_SENTINEL,
  SECRET_FIELDS,
} from "../src/lib/integration-secrets";
import { SETTINGS_KEYS } from "../src/lib/settings-keys";

/**
 * Camera credentials were stored in the `settings` row in the clear —
 * returned to every device by /api/settings, readable through PostgREST
 * by anything on the LAN, and written into every backup file. Protecting
 * them needed wildcard paths, because cameras are a list and each entry
 * carries its own password.
 *
 * That meant changing the traversal helpers this whole mechanism rests
 * on, so the first block here is regression cover for the keys that
 * already worked. If the array support broke object handling, those fail.
 */

test.describe("existing keys still behave exactly as before", () => {
  test("home assistant token is split out and masked", () => {
    const value = { url: "http://ha.local", access_token: "llat-secret", dashboards: [] };
    const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.homeAssistant, value);

    expect((publicValue as Record<string, unknown>).access_token).toBeUndefined();
    expect((publicValue as Record<string, unknown>).url).toBe("http://ha.local");
    expect(secretValue).toEqual({ access_token: "llat-secret" });

    const masked = applySentinels(SETTINGS_KEYS.homeAssistant, publicValue, secretValue);
    expect((masked as Record<string, unknown>).access_token).toBe(SECRET_SENTINEL);
  });

  test("nested dotted paths still work (bring credentials)", () => {
    const value = { credentials: { accessToken: "at", refreshToken: "rt", email: "a@b.c" } };
    const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.bringSettings, value);

    const creds = (publicValue as any).credentials;
    expect(creds.accessToken).toBeUndefined();
    expect(creds.refreshToken).toBeUndefined();
    expect(creds.email).toBe("a@b.c"); // untouched
    expect(secretValue).toEqual({ credentials: { accessToken: "at", refreshToken: "rt" } });
  });

  test("the sentinel means keep-what's-stored, not store-the-sentinel", () => {
    const { secretValue } = splitSecrets(SETTINGS_KEYS.homeAssistant, {
      url: "http://ha.local",
      access_token: SECRET_SENTINEL,
    });
    expect(secretValue).toBeNull();
  });

  test("a key with no secrets passes through untouched", () => {
    const value = { anything: "at all" };
    const { publicValue, secretValue } = splitSecrets("not_a_secret_key", value);
    expect(publicValue).toEqual(value);
    expect(secretValue).toBeNull();
  });
});

test.describe("camera credentials", () => {
  const cameras = {
    cameras: [
      {
        id: "front",
        name: "Front door",
        url: "rtsp://10.0.0.5/live",
        auth: { username: "admin", password: "hunter2", type: "digest" },
      },
      {
        id: "garden",
        name: "Garden",
        url: "rtsp://10.0.0.6/live",
        auth: { username: "admin", password: "different", type: "basic" },
        webrtc_config: { turn_username: "turn", turn_password: "turnpass" },
      },
    ],
  };

  test("every camera's password is split out, not just the first", () => {
    const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.cameras, cameras);
    const pub = publicValue as typeof cameras;

    expect(pub.cameras[0].auth.password).toBeUndefined();
    expect(pub.cameras[1].auth.password).toBeUndefined();
    expect((pub.cameras[1] as any).webrtc_config.turn_password).toBeUndefined();

    // Everything that isn't a credential survives.
    expect(pub.cameras[0].auth.username).toBe("admin");
    expect(pub.cameras[0].url).toBe("rtsp://10.0.0.5/live");
    expect(pub.cameras[1].name).toBe("Garden");

    expect(secretValue).toEqual({
      cameras: [
        { auth: { password: "hunter2" } },
        { auth: { password: "different" }, webrtc_config: { turn_password: "turnpass" } },
      ],
    });
  });

  test("the public value keeps cameras as an ARRAY", () => {
    // Rebuilding an array as an object would turn cameras into {0:…,1:…}
    // and break every consumer while looking fine in JSON.
    const { publicValue } = splitSecrets(SETTINGS_KEYS.cameras, cameras);
    expect(Array.isArray((publicValue as any).cameras)).toBe(true);
    expect((publicValue as any).cameras).toHaveLength(2);
  });

  test("a round trip restores the real passwords server-side", () => {
    const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.cameras, cameras);
    const restored = mergeSecrets(SETTINGS_KEYS.cameras, publicValue, secretValue) as typeof cameras;
    expect(restored.cameras[0].auth.password).toBe("hunter2");
    expect(restored.cameras[1].auth.password).toBe("different");
    expect((restored.cameras[1] as any).webrtc_config.turn_password).toBe("turnpass");
  });

  test("what the browser receives carries sentinels, never passwords", () => {
    const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.cameras, cameras);
    const masked = applySentinels(SETTINGS_KEYS.cameras, publicValue, secretValue);
    const json = JSON.stringify(masked);

    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("different");
    expect(json).not.toContain("turnpass");
    expect((masked as any).cameras[0].auth.password).toBe(SECRET_SENTINEL);
  });

  test("no cameras, or a camera with no auth, is handled", () => {
    for (const value of [
      { cameras: [] },
      { cameras: [{ id: "x", name: "X", url: "rtsp://h/1" }] },
      {},
    ]) {
      const { publicValue, secretValue } = splitSecrets(SETTINGS_KEYS.cameras, value);
      expect(secretValue).toBeNull();
      expect(publicValue).toEqual(value);
    }
  });

  test("the key is actually registered", () => {
    expect(SECRET_FIELDS[SETTINGS_KEYS.cameras]).toBeDefined();
  });
});
