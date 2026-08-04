import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A button whose only content is an icon has no accessible name — a screen
 * reader announces "button" and nothing else. On a kiosk a family shares,
 * that's the difference between "remove NVDA from the watchlist" and an
 * unlabelled control next to a row of them.
 *
 * The codebase was already good about this; two had slipped through. This
 * walks the whole tree so the next one doesn't.
 */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("no icon-only button ships without an accessible name", () => {
  const root = join(__dirname, "..", "src");
  const files = [...tsxFiles(join(root, "app")), ...tsxFiles(join(root, "components"))];

  // If this ever finds nothing, the walk is broken, not the codebase.
  expect(files.length).toBeGreaterThan(50);

  const unlabelled: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // A <button>/<Button> whose entire body is one self-closing capitalised
    // component — i.e. an icon and nothing else.
    const pattern = /<(button|Button)\b((?:[^>"]|"[^"]*")*?)>\s*<([A-Z][A-Za-z0-9]*)\b[^>]*\/>\s*<\/\1>/gs;
    for (const match of source.matchAll(pattern)) {
      const attrs = match[2];
      if (/aria-label|aria-labelledby|title=|sr-only/.test(attrs)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      unlabelled.push(`${file.slice(root.length + 1)}:${line} <${match[1]}> → <${match[3]}/>`);
    }
  }

  expect(unlabelled).toEqual([]);
});

test("the two that had slipped through are labelled, and translated", () => {
  const messages = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));

  for (const locale of ["en", "de", "fr"]) {
    expect(messages(locale).settings.stonks.deleteAria, locale).toBeTruthy();
    expect(messages(locale).components.locationAutocomplete.clearAria, locale).toBeTruthy();
  }

  // The watchlist label names the ticker, so a row of delete buttons is
  // distinguishable rather than three identical "Remove" controls.
  expect(messages("en").settings.stonks.deleteAria).toContain("{symbol}");
});
