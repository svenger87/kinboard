import { test, expect } from "@playwright/test";
import { notePatch } from "../src/lib/note-patch";

/**
 * `notePatch` — the pure decision `PATCH /notes/{id}` is built on (RFC-011
 * task 3), extracted the same way `task-completion.ts` extracted task
 * completion: the rule tested directly, without a database or a request.
 */

test.describe("content", () => {
  test("a plain string is trimmed and accepted", () => {
    expect(notePatch({ content: "  Pick up Mara at 4  " })).toEqual({
      ok: true,
      patch: { content: "Pick up Mara at 4" },
    });
  });

  test("empty, or only whitespace, is refused", () => {
    expect(notePatch({ content: "" }).ok).toBe(false);
    expect(notePatch({ content: "   " }).ok).toBe(false);
  });

  test("exactly 2000 characters is accepted, 2001 is refused", () => {
    expect(notePatch({ content: "a".repeat(2000) }).ok).toBe(true);
    expect(notePatch({ content: "a".repeat(2001) }).ok).toBe(false);
  });

  test("a non-string content is refused", () => {
    expect(notePatch({ content: 5 }).ok).toBe(false);
    expect(notePatch({ content: null }).ok).toBe(false);
  });
});

test.describe("pinned", () => {
  test("true and false are both accepted", () => {
    expect(notePatch({ pinned: true })).toEqual({ ok: true, patch: { pinned: true } });
    expect(notePatch({ pinned: false })).toEqual({ ok: true, patch: { pinned: false } });
  });

  test("a non-boolean is refused", () => {
    expect(notePatch({ pinned: "true" }).ok).toBe(false);
    expect(notePatch({ pinned: 1 }).ok).toBe(false);
  });
});

test.describe("both fields together", () => {
  test("both are written in one patch", () => {
    expect(notePatch({ content: "Buy milk", pinned: true })).toEqual({
      ok: true,
      patch: { content: "Buy milk", pinned: true },
    });
  });

  test("one invalid field refuses the whole patch, even if the other is valid", () => {
    expect(notePatch({ content: "ok", pinned: "yes" }).ok).toBe(false);
  });
});

test("neither field present is refused — an empty patch is not a no-op", () => {
  const result = notePatch({});
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("nothing to change");
});

test("an unrelated key alone is the same as an empty patch", () => {
  expect(notePatch({ person_id: "x" }).ok).toBe(false);
});
