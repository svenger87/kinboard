import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two gaps in backup and restore.
 *
 * The remap works on FK *columns*, and `settings` has none — the id sits
 * inside the JSON value. So `default_calendar_id` came through a restore
 * still naming a calendar from the source install, and the calendar page's
 * default pointed at a row that didn't exist here.
 *
 * And uploaded images are files in Supabase Storage, not database rows, so
 * a JSON backup carried their URLs and not the files. A restore reported
 * success and the user found broken images later, with nothing connecting
 * the two.
 */

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");

test.describe("settings values that are row ids", () => {
  const idMap = new Map([["old-cal", "new-cal"]]);
  const resolve = (v: unknown) => (typeof v === "string" ? idMap.get(v) : undefined);

  // The branch transformRow now runs for settings.
  const remapSetting = (row: { key: string; value: unknown }, fks: string[]) => {
    if (!fks.includes(row.key)) return row;
    const mapped = resolve(row.value);
    return mapped ? { ...row, value: mapped } : null;
  };

  const FKS = ["default_calendar_id"];

  test("the default calendar points at the restored calendar", () => {
    expect(remapSetting({ key: "default_calendar_id", value: "old-cal" }, FKS)).toEqual({
      key: "default_calendar_id",
      value: "new-cal",
    });
  });

  test("if that calendar didn't come across, the setting is dropped", () => {
    // Better the app falls back to its own default than points at a row in
    // someone else's install.
    expect(remapSetting({ key: "default_calendar_id", value: "missing" }, FKS)).toBeNull();
  });

  test("settings holding UUIDs that aren't foreign keys are left alone", () => {
    // Real installs have these: a camera's own id, a Home Assistant
    // dashboard's id. They're internal to the setting's own blob, and
    // remapping them would corrupt working config.
    const cameras = { key: "cameras", value: { cameras: [{ id: "b4cc6119-aaaa" }] } };
    expect(remapSetting(cameras, FKS)).toBe(cameras);
    const ha = { key: "home_assistant", value: { dashboards: [{ id: "acd30f4e-bbbb" }] } };
    expect(remapSetting(ha, FKS)).toBe(ha);
  });

  test("the spec registers the key and the route acts on it", () => {
    const source = src("app", "api", "import", "route.ts");
    expect(source).toContain("settingValueFks: [SETTINGS_KEYS.defaultCalendarId]");
    expect(source).toContain("tableSpec.settingValueFks.includes(row.key)");
  });
});

test.describe("uploaded files the backup doesn't contain", () => {
  // The matcher the export uses to tell our own uploads from foreign URLs.
  const parse = (url: string) => {
    const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    return m ? { bucket: m[1], path: decodeURI(m[2]) } : null;
  };

  test("our own uploads are recognised, absolute or relative", () => {
    expect(parse("https://kb.example.com/storage/v1/object/public/recipe-images/a/b.jpg")).toEqual({
      bucket: "recipe-images",
      path: "a/b.jpg",
    });
    // publicStorageUrl falls back to a relative path with no external base.
    expect(parse("/storage/v1/object/public/vehicle-images/car.png")).toEqual({
      bucket: "vehicle-images",
      path: "car.png",
    });
  });

  test("a recipe imported from a website is not our file", () => {
    // Most recipe images in a real install are the publisher's CDN link.
    expect(parse("https://img.chefkoch-cdn.de/rezepte/2529831396465550/bilder/x.jpg")).toBeNull();
    expect(parse("https://images.kitchenstories.io/wagtailOriginalImages/R2419.jpg")).toBeNull();
  });

  test("an encoded filename comes back readable", () => {
    expect(parse("/storage/v1/object/public/recipe-images/M%C3%BCsli.jpg")?.path).toBe("Müsli.jpg");
  });

  test("the export declares the gap and the import repeats it", () => {
    expect(src("app", "api", "export", "route.ts")).toContain("included: false");
    expect(src("app", "api", "import", "route.ts")).toContain("uploaded image(s) are referenced but not contained");
  });
});

test("a version 1 backup still restores", () => {
  // The export is version 2 now. Rejecting version 1 would strand every
  // backup taken before this change.
  const source = src("app", "api", "import", "route.ts");
  expect(source).toContain("SUPPORTED_VERSIONS = [1, 2]");
  const supported = [1, 2];
  expect(supported.includes(1)).toBe(true);
  expect(supported.includes(2)).toBe(true);
  expect(supported.includes(3)).toBe(false);
});
