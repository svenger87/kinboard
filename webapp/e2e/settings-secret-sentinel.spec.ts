import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SECRET_SENTINEL,
  applySentinels,
  resolveSentinels,
  splitSecrets,
} from "../src/lib/integration-secrets";

/**
 * A settings page never holds the real secret: `applySentinels` swaps it for
 * `__secret_stored__` on the way out. Save anything else on that page and the
 * sentinel comes back — and `splitSecrets` deletes that path from the value it
 * stores while declining to keep the sentinel as a secret.
 *
 * Between the two, the password ceased to exist. No error, nothing logged, and
 * the page still shows a filled-in password field afterwards, because a
 * sentinel renders the same as a stored secret.
 *
 * This happened to a real instance: two cameras configured before credentials
 * moved to `integration_secrets`, so the passwords were still inline in
 * `settings`; one save and both were gone, and go2rtc started answering
 * "wrong user/pass". The comment on applySentinels held that the inline value
 * survives "until the next boot migration sweeps it out" — there is no such
 * sweep, which is why that reasoning did not hold.
 */

const KEY = "cameras";

const stored = (password: string) => ({
  cameras: [
    {
      id: "cam-1",
      name: "Carport",
      stream_type: "rtsp",
      stream_url: "rtsp://10.0.0.5:554/Streaming/Channels/101",
      auth: { username: "admin", password, type: "digest" },
      enabled: true,
      position: 0,
    },
  ],
});

/** What a browser is handed, and hands back untouched. */
const asSeenByTheClient = (value: unknown, secrets: unknown = null) =>
  applySentinels(KEY, value, secrets);

test("the client is never given the real password", () => {
  const masked = asSeenByTheClient(stored("hunter2")) as ReturnType<typeof stored>;
  expect(masked.cameras[0].auth.password).toBe(SECRET_SENTINEL);
  // Everything else survives — this is a mask, not a strip.
  expect(masked.cameras[0].auth.username).toBe("admin");
  expect(masked.cameras[0].name).toBe("Carport");
});

test("a round-trip without resolveSentinels destroys the password", () => {
  // Exactly the old PUT: split whatever the client sent.
  const roundTripped = asSeenByTheClient(stored("hunter2"));
  const { publicValue, secretValue } = splitSecrets(KEY, roundTripped);

  // The path is gone from what gets written to `settings`...
  const written = publicValue as { cameras: { auth: Record<string, unknown> }[] };
  expect(written.cameras[0].auth.password).toBeUndefined();
  // ...and nothing is handed to integration_secrets to make up for it.
  expect(secretValue).toBeNull();
  // Which is the bug, stated plainly: "hunter2" now exists nowhere.
});

test("resolving against the previous value keeps the password", () => {
  const previous = stored("hunter2");
  const roundTripped = asSeenByTheClient(previous);

  const resolved = resolveSentinels(KEY, roundTripped, previous);
  const { publicValue, secretValue } = splitSecrets(KEY, resolved);

  const written = publicValue as { cameras: { auth: Record<string, unknown> }[] };
  expect(written.cameras[0].auth.password).toBeUndefined(); // still out of `settings`
  expect(secretValue).not.toBeNull();
  // and it is now where it belongs
  expect((secretValue as any).cameras[0].auth.password).toBe("hunter2");
});

test("a password still inline in settings is migrated, not lost", () => {
  // The instance this was found on: nothing in integration_secrets, the real
  // password sitting in the settings row. getMergedSetting returns it either
  // way, which is why resolveSentinels takes the merged value.
  const inlineOnly = stored("legacy-inline-pw");
  const roundTripped = applySentinels(KEY, inlineOnly, null); // no stored secrets

  const resolved = resolveSentinels(KEY, roundTripped, inlineOnly);
  const { secretValue } = splitSecrets(KEY, resolved);

  expect((secretValue as any).cameras[0].auth.password).toBe("legacy-inline-pw");
});

test("a genuinely new password wins over the stored one", () => {
  const previous = stored("old-password");
  const edited = stored("new-password"); // user typed a replacement

  const resolved = resolveSentinels(KEY, edited, previous);
  const { secretValue } = splitSecrets(KEY, resolved);

  expect((secretValue as any).cameras[0].auth.password).toBe("new-password");
});

test("clearing a password still clears it", () => {
  // An empty string is not a sentinel, so it passes through and the path ends
  // up unset — deliberate removal has to keep working.
  const previous = stored("old-password");
  const cleared = stored("");

  const resolved = resolveSentinels(KEY, cleared, previous);
  const { publicValue, secretValue } = splitSecrets(KEY, resolved);

  const written = publicValue as { cameras: { auth: Record<string, unknown> }[] };
  expect(written.cameras[0].auth.password).toBeUndefined();
  expect(secretValue).toBeNull();
});

test("a sentinel with nothing behind it is dropped rather than stored", () => {
  // The safe direction to fail in: "unset, reconnect required" beats
  // persisting the literal string __secret_stored__ as somebody's password.
  const incoming = stored(SECRET_SENTINEL);

  const resolved = resolveSentinels(KEY, incoming, null);
  const { publicValue, secretValue } = splitSecrets(KEY, resolved);

  const written = publicValue as { cameras: { auth: Record<string, unknown> }[] };
  expect(written.cameras[0].auth.password).toBeUndefined();
  expect(secretValue).toBeNull();
});

test("the settings route resolves before it splits", () => {
  // The tests above exercise the library. This one is about the caller:
  // every one of them still passes if PUT stops calling resolveSentinels,
  // and that call is the whole fix.
  const source = readFileSync(
    join(process.cwd(), "src/app/api/settings/route.ts"),
    "utf8"
  );

  expect(source).toContain("resolveSentinels");

  // Order matters — resolving after the split would be a no-op.
  const split = source.indexOf("splitSecrets(");
  const resolve = source.indexOf("resolveSentinels(");
  expect(resolve).toBeGreaterThan(-1);
  expect(split).toBeGreaterThan(-1);
  // resolveSentinels is an argument to splitSecrets, so it appears after the
  // opening call but its result is what splitSecrets receives.
  expect(source).toMatch(/splitSecrets\(\s*key,\s*resolveSentinels\(/);
});

test("one camera editing does not take another camera's password with it", () => {
  const previous = {
    cameras: [
      { ...stored("pw-one").cameras[0], id: "cam-1" },
      { ...stored("pw-two").cameras[0], id: "cam-2", name: "Terasse", position: 1 },
    ],
  };
  // The page renames camera 2; both passwords come back as sentinels because
  // that is all the browser ever had.
  const incoming = applySentinels(KEY, previous, null) as typeof previous;
  incoming.cameras[1].name = "Terrasse";

  const resolved = resolveSentinels(KEY, incoming, previous);
  const { secretValue } = splitSecrets(KEY, resolved);

  expect((secretValue as any).cameras[0].auth.password).toBe("pw-one");
  expect((secretValue as any).cameras[1].auth.password).toBe("pw-two");
});
