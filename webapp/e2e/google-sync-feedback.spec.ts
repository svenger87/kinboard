import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Events on a Google-linked calendar are pushed to Google after the local
 * save. Every failure on that path was logged to the console and nothing
 * more — so an event that never reached your phone looked exactly like one
 * that did.
 *
 * The CalDAV branch sitting right beside it already toasts on all three
 * verbs, and its delete comment spells out why a failed remote delete must
 * not proceed locally. Google just never got the same treatment.
 */

const hook = readFileSync(
  join(__dirname, "..", "src", "hooks", "use-supabase-queries.ts"),
  "utf8",
);
const messages = (locale: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));

test("a failed push tells the user, on both the error and the not-ok path", () => {
  // Two sites: response.ok === false, and the fetch throwing.
  expect(hook.split('tGoogle("pushFailed")').length - 1).toBe(2);
});

test("a failed update tells the user too", () => {
  expect(hook.split('tGoogle("updateFailed")').length - 1).toBe(2);
});

test("delete now checks the response at all", () => {
  // It used to `await fetch(...)` and ignore the result, so a 500 from
  // Google counted as a successful delete.
  const del = hook.slice(hook.indexOf("Delete from Google first"));
  expect(del).toContain("if (!response.ok)");
  expect(del).toContain("Google Calendar returned ${response.status}");
});

test("a failed delete keeps the local event, matching CalDAV", () => {
  // Deleting locally while it survives on Google means the next sync pulls
  // it straight back — the delete appears to undo itself.
  const del = hook.slice(hook.indexOf("Delete from Google first"));
  const throwIdx = del.indexOf("throw new Error(googleError)");
  expect(throwIdx).toBeGreaterThan(-1);
  // And it throws before the local delete runs.
  expect(throwIdx).toBeLessThan(del.indexOf('.from("events").delete()'));
});

test("all three strings exist in all three languages", () => {
  for (const locale of ["en", "de", "fr"]) {
    const google = messages(locale).calendar.googleToast;
    for (const key of ["pushFailed", "updateFailed", "deleteFailed"]) {
      expect(google?.[key], `${locale}.${key}`).toBeTruthy();
    }
  }
});

test("the wording matches the CalDAV equivalents, only naming the other service", () => {
  // These two branches do the same job; a user shouldn't have to learn two
  // vocabularies depending on which calendar backend they picked.
  const en = messages("en").calendar;
  expect(en.googleToast.pushFailed).toBe(en.caldavToast.pushFailed.replace("the CalDAV server", "Google Calendar"));
  expect(en.googleToast.updateFailed).toBe(en.caldavToast.updateFailed.replace("the CalDAV server", "Google Calendar"));
});

test("a successful push still says nothing", () => {
  // The toast is for failures only — a working sync must stay silent.
  const create = hook.slice(hook.indexOf("Push to Google Calendar"), hook.indexOf("Push update to Google"));
  const okBranch = create.slice(create.indexOf("if (response.ok)"), create.indexOf("} else {"));
  expect(okBranch).not.toContain("toast");
});
