import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAMILY_STEPS,
  INSTALL_STEPS,
  INSTANCE_FIRST_RUN_KEY,
  firstIncompleteStep,
  firstRunFamily,
  firstRunRecord,
  installStepsDue,
  installStepsListed,
  normaliseSiteUrl,
  normaliseVapidSubject,
  resolveInstanceValue,
  stepNeighbours,
  subjectForDisplay,
  wizardSteps,
} from "../src/lib/first-run";
import { instanceSiteUrl, instanceVapidSubject } from "../src/lib/instance-config";
import { codeOnly } from "./source-helpers";

/**
 * The first-run sequence (RFC-024 §8): which steps a family sees, in which
 * order, who gets the install's own steps, and what the install settings
 * accept. Plain functions and the routes' source; the flow itself runs in
 * first-run-flow.spec.ts against a fresh stack.
 */

const read = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), "utf8"));
const raw = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const NOTHING = {
  has_holiday_region: false,
  has_people: false,
  has_calendar: false,
  has_home_assistant: false,
  has_weather_location: false,
  has_pin: false,
};
const EVERYTHING = {
  has_holiday_region: true,
  has_people: true,
  has_calendar: true,
  has_home_assistant: true,
  has_weather_location: true,
  has_pin: true,
};

test.describe("who sees the install's steps", () => {
  test("only the operator, only until they were left once", () => {
    expect(installStepsDue({ operator: true, firstRunDone: false })).toBe(true);
    expect(installStepsDue({ operator: true, firstRunDone: true })).toBe(false);
    expect(installStepsDue({ operator: false, firstRunDone: false }), "a second family on the install").toBe(false);
    expect(installStepsDue({ operator: false })).toBe(false);
    expect(installStepsDue(undefined), "still loading, or the read failed").toBe(false);
    expect(installStepsDue(null)).toBe(false);
  });

  test("listed for the rest of the operator's own wizard, never after migration 094 closed them", () => {
    expect(installStepsListed({ operator: true, firstRunDone: false })).toBe(true);
    expect(installStepsListed({ operator: true, firstRunDone: true, firstRunMine: true })).toBe(true);
    expect(installStepsListed({ operator: true, firstRunDone: true, firstRunMine: false }), "an existing install").toBe(false);
    expect(installStepsListed({ operator: false, firstRunDone: false })).toBe(false);
    expect(installStepsListed(undefined)).toBe(false);
  });

  test("the marker says which family closed them; migration 094's says none", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(firstRunFamily(firstRunRecord("fam-1", now))).toBe("fam-1");
    expect(JSON.parse(firstRunRecord("fam-1", now)).at).toBe("2026-11-26T12:00:00.000Z");
    expect(firstRunFamily("before-094")).toBeNull();
    expect(firstRunFamily("")).toBeNull();
    expect(firstRunFamily(null)).toBeNull();
    expect(firstRunFamily('{"family_id": 7}')).toBeNull();
    expect(firstRunFamily("[1]")).toBeNull();
  });
});

