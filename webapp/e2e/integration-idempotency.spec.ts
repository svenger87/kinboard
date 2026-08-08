import { test, expect } from "@playwright/test";
import {
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  fingerprintRequest,
  validateIdempotencyKey,
} from "../src/lib/integration-idempotency";

/**
 * Idempotency is the thing standing between a retried automation and milk on
 * the shopping list twice. Both halves are tested here: the key, which is
 * caller-controlled input reaching a log line and a database column, and the
 * fingerprint, which decides whether a repeat is a retry or a mistake.
 */

test.describe("the key", () => {
  test("is required", () => {
    // Optional would mean the safe path is opt-in, and the client that forgets
    // is exactly the one whose retries cause duplicates.
    expect(validateIdempotencyKey(null)).toEqual({ ok: false, reason: "missing" });
    expect(validateIdempotencyKey(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(validateIdempotencyKey("")).toEqual({ ok: false, reason: "missing" });
    expect(validateIdempotencyKey("   ")).toEqual({ ok: false, reason: "missing" });
  });

  test("accepts what clients actually send", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(validateIdempotencyKey(uuid)).toEqual({ ok: true, key: uuid });
    expect(validateIdempotencyKey("ha:automation:morning:2026-08-08")).toEqual({
      ok: true,
      key: "ha:automation:morning:2026-08-08",
    });
    expect(validateIdempotencyKey("  padded-key-value  ")).toEqual({
      ok: true,
      key: "padded-key-value",
    });
  });

  test("is bounded at both ends", () => {
    expect(validateIdempotencyKey("a".repeat(MIN_KEY_LENGTH - 1)).ok).toBe(false);
    expect(validateIdempotencyKey("a".repeat(MIN_KEY_LENGTH)).ok).toBe(true);
    expect(validateIdempotencyKey("a".repeat(MAX_KEY_LENGTH)).ok).toBe(true);
    expect(validateIdempotencyKey("a".repeat(MAX_KEY_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  test("rejects characters that would reach a log line or a header", () => {
    for (const bad of ["key with spaces", "key\nInjected: 1", "key\r\n", "key<script>", "key;drop"]) {
      expect(validateIdempotencyKey(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

test.describe("the request fingerprint", () => {
  test("is stable for the same request", () => {
    const a = fingerprintRequest("add_shopping_item", { name: "Milch" });
    const b = fingerprintRequest("add_shopping_item", { name: "Milch" });
    expect(a).toBe(b);
  });

  test("ignores key order — a client library may serialise either way", () => {
    // This is the case that would otherwise turn a legitimate retry into a
    // spurious 409, which is worse than the duplicate it was meant to prevent.
    const a = fingerprintRequest("create_task", { title: "Müll", person_id: "p1", due_at: "2026-08-09" });
    const b = fingerprintRequest("create_task", { due_at: "2026-08-09", person_id: "p1", title: "Müll" });
    expect(a).toBe(b);
  });

  test("ignores undefined values, which JSON drops anyway", () => {
    const a = fingerprintRequest("create_task", { title: "X" });
    const b = fingerprintRequest("create_task", { title: "X", person_id: undefined });
    expect(a).toBe(b);
  });

  test("changes when an argument changes", () => {
    const milk = fingerprintRequest("add_shopping_item", { name: "Milch" });
    const bread = fingerprintRequest("add_shopping_item", { name: "Brot" });
    expect(milk).not.toBe(bread);
  });

  test("distinguishes null from absent", () => {
    // `{person_id: null}` means "explicitly nobody"; omitting it means "not
    // specified". Treating them as one would let a key be reused across two
    // genuinely different requests.
    const withNull = fingerprintRequest("create_task", { title: "X", person_id: null });
    const without = fingerprintRequest("create_task", { title: "X" });
    expect(withNull).not.toBe(without);
  });

  test("distinguishes services, so one key cannot cross between them", () => {
    const a = fingerprintRequest("add_shopping_item", { name: "X" });
    const b = fingerprintRequest("create_note", { name: "X" });
    expect(a).not.toBe(b);
  });

  test("is not fooled by nesting or arrays", () => {
    const a = fingerprintRequest("s", { a: [1, { x: 1, y: 2 }] });
    const b = fingerprintRequest("s", { a: [1, { y: 2, x: 1 }] });
    expect(a).toBe(b);

    const c = fingerprintRequest("s", { a: [1, 2] });
    const d = fingerprintRequest("s", { a: [2, 1] });
    // Array order IS meaningful — unlike key order.
    expect(c).not.toBe(d);
  });
});
