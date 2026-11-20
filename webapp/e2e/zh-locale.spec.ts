import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPushTranslator, getTranslator } from "../src/lib/notifications/messages";
import { LOCALES } from "../src/i18n/locales";

/**
 * Simplified Chinese as a community locale. The server's own texts (push
 * notifications, the hints assistants read) look a locale up in their own
 * table, and anything not in it fell back to German: a family set to
 * Chinese would have had its push notifications in German.
 */

test("push notifications for a Chinese family are in Chinese", () => {
  const t = getPushTranslator("zh");
  expect(t("todoNewOne")).toBe("新任务");
});

test("a key the Chinese bundle lacks reads in English, not as its path", () => {
  let failed = false;
  const t = getTranslator("zh", "holidays", () => {
    failed = true;
  });
  // Every holidays key exists in English, so the merged bundle never misses.
  const en = JSON.parse(readFileSync(join(__dirname, "..", "messages", "en.json"), "utf8"));
  const someKey = Object.keys(en.holidays).find((k) => typeof en.holidays[k] === "string" && !en.holidays[k].includes("{"));
  if (someKey) expect(t(someKey as never)).not.toBe(`holidays.${someKey}`);
  expect(failed).toBe(false);
});

test("voice input on the shopping list listens in the screen's language", () => {
  expect(LOCALES.find((l) => l.code === "zh")?.bcp47).toBe("zh-CN");
  const page = readFileSync(join(__dirname, "..", "src", "app", "shopping", "page.tsx"), "utf8");
  expect(page).toContain("recognition.lang = LOCALES.find((l) => l.code === locale)?.bcp47");
});