test.describe("the order of the steps", () => {
  test("the install's two steps, then the family's, the PIN last before done", () => {
    expect(wizardSteps(true)).toEqual(["install", "push", "region", "people", "calendar", "homeassistant", "weather", "pin", "done"]);
    expect(wizardSteps(false)).toEqual([...FAMILY_STEPS]);
    expect(wizardSteps(false)).not.toContain(INSTALL_STEPS[0]);
    // Once the PIN is set, every save in an earlier step would ask for it.
    const family = wizardSteps(false);
    expect(family.indexOf("pin")).toBe(family.length - 2);
  });

  test("Back and Continue follow the list", () => {
    const op = wizardSteps(true);
    expect(stepNeighbours(op, "install")).toEqual({ back: undefined, next: "/setup/push" });
    expect(stepNeighbours(op, "push")).toEqual({ back: "/setup/install", next: "/setup/region" });
    expect(stepNeighbours(op, "region")).toEqual({ back: "/setup/push", next: "/setup/people" });
    const fam = wizardSteps(false);
    expect(stepNeighbours(fam, "region")).toEqual({ back: undefined, next: "/setup/people" });
    expect(stepNeighbours(fam, "weather")).toEqual({ back: "/setup/homeassistant", next: "/setup/pin" });
    expect(stepNeighbours(fam, "pin")).toEqual({ back: "/setup/weather", next: "/setup/done" });
    expect(stepNeighbours(fam, "done").next).toBe("/setup/done");
    // An install step opened by a family that does not list it goes on to the family's first step.
    expect(stepNeighbours(fam, "push")).toEqual({ next: "/setup/region" });
  });

  test("/setup sends the operator to the install's steps first, everyone else to the first family step not done", () => {
    expect(firstIncompleteStep(NOTHING, true)).toBe("install");
    expect(firstIncompleteStep(EVERYTHING, true), "due even when the family is done").toBe("install");
    expect(firstIncompleteStep(NOTHING, false)).toBe("region");
    expect(firstIncompleteStep({ ...EVERYTHING, has_people: false }, false)).toBe("people");
    expect(firstIncompleteStep({ ...EVERYTHING, has_pin: false }, false)).toBe("pin");
    expect(firstIncompleteStep(EVERYTHING, false)).toBe("done");
    // An older server says nothing about the PIN: not sent to set one.
    const { has_pin: _omitted, ...older } = EVERYTHING;
    void _omitted;
    expect(firstIncompleteStep(older, false)).toBe("done");
  });
});

