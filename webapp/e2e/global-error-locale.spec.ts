import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * global-error.tsx replaces the root layout, so there's no next-intl
 * provider and no useTranslations. That's why it was written in hardcoded
 * German and stayed that way while error.tsx and not-found.tsx were both
 * translated — an English or French household saw German at the one moment
 * nothing else on screen could explain itself.
 */

const source = readFileSync(join(__dirname, "..", "src", "app", "global-error.tsx"), "utf8");

test("the page no longer hardcodes German", () => {
  // The strings that used to be baked into the markup.
  expect(source).not.toMatch(/>\s*Kritischer Fehler\s*</);
  expect(source).not.toMatch(/>\s*Erneut versuchen\s*</);
  expect(source).not.toMatch(/>\s*Zum Dashboard\s*</);
});

test("it carries all three languages the app ships", () => {
  for (const locale of ["en:", "de:", "fr:"]) {
    expect(source).toContain(locale);
  }
  for (const key of ["heading", "fallback", "retry", "home"]) {
    // Once per locale.
    expect(source.split(`${key}:`).length - 1).toBe(3);
  }
});

test("English is the default, matching the rest of the app", () => {
  // src/i18n/locales.ts sets DEFAULT_LOCALE = "en".
  expect(source).toContain('useState<ErrorLocale>("en")');
  expect(source).toContain('return "en";');
});

test("the locale is resolved after mount, not during render", () => {
  // Neither cookies nor navigator.language exist during SSR. Reading them in
  // render would hydrate-mismatch inside the error page itself.
  expect(source).toContain("useEffect(() => setLocale(detectLocale()), [])");
});

test("it reads the same cookie the rest of the app negotiates on", () => {
  const locales = readFileSync(join(__dirname, "..", "src", "i18n", "locales.ts"), "utf8");
  const cookieName = locales.match(/LOCALE_COOKIE = "([^"]+)"/)?.[1];
  expect(cookieName).toBe("NEXT_LOCALE");
  expect(source).toContain(`${cookieName}=`);
});

test("the detection order is cookie, then browser, then English", () => {
  const detect = source.slice(source.indexOf("function detectLocale"));
  expect(detect.indexOf("document.cookie")).toBeLessThan(detect.indexOf("navigator.language"));
  expect(detect.indexOf("navigator.language")).toBeLessThan(detect.lastIndexOf('return "en"'));
});

test("the html lang attribute follows the chosen locale", () => {
  // A screen reader announcing German text with lang=\"en\" reads it wrong.
  expect(source).toContain("<html lang={locale}>");
});

test("the push-notification errors are translated in all three locales", () => {
  const messages = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));
  for (const locale of ["en", "de", "fr"]) {
    const push = messages(locale).components.push;
    for (const key of ["unsupported", "noFamilyOrDevice", "permissionDenied", "vapidMissing"]) {
      expect(push[key], `${locale}.${key}`).toBeTruthy();
    }
  }
  const hook = readFileSync(join(__dirname, "..", "src", "hooks", "use-push-notifications.ts"), "utf8");
  // These render straight into Settings → Notifications via `pushError`.
  expect(hook).not.toContain("Push-Benachrichtigungen werden nicht unterstützt");
  expect(hook).not.toContain("Benachrichtigungen wurden nicht erlaubt");
  expect(hook).toContain('t("permissionDenied")');
});