test.describe("what the install settings accept", () => {
  test("the address: an http(s) origin and nothing else", () => {
    expect(normaliseSiteUrl("http://192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
    expect(normaliseSiteUrl("https://kinboard.example.org/")).toBe("https://kinboard.example.org");
    expect(normaliseSiteUrl("  https://Kinboard.Example.org  ")).toBe("https://kinboard.example.org");
    expect(normaliseSiteUrl("kinboard.local:3000"), "a bare host, as an address bar takes it").toBe("http://kinboard.local:3000");
    expect(normaliseSiteUrl("https://kinboard.example.org:443")).toBe("https://kinboard.example.org");
    for (const bad of [
      "",
      "   ",
      "ftp://kinboard.local",
      "javascript:alert(1)",
      "https://user:pw@kinboard.local",
      "https://kinboard.local/sub",
      "https://kinboard.local/?x=1",
      "https://kinboard.local/#a",
      "https://kin board.local",
      `https://${"a".repeat(300)}.local`,
      42,
      null,
      undefined,
    ]) {
      expect(normaliseSiteUrl(bad), String(bad)).toBeNull();
    }
  });

  test("the push contact: an email (stored as mailto:) or an https address", () => {
    expect(normaliseVapidSubject("me@example.org")).toBe("mailto:me@example.org");
    expect(normaliseVapidSubject(" mailto:me@example.org ")).toBe("mailto:me@example.org");
    expect(normaliseVapidSubject("MAILTO:me@example.org")).toBe("mailto:me@example.org");
    expect(normaliseVapidSubject("https://example.org/contact")).toBe("https://example.org/contact");
    for (const bad of ["", "me", "me@", "@example.org", "me@example", "http://example.org", "mailto:", "a b@example.org", "me@example.org\nBcc: x@y.z", 1, null]) {
      expect(normaliseVapidSubject(bad), String(bad)).toBeNull();
    }
    expect(subjectForDisplay("mailto:me@example.org")).toBe("me@example.org");
    expect(subjectForDisplay("https://example.org/")).toBe("https://example.org/");
    expect(subjectForDisplay(null)).toBe("");
  });

  test("the environment wins whenever it is set", () => {
    expect(resolveInstanceValue("https://env.example", "https://stored.example")).toEqual({ value: "https://env.example", source: "environment" });
    expect(resolveInstanceValue("  ", "https://stored.example")).toEqual({ value: "https://stored.example", source: "install" });
    expect(resolveInstanceValue(undefined, null)).toEqual({ value: null, source: "none" });
  });
});

test.describe("the routes", () => {
  const route = read("src/app/api/setup/instance/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("async function gate"));
  const gate = route.slice(route.indexOf("async function gate"), route.indexOf("export async function PUT"));
  const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function POST"));
  const post = route.slice(route.indexOf("export async function POST"));

  test("reading needs a session, and anyone but the operator learns nothing, before anything is read", () => {
    expect(get).toContain("requireSession(request)");
    const check = get.indexOf("if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ operator: false })");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(get.indexOf("readInstanceKey("));
  });

  test("the operator rule is #547's, shared with the update notice", () => {
    expect(route).toContain('import { isInstallOperator } from "@/lib/install-operator";');
    expect(read("src/app/api/update-status/route.ts")).toContain('import { isInstallOperator as operator } from "@/lib/install-operator"');
    const lib = read("src/lib/install-operator.ts");
    expect(lib).toContain("decideOperator(familyId, {");
    expect(lib).toContain("INSTANCE_ADMIN_FAMILY_ID: process.env.INSTANCE_ADMIN_FAMILY_ID");
  });

  test("changing needs the operator, then the settings PIN, before any write; done needs the operator", () => {
    expect(gate).toContain("requireSession(request)");
    expect(gate).toContain("status: 403");
    expect(put.indexOf("await gate(request)")).toBeGreaterThan(-1);
    expect(put.indexOf("await gate(request)")).toBeLessThan(put.indexOf("requireSettingsUnlock(g.session)"));
    expect(put.indexOf("requireSettingsUnlock(g.session)")).toBeLessThan(put.indexOf("writeInstanceKey("));
    expect(put).toContain("normaliseSiteUrl");
    expect(put).toContain("normaliseVapidSubject");
    expect(put).toContain('{ error: "bad_value", field }');
    expect(post.indexOf("await gate(request)")).toBeLessThan(post.indexOf("writeInstanceKey("));
    expect(post).toContain("firstRunRecord(g.session.familyId");
  });

  test("finishing the wizard closes the install's steps too, for the operator only", () => {
    const complete = read("src/app/api/setup/complete/route.ts");
    expect(complete).toMatch(/if \(\(await isInstallOperator\(familyId\)\) && !\(await readInstanceKey\(INSTANCE_FIRST_RUN_KEY\)\)\)/);
    expect(complete.indexOf("familyMatchesSession(auth.session, familyId)")).toBeLessThan(complete.indexOf("isInstallOperator("));
  });

  test("the setup state reports the PIN", () => {
    const state = read("src/app/api/setup/state/route.ts");
    expect(state).toContain("has_pin: hasPin");
    expect(state).toMatch(/familyHasPin\(familyId\)\.catch\(/);
  });
});

test.describe("what reads the install settings", () => {
  test("calendar links: SITE_URL, else the saved address, else the request's", () => {
    const feed = read("src/app/api/calendar/feed/route.ts");
    expect(feed).toContain("const siteUrl = await instanceSiteUrl();");
    expect(feed).toContain("const origin = siteUrl || request.nextUrl.origin;");
    const lib = read("src/lib/instance-config.ts");
    const fn = lib.slice(lib.indexOf("export async function instanceSiteUrl"), lib.indexOf("export async function instanceVapidSubject"));
    expect(fn.indexOf("process.env.SITE_URL")).toBeLessThan(fn.indexOf("stored(INSTANCE_SITE_URL_KEY)"));
  });

  test("push: VAPID_SUBJECT, else the saved contact, else the old default, on every send", () => {
    const sender = read("src/lib/push-sender.ts");
    expect(sender).toContain("vapidDetails: { subject: await instanceVapidSubject(), publicKey: publicKey!, privateKey: privateKey! }");
    const lib = read("src/lib/instance-config.ts");
    const fn = lib.slice(lib.indexOf("export async function instanceVapidSubject"));
    expect(fn.indexOf("process.env.VAPID_SUBJECT")).toBeLessThan(fn.indexOf("stored(INSTANCE_VAPID_SUBJECT_KEY)"));
    expect(fn).toContain("|| DEFAULT_VAPID_SUBJECT");
  });

  test("with the environment set, nothing is read from the database", async () => {
    const before = { s: process.env.SITE_URL, v: process.env.VAPID_SUBJECT };
    process.env.SITE_URL = "https://env.example/";
    process.env.VAPID_SUBJECT = "mailto:env@example.org";
    try {
      expect(await instanceSiteUrl()).toBe("https://env.example");
      expect(await instanceVapidSubject()).toBe("mailto:env@example.org");
    } finally {
      if (before.s === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = before.s;
      if (before.v === undefined) delete process.env.VAPID_SUBJECT;
      else process.env.VAPID_SUBJECT = before.v;
    }
  });
});

test.describe("existing installs", () => {
  test("migration 094 closes the install's steps on every install that already has a family, and only there", () => {
    const sql = raw("docker/migrations/094_first_run.sql");
    const body = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(body).toContain(`SELECT '${INSTANCE_FIRST_RUN_KEY}', 'before-094'`);
    expect(body).toContain("WHERE EXISTS (SELECT 1 FROM public.families)");
    expect(body).toContain("ON CONFLICT (key) DO NOTHING");
    expect(firstRunFamily("before-094")).toBeNull();
  });

  test("a family that finished setup is never sent to /setup", () => {
    const guard = read("src/components/auth-guard.tsx");
    expect(guard).toMatch(/setup_completed === false\s*\?\s*"\/setup"/);
  });

  test("a new family goes to /setup, which picks the first step", () => {
    expect(read("src/app/join/page.tsx")).toContain('router.push("/setup");');
    expect(read("src/app/setup/page.tsx")).toContain("stepHref(firstIncompleteStep(state, installStepsDue(instance)))");
  });

  test("the install's steps send anyone but the operator on", () => {
    for (const step of ["install", "push"]) {
      expect(read(`src/app/setup/${step}/page.tsx`)).toContain('if (!isLoading && instance && !instance.operator) router.replace("/setup");');
    }
  });
});

test.describe("every step can be found again in Settings", () => {
  test("address, contact and data folder in Settings → This install, the PIN in Security, keys and time zone where #549 and Language put them", () => {
    const settings = read("src/app/settings/page.tsx");
    expect(settings).toContain("<InstanceCard />");
    expect(settings).toContain("<PinDigits ref={pinDigitsRef}");
    expect(read("src/app/setup/pin/page.tsx")).toContain("saveSettingsPin(family.id, pin)");
    const card = read("src/components/settings/instance-card.tsx");
    expect(card).toContain("if (!instance?.operator) return null;");
    for (const part of ["<SiteAddressField", "<PushContactField", "<DataLocationNote"]) expect(card).toContain(part);
    expect(read("src/app/setup/weather/page.tsx")).toContain("<WeatherKeyCard />");
    expect(read("src/app/setup/calendar/page.tsx")).toContain('<GoogleClientCard id="setup-google-client" />');
    expect(read("src/app/setup/region/page.tsx")).toContain("<TimeZonePicker");
    expect(read("src/app/setup/region/page.tsx")).toContain("<LocaleSwitcher />");
  });
});

test.describe("texts", () => {
  const LOCALES = ["en", "de", "fr", "zh"] as const;
  const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const load = (l: string) => JSON.parse(raw(`messages/${l}.json`)) as Record<string, Record<string, Record<string, unknown>>>;

  test("the new steps and the Settings card in all four languages, with the same placeholders", () => {
    const en = load("en");
    const sections = {
      "setup.install": en.setup.install,
      "setup.push": en.setup.push,
      "setup.pin": en.setup.pin,
      "settings.instance": en.settings.instance,
    };
    for (const [name, section] of Object.entries(sections)) {
      expect(section, name).toBeTruthy();
      for (const l of LOCALES) {
        const [a, b] = name.split(".");
        const other = load(l)[a][b] as Record<string, unknown>;
        expect(keys(other).sort(), `${l} ${name}`).toEqual(keys(section as Record<string, unknown>).sort());
        for (const k of keys(section as Record<string, unknown>)) {
          const want = String((section as Record<string, unknown>)[k]).match(/\{\w+\}|<\w+>/g)?.sort() ?? [];
          const got = String(other[k]).match(/\{\w+\}|<\w+>/g)?.sort() ?? [];
          expect(got, `${l} ${name}.${k}`).toEqual(want);
        }
      }
    }
    for (const l of LOCALES) {
      const m = load(l);
      for (const k of ["languageLabel", "timeZoneLabel", "timeZoneDescription", "regionLabel"]) expect(m.setup.region[k], `${l} ${k}`).toBeTruthy();
      expect((m.setup.checklist as Record<string, unknown>).item_pin, l).toBeTruthy();
    }
  });
});
